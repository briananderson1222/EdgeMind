// lib/ai/index.js - Agentic AI Module for Trend Analysis and Claude Integration

const { InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { queryApi } = require('../influx/client');
const CONFIG = require('../config');
const { ENTERPRISE_DOMAIN_CONTEXT } = require('../domain-context');
const { factoryState, equipmentStateCache } = require('../state');
const { executeTool } = require('./tools');

/**
 * Bedrock API timeout per call (configurable, default 30 seconds)
 * Tool-using responses need more time after tool execution completes
 */
const BEDROCK_TIMEOUT_MS = parseInt(process.env.BEDROCK_TIMEOUT_MS, 10) || 30000;

/** Max output tokens for single-shot Tier 2 targeted analysis */
const TIER2_MAX_TOKENS = 1500;
/** Max output tokens for single-shot Tier 3 summary analysis */
const TIER3_MAX_TOKENS = 2000;

/**
 * Check if model is Nova (vs Claude/Anthropic)
 */
function isNovaModel(modelId) {
  return modelId && modelId.includes('nova');
}

/**
 * Convert message content to Nova format (array of objects)
 */
function toNovaContent(content) {
  if (Array.isArray(content)) return content;
  if (typeof content === 'string') return [{ text: content }];
  return content;
}


/**
 * Extract text content from response content blocks
 */
function extractTextContent(content) {
  for (const block of content) {
    if (typeof block === 'string') return block;
    if (block.text && !block.toolUse) return block.text;
  }
  return null;
}

/**
 * Build request payload for either Claude or Nova models
 */
function buildBedrockPayload(messages, options = {}) {
  const { maxTokens = 2000, tools, system, modelId = CONFIG.bedrock.modelId } = options;
  
  if (isNovaModel(modelId)) {
    // Nova API format - content must be array of objects
    const novaMessages = messages.map(m => ({
      role: m.role,
      content: toNovaContent(m.content)
    }));
    const payload = {
      messages: novaMessages,
      inferenceConfig: { maxTokens, temperature: 0 }
    };
    if (system) payload.system = [{ text: system }];
    if (tools) {
      // Nova uses toolSpec with inputSchema (not input_schema)
      const novaTools = tools.map(t => ({
        toolSpec: {
          name: t.name,
          description: t.description,
          inputSchema: { json: t.input_schema }
        }
      }));
      payload.toolConfig = { tools: novaTools };
    }
    return payload;
  }
  
  // Claude/Anthropic API format
  const payload = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: maxTokens,
    messages
  };
  if (tools) payload.tools = tools;
  if (system) payload.system = system;
  return payload;
}

/**
 * Extract content array from Bedrock response (handles Claude and Nova formats)
 */
function extractResponseContent(responseBody) {
  // Claude format: { content: [...] }
  if (responseBody.content) return responseBody.content;
  // Nova format: { output: { message: { content: [...] } } }
  if (responseBody.output?.message?.content) return responseBody.output.message.content;
  return null;
}

/**
 * Extracts valid JSON object from text with preamble using balanced brace counting
 */
function extractJSONFromText(text) {
  const jsonStart = text.indexOf('{');
  if (jsonStart === -1) return null;

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = jsonStart; i < text.length; i++) {
    const char = text[i];
    if (escapeNext) { escapeNext = false; continue; }
    if (char === '\\' && inString) { escapeNext = true; continue; }
    if (char === '"' && !escapeNext) { inString = !inString; continue; }
    if (!inString) {
      if (char === '{') depth++;
      else if (char === '}') {
        depth--;
        if (depth === 0) {
          const candidate = text.substring(jsonStart, i + 1);
          try {
            const parsed = JSON.parse(candidate);
            // Only return if it has expected keys, otherwise continue searching
            if (parsed.summary !== undefined || parsed.anomalies !== undefined) {
              return candidate;
            }
            // No expected keys - fall through to extractLastJSONObject
          } catch (e) { break; }
        }
      }
    }
  }

  // Fallback: find last valid JSON with expected keys
  return extractLastJSONObject(text);
}

function extractLastJSONObject(text) {
  const positions = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') positions.push(i);
  }

  for (let p = positions.length - 1; p >= 0; p--) {
    let depth = 0, inString = false, escapeNext = false;
    for (let i = positions[p]; i < text.length; i++) {
      const char = text[i];
      if (escapeNext) { escapeNext = false; continue; }
      if (char === '\\' && inString) { escapeNext = true; continue; }
      if (char === '"' && !escapeNext) { inString = !inString; continue; }
      if (!inString) {
        if (char === '{') depth++;
        else if (char === '}') {
          depth--;
          if (depth === 0) {
            const candidate = text.substring(positions[p], i + 1);
            try {
              const parsed = JSON.parse(candidate);
              if (parsed.summary !== undefined || parsed.anomalies !== undefined) {
                return candidate;
              }
            } catch (e) {
              // JSON parse failed, continue
            }
            break;
          }
        }
      }
    }
  }
  return null;
}

