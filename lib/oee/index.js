// lib/oee/index.js - OEE (Overall Equipment Effectiveness) Module

const { queryApi } = require('../influx/client');
const { schemaCache } = require('../state');
const { refreshSchemaCache } = require('../schema');
const CONFIG = require('../config');
const { sanitizeInfluxIdentifier } = require('../validation');

// =============================================================================
// PHASE 1 & 2: ROBUST OEE CONFIGURATION & DISCOVERY
// =============================================================================

/**
 * OEE Calculation Tiers
 * Defines the priority hierarchy for calculating OEE metrics
 */
const OEE_TIERS = {
  1: 'pre-computed-overall',
  2: 'pre-computed-components',
  3: 'calculated-from-raw',
  4: 'insufficient-data'
};

/**
 * OEE measurement patterns for auto-discovery
 * Regular expressions to match OEE-related measurements
 */
const OEE_PATTERNS = {
  overall: [/^oee$/i, /metric_oee/i, /oee_overall/i],
  availability: [/oee_availability/i, /availability/i],
  performance: [/oee_performance/i, /performance/i],
  quality: [/oee_quality/i, /quality/i]
};

/**
 * Runtime OEE configuration (populated by discovery)
 * Contains per-enterprise OEE calculation strategies
 */
const oeeConfig = {
  defaults: {
    staleDataThreshold: 300000, // 5 minutes
    decimalToPercentThreshold: 1.5
  },
  enterprises: {} // Populated by discoverOEESchema()
};

/**
 * Discovers OEE schema for all enterprises by analyzing available measurements.
 * Populates the oeeConfig.enterprises object with tier-based calculation strategies.
 *
 * @returns {Promise<Object>} Discovered OEE configuration per enterprise
 */
async function discoverOEESchema() {
  await refreshSchemaCache();

  const allMeasurements = Array.from(schemaCache.measurements.values());

  // Group by enterprise
  const byEnterprise = {};
  allMeasurements.forEach(m => {
    m.enterprises.forEach(ent => {
      if (!byEnterprise[ent]) byEnterprise[ent] = [];
      byEnterprise[ent].push(m);
    });
  });

  // Analyze each enterprise
  const discovered = {};
  for (const [enterprise, measurements] of Object.entries(byEnterprise)) {
    discovered[enterprise] = analyzeEnterpriseOEE(enterprise, measurements);
  }

  oeeConfig.enterprises = discovered;
  console.log('[OEE] Discovery complete:', Object.keys(discovered).map(e =>
    `${e}: Tier ${discovered[e].tier}`).join(', '));

  return discovered;
}

/**
 * Analyzes a single enterprise's measurements to determine OEE calculation tier.
 *
 * @param {string} enterprise - Enterprise name
 * @param {Array} measurements - Array of measurement metadata objects
 * @returns {Object} OEE configuration for this enterprise
 */
function analyzeEnterpriseOEE(enterprise, measurements) {
  const found = { overall: null, availability: null, performance: null, quality: null };

  for (const measurement of measurements) {
    const name = measurement.name;
    if (OEE_PATTERNS.overall.some(p => p.test(name))) found.overall = name;
    if (OEE_PATTERNS.availability.some(p => p.test(name))) found.availability = name;
    if (OEE_PATTERNS.performance.some(p => p.test(name))) found.performance = name;
    if (OEE_PATTERNS.quality.some(p => p.test(name))) found.quality = name;
  }

  let tier, confidence, reason;
  if (found.overall) {
    tier = 1; confidence = 0.95;
    reason = `Using pre-computed OEE from ${found.overall}`;
  } else if (found.availability && found.performance && found.quality) {
    tier = 2; confidence = 0.90;
    reason = 'Calculating from A x P x Q components';
  } else {
    tier = 4; confidence = 0.0;
    reason = 'Insufficient OEE data available';
  }

  // Infer value format (NOTE: This is a hint only, actual normalization uses runtime detection)
  let valueFormat = 'unknown';
  const oeeRelated = measurements.filter(m =>
    m.name === found.overall || m.name === found.availability ||
    m.name === found.performance || m.name === found.quality
  );
  for (const m of oeeRelated) {
    if (m.sampleValues?.length > 0) {
      console.log(`[OEE Discovery] ${enterprise} - ${m.name} sampleValues:`, m.sampleValues);
      if (m.sampleValues.every(v => typeof v === 'number' && v <= 1.5)) {
        valueFormat = 'decimal'; break;
      }
      if (m.sampleValues.some(v => typeof v === 'number' && v > 1.5)) {
        valueFormat = 'percentage'; break;
      }
    }
  }

  console.log(`[OEE Discovery] ${enterprise}: Tier ${tier}, valueFormat="${valueFormat}", measurements=`, found);

  return {
    tier,
    measurements: found,
    valueFormat,
    sites: [...new Set(measurements.flatMap(m => m.sites || []))],
    lastDiscovery: new Date().toISOString(),
    confidence,
    reason
  };
}

