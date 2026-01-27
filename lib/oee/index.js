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

  // Infer value format
  let valueFormat = 'unknown';
  const oeeRelated = measurements.filter(m =>
    m.name === found.overall || m.name === found.availability ||
    m.name === found.performance || m.name === found.quality
  );
  for (const m of oeeRelated) {
    if (m.sampleValues?.length > 0) {
      if (m.sampleValues.every(v => typeof v === 'number' && v <= 1.5)) {
        valueFormat = 'decimal'; break;
      }
      if (m.sampleValues.some(v => typeof v === 'number' && v > 1.5)) {
        valueFormat = 'percentage'; break;
      }
    }
  }

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
  // Run discovery if not done yet
  if (Object.keys(oeeConfig.enterprises).length === 0) {
    await discoverOEESchema();
  }

  const config = oeeConfig.enterprises[enterprise];
  if (!config) {
    return createOEEResult(enterprise, site, null, null, 4, 'Enterprise not found in schema');
  }

  switch (config.tier) {
    case 1: return await calculateTier1(enterprise, site, config);
    case 2: return await calculateTier2(enterprise, site, config);
    default: return createOEEResult(enterprise, site, null, null, 4, config.reason);
  }
}

/**
 * Tier 1: Use pre-computed overall OEE
 * Also queries A/P/Q components if available for diagnostic purposes
 */