/**
 * Build a standardized insight object from a parsed AI analysis response.
 * Provides consistent defaults so callers do not repeat the same shape.
 *
 * @param {Object} analysis - Parsed JSON from AI response (may have missing keys)
 * @param {Object} [extras] - Additional properties to merge into the insight
 * @returns {Object} Normalized insight object
 */
function buildInsightFromAnalysis(analysis, extras = {}) {
  return {
    id: `trend_${Date.now()}`,
    timestamp: new Date().toISOString(),
    summary: analysis.summary || 'Analysis complete',
    trends: analysis.trends || [],
    anomalies: analysis.anomalies || [],
    wasteAlerts: analysis.wasteAlerts || [],
    recommendations: analysis.recommendations || [],
    enterpriseInsights: analysis.enterpriseInsights || {},
    severity: analysis.severity || 'low',
    confidence: analysis.confidence || 0.5,
    ...extras
  };
}

/**
 * Reset daily token counters if the date has changed.
 * Called before each single-shot Bedrock invocation.
 */
function resetDailyTokensIfNeeded() {
  const today = new Date().toISOString().slice(0, 10);
  if (factoryState.tokenUsage.dailyReset !== today) {
    factoryState.tokenUsage.inputTokens = 0;
    factoryState.tokenUsage.outputTokens = 0;
    factoryState.tokenUsage.callCount = 0;
    factoryState.tokenUsage.dailyReset = today;
  }
}

/** All three enterprise names — avoids repeating the literal array */
const ALL_ENTERPRISES = ['Enterprise A', 'Enterprise B', 'Enterprise C'];

// Runtime dependencies (set via init)
let broadcastFn = null;
let cmmsProviderInstance = null;
let bedrockClientInstance = null;
let vectorStoreInstance = null;

// Agentic loop state
let trendAnalysisInterval = null;
let trendAnalysisTimeout = null;
let tier1CheckInterval = null;
let tier3SummaryInterval = null;
let tier1InitialTimeout = null;
let lastTier3Time = 0;
let analysisInProgress = false;

/**
 * Initialize the AI module with runtime dependencies
 * @param {Object} deps - Dependencies object
 * @param {Function} deps.broadcast - WebSocket broadcast function
 * @param {Object} deps.cmms - CMMS provider instance
 * @param {Object} deps.bedrockClient - AWS Bedrock client instance
 * @param {Object} deps.vectorStore - Vector store instance for RAG
 */
function init({ broadcast, cmms, bedrockClient, vectorStore }) {
  broadcastFn = broadcast;
  cmmsProviderInstance = cmms;
  bedrockClientInstance = bedrockClient;
  vectorStoreInstance = vectorStore;
  console.log(`🤖 AI module initialized (bedrockClient: ${bedrockClient ? 'OK' : 'NULL'})`);
}

