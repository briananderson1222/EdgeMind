// server.js - Factory Intelligence Backend with InfluxDB + Agentic Claude
const mqtt = require('mqtt');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const WebSocket = require('ws');
const express = require('express');
const { InfluxDB, Point } = require('@influxdata/influxdb-client');
const { createCmmsProvider } = require('./lib/cmms-interface');

// Configuration
const CONFIG = {
  mqtt: {
    host: process.env.MQTT_HOST || 'mqtt://virtualfactory.proveit.services:1883',
    username: process.env.MQTT_USERNAME || 'proveitreadonly',
    password: process.env.MQTT_PASSWORD || '',
    topics: ['#']
  },
  bedrock: {
    region: process.env.AWS_REGION || 'us-east-1',
    modelId: process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-sonnet-4-20250514-v1:0'
  },
  influxdb: {
    url: process.env.INFLUXDB_URL || 'http://localhost:8086',
    token: process.env.INFLUXDB_TOKEN || '',
    org: process.env.INFLUXDB_ORG || 'proveit',
    bucket: process.env.INFLUXDB_BUCKET || 'factory'
  },
  disableInsights: process.env.DISABLE_INSIGHTS === 'true',
  cmms: {
    enabled: process.env.CMMS_ENABLED === 'true',
    provider: process.env.CMMS_PROVIDER || 'maintainx',
    maintainx: {
      apiKey: process.env.MAINTAINX_API_KEY || '',
      baseUrl: process.env.MAINTAINX_BASE_URL || 'https://api.getmaintainx.com/v1',
      defaultLocationId: process.env.MAINTAINX_DEFAULT_LOCATION_ID || null,
      defaultAssigneeId: process.env.MAINTAINX_DEFAULT_ASSIGNEE_ID || null
    }
  }
};

// Initialize services
const app = express();
const bedrockClient = new BedrockRuntimeClient({ region: CONFIG.bedrock.region });

// Initialize CMMS provider
let cmmsProvider = null;
if (CONFIG.cmms.enabled) {
  try {
    cmmsProvider = createCmmsProvider(CONFIG.cmms.provider, {
      enabled: true,
      ...CONFIG.cmms[CONFIG.cmms.provider]
    });
    console.log(`✅ CMMS provider initialized: ${cmmsProvider.getProviderName()}`);
  } catch (error) {
    console.error(`❌ Failed to initialize CMMS provider: ${error.message}`);
  }
} else {
  console.log('📋 CMMS integration disabled');
}

// Serve static files (frontend HTML)
app.use(express.static(__dirname));

// InfluxDB setup
const influxDB = new InfluxDB({ url: CONFIG.influxdb.url, token: CONFIG.influxdb.token });
const writeApi = influxDB.getWriteApi(CONFIG.influxdb.org, CONFIG.influxdb.bucket, 'ns');
const queryApi = influxDB.getQueryApi(CONFIG.influxdb.org);

// State management
const factoryState = {
  messages: [],
  anomalies: [],
  insights: [],
  trendInsights: [],
  anomalyFilters: [], // User-defined filter rules for Claude analysis
  stats: {
    messageCount: 0,
    anomalyCount: 0,
    lastUpdate: null,
    influxWrites: 0
  }
};

// Schema discovery cache
const schemaCache = {
  measurements: new Map(), // measurement name -> { count, lastSeen, valueType, sampleValues, enterprises, sites }
  lastRefresh: null,
  hierarchy: null, // Enterprise -> Site -> Area -> Machine -> Measurements tree
  lastHierarchyRefresh: null,
  knownMeasurements: new Set(), // Track measurements we've seen (Phase 4)
  CACHE_TTL_MS: 5 * 60 * 1000 // 5 minutes
};

// Equipment state cache
const equipmentStateCache = {
  states: new Map(), // Map<equipmentKey, stateData>
  CACHE_TTL_MS: 60 * 1000, // 1 minute
  STATE_CODES: {
    1: { name: 'DOWN', color: 'red', priority: 3 },
    2: { name: 'IDLE', color: 'yellow', priority: 2 },
    3: { name: 'RUNNING', color: 'green', priority: 1 }
  }
};

/**
 * Sanitizes InfluxDB identifiers to prevent Flux query injection.
 * Removes potentially dangerous characters like quotes and backslashes.
 * @param {string} identifier - The identifier to sanitize
 * @returns {string} Sanitized identifier
 */
