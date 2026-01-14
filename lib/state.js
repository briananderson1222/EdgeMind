/**
 * @module lib/state
 * @description Factory state management objects for EdgeMind dashboard.
 * Manages real-time factory data, insights, schema discovery, and equipment state caching.
 */

/**
 * @typedef {Object} FactoryStats
 * @property {number} messageCount - Total MQTT messages received
 * @property {number} anomalyCount - Total anomalies detected
 * @property {Date|null} lastUpdate - Timestamp of last message
 * @property {number} influxWrites - Total writes to InfluxDB
 */

/**
 * @typedef {Object} FactoryState
 * @property {Array} messages - Recent MQTT messages
 * @property {Array} anomalies - Detected anomalies
 * @property {Array} insights - Claude-generated insights
 * @property {Array} trendInsights - Trend analysis insights
 * @property {Array} anomalyFilters - User-defined filter rules for Claude analysis
 * @property {Object} thresholdSettings - Operator-configurable alert thresholds
 * @property {FactoryStats} stats - Factory statistics
 */

/**
 * @typedef {Object} MeasurementMetadata
 * @property {number} count - Number of data points
 * @property {Date} lastSeen - Last time this measurement was seen
 * @property {string} valueType - Type of value (numeric, string, etc.)
 * @property {Array} sampleValues - Sample values for this measurement
 * @property {Set<string>} enterprises - Enterprises using this measurement
 * @property {Set<string>} sites - Sites using this measurement
 */

/**
 * @typedef {Object} SchemaCache
 * @property {Map<string, MeasurementMetadata>} measurements - Measurement name to metadata mapping
 * @property {Date|null} lastRefresh - Last cache refresh timestamp
 * @property {Object|null} hierarchy - Enterprise → Site → Area → Machine → Measurements tree
 * @property {Date|null} lastHierarchyRefresh - Last hierarchy refresh timestamp
 * @property {Set<string>} knownMeasurements - Track measurements we've seen
 * @property {number} CACHE_TTL_MS - Cache time-to-live in milliseconds
 */

/**
 * @typedef {Object} StateCodeDefinition
 * @property {string} name - State name (DOWN, IDLE, RUNNING)
 * @property {string} color - Color indicator (red, yellow, green)
 * @property {number} priority - Priority for state rollup (higher = more critical)
 */

/**
 * @typedef {Object} EquipmentStateCache
 * @property {Map<string, Object>} states - Equipment key to state data mapping
 * @property {number} CACHE_TTL_MS - Cache time-to-live in milliseconds
 * @property {Object<number, StateCodeDefinition>} STATE_CODES - State code definitions
 */

/**
 * Factory state management object.
 * Stores real-time messages, anomalies, insights, and statistics.
 * @type {FactoryState}
 */
const factoryState = {
  messages: [],
  anomalies: [],
  insights: [],
  trendInsights: [],
  anomalyFilters: [], // User-defined filter rules for Claude analysis
  thresholdSettings: {
    oeeBaseline: 70,        // % - below this is concerning
    oeeWorldClass: 85,      // % - above this is excellent
    availabilityMin: 65,    // % - below this is critical
    defectRateWarning: 2,   // % - above this triggers warning
    defectRateCritical: 5   // % - above this triggers critical
  },
  stats: {
    messageCount: 0,
    anomalyCount: 0,
    lastUpdate: null,
    influxWrites: 0
  }
};

/**
 * Schema discovery cache.
 * Caches measurement metadata and hierarchical topic structure for performance.
 * @type {SchemaCache}
 */
const schemaCache = {
  measurements: new Map(), // measurement name -> { count, lastSeen, valueType, sampleValues, enterprises, sites }
  lastRefresh: null,
  hierarchy: null, // Enterprise -> Site -> Area -> Machine -> Measurements tree
  lastHierarchyRefresh: null,
  knownMeasurements: new Set(), // Track measurements we've seen (Phase 4)
  CACHE_TTL_MS: 5 * 60 * 1000 // 5 minutes
};

/**
 * Equipment state cache.
 * Caches equipment state data (DOWN, IDLE, RUNNING) with TTL for performance.
 * @type {EquipmentStateCache}
 */
const equipmentStateCache = {
  states: new Map(), // Map<equipmentKey, stateData>
  CACHE_TTL_MS: 60 * 1000, // 1 minute
  STATE_CODES: {
    1: { name: 'DOWN', color: 'red', priority: 3 },
    2: { name: 'IDLE', color: 'yellow', priority: 2 },
    3: { name: 'RUNNING', color: 'green', priority: 1 }
  }
};

module.exports = {
  factoryState,
  schemaCache,
  equipmentStateCache
};
