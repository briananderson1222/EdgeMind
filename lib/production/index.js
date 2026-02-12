// lib/production/index.js - Production Volume & Energy Tracking Module

const { queryApi } = require('../influx/client');
const CONFIG = require('../config');
const { sanitizeInfluxIdentifier } = require('../validation');
const { TIME_WINDOWS, validateTimeWindow } = require('../trends');

/**
 * Query production volume vs target by line
 * @param {string} enterprise - Enterprise filter
 * @param {string} window - Time window
 * @returns {Promise<Object>} Production volume data
 */
async function queryProductionVsTarget(enterprise = 'ALL', window = 'shift') {
  const windowConfig = TIME_WINDOWS[validateTimeWindow(window)];
  const enterpriseFilter = enterprise && enterprise !== 'ALL'
    ? `|> filter(fn: (r) => r.enterprise == "${sanitizeInfluxIdentifier(enterprise)}")`
    : '';

  // Query production count measurements
  const fluxQuery = `
    import "strings"

    from(bucket: "${CONFIG.influxdb.bucket}")
      |> range(start: ${windowConfig.range})
      |> filter(fn: (r) => r._field == "value")
      |> filter(fn: (r) => strings.containsStr(v: r._measurement, substr: "count") or
                          strings.containsStr(v: r._measurement, substr: "COUNT") or
                          strings.containsStr(v: r._measurement, substr: "production"))
      ${enterpriseFilter}
      |> filter(fn: (r) => r._value > 0)
      |> group(columns: ["enterprise", "site", "area", "_measurement"])
      |> sum()
      |> sort(columns: ["_value"], desc: true)
  `;

  const results = [];
  await new Promise((resolve) => {
    queryApi.queryRows(fluxQuery, {
      next(row, tableMeta) {
        const o = tableMeta.toObject(row);
        results.push({
          enterprise: o.enterprise || 'Unknown',
          site: o.site || 'Unknown',
          area: o.area || 'Unknown',
          measurement: o._measurement,
          actual: o._value || 0
        });
      },
      error(error) {
        console.error('[PRODUCTION] Volume query error:', error);
        resolve();
      },
      complete() {
        resolve();
      }
    });
  });

  // Calculate targets (for demo purposes, assume target is 1.1x actual optimal)
  // In production, this would come from a targets database/configuration
  const byLine = results.map(r => {
    const lineName = r.site && r.area ? `${r.site} - ${r.area}` : r.site || 'Unknown';
    const actual = r.actual;
    // Estimate target based on window duration
    const targetMultiplier = window === 'hourly' ? 100 :
                             window === 'shift' ? 800 :
                             window === 'daily' ? 2400 : 16800;
    const target = targetMultiplier;
    const variance = actual - target;
    const percentOfTarget = target > 0 ? (actual / target) * 100 : 0;

    return {
      line: lineName,
      enterprise: r.enterprise,
      actual: Math.round(actual),
      target,
      variance: Math.round(variance),
      percentOfTarget: parseFloat(percentOfTarget.toFixed(1)),
      status: percentOfTarget >= 100 ? 'on-target' :
              percentOfTarget >= 90 ? 'near-target' : 'below-target'
    };
  });

  // Calculate summary
  const totalActual = byLine.reduce((sum, l) => sum + l.actual, 0);
  const totalTarget = byLine.reduce((sum, l) => sum + l.target, 0);

  return {
    byLine,
    summary: {
      totalActual,
      totalTarget,
      overallPercent: totalTarget > 0 ? parseFloat(((totalActual / totalTarget) * 100).toFixed(1)) : 0,
      linesOnTarget: byLine.filter(l => l.status === 'on-target').length,
      linesBelowTarget: byLine.filter(l => l.status === 'below-target').length
    },
    window: validateTimeWindow(window),
    timestamp: new Date().toISOString()
  };
}

/**
 * Query energy consumption by line
 * @param {string} enterprise - Enterprise filter
 * @param {string} window - Time window
 * @returns {Promise<Object>} Energy consumption data
 */