// =============================================================================
// PHASE 3: TIER 1 & 2 OEE CALCULATORS
// =============================================================================

/**
 * Main OEE calculation function using tiered strategy
 * @param {string} enterprise - Enterprise name
 * @param {string|null} site - Optional site filter
 * @returns {Promise<Object>} OEE result with calculation metadata
 */
async function calculateOEEv2(enterprise, site = null) {
  const requestId = Math.random().toString(36).substring(2, 8);
  console.log(`[OEE:${requestId}] calculateOEEv2 called for enterprise="${enterprise}", site="${site}"`);

  // Run discovery if not done yet
  if (Object.keys(oeeConfig.enterprises).length === 0) {
    console.log(`[OEE:${requestId}] No cached config, running discovery...`);
    await discoverOEESchema();
  }

  const config = oeeConfig.enterprises[enterprise];
  if (!config) {
    console.log(`[OEE:${requestId}] Enterprise not found in schema`);
    return createOEEResult(enterprise, site, null, null, 4, 'Enterprise not found in schema');
  }

  console.log(`[OEE:${requestId}] Using Tier ${config.tier}, valueFormat="${config.valueFormat}", measurements:`, config.measurements);

  switch (config.tier) {
    case 1: return await calculateTier1(enterprise, site, config, requestId);
    case 2: return await calculateTier2(enterprise, site, config, requestId);
    default: return createOEEResult(enterprise, site, null, null, 4, config.reason);
  }
}

/**
 * Tier 1: Use pre-computed overall OEE
 * Also queries A/P/Q components if available for diagnostic purposes
 */
