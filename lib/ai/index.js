// lib/ai/index.js - Agentic AI Module for Trend Analysis and Claude Integration

const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
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
 * Start the agentic trend analysis loop
 * Runs trend analysis at configured intervals
 */
function startAgenticLoop() {
  if (CONFIG.disableInsights) {
    console.log('🤖 Insights disabled - MQTT data collection only mode');
    return;
  }

  if (trendAnalysisInterval || trendAnalysisTimeout) {
    console.warn('⚠️ Agentic loop already running, skipping duplicate start');
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
  runTrendAnalysis,
  analyzeTreesWithClaude,
  askClaudeWithContext,
  queryTrends,
  summarizeTrends,
  buildDomainContext,
  extractAffectedEquipment,
  processAnomaliesForWorkOrders
};
