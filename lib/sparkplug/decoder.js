// lib/sparkplug/decoder.js - Sparkplug B Protocol Decoder
// Handles decoding of Sparkplug B MQTT messages using protobuf format.

const sparkplug = require('sparkplug-payload').get('spBv1.0');

/**
 * Sparkplug B message types
 * @enum {string}
 */
const SPARKPLUG_MESSAGE_TYPES = {
  NBIRTH: 'NBIRTH', // Node birth certificate
  NDEATH: 'NDEATH', // Node death certificate
  DBIRTH: 'DBIRTH', // Device birth certificate
  DDEATH: 'DDEATH', // Device death certificate
  NDATA: 'NDATA',   // Node data
  DDATA: 'DDATA',   // Device data
  NCMD: 'NCMD',     // Node command
  DCMD: 'DCMD',     // Device command
  STATE: 'STATE'    // Edge of Network (EoN) state
};

/**
 * Check if a topic follows Sparkplug B format
 * @param {string} topic - MQTT topic to check
 * @returns {boolean} True if topic is Sparkplug B format
 * @example
 * isSparkplugTopic('spBv1.0/Enterprise B/NDATA/Site3') // true
 * isSparkplugTopic('Enterprise A/Dallas Line 1/packaging/...') // false
 */
function isSparkplugTopic(topic) {
  return topic.startsWith('spBv1.0/');
}

/**
 * Parse Sparkplug B topic into components
 * Topic format: spBv1.0/<group_id>/<message_type>/<edge_node_id>[/<device_id>]
 *
 * @param {string} topic - Sparkplug B MQTT topic
 * @returns {{
 *   namespace: string,
 *   groupId: string,
 *   messageType: string,
 *   edgeNodeId: string,
 *   deviceId: string|null
 * }} Parsed topic components
 * @throws {Error} If topic format is invalid
 * @example
 * parseSparkplugTopic('spBv1.0/Enterprise B/NDATA/Site3')
 * // Returns: { namespace: 'spBv1.0', groupId: 'Enterprise B', messageType: 'NDATA', edgeNodeId: 'Site3', deviceId: null }
 */
function parseSparkplugTopic(topic) {
  const parts = topic.split('/');

  if (parts.length < 4) {
    throw new Error(`Invalid Sparkplug topic format: ${topic}`);
  }

  return {
    namespace: parts[0],      // spBv1.0
    groupId: parts[1],        // Group/Enterprise ID (e.g., 'Enterprise B')
    messageType: parts[2],    // Message type (NBIRTH, NDATA, etc.)
    edgeNodeId: parts[3],     // Edge node ID (e.g., 'Site3')
    deviceId: parts[4] || null // Optional device ID
  };
}

/**
 * Decode Sparkplug B protobuf payload
 * @param {Buffer} buffer - Binary MQTT message payload
 * @returns {Object} Decoded Sparkplug payload with metrics, timestamp, seq
 * @throws {Error} If payload cannot be decoded
 * @example
 * decodePayload(Buffer.from([...])) // Returns: { timestamp: 1640000000, seq: 1, metrics: [...] }
 */
function decodePayload(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Invalid Sparkplug payload: expected non-empty Buffer');
  }
  try {
    return sparkplug.decodePayload(buffer);
  } catch (error) {
    throw new Error(`Failed to decode Sparkplug payload: ${error.message}`);
  }
}

/**
 * Extract value from a Sparkplug metric based on its datatype
 * Sparkplug metrics can have values in different fields depending on type:
 * - intValue (Int8, Int16, Int32, UInt8, UInt16, UInt32)
 * - longValue (Int64, UInt64, DateTime)
 * - floatValue (Float)
 * - doubleValue (Double)
 * - booleanValue (Boolean)
 * - stringValue (String, Text, UUID)
 *
 * @param {Object} metric - Sparkplug metric object
 * @returns {{value: number|string|boolean|null, type: string}} Extracted value and its type
 */