async function calculateTier1(enterprise, site, config, requestId = 'unknown') {
  const measurement = config.measurements.overall;

  const fluxQuery = `
    from(bucket: "${CONFIG.influxdb.bucket}")
      |> range(start: -24h)
      |> filter(fn: (r) => r._field == "value")
      |> filter(fn: (r) => r._measurement == "${sanitizeInfluxIdentifier(measurement)}")
      |> filter(fn: (r) => r.enterprise == "${enterprise}")
      ${site ? `|> filter(fn: (r) => r.site == "${site}")` : ''}
      |> filter(fn: (r) => r._value > 0)
      |> group()
      |> mean()
  `;

  let oeeValue = null;
  let rawOeeValue = null;
  let dataPoints = 0;

  await new Promise((resolve) => {
    queryApi.queryRows(fluxQuery, {
      next(row, tableMeta) {
        const o = tableMeta.toObject(row);
        if (o._value !== undefined) {
          oeeValue = o._value;
          rawOeeValue = o._value;
          dataPoints++;
        }
      },
      error(error) {
        console.error(`[OEE:${requestId}] Tier 1 OEE query error for ${enterprise}:`, error.message);
        resolve();
      },
      complete() { resolve(); }
    });
  });

  console.log(`[OEE:${requestId}] Tier 1 raw OEE value: ${rawOeeValue}, cached valueFormat: ${config.valueFormat}`);

  // ROBUST NORMALIZATION: Detect format from actual value, not cached config
  // Values <= 1.5 are decimal (0.72 = 72%), values > 1.5 are already percentages
  const actualFormat = (oeeValue !== null && oeeValue <= 1.5) ? 'decimal' : 'percentage';
  if (oeeValue !== null && actualFormat === 'decimal') {
    oeeValue = oeeValue * 100;
    console.log(`[OEE:${requestId}] Detected decimal format (raw=${rawOeeValue}), normalized to ${oeeValue}%`);
  } else if (oeeValue !== null) {
    console.log(`[OEE:${requestId}] Detected percentage format (raw=${rawOeeValue}), no normalization needed`);
  }
  if (oeeValue !== null) {
    oeeValue = Math.min(100, Math.max(0, oeeValue));
  }

  // Query A/P/Q components if available (for diagnostic purposes)
  let components = null;
  const measurementsUsed = [measurement];
  const { availability: availMeasure, performance: perfMeasure, quality: qualMeasure } = config.measurements;

  if (availMeasure && perfMeasure && qualMeasure) {
    const queryComponent = async (componentMeasurement, componentName) => {
      const componentQuery = `
        from(bucket: "${CONFIG.influxdb.bucket}")
          |> range(start: -24h)
          |> filter(fn: (r) => r._field == "value")
          |> filter(fn: (r) => r._measurement == "${sanitizeInfluxIdentifier(componentMeasurement)}")
          |> filter(fn: (r) => r.enterprise == "${enterprise}")
          ${site ? `|> filter(fn: (r) => r.site == "${site}")` : ''}
          |> filter(fn: (r) => r._value > 0)
          |> group()
          |> mean()
      `;

      return new Promise((resolve) => {
        let value = null;
        queryApi.queryRows(componentQuery, {
          next(row, tableMeta) {
            const o = tableMeta.toObject(row);
            if (o._value !== undefined) value = o._value;
          },
          error(error) {
            console.error(`[OEE:${requestId}] Tier 1 component query error for ${componentMeasurement}:`, error.message);
            resolve(null);
          },
          complete() {
            console.log(`[OEE:${requestId}] Tier 1 ${componentName} raw value: ${value}`);
            resolve(value);
          }
        });
      });
    };

    // Query all components in parallel
    const [availability, performance, quality] = await Promise.all([
      queryComponent(availMeasure, 'availability'),
      queryComponent(perfMeasure, 'performance'),
      queryComponent(qualMeasure, 'quality')
    ]);

    // ROBUST NORMALIZATION: Detect format from actual value, not cached config
    const normalize = (val, componentName) => {
      if (val === null) return null;
      // Values <= 1.5 are decimal (0.72 = 72%), values > 1.5 are already percentages
      const isDecimal = val <= 1.5;
      let normalized = isDecimal ? val * 100 : val;
      console.log(`[OEE:${requestId}] ${componentName}: raw=${val}, isDecimal=${isDecimal}, normalized=${normalized}`);
      return Math.min(100, Math.max(0, normalized));
    };

    const normAvail = normalize(availability, 'availability');
    const normPerf = normalize(performance, 'performance');
    const normQual = normalize(quality, 'quality');

    // Only include components if at least one was found
    if (normAvail !== null || normPerf !== null || normQual !== null) {
      components = {
        availability: normAvail !== null ? parseFloat(normAvail.toFixed(1)) : null,
        performance: normPerf !== null ? parseFloat(normPerf.toFixed(1)) : null,
        quality: normQual !== null ? parseFloat(normQual.toFixed(1)) : null
      };
      measurementsUsed.push(availMeasure, perfMeasure, qualMeasure);
      dataPoints += 3;
    }
  }

  console.log(`[OEE:${requestId}] Tier 1 final result: OEE=${oeeValue}, components=`, components);

  return createOEEResult(enterprise, site, oeeValue, components, 1, config.reason, {
    measurementsUsed,
    dataPoints
  });
}

