// server.js - Factory Intelligence Backend with InfluxDB + Agentic Claude
const mqtt = require('mqtt');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const WebSocket = require('ws');
const express = require('express');
const { InfluxDB, Point } = require('@influxdata/influxdb-client');

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
  disableInsights: process.env.DISABLE_INSIGHTS === 'true'
};

// Initialize services
const app = express();
const bedrockClient = new BedrockRuntimeClient({ region: CONFIG.bedrock.region });

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

/**
 * Sanitizes InfluxDB identifiers to prevent Flux query injection.
 * Removes potentially dangerous characters like quotes and backslashes.
 * @param {string} identifier - The identifier to sanitize
 * @returns {string} Sanitized identifier
 */
function sanitizeInfluxIdentifier(identifier) {
  return identifier.replace(/["\\]/g, '');
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
    }

  } catch (error) {
    console.error('❌ Trend analysis error:', error.message);
  }
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

async function analyzeTreesWithClaude(trends) {
  // Summarize trends for Claude
  const trendSummary = summarizeTrends(trends);

  const prompt = `You are an AI factory monitoring agent analyzing time-series trend data from a manufacturing facility.

## Current Trend Data (Last 5 Minutes, 1-Minute Aggregates)

${trendSummary}

## Your Task

Analyze these trends and provide:
1. **Summary**: A 1-2 sentence overview of factory performance
2. **Trends**: Key metrics that are rising, falling, or stable
3. **Anomalies**: Any concerning patterns (sudden changes, values outside normal range)
4. **Recommendations**: Actionable suggestions for operators

Respond in JSON format:
{
  "summary": "brief overview",
  "trends": [{"metric": "name", "direction": "rising|falling|stable", "change_percent": 0}],
  "anomalies": ["list of concerns"],
  "recommendations": ["list of actions"],
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
  switch (request.type) {
    case 'get_stats':
      ws.send(JSON.stringify({
        type: 'stats_response',
        data: factoryState.stats
      }));
      break;

    case 'ask_claude':
      askClaudeWithContext(request.question).then(answer => {
        ws.send(JSON.stringify({
          type: 'claude_response',
          data: { question: request.question, answer }
        }));
      });
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
    await influxDB.ping();
    influxOk = true;
  } catch (e) {}

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
    const enterprise = req.query.enterprise || 'ALL';
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
    const enterprise = req.query.enterprise || 'ALL';
    const site = req.query.site || null;

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
    res.status(500).json({
      error: 'Failed to calculate OEE',
      message: error.message
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
      stats: factoryState.stats
    }
  }));

  ws.on('message', (message) => {
    try {
      const request = JSON.parse(message);
      handleClientRequest(ws, request);
    } catch (error) {
      console.error('Invalid client message:', error);
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
