// lib/trends/index.js - Trend Analysis & Prediction Module

const { queryApi } = require('../influx/client');
const CONFIG = require('../config');
const { sanitizeInfluxIdentifier } = require('../validation');

/**
 * Time window configurations for trend analysis
 * Defines query ranges, aggregation intervals, and forecast windows
 */
const TIME_WINDOWS = {
  hourly: {
    range: '-1h',
    aggregation: '5m',
    buckets: 12,
    futureWindow: '15m',
    futureBuckets: 3
  },
  shift: {
    range: '-8h',
    aggregation: '30m',
    buckets: 16,
    futureWindow: '1h',
    futureBuckets: 2
  },
  daily: {
    range: '-24h',
    aggregation: '1h',
    buckets: 24,
    futureWindow: '3h',
    futureBuckets: 3
  },
  weekly: {
    range: '-7d',
    aggregation: '6h',
    buckets: 28,
    futureWindow: '12h',
    futureBuckets: 2
  }
};

/**
 * Validate and normalize time window parameter
 */
function validateTimeWindow(window) {
  const validWindows = Object.keys(TIME_WINDOWS);
  if (!window || !validWindows.includes(window)) {
    return 'shift'; // Default per user decision
  }
  return window;
}

/**
 * Calculate linear regression for time-series data
 * @param {Array} dataPoints - Array of {timestamp, value} objects
 * @returns {Object} {slope, intercept, r2, count}
 */
function calculateLinearRegression(dataPoints) {
  if (!dataPoints || dataPoints.length < 2) {
    return { slope: 0, intercept: 0, r2: 0, count: 0 };
  }

  const n = dataPoints.length;
  const x = dataPoints.map((_, i) => i); // Time index
  const y = dataPoints.map(d => d.value);

  // Calculate sums
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.map((xi, i) => xi * y[i]).reduce((a, b) => a + b, 0);
  const sumX2 = x.map(xi => xi * xi).reduce((a, b) => a + b, 0);

  // Calculate slope and intercept
  const denominator = (n * sumX2 - sumX * sumX);
  if (denominator === 0) {
    return { slope: 0, intercept: sumY / n, r2: 0, count: n };
  }

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  // Calculate R² for confidence
  const yMean = sumY / n;
  const ssTotal = y.map(yi => Math.pow(yi - yMean, 2)).reduce((a, b) => a + b, 0);
  const ssRes = y.map((yi, i) => Math.pow(yi - (slope * x[i] + intercept), 2)).reduce((a, b) => a + b, 0);
  const r2 = ssTotal === 0 ? 0 : 1 - (ssRes / ssTotal);

  return { slope, intercept, r2, count: n };
}

/**
 * Predict future values based on regression
 * @param {Object} regression - Linear regression parameters
 * @param {number} dataLength - Length of historical data
 * @param {number} steps - Number of future steps to predict
 * @returns {Array} Array of predicted values
 */
function predictFutureValues(regression, dataLength, steps) {
  const predictions = [];
  for (let i = 1; i <= steps; i++) {
    const x = dataLength + i - 1;
    const predicted = regression.slope * x + regression.intercept;
    predictions.push({
      value: Math.max(0, predicted), // Prevent negative predictions
      confidence: Math.max(0, regression.r2) // R² as confidence metric
    });
  }
  return predictions;
}

/**
 * Determine trend direction from regression slope
 * @param {number} slope - Regression slope
 * @param {number} threshold - Minimum slope to consider rising/falling
 * @returns {string} 'rising', 'falling', or 'stable'
 */
function determineTrend(slope, threshold = 0.05) {
  if (Math.abs(slope) < threshold) return 'stable';
  return slope > 0 ? 'rising' : 'falling';
}

/**
 * Query trend data from InfluxDB with dynamic time window
 * @param {string} measurement - Measurement name
 * @param {string} window - Time window key
 * @param {string} enterprise - Enterprise filter
 * @param {string} site - Optional site filter
 * @returns {Promise<Array>} Time-series data points
 */
async function queryTrendData(measurement, window, enterprise, site = null) {
  const windowConfig = TIME_WINDOWS[validateTimeWindow(window)];
  const enterpriseFilter = enterprise && enterprise !== 'ALL'
    ? `|> filter(fn: (r) => r.enterprise == "${sanitizeInfluxIdentifier(enterprise)}")`
    : '';
  const siteFilter = site
    ? `|> filter(fn: (r) => r.site == "${sanitizeInfluxIdentifier(site)}")`
    : '';

  const fluxQuery = `
    from(bucket: "${CONFIG.influxdb.bucket}")
      |> range(start: ${windowConfig.range})
      |> filter(fn: (r) => r._field == "value")
      |> filter(fn: (r) => r._measurement == "${sanitizeInfluxIdentifier(measurement)}")
      ${enterpriseFilter}
      ${siteFilter}
      |> filter(fn: (r) => r._value > 0)
      |> aggregateWindow(every: ${windowConfig.aggregation}, fn: mean, createEmpty: false)
      |> sort(columns: ["_time"])
  `;

  const results = [];
  await new Promise((resolve) => {
    queryApi.queryRows(fluxQuery, {
      next(row, tableMeta) {
        const o = tableMeta.toObject(row);
        results.push({
          timestamp: o._time,
          value: o._value
        });
      },
      error(error) {
        console.error('[TRENDS] Query error:', error);
        resolve();
      },
      complete() {
        resolve();
      }
    });
  });

  return results;
}