/**
 * Tier 2: Calculate from A x P x Q components
 */
async function calculateTier2(enterprise, site, config, requestId = 'unknown') {
  const { availability: availMeasure, performance: perfMeasure, quality: qualMeasure } = config.measurements;

  const queryComponent = async (measurement, componentName) => {
    const fluxQuery = `
      from(bucket: "${CONFIG.influxdb.bucket}")
        |> range(start: -24h)
        |> filter(fn: (r) => r._field == "value")
        |> filter(fn: (r) => r._measurement == "${sanitizeInfluxIdentifier(measurement)}")
        |> filter(fn: (r) => r.enterprise == "${enterprise}")
        ${site ? `|> filter(fn: (r) => r.site == "${site}")` : ''}
        |> filter(fn: (r) => r._value > 0)
        |> group()
        |> mean()
    `;

    return new Promise((resolve) => {
      let value = null;
      queryApi.queryRows(fluxQuery, {
        next(row, tableMeta) {
          const o = tableMeta.toObject(row);
          if (o._value !== undefined) value = o._value;
        },
        error(error) {
          console.error(`[OEE:${requestId}] Component query error for ${measurement}:`, error.message);
          resolve(null);
        },
        complete() {
          console.log(`[OEE:${requestId}] Tier 2 ${componentName} raw value: ${value}`);
          resolve(value);
        }
      });
    });
  };

  // Query all components in parallel
  const [availability, performance, quality] = await Promise.all([
    queryComponent(availMeasure, 'availability'),
    queryComponent(perfMeasure, 'performance'),
    queryComponent(qualMeasure, 'quality')
  ]);

  console.log(`[OEE:${requestId}] Tier 2 raw values: A=${availability}, P=${performance}, Q=${quality}`);

  // ROBUST NORMALIZATION: Detect format from actual value, not cached config
  const normalize = (val, componentName) => {
    if (val === null) return null;
    // Values <= 1.5 are decimal (0.72 = 72%), values > 1.5 are already percentages
    const isDecimal = val <= 1.5;
    let normalized = isDecimal ? val * 100 : val;
    console.log(`[OEE:${requestId}] ${componentName}: raw=${val}, isDecimal=${isDecimal}, normalized=${normalized}`);
    return Math.min(100, Math.max(0, normalized));
  };

  const normAvail = normalize(availability, 'availability');
  const normPerf = normalize(performance, 'performance');
  const normQual = normalize(quality, 'quality');

  // Calculate OEE = A x P x Q
  let oeeValue = null;
  if (normAvail !== null && normPerf !== null && normQual !== null) {
    oeeValue = (normAvail / 100) * (normPerf / 100) * (normQual / 100) * 100;
    console.log(`[OEE:${requestId}] Tier 2 calculated OEE: (${normAvail}/100) * (${normPerf}/100) * (${normQual}/100) * 100 = ${oeeValue}`);
  }

  console.log(`[OEE:${requestId}] Tier 2 final result: OEE=${oeeValue}`);

  return createOEEResult(enterprise, site, oeeValue, {
    availability: normAvail !== null ? parseFloat(normAvail.toFixed(1)) : null,
    performance: normPerf !== null ? parseFloat(normPerf.toFixed(1)) : null,
    quality: normQual !== null ? parseFloat(normQual.toFixed(1)) : null
  }, 2, config.reason, {
    measurementsUsed: [availMeasure, perfMeasure, qualMeasure],
    dataPoints: 3
  });
}

/**
 * Creates a standardized OEE result object
 */