/**
 * Query trend data from InfluxDB (5-minute rolling window, 1-minute aggregates)
 * @returns {Promise<Array>} Array of trend data points
 */
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

  return new Promise((resolve) => {
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
 * Summarize trends for Claude analysis
 * Groups by measurement and calculates change percentage and average
 * @param {Array} trends - Trend data array
 * @returns {string} Formatted summary string
 */
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
      const change = first !== 0
        ? ((last - first) / first * 100).toFixed(1)
        : (last !== 0 ? 'N/A' : '0.0');
      const avg = (values.reduce((s, v) => s + v.value, 0) / values.length).toFixed(2);
      lines.push(`${key}: avg=${avg}, change=${change}% (${values.length} points)`);
    }
  });

  return lines.join('\n') || 'No aggregated data available';
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
  for (const stateData of equipmentStateCache.states.values()) {
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
        const workOrder = await cmmsProviderInstance.createWorkOrder(insight, equipment);

        // Broadcast work order creation to WebSocket clients
        if (broadcastFn) {
          broadcastFn({
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
        }

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

// ============================================================
// Tiered Agent Analysis Functions (ADR-016)
// ============================================================

/**
 * Enterprise rotation labels for Tier 3 comprehensive summaries
 */
const ENTERPRISE_ROTATION = ['Enterprise A', 'Enterprise B', 'Enterprise C', 'cross-enterprise'];

/**
 * Detect meaningful changes between current trends and a previous snapshot.
 * Pure function — no side effects, no AI calls.
 *
 * @param {Array} currentTrends - Current trend data from queryTrends()
 * @param {Object|null} previousSnapshot - Previous metrics snapshot (null on first run)
 * @param {number} [thresholdPct=5] - Percentage change threshold to consider significant
 * @returns {Array<Object>} Array of detected changes, empty if nothing meaningful changed
 */
function detectChanges(currentTrends, previousSnapshot, thresholdPct) {
  const threshold = thresholdPct != null ? thresholdPct : factoryState.analysisConfig.changeThresholdPct;
  const changes = [];

  if (!currentTrends || currentTrends.length === 0) {
    return changes;
  }

  // If no previous snapshot, this is first run — no changes to detect
  if (!previousSnapshot) {
    return changes;
  }

  // Build current metrics map: group by enterprise + measurement, compute average
  const currentMetrics = buildMetricsMap(currentTrends);
  const previousMetrics = previousSnapshot.metrics || {};

  // Compare key metrics per enterprise
  for (const [key, currentValue] of Object.entries(currentMetrics)) {
    const previousValue = previousMetrics[key];
    if (previousValue == null || previousValue === 0) continue;

    const changePct = Math.abs(((currentValue - previousValue) / previousValue) * 100);
    if (changePct >= threshold) {
      const [enterprise, measurement] = key.split('::');
      changes.push({
        type: 'metric_change',
        enterprise,
        measurement,
        previousValue: parseFloat(previousValue.toFixed(2)),
        currentValue: parseFloat(currentValue.toFixed(2)),
        changePct: parseFloat(changePct.toFixed(1)),
        direction: currentValue > previousValue ? 'increased' : 'decreased'
      });
    }
  }

  // Check equipment state transitions
  const currentStates = buildEquipmentStateMap();
  const previousStates = previousSnapshot.equipmentStates || {};

  for (const [equipKey, currentState] of Object.entries(currentStates)) {
    const previousState = previousStates[equipKey];
    if (previousState && previousState !== currentState) {
      // Only flag transitions TO concerning states (DOWN, IDLE)
      if (currentState === 'DOWN' || currentState === 'IDLE' || previousState === 'DOWN') {
        changes.push({
          type: 'state_transition',
          equipment: equipKey,
          previousState,
          currentState,
          enterprise: equipKey.split('/')[0]
        });
      }
    }
  }

  return changes;
}

/**
 * Build a metrics map from trend data: { "enterprise::measurement": averageValue }
 * Focuses on key OEE-related metrics.
 * @param {Array} trends
 * @returns {Object}
 */
function buildMetricsMap(trends) {
  const sums = {};
  const counts = {};

  const keyMetrics = new Set([
    'OEE_Availability', 'OEE_Performance', 'OEE_Quality', 'OEE_OEE',
    'metric_availability', 'metric_performance', 'metric_quality', 'metric_oee'
  ]);

  trends.forEach(t => {
    // Only track key OEE metrics for delta detection
    if (!keyMetrics.has(t.measurement)) return;

    const key = `${t.enterprise}::${t.measurement}`;
    if (!sums[key]) { sums[key] = 0; counts[key] = 0; }
    sums[key] += t.value;
    counts[key]++;
  });

  const metrics = {};
  for (const key of Object.keys(sums)) {
    metrics[key] = sums[key] / counts[key];
  }
  return metrics;
}

/**
 * Build equipment state map from the equipment state cache.
 * @returns {Object} { "Enterprise/Site/Machine": "RUNNING"|"DOWN"|"IDLE" }
 */
function buildEquipmentStateMap() {
  const states = {};
  for (const [key, data] of equipmentStateCache.states.entries()) {
    states[key] = data.stateName || 'UNKNOWN';
  }
  return states;
}

/**
 * Build a snapshot of current metrics and equipment states for delta comparison.
 * @param {Array} trends
 * @returns {Object} Snapshot object
 */
function buildSnapshot(trends) {
  return {
    timestamp: new Date().toISOString(),
    metrics: buildMetricsMap(trends),
    equipmentStates: buildEquipmentStateMap()
  };
}

/**
 * Format detected changes into human-readable markdown bullet points.
 * Shared by targeted prompt builders (with-data and legacy).
 *
 * @param {Array} changes - Detected changes from detectChanges()
 * @returns {string} Newline-separated markdown list
 */
function formatChangeDescriptions(changes) {
  return changes.map(c => {
    if (c.type === 'metric_change') {
      return `- ${c.enterprise}: ${c.measurement} ${c.direction} from ${c.previousValue} to ${c.currentValue} (${c.changePct}% change)`;
    }
    if (c.type === 'state_transition') {
      return `- Equipment ${c.equipment}: transitioned from ${c.previousState} to ${c.currentState}`;
    }
    return `- ${JSON.stringify(c)}`;
  }).join('\n');
}



/**
 * Pre-fetch all tool data for given enterprises before calling Bedrock.
 * Eliminates tool call loops — one Bedrock call instead of 4-10.
 *
 * @param {string[]} enterprises - Enterprise names to fetch data for (e.g., ['Enterprise A', 'Enterprise B', 'Enterprise C'])
 * @returns {Promise<string>} Formatted string of all tool results to embed in prompt
 */
async function prefetchToolData(enterprises) {
  const allResults = await Promise.all(
    enterprises.map(async (enterprise) => {
      // Enterprise C uses batch processing instead of OEE
      const isBatch = enterprise === 'Enterprise C';
      const [primary, equipment] = await Promise.all([
        executeTool(isBatch ? 'get_batch_status' : 'get_oee_breakdown', isBatch ? {} : { enterprise }),
        executeTool('get_equipment_states', { enterprise })
      ]);
      return { enterprise, isBatch, primary, equipment };
    })
  );

  return allResults.map(({ enterprise, isBatch, primary, equipment }) => {
    const label = isBatch ? 'Batch Status' : 'OEE Breakdown';
    const primaryJson = JSON.stringify(primary.data || primary, null, 0);
    const equipJson = JSON.stringify(equipment.data || equipment, null, 0);
    return `### ${enterprise}\n**${label}:** ${primaryJson}\n**Equipment States:** ${equipJson}`;
  }).join('\n\n');
}

/**
 * Single-shot Bedrock invocation — no tool definitions, no tool loop.
 * Uses tier model (Haiku) for cost efficiency on routine analysis.
 *
 * @param {string} prompt - Complete prompt with embedded tool data
 * @param {number} [maxTokens=2000] - Maximum output tokens
 * @returns {Promise<Object|null>} Parsed insight object or null on error
 */
async function callBedrockSingleShot(prompt, maxTokens = 2000) {
  if (!bedrockClientInstance) {
    throw new Error('Bedrock client not initialized - call init() first');
  }

  resetDailyTokensIfNeeded();

  if (factoryState.tokenUsage.inputTokens >= factoryState.analysisConfig.dailyTokenBudget) {
    console.warn('⚠️ Daily token budget exceeded, pausing analysis');
    return null;
  }

  const tierModelId = CONFIG.bedrock.tierModelId;
  const payload = buildBedrockPayload([{ role: 'user', content: prompt }], { maxTokens, modelId: tierModelId });

  const command = new InvokeModelCommand({
    modelId: tierModelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(payload)
  });

  let response;
  try {
    response = await Promise.race([
      bedrockClientInstance.send(command),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Bedrock API timeout')), BEDROCK_TIMEOUT_MS)
      )
    ]);
  } catch (timeoutError) {
    if (timeoutError.message.includes('timeout')) {
      console.warn(`⚠️ Single-shot Bedrock timeout (${BEDROCK_TIMEOUT_MS}ms)`);
    }
    throw timeoutError;
  }

  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  console.log('[AI-SingleShot] Bedrock response:', JSON.stringify(responseBody).slice(0, 500));

  // Track token usage
  const usage = responseBody.usage || {};
  const inTokens = usage.input_tokens || usage.inputTokens || 0;
  const outTokens = usage.output_tokens || usage.outputTokens || 0;
  factoryState.tokenUsage.inputTokens += inTokens;
  factoryState.tokenUsage.outputTokens += outTokens;
  factoryState.tokenUsage.callCount += 1;
  console.log(`[AI-SingleShot] Tokens: in=${inTokens}, out=${outTokens}, daily_total_in=${factoryState.tokenUsage.inputTokens}`);

  const content = extractResponseContent(responseBody);
  if (!content || content.length === 0) {
    console.error('[AI-SingleShot] No content in response');
    return null;
  }

  const responseText = extractTextContent(content);
  if (!responseText) {
    console.error('[AI-SingleShot] No text content found');
    return null;
  }

  const singleShotExtras = { singleShot: true, model: tierModelId };

  // Parse JSON response
  try {
    const cleanedText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const jsonText = extractJSONFromText(cleanedText);
    if (!jsonText) throw new Error('No valid JSON object found in single-shot response');

    return buildInsightFromAnalysis(JSON.parse(jsonText), singleShotExtras);
  } catch (parseError) {
    console.error('[AI-SingleShot] JSON parse error:', parseError.message);
    const summaryMatch = responseText.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);

    return buildInsightFromAnalysis(
      { summary: summaryMatch ? summaryMatch[1] : 'Analysis could not be parsed' },
      { ...singleShotExtras, parseError: true }
    );
  }
}

/**
 * Build targeted prompt with pre-fetched data (no tool instructions needed).
 * @param {Array} changes - Detected changes from Tier 1
 * @param {string} trendSummary - Current trend summary
 * @param {string} toolData - Pre-fetched tool data to embed
 * @returns {string} Complete prompt
 */
function buildTargetedPromptWithData(changes, trendSummary, toolData) {
  const changeDescriptions = formatChangeDescriptions(changes);
  const affectedEnterprises = [...new Set(changes.map(c => c.enterprise))];

  return `You are an AI factory monitoring agent investigating SPECIFIC CHANGES detected in the last 2 minutes.

## Detected Changes (INVESTIGATE THESE)

${changeDescriptions}

## Current Metrics Snapshot

${trendSummary}

## Pre-Fetched Factory Data

${toolData}

## Your Task

Analyze the root cause of the changes using the pre-fetched data above. Focus on the affected enterprise(s): ${affectedEnterprises.join(', ')}.

**CRITICAL: Respond with ONLY the JSON object below. No preamble text.**

{
  "summary": "Brief finding about the detected change and its root cause",
  "trends": [{"metric": "name", "direction": "rising|falling|stable", "change_percent": 0}],
  "anomalies": [
    {
      "description": "What changed and why",
      "reasoning": "Root cause explanation",
      "metric": "metric name",
      "enterprise": "Enterprise name",
      "actual_value": "current value",
      "threshold": "threshold breached",
      "severity": "low|medium|high"
    }
  ],
  "wasteAlerts": [],
  "recommendations": ["targeted action items"],
  "enterpriseInsights": {},
  "severity": "low|medium|high",
  "confidence": 0.0-1.0
}`;
}

/**
 * Build comprehensive summary prompt with pre-fetched data (no tool instructions needed).
 * @param {string} enterpriseFocus - Which enterprise to deep-dive into
 * @param {string} trendSummary - Current trend summary
 * @param {string} domainContext - Domain context string
 * @param {string} toolData - Pre-fetched tool data to embed
 * @returns {string} Complete prompt
 */
function buildSummaryPromptWithData(enterpriseFocus, trendSummary, domainContext, toolData) {
  const focusInstruction = enterpriseFocus === 'cross-enterprise'
    ? `**FOCUS: Cross-Enterprise Comparison.** Compare performance across all three enterprises.`
    : `**FOCUS: ${enterpriseFocus} Deep Dive.** Provide detailed analysis of ${enterpriseFocus} while briefly covering the other enterprises.`;

  const ts = factoryState.thresholdSettings;

  return `You are an AI factory monitoring agent providing a SCHEDULED COMPREHENSIVE SUMMARY.

${domainContext}

## Operator-Defined Thresholds
- OEE Baseline: ${ts.oeeBaseline}% (below = concerning)
- OEE World Class: ${ts.oeeWorldClass}% (above = excellent)
- Availability Minimum: ${ts.availabilityMin}% (below = critical)
- Defect Rate Warning: ${ts.defectRateWarning}%
- Defect Rate Critical: ${ts.defectRateCritical}%

## Current Trend Data (Last 5 Minutes)

${trendSummary}

## Pre-Fetched Factory Data

${toolData}

## Analysis Focus

${focusInstruction}

## Instructions

1. Analyze the pre-fetched data above for all three enterprises
2. Provide a comprehensive 30-minute summary suitable for the operations dashboard
3. Identify emerging trends, not just current values

**CRITICAL: Respond with ONLY the JSON object. No preamble text.**

{
  "summary": "Comprehensive 30-minute summary with ${enterpriseFocus} focus",
  "trends": [{"metric": "name", "direction": "rising|falling|stable", "change_percent": 0}],
  "anomalies": [
    {
      "description": "Description",
      "reasoning": "Detailed reasoning",
      "metric": "metric name",
      "enterprise": "Enterprise name",
      "actual_value": "current value",
      "threshold": "threshold breached",
      "severity": "low|medium|high"
    }
  ],
  "wasteAlerts": [],
  "recommendations": ["action items"],
  "enterpriseInsights": {
    "Enterprise A": "insight",
    "Enterprise B": "insight",
    "Enterprise C": "insight"
  },
  "severity": "low|medium|high",
  "confidence": 0.0-1.0
}`;
}

/**
 * Clean up expired entries from the anomaly deduplication cache.
 */
function cleanAnomalyCache() {
  const now = Date.now();
  const ttl = factoryState.analysisConfig.anomalyCacheTtlMs;

  for (const [key, entry] of factoryState.anomalyCache.entries()) {
    if (now - entry.timestamp > ttl) {
      factoryState.anomalyCache.delete(key);
    }
  }
}

/**
 * Check the anomaly cache for a duplicate. Returns true if already reported within TTL.
 * @param {string} enterprise
 * @param {string} equipment
 * @param {string} anomalyType
 * @returns {boolean}
 */
function isDuplicateAnomaly(enterprise, equipment, anomalyType) {
  const key = `${enterprise}-${equipment}-${anomalyType}`;
  const entry = factoryState.anomalyCache.get(key);
  if (!entry) return false;

  const now = Date.now();
  if (now - entry.timestamp > factoryState.analysisConfig.anomalyCacheTtlMs) {
    factoryState.anomalyCache.delete(key);
    return false;
  }

  return true;
}

/**
 * Record an anomaly in the dedup cache.
 * @param {string} enterprise
 * @param {string} equipment
 * @param {string} anomalyType
 * @param {Object} insight
 */
function recordAnomaly(enterprise, equipment, anomalyType, insight) {
  const key = `${enterprise}-${equipment}-${anomalyType}`;
  const existing = factoryState.anomalyCache.get(key);

  factoryState.anomalyCache.set(key, {
    timestamp: Date.now(),
    count: existing ? existing.count + 1 : 1,
    lastInsight: insight.summary || ''
  });
}

/**
 * Tier 1: Cheap local delta detection. No AI call.
 * Queries metrics, compares against previous snapshot, triggers Tier 2 if changes detected.
 */
async function checkForChanges() {
  console.log('🔍 Tier 1: Checking for metric changes...');

  try {
    // Clean up expired anomaly cache entries
    cleanAnomalyCache();

    // Query current trends
    const trends = await queryTrends();

    if (!trends || trends.length === 0) {
      console.log('🔍 Tier 1: No trend data available');
      return;
    }

    // Detect changes against previous snapshot
    const changes = detectChanges(trends, factoryState.previousSnapshot);

    // Always update snapshot
    factoryState.previousSnapshot = buildSnapshot(trends);

    if (changes.length === 0) {
      console.log('🔍 Tier 1: No meaningful changes detected — skipping AI call');
      return;
    }

    console.log(`⚡ Tier 1: ${changes.length} change(s) detected — triggering Tier 2 analysis`);

    // Tier 2: Targeted AI analysis (with race condition guard)
    if (analysisInProgress) {
      console.log('⏸️ Tier 2: Analysis already in progress, deferring this run');
      return;
    }

    try {
      analysisInProgress = true;
      await runTargetedAnalysis(trends, changes);
    } finally {
      analysisInProgress = false;
    }

  } catch (error) {
    console.error('❌ Tier 1 check error:', error.message);
  }
}

/**
 * Tier 2: Targeted AI analysis — only called when Tier 1 detects changes.
 * @param {Array} trends - Current trend data
 * @param {Array} changes - Detected changes from Tier 1
 */
async function runTargetedAnalysis(trends, changes) {
  console.log('🎯 Tier 2: Running targeted analysis...');

  try {
    const trendSummary = summarizeTrends(trends);
    const affectedEnterprises = [...new Set(changes.map(c => c.enterprise))];
    const toolData = await prefetchToolData(affectedEnterprises);
    const prompt = buildTargetedPromptWithData(changes, trendSummary, toolData);

    const insight = await callBedrockSingleShot(prompt, TIER2_MAX_TOKENS);

    if (insight) {
      insight.analysisTier = 2;
      insight.dataPoints = trends.length;
      insight.triggeredBy = changes.map(c =>
        c.type === 'metric_change'
          ? `${c.enterprise} ${c.measurement} ${c.direction} ${c.changePct}%`
          : `${c.equipment} ${c.previousState}→${c.currentState}`
      );

      processInsight(insight, trends);
    }
  } catch (error) {
    console.error('❌ Tier 2 analysis error:', error.message);
  }
}

/**
 * Tier 3: Scheduled comprehensive summary with enterprise rotation.
 */
async function runScheduledSummary() {
  console.log('📋 Tier 3: Running scheduled comprehensive summary...');

  // Guard against race condition with Tier 2
  if (analysisInProgress) {
    console.log('⏸️ Tier 3: Analysis already in progress, skipping this scheduled run');
    return;
  }

  try {
    analysisInProgress = true;
    const trends = await queryTrends();

    if (!trends || trends.length === 0) {
      console.log('📋 Tier 3: No trend data available');
      return;
    }

    // Determine enterprise focus from rotation
    const focusIndex = factoryState.enterpriseRotation % ENTERPRISE_ROTATION.length;
    const enterpriseFocus = ENTERPRISE_ROTATION[focusIndex];
    factoryState.enterpriseRotation = (factoryState.enterpriseRotation + 1) % ENTERPRISE_ROTATION.length;

    console.log(`📋 Tier 3: Focus on ${enterpriseFocus} (rotation index ${focusIndex})`);

    const trendSummary = summarizeTrends(trends);
    const domainContext = buildDomainContext(trends);
    const toolData = await prefetchToolData(ALL_ENTERPRISES);
    const prompt = buildSummaryPromptWithData(enterpriseFocus, trendSummary, domainContext, toolData);

    const insight = await callBedrockSingleShot(prompt, TIER3_MAX_TOKENS);

    if (insight) {
      insight.analysisTier = 3;
      insight.dataPoints = trends.length;
      insight.enterpriseFocus = enterpriseFocus;

      // Also update the snapshot on Tier 3 runs
      factoryState.previousSnapshot = buildSnapshot(trends);

      processInsight(insight, trends);
    }

    lastTier3Time = Date.now();
  } catch (error) {
    console.error('❌ Tier 3 summary error:', error.message);
  } finally {
    analysisInProgress = false;
  }
}


/**
 * Process an insight: store, broadcast, handle anomalies with dedup.
 * Shared by all analysis paths (Tier 2, Tier 3, and legacy runTrendAnalysis).
 *
 * @param {Object} insight
 * @param {Array} trends
 */
function processInsight(insight, trends) {
  factoryState.trendInsights.push(insight);
  if (factoryState.trendInsights.length > 20) {
    factoryState.trendInsights.shift();
  }

  // Extract and store anomalies with dedup and cap of 100
  if (insight.anomalies && Array.isArray(insight.anomalies)) {
    insight.anomalies.forEach(anomaly => {
      const enterprise = anomaly.enterprise || 'unknown';
      const equipment = anomaly.metric || 'unknown';
      const anomalyType = anomaly.severity || 'unknown';

      // Dedup check
      if (isDuplicateAnomaly(enterprise, equipment, anomalyType)) {
        console.log(`🔁 Skipping duplicate anomaly: ${enterprise}/${equipment}/${anomalyType}`);
        return;
      }

      recordAnomaly(enterprise, equipment, anomalyType, insight);

      factoryState.anomalies.push({
        ...anomaly,
        timestamp: insight.timestamp,
        insightId: insight.id
      });
    });
    while (factoryState.anomalies.length > 100) {
      factoryState.anomalies.shift();
    }
  }

  // Broadcast to clients
  if (broadcastFn) {
    broadcastFn({
      type: 'trend_insight',
      data: insight
    });
  }

  // Publish as CESMII FactoryInsightV1 if enabled
  try {
    const cesmiiConfig = require('../config').cesmii;
    if (cesmiiConfig && cesmiiConfig.enabled) {
      const publisher = require('../cesmii/publisher');
      const enterprise = insight.enterprise || 'ALL';
      publisher.publishFactoryInsight(insight, enterprise);
    }
  } catch (e) {
    // CESMII publisher not available, skip silently
  }

  const tierLabel = insight.analysisTier ? `Tier ${insight.analysisTier}` : 'Legacy';
  console.log(`✨ [${tierLabel}] Trend Analysis:`, insight.summary);

  // Store anomalies in vector store for RAG (async, don't block)
  if (vectorStoreInstance && vectorStoreInstance.isReady() && insight.anomalies?.length > 0) {
    (async () => {
      for (const anomaly of insight.anomalies) {
        try {
          await vectorStoreInstance.storeAnomaly(anomaly, insight);
        } catch (storeError) {
          console.warn('Failed to store anomaly in vector store:', storeError.message);
        }
      }
      const count = await vectorStoreInstance.getAnomalyCount();
      console.log(`📦 Vector store: ${count} anomalies stored`);
    })().catch(err => console.warn('Vector store batch error:', err.message));
  }

  // CMMS Integration: Create work orders for high-severity anomalies (with dedup)
  if (cmmsProviderInstance && cmmsProviderInstance.isEnabled() && insight.severity === 'high' && insight.anomalies?.length > 0) {
    // Filter out duplicates before creating work orders
    const newAnomalies = insight.anomalies.filter(a => {
      const enterprise = a.enterprise || 'unknown';
      const equipment = a.metric || 'unknown';
      const anomalyType = a.severity || 'unknown';
      const key = `${enterprise}-${equipment}-${anomalyType}`;
      const entry = factoryState.anomalyCache.get(key);
      // Only create work order if this is the first occurrence (count === 1)
      return entry && entry.count === 1;
    });

    if (newAnomalies.length > 0) {
      processAnomaliesForWorkOrders(insight, trends).catch(err => {
        console.error('Failed to process anomalies for work orders:', err.message);
      });
    }
  }
}


/**
 * Start the agentic trend analysis loop (tiered architecture — ADR-016)
 *
 * Tier 1: Cheap delta detection every AGENT_CHECK_INTERVAL_MS (default 2 min). No AI call.
 * Tier 2: Targeted AI analysis — triggered by Tier 1 when meaningful changes detected.
 * Tier 3: Comprehensive summary every AGENT_SUMMARY_INTERVAL_MS (default 30 min).
 */
function startAgenticLoop() {
  if (CONFIG.disableInsights) {
    console.log('🤖 Insights disabled - MQTT data collection only mode');
    return;
  }

  if (tier1CheckInterval || tier3SummaryInterval || trendAnalysisInterval || trendAnalysisTimeout) {
    console.warn('⚠️ Agentic loop already running, skipping duplicate start');
    return;
  }

  const checkInterval = factoryState.analysisConfig.checkIntervalMs;
  const summaryInterval = factoryState.analysisConfig.summaryIntervalMs;
  const thresholdPct = factoryState.analysisConfig.changeThresholdPct;

  console.log('🤖 Starting Tiered Agentic Analysis Loop...');
  console.log(`   Tier 1: Delta check every ${checkInterval / 1000}s (threshold: ${thresholdPct}%)`);
  console.log(`   Tier 2: Triggered by Tier 1 on meaningful changes`);
  console.log(`   Tier 3: Comprehensive summary every ${summaryInterval / 1000}s`);

  // Tier 1: Check for changes at configured interval
  tier1CheckInterval = setInterval(async () => {
    await checkForChanges();
  }, checkInterval);

  // Tier 3: Scheduled comprehensive summary
  tier3SummaryInterval = setInterval(async () => {
    await runScheduledSummary();
  }, summaryInterval);

  // Initial Tier 3 run after 15 seconds to let data accumulate
  tier1InitialTimeout = setTimeout(async () => {
    await runScheduledSummary();
  }, 15000);

  lastTier3Time = Date.now();
}

/**
 * Stop the agentic trend analysis loop
 * Clears all intervals and timeouts for graceful shutdown
 */
function stopAgenticLoop() {
  if (tier1CheckInterval) {
    clearInterval(tier1CheckInterval);
    tier1CheckInterval = null;
    console.log('🛑 Stopped Tier 1 delta check interval');
  }
  if (tier3SummaryInterval) {
    clearInterval(tier3SummaryInterval);
    tier3SummaryInterval = null;
    console.log('🛑 Stopped Tier 3 summary interval');
  }
  if (tier1InitialTimeout) {
    clearTimeout(tier1InitialTimeout);
    tier1InitialTimeout = null;
    console.log('🛑 Stopped initial timeout');
  }
  // Backward compat: also clear legacy interval/timeout if set
  if (trendAnalysisInterval) {
    clearInterval(trendAnalysisInterval);
    trendAnalysisInterval = null;
    console.log('🛑 Stopped legacy trend analysis interval');
  }
  if (trendAnalysisTimeout) {
    clearTimeout(trendAnalysisTimeout);
    trendAnalysisTimeout = null;
    console.log('🛑 Stopped legacy trend analysis timeout');
  }
}

/**
 * Pause the agentic trend analysis loop
 * Suspends analysis without destroying state (previousSnapshot, anomalyCache)
 */
function pauseAgenticLoop() {
  factoryState.analysisConfig.isPaused = true;

  // Clear intervals to stop Bedrock calls
  if (tier1CheckInterval) {
    clearInterval(tier1CheckInterval);
    tier1CheckInterval = null;
  }
  if (tier3SummaryInterval) {
    clearInterval(tier3SummaryInterval);
    tier3SummaryInterval = null;
  }

  console.log('🔴 Agentic loop PAUSED — no Bedrock calls will be made');
}

/**
 * Resume the agentic trend analysis loop
 * Re-creates intervals without resetting state
 */
function resumeAgenticLoop() {
  if (!factoryState.analysisConfig.isPaused) {
    console.warn('⚠️ Agentic loop is not paused, ignoring resume request');
    return;
  }

  factoryState.analysisConfig.isPaused = false;

  const checkInterval = factoryState.analysisConfig.checkIntervalMs;
  const summaryInterval = factoryState.analysisConfig.summaryIntervalMs;

  // Re-create Tier 1 and Tier 3 intervals
  tier1CheckInterval = setInterval(async () => {
    await checkForChanges();
  }, checkInterval);

  tier3SummaryInterval = setInterval(async () => {
    await runScheduledSummary();
  }, summaryInterval);

  console.log('🟢 Agentic loop RESUMED');
}

/**
 * Get current agentic loop status
 * @returns {Object} Status object with isPaused, isRunning, and config
 */
function getAgentStatus() {
  return {
    isPaused: factoryState.analysisConfig.isPaused,
    isRunning: tier1CheckInterval !== null || tier3SummaryInterval !== null,
    config: {
      checkIntervalMs: factoryState.analysisConfig.checkIntervalMs,
      summaryIntervalMs: factoryState.analysisConfig.summaryIntervalMs,
      changeThresholdPct: factoryState.analysisConfig.changeThresholdPct
    },
    state: {
      hasPreviousSnapshot: factoryState.previousSnapshot !== null,
      anomalyCacheSize: factoryState.anomalyCache.size,
      lastTier3Time
    }
  };
}


module.exports = {
  init,
  startAgenticLoop,
  stopAgenticLoop,
  pauseAgenticLoop,
  resumeAgenticLoop,
  getAgentStatus,
  queryTrends,
  summarizeTrends,
  buildDomainContext,
  extractAffectedEquipment,
  processAnomaliesForWorkOrders,
  // Tiered analysis exports (ADR-016)
  detectChanges,
  checkForChanges,
  runTargetedAnalysis,
  runScheduledSummary,
  isDuplicateAnomaly,
  recordAnomaly,
  cleanAnomalyCache,
  // Cost-optimized single-shot analysis (ADR-017)
  prefetchToolData,
  callBedrockSingleShot,
  buildTargetedPromptWithData,
  buildSummaryPromptWithData
};
