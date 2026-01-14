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

module.exports = {
  parseTopicToInflux
};