function createOEEResult(enterprise, site, oee, components, tier, reason, meta = {}) {
  return {
    enterprise,
    site,
    oee: oee !== null ? parseFloat(oee.toFixed(1)) : null,
    components,
    calculation: {
      tier,
      tierName: OEE_TIERS[tier],
      method: reason,
      measurementsUsed: meta.measurementsUsed || [],
      dataPoints: meta.dataPoints || 0,
      timeRange: { start: '-24h', end: 'now()' }
    },
    quality: {
      confidence: oee !== null ? (tier === 1 ? 0.95 : tier === 2 ? 0.90 : 0.0) : 0.0,
      status: oee !== null ? 'good' : 'unavailable'
    },
    timestamp: new Date().toISOString()
  };
}

// =============================================================================
// OEE QUERY FUNCTIONS (LEGACY API SUPPORT)
// =============================================================================

/**
 * Query 24h OEE aggregate for a specific enterprise or all enterprises
 * Delegates to calculateOEEv2 for correct tier-based calculation
 * @param {string} enterprise - Enterprise name or 'ALL'
 * @returns {Promise<Object>} OEE data
 */
async function queryOEE(enterprise) {
  // For 'ALL' enterprises, calculate the average of per-enterprise OEEs
  if (enterprise === 'ALL') {
    const breakdown = await queryOEEBreakdown();
    const enterprises = Object.values(breakdown.data);

    // Filter out enterprises with null OEE
    const validEnterprises = enterprises.filter(e => e.oee !== null && e.oee !== undefined);

    if (validEnterprises.length === 0) {
      return { average: null, period: '24h', enterprise: 'ALL', dataPoints: 0 };
    }

    const sum = validEnterprises.reduce((acc, e) => acc + e.oee, 0);
    const avg = sum / validEnterprises.length;

    return {
      average: parseFloat(avg.toFixed(1)),
      period: '24h',
      enterprise: 'ALL',
      dataPoints: validEnterprises.length
    };
  }

  // For specific enterprise, delegate to calculateOEEv2
  const result = await calculateOEEv2(enterprise);

  return {
    average: result.oee,
    period: '24h',
    enterprise,
    dataPoints: result.calculation?.dataPoints || 0
  };
}

/**
 * Query OEE breakdown by enterprise for the last 24 hours
 * Delegates to calculateOEEv2 for each enterprise
 * @returns {Promise<Object>} OEE data grouped by enterprise
 */
async function queryOEEBreakdown() {
  // Known enterprises (exclude Enterprise C as it uses ISA-88 batch control)
  const enterprises = ['Enterprise A', 'Enterprise B'];
  const data = {};

  // Query each enterprise using calculateOEEv2
  await Promise.all(
    enterprises.map(async (enterprise) => {
      try {
        const result = await calculateOEEv2(enterprise);
        if (result && result.oee !== null) {
          data[enterprise] = {
            oee: result.oee,
            dataPoints: result.calculation?.dataPoints || 0
          };
        }
      } catch (error) {
        console.error(`OEE breakdown error for ${enterprise}:`, error);
      }
    })
  );

  return {
    period: '24h',
    data
  };
}

/**
 * Query factory status with hierarchical enterprise/site OEE
 * @param {string} enterprise - Enterprise filter or 'ALL' (default: 'ALL')
 * @returns {Promise<Object>} Hierarchical OEE data
 */
