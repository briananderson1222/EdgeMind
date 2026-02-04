// lib/ai/index.js - Agentic AI Module for Trend Analysis and Claude Integration

const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { queryApi } = require('../influx/client');
const CONFIG = require('../config');
const { ENTERPRISE_DOMAIN_CONTEXT } = require('../domain-context');
const { factoryState, equipmentStateCache } = require('../state');
const agentRuntime = require('../agentcore/runtime');

// Runtime dependencies (set via init)
let broadcastFn = null;
let cmmsProviderInstance = null;
let bedrockClientInstance = null;
let vectorStoreInstance = null;

// Agentic loop state
let trendAnalysisInterval = null;
let trendAnalysisTimeout = null;

/**
 * Check if the configured model is a Nova model
 */
function isNovaModel(modelId) {
  return modelId && modelId.includes('nova');
}

/**
 * Build request payload for either Claude or Nova models
 */
function buildBedrockPayload(messages, options = {}) {
  const { maxTokens = 2000, system } = options;
  const modelId = CONFIG.bedrock.modelId;
  
  if (isNovaModel(modelId)) {
    const payload = { messages, inferenceConfig: { maxTokens } };
    if (system) payload.system = [{ text: system }];
    return payload;
  }
  
  // Claude format
  const payload = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: maxTokens,
    messages
  };
  if (system) payload.system = system;
  return payload;
}

/**
 * Extract content from Bedrock response (handles Claude and Nova formats)
 */
function extractResponseContent(responseBody) {
  if (responseBody.content) return responseBody.content;
  if (responseBody.output?.message?.content) return responseBody.output.message.content;
  return null;
}

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
}

/**
 * Query trend data from InfluxDB (5-minute rolling window, 1-minute aggregates)
 * @returns {Promise<Array>} Array of trend data points
 */