function extractMetricValue(metric) {
  // Check all possible value fields
  if (metric.intValue !== undefined && metric.intValue !== null) {
    return { value: metric.intValue, type: 'int' };
  }
  if (metric.longValue !== undefined && metric.longValue !== null) {
    let longVal = metric.longValue;
    if (typeof longVal === 'bigint') {
      if (longVal > BigInt(Number.MAX_SAFE_INTEGER) || longVal < BigInt(Number.MIN_SAFE_INTEGER)) {
        console.warn(`Precision loss converting BigInt ${longVal} to Number for metric: ${metric.name}`);
      }
      longVal = Number(longVal);
    }
    return { value: longVal, type: 'long' };
  }
  if (metric.floatValue !== undefined && metric.floatValue !== null) {
    return { value: metric.floatValue, type: 'float' };
  }
  if (metric.doubleValue !== undefined && metric.doubleValue !== null) {
    return { value: metric.doubleValue, type: 'double' };
  }
  if (metric.booleanValue !== undefined && metric.booleanValue !== null) {
    return { value: metric.booleanValue, type: 'boolean' };
  }
  if (metric.stringValue !== undefined && metric.stringValue !== null) {
    return { value: metric.stringValue, type: 'string' };
  }

  // No value found
  return { value: null, type: 'null' };
}

/**
 * Extract and normalize metrics from decoded Sparkplug payload
 * Converts Sparkplug metrics into a normalized format for InfluxDB storage.
 *
 * @param {string} topic - Original MQTT topic
 * @param {Object} decodedPayload - Decoded Sparkplug payload from decodePayload()
 * @returns {Array<{
 *   name: string,
 *   value: number|string|boolean,
 *   valueType: string,
 *   timestamp: Date|null,
 *   tags: {
 *     enterprise: string,
 *     site: string,
 *     edgeNodeId: string,
 *     deviceId: string|null,
 *     messageType: string
 *   }
 * }>} Array of normalized metrics ready for InfluxDB
 * @example
 * const metrics = extractMetrics('spBv1.0/Enterprise B/NDATA/Site3', decodedPayload);
 * // Returns: [{ name: 'temperature', value: 72.5, valueType: 'float', timestamp: Date(...), tags: {...} }]
 */
function extractMetrics(topic, decodedPayload) {
  const topicParts = parseSparkplugTopic(topic);
  const metrics = [];

  // Skip DEATH messages - they don't contain useful metrics
  if (topicParts.messageType === 'NDEATH' || topicParts.messageType === 'DDEATH') {
    return metrics;
  }

  // Extract metrics from payload
  if (!decodedPayload.metrics || !Array.isArray(decodedPayload.metrics)) {
    return metrics;
  }

  // Payload timestamp (if available) as fallback
  const payloadTimestamp = decodedPayload.timestamp
    ? new Date(Number(decodedPayload.timestamp))
    : null;

  for (const metric of decodedPayload.metrics) {
    // Skip metrics without names
    if (!metric.name) continue;

    // Extract value from the appropriate field
    const { value, type } = extractMetricValue(metric);

    // Skip null values
    if (value === null) continue;

    // Use metric timestamp if available, otherwise use payload timestamp
    let timestamp = null;
    if (metric.timestamp !== undefined && metric.timestamp !== null) {
      timestamp = new Date(Number(metric.timestamp));
    } else if (payloadTimestamp) {
      timestamp = payloadTimestamp;
    }

    // Build normalized metric object
    metrics.push({
      name: metric.name,
      value: value,
      valueType: type,
      timestamp: timestamp,
      tags: {
        enterprise: topicParts.groupId,      // Group ID becomes enterprise tag
        site: topicParts.edgeNodeId,         // Edge node ID becomes site tag
        edgeNodeId: topicParts.edgeNodeId,   // Keep original edge node ID
        deviceId: topicParts.deviceId,       // Device ID (null for node-level metrics)
        messageType: topicParts.messageType  // NDATA, DDATA, NBIRTH, DBIRTH
      }
    });
  }

  return metrics;
}

module.exports = {
  isSparkplugTopic,
  parseSparkplugTopic,
  decodePayload,
  extractMetrics,
  SPARKPLUG_MESSAGE_TYPES
};
