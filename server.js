// server.js - Factory Intelligence Backend with InfluxDB + Agentic Claude
const mqtt = require('mqtt');
const { BedrockRuntimeClient } = require('@aws-sdk/client-bedrock-runtime');
const WebSocket = require('ws');
const express = require('express');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const { influxDB, writeApi, queryApi, Point, parseTopicToInflux, writeSparkplugMetric } = require('./lib/influx/client');
const { createCmmsProvider } = require('./lib/cmms-interface');
const aiModule = require('./lib/ai');
const vectorStore = require('./lib/vector');
const { isSparkplugTopic, decodePayload, extractMetrics } = require('./lib/sparkplug/decoder');
const { createAgentCoreClient } = require('./lib/agentcore');
const demoEngine = require('./lib/demo/engine');

// Foundation modules
const CONFIG = require('./lib/config');
const { factoryState, schemaCache, equipmentStateCache } = require('./lib/state');
const {
  sanitizeInfluxIdentifier,
  formatDuration,
  validateEnterprise,
  validateSite,
  extractMeasurementFromTopic,
  VALID_WS_MESSAGE_TYPES,
  MAX_INPUT_LENGTH
} = require('./lib/validation');
const {
  MEASUREMENT_CLASSIFICATIONS,
  ENTERPRISE_DOMAIN_CONTEXT,
  getEnterpriseContext
} = require('./lib/domain-context');
const { refreshSchemaCache, refreshHierarchyCache, classifyMeasurementDetailed } = require('./lib/schema');
const {
  OEE_TIERS,
  oeeConfig,
  discoverOEESchema,
  calculateOEEv2,
  queryOEE,
  queryOEEBreakdown,
  queryFactoryStatus
} = require('./lib/oee');
const { getEquipmentMetadata, resolveEquipmentId } = require('./lib/equipment');

// Initialize services
const app = express();

// Format tool names for user-friendly display
// Base labels - tool name without prefix
const TOOL_LABELS = {
  'getBatchStatus': 'Checking batch status',
  'getCmmsHealth': 'Checking CMMS connection',
  'getCmmsWorkOrders': 'Fetching work orders',
  'getCmmsWorkOrder': 'Fetching work order details',
  'getEquipmentStates': 'Checking equipment status',
  'getFactoryStatus': 'Getting factory status',
  'getOEEBreakdown': 'Analyzing OEE breakdown',
  'getOEEDiscovery': 'Discovering OEE schema',
  'getOEELines': 'Fetching line OEE',
  'getOEEv2': 'Calculating OEE',
  'getSchemaClassifications': 'Loading classifications',
  'getSchemaHierarchy': 'Loading factory hierarchy',
  'getSchemaMeasurements': 'Loading measurements',
  'getTrends': 'Loading trend data',
  'getWasteBreakdown': 'Analyzing waste data',
  'getWasteByLine': 'Analyzing waste by line',
  'getWasteTrends': 'Analyzing waste trends',
  'retrieve': 'Searching knowledge base'
};
function formatToolName(name) {
  // Strip deployed prefix, then lookup
  const baseName = name.replace(/^factory-api___/, '');
  return TOOL_LABELS[baseName] || baseName.replace(/([A-Z])/g, ' $1').trim();
}

// Parse SSE stream and transform tool_use events
function parseToolStream(line, res) {
  if (!line.startsWith('data: ')) return;
  const content = line.slice(6).trim();
  if (!content) return;
  try {
    let parsed = JSON.parse(content);
    // Handle double-encoded JSON
    if (typeof parsed === 'string' && parsed.startsWith('{')) {
      try { parsed = JSON.parse(parsed); } catch {}
    }
    if (parsed.type === 'tool_use') {
      res.write(`data: ${JSON.stringify({ type: 'tool', name: formatToolName(parsed.name || 'tool') })}\n\n`);
    } else if (typeof parsed === 'string') {
      res.write(`data: ${JSON.stringify(parsed)}\n\n`);
    } else if (parsed.text || parsed.content) {
      res.write(`data: ${JSON.stringify(parsed.text || parsed.content)}\n\n`);
    }
  } catch {
    res.write(`data: ${JSON.stringify(content)}\n\n`);
  }
}

// OpenAPI spec generation using swagger-jsdoc for inline annotations
const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'EdgeMind Factory Intelligence API',
      version: '2.0.0',
      description: 'Real-time factory monitoring API for OEE analysis, equipment health, waste tracking, and batch processing. Supports three enterprises: A & B (discrete manufacturing with OEE) and C (pharmaceutical bioprocessing with ISA-88 batch control).'
    },
    servers: [
      { url: 'http://localhost:3000', description: 'Local' },
      { url: 'https://dev.edge-mind.concept-reply-sandbox.com', description: 'Dev' },
      { url: 'https://edge-mind.concept-reply-sandbox.com', description: 'Prod' }
    
    ],
    tags: [
      { name: 'oee', description: 'Overall Equipment Effectiveness (Availability × Performance × Quality). World-class target: 85%' },
      { name: 'equipment', description: 'Equipment states: RUNNING, IDLE, DOWN, MAINTENANCE' },
      { name: 'waste', description: 'Waste tracking. Enterprise A codes: CHK, DIM, SED. Enterprise B: SEAL, LABEL, FILL' },
      { name: 'batch', description: 'ISA-88 batch control for Enterprise C pharmaceutical bioprocessing' },
      { name: 'schema', description: 'Factory schema discovery: Enterprise > Site > Area > Machine' },
      { name: 'cmms', description: 'Maintenance management system integration' }
    ]
  },
  apis: ['./server.js', './lib/**/*.js']
});

app.get('/api/api-spec/v3', (req, res) => res.json(swaggerSpec));
app.get('/api/api-spec', (req, res) => res.json(swaggerSpec));
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

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

// Initialize Bedrock client
const bedrockClient = new BedrockRuntimeClient({ region: CONFIG.bedrock.region });


// Serve static files (frontend HTML)
app.use(express.static(__dirname));

// InfluxDB client, writeApi, and queryApi are now imported from './lib/influx/client'