/**
 * Calculate downtime Pareto analysis
 * @param {string} enterprise - Enterprise filter
 * @param {string} window - Time window
 * @param {number} limit - Top N contributors
 * @returns {Promise<Object>} Pareto analysis results
 */
async function calculateDowntimePareto(enterprise = 'ALL', window = 'daily', limit = 10) {
  const windowConfig = TIME_WINDOWS[validateTimeWindow(window)];
  const enterpriseFilter = enterprise && enterprise !== 'ALL'
    ? `|> filter(fn: (r) => r.enterprise == "${sanitizeInfluxIdentifier(enterprise)}")`
    : '';

  // Query equipment states (looking for DOWN and IDLE states)
  const fluxQuery = `
    import "strings"

    from(bucket: "${CONFIG.influxdb.bucket}")
      |> range(start: ${windowConfig.range})
      |> filter(fn: (r) => r._field == "value")
      |> filter(fn: (r) => strings.containsStr(v: r._measurement, substr: "state") or
                          strings.containsStr(v: r._measurement, substr: "STATE"))
      ${enterpriseFilter}
      |> filter(fn: (r) => r._value == "1" or r._value == "2" or
                          r._value == "DOWN" or r._value == "IDLE" or
                          r._value == "Down" or r._value == "Idle")
      |> group(columns: ["enterprise", "site", "machine", "area"])
      |> count()
      |> sort(columns: ["_value"], desc: true)
      |> limit(n: ${limit})
  `;

  const results = [];
  await new Promise((resolve) => {
    queryApi.queryRows(fluxQuery, {
      next(row, tableMeta) {
        const o = tableMeta.toObject(row);
        results.push({
          enterprise: o.enterprise || 'Unknown',
          site: o.site || 'Unknown',
          machine: o.machine || 'Unknown',
          area: o.area || 'Unknown',
          incidentCount: o._value || 0,
          measurement: o._measurement
        });
      },
      error(error) {
        console.error('[TRENDS] Downtime Pareto query error:', error);
        resolve();
      },
      complete() {
        resolve();
      }
    });
  });

  // Calculate total and percentages
  const totalIncidents = results.reduce((sum, r) => sum + r.incidentCount, 0);
  const paretoData = results.map((r, idx) => ({
    rank: idx + 1,
    enterprise: r.enterprise,
    site: r.site,
    machine: r.machine,
    area: r.area,
    downtimeMinutes: Math.round(r.incidentCount * 5), // Estimate: 5 min per incident
    incidentCount: r.incidentCount,
    percentOfTotal: totalIncidents > 0 ? (r.incidentCount / totalIncidents) * 100 : 0,
    downtimeType: 'unplanned',
    currentState: 'UNKNOWN'
  }));

  return {
    paretoData,
    summary: {
      totalDowntime: paretoData.reduce((sum, d) => sum + d.downtimeMinutes, 0),
      totalMachines: paretoData.length,
      topContributorsPercent: paretoData.slice(0, 3).reduce((sum, d) => sum + d.percentOfTotal, 0),
      window: validateTimeWindow(window)
    },
    timestamp: new Date().toISOString()
  };
}

/**
 * Calculate waste trend with predictions by enterprise
 * @param {string} enterprise - Enterprise filter
 * @param {string} window - Time window
 * @returns {Promise<Object>} Waste trends with predictions
 */