function sanitizeInfluxIdentifier(identifier) {
  if (typeof identifier !== 'string') return '';
  return identifier.replace(/["\\]/g, '');
}

/**
 * Formats a duration in milliseconds into a human-readable string.
 * @param {number} durationMs - Duration in milliseconds
 * @returns {string} Formatted duration (e.g., "2h 15m", "45s")
 */
function formatDuration(durationMs) {
  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

// =============================================================================
// INPUT VALIDATION
// =============================================================================

/**
 * Valid enterprise names for API input validation.
 * SECURITY: Whitelist approach prevents injection attacks.
 */
const VALID_ENTERPRISES = ['ALL', 'Enterprise A', 'Enterprise B', 'Enterprise C'];

/**
 * Valid WebSocket message types.
 * SECURITY: Whitelist approach prevents processing of unknown message types.
 */
const VALID_WS_MESSAGE_TYPES = ['get_stats', 'ask_claude', 'update_anomaly_filter'];

/**
 * Maximum length for user-provided strings.
 * SECURITY: Prevents DoS via oversized inputs.
 */
const MAX_INPUT_LENGTH = 1000;

/**
 * Validates and sanitizes enterprise parameter.
 * @param {string} enterprise - The enterprise parameter from request
 * @returns {string|null} Validated enterprise or null if invalid
 */
function validateEnterprise(enterprise) {
  if (!enterprise || typeof enterprise !== 'string') return 'ALL';
  if (enterprise.length > MAX_INPUT_LENGTH) return null;

  // Check against whitelist
  if (VALID_ENTERPRISES.includes(enterprise)) {
    return enterprise;
  }

  // For dynamic enterprises discovered at runtime, sanitize the input
  const sanitized = sanitizeInfluxIdentifier(enterprise);
  if (sanitized.length > 0 && sanitized.length <= 100) {
    return sanitized;
  }

  return null;
}

/**
 * Validates and sanitizes site parameter.
 * @param {string} site - The site parameter from request
 * @returns {string|null} Validated site or null
 */
function validateSite(site) {
  if (!site || typeof site !== 'string') return null;
  if (site.length > MAX_INPUT_LENGTH) return null;

  const sanitized = sanitizeInfluxIdentifier(site);
  if (sanitized.length > 0 && sanitized.length <= 100) {
    return sanitized;
  }

  return null;
}

/**
 * Extracts the measurement name from an MQTT topic.
 * Uses the same logic as parseTopicToInflux to ensure consistency.
 * @param {string} topic - The MQTT topic
 * @returns {string|null} The measurement name or null if unable to extract
 */
function extractMeasurementFromTopic(topic) {
  const parts = topic.split('/');
  if (parts.length >= 2) {
    return parts.slice(-2).join('_').replace(/[^a-zA-Z0-9_]/g, '_');
  }
  return null;
}

// =============================================================================
// PHASE 3: AUTO-CLASSIFICATION
// =============================================================================

/**
 * Classification categories for measurements based on naming patterns and value characteristics.
 * Used to automatically categorize measurements for better organization and querying.
 */
const MEASUREMENT_CLASSIFICATIONS = {
  oee_metric: ['oee', 'OEE_Performance', 'OEE_Availability', 'OEE_Quality', 'availability', 'performance', 'quality'],
  sensor_reading: ['speed', 'temperature', 'pressure', 'humidity', 'voltage', 'current', 'flow', 'level', 'weight'],
  state_status: ['state', 'status', 'running', 'stopped', 'fault', 'alarm', 'mode', 'ready'],
  counter: ['count', 'total', 'produced', 'rejected', 'scrap', 'waste', 'good'],
  timing: ['time', 'duration', 'cycle', 'downtime', 'uptime', 'runtime'],
  description: [] // Fallback for string values
};

// =============================================================================
// ENTERPRISE DOMAIN CONTEXT
// =============================================================================

/**
 * Domain-specific context for each enterprise.
 * Provides industry knowledge and safety ranges for AI-powered insights.
 */
const ENTERPRISE_DOMAIN_CONTEXT = {
  'Enterprise A': {
    industry: 'Glass Manufacturing',
    domain: 'glass',
    equipment: {
      'Furnace': { type: 'glass-furnace', normalTemp: [2650, 2750], unit: '°F' },
      'ISMachine': { type: 'forming-machine', cycleTime: [8, 12], unit: 'sec' },
      'Lehr': { type: 'annealing-oven', tempGradient: [1050, 400] }
    },
    criticalMetrics: ['temperature', 'gob_weight', 'defect_count'],
    concerns: ['thermal_shock', 'crown_temperature', 'refractory_wear'],
    safeRanges: {
      'furnace_temp': { min: 2600, max: 2800, unit: '°F', critical: true },
      'crown_temp': { min: 2400, max: 2600, unit: '°F' }
    },
    wasteMetrics: ['OEE_Waste', 'Production_DefectCHK', 'Production_DefectDIM', 'Production_DefectSED', 'Production_RejectCount'],
    wasteThresholds: { warning: 10, critical: 25, unit: 'defects/hr' }
  },
  'Enterprise B': {
    industry: 'Beverage Bottling',
    domain: 'beverage',
    equipment: {
      'Filler': { type: 'bottle-filler', normalSpeed: [400, 600], unit: 'BPM' },
      'Labeler': { type: 'labeling-machine', accuracy: 99.5 },
      'Palletizer': { type: 'palletizing-robot', cycleTime: [10, 15] }
    },
    criticalMetrics: ['countinfeed', 'countoutfeed', 'countdefect', 'oee'],
    concerns: ['line_efficiency', 'changeover_time', 'reject_rate'],
    rawCounterFields: ['countinfeed', 'countoutfeed', 'countdefect'],
    safeRanges: {
      'reject_rate': { max: 2, unit: '%', warning: 1.5 },
      'filler_speed': { min: 350, max: 650, unit: 'BPM' }
    },
    wasteMetrics: ['count_defect', 'input_countdefect', 'workorder_quantitydefect'],
    wasteThresholds: { warning: 50, critical: 100, unit: 'defects/hr' }
  },
  'Enterprise C': {
    industry: 'Bioprocessing / Pharma',
    domain: 'pharma',
    batchControl: 'ISA-88',
    equipment: {
      'SUM': { type: 'single-use-mixer', phase: 'preparation' },
      'SUB': { type: 'single-use-bioreactor', phase: 'cultivation' },
      'CHROM': { type: 'chromatography', phase: 'purification' },
      'TFF': { type: 'tangential-flow-filtration', phase: 'filtration' }
    },
    criticalMetrics: ['PV_percent', 'phase', 'batch_id'],
    concerns: ['contamination', 'batch_deviation', 'sterility'],
    safeRanges: {
      'pH': { min: 6.8, max: 7.4, critical: true },
      'dissolved_oxygen': { min: 30, max: 70, unit: '%' }
    },
    wasteMetrics: ['chrom_CHR01_WASTE_PV'],
    wasteThresholds: { warning: 5, critical: 15, unit: 'L' }
  }
};

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

  return createOEEResult(enterprise, site, oeeValue, null, 1, config.reason, {
    measurementsUsed: [measurement],
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

/**
 * Classifies a measurement based on its name, value type, and sample values.
 * Uses pattern matching against known measurement types and infers from value characteristics.
 *
 * @param {string} name - The measurement name
 * @param {string} valueType - Type of value ('numeric' or 'string')
 * @param {Array} sampleValues - Sample values from the measurement
 * @returns {string} Classification category name
 */
function classifyMeasurement(name, valueType, sampleValues) {
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

// Track in-progress schema refresh to prevent race conditions
let schemaRefreshInProgress = null;

// Agentic loop state
let lastTrendAnalysis = Date.now();
const TREND_ANALYSIS_INTERVAL = 30000; // Analyze trends every 30 seconds

// Connect to MQTT broker
console.log('🏭 Connecting to ProveIt! Virtual Factory...');
const mqttClient = mqtt.connect(CONFIG.mqtt.host, {
  username: CONFIG.mqtt.username,
  password: CONFIG.mqtt.password,
  reconnectPeriod: 5000
});

mqttClient.on('connect', async () => {
  console.log('✅ Connected to MQTT broker!');
  CONFIG.mqtt.topics.forEach(topic => {
    mqttClient.subscribe(topic, (err) => {
      if (!err) console.log(`📡 Subscribed to: ${topic}`);
    });
  });

  // Warm up schema cache and populate knownMeasurements (Phase 4)
  try {
    await refreshSchemaCache();
    // Populate known measurements from cache
    if (schemaCache.measurements.size > 0) {
      for (const m of schemaCache.measurements.keys()) {
        schemaCache.knownMeasurements.add(m);
      }
      console.log(`📋 Loaded ${schemaCache.knownMeasurements.size} known measurements from cache`);
    }
  } catch (error) {
    console.warn('Failed to warm up schema cache on startup:', error.message);
  }

  // Start the agentic trend analysis loop
  startAgenticLoop();
});

mqttClient.on('error', (error) => {
  console.error('❌ MQTT Error:', error);
});

// Parse MQTT topic into measurement and tags
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

// Handle incoming MQTT messages
mqttClient.on('message', async (topic, message) => {
  const timestamp = new Date().toISOString();
  const payload = message.toString();

  factoryState.stats.messageCount++;
  factoryState.stats.lastUpdate = timestamp;

  const mqttMessage = {
    timestamp,
    topic,
    payload,
    id: `msg_${Date.now()}_${Math.random()}`
  };

  // Phase 4: Detect new measurements
  const measurement = extractMeasurementFromTopic(topic);
  if (measurement && !schemaCache.knownMeasurements.has(measurement)) {
    schemaCache.knownMeasurements.add(measurement);

    const isNumeric = !isNaN(parseFloat(payload));
    const sampleValue = isNumeric ? parseFloat(payload) : payload;

    // Broadcast new measurement to WebSocket clients
    broadcastToClients({
      type: 'new_measurement',
      data: {
        measurement,
        topic,
        firstSeen: timestamp,
        sampleValue: payload.substring(0, 100),
        valueType: isNumeric ? 'numeric' : 'string',
        classification: classifyMeasurement(
          measurement,
          isNumeric ? 'numeric' : 'string',
          isNumeric ? [sampleValue] : []
        )
      }
    });

    console.log(`[SCHEMA] New measurement detected: ${measurement} from topic: ${topic}`);
  }

  // Detect and cache equipment state changes
  const topicLower = topic.toLowerCase();
  if (topicLower.includes('statecurrent') || (topicLower.includes('state') && !topicLower.includes('statereason'))) {
    const parts = topic.split('/');
    if (parts.length >= 3) {
      const enterprise = parts[0];
      const site = parts[1];
      // Machine could be at different positions depending on structure
      const machine = parts.length >= 4 ? parts[3] : parts[2];
      const equipmentKey = `${enterprise}/${site}/${machine}`;

      // Parse state value - support both numeric (1=DOWN, 2=IDLE, 3=RUNNING) and string values
      let stateValue = null;
      let stateInfo = null;

      const numValue = parseInt(payload);
      if (!isNaN(numValue) && equipmentStateCache.STATE_CODES[numValue]) {
        stateValue = numValue;
        stateInfo = equipmentStateCache.STATE_CODES[numValue];
      } else {
        // Check for string state values
        const payloadLower = String(payload).toLowerCase();
        if (payloadLower.includes('down') || payloadLower.includes('stop') || payloadLower.includes('fault') || payloadLower === '1') {
          stateValue = 1;
          stateInfo = equipmentStateCache.STATE_CODES[1];
        } else if (payloadLower.includes('idle') || payloadLower.includes('standby') || payloadLower.includes('wait') || payloadLower === '2') {
          stateValue = 2;
          stateInfo = equipmentStateCache.STATE_CODES[2];
        } else if (payloadLower.includes('run') || payloadLower.includes('active') || payloadLower.includes('operating') || payloadLower === '3') {
          stateValue = 3;
          stateInfo = equipmentStateCache.STATE_CODES[3];
        }
      }

      if (stateValue && stateInfo) {
        const existingState = equipmentStateCache.states.get(equipmentKey);

        // Only update if state changed or first time seen
        if (!existingState || existingState.state !== stateValue) {
          const stateData = {
            enterprise,
            site,
            machine,
            state: stateValue,
            stateName: stateInfo.name,
            color: stateInfo.color,
            reason: null,
            lastUpdate: timestamp,
            firstSeen: existingState ? existingState.firstSeen : timestamp
          };

          equipmentStateCache.states.set(equipmentKey, stateData);

          // Broadcast state change to WebSocket clients
          broadcastToClients({
            type: 'equipment_state',
            data: {
              ...stateData,
              durationMs: Date.now() - new Date(stateData.firstSeen).getTime(),
              durationFormatted: formatDuration(Date.now() - new Date(stateData.firstSeen).getTime())
            }
          });

          console.log(`[STATE] ${equipmentKey}: ${stateInfo.name}`);
        }
      }
    }
  }

  // Write to InfluxDB
  try {
    const point = parseTopicToInflux(topic, payload);
    writeApi.writePoint(point);
    factoryState.stats.influxWrites++;
  } catch (err) {
    factoryState.stats.influxWriteErrors = (factoryState.stats.influxWriteErrors || 0) + 1;
    if (factoryState.stats.influxWriteErrors % 100 === 1) {
      console.error(`InfluxDB write error (total: ${factoryState.stats.influxWriteErrors}):`, err.message);
    }
  }

  // Keep small buffer in memory for immediate display
  factoryState.messages.push(mqttMessage);
  if (factoryState.messages.length > 100) {
    factoryState.messages.shift();
  }

  // Broadcast to WebSocket clients (throttled - every 10th message)
  if (factoryState.stats.messageCount % 10 === 0) {
    broadcastToClients({
      type: 'mqtt_message',
      data: mqttMessage
    });
  }
});

// Flush InfluxDB writes periodically
setInterval(() => {
  writeApi.flush().catch(err => console.error('InfluxDB flush error:', err));
}, 5000);

// =============================================================================
// AGENTIC TREND ANALYSIS LOOP
// =============================================================================
async function startAgenticLoop() {
  if (CONFIG.disableInsights) {
    console.log('🤖 Insights disabled - MQTT data collection only mode');
    return;
  }

  console.log('🤖 Starting Agentic Trend Analysis Loop...');

  // Run the loop every TREND_ANALYSIS_INTERVAL
  setInterval(async () => {
    await runTrendAnalysis();
  }, TREND_ANALYSIS_INTERVAL);

  // Run first analysis after 15 seconds to let data accumulate
  setTimeout(async () => {
    await runTrendAnalysis();
  }, 15000);
}

async function runTrendAnalysis() {
  console.log('📊 Running trend analysis...');

  try {
    // Query aggregated data from InfluxDB
    const trends = await queryTrends();

    if (!trends || trends.length === 0) {
      console.log('📊 No trend data available yet');
      return;
    }

    // Send to Claude for analysis
    const insight = await analyzeTreesWithClaude(trends);

    if (insight) {
      factoryState.trendInsights.push(insight);
      if (factoryState.trendInsights.length > 20) {
        factoryState.trendInsights.shift();
      }

      // Broadcast to clients
      broadcastToClients({
        type: 'trend_insight',
        data: insight
      });

      console.log('✨ Trend Analysis:', insight.summary);

      // CMMS Integration: Create work orders for high-severity anomalies
      if (cmmsProvider && cmmsProvider.isEnabled() && insight.severity === 'high' && insight.anomalies?.length > 0) {
        processAnomaliesForWorkOrders(insight, trends);
      }
    }

  } catch (error) {
    console.error('❌ Trend analysis error:', error.message);
  }
}

/**
 * Processes high-severity anomalies and creates CMMS work orders.
 * Deduplicates by equipment to avoid creating multiple work orders for the same machine.
 *
 * @param {Object} insight - Claude analysis insight
 * @param {Array} trends - Trend data used for context
 */
async function processAnomaliesForWorkOrders(insight, trends) {
  console.log(`🔧 Processing ${insight.anomalies.length} anomalies for work order creation...`);

  try {
    // Extract affected equipment from trends and equipment state cache
    const affectedEquipment = extractAffectedEquipment(trends, insight);

    if (affectedEquipment.length === 0) {
      console.log('🔧 No specific equipment identified for work order creation');
      return;
    }

    // Create work orders for each affected piece of equipment
    const workOrderPromises = affectedEquipment.map(async (equipment) => {
      try {
        const workOrder = await cmmsProvider.createWorkOrder(insight, equipment);

        // Broadcast work order creation to WebSocket clients
        broadcastToClients({
          type: 'cmms_work_order_created',
          data: {
            workOrder,
            equipment,
            anomaly: {
              summary: insight.summary,
              severity: insight.severity,
              timestamp: insight.timestamp
            }
          }
        });

        return workOrder;
      } catch (error) {
        console.error(`🔧 Failed to create work order for ${equipment.enterprise}/${equipment.machine}:`, error.message);
        return null;
      }
    });

    const results = await Promise.allSettled(workOrderPromises);
    const successful = results.filter(r => r.status === 'fulfilled' && r.value !== null).length;

    console.log(`🔧 Created ${successful}/${affectedEquipment.length} work orders successfully`);

  } catch (error) {
    console.error('🔧 Error processing anomalies for work orders:', error.message);
  }
}

/**
 * Extracts affected equipment from trends and equipment state cache.
 * Prioritizes equipment in DOWN or IDLE state for work order creation.
 *
 * @param {Array} trends - Trend data
 * @param {Object} insight - Claude insight with enterprise-specific data
 * @returns {Array<Object>} Array of equipment objects
 */
function extractAffectedEquipment(trends, insight) {
  const equipment = new Map(); // Use Map to deduplicate by equipment key

  // Extract unique equipment from trends
  trends.forEach(trend => {
    if (trend.enterprise && trend.site && trend.area) {
      const key = `${trend.enterprise}/${trend.site}/${trend.area}`;

      if (!equipment.has(key)) {
        equipment.set(key, {
          enterprise: trend.enterprise,
          site: trend.site,
          area: trend.area,
          machine: trend.area, // Use area as machine identifier
          stateName: 'UNKNOWN'
        });
      }
    }
  });

  // Enrich with equipment state data if available
  for (const [stateKey, stateData] of equipmentStateCache.states.entries()) {
    const key = `${stateData.enterprise}/${stateData.site}/${stateData.machine}`;

    if (equipment.has(key)) {
      // Update existing equipment with state info
      const eq = equipment.get(key);
      eq.stateName = stateData.stateName;
      eq.machine = stateData.machine;
    } else if (insight.enterpriseInsights?.[stateData.enterprise]) {
      // Add equipment from state cache if mentioned in enterprise insights
      equipment.set(key, {
        enterprise: stateData.enterprise,
        site: stateData.site,
        area: stateData.machine,
        machine: stateData.machine,
        stateName: stateData.stateName
      });
    }
  }

  // Convert to array and prioritize DOWN/IDLE equipment
  const equipmentArray = Array.from(equipment.values());

  // Sort by priority: DOWN > IDLE > others
  equipmentArray.sort((a, b) => {
    const priorityMap = { 'DOWN': 3, 'IDLE': 2, 'RUNNING': 1, 'UNKNOWN': 0 };
    return (priorityMap[b.stateName] || 0) - (priorityMap[a.stateName] || 0);
  });

  // Limit to 5 work orders per analysis to avoid overwhelming maintenance team
  return equipmentArray.slice(0, 5);
}

async function queryTrends() {
  const fluxQuery = `
    from(bucket: "${CONFIG.influxdb.bucket}")
      |> range(start: -5m)
      |> filter(fn: (r) => r._field == "value" and r._value > 0)
      |> group(columns: ["_measurement", "enterprise", "site", "area"])
      |> aggregateWindow(every: 1m, fn: mean, createEmpty: false)
      |> yield(name: "mean")
  `;

  const results = [];

  return new Promise((resolve, reject) => {
    queryApi.queryRows(fluxQuery, {
      next(row, tableMeta) {
        const o = tableMeta.toObject(row);
        results.push({
          measurement: o._measurement,
          enterprise: o.enterprise,
          site: o.site,
          area: o.area,
          time: o._time,
          value: o._value
        });
      },
      error(error) {
        console.error('InfluxDB query error:', error);
        resolve([]); // Return empty on error
      },
      complete() {
        resolve(results);
      }
    });
  });
}

/**
 * Builds domain-specific context for Claude based on enterprises present in trends.
 * @param {Array} trends - Trend data with enterprise information
 * @returns {string} Formatted domain context
 */
function buildDomainContext(trends) {
  // Extract unique enterprises from trends
  const enterprises = [...new Set(trends.map(t => t.enterprise))];

  const contextSections = enterprises
    .filter(ent => ENTERPRISE_DOMAIN_CONTEXT[ent])
    .map(ent => {
      const ctx = ENTERPRISE_DOMAIN_CONTEXT[ent];
      const wasteInfo = ctx.wasteThresholds
        ? `\n- Waste Thresholds: Warning > ${ctx.wasteThresholds.warning} ${ctx.wasteThresholds.unit}, Critical > ${ctx.wasteThresholds.critical} ${ctx.wasteThresholds.unit}`
        : '';
      return `
**${ent} (${ctx.industry})**
- Critical Metrics: ${ctx.criticalMetrics.join(', ')}
- Key Concerns: ${ctx.concerns.join(', ')}
- Safe Ranges: ${Object.entries(ctx.safeRanges).map(([k, v]) =>
  `${k}: ${v.min ? `${v.min}-` : ''}${v.max || ''} ${v.unit || ''}${v.critical ? ' (CRITICAL)' : ''}`
).join(', ')}${wasteInfo}`;
    });

  return contextSections.length > 0
    ? `\n## Enterprise Domain Knowledge\n${contextSections.join('\n')}\n`
    : '';
}

async function analyzeTreesWithClaude(trends) {
  // Summarize trends for Claude
  const trendSummary = summarizeTrends(trends);
  const domainContext = buildDomainContext(trends);

  // Build filter rules section if any filters are active
  const filterRulesSection = factoryState.anomalyFilters.length > 0
    ? `\n## User-Defined Anomaly Filter Rules

Additionally, apply these user-defined rules when identifying anomalies:
${factoryState.anomalyFilters.map((rule, i) => `${i + 1}. ${rule}`).join('\n')}

These rules should modify your anomaly detection behavior accordingly.\n`
    : '';

  const prompt = `You are an AI factory monitoring agent analyzing time-series trend data from a manufacturing facility.
${domainContext}
## Current Trend Data (Last 5 Minutes, 1-Minute Aggregates)

${trendSummary}
${filterRulesSection}
## Your Task

Analyze these trends and provide:
1. **Summary**: A 1-2 sentence overview of factory performance
2. **Trends**: Key metrics that are rising, falling, or stable
3. **Anomalies**: Any concerning patterns (sudden changes, values outside normal range)
4. **Waste Analysis**: Analyze waste/defect/reject metrics - flag any spikes above warning or critical thresholds
5. **Recommendations**: Actionable suggestions for operators
6. **Enterprise Insights**: Specific insights for each enterprise based on domain knowledge

**IMPORTANT**: Pay special attention to metrics containing "waste", "defect", "reject", or "scrap". Rising waste trends indicate quality issues requiring immediate attention. Compare against the waste thresholds defined for each enterprise.

Respond in JSON format:
{
  "summary": "brief overview",
  "trends": [{"metric": "name", "direction": "rising|falling|stable", "change_percent": 0}],
  "anomalies": ["list of concerns"],
  "wasteAlerts": [{"enterprise": "name", "metric": "name", "value": 0, "threshold": "warning|critical", "message": "description"}],
  "recommendations": ["list of actions"],
  "enterpriseInsights": {
    "Enterprise A": "glass manufacturing specific insight",
    "Enterprise B": "beverage bottling specific insight",
    "Enterprise C": "pharma bioprocessing specific insight"
  },
  "severity": "low|medium|high",
  "confidence": 0.0-1.0
}`;

  try {
    const payload = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    };

    const command = new InvokeModelCommand({
      modelId: CONFIG.bedrock.modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(payload)
    });

    const response = await bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    if (!responseBody.content || !responseBody.content[0] || !responseBody.content[0].text) {
      console.error('Unexpected Bedrock response format:', JSON.stringify(responseBody));
      return null;
    }

    let responseText = responseBody.content[0].text;

    try {
      responseText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const analysis = JSON.parse(responseText);
      return {
        id: `trend_${Date.now()}`,
        timestamp: new Date().toISOString(),
        ...analysis,
        dataPoints: trends.length
      };
    } catch (parseError) {
      console.error('Failed to parse Claude response as JSON:', parseError.message);
      return {
        id: `trend_${Date.now()}`,
        timestamp: new Date().toISOString(),
        summary: responseText.substring(0, 500),
        severity: 'low',
        confidence: 0.5,
        dataPoints: trends.length,
        parseError: true
      };
    }

  } catch (error) {
    console.error('Claude trend analysis error:', error.message);
    return null;
  }
}

function summarizeTrends(trends) {
  // Group by measurement
  const grouped = {};
  trends.forEach(t => {
    const key = `${t.enterprise}/${t.site}/${t.area}/${t.measurement}`;
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push({ time: t.time, value: t.value });
  });

  // Create summary
  const lines = [];
  Object.entries(grouped).slice(0, 30).forEach(([key, values]) => {
    if (values.length >= 2) {
      const first = values[0].value;
      const last = values[values.length - 1].value;
      const change = ((last - first) / first * 100).toFixed(1);
      const avg = (values.reduce((s, v) => s + v.value, 0) / values.length).toFixed(2);
      lines.push(`${key}: avg=${avg}, change=${change}% (${values.length} points)`);
    }
  });

  return lines.join('\n') || 'No aggregated data available';
}

// =============================================================================
// SCHEMA DISCOVERY
// =============================================================================

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
          console.error('Schema cache count query error:', error);
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
      const classification = classifyMeasurement(data.name, data.valueType, data.sampleValues);

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
    console.log(`✅ Schema cache refreshed: ${schemaCache.measurements.size} measurements (${duration}ms)`);

  } catch (error) {
    console.error('❌ Schema cache refresh failed:', error);
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
 * Builds a tree: Enterprise -> Site -> Area -> Machine -> Measurements
 */
async function refreshHierarchyCache() {
  // Check if cache is still valid
  if (schemaCache.lastHierarchyRefresh &&
      Date.now() - schemaCache.lastHierarchyRefresh < schemaCache.CACHE_TTL_MS) {
    return;
  }

  console.log('🌳 Refreshing hierarchy cache...');
  const startTime = Date.now();

  try {
    // Query InfluxDB for hierarchical grouping with counts
    const hierarchyQuery = `
      from(bucket: "${CONFIG.influxdb.bucket}")
        |> range(start: -24h)
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
    console.log(`✅ Hierarchy cache refreshed: ${enterpriseCount} enterprises (${duration}ms)`);

  } catch (error) {
    console.error('❌ Hierarchy cache refresh failed:', error);
    throw error;
  }
}

// =============================================================================
// WEBSOCKET & API
// =============================================================================

function handleClientRequest(ws, request) {
  // SECURITY: Validate request structure
  if (!request || typeof request !== 'object') {
    ws.send(JSON.stringify({ type: 'error', error: 'Invalid request format' }));
    return;
  }

  // SECURITY: Validate message type against whitelist
  if (!request.type || !VALID_WS_MESSAGE_TYPES.includes(request.type)) {
    ws.send(JSON.stringify({ type: 'error', error: 'Invalid or missing request type' }));
    return;
  }

  switch (request.type) {
    case 'get_stats':
      ws.send(JSON.stringify({
        type: 'stats_response',
        data: factoryState.stats
      }));
      break;

    case 'ask_claude':
      // SECURITY: Validate question parameter
      if (!request.question || typeof request.question !== 'string') {
        ws.send(JSON.stringify({ type: 'error', error: 'Missing or invalid question' }));
        return;
      }
      if (request.question.length > MAX_INPUT_LENGTH) {
        ws.send(JSON.stringify({ type: 'error', error: 'Question too long (max 1000 characters)' }));
        return;
      }

      askClaudeWithContext(request.question).then(answer => {
        ws.send(JSON.stringify({
          type: 'claude_response',
          data: { question: request.question, answer }
        }));
      });
      break;

    case 'update_anomaly_filter':
      // SECURITY: Validate filters parameter
      if (!request.filters || !Array.isArray(request.filters)) {
        ws.send(JSON.stringify({ type: 'error', error: 'Missing or invalid filters array' }));
        return;
      }

      // SECURITY: Validate each filter is a string and not too long
      const validFilters = request.filters.filter(filter => {
        return typeof filter === 'string' && filter.length > 0 && filter.length <= 200;
      });

      // Limit number of filters
      if (validFilters.length > 10) {
        ws.send(JSON.stringify({ type: 'error', error: 'Too many filters (max 10)' }));
        return;
      }

      // Update server state
      factoryState.anomalyFilters = validFilters;

      // Broadcast to all connected clients
      broadcastToClients({
        type: 'anomaly_filter_update',
        data: { filters: factoryState.anomalyFilters }
      });

      console.log(`🔍 Anomaly filters updated: ${validFilters.length} active rules`);
      break;
  }
}

async function askClaudeWithContext(question) {
  if (CONFIG.disableInsights) {
    return 'AI Insights are currently disabled. Set DISABLE_INSIGHTS=false to enable interactive queries.';
  }

  const recentTrends = factoryState.trendInsights.slice(-3).map(t => t.summary).join('; ');
  const context = `Factory stats: ${JSON.stringify(factoryState.stats)}
Recent trend insights: ${recentTrends}`;

  try {
    const payload = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 500,
      messages: [
        { role: 'user', content: `${context}\n\nUser question: ${question}` }
      ]
    };

    const command = new InvokeModelCommand({
      modelId: CONFIG.bedrock.modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(payload)
    });

    const response = await bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    return responseBody.content[0].text;
  } catch (error) {
    console.error('Error asking Claude:', error);
    return 'Sorry, I encountered an error processing your question.';
  }
}

function broadcastToClients(message) {
  const payload = JSON.stringify(message);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// Health endpoint with InfluxDB status
app.get('/health', async (req, res) => {
  let influxOk = false;
  try {
    // Execute a minimal query to verify connectivity
    const query = 'buckets() |> limit(n: 1)';
    await queryApi.collectRows(query);
    influxOk = true;
  } catch (e) {
    console.error('InfluxDB health check failed:', e.message);
  }

  res.json({
    status: 'online',
    mqtt: mqttClient.connected,
    influxdb: influxOk,
    stats: factoryState.stats
  });
});

// API endpoint to query trends directly
app.get('/api/trends', async (req, res) => {
  const trends = await queryTrends();
  res.json(trends);
});

// API endpoint for 24h OEE aggregate
app.get('/api/oee', async (req, res) => {
  try {
    // SECURITY: Validate enterprise parameter
    const enterprise = validateEnterprise(req.query.enterprise);
    if (enterprise === null) {
      return res.status(400).json({ error: 'Invalid enterprise parameter' });
    }

    const oeeData = await queryOEE(enterprise);
    res.json(oeeData);
  } catch (error) {
    console.error('OEE query error:', error);
    res.status(500).json({ error: 'Failed to query OEE data' });
  }
});

// NEW: OEE breakdown by enterprise
app.get('/api/oee/breakdown', async (req, res) => {
  try {
    const breakdown = await queryOEEBreakdown();
    res.json(breakdown);
  } catch (error) {
    console.error('OEE breakdown query error:', error);
    res.status(500).json({ error: 'Failed to query OEE breakdown' });
  }
});

// NEW: Factory status endpoint with hierarchical enterprise/site OEE
app.get('/api/factory/status', async (req, res) => {
  try {
    const status = await queryFactoryStatus();
    res.json(status);
  } catch (error) {
    console.error('Factory status query error:', error);
    res.status(500).json({ error: 'Failed to query factory status' });
  }
});

/**
 * GET /api/oee/v2 - Enhanced OEE calculation with tier-based strategy
 * Query params:
 *   - enterprise: 'ALL' | specific enterprise name (default: ALL)
 *   - site: optional site filter
 */
app.get('/api/oee/v2', async (req, res) => {
  try {
    // SECURITY: Validate input parameters
    const enterprise = validateEnterprise(req.query.enterprise);
    if (enterprise === null) {
      return res.status(400).json({ error: 'Invalid enterprise parameter' });
    }

    const site = validateSite(req.query.site);
    // site can be null (valid), but if provided and invalid, reject
    if (req.query.site && site === null && req.query.site.length > 0) {
      return res.status(400).json({ error: 'Invalid site parameter' });
    }

    if (enterprise === 'ALL') {
      // Run discovery and calculate for all enterprises
      await discoverOEESchema();
      const enterprises = Object.keys(oeeConfig.enterprises);

      const results = await Promise.all(
        enterprises.map(ent => calculateOEEv2(ent, site))
      );

      // Calculate overall average (only from enterprises with data)
      const validResults = results.filter(r => r.oee !== null);
      const avgOee = validResults.length > 0
        ? validResults.reduce((sum, r) => sum + r.oee, 0) / validResults.length
        : null;

      res.json({
        overall: {
          oee: avgOee ? parseFloat(avgOee.toFixed(1)) : null,
          enterpriseCount: results.length,
          validEnterpriseCount: validResults.length
        },
        enterprises: results,
        timestamp: new Date().toISOString()
      });
    } else {
      // Single enterprise
      const result = await calculateOEEv2(enterprise, site);
      res.json(result);
    }
  } catch (error) {
    console.error('OEE v2 query error:', error);
    // SECURITY: Don't leak internal error details to clients
    res.status(500).json({
      error: 'Failed to calculate OEE'
    });
  }
});

/**
 * GET /api/oee/discovery - Returns discovered OEE schema for all enterprises
 */
app.get('/api/oee/discovery', async (req, res) => {
  try {
    const discovered = await discoverOEESchema();
    res.json({
      enterprises: discovered,
      availableTiers: OEE_TIERS,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('OEE discovery error:', error);
    res.status(500).json({
      error: 'Failed to discover OEE schema',
      message: error.message
    });
  }
});

// NEW: Schema discovery endpoint - returns all measurements with metadata
app.get('/api/schema/measurements', async (req, res) => {
  try {
    // Try to refresh cache if needed
    try {
      await refreshSchemaCache();
    } catch (refreshError) {
      // If refresh fails but we have cached data, use it and log the error
      if (schemaCache.measurements.size > 0) {
        console.warn('Schema cache refresh failed, using stale cache:', refreshError.message);
      } else {
        // No cached data available, propagate the error
        throw refreshError;
      }
    }

    // Convert Map to array
    const measurements = Array.from(schemaCache.measurements.values());

    // Calculate summary statistics
    const totalDataPoints = measurements.reduce((sum, m) => sum + m.count, 0);

    const response = {
      measurements,
      summary: {
        totalMeasurements: measurements.length,
        dataPoints24h: totalDataPoints
      },
      cached: true,
      cacheAge: schemaCache.lastRefresh ? Date.now() - schemaCache.lastRefresh : 0
    };

    res.json(response);
  } catch (error) {
    console.error('Schema measurements query error:', error);
    res.status(500).json({
      error: 'Failed to query schema measurements',
      message: error.message
    });
  }
});

// NEW: Schema hierarchy endpoint - returns topic hierarchy tree
app.get('/api/schema/hierarchy', async (req, res) => {
  try {
    // Try to refresh cache if needed
    try {
      await refreshHierarchyCache();
    } catch (refreshError) {
      // If refresh fails but we have cached data, use it and log the error
      if (schemaCache.hierarchy) {
        console.warn('Hierarchy cache refresh failed, using stale cache:', refreshError.message);
      } else {
        // No cached data available, propagate the error
        throw refreshError;
      }
    }

    const response = {
      hierarchy: schemaCache.hierarchy || {},
      lastUpdated: schemaCache.lastHierarchyRefresh
        ? new Date(schemaCache.lastHierarchyRefresh).toISOString()
        : null,
      cached: true,
      cacheAge: schemaCache.lastHierarchyRefresh
        ? Date.now() - schemaCache.lastHierarchyRefresh
        : 0
    };

    res.json(response);
  } catch (error) {
    console.error('Schema hierarchy query error:', error);
    res.status(500).json({
      error: 'Failed to query schema hierarchy',
      message: error.message
    });
  }
});

// NEW: Equipment states endpoint - returns current equipment states
app.get('/api/equipment/states', async (req, res) => {
  try {
    const now = Date.now();
    const states = [];
    const summary = { running: 0, idle: 0, down: 0, unknown: 0 };

    // Convert Map to array with calculated durations
    for (const [key, stateData] of equipmentStateCache.states.entries()) {
      const durationMs = now - new Date(stateData.firstSeen).getTime();

      states.push({
        enterprise: stateData.enterprise,
        site: stateData.site,
        machine: stateData.machine,
        state: stateData.state,
        stateName: stateData.stateName,
        color: stateData.color,
        reason: stateData.reason,
        durationMs,
        durationFormatted: formatDuration(durationMs),
        lastUpdate: stateData.lastUpdate
      });

      // Update summary counts
      const stateName = stateData.stateName.toLowerCase();
      if (summary.hasOwnProperty(stateName)) {
        summary[stateName]++;
      } else {
        summary.unknown++;
      }
    }

    res.json({
      states,
      summary,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Equipment states query error:', error);
    res.status(500).json({
      error: 'Failed to query equipment states',
      message: error.message
    });
  }
});

// NEW: OEE lines endpoint - returns line-level OEE grouped by enterprise/site/area
app.get('/api/oee/lines', async (req, res) => {
  try {
    // SECURITY: Validate enterprise parameter
    const enterprise = validateEnterprise(req.query.enterprise);
    if (enterprise === null) {
      return res.status(400).json({ error: 'Invalid enterprise parameter' });
    }

    // Handle Enterprise C specially - it doesn't use OEE
    if (enterprise === 'Enterprise C') {
      return res.json({
        lines: [],
        message: 'Enterprise C (Bioprocessing) uses ISA-88 batch control metrics instead of OEE',
        timestamp: new Date().toISOString()
      });
    }

    // Build query with optional enterprise filter
    const enterpriseFilter = (enterprise && enterprise !== 'ALL')
      ? `|> filter(fn: (r) => r.enterprise == "${sanitizeInfluxIdentifier(enterprise)}")`
      : '';

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
        ${enterpriseFilter}
        |> group(columns: ["enterprise", "site", "area"])
        |> mean()
        |> yield(name: "mean_oee_by_line")
    `;

    const lines = [];

    await new Promise((resolve) => {
      queryApi.queryRows(fluxQuery, {
        next(row, tableMeta) {
          const o = tableMeta.toObject(row);
          if (o._value !== undefined && o.enterprise && o.site) {
            let oee = o._value;
            // Normalize to percentage
            if (oee > 0 && oee <= 1.5) {
              oee = oee * 100;
            }
            oee = Math.min(100, Math.max(0, oee));

            lines.push({
              enterprise: o.enterprise,
              site: o.site,
              line: o.area || 'unknown',
              oee: parseFloat(oee.toFixed(1)),
              // Infer component values (would need separate queries for actual values)
              availability: null,
              performance: null,
              quality: null,
              tier: 1 // Assume tier 1 since we're using direct OEE measurements
            });
          }
        },
        error(error) {
          console.error('OEE lines query error:', error);
          resolve();
        },
        complete() {
          resolve();
        }
      });
    });

    res.json({
      lines,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('OEE lines endpoint error:', error);
    res.status(500).json({
      error: 'Failed to query OEE lines',
      message: error.message
    });
  }
});

// NEW: Waste/Defect tracking endpoint
app.get('/api/waste/trends', async (req, res) => {
  try {
    const fluxQuery = `
      from(bucket: "factory")
        |> range(start: -24h)
        |> filter(fn: (r) => r._field == "value")
        |> filter(fn: (r) =>
          r._measurement == "OEE_Waste" or
          r._measurement == "Production_DefectCHK" or
          r._measurement == "Production_DefectDIM" or
          r._measurement == "Production_DefectSED" or
          r._measurement == "Production_RejectCount" or
          r._measurement == "count_defect" or
          r._measurement == "input_countdefect" or
          r._measurement == "workorder_quantitydefect" or
          r._measurement == "chrom_CHR01_WASTE_PV" or
          r._measurement == "edge_reject_gate_status"
        )
        |> filter(fn: (r) => r._value >= 0)
        |> group(columns: ["enterprise", "area", "_measurement"])
        |> aggregateWindow(every: 1h, fn: sum, createEmpty: false)
    `;

    const trends = [];
    const byEnterprise = {};
    const byLine = {};

    await new Promise((resolve) => {
      queryApi.queryRows(fluxQuery, {
        next(row, tableMeta) {
          const o = tableMeta.toObject(row);
          if (o._value !== undefined && o.enterprise && o._measurement) {
            const line = o.area || 'Unknown Line';
            const dataPoint = {
              time: o._time,
              enterprise: o.enterprise,
              line: line,
              value: parseFloat(o._value.toFixed(2)),
              measurement: o._measurement
            };
            trends.push(dataPoint);

            // Aggregate by enterprise for summary
            if (!byEnterprise[o.enterprise]) {
              byEnterprise[o.enterprise] = [];
            }
            byEnterprise[o.enterprise].push(o._value);

            // Aggregate by line for bar chart
            const lineKey = `${o.enterprise} - ${line}`;
            if (!byLine[lineKey]) {
              byLine[lineKey] = {
                enterprise: o.enterprise,
                line: line,
                values: []
              };
            }
            byLine[lineKey].values.push(o._value);
          }
        },
        error(error) {
          console.error('Waste trends query error:', error);
          resolve();
        },
        complete() {
          resolve();
        }
      });
    });

    // Calculate summary statistics and trends
    const summary = {};
    for (const [enterprise, values] of Object.entries(byEnterprise)) {
      const total = values.reduce((sum, v) => sum + v, 0);
      const avg = values.length > 0 ? total / values.length : 0;

      // Simple trend detection: compare first half vs second half
      const midpoint = Math.floor(values.length / 2);
      const firstHalf = values.slice(0, midpoint);
      const secondHalf = values.slice(midpoint);
      const firstAvg = firstHalf.length > 0 ? firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length : 0;
      const secondAvg = secondHalf.length > 0 ? secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length : 0;

      let trend = 'stable';
      if (secondAvg > firstAvg * 1.1) trend = 'rising';
      else if (secondAvg < firstAvg * 0.9) trend = 'falling';

      summary[enterprise] = {
        total: parseFloat(total.toFixed(2)),
        avg: parseFloat(avg.toFixed(2)),
        trend,
        dataPoints: values.length
      };
    }

    // Calculate by-line summary for bar chart
    const linesSummary = Object.values(byLine).map(line => ({
      enterprise: line.enterprise,
      line: line.line,
      total: parseFloat(line.values.reduce((sum, v) => sum + v, 0).toFixed(2)),
      avg: parseFloat((line.values.reduce((sum, v) => sum + v, 0) / line.values.length).toFixed(2)),
      dataPoints: line.values.length
    })).sort((a, b) => b.total - a.total); // Sort by total waste descending

    res.json({
      trends,
      summary,
      linesSummary,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Waste trends endpoint error:', error);
    res.status(500).json({
      error: 'Failed to query waste trends',
      message: error.message
    });
  }
});

// NEW: Waste by production line endpoint
app.get('/api/waste/by-line', async (req, res) => {
  try {
    const fluxQuery = `
      from(bucket: "factory")
        |> range(start: -24h)
        |> filter(fn: (r) => r._field == "value")
        |> filter(fn: (r) =>
          r._measurement == "OEE_Waste" or
          r._measurement == "Production_DefectCHK" or
          r._measurement == "Production_DefectDIM" or
          r._measurement == "Production_DefectSED" or
          r._measurement == "Production_RejectCount" or
          r._measurement == "count_defect" or
          r._measurement == "input_countdefect" or
          r._measurement == "workorder_quantitydefect" or
          r._measurement == "chrom_CHR01_WASTE_PV" or
          r._measurement == "edge_reject_gate_status"
        )
        |> filter(fn: (r) => r._value >= 0)
        |> group(columns: ["enterprise", "site", "area", "_measurement"])
        |> sum()
    `;

    const lineData = new Map(); // Map<lineKey, lineInfo>

    await new Promise((resolve) => {
      queryApi.queryRows(fluxQuery, {
        next(row, tableMeta) {
          const o = tableMeta.toObject(row);
          if (o._value !== undefined && o.enterprise && o.site && o.area && o._measurement) {
            const lineKey = `${o.enterprise}|${o.site}|${o.area}`;

            if (!lineData.has(lineKey)) {
              lineData.set(lineKey, {
                enterprise: o.enterprise,
                site: o.site,
                line: o.area,
                area: o.area,
                total: 0,
                measurements: []
              });
            }

            const line = lineData.get(lineKey);
            line.total += o._value;
            if (!line.measurements.includes(o._measurement)) {
              line.measurements.push(o._measurement);
            }
          }
        },
        error(error) {
          console.error('Waste by line query error:', error);
          resolve();
        },
        complete() {
          resolve();
        }
      });
    });

    // Convert Map to array and sort by total descending (worst lines first)
    const lines = Array.from(lineData.values())
      .map(line => ({
        ...line,
        total: parseFloat(line.total.toFixed(2))
      }))
      .sort((a, b) => b.total - a.total);

    res.json({
      lines,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Waste by line endpoint error:', error);
    res.status(500).json({
      error: 'Failed to query waste by line',
      message: error.message
    });
  }
});

// =============================================================================
// CMMS INTEGRATION ENDPOINTS
// =============================================================================

/**
 * GET /api/cmms/work-orders - List recent work orders from CMMS
 * Query params:
 *   - limit: Number of work orders to return (default: 10, max: 50)
 */
app.get('/api/cmms/work-orders', async (req, res) => {
  try {
    if (!cmmsProvider || !cmmsProvider.isEnabled()) {
      return res.status(503).json({
        error: 'CMMS integration is not enabled',
        enabled: false
      });
    }

    // Validate limit parameter
    let limit = parseInt(req.query.limit) || 10;
    if (isNaN(limit) || limit < 1) limit = 10;
    if (limit > 50) limit = 50;

    const workOrders = await cmmsProvider.listRecentWorkOrders(limit);

    res.json({
      provider: cmmsProvider.getProviderName(),
      workOrders,
      count: workOrders.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('CMMS work orders endpoint error:', error);
    res.status(500).json({
      error: 'Failed to retrieve work orders',
      message: error.message
    });
  }
});

/**
 * GET /api/cmms/work-orders/:id - Get specific work order status
 */
app.get('/api/cmms/work-orders/:id', async (req, res) => {
  try {
    if (!cmmsProvider || !cmmsProvider.isEnabled()) {
      return res.status(503).json({
        error: 'CMMS integration is not enabled',
        enabled: false
      });
    }

    const workOrderId = req.params.id;
    if (!workOrderId || typeof workOrderId !== 'string' || workOrderId.length > 100) {
      return res.status(400).json({ error: 'Invalid work order ID' });
    }
    // Sanitize: only allow alphanumeric and common separators
    if (!/^[a-zA-Z0-9_-]+$/.test(workOrderId)) {
      return res.status(400).json({ error: 'Invalid work order ID format' });
    }

    const status = await cmmsProvider.getWorkOrderStatus(workOrderId);

    res.json({
      provider: cmmsProvider.getProviderName(),
      workOrder: status,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('CMMS work order status endpoint error:', error);
    res.status(500).json({
      error: 'Failed to retrieve work order status',
      message: error.message
    });
  }
});

/**
 * GET /api/cmms/health - Check CMMS provider health
 */
app.get('/api/cmms/health', async (req, res) => {
  if (!cmmsProvider) {
    return res.json({
      enabled: false,
      healthy: false,
      message: 'CMMS provider not configured'
    });
  }

  try {
    const health = await cmmsProvider.healthCheck();

    res.json({
      enabled: cmmsProvider.isEnabled(),
      ...health,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    res.status(500).json({
      enabled: cmmsProvider.isEnabled(),
      healthy: false,
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// NEW: Agent context endpoint - comprehensive data for agentic workflows
// Uses Promise.allSettled() for resilience when InfluxDB or other services are unavailable
app.get('/api/agent/context', async (req, res) => {
  // Track data source availability
  const dataSourceStatus = {
    mqtt: mqttClient.connected,
    influxdb: true // Assume true, will be set to false if queries fail
  };

  // Helper to extract result from Promise.allSettled
  const extractResult = (result, defaultValue = null) => {
    if (result.status === 'fulfilled') {
      return { data: result.value, status: 'available' };
    } else {
      console.warn('Agent context partial failure:', result.reason?.message || result.reason);
      dataSourceStatus.influxdb = false;
      return { data: defaultValue, status: 'unavailable', error: result.reason?.message };
    }
  };

  // Equipment states are in-memory, always available
  const getEquipmentStates = () => {
    const states = [];
    const now = Date.now();
    for (const [key, stateData] of equipmentStateCache.states.entries()) {
      states.push({
        ...stateData,
        durationMs: now - new Date(stateData.firstSeen).getTime(),
        durationFormatted: formatDuration(now - new Date(stateData.firstSeen).getTime())
      });
    }
    return states;
  };

  // Recent insights are in-memory, always available
  const getRecentInsights = () => factoryState.trendInsights.slice(-5);

  // Gather all data in parallel using allSettled for resilience
  const results = await Promise.allSettled([
    // 0: Hierarchy (requires InfluxDB)
    (async () => {
      await refreshHierarchyCache();
      return schemaCache.hierarchy;
    })(),
    // 1: Measurements (requires InfluxDB)
    (async () => {
      await refreshSchemaCache();
      return Array.from(schemaCache.measurements.values());
    })(),
    // 2: OEE data (requires InfluxDB)
    (async () => {
      await discoverOEESchema();
      const enterprises = Object.keys(oeeConfig.enterprises);
      const results = await Promise.all(
        enterprises.map(ent => calculateOEEv2(ent, null))
      );
      return results;
    })(),
    // 3: Trends (requires InfluxDB)
    queryTrends()
  ]);

  // Extract results with fallbacks
  const hierarchyResult = extractResult(results[0], null);
  const measurementsResult = extractResult(results[1], []);
  const oeeResult = extractResult(results[2], []);
  const trendsResult = extractResult(results[3], []);

  // Equipment states and insights are always available (in-memory)
  const equipmentStates = getEquipmentStates();
  const recentInsights = getRecentInsights();

  // Build response with status indicators for each section
  const response = {
    timestamp: new Date().toISOString(),
    factory: {
      hierarchy: hierarchyResult.data,
      measurements: measurementsResult.data ? {
        list: measurementsResult.data,
        count: measurementsResult.data.length
      } : null,
      status: hierarchyResult.status === 'available' && measurementsResult.status === 'available'
        ? 'available' : 'unavailable'
    },
    equipment: {
      states: equipmentStates,
      summary: {
        running: equipmentStates.filter(s => s.stateName === 'RUNNING').length,
        idle: equipmentStates.filter(s => s.stateName === 'IDLE').length,
        down: equipmentStates.filter(s => s.stateName === 'DOWN').length,
        total: equipmentStates.length
      },
      status: 'available' // Always available (in-memory)
    },
    performance: {
      oee: oeeResult.data,
      status: oeeResult.status
    },
    trends: {
      recent: trendsResult.data ? trendsResult.data.slice(0, 50) : null,
      status: trendsResult.status
    },
    insights: {
      recent: recentInsights,
      status: 'available' // Always available (in-memory)
    },
    meta: {
      enterprises: ENTERPRISE_DOMAIN_CONTEXT,
      measurementClassifications: MEASUREMENT_CLASSIFICATIONS
    },
    dataSourceStatus
  };

  // Always return 200 with whatever data is available
  res.json(response);
});

// NEW: Schema classifications endpoint - returns measurements grouped by classification
app.get('/api/schema/classifications', async (req, res) => {
  try {
    // Try to refresh cache if needed
    try {
      await refreshSchemaCache();
    } catch (refreshError) {
      // If refresh fails but we have cached data, use it and log the error
      if (schemaCache.measurements.size > 0) {
        console.warn('Schema cache refresh failed, using stale cache:', refreshError.message);
      } else {
        // No cached data available, propagate the error
        throw refreshError;
      }
    }

    // Group measurements by classification
    const classifications = {};
    const summary = {};

    // Initialize all classification categories
    Object.keys(MEASUREMENT_CLASSIFICATIONS).forEach(classification => {
      classifications[classification] = [];
      summary[classification] = 0;
    });

    // Add dynamically discovered categories
    classifications.percentage_metric = [];
    summary.percentage_metric = 0;
    classifications.unknown = [];
    summary.unknown = 0;

    // Iterate through measurements and group by classification
    for (const measurement of schemaCache.measurements.values()) {
      const classification = measurement.classification || 'unknown';

      // Initialize classification if not exists
      if (!classifications[classification]) {
        classifications[classification] = [];
        summary[classification] = 0;
      }

      classifications[classification].push(measurement.name);
      summary[classification]++;
    }

    const response = {
      classifications,
      summary,
      totalMeasurements: schemaCache.measurements.size,
      cached: true,
      cacheAge: schemaCache.lastRefresh ? Date.now() - schemaCache.lastRefresh : 0
    };

    res.json(response);
  } catch (error) {
    console.error('Schema classifications query error:', error);
    res.status(500).json({
      error: 'Failed to query schema classifications',
      message: error.message
    });
  }
});

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

// Start HTTP server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🏭 MQTT: ${mqttClient.connected ? 'Connected' : 'Connecting...'}`);
  console.log(`📈 InfluxDB: ${CONFIG.influxdb.url}`);
  if (CONFIG.disableInsights) {
    console.log(`🤖 AI Insights: DISABLED (MQTT data collection only)`);
  } else {
    console.log(`🤖 AWS Bedrock: ${CONFIG.bedrock.region} / ${CONFIG.bedrock.modelId}`);
    console.log(`🤖 AI Insights: ENABLED (trend analysis every ${TREND_ANALYSIS_INTERVAL / 1000}s)`);
  }
});

const wss = new WebSocket.Server({ server, path: '/ws' });

// WebSocket connection handler
wss.on('connection', (ws) => {
  console.log('👋 Frontend connected');

  ws.send(JSON.stringify({
    type: 'initial_state',
    data: {
      recentMessages: factoryState.messages.slice(-20),
      recentInsights: factoryState.trendInsights.slice(-5),
      recentAnomalies: factoryState.anomalies.slice(-10),
      stats: factoryState.stats,
      insightsEnabled: !CONFIG.disableInsights,
      anomalyFilters: factoryState.anomalyFilters
    }
  }));

  ws.on('message', (message) => {
    try {
      // SECURITY: Limit message size to prevent DoS
      if (message.length > 10000) {
        ws.send(JSON.stringify({ type: 'error', error: 'Message too large' }));
        return;
      }

      const request = JSON.parse(message);
      handleClientRequest(ws, request);
    } catch (error) {
      console.error('Invalid client message:', error.message);
      ws.send(JSON.stringify({ type: 'error', error: 'Invalid JSON format' }));
    }
  });

  ws.on('close', () => {
    console.log('👋 Frontend disconnected');
  });
});

// Graceful shutdown
async function shutdown(signal) {
  console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);

  const timeout = setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);

  try {
    await writeApi.close();
    mqttClient.end();
    wss.close();
    server.close();
    clearTimeout(timeout);
    process.exit(0);
  } catch (err) {
    console.error('Error during shutdown:', err);
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
