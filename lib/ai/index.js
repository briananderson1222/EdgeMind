// lib/ai/index.js - Agentic AI Module for Trend Analysis and Claude Integration

const { InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { queryApi } = require('../influx/client');
const CONFIG = require('../config');
const { ENTERPRISE_DOMAIN_CONTEXT } = require('../domain-context');
const { factoryState, equipmentStateCache } = require('../state');
const { TOOL_DEFINITIONS, executeTool } = require('./tools');

/**
 * Bedrock API timeout per call (configurable, default 30 seconds)
 * Tool-using responses need more time after tool execution completes
 */
const BEDROCK_TIMEOUT_MS = parseInt(process.env.BEDROCK_TIMEOUT_MS, 10) || 30000;

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
 * Send trends to Claude for analysis via AWS Bedrock with tool_use support
 * @param {Array} trends - Trend data array
 * @returns {Promise<Object|null>} Claude analysis insight or null on error
 */
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

  const prompt = `You are an AI factory monitoring agent analyzing time-series trend data from a manufacturing facility.
${domainContext}${operatorThresholdsSection}${dataSourceContext}${previousInsightsSection}${historicalContextSection}
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

## CRITICAL: Investigative Tools Available

You have access to tools that let you investigate root causes instead of restating metrics:

- **get_oee_breakdown**: When you see low OEE, use this to see if it's an Availability, Performance, or Quality problem
- **get_equipment_states**: When availability is low, use this to see which specific machines are DOWN or IDLE
- **get_downtime_analysis**: When you need to quantify unplanned downtime vs idle time vs defects

**IMPORTANT INSTRUCTIONS FOR TOOL USE**:
1. **INVESTIGATE ALL THREE ENTERPRISES** - You MUST query data for Enterprise A, Enterprise B, AND Enterprise C
2. For Enterprise A and Enterprise B, use get_oee_breakdown to see OEE components (Availability, Performance, Quality)
3. **For Enterprise C, use get_batch_status** - Enterprise C is a bioprocessing/pharma facility using ISA-88 batch control. Do NOT use OEE tools for Enterprise C. Instead:
   - Use get_batch_status to see equipment states (Running, Idle, Fault), phases, batch IDs, and recipes
   - Focus on phase progression, batch completion, and equipment health
   - Look for stuck phases, equipment in Fault state, or stale batch IDs
   - **IMPORTANT**: The response includes cleanroom environmental zones - check humidity (should be 40-60%), temperature (18-25°C), and PM2.5 (<5 good, 5-10 warning, >10 critical). Report any zones with Critical/Warning status.
4. If Availability is low for any enterprise (A or B), use get_equipment_states to find DOWN/IDLE machines
5. If Quality is low or defects are high, use get_downtime_analysis to quantify the problem
6. Maximum 9 tool calls per analysis (3 per enterprise)

**REQUIRED COVERAGE**: Your analysis MUST include insights from all three enterprises. Do not focus on just one enterprise.

**DO NOT simply restate metrics like "Enterprise B availability is 72%". Instead, investigate and report findings like "Enterprise B availability is 72% due to 4.2 hours of unplanned downtime on Filler line, which is currently in DOWN state."**

**CRITICAL: Respond with ONLY the JSON object below. No preamble, no explanation, no "Based on my investigation" - JUST the raw JSON starting with { and ending with }.**

{
  "summary": "brief overview - include root cause findings from tool data",
  "trends": [{"metric": "name", "direction": "rising|falling|stable", "change_percent": 0}],
  "anomalies": [
    {
      "description": "Brief description of the anomaly",
      "reasoning": "Detailed explanation of WHY this is an anomaly - what threshold was breached, what the expected vs actual values are, and what this means for operations",
      "metric": "metric name",
      "enterprise": "Enterprise A|B|C",
      "actual_value": "current value with unit",
      "threshold": "the threshold that was breached",
      "severity": "low|medium|high"
    }
  ],
  "wasteAlerts": [{"enterprise": "name", "metric": "name", "value": 0, "threshold": "warning|critical", "message": "description"}],
  "recommendations": ["list of actions"],
  "enterpriseInsights": {
    "Enterprise A": "glass manufacturing specific insight",
    "Enterprise B": "beverage bottling specific insight",
    "Enterprise C": "pharma batch operations insight - focus on batch phases, equipment states, AND cleanroom environmental conditions (humidity, temperature, PM2.5)"
  },
  "severity": "low|medium|high",
  "confidence": 0.0-1.0
}`;

  try {
    // Initial message to Claude with tool definitions
    const messages = [{ role: 'user', content: prompt }];
    let toolCallCount = 0;
    const MAX_TOOL_CALLS = 9; // Limit to 9 tool calls (3 per enterprise) to cover all enterprises
    let needsFinalResponse = false;

    // Tool use loop: handle multiple rounds of tool calls
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const payload = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 2000,
        tools: TOOL_DEFINITIONS,
        messages
      };

      const command = new InvokeModelCommand({
        modelId: CONFIG.bedrock.modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(payload)
      });

      // PERFORMANCE: Add timeout to prevent hanging Bedrock API calls
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
          console.warn(`⚠️ Bedrock API call timeout (${BEDROCK_TIMEOUT_MS}ms)`);
        }
        throw timeoutError;
      }

      const responseBody = JSON.parse(new TextDecoder().decode(response.body));

      if (!responseBody.content || responseBody.content.length === 0) {
        console.error('Unexpected Bedrock response format:', JSON.stringify(responseBody));
        // Return valid insight structure instead of null
        return {
          id: `trend_${Date.now()}`,
          timestamp: new Date().toISOString(),
          summary: 'Analysis temporarily unavailable - unexpected API response',
          trends: [],
          anomalies: [],
          wasteAlerts: [],
          recommendations: [],
          enterpriseInsights: {},
          severity: 'low',
          confidence: 0.1,
          dataPoints: trends.length,
          apiError: true
        };
      }

      // Check if Claude wants to use tools
      const toolUseBlocks = responseBody.content.filter(block => block.type === 'tool_use');

      if (toolUseBlocks.length === 0) {
        // No tools requested - Claude provided final analysis
        // Extract text content from response
        const textBlock = responseBody.content.find(block => block.type === 'text');
        if (!textBlock) {
          console.error('No text content in final response:', JSON.stringify(responseBody));
          // Return valid insight structure instead of null
          return {
            id: `trend_${Date.now()}`,
            timestamp: new Date().toISOString(),
            summary: 'Analysis complete - no detailed text response',
            trends: [],
            anomalies: [],
            wasteAlerts: [],
            recommendations: [],
            enterpriseInsights: {},
            severity: 'low',
            confidence: 0.3,
            dataPoints: trends.length,
            noTextBlock: true
          };
        }

        let responseText = textBlock.text;

        // Parse and return the analysis
        try {
          // Clean up response - remove markdown code blocks
          responseText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

          // Extract JSON from response - Claude sometimes adds preamble text before JSON
          // Use balanced brace counting instead of greedy regex
          const jsonText = extractJSONFromText(responseText);
          if (!jsonText) {
            throw new Error('No valid JSON object found in response');
          }

          const analysis = JSON.parse(jsonText);

          // Ensure required fields are always present (frontend expects these)
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
            dataPoints: trends.length,
            toolCallsUsed: toolCallCount
          };
        } catch (parseError) {
          console.error('Failed to parse Claude response as JSON:', parseError.message);
          console.error('Raw response:', responseText.substring(0, 200));

          // Try to extract summary field from malformed JSON
          let extractedSummary = 'Analysis could not be parsed';
          const summaryMatch = responseText.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
          if (summaryMatch) {
            extractedSummary = summaryMatch[1];
          }

          // Return valid insight structure even on parse error
          return {
            id: `trend_${Date.now()}`,
            timestamp: new Date().toISOString(),
            summary: extractedSummary,
            trends: [],
            anomalies: [],
            wasteAlerts: [],
            recommendations: [],
            enterpriseInsights: {},
            severity: 'low',
            confidence: 0.5,
            dataPoints: trends.length,
            toolCallsUsed: toolCallCount,
            parseError: true
          };
        }
      }

      // Claude wants to use tools - execute them
      console.log(`🔧 Claude requested ${toolUseBlocks.length} tool calls`);

      // Add assistant message with tool_use blocks
      messages.push({
        role: 'assistant',
        content: responseBody.content
      });

      // Execute each tool and collect results
      const toolResults = [];
      for (const toolUseBlock of toolUseBlocks) {
        if (toolCallCount >= MAX_TOOL_CALLS) {
          needsFinalResponse = true;
          console.warn(`⚠️ Tool call limit (${MAX_TOOL_CALLS}) reached, stopping tool execution`);
          break;
        }

        toolCallCount++;
        const { id, name, input } = toolUseBlock;
        const result = await executeTool(name, input);

        toolResults.push({
          type: 'tool_result',
          tool_use_id: id,
          content: JSON.stringify(result)
        });

        console.log(`✅ Tool ${name} executed: success=${result.success}`);
      }

      // Add tool results as user message
      messages.push({
        role: 'user',
        content: toolResults
      });

      // Remind Claude to respond with JSON only
      if (toolResults.length > 0) {
        messages[messages.length - 1].content.push({
          type: 'text',
          text: 'Respond with ONLY the JSON object. No preamble text. Start with { end with }.'
        });
      }

      // If we hit the limit, force Claude to respond with what it has
      if (needsFinalResponse) {
        console.log(`🛑 Tool call limit reached, requesting final analysis from Claude`);
        messages.push({
          role: 'user',
          content: [{
            type: 'text',
            text: 'Maximum tool calls reached. Provide your final analysis now based on the data collected.'
          }]
        });
      }

      // Loop continues - send tool results back to Claude
    }

  } catch (error) {
    console.error('Claude trend analysis error:', error.message);
    console.error('Error details:', error);

    // Log timeout warnings for monitoring
    if (error.message.includes('timeout')) {
      console.warn('⚠️ Analysis failed due to timeout - consider reducing tool usage or increasing time budget');
    }

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
 * Build a targeted prompt for Tier 2 analysis — focused on specific changes.
 * @param {Array} changes - Array of detected changes from detectChanges()
 * @param {string} trendSummary - Current trend summary string
 * @returns {string} Focused prompt for Claude
 */
function buildTargetedPrompt(changes, trendSummary) {
  const changeDescriptions = changes.map(c => {
    if (c.type === 'metric_change') {
      return `- ${c.enterprise}: ${c.measurement} ${c.direction} from ${c.previousValue} to ${c.currentValue} (${c.changePct}% change)`;
    } else if (c.type === 'state_transition') {
      return `- Equipment ${c.equipment}: transitioned from ${c.previousState} to ${c.currentState}`;
    }
    return `- ${JSON.stringify(c)}`;
  }).join('\n');

  const affectedEnterprises = [...new Set(changes.map(c => c.enterprise))];

  return `You are an AI factory monitoring agent investigating SPECIFIC CHANGES detected in the last 2 minutes.

## Detected Changes (INVESTIGATE THESE)

${changeDescriptions}

## Current Metrics Snapshot

${trendSummary}

## Your Task

Investigate the root cause of the changes listed above. Focus ONLY on the affected enterprise(s): ${affectedEnterprises.join(', ')}.

Use available tools to drill into the specific problem:
- If a metric dropped, use get_oee_breakdown to identify the A/P/Q component responsible
- If equipment changed state, use get_equipment_states to see current machine statuses
- For Enterprise C, use get_batch_status instead of OEE tools

Maximum 3 tool calls for this targeted investigation.

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
 * Build a comprehensive summary prompt for Tier 3 — with enterprise rotation.
 * @param {string} enterpriseFocus - Which enterprise to deep-dive into
 * @param {string} trendSummary - Current trend summary
 * @param {string} domainContext - Domain context string
 * @returns {string} Comprehensive prompt
 */
function buildSummaryPrompt(enterpriseFocus, trendSummary, domainContext) {
  const focusInstruction = enterpriseFocus === 'cross-enterprise'
    ? `**FOCUS: Cross-Enterprise Comparison.** Compare performance across all three enterprises. Identify which enterprise is leading, which needs attention, and any cross-cutting patterns.`
    : `**FOCUS: ${enterpriseFocus} Deep Dive.** Provide detailed analysis of ${enterpriseFocus} while briefly covering the other enterprises. Investigate root causes for any issues in ${enterpriseFocus}.`;

  const operatorThresholds = factoryState.thresholdSettings;
  const ts = operatorThresholds;

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

## Analysis Focus

${focusInstruction}

## Instructions

1. Use tools to investigate all three enterprises (get_oee_breakdown for A/B, get_batch_status for C)
2. Provide a comprehensive 15-minute summary suitable for the operations dashboard
3. Identify emerging trends, not just current values
4. Maximum 9 tool calls

**CRITICAL: Respond with ONLY the JSON object. No preamble text.**

{
  "summary": "Comprehensive 15-minute summary with ${enterpriseFocus} focus",
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
    const prompt = buildTargetedPrompt(changes, trendSummary);

    const insight = await callClaudeWithPrompt(prompt, trends, 3); // Max 3 tool calls

    if (insight) {
      insight.analysisTier = 2;
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
    const prompt = buildSummaryPrompt(enterpriseFocus, trendSummary, domainContext);

    const insight = await callClaudeWithPrompt(prompt, trends, 9); // Full tool budget

    if (insight) {
      insight.analysisTier = 3;
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
 * Call Claude via Bedrock with a given prompt and tool call budget.
 * Shared by Tier 2 and Tier 3 — extracted from analyzeTreesWithClaude.
 *
 * @param {string} prompt - The prompt to send
 * @param {Array} trends - Trend data (for metadata)
 * @param {number} maxToolCalls - Maximum number of tool calls allowed
 * @returns {Promise<Object|null>} Claude insight or null
 */
async function callClaudeWithPrompt(prompt, trends, maxToolCalls) {
  try {
    const messages = [{ role: 'user', content: prompt }];
    let toolCallCount = 0;
    let needsFinalResponse = false;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const payload = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 2000,
        tools: TOOL_DEFINITIONS,
        messages
      };

      const command = new InvokeModelCommand({
        modelId: CONFIG.bedrock.modelId,
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
          console.warn(`⚠️ Bedrock API call timeout (${BEDROCK_TIMEOUT_MS}ms)`);
        }
        throw timeoutError;
      }

      const responseBody = JSON.parse(new TextDecoder().decode(response.body));

      if (!responseBody.content || responseBody.content.length === 0) {
        return {
          id: `trend_${Date.now()}`,
          timestamp: new Date().toISOString(),
          summary: 'Analysis temporarily unavailable - unexpected API response',
          trends: [], anomalies: [], wasteAlerts: [], recommendations: [],
          enterpriseInsights: {}, severity: 'low', confidence: 0.1,
          dataPoints: trends.length, apiError: true
        };
      }

      const toolUseBlocks = responseBody.content.filter(block => block.type === 'tool_use');

      if (toolUseBlocks.length === 0) {
        const textBlock = responseBody.content.find(block => block.type === 'text');
        if (!textBlock) {
          return {
            id: `trend_${Date.now()}`,
            timestamp: new Date().toISOString(),
            summary: 'Analysis complete - no detailed text response',
            trends: [], anomalies: [], wasteAlerts: [], recommendations: [],
            enterpriseInsights: {}, severity: 'low', confidence: 0.3,
            dataPoints: trends.length, noTextBlock: true
          };
        }

        let responseText = textBlock.text;
        try {
          responseText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          const jsonText = extractJSONFromText(responseText);
          if (!jsonText) throw new Error('No valid JSON object found in response');

          const analysis = JSON.parse(jsonText);
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
            dataPoints: trends.length,
            toolCallsUsed: toolCallCount
          };
        } catch (parseError) {
          console.error('Failed to parse Claude response as JSON:', parseError.message);
          let extractedSummary = 'Analysis could not be parsed';
          const summaryMatch = responseText.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
          if (summaryMatch) extractedSummary = summaryMatch[1];

          return {
            id: `trend_${Date.now()}`,
            timestamp: new Date().toISOString(),
            summary: extractedSummary,
            trends: [], anomalies: [], wasteAlerts: [], recommendations: [],
            enterpriseInsights: {}, severity: 'low', confidence: 0.5,
            dataPoints: trends.length, toolCallsUsed: toolCallCount, parseError: true
          };
        }
      }

      // Tool use handling
      console.log(`🔧 Claude requested ${toolUseBlocks.length} tool calls`);
      messages.push({ role: 'assistant', content: responseBody.content });

      const toolResults = [];
      for (const toolUseBlock of toolUseBlocks) {
        if (toolCallCount >= maxToolCalls) {
          needsFinalResponse = true;
          console.warn(`⚠️ Tool call limit (${maxToolCalls}) reached`);
          break;
        }

        toolCallCount++;
        const { id, name, input } = toolUseBlock;
        const result = await executeTool(name, input);
        toolResults.push({ type: 'tool_result', tool_use_id: id, content: JSON.stringify(result) });
        console.log(`✅ Tool ${name} executed: success=${result.success}`);
      }

      messages.push({ role: 'user', content: toolResults });
      if (toolResults.length > 0) {
        messages[messages.length - 1].content.push({
          type: 'text',
          text: 'Respond with ONLY the JSON object. No preamble text. Start with { end with }.'
        });
      }

      if (needsFinalResponse) {
        messages.push({
          role: 'user',
          content: [{ type: 'text', text: 'Maximum tool calls reached. Provide your final analysis now.' }]
        });
      }
    }
  } catch (error) {
    console.error('Claude analysis error:', error.message);
    if (error.message.includes('timeout')) {
      console.warn('⚠️ Analysis failed due to timeout');
    }
    return null;
  }
}

/**
 * Process an insight: store, broadcast, handle anomalies with dedup.
 * Shared by Tier 2 and Tier 3 paths, and backward-compat runTrendAnalysis.
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
 * Main trend analysis orchestrator (backward compatible)
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

      // Extract and store anomalies with cap of 100
      if (insight.anomalies && Array.isArray(insight.anomalies)) {
        insight.anomalies.forEach(anomaly => {
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
 * Start the agentic trend analysis loop (tiered architecture — ADR-016)
 *
 * Tier 1: Cheap delta detection every AGENT_CHECK_INTERVAL_MS (default 2 min). No AI call.
 * Tier 2: Targeted AI analysis — triggered by Tier 1 when meaningful changes detected.
 * Tier 3: Comprehensive summary every AGENT_SUMMARY_INTERVAL_MS (default 15 min).
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

    const response = await bedrockClientInstance.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    return responseBody.content[0].text;
  } catch (error) {
    console.error('Error asking Claude:', error);
    return 'Sorry, I encountered an error processing your question.';
  }
}

module.exports = {
  init,
  startAgenticLoop,
  stopAgenticLoop,
  pauseAgenticLoop,
  resumeAgenticLoop,
  getAgentStatus,
  runTrendAnalysis,
  analyzeTreesWithClaude,
  askClaudeWithContext,
  queryTrends,
  summarizeTrends,
  buildDomainContext,
  extractAffectedEquipment,
  processAnomaliesForWorkOrders,
  // Tiered analysis exports (ADR-016)
  detectChanges,
  buildTargetedPrompt,
  buildSummaryPrompt,
  checkForChanges,
  runTargetedAnalysis,
  runScheduledSummary,
  isDuplicateAnomaly,
  recordAnomaly,
  cleanAnomalyCache
};