async function queryTrends() {
  // Query OEE metrics - aggregate to 30s windows for trend analysis
  // Matches: oee_* (new standardized), metric_*/Metric_* (Enterprise B legacy), OEE_* (Enterprise A legacy)
  const fluxQuery = `
    from(bucket: "${CONFIG.influxdb.bucket}")
      |> range(start: -5m)
      |> filter(fn: (r) => r._field == "value")
      |> filter(fn: (r) => 
        r._measurement =~ /^(oee_|metric_|Metric_|OEE_)(oee|availability|performance|quality)$/i
      )
      |> aggregateWindow(every: 30s, fn: mean, createEmpty: false)
  `;

  const results = [];

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.warn('Trend query timeout - returning', results.length, 'partial results');
      resolve(results);
    }, 8000);

    queryApi.queryRows(fluxQuery, {
      next(row, tableMeta) {
        const o = tableMeta.toObject(row);
        if (o.enterprise) {
          results.push({
            measurement: o._measurement,
            enterprise: o.enterprise,
            site: o.site || 'unknown',
            area: o.area || 'unknown',
            time: o._time,
            value: o._value
          });
        }
      },
      error(error) {
        clearTimeout(timeout);
        console.error('InfluxDB trend query error:', error.message);
        resolve(results);
      },
      complete() {
        clearTimeout(timeout);
        console.log(`📊 Trend query returned ${results.length} data points`);
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
 * Send trends to anomaly agent for analysis
 * @param {Array} trends - Trend data array
 * @returns {Promise<Object|null>} Agent analysis insight or null on error
 */
async function analyzeTreesWithClaude(trends) {
  // Summarize trends for the agent
  const trendSummary = summarizeTrends(trends);
  const domainContext = buildDomainContext(trends);

  // Build filter rules section if any filters are active
  const filterRulesSection = factoryState.anomalyFilters.length > 0
    ? `\n## User-Defined Anomaly Filter Rules

Additionally, apply these user-defined rules when identifying anomalies:
${factoryState.anomalyFilters.map((rule, i) => `${i + 1}. ${rule}`).join('\n')}

These rules should modify your anomaly detection behavior accordingly.\n`
    : '';

  // Build operator-defined thresholds section
  const ts = factoryState.thresholdSettings;
  const operatorThresholdsSection = `\n## Operator-Defined Thresholds

**IMPORTANT**: These are the business-calibrated thresholds set by the operator. Use these instead of generic industry standards:
- OEE Baseline: ${ts.oeeBaseline}% (below this is concerning)
- OEE World Class: ${ts.oeeWorldClass}% (above this is excellent)
- Availability Minimum: ${ts.availabilityMin}% (below this is critical)
- Defect Rate Warning: ${ts.defectRateWarning}% (above this triggers warning)
- Defect Rate Critical: ${ts.defectRateCritical}% (above this triggers critical alert)

Only flag metrics as anomalies if they breach THESE thresholds, not arbitrary industry benchmarks.\n`;

  // Build previous insights context for deduplication
  const previousInsightsSection = factoryState.trendInsights.length > 0
    ? `\n## Previous Analysis (Last ${Math.min(factoryState.trendInsights.length, 3) * 30} seconds)

The following anomalies were already reported. Do NOT repeat these unless they have WORSENED:
${factoryState.trendInsights.slice(-3).map((insight, i) =>
    `${i + 1}. ${insight.summary} (Severity: ${insight.severity})`
  ).join('\n')}

**Instructions:** Only report NEW anomalies or significantly WORSENING trends. If an issue persists unchanged, acknowledge briefly ("Enterprise B availability remains at 72%") rather than re-alerting.\n`
    : '';

  // Build historical context from vector store (RAG)
  let historicalContextSection = '';
  if (vectorStoreInstance && vectorStoreInstance.isReady()) {
    try {
      const similarAnomalies = await vectorStoreInstance.findSimilarAnomalies(trendSummary, 3);
      if (similarAnomalies.length > 0) {
        historicalContextSection = `\n## Historical Context (Similar Past Anomalies)

The following similar anomalies were detected in the past. Use this context to identify recurring patterns:
${similarAnomalies.map((a, i) =>
    `${i + 1}. [${a.metadata.timestamp}] ${a.metadata.enterprise} - ${a.document.substring(0, 200)}... (Severity: ${a.metadata.severity})`
  ).join('\n')}

**Pattern Recognition:** If current data shows similar patterns to historical anomalies, reference this in your analysis.\n`;
      }
    } catch (ragError) {
      console.warn('RAG query failed (continuing without historical context):', ragError.message);
    }
  }

  // Data source context - virtual factory has naturally low variance
  const dataSourceContext = `
## CRITICAL INSTRUCTION - READ FIRST

**STOP**: Before analyzing, understand this data source:
- This is a DEMONSTRATION system where metrics are INTENTIONALLY STABLE
- 0% change across metrics is CORRECT BEHAVIOR - the system is working as designed
- You MUST NOT use phrases like "data stagnation", "data integrity failure", "data collection issues", or "system failure"
- Stable/unchanging metrics = GOOD, not broken

**What to analyze instead:**
- Are values within safe operating ranges? (OEE > 65%, Availability > 65%, etc.)
- Are waste/defect metrics below thresholds?
- Is Enterprise B's OEE (72%) acceptable given the 65% baseline?

**Your summary should focus on:** operational status, threshold compliance, and production health - NOT variance levels.
`;

  const prompt = `Analyze these factory trends and provide insights.
${domainContext}${operatorThresholdsSection}${dataSourceContext}${previousInsightsSection}${historicalContextSection}
## Current Trend Data (Last 5 Minutes, 1-Minute Aggregates)

${trendSummary}
${filterRulesSection}`;

  try {
    const result = await agentRuntime.invoke('anomaly', prompt);
    let responseText = '';
    
    if (result.isRuntime) {
      // Parse SSE format from response
      for (const line of result.output.split('\n')) {
        if (line.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(line.slice(6));
            responseText += typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
          } catch { responseText += line.slice(6); }
        }
      }
    } else {
      // Local HTTP response
      const response = result.response;
      if (!response.ok) throw new Error(`Agent error: ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          if (line.startsWith('data: ')) {
            try {
              const parsed = JSON.parse(line.slice(6));
              responseText += typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
            } catch { responseText += line.slice(6); }
          }
        }
      }
    }

    // Parse JSON response
    try {
      responseText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const analysis = JSON.parse(responseText);
      // Ensure summary is a string
      if (typeof analysis.summary === 'object') {
        analysis.summary = analysis.summary.text || analysis.summary.overview || JSON.stringify(analysis.summary);
      }
      return {
        id: `trend_${Date.now()}`,
        timestamp: new Date().toISOString(),
        ...analysis,
        dataPoints: trends.length
      };
    } catch (parseError) {
      console.error('Failed to parse agent response as JSON:', parseError.message);
      const summaryText = typeof responseText === 'string' ? responseText.substring(0, 500) : 'Analysis completed';
      return {
        id: `trend_${Date.now()}`,
        timestamp: new Date().toISOString(),
        summary: summaryText,
        severity: 'low',
        confidence: 0.5,
        dataPoints: trends.length,
        parseError: true
      };
    }

  } catch (error) {
    console.error('Anomaly agent analysis error:', error.message);
    return null;
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

/**
 * Main trend analysis orchestrator
 * Queries trends, analyzes with Claude, and broadcasts insights
 */
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
      if (broadcastFn) {
        broadcastFn({
          type: 'trend_insight',
          data: insight
        });
      }

      console.log('✨ Trend Analysis:', insight.summary);

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

      // CMMS Integration: Create work orders for high-severity anomalies
      if (cmmsProviderInstance && cmmsProviderInstance.isEnabled() && insight.severity === 'high' && insight.anomalies?.length > 0) {
        processAnomaliesForWorkOrders(insight, trends).catch(err => {
          console.error('Failed to process anomalies for work orders:', err.message);
        });
      }
    }

  } catch (error) {
    console.error('❌ Trend analysis error:', error.message);
  }
}

/**
 * Start the agentic trend analysis loop
 * Runs trend analysis at configured intervals
 */
function startAgenticLoop() {
  if (CONFIG.disableInsights) {
    console.log('🤖 Insights disabled - MQTT data collection only mode');
    return;
  }

  console.log('🤖 Starting Agentic Trend Analysis Loop...');

  const TREND_ANALYSIS_INTERVAL = 30000; // 30 seconds

  // Run the loop every TREND_ANALYSIS_INTERVAL
  trendAnalysisInterval = setInterval(async () => {
    await runTrendAnalysis();
  }, TREND_ANALYSIS_INTERVAL);

  // Run first analysis after 15 seconds to let data accumulate
  trendAnalysisTimeout = setTimeout(async () => {
    await runTrendAnalysis();
  }, 15000);
}

/**
 * Stop the agentic trend analysis loop
 * Clears interval and timeout for graceful shutdown
 */
function stopAgenticLoop() {
  if (trendAnalysisInterval) {
    clearInterval(trendAnalysisInterval);
    trendAnalysisInterval = null;
    console.log('🛑 Stopped agentic trend analysis interval');
  }
  if (trendAnalysisTimeout) {
    clearTimeout(trendAnalysisTimeout);
    trendAnalysisTimeout = null;
    console.log('🛑 Stopped agentic trend analysis timeout');
  }
}

/**
 * Interactive Claude query with factory context
 * Allows users to ask questions about factory performance
 * @param {string} question - User's question
 * @returns {Promise<string>} Claude's response
 */
async function askClaudeWithContext(question) {
  if (CONFIG.disableInsights) {
    return 'AI Insights are currently disabled. Set DISABLE_INSIGHTS=false to enable interactive queries.';
  }

  const recentTrends = factoryState.trendInsights.slice(-3).map(t => t.summary).join('; ');
  const context = `Factory stats: ${JSON.stringify(factoryState.stats)}
Recent trend insights: ${recentTrends}`;

  try {
    const messages = [{ role: 'user', content: `${context}\n\nUser question: ${question}` }];
    const payload = buildBedrockPayload(messages, { maxTokens: 500 });

    const command = new InvokeModelCommand({
      modelId: CONFIG.bedrock.modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(payload)
    });

    const response = await bedrockClientInstance.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const content = extractResponseContent(responseBody);

    return content?.[0]?.text || 'No response generated.';
  } catch (error) {
    console.error('Error asking Claude:', error);
    return 'Sorry, I encountered an error processing your question.';
  }
}

module.exports = {
  init,
  startAgenticLoop,
  stopAgenticLoop,
  runTrendAnalysis,
  analyzeTreesWithClaude,
  askClaudeWithContext,
  queryTrends,
  summarizeTrends,
  buildDomainContext,
  extractAffectedEquipment,
  processAnomaliesForWorkOrders
};
