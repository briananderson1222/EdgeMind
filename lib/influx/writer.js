const { Point } = require('@influxdata/influxdb-client');

/**
 * Parse MQTT topic into InfluxDB measurement and tags
 * @param {string} topic - MQTT topic (format: Enterprise X/SiteY/area/machine/component/metric/type)
 * @param {string} payload - MQTT message payload
 * @returns {Point} InfluxDB Point object ready to write
 */
function parseTopicToInflux(topic, payload) {
  // Topic format: Enterprise X/SiteY/area/machine/component/metric/type
  const parts = topic.split('/');

  // Try to parse payload as number
  let value = parseFloat(payload);
  const isNumeric = !isNaN(value);

  // Create measurement name from last 2-3 parts of topic
  const measurement = parts.slice(-2).join('_').replace(/[^a-zA-Z0-9_]/g, '_');

  const point = new Point(measurement)
    .tag('enterprise', parts[0] || 'unknown')
    .tag('site', parts[1] || 'unknown')
    .tag('area', parts[2] || 'unknown')
    .tag('machine', parts[3] || 'unknown')
    .tag('full_topic', topic);

  if (isNumeric) {
    point.floatField('value', value);
  } else {
    point.stringField('value', payload.substring(0, 200)); // Limit string length
  }

  return point;
}

/**
 * Write Sparkplug B metric to InfluxDB
 * Converts a normalized Sparkplug metric into an InfluxDB Point.
 *
 * @param {Object} metric - Normalized Sparkplug metric from decoder
 * @param {string} metric.name - Metric name (becomes measurement)
 * @param {number|string|boolean} metric.value - Metric value
 * @param {string} metric.valueType - Type of value (int, long, float, double, boolean, string)
 * @param {Date|null} metric.timestamp - Metric timestamp (optional)
 * @param {Object} metric.tags - Tags for the metric
 * @param {string} metric.tags.enterprise - Enterprise/group ID
 * @param {string} metric.tags.site - Site/edge node ID
 * @param {string} metric.tags.edgeNodeId - Original edge node ID
 * @param {string|null} metric.tags.deviceId - Device ID (if device-level metric)
 * @param {string} metric.tags.messageType - Sparkplug message type (NDATA, DDATA, etc.)
 * @returns {Point} InfluxDB Point object ready to write
 * @example
 * const point = writeSparkplugMetric({
 *   name: 'temperature',
 *   value: 72.5,
 *   valueType: 'float',
 *   timestamp: new Date(),
 *   tags: { enterprise: 'Enterprise B', site: 'Site3', ... }
 * });
 */
function writeSparkplugMetric(metric) {
  // Sanitize measurement name - remove spaces and special chars
  const measurement = metric.name.replace(/[^a-zA-Z0-9_]/g, '_');

  // Create Point with tags
  const point = new Point(measurement)
    .tag('enterprise', metric.tags.enterprise)
    .tag('site', metric.tags.site)
    .tag('edge_node_id', metric.tags.edgeNodeId)
    .tag('message_type', metric.tags.messageType)
    .tag('protocol', 'sparkplug_b');

  // Add device_id tag if present (device-level metric)
  if (metric.tags.deviceId) {
    point.tag('device_id', metric.tags.deviceId);
  }

  // Set timestamp if provided
  if (metric.timestamp) {
    point.timestamp(metric.timestamp);
  }

  // Add value field based on type
  switch (metric.valueType) {
    case 'int':
    case 'long':
      point.intField('value', metric.value);
      break;
    case 'float':
      point.floatField('value', metric.value);
      break;
    case 'double':
      point.floatField('value', metric.value); // InfluxDB doesn't distinguish float/double
      break;
    case 'boolean':
      point.booleanField('value', metric.value);
      break;
    case 'string':
      point.stringField('value', String(metric.value).substring(0, 200)); // Limit string length
      break;
    default:
      // Fallback: try to determine type from value
      if (typeof metric.value === 'number') {
        point.floatField('value', metric.value);
      } else if (typeof metric.value === 'boolean') {
        point.booleanField('value', metric.value);
      } else {
        point.stringField('value', String(metric.value).substring(0, 200));
      }
  }

  return point;
}

module.exports = {
  parseTopicToInflux,
  writeSparkplugMetric
};