async function queryFactoryStatus(enterprise = 'ALL') {
  // Build enterprise filter for Flux query
  const enterpriseFilter = (enterprise && enterprise !== 'ALL')
    ? `|> filter(fn: (r) => r.enterprise == "${sanitizeInfluxIdentifier(enterprise)}")`
    : '';

  // Use pivot-based query to get OEE + A/P/Q components separately (not blended)
  // This mirrors the correct approach from /api/oee/lines endpoint
  const fluxQuery = `
    from(bucket: "${CONFIG.influxdb.bucket}")
      |> range(start: -24h)
      |> filter(fn: (r) => r._field == "value")
      |> filter(fn: (r) =>
        r._measurement == "OEE_Performance" or
        r._measurement == "OEE_Availability" or
        r._measurement == "OEE_Quality" or
        r._measurement == "metric_oee" or
        r._measurement == "metric_availability" or
        r._measurement == "metric_performance" or
        r._measurement == "metric_quality"
      )
      |> filter(fn: (r) => r._value > 0 and r._value <= 150)
      ${enterpriseFilter}
      |> filter(fn: (r) => r.enterprise != "Enterprise C")
      |> group(columns: ["enterprise", "site", "_measurement"])
      |> mean()
      |> group(columns: ["enterprise", "site"])
      |> pivot(rowKey: ["enterprise", "site"], columnKey: ["_measurement"], valueColumn: "_value")
  `;

  return new Promise((resolve) => {
    const sitesData = [];

    queryApi.queryRows(fluxQuery, {
      next(row, tableMeta) {
        const o = tableMeta.toObject(row);
        if (o.enterprise && o.site) {
          // Normalize value to percentage (handle both decimal 0-1 and percentage 0-100)
          const normalize = (val) => {
            if (val === undefined || val === null) return null;
            if (val > 0 && val <= 1.5) val = val * 100;
            return parseFloat(Math.min(100, Math.max(0, val)).toFixed(1));
          };

          // Extract values from either naming convention
          const availability = normalize(o.OEE_Availability ?? o.metric_availability);
          const performance = normalize(o.OEE_Performance ?? o.metric_performance);
          const quality = normalize(o.OEE_Quality ?? o.metric_quality);
          let oee = normalize(o.metric_oee);

          // Calculate OEE from components if not directly available
          if (oee === null && availability !== null && performance !== null && quality !== null) {
            oee = parseFloat(((availability / 100) * (performance / 100) * (quality / 100) * 100).toFixed(1));
          }

          // Skip sites with no OEE data
          if (oee === null && availability === null && performance === null && quality === null) {
            return;
          }

          sitesData.push({
            enterprise: o.enterprise,
            site: o.site,
            oee,
            availability,
            performance,
            quality
          });
        }
      },
      error(error) {
        console.error('InfluxDB factory status query error:', error);
        resolve({ enterprises: [], error: error.message });
      },
      complete() {
        // Group sites by enterprise and calculate enterprise-level OEE
        const enterpriseMap = {};

        sitesData.forEach(site => {
          if (!enterpriseMap[site.enterprise]) {
            enterpriseMap[site.enterprise] = {
              name: site.enterprise,
              sites: [],
              totalOee: 0,
              count: 0
            };
          }

          const enterprise = enterpriseMap[site.enterprise];
          const siteObj = {
            name: site.site,
            oee: site.oee,
            status: site.oee !== null ? (site.oee >= 80 ? 'healthy' : site.oee >= 60 ? 'warning' : 'critical') : 'unknown'
          };

          // Include A/P/Q if available
          if (site.availability !== null || site.performance !== null || site.quality !== null) {
            siteObj.availability = site.availability;
            siteObj.performance = site.performance;
            siteObj.quality = site.quality;
          }

          enterprise.sites.push(siteObj);

          // Only include sites with non-null OEE in enterprise average
          if (site.oee !== null) {
            enterprise.totalOee += site.oee;
            enterprise.count++;
          }
        });

        // Calculate average OEE per enterprise and determine status
        const enterprises = Object.values(enterpriseMap).map(ent => {
          const avgOee = ent.count > 0 ? ent.totalOee / ent.count : null;
          return {
            name: ent.name,
            oee: avgOee !== null ? parseFloat(avgOee.toFixed(1)) : null,
            status: avgOee !== null ? (avgOee >= 80 ? 'healthy' : avgOee >= 60 ? 'warning' : 'critical') : 'unknown',
            sites: ent.sites
          };
        });

        resolve({ enterprises });
      }
    });
  });
}

module.exports = {
  OEE_TIERS,
  OEE_PATTERNS,
  oeeConfig,
  discoverOEESchema,
  analyzeEnterpriseOEE,
  calculateOEEv2,
  createOEEResult,
  queryOEE,
  queryOEEBreakdown,
  queryFactoryStatus
};
