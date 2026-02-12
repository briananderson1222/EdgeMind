// lib/schema/index.js - Schema Discovery Module
// Queries InfluxDB to discover measurements and hierarchical topic structure

const { queryApi } = require('../influx/client');
const { schemaCache } = require('../state');
const CONFIG = require('../config');
const { sanitizeInfluxIdentifier } = require('../validation');
const { MEASUREMENT_CLASSIFICATIONS } = require('../domain-context');

// Track in-progress schema refresh to prevent race conditions
let schemaRefreshInProgress = null;
let hierarchyRefreshInProgress = null;

/**
 * Classify a measurement based on its name, value type, and sample values.
 * @param {string} name - Measurement name
 * @param {string} valueType - 'numeric' or 'string'
 * @param {Array} sampleValues - Sample values for inference
 * @returns {string} Classification category
 */
function classifyMeasurementDetailed(name, valueType, sampleValues) {
  const nameLower = name.toLowerCase();

  // Match against patterns
  for (const [classification, patterns] of Object.entries(MEASUREMENT_CLASSIFICATIONS)) {
    if (patterns.some(p => nameLower.includes(p.toLowerCase()))) {
      return classification;
    }
  }

  // Infer from value type and range
  if (valueType === 'string') {
    return 'description';
  }

  if (valueType === 'numeric' && sampleValues && sampleValues.length > 0) {
    const numericValues = sampleValues.filter(v => typeof v === 'number');
    if (numericValues.length > 0) {
      const avg = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;
      if (avg >= 0 && avg <= 100) return 'percentage_metric';
      if (avg > 1000) return 'counter';
    }
  }

  return 'unknown';
}

/**
 * Refreshes the schema cache by querying InfluxDB for measurement metadata.
 * Only refreshes if cache has expired (older than CACHE_TTL_MS).
 * Uses a lock to prevent concurrent refresh operations.
 */
async function refreshSchemaCache() {
  // Check if cache is still valid
  if (schemaCache.lastRefresh &&
      Date.now() - schemaCache.lastRefresh < schemaCache.CACHE_TTL_MS) {
    return;
  }

  // If a refresh is already in progress, wait for it instead of starting another
  if (schemaRefreshInProgress) {
    console.log('🔍 Schema refresh already in progress, waiting...');
    await schemaRefreshInProgress;
    return;
  }

  console.log('🔍 Refreshing schema cache...');
  const startTime = Date.now();

  // Create the refresh promise and store it in the lock
  const refreshPromise = (async () => {

  try {
    // Query 1: Get measurement counts and tags from last 24 hours
    const countQuery = `
      from(bucket: "${CONFIG.influxdb.bucket}")
        |> range(start: -24h)
        |> filter(fn: (r) => r._field == "value")
        |> group(columns: ["_measurement", "enterprise", "site"])
        |> count()
    `;

    const measurementData = new Map();

    await new Promise((resolve, reject) => {
      queryApi.queryRows(countQuery, {
        next(row, tableMeta) {
          const o = tableMeta.toObject(row);
          const measurement = o._measurement;

          if (!measurementData.has(measurement)) {
            measurementData.set(measurement, {
              name: measurement,
              count: 0,
              enterprises: new Set(),
              sites: new Set(),
              lastSeen: null
            });
          }

          const data = measurementData.get(measurement);
          data.count += o._value || 0;
          if (o.enterprise) data.enterprises.add(o.enterprise);
          if (o.site) data.sites.add(o.site);
          if (o._time) {
            const timeDate = new Date(o._time);
            if (!data.lastSeen || timeDate > new Date(data.lastSeen)) {
              data.lastSeen = o._time;
            }
          }
        },
        error(error) {
          console.error('Schema cache count query error:', error.message);
          reject(error);
        },
        complete() {
          resolve();
        }
      });
    });

    // Query 2: Get sample values for each measurement to determine type (in parallel batches)
    const measurementEntries = Array.from(measurementData.entries());
    const BATCH_SIZE = 10;

    for (let i = 0; i < measurementEntries.length; i += BATCH_SIZE) {
      const batch = measurementEntries.slice(i, i + BATCH_SIZE);

      await Promise.all(batch.map(async ([measurement, data]) => {
        const sanitizedMeasurement = sanitizeInfluxIdentifier(measurement);
        const sampleQuery = `
          from(bucket: "${CONFIG.influxdb.bucket}")
            |> range(start: -1h)
            |> filter(fn: (r) => r._measurement == "${sanitizedMeasurement}")
            |> filter(fn: (r) => r._field == "value")
            |> limit(n: 3)
        `;

        const sampleValues = [];
        let valueType = 'numeric';

        await new Promise((resolve) => {
          queryApi.queryRows(sampleQuery, {
            next(row, tableMeta) {
              const o = tableMeta.toObject(row);
              if (o._value !== undefined && o._value !== null) {
                sampleValues.push(o._value);
                // Determine if numeric or string based on value type
                if (typeof o._value === 'string' && isNaN(parseFloat(o._value))) {
                  valueType = 'string';
                }
              }
            },
            error(error) {
              console.error(`Sample query error for ${measurement}:`, error.message);
              resolve();
            },
            complete() {
              resolve();
            }
          });
        });

        data.sampleValues = sampleValues.slice(0, 3);
        data.valueType = valueType;
      }));
    }

    // Update cache with classification
    schemaCache.measurements.clear();
    for (const [measurement, data] of measurementData.entries()) {
      const classification = classifyMeasurementDetailed(data.name, data.valueType, data.sampleValues);

      schemaCache.measurements.set(measurement, {
        name: data.name,
        count: data.count,
        lastSeen: data.lastSeen || new Date().toISOString(),
        valueType: data.valueType,
        sampleValues: data.sampleValues,
        enterprises: Array.from(data.enterprises),
        sites: Array.from(data.sites),
        classification: classification
      });
    }

    // Phase 4: Sync knownMeasurements with refreshed cache
    schemaCache.knownMeasurements.clear();
    for (const m of schemaCache.measurements.keys()) {
      schemaCache.knownMeasurements.add(m);
    }

    schemaCache.lastRefresh = Date.now();
    const duration = Date.now() - startTime;
    console.debug(`✅ Schema cache refreshed: ${schemaCache.measurements.size} measurements (${duration}ms)`);

  } catch (error) {
    console.error('❌ Schema cache refresh failed:', error.message);
    throw error;
  }
  })();

  // Store the promise in the lock
  schemaRefreshInProgress = refreshPromise;

  try {
    await refreshPromise;
  } finally {
    // Clear the lock when done
    schemaRefreshInProgress = null;
  }
}