async function calculateTier1(enterprise, site, config) {
  const measurement = config.measurements.overall;

  const fluxQuery = `
    from(bucket: "${CONFIG.influxdb.bucket}")
      |> range(start: -24h)
      |> filter(fn: (r) => r._field == "value")
      |> filter(fn: (r) => r._measurement == "${sanitizeInfluxIdentifier(measurement)}")
      |> filter(fn: (r) => r.enterprise == "${enterprise}")
      ${site ? `|> filter(fn: (r) => r.site == "${site}")` : ''}
      |> filter(fn: (r) => r._value > 0)
      |> mean()
  `;

  let oeeValue = null;
  let dataPoints = 0;

  await new Promise((resolve) => {
    queryApi.queryRows(fluxQuery, {
      next(row, tableMeta) {
        const o = tableMeta.toObject(row);
        if (o._value !== undefined) {
          oeeValue = o._value;
          dataPoints++;
        }
      },
      error(error) {
        console.error(`Tier 1 OEE query error for ${enterprise}:`, error.message);
        resolve();
      },
      complete() { resolve(); }
    });
  });

  // Normalize to percentage
  if (oeeValue !== null && config.valueFormat === 'decimal') {
    oeeValue = oeeValue * 100;
  }
  if (oeeValue !== null) {
    oeeValue = Math.min(100, Math.max(0, oeeValue));
  }

  // Query A/P/Q components if available (for diagnostic purposes)
  let components = null;
  const measurementsUsed = [measurement];
  const { availability: availMeasure, performance: perfMeasure, quality: qualMeasure } = config.measurements;

  if (availMeasure && perfMeasure && qualMeasure) {
    const queryComponent = async (componentMeasurement) => {
      const componentQuery = `
        from(bucket: "${CONFIG.influxdb.bucket}")
          |> range(start: -24h)
          |> filter(fn: (r) => r._field == "value")
          |> filter(fn: (r) => r._measurement == "${sanitizeInfluxIdentifier(componentMeasurement)}")
          |> filter(fn: (r) => r.enterprise == "${enterprise}")
          ${site ? `|> filter(fn: (r) => r.site == "${site}")` : ''}
          |> filter(fn: (r) => r._value > 0)
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
            console.error(`Tier 1 component query error for ${componentMeasurement}:`, error.message);
            resolve(null);
          },
          complete() { resolve(value); }
        });
      });
    };

    // Query all components in parallel
    const [availability, performance, quality] = await Promise.all([
      queryComponent(availMeasure),
      queryComponent(perfMeasure),
      queryComponent(qualMeasure)
    ]);

    // Normalize to percentages
    const normalize = (val) => {
      if (val === null) return null;
      let normalized = val;
      if (config.valueFormat === 'decimal') normalized = normalized * 100;
      return Math.min(100, Math.max(0, normalized));
    };

    const normAvail = normalize(availability);
    const normPerf = normalize(performance);
    const normQual = normalize(quality);

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

  return createOEEResult(enterprise, site, oeeValue, components, 1, config.reason, {
    measurementsUsed,
    dataPoints
  });
}

/**
 * Tier 2: Calculate from A x P x Q components
 */
async function calculateTier2(enterprise, site, config) {
  const { availability: availMeasure, performance: perfMeasure, quality: qualMeasure } = config.measurements;

  const queryComponent = async (measurement) => {
    const fluxQuery = `
      from(bucket: "${CONFIG.influxdb.bucket}")
        |> range(start: -24h)
        |> filter(fn: (r) => r._field == "value")
        |> filter(fn: (r) => r._measurement == "${sanitizeInfluxIdentifier(measurement)}")
        |> filter(fn: (r) => r.enterprise == "${enterprise}")
        ${site ? `|> filter(fn: (r) => r.site == "${site}")` : ''}
        |> filter(fn: (r) => r._value > 0)
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
          console.error(`Component query error for ${measurement}:`, error.message);
          resolve(null);
        },
        complete() { resolve(value); }
      });
    });
  };

  // Query all components in parallel
  const [availability, performance, quality] = await Promise.all([
    queryComponent(availMeasure),
    queryComponent(perfMeasure),
    queryComponent(qualMeasure)
  ]);

  // Normalize to percentages
  const normalize = (val) => {
    if (val === null) return null;
    if (config.valueFormat === 'decimal') val = val * 100;
    return Math.min(100, Math.max(0, val));
  };

  const normAvail = normalize(availability);
  const normPerf = normalize(performance);
  const normQual = normalize(quality);

  // Calculate OEE = A x P x Q
  let oeeValue = null;
  if (normAvail !== null && normPerf !== null && normQual !== null) {
    oeeValue = (normAvail / 100) * (normPerf / 100) * (normQual / 100) * 100;
  }

  return createOEEResult(enterprise, site, oeeValue, {
    availability: normAvail ? parseFloat(normAvail.toFixed(1)) : null,
    performance: normPerf ? parseFloat(normPerf.toFixed(1)) : null,
    quality: normQual ? parseFloat(normQual.toFixed(1)) : null
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
 * @param {string} enterprise - Enterprise name or 'ALL'
 * @returns {Promise<Object>} OEE data
 */
async function queryOEE(enterprise) {
  // For 'ALL' enterprises, calculate the average of per-enterprise OEEs
  // This prevents data points from high-volume enterprises (Enterprise B)
  // from overwhelming low-volume enterprises (Enterprise A)
  if (enterprise === 'ALL') {
    const breakdown = await queryOEEBreakdown();
    const enterprises = Object.values(breakdown.data);

    if (enterprises.length === 0) {
      return { average: null, period: '24h', enterprise: 'ALL', dataPoints: 0 };
    }

    const sum = enterprises.reduce((acc, e) => acc + e.oee, 0);
    const avg = sum / enterprises.length;

    return {
      average: parseFloat(avg.toFixed(1)),
      period: '24h',
      enterprise: 'ALL',
      dataPoints: enterprises.length
    };
  }

  // For specific enterprise, query that enterprise's average OEE
  const fluxQuery = `
    from(bucket: "${CONFIG.influxdb.bucket}")
      |> range(start: -24h)
      |> filter(fn: (r) => r._field == "value")
      |> filter(fn: (r) =>
        r._measurement == "OEE_Performance" or
        r._measurement == "OEE_Availability" or
        r._measurement == "OEE_Quality" or
        r._measurement == "metric_oee"
      )
      |> filter(fn: (r) => r._value > 0.1 and r._value <= 150)
      |> filter(fn: (r) => r.enterprise == "Enterprise ${enterprise}")
      |> group()
      |> mean()
      |> yield(name: "mean_oee")
  `;

  return new Promise((resolve) => {
    let avgOee = null;
    let count = 0;

    queryApi.queryRows(fluxQuery, {
      next(row, tableMeta) {
        const o = tableMeta.toObject(row);
        if (o._value !== undefined) {
          let oee = o._value;
          // Convert decimal format (0-1.5) to percentage (0-100)
          if (oee > 0 && oee <= 1.5) {
            oee = oee * 100;
          }
          // Clamp to valid range (0-100)
          avgOee = Math.min(100, Math.max(0, oee));
          count++;
        }
      },
      error(error) {
        console.error('InfluxDB OEE query error:', error);
        resolve({ average: null, period: '24h', enterprise, error: error.message });
      },
      complete() {
        resolve({
          average: avgOee !== null ? parseFloat(avgOee.toFixed(1)) : null,
          period: '24h',
          enterprise,
          dataPoints: count
        });
      }
    });
  });
}

/**
 * Query OEE breakdown by enterprise for the last 24 hours
 * @returns {Promise<Object>} OEE data grouped by enterprise
 */
async function queryOEEBreakdown() {
  // Query OEE grouped by enterprise for the last 24 hours
  const fluxQuery = `
    from(bucket: "${CONFIG.influxdb.bucket}")
      |> range(start: -24h)
      |> filter(fn: (r) => r._field == "value")
      |> filter(fn: (r) =>
        r._measurement == "OEE_Performance" or
        r._measurement == "OEE_Availability" or
        r._measurement == "OEE_Quality" or
        r._measurement == "metric_oee"
      )
      |> filter(fn: (r) => r._value > 0.1 and r._value <= 150)
      |> filter(fn: (r) => r.enterprise != "Enterprise C")
      |> group(columns: ["enterprise"])
      |> mean()
      |> yield(name: "mean_oee_by_enterprise")
  `;

  return new Promise((resolve) => {
    const data = {};

    queryApi.queryRows(fluxQuery, {
      next(row, tableMeta) {
        const o = tableMeta.toObject(row);
        if (o._value !== undefined && o.enterprise) {
          let oee = o._value;
          // Convert decimal format (0-1.5) to percentage (0-100)
          if (oee > 0 && oee <= 1.5) {
            oee = oee * 100;
          }
          // Clamp to valid range (0-100)
          oee = Math.min(100, Math.max(0, oee));
          data[o.enterprise] = {
            oee: parseFloat(oee.toFixed(1)),
            dataPoints: 1 // InfluxDB groups and averages, so this is just an indicator
          };
        }
      },
      error(error) {
        console.error('InfluxDB OEE breakdown query error:', error);
        resolve({ period: '24h', data: {}, error: error.message });
      },
      complete() {
        resolve({
          period: '24h',
          data
        });
      }
    });
  });
}

/**
 * Query factory status with hierarchical enterprise/site OEE
 * @returns {Promise<Object>} Hierarchical OEE data
 */
async function queryFactoryStatus() {
  // Query OEE grouped by enterprise AND site for the last 24 hours
  const fluxQuery = `
    from(bucket: "${CONFIG.influxdb.bucket}")
      |> range(start: -24h)
      |> filter(fn: (r) => r._field == "value")
      |> filter(fn: (r) =>
        r._measurement == "OEE_Performance" or
        r._measurement == "OEE_Availability" or
        r._measurement == "OEE_Quality" or
        r._measurement == "metric_oee"
      )
      |> filter(fn: (r) => r._value > 0.1 and r._value <= 150)
      |> filter(fn: (r) => r.enterprise != "Enterprise C")
      |> group(columns: ["enterprise", "site"])
      |> mean()
      |> yield(name: "mean_oee_by_enterprise_site")
  `;

  return new Promise((resolve) => {
    const sitesData = [];

    queryApi.queryRows(fluxQuery, {
      next(row, tableMeta) {
        const o = tableMeta.toObject(row);
        if (o._value !== undefined && o.enterprise && o.site) {
          let oee = o._value;
          // Convert decimal format (0-1.5) to percentage (0-100)
          if (oee > 0 && oee <= 1.5) {
            oee = oee * 100;
          }
          // Clamp to valid range (0-100)
          oee = Math.min(100, Math.max(0, oee));
          sitesData.push({
            enterprise: o.enterprise,
            site: o.site,
            oee: parseFloat(oee.toFixed(1))
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
          enterprise.sites.push({
            name: site.site,
            oee: site.oee,
            status: site.oee >= 80 ? 'healthy' : site.oee >= 60 ? 'warning' : 'critical'
          });
          enterprise.totalOee += site.oee;
          enterprise.count++;
        });

        // Calculate average OEE per enterprise and determine status
        const enterprises = Object.values(enterpriseMap).map(ent => {
          const avgOee = ent.totalOee / ent.count;
          return {
            name: ent.name,
            oee: parseFloat(avgOee.toFixed(1)),
            status: avgOee >= 80 ? 'healthy' : avgOee >= 60 ? 'warning' : 'critical',
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