async function calculateWasteTrend(enterprise = 'ALL', window = 'shift') {
  const windowConfig = TIME_WINDOWS[validateTimeWindow(window)];

  // Determine which enterprises to query
  const enterprises = enterprise === 'ALL'
    ? ['Enterprise A', 'Enterprise B', 'Enterprise C']
    : [enterprise];

  const byEnterprise = {};

  for (const ent of enterprises) {
    // Query waste/defect measurements
    const wasteData = await queryTrendData('counters_defect', window, ent);

    if (wasteData.length === 0) {
      byEnterprise[ent] = {
        historical: [],
        prediction: [],
        trend: 'stable',
        alert: null
      };
      continue;
    }

    // Calculate regression
    const regression = calculateLinearRegression(wasteData);
    const trend = determineTrend(regression.slope);

    // Predict future values
    const predictions = predictFutureValues(regression, wasteData.length, windowConfig.futureBuckets);

    // Generate prediction timestamps
    const lastTimestamp = new Date(wasteData[wasteData.length - 1].timestamp);
    const predictionData = predictions.map((pred, idx) => {
      const futureTime = new Date(lastTimestamp);
      // Add time based on aggregation interval
      const intervalMinutes = windowConfig.aggregation === '5m' ? 5 :
                              windowConfig.aggregation === '30m' ? 30 :
                              windowConfig.aggregation === '1h' ? 60 : 360;
      futureTime.setMinutes(futureTime.getMinutes() + intervalMinutes * (idx + 1));

      return {
        timestamp: futureTime.toISOString(),
        value: pred.value,
        confidence: pred.confidence
      };
    });

    // Check for alert conditions
    const criticalThreshold = 1000; // Configurable threshold
    const warningThreshold = 750;
    let alert = null;

    const maxPrediction = Math.max(...predictions.map(p => p.value));
    if (maxPrediction > criticalThreshold) {
      alert = {
        severity: 'critical',
        message: `Waste predicted to exceed ${criticalThreshold} units in next ${windowConfig.futureWindow}`,
        predictedValue: maxPrediction.toFixed(0),
        threshold: criticalThreshold
      };
    } else if (maxPrediction > warningThreshold && trend === 'rising') {
      alert = {
        severity: 'warning',
        message: `Waste trending upward, approaching ${warningThreshold} unit threshold`,
        predictedValue: maxPrediction.toFixed(0),
        threshold: warningThreshold
      };
    }

    byEnterprise[ent] = {
      historical: wasteData,
      prediction: predictionData,
      trend,
      alert,
      regression: {
        slope: regression.slope.toFixed(4),
        r2: regression.r2.toFixed(3)
      }
    };
  }

  return {
    byEnterprise,
    timestamp: new Date().toISOString()
  };
}

/**
 * Calculate OEE component trends with predictions
 * @param {string} enterprise - Enterprise filter
 * @param {string} window - Time window
 * @param {string} component - Component filter (availability|performance|quality|all)
 * @returns {Promise<Object>} OEE component trends
 */
async function calculateOEEComponentTrend(enterprise = 'ALL', window = 'shift', component = 'all') {
  const windowConfig = TIME_WINDOWS[validateTimeWindow(window)];
  const components = component === 'all'
    ? ['availability', 'performance', 'quality']
    : [component];

  const result = {};

  for (const comp of components) {
    // Map component to measurement name
    const measurementMap = {
      availability: 'OEE_Availability',
      performance: 'OEE_Performance',
      quality: 'OEE_Quality'
    };

    const measurement = measurementMap[comp];
    const data = await queryTrendData(measurement, window, enterprise);

    if (data.length === 0) {
      result[comp] = {
        historical: [],
        prediction: [],
        trend: 'stable',
        alert: null
      };
      continue;
    }

    // Calculate regression
    const regression = calculateLinearRegression(data);
    const trend = determineTrend(regression.slope);

    // Predict future values
    const predictions = predictFutureValues(regression, data.length, windowConfig.futureBuckets);

    // Generate prediction timestamps
    const lastTimestamp = new Date(data[data.length - 1].timestamp);
    const predictionData = predictions.map((pred, idx) => {
      const futureTime = new Date(lastTimestamp);
      const intervalMinutes = windowConfig.aggregation === '5m' ? 5 :
                              windowConfig.aggregation === '30m' ? 30 :
                              windowConfig.aggregation === '1h' ? 60 : 360;
      futureTime.setMinutes(futureTime.getMinutes() + intervalMinutes * (idx + 1));

      return {
        timestamp: futureTime.toISOString(),
        value: Math.min(100, pred.value), // Cap at 100%
        confidence: pred.confidence
      };
    });

    // Alert if prediction drops below threshold
    const minPrediction = Math.min(...predictions.map(p => p.value));
    let alert = null;

    const thresholds = {
      availability: 85,
      performance: 90,
      quality: 90
    };

    if (minPrediction < thresholds[comp] && trend === 'falling') {
      alert = {
        severity: 'medium',
        message: `${comp.charAt(0).toUpperCase() + comp.slice(1)} predicted to drop below ${thresholds[comp]}% in next ${windowConfig.futureWindow}`,
        predictedValue: minPrediction.toFixed(1),
        threshold: thresholds[comp]
      };
    }

    result[comp] = {
      historical: data,
      prediction: predictionData,
      trend,
      alert,
      regression: {
        slope: regression.slope.toFixed(4),
        r2: regression.r2.toFixed(3)
      }
    };
  }

  return {
    ...result,
    timestamp: new Date().toISOString()
  };
}

module.exports = {
  TIME_WINDOWS,
  validateTimeWindow,
  calculateLinearRegression,
  predictFutureValues,
  determineTrend,
  queryTrendData,
  calculateDowntimePareto,
  calculateWasteTrend,
  calculateOEEComponentTrend
};
