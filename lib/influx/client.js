// lib/influx/client.js - InfluxDB Client Setup Module
// Centralizes InfluxDB client initialization and provides access to writeApi and queryApi.

const { InfluxDB, Point } = require('@influxdata/influxdb-client');
const CONFIG = require('../config');

/**
 * InfluxDB client instance configured with URL and authentication token.
 * Used for all interactions with the InfluxDB time-series database.
 *
 * @type {InfluxDB}
 */
const influxDB = new InfluxDB({
  url: CONFIG.influxdb.url,
  token: CONFIG.influxdb.token
});

/**
 * Write API instance for writing data points to InfluxDB.
 * Configured with organization, bucket, and nanosecond precision.
 *
 * @type {WriteApi}
 * @see https://docs.influxdata.com/influxdb/v2/api-guide/client-libraries/nodejs/write/
 */
const writeApi = influxDB.getWriteApi(
  CONFIG.influxdb.org,
  CONFIG.influxdb.bucket,
  'ns'
);

/**
 * Query API instance for querying data from InfluxDB using Flux.
 * Configured with organization name.
 *
 * @type {QueryApi}
 * @see https://docs.influxdata.com/influxdb/v2/api-guide/client-libraries/nodejs/query/
 */
const queryApi = influxDB.getQueryApi(CONFIG.influxdb.org);

/**
 * Re-exported Point class for creating InfluxDB data points.
 * Provides a fluent API for building measurements with tags and fields.
 *
 * @example
 * const { Point } = require('./lib/influx/client');
 * const point = new Point('temperature')
 *   .tag('location', 'warehouse')
 *   .floatField('value', 72.5);
 *
 * @type {typeof Point}
 * @see https://docs.influxdata.com/influxdb/v2/api-guide/client-libraries/nodejs/write/#point
 */

// Re-export writer utilities for convenience
const { parseTopicToInflux, writeSparkplugMetric } = require('./writer');

module.exports = {
  influxDB,
  writeApi,
  queryApi,
  Point,
  parseTopicToInflux,
  writeSparkplugMetric
};