async function queryEnergyConsumption(enterprise = 'ALL', window = 'shift') {
  const windowConfig = TIME_WINDOWS[validateTimeWindow(window)];
  const enterpriseFilter = enterprise && enterprise !== 'ALL'
    ? `|> filter(fn: (r) => r.enterprise == "${sanitizeInfluxIdentifier(enterprise)}")`
    : '';

  // Query energy/power measurements
  const fluxQuery = `
    import "strings"

    from(bucket: "${CONFIG.influxdb.bucket}")
      |> range(start: ${windowConfig.range})
      |> filter(fn: (r) => r._field == "value")
      |> filter(fn: (r) => strings.containsStr(v: r._measurement, substr: "power") or
                          strings.containsStr(v: r._measurement, substr: "energy") or
                          strings.containsStr(v: r._measurement, substr: "kW") or
                          strings.containsStr(v: r._measurement, substr: "watts"))
      ${enterpriseFilter}
      |> filter(fn: (r) => r._value > 0)
      |> group(columns: ["enterprise", "site", "area", "machine"])
      |> aggregateWindow(every: ${windowConfig.aggregation}, fn: mean, createEmpty: false)
  `;

  const timeSeriesData = new Map(); // group by line, collect time series

  await new Promise((resolve) => {
    queryApi.queryRows(fluxQuery, {
      next(row, tableMeta) {
        const o = tableMeta.toObject(row);
        const lineKey = `${o.enterprise || 'Unknown'}|${o.site || 'Unknown'}|${o.area || 'Unknown'}`;

        if (!timeSeriesData.has(lineKey)) {
          timeSeriesData.set(lineKey, {
            enterprise: o.enterprise || 'Unknown',
            site: o.site || 'Unknown',
            area: o.area || 'Unknown',
            values: []
          });
        }

        timeSeriesData.get(lineKey).values.push({
          timestamp: o._time,
          value: o._value
        });
      },
      error(error) {
        console.error('[PRODUCTION] Energy query error:', error);
        resolve();
      },
      complete() {
        resolve();
      }
    });
  });

  // Aggregate and calculate trends
  const byLine = [];
  for (const [, lineData] of timeSeriesData) {
    const lineName = lineData.site && lineData.area
      ? `${lineData.site} - ${lineData.area}`
      : lineData.site || 'Unknown';

    const values = lineData.values.map(v => v.value);
    if (values.length === 0) continue;

    const avgConsumption = values.reduce((sum, v) => sum + v, 0) / values.length;

    // Calculate trend (compare first half vs second half)
    const midpoint = Math.floor(values.length / 2);
    const firstHalf = values.slice(0, midpoint);
    const secondHalf = values.slice(midpoint);
    const firstAvg = firstHalf.reduce((sum, v) => sum + v, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, v) => sum + v, 0) / secondHalf.length;
    const trend = secondAvg > firstAvg * 1.05 ? 'rising' :
                  secondAvg < firstAvg * 0.95 ? 'falling' : 'stable';

    byLine.push({
      line: lineName,
      enterprise: lineData.enterprise,
      consumption: parseFloat(avgConsumption.toFixed(2)),
      unit: 'kW',
      trend,
      timeSeries: lineData.values.map(v => ({
        timestamp: v.timestamp,
        value: parseFloat(v.value.toFixed(2))
      }))
    });
  }

  // Sort by consumption descending
  byLine.sort((a, b) => b.consumption - a.consumption);

  // Calculate summary
  const totalConsumption = byLine.reduce((sum, l) => sum + l.consumption, 0);
  const risingLines = byLine.filter(l => l.trend === 'rising').length;

  return {
    byLine,
    summary: {
      totalConsumption: parseFloat(totalConsumption.toFixed(2)),
      averageConsumption: byLine.length > 0
        ? parseFloat((totalConsumption / byLine.length).toFixed(2))
        : 0,
      risingTrend: risingLines,
      stableLines: byLine.filter(l => l.trend === 'stable').length,
      fallingLines: byLine.filter(l => l.trend === 'falling').length,
      unit: 'kW'
    },
    window: validateTimeWindow(window),
    timestamp: new Date().toISOString()
  };
}

module.exports = {
  queryProductionVsTarget,
  queryEnergyConsumption
};