// Agentic loop state — intervals now configured via env vars in lib/state.js (ADR-016)
// Tier 1: AGENT_CHECK_INTERVAL_MS (default 120000 = 2 min)
// Tier 3: AGENT_SUMMARY_INTERVAL_MS (default 900000 = 15 min)

// Connect to MQTT broker
console.log('🏭 Connecting to ProveIt! Virtual Factory...');
const mqttClient = mqtt.connect(CONFIG.mqtt.host, {
  clientId: `edgemind-${require('os').hostname()}-${process.pid}`,
  username: CONFIG.mqtt.username,
  password: CONFIG.mqtt.password,
  reconnectPeriod: 5000,
  clean: false
});

// Guard flag to prevent duplicate initialization on reconnect
let initialized = false;

mqttClient.on('connect', async () => {
  console.log('✅ Connected to MQTT broker!');

  // Always re-subscribe on reconnect
  CONFIG.mqtt.topics.forEach(topic => {
    mqttClient.subscribe(topic, (err) => {
      if (!err) console.log(`📡 Subscribed to: ${topic}`);
    });
  });

  // Only initialize once
  if (initialized) {
    console.log('♻️ Reconnected — skipping initialization');
    return;
  }
  initialized = true;

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

  // Initialize vector store for anomaly persistence (RAG)
  try {
    await vectorStore.init({ bedrockClient });
  } catch (vectorError) {
    console.warn('Vector store initialization failed (continuing without RAG):', vectorError.message);
  }

  // Initialize AI module with runtime dependencies
  aiModule.init({
    broadcast: broadcastToClients,
    cmms: cmmsProvider,
    bedrockClient,
    vectorStore
  });

  // Start the agentic trend analysis loop
  aiModule.startAgenticLoop();

  // Initialize demo engine with MQTT client
  demoEngine.init({ mqttClient });
});

mqttClient.on('error', (error) => {
  console.error('❌ MQTT Error:', error);
});

// parseTopicToInflux is now imported from './lib/influx/client'