/**
 * Refreshes the hierarchy cache by querying InfluxDB for topic structure.
 * Only refreshes if cache has expired (older than CACHE_TTL_MS).
 * Uses a lock to prevent concurrent refresh operations.
 * Builds a tree: Enterprise -> Site -> Area -> Machine -> Measurements
 */
async function refreshHierarchyCache() {
  // Check if cache is still valid
  if (schemaCache.lastHierarchyRefresh &&
      Date.now() - schemaCache.lastHierarchyRefresh < schemaCache.CACHE_TTL_MS) {
    return;
  }

  // If a refresh is already in progress, wait for it instead of starting another
  if (hierarchyRefreshInProgress) {
    console.log('🌳 Hierarchy refresh already in progress, waiting...');
    await hierarchyRefreshInProgress;
    return;
  }

  console.log('🌳 Refreshing hierarchy cache...');
  const startTime = Date.now();

  // Create the refresh promise and store it in the lock
  const refreshPromise = (async () => {

  try {
    // Query InfluxDB for hierarchical grouping with counts
    const hierarchyQuery = `
      from(bucket: "${CONFIG.influxdb.bucket}")
        |> range(start: -1h)
        |> filter(fn: (r) => r._field == "value")
        |> group(columns: ["enterprise", "site", "area", "machine", "_measurement"])
        |> count()
        |> group()
    `;

    const hierarchyData = [];

    await new Promise((resolve, reject) => {
      queryApi.queryRows(hierarchyQuery, {
        next(row, tableMeta) {
          const o = tableMeta.toObject(row);
          hierarchyData.push({
            enterprise: o.enterprise || 'unknown',
            site: o.site || 'unknown',
            area: o.area || 'unknown',
            machine: o.machine || 'unknown',
            measurement: o._measurement,
            count: o._value || 0
          });
        },
        error(error) {
          console.error('Hierarchy cache query error:', error);
          reject(error);
        },
        complete() {
          resolve();
        }
      });
    });

    // Build the hierarchy tree from flat data
    const hierarchy = {};

    hierarchyData.forEach(item => {
      const { enterprise, site, area, machine, measurement, count } = item;

      // Initialize enterprise level
      if (!hierarchy[enterprise]) {
        hierarchy[enterprise] = {
          totalCount: 0,
          sites: {}
        };
      }

      // Initialize site level
      if (!hierarchy[enterprise].sites[site]) {
        hierarchy[enterprise].sites[site] = {
          totalCount: 0,
          areas: {}
        };
      }

      // Initialize area level
      if (!hierarchy[enterprise].sites[site].areas[area]) {
        hierarchy[enterprise].sites[site].areas[area] = {
          totalCount: 0,
          machines: {}
        };
      }

      // Initialize machine level
      if (!hierarchy[enterprise].sites[site].areas[area].machines[machine]) {
        hierarchy[enterprise].sites[site].areas[area].machines[machine] = {
          totalCount: 0,
          measurements: []
        };
      }

      // Add measurement to machine
      const machineData = hierarchy[enterprise].sites[site].areas[area].machines[machine];
      if (!machineData.measurements.includes(measurement)) {
        machineData.measurements.push(measurement);
      }

      // Aggregate counts up the hierarchy
      machineData.totalCount += count;
      hierarchy[enterprise].sites[site].areas[area].totalCount += count;
      hierarchy[enterprise].sites[site].totalCount += count;
      hierarchy[enterprise].totalCount += count;
    });

    // Update cache
    schemaCache.hierarchy = hierarchy;
    schemaCache.lastHierarchyRefresh = Date.now();

    const duration = Date.now() - startTime;
    const enterpriseCount = Object.keys(hierarchy).length;
    console.debug(`✅ Hierarchy cache refreshed: ${enterpriseCount} enterprises (${duration}ms)`);

  } catch (error) {
    console.error('❌ Hierarchy cache refresh failed:', error.message);
    throw error;
  }
  })();

  // Store the promise in the lock
  hierarchyRefreshInProgress = refreshPromise;

  try {
    await refreshPromise;
  } finally {
    // Clear the lock when done
    hierarchyRefreshInProgress = null;
  }
}

module.exports = {
  refreshSchemaCache,
  refreshHierarchyCache,
  classifyMeasurementDetailed
};