// Handle incoming MQTT messages
mqttClient.on('message', async (topic, message) => {
  const timestamp = new Date().toISOString();

  factoryState.stats.messageCount++;
  factoryState.stats.lastUpdate = timestamp;

  // DEMO DATA NAMESPACE INTERCEPT
  // Check if this is demo-injected data (namespace at position [1] after enterprise)
  let isInjected = false;
  let actualTopic = topic;
  const DEMO_NS = CONFIG.demo?.namespace || 'concept-reply';
  const topicParts = topic.split('/');
  if (topicParts.length > 2 && topicParts[1] === DEMO_NS) {
    isInjected = true;
    topicParts.splice(1, 1);
    actualTopic = topicParts.join('/');
    console.log(`[DEMO] Intercepted demo data: ${topic} -> ${actualTopic}`);
  }

  // SPARKPLUG B PROTOCOL HANDLING
  // Check if this is a Sparkplug B message (topic starts with spBv1.0/)
  if (isSparkplugTopic(actualTopic)) {
    try {
      // Decode the Sparkplug protobuf payload
      const decodedPayload = decodePayload(message);

      // Extract normalized metrics from the payload
      const metrics = extractMetrics(actualTopic, decodedPayload);

      // Write each metric to InfluxDB
      for (const metric of metrics) {
        try {
          const point = writeSparkplugMetric(metric);
          writeApi.writePoint(point);
          factoryState.stats.influxWrites++;
        } catch (writeError) {
          factoryState.stats.influxWriteErrors = (factoryState.stats.influxWriteErrors || 0) + 1;
          if (factoryState.stats.influxWriteErrors % 100 === 1) {
            console.error(`Sparkplug metric write error: ${writeError.message}`);
          }
        }
      }

      // Broadcast to WebSocket clients (throttled - every 10th message)
      if (factoryState.stats.messageCount % 10 === 0 && metrics.length > 0) {
        // Format Sparkplug message for frontend display
        const displayMetrics = metrics.slice(0, 5).map(m =>
          `${m.name}=${m.value} (${m.valueType})`
        ).join(', ');

        broadcastToClients({
          type: 'mqtt_message',
          data: {
            timestamp,
            topic: actualTopic,
            payload: `[Sparkplug B] ${metrics.length} metrics: ${displayMetrics}${metrics.length > 5 ? '...' : ''}`,
            id: `msg_${Date.now()}_${Math.random()}`,
            protocol: 'sparkplug_b',
            isInjected
          }
        });
      }

      // Early return - skip JSON processing for Sparkplug messages
      return;

    } catch (sparkplugError) {
      // Log Sparkplug decoding errors but don't crash
      console.error(`Sparkplug decode error for topic ${topic}:`, sparkplugError.message);
      return; // EXIT EARLY - don't try JSON parsing on binary data
    }
  }

  // STANDARD JSON/TEXT PROCESSING (non-Sparkplug messages)
  const payload = message.toString();

  const mqttMessage = {
    timestamp,
    topic: actualTopic,
    payload,
    id: `msg_${Date.now()}_${Math.random()}`,
    isInjected
  };

  // Phase 4: Detect new measurements
  const measurement = extractMeasurementFromTopic(actualTopic);
  if (measurement && !schemaCache.knownMeasurements.has(measurement)) {
    schemaCache.knownMeasurements.add(measurement);

    const isNumeric = !isNaN(parseFloat(payload));
    const sampleValue = isNumeric ? parseFloat(payload) : payload;

    // Broadcast new measurement to WebSocket clients
    broadcastToClients({
      type: 'new_measurement',
      data: {
        measurement,
        topic: actualTopic,
        firstSeen: timestamp,
        sampleValue: payload.substring(0, 100),
        valueType: isNumeric ? 'numeric' : 'string',
        classification: classifyMeasurementDetailed(
          measurement,
          isNumeric ? 'numeric' : 'string',
          isNumeric ? [sampleValue] : []
        ),
        isInjected
      }
    });

    console.log(`[SCHEMA] New measurement detected: ${measurement} from topic: ${actualTopic}`);
  }

  // Detect and cache equipment state changes
  const topicLower = actualTopic.toLowerCase();
  if (topicLower.includes('statecurrent') || (topicLower.includes('state') && !topicLower.includes('statereason'))) {
    const parts = actualTopic.split('/');
    if (parts.length >= 3) {
      const enterprise = parts[0];
      const site = parts[1];

      // Extract machine name - try multiple strategies
      let machine = parts.length >= 4 ? parts[3] : parts[2];

      // For Enterprise C ISA-88 equipment, extract equipment ID from measurement name
      // Measurement names like CHR01_STATE, SUB250_STATE contain the equipment ID
      const measurementName = parts[parts.length - 1];
      const equipmentNormalization = {
        'UNIT_250': 'SUB250',
        'UNIT_500': 'SUM500'
      };
      const equipmentPatterns = ['CHR01', 'SUB250', 'SUM500', 'TFF300', 'UNIT_250', 'UNIT_500'];
      for (const pattern of equipmentPatterns) {
        if (measurementName.includes(pattern)) {
          machine = equipmentNormalization[pattern] || pattern;
          break;
        }
      }

      const equipmentKey = `${enterprise}/${site}/${machine}`;

      // Parse state value - support both numeric (1=DOWN, 2=IDLE, 3=RUNNING) and string values
      let stateValue = null;
      let stateInfo = null;

      // Extract actual value from JSON payloads (Enterprise C sends {"value":"Idle"} format)
      let actualPayload = payload;
      if (typeof payload === 'string' && payload.startsWith('{')) {
        try {
          const parsed = JSON.parse(payload);
          if (parsed && typeof parsed === 'object' && 'value' in parsed) {
            // Handle <nil> as null (skip state detection for nil values)
            actualPayload = parsed.value === '<nil>' ? null : parsed.value;
          }
        } catch {
          // Not valid JSON, use raw payload
        }
      }

      const numValue = parseInt(actualPayload);
      if (!isNaN(numValue) && equipmentStateCache.STATE_CODES[numValue]) {
        stateValue = numValue;
        stateInfo = equipmentStateCache.STATE_CODES[numValue];
      } else {
        // Check for string state values
        const payloadLower = String(actualPayload).toLowerCase();
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
    const options = isInjected ? { source: 'demo-injected' } : {};
    const point = parseTopicToInflux(actualTopic, payload, options);
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

// Clean up stale equipment state cache entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, stateData] of equipmentStateCache.states.entries()) {
    const lastUpdateMs = new Date(stateData.lastUpdate).getTime();
    if (now - lastUpdateMs > equipmentStateCache.CACHE_TTL_MS) {
      equipmentStateCache.states.delete(key);
      console.log(`[STATE] Evicted stale equipment: ${key}`);
    }
  }
}, 60000); // Clean up every minute

// =============================================================================
// AGENTIC TREND ANALYSIS LOOP - Now handled by lib/ai module
// =============================================================================

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

      aiModule.askClaudeWithContext(request.question).then(answer => {
        ws.send(JSON.stringify({
          type: 'claude_response',
          data: { question: request.question, answer }
        }));
      }).catch(error => {
        console.error('Error processing Claude question:', error.message);
        ws.send(JSON.stringify({
          type: 'claude_response',
          data: { question: request.question, answer: 'Sorry, I encountered an error processing your question. Please try again.' }
        }));
      });
      break;

    case 'update_anomaly_filter':
      // SECURITY: Validate filters parameter
      if (!request.filters || !Array.isArray(request.filters)) {
        ws.send(JSON.stringify({ type: 'error', error: 'Missing or invalid filters array' }));
        return;
      }
      {
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
/**
 * @swagger
 * /api/trends:
 *   get:
 *     operationId: getTrends
 *     summary: Get 5-minute rolling window of factory metrics
 *     description: Returns recent time-series data from all factory measurements for trend analysis.
 *     tags: [trends]
 *     responses:
 *       200:
 *         description: Array of trend data points
 */
app.get('/api/trends', async (req, res) => {
  const trends = await aiModule.queryTrends();
  res.json(trends);
});
// Shared AgentCore Runtime client
const agentRuntime = require('./lib/agentcore/runtime');
const invokeAgent = agentRuntime.invoke;
const useAgentCoreRuntime = agentRuntime.useRuntime;

// Chat handler for /api/agent/chat
async function handleChat(req, res) {
  const { prompt, sessionId, messages } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  try {
    const result = await invokeAgent('chat', prompt, sessionId, true, messages); // stream=true
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    if (result.isRuntime && result.isStream) {
      res.setHeader('X-Session-Id', result.sessionId);
      for await (const chunk of result.stream) {
        if (chunk) {
          const raw = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
          for (const line of raw.split('\n')) parseToolStream(line, res);
        }
      }
      res.write(`data: [DONE]\n\n`);
      res.end();
    } else if (result.isRuntime) {
      res.json({ response: result.output, sessionId: result.sessionId });
    } else {
      const response = result.response;
      if (!response.ok) throw new Error(`Agent error: ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of decoder.decode(value, { stream: true }).split('\n')) parseToolStream(line, res);
      }
      res.end();
    }
  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

app.post('/api/agent/chat', express.json(), handleChat);

// API endpoint to get threshold settings
app.get('/api/settings', (req, res) => {
  res.json(factoryState.thresholdSettings);
});

// API endpoint to update threshold settings
app.post('/api/settings', express.json(), (req, res) => {
  try {
    const { oeeBaseline, oeeWorldClass, availabilityMin, defectRateWarning, defectRateCritical } = req.body;

    // Validate all values are numbers between 0-100
    const values = { oeeBaseline, oeeWorldClass, availabilityMin, defectRateWarning, defectRateCritical };
    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined) {
        const num = Number(value);
        if (isNaN(num) || num < 0 || num > 100) {
          return res.status(400).json({ error: `Invalid ${key}: must be 0-100` });
        }
        factoryState.thresholdSettings[key] = num;
      }
    }

    // Broadcast updated settings to all WebSocket clients
    broadcastToClients({
      type: 'settings_updated',
      data: factoryState.thresholdSettings
    });

    console.log('[SETTINGS] Updated thresholds:', factoryState.thresholdSettings);
    res.json(factoryState.thresholdSettings);
  } catch (error) {
    console.error('Settings update error:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
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

/**
 * @swagger
 * /api/oee/breakdown:
 *   get:
 *     operationId: getOEEBreakdown
 *     summary: Get OEE breakdown by enterprise
 *     description: Returns OEE metrics grouped by enterprise for comparison across the organization.
 *     tags: [oee]
 *     responses:
 *       200:
 *         description: OEE breakdown by enterprise
 *       500:
 *         description: Server error
 */
app.get('/api/oee/breakdown', async (req, res) => {
  try {
    const breakdown = await queryOEEBreakdown();
    res.json(breakdown);
  } catch (error) {
    console.error('OEE breakdown query error:', error);
    res.status(500).json({ error: 'Failed to query OEE breakdown' });
  }
});

/**
 * @swagger
 * /api/factory/status:
 *   get:
 *     operationId: getFactoryStatus
 *     summary: Get hierarchical factory OEE status
 *     description: Returns OEE status organized by enterprise and site hierarchy. Use this for a high-level overview of all factory operations.
 *     tags: [oee]
 *     responses:
 *       200:
 *         description: Hierarchical OEE status by enterprise and site
 */
app.get('/api/factory/status', async (req, res) => {
  try {
    // SECURITY: Validate enterprise parameter
    const enterprise = validateEnterprise(req.query.enterprise);
    if (enterprise === null) {
      return res.status(400).json({ error: 'Invalid enterprise parameter' });
    }

    const status = await queryFactoryStatus(enterprise);
    res.json(status);
  } catch (error) {
    console.error('Factory status query error:', error);
    res.status(500).json({ error: 'Failed to query factory status' });
  }
});

/**
 * @swagger
 * /api/oee/v2:
 *   get:
 *     operationId: getOEEv2
 *     summary: Enhanced OEE with tier-based calculation
 *     description: Advanced OEE calculation using tier-based strategy. Returns detailed breakdown of availability (uptime vs planned time), performance (actual vs ideal cycle time), and quality (good units vs total). Identifies the limiting factor.
 *     tags: [oee]
 *     parameters:
 *       - in: query
 *         name: enterprise
 *         schema:
 *           type: string
 *           enum: [Enterprise A, Enterprise B, ALL]
 *         description: Filter by enterprise (default ALL)
 *       - in: query
 *         name: site
 *         schema:
 *           type: string
 *         description: Optional site filter (e.g., Dallas, Chicago)
 *     responses:
 *       200:
 *         description: Detailed OEE with component breakdown and confidence score
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
 * @swagger
 * /api/oee/discovery:
 *   get:
 *     operationId: getOEEDiscovery
 *     summary: Get discovered OEE schema for all enterprises
 *     description: Returns auto-discovered OEE measurement mappings and calculation tiers for each enterprise.
 *     tags: [oee]
 *     responses:
 *       200:
 *         description: OEE discovery schema with available tiers
 *       500:
 *         description: Server error
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

/**
 * @swagger
 * /api/schema/measurements:
 *   get:
 *     operationId: getSchemaMeasurements
 *     summary: Get all available measurements with metadata
 *     description: Lists all measurements discovered from MQTT topics with their data types, last values, and update timestamps. Cached for 5 minutes. Use this to understand what data is available in the factory.
 *     tags: [schema]
 *     responses:
 *       200:
 *         description: Array of measurements with metadata
 */
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

/**
 * @swagger
 * /api/schema/hierarchy:
 *   get:
 *     operationId: getSchemaHierarchy
 *     summary: Get topic hierarchy tree
 *     description: Returns the factory schema organized as Enterprise > Site > Area > Machine hierarchy.
 *     tags: [schema]
 *     responses:
 *       200:
 *         description: Hierarchical schema tree with cache metadata
 *       500:
 *         description: Server error
 */
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

/**
 * @swagger
 * /api/equipment/states:
 *   get:
 *     operationId: getEquipmentStates
 *     summary: Get current equipment states across all enterprises
 *     description: Returns real-time equipment states (RUNNING, IDLE, DOWN, MAINTENANCE) with downtime duration. Critical for identifying production bottlenecks. DOWN equipment should be prioritized for investigation.
 *     tags: [equipment]
 *     responses:
 *       200:
 *         description: List of equipment with current state, duration, and summary counts
 */
app.get('/api/equipment/states', async (req, res) => {
  try {
    // SECURITY: Validate enterprise parameter
    const enterprise = validateEnterprise(req.query.enterprise);
    if (enterprise === null) {
      return res.status(400).json({ error: 'Invalid enterprise parameter' });
    }

    const now = Date.now();
    const states = [];
    const summary = { running: 0, idle: 0, down: 0, unknown: 0 };

    // Convert Map to array with calculated durations
    for (const stateData of equipmentStateCache.states.values()) {
      // Filter by enterprise if specified
      if (enterprise && enterprise !== 'ALL' && stateData.enterprise !== enterprise) {
        continue;
      }

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
      if (Object.prototype.hasOwnProperty.call(summary, stateName)) {
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

/**
 * @swagger
 * /api/oee/lines:
 *   get:
 *     operationId: getOEELines
 *     summary: Get OEE metrics per production line
 *     description: Returns OEE for each production line with status classification. Healthy (≥85%), Warning (70-84%), Critical (<70%). Use this to identify underperforming lines that need attention.
 *     tags: [oee]
 *     parameters:
 *       - in: query
 *         name: enterprise
 *         schema:
 *           type: string
 *           enum: [Enterprise A, Enterprise B, ALL]
 *         description: Filter by enterprise
 *     responses:
 *       200:
 *         description: Array of production lines with OEE metrics and status
 */
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

    // Single query with pivot to get OEE + A/P/Q in one shot
    const fluxQuery = `
      from(bucket: "${CONFIG.influxdb.bucket}")
        |> range(start: -24h)
        |> filter(fn: (r) => r._field == "value")
        |> filter(fn: (r) =>
          r._measurement == "OEE_Performance" or
          r._measurement == "OEE_Availability" or
          r._measurement == "OEE_Quality" or
          r._measurement == "metric_oee" or
          r._measurement == "metric_availability" or
          r._measurement == "metric_performance" or
          r._measurement == "metric_quality"
        )
        |> filter(fn: (r) => r._value > 0 and r._value <= 150)
        ${enterpriseFilter}
        |> group(columns: ["enterprise", "site", "area", "_measurement"])
        |> mean()
        |> group(columns: ["enterprise", "site", "area"])
        |> pivot(rowKey: ["enterprise", "site", "area"], columnKey: ["_measurement"], valueColumn: "_value")
    `;

    const lines = [];

    await new Promise((resolve) => {
      queryApi.queryRows(fluxQuery, {
        next(row, tableMeta) {
          const o = tableMeta.toObject(row);
          if (o.enterprise && o.site) {
            // Normalize value to percentage (handle both decimal 0-1 and percentage 0-100)
            const normalize = (val) => {
              if (val === undefined || val === null) return null;
              if (val > 0 && val <= 1.5) val = val * 100;
              return parseFloat(Math.min(100, Math.max(0, val)).toFixed(1));
            };

            // Get values from either naming convention
            const availability = normalize(o.OEE_Availability ?? o.metric_availability);
            const performance = normalize(o.OEE_Performance ?? o.metric_performance);
            const quality = normalize(o.OEE_Quality ?? o.metric_quality);
            let oee = normalize(o.metric_oee);

            // Calculate OEE from components if not directly available
            if (oee === null && availability !== null && performance !== null && quality !== null) {
              oee = parseFloat(((availability / 100) * (performance / 100) * (quality / 100) * 100).toFixed(1));
            }

            // Skip lines with no OEE data
            if (oee === null && availability === null && performance === null && quality === null) {
              return;
            }

            lines.push({
              enterprise: o.enterprise,
              site: o.site,
              line: o.area || 'unknown',
              oee,
              availability,
              performance,
              quality,
              tier: o.metric_oee ? 1 : (availability && performance && quality ? 2 : 4)
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

/**
 * @swagger
 * /api/waste/trends:
 *   get:
 *     operationId: getWasteTrends
 *     summary: Get waste and defect trends over 24 hours
 *     description: Returns waste/defect data over time for trend analysis. Enterprise A defect codes - CHK (chips), DIM (dimensional), SED (seeds/bubbles). Enterprise B - SEAL, LABEL, FILL. Use Pareto analysis (80/20 rule) to identify top contributors.
 *     tags: [waste]
 *     responses:
 *       200:
 *         description: Time-series waste data with defect type breakdown
 */
app.get('/api/waste/trends', async (req, res) => {
  try {
    // SECURITY: Validate enterprise parameter
    const enterprise = validateEnterprise(req.query.enterprise);
    if (enterprise === null) {
      return res.status(400).json({ error: 'Invalid enterprise parameter' });
    }

    // Build enterprise filter for Flux query
    const enterpriseFilter = (enterprise && enterprise !== 'ALL')
      ? `|> filter(fn: (r) => r.enterprise == "${sanitizeInfluxIdentifier(enterprise)}")`
      : '';

    const fluxQuery = `
      from(bucket: "${CONFIG.influxdb.bucket}")
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
        ${enterpriseFilter}
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

/**
 * @swagger
 * /api/waste/by-line:
 *   get:
 *     operationId: getWasteByLine
 *     summary: Get waste metrics by production line
 *     description: Returns waste and defect counts grouped by production line for the last 24 hours.
 *     tags: [waste]
 *     parameters:
 *       - in: query
 *         name: enterprise
 *         schema:
 *           type: string
 *         description: Filter by enterprise (optional)
 *     responses:
 *       200:
 *         description: Waste data by production line
 *       400:
 *         description: Invalid enterprise parameter
 *       500:
 *         description: Server error
 */
app.get('/api/waste/by-line', async (req, res) => {
  try {
    // SECURITY: Validate enterprise parameter
    const enterprise = validateEnterprise(req.query.enterprise);
    if (enterprise === null) {
      return res.status(400).json({ error: 'Invalid enterprise parameter' });
    }

    // Build enterprise filter for Flux query
    const enterpriseFilter = (enterprise && enterprise !== 'ALL')
      ? `|> filter(fn: (r) => r.enterprise == "${sanitizeInfluxIdentifier(enterprise)}")`
      : '';

    const fluxQuery = `
      from(bucket: "${CONFIG.influxdb.bucket}")
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
        ${enterpriseFilter}
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
 * @swagger
 * /api/cmms/work-orders:
 *   get:
 *     operationId: getCmmsWorkOrders
 *     summary: List recent maintenance work orders
 *     description: Returns work orders from the CMMS (Computerized Maintenance Management System). Use this to check scheduled maintenance, open repairs, and equipment service history.
 *     tags: [cmms]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           maximum: 50
 *         description: Number of work orders to return
 *     responses:
 *       200:
 *         description: List of work orders
 *       503:
 *         description: CMMS integration not enabled
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
 * @swagger
 * /api/cmms/work-orders/{id}:
 *   get:
 *     operationId: getCmmsWorkOrder
 *     summary: Get specific work order details
 *     description: Returns detailed information about a specific maintenance work order by ID.
 *     tags: [cmms]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Work order ID
 *     responses:
 *       200:
 *         description: Work order details
 *       404:
 *         description: Work order not found
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
 * @swagger
 * /api/cmms/health:
 *   get:
 *     operationId: getCmmsHealth
 *     summary: Check CMMS integration health
 *     description: Returns the status of the CMMS integration including whether it's enabled and connected.
 *     tags: [cmms]
 *     responses:
 *       200:
 *         description: CMMS health status
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
    for (const stateData of equipmentStateCache.states.values()) {
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
    aiModule.queryTrends()
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

/**
 * @swagger
 * /api/schema/classifications:
 *   get:
 *     operationId: getSchemaClassifications
 *     summary: Get measurements grouped by classification
 *     description: Returns measurements organized by type (OEE components, waste/defects, batch parameters, etc.). Useful for understanding what categories of data are available.
 *     tags: [schema]
 *     responses:
 *       200:
 *         description: Measurements grouped by classification type
 */
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

// =============================================================================
// AGENTCORE INTEGRATION ENDPOINTS
// =============================================================================

/**
 * POST /api/agent/ask - Proxy questions to AWS AgentCore orchestrator
 * Body: { question: string, sessionId?: string }
 * Response: { answer: string, sessionId: string }
 */
app.post('/api/agent/ask', express.json(), async (req, res) => {
  try {
    // Check if AgentCore is enabled
    if (!agentCoreClient) {
      return res.status(503).json({
        error: 'AgentCore is not configured',
        message: 'Set AGENTCORE_AGENT_ID and AGENTCORE_ALIAS_ID environment variables'
      });
    }

    // Validate request body
    const { question, sessionId } = req.body;

    if (!question || typeof question !== 'string') {
      return res.status(400).json({
        error: 'Missing or invalid question parameter',
        message: 'Question must be a non-empty string'
      });
    }

    if (question.length > 1000) {
      return res.status(400).json({
        error: 'Question too long',
        message: 'Question must be less than 1000 characters'
      });
    }

    if (sessionId && (typeof sessionId !== 'string' || sessionId.length > 100)) {
      return res.status(400).json({
        error: 'Invalid sessionId parameter',
        message: 'sessionId must be a string less than 100 characters'
      });
    }

    console.log(`[AgentCore API] Received question: "${question.substring(0, 50)}..."`);

    // Invoke the agent
    const result = await agentCoreClient.ask(question, sessionId);

    res.json({
      answer: result.answer,
      sessionId: result.sessionId,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('AgentCore ask endpoint error:', error);
    res.status(500).json({
      error: 'Failed to process question',
      message: error.message
    });
  }
});

/**
 * GET /api/agent/health - Check AgentCore connectivity
 */
app.get('/api/agent/health', async (req, res) => {
  if (!agentCoreClient) {
    return res.json({
      enabled: false,
      healthy: false,
      message: 'AgentCore not configured'
    });
  }

  try {
    const health = await agentCoreClient.healthCheck();

    res.json({
      enabled: true,
      ...health,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    res.status(500).json({
      enabled: true,
      healthy: false,
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/agent/pause - Pause the agentic loop
 */
app.post('/api/agent/pause', (req, res) => {
  try {
    aiModule.pauseAgenticLoop();
    res.json({ status: 'paused', isPaused: true });
  } catch (error) {
    console.error('Failed to pause agent:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/agent/resume - Resume the agentic loop
 */
app.post('/api/agent/resume', (req, res) => {
  try {
    aiModule.resumeAgenticLoop();
    res.json({ status: 'resumed', isPaused: false });
  } catch (error) {
    console.error('Failed to resume agent:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/agent/status - Get current agentic loop status
 */
app.get('/api/agent/status', (req, res) => {
  try {
    const status = aiModule.getAgentStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// DEMO ENGINE ENDPOINTS
// =============================================================================

// Mount demo engine routes
app.use('/api/demo', demoEngine.router);

// =============================================================================
// STUB ENDPOINTS FOR LAMBDA TOOL COMPATIBILITY
// =============================================================================

/**
 * @swagger
 * /api/waste/breakdown:
 *   get:
 *     operationId: getWasteBreakdown
 *     summary: Get waste breakdown by enterprise
 *     description: Returns total waste counts aggregated by enterprise for the last 24 hours.
 *     tags: [waste]
 *     responses:
 *       200:
 *         description: Waste totals by enterprise
 *       500:
 *         description: Server error
 */
app.get('/api/waste/breakdown', async (req, res) => {
  try {
    const fluxQuery = `
      from(bucket: "${CONFIG.influxdb.bucket}")
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
          r._measurement == "workorder_quantitydefect"
        )
        |> filter(fn: (r) => r._value >= 0)
        |> group(columns: ["enterprise"])
        |> sum()
    `;

    const enterpriseData = new Map();

    await new Promise((resolve) => {
      queryApi.queryRows(fluxQuery, {
        next(row, tableMeta) {
          const o = tableMeta.toObject(row);
          if (o._value !== undefined && o.enterprise) {
            if (!enterpriseData.has(o.enterprise)) {
              enterpriseData.set(o.enterprise, { enterprise: o.enterprise, total: 0 });
            }
            enterpriseData.get(o.enterprise).total += o._value;
          }
        },
        error(error) {
          console.error('Waste breakdown query error:', error);
          resolve();
        },
        complete() {
          resolve();
        }
      });
    });

    const breakdown = Array.from(enterpriseData.values())
      .map(item => ({
        ...item,
        total: parseFloat(item.total.toFixed(2))
      }))
      .sort((a, b) => b.total - a.total);

    res.json({
      breakdown,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Waste breakdown endpoint error:', error);
    res.status(500).json({
      error: 'Failed to query waste breakdown',
      message: error.message
    });
  }
});

/**
 * @swagger
 * /api/batch/status:
 *   get:
 *     operationId: getBatchStatus
 *     summary: Get ISA-88 batch process status
 *     description: Returns real-time batch equipment status for Enterprise C including state, phase, batch ID, and recipe information.
 *     tags: [batch]
 *     responses:
 *       200:
 *         description: Batch equipment status with summary counts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 equipment:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       name:
 *                         type: string
 *                       type:
 *                         type: string
 *                       state:
 *                         type: string
 *                       batchId:
 *                         type: string
 *                       recipe:
 *                         type: string
 *                 summary:
 *                   type: object
 *                   properties:
 *                     running:
 *                       type: integer
 *                     idle:
 *                       type: integer
 *                     complete:
 *                       type: integer
 *                     fault:
 *                       type: integer
 *                     total:
 *                       type: integer
 *       500:
 *         description: Server error
 */
app.get('/api/batch/status', async (req, res) => {
  try {
    // Dynamically discover equipment from hierarchy cache
    const equipmentMetadata = await getEquipmentMetadata('Enterprise C');
    const knownEquipment = Object.keys(equipmentMetadata);

    // Query InfluxDB for latest batch equipment states
    const fluxQuery = `
      from(bucket: "${CONFIG.influxdb.bucket}")
        |> range(start: -15m)
        |> filter(fn: (r) => r._field == "value")
        |> filter(fn: (r) => r.enterprise == "Enterprise C")
        |> filter(fn: (r) =>
          r._measurement =~ /STATE/ or
          r._measurement =~ /PHASE/ or
          r._measurement =~ /BATCH_ID/ or
          r._measurement =~ /RECIPE/ or
          r._measurement =~ /STATUS/ or
          r._measurement =~ /FORMULA/
        )
        |> last()
    `;

    // Collect measurement data by equipment
    const equipmentData = new Map();

    await new Promise((resolve) => {
      queryApi.queryRows(fluxQuery, {
        next(row, tableMeta) {
          const o = tableMeta.toObject(row);
          if (!o._measurement || !o._value) return;

          // Resolve equipment ID from measurement name using aliases
          const equipmentId = resolveEquipmentId(o._measurement, knownEquipment);
          if (!equipmentId || !equipmentMetadata[equipmentId]) return;

          // Initialize equipment entry if needed
          if (!equipmentData.has(equipmentId)) {
            equipmentData.set(equipmentId, {
              id: equipmentId,
              site: o.site || 'Unknown',
              measurements: {},
              lastUpdate: o._time
            });
          }

          const equipment = equipmentData.get(equipmentId);

          // Categorize measurement by type
          const measurement = o._measurement.toLowerCase();
          const parsedValue = parseJsonValue(o._value);

          if (measurement.includes('state') || measurement.includes('status')) {
            equipment.measurements.state = parsedValue;
            equipment.lastUpdate = o._time;
          } else if (measurement.includes('phase')) {
            equipment.measurements.phase = parsedValue;
          } else if (measurement.includes('batch_id')) {
            equipment.measurements.batchId = parsedValue;
          } else if (measurement.includes('recipe') || measurement.includes('formula')) {
            equipment.measurements.recipe = parsedValue;
          }
        },
        error(error) {
          console.error('Batch status query error:', error);
          resolve();
        },
        complete() {
          resolve();
        }
      });
    });

    // Build response with equipment status
    const equipment = [];
    const summary = { running: 0, idle: 0, complete: 0, fault: 0, total: 0 };

    for (const [id, data] of equipmentData.entries()) {
      const metadata = equipmentMetadata[id];
      // Use state if available, fall back to phase (TFF300 has no STATE, only PHASE)
      const state = data.measurements.state || data.measurements.phase || 'Unknown';

      // Normalize state for summary
      const stateLower = state.toString().toLowerCase();
      let summaryKey = 'idle';
      if (stateLower.includes('run')) summaryKey = 'running';
      else if (stateLower.includes('complete') || stateLower.includes('done')) summaryKey = 'complete';
      else if (stateLower.includes('fault') || stateLower.includes('error') || stateLower.includes('alarm')) summaryKey = 'fault';

      summary[summaryKey]++;
      summary.total++;

      equipment.push({
        id,
        name: metadata.name,
        type: metadata.type,
        site: data.site,
        state,
        phase: data.measurements.phase || null,
        batchId: data.measurements.batchId || null,
        recipe: data.measurements.recipe || null,
        lastUpdate: data.lastUpdate
      });
    }

    // Sort by equipment ID for consistency
    equipment.sort((a, b) => a.id.localeCompare(b.id));

    // Query cleanroom environmental zones for Enterprise C
    // Use 1h range, exclude _props metadata measurements
    const cleanroomZones = [];
    const cleanroomQuery = `
      from(bucket: "${CONFIG.influxdb.bucket}")
        |> range(start: -1h)
        |> filter(fn: (r) => r._field == "value")
        |> filter(fn: (r) => r.enterprise == "Enterprise C")
        |> filter(fn: (r) => r.site == "opto22")
        |> filter(fn: (r) => r.area == "Environmental Zones")
        |> filter(fn: (r) => r._measurement =~ /FC\\d+_/)
        |> filter(fn: (r) => r._measurement !~ /_props$/)
        |> last()
    `;

    // Collect cleanroom data by zone (machine)
    const cleanroomData = new Map();

    await new Promise((resolve) => {
      queryApi.queryRows(cleanroomQuery, {
        next(row, tableMeta) {
          const o = tableMeta.toObject(row);
          if (!o._measurement || !o._value || !o.machine) return;

          // Initialize zone entry if needed
          if (!cleanroomData.has(o.machine)) {
            cleanroomData.set(o.machine, {
              name: o.machine,
              metrics: {},
              lastUpdate: o._time
            });
          }

          const zone = cleanroomData.get(o.machine);
          const parsedValue = parseJsonValue(o._value);

          // Extract FC## prefix and metric type
          // Measurements follow pattern: FC##_Metric_Name or FC##_Air_Quality__PM2_5_
          const fcMatch = o._measurement.match(/FC(\d+)_(.*)/i);
          if (!fcMatch) return;

          const [, , metricType] = fcMatch;
          const metricLower = metricType.toLowerCase();

          // Categorize metrics (with null guards to prevent NaN)
          if (metricLower.includes('fan') && metricLower.includes('status')) {
            zone.metrics.fanStatus = parsedValue;
          } else if (metricLower.includes('ambient') && metricLower.includes('temperature')) {
            zone.metrics.temperature = typeof parsedValue === 'number' ? parsedValue : (parsedValue != null ? parseFloat(parsedValue) : null);
          } else if (metricLower.includes('temperature') && !metricLower.includes('ambient')) {
            // Generic temperature fallback
            if (!zone.metrics.temperature) {
              zone.metrics.temperature = typeof parsedValue === 'number' ? parsedValue : (parsedValue != null ? parseFloat(parsedValue) : null);
            }
          } else if (metricLower.includes('humid')) {
            zone.metrics.humidity = typeof parsedValue === 'number' ? parsedValue : (parsedValue != null ? parseFloat(parsedValue) : null);
          } else if (metricLower.includes('pm2') || metricLower.includes('pm_2') || metricLower.includes('air_quality')) {
            zone.metrics.pm25 = typeof parsedValue === 'number' ? parsedValue : (parsedValue != null ? parseFloat(parsedValue) : null);
          }

          zone.lastUpdate = o._time;
        },
        error(error) {
          console.error('Cleanroom query error:', error);
          resolve();
        },
        complete() {
          resolve();
        }
      });
    });

    // Get cleanroom thresholds from domain context (getEnterpriseContext already imported at top)
    const enterpriseContext = getEnterpriseContext('Enterprise C');
    const thresholds = enterpriseContext?.cleanroomThresholds || {
      'PM2.5': { warning: 5, critical: 10 },
      'temperature': { min: 18, max: 25 },
      'humidity': { min: 40, max: 60 }
    };

    // Process cleanroom zones and calculate status
    let totalTemp = 0;
    let totalHumidity = 0;
    let totalPm25 = 0;
    let tempCount = 0;
    let humidityCount = 0;
    let pm25Count = 0;
    let zonesWithIssues = 0;

    for (const [machineName, data] of cleanroomData.entries()) {
      let { temperature, humidity, pm25, fanStatus } = data.metrics;

      // Convert Fahrenheit to Celsius if temperature appears to be in °F (above 50)
      // Cleanroom temp should be 18-25°C (64-77°F)
      if (typeof temperature === 'number' && !isNaN(temperature) && temperature > 50) {
        temperature = (temperature - 32) * 5 / 9;
      }

      // Determine zone status based on thresholds
      let status = 'Good';
      const issues = [];

      if (typeof temperature === 'number' && !isNaN(temperature)) {
        totalTemp += temperature;
        tempCount++;
        if (temperature < thresholds.temperature.min || temperature > thresholds.temperature.max) {
          issues.push('temperature');
          status = 'Critical';
        } else if (Math.abs(temperature - thresholds.temperature.min) < 1 ||
                   Math.abs(temperature - thresholds.temperature.max) < 1) {
          if (status === 'Good') status = 'Warning';
        }
      }

      if (typeof humidity === 'number' && !isNaN(humidity)) {
        totalHumidity += humidity;
        humidityCount++;
        if (humidity < thresholds.humidity.min || humidity > thresholds.humidity.max) {
          issues.push('humidity');
          status = 'Critical';
        } else if (Math.abs(humidity - thresholds.humidity.min) < 3 ||
                   Math.abs(humidity - thresholds.humidity.max) < 3) {
          if (status === 'Good') status = 'Warning';
        }
      }

      if (typeof pm25 === 'number' && !isNaN(pm25)) {
        totalPm25 += pm25;
        pm25Count++;
        if (pm25 >= thresholds['PM2.5'].critical) {
          issues.push('PM2.5');
          status = 'Critical';
        } else if (pm25 >= thresholds['PM2.5'].warning) {
          if (status === 'Good') status = 'Warning';
        }
      }

      if (status !== 'Good') {
        zonesWithIssues++;
      }

      cleanroomZones.push({
        name: machineName,
        fanStatus: fanStatus || 'Unknown',
        temperature: temperature,
        humidity: humidity,
        pm25: pm25,
        status,
        issues,
        lastUpdate: data.lastUpdate
      });
    }

    // Sort zones by name
    cleanroomZones.sort((a, b) => a.name.localeCompare(b.name));

    // Calculate averages
    const avgTemp = tempCount > 0 ? totalTemp / tempCount : null;
    const avgHumidity = humidityCount > 0 ? totalHumidity / humidityCount : null;
    const avgPm25 = pm25Count > 0 ? totalPm25 / pm25Count : null;

    // Determine overall PM2.5 status
    let pm25Status = 'Good';
    if (avgPm25 !== null) {
      if (avgPm25 >= thresholds['PM2.5'].critical) pm25Status = 'Critical';
      else if (avgPm25 >= thresholds['PM2.5'].warning) pm25Status = 'Warning';
    }

    res.json({
      equipment,
      summary,
      cleanroom: {
        zones: cleanroomZones,
        summary: {
          avgTemp,
          avgHumidity,
          avgPm25,
          pm25Status,
          zonesWithIssues,
          totalZones: cleanroomZones.length
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Batch status endpoint error:', error);
    res.status(500).json({
      error: 'Failed to query batch status',
      message: error.message
    });
  }
});

// POST /api/influx/query - Direct InfluxDB query (internal use, not exposed in API docs)
app.post('/api/influx/query', express.json(), async (req, res) => {
  try {
    const { query } = req.body;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({
        error: 'Missing or invalid query parameter',
        message: 'Query must be a non-empty Flux query string'
      });
    }

    if (query.length > 5000) {
      return res.status(400).json({
        error: 'Query too long',
        message: 'Query must be less than 5000 characters'
      });
    }

    // Basic security check - reject destructive operations
    const lowerQuery = query.toLowerCase();
    if (lowerQuery.includes('delete') || lowerQuery.includes('drop')) {
      return res.status(403).json({
        error: 'Forbidden query',
        message: 'DELETE and DROP operations are not allowed'
      });
    }

    console.log('[InfluxDB Query API] Executing query');

    const results = [];
    await new Promise((resolve) => {
      queryApi.queryRows(query, {
        next(row, tableMeta) {
          results.push(tableMeta.toObject(row));
        },
        error(error) {
          console.error('InfluxDB query error:', error);
          resolve();
        },
        complete() {
          resolve();
        }
      });
    });

    res.json({
      results,
      count: results.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('InfluxDB query endpoint error:', error);
    res.status(500).json({
      error: 'Failed to execute query',
      message: error.message
    });
  }
});

// Start HTTP server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log('📝 OpenAPI spec available at /api/api-spec/v3');
  console.log(`🏭 MQTT: ${mqttClient.connected ? 'Connected' : 'Connecting...'}`);
  console.log(`📈 InfluxDB: ${CONFIG.influxdb.url}`);
  if (CONFIG.disableInsights) {
    console.log(`🤖 AI Insights: DISABLED (MQTT data collection only)`);
  } else {
    console.log(`🤖 AWS Bedrock: ${CONFIG.bedrock.region} / ${CONFIG.bedrock.modelId}`);
    const { analysisConfig } = require('./lib/state').factoryState;
    console.log(`🤖 AI Insights: ENABLED (Tier 1: ${analysisConfig.checkIntervalMs / 1000}s, Tier 3: ${analysisConfig.summaryIntervalMs / 1000}s)`);
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
      anomalyFilters: factoryState.anomalyFilters,
      thresholdSettings: factoryState.thresholdSettings
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
    // Stop agentic loop intervals/timeouts
    aiModule.stopAgenticLoop();

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
