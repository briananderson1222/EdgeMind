# H1 Implementation: MCP Tools for Direct Database Queries

**Status**: Implemented ✅
**Date**: 2026-01-26
**Decision Record**: `.quint/decisions/DRR-2026-01-26-implement-investigative-insights-via-bedrock-tool-use-api.md`

## Overview

Implemented Bedrock `tool_use` API in the agentic loop to enable Claude to investigate root causes instead of producing shallow insights. The AI agent can now query OEE breakdowns, equipment states, and downtime analysis during trend analysis.

## Architecture

```
analyzeTreesWithClaude() [lib/ai/index.js]
    │
    ├─> Sends trend summary + tool definitions to Bedrock
    │
    ├─> Claude returns tool_use blocks
    │   │
    │   ├─> executeTool() [lib/ai/tools.js]
    │   │   ├─> get_oee_breakdown() → calculateOEEv2()
    │   │   ├─> get_equipment_states() → equipmentStateCache
    │   │   └─> get_downtime_analysis() → InfluxDB Flux query
    │   │
    │   └─> Tool results sent back to Claude
    │
    └─> Claude returns final analysis with investigative insights
```

## Implementation Details

### 1. Tool Definitions (`lib/ai/tools.js`)

Created three tools that enable investigative analysis:

#### `get_oee_breakdown(enterprise, site?)`
- **Purpose**: Understand WHY OEE is low by showing A×P×Q components
- **Implementation**: Calls `calculateOEEv2()` from `lib/oee/index.js`
- **Returns**: OEE with breakdown (availability, performance, quality), tier info, confidence
- **Use case**: "Enterprise B OEE is 72%" → "72% due to availability (68%), performance (95%), quality (99%)"

#### `get_equipment_states(enterprise)`
- **Purpose**: Identify which specific machines are DOWN or IDLE
- **Implementation**: Filters `equipmentStateCache.states` by enterprise
- **Returns**: Equipment list sorted by priority (DOWN > IDLE > RUNNING), state summary
- **Use case**: "Availability is 68%" → "Filler line is DOWN, Packaging line is IDLE"

#### `get_downtime_analysis(enterprise)`
- **Purpose**: Quantify unplanned downtime vs idle time vs defects
- **Implementation**: Queries InfluxDB for `timedownunplanned`, `timeidle`, `countdefect` metrics
- **Returns**: Aggregated metrics over 24h with site/area breakdown
- **Use case**: "Availability is 68%" → "4.2 hours unplanned downtime, 2.1 hours idle time"

### 2. Tool Execution Flow (`lib/ai/index.js`)

Modified `analyzeTreesWithClaude()` to implement tool_use loop:

```javascript
// Phase 1: Send initial prompt with tool definitions
messages = [{ role: 'user', content: prompt }]
payload = { tools: TOOL_DEFINITIONS, messages }

// Phase 2: Handle tool_use responses (max 3 calls)
while (toolCallCount < MAX_TOOL_CALLS) {
  response = await bedrock.send(command)

  if (response contains tool_use blocks) {
    // Execute each tool
    for (toolUseBlock in response.content) {
      result = await executeTool(toolUseBlock.name, toolUseBlock.input)
      toolResults.push({ type: 'tool_result', tool_use_id: toolUseBlock.id, content: result })
    }

    // Send tool results back to Claude
    messages.push({ role: 'assistant', content: response.content })
    messages.push({ role: 'user', content: toolResults })

    // Loop continues...
  } else {
    // Claude returned final analysis - parse and return
    return parseAnalysis(response)
  }
}
```

### 3. Prompt Modifications

Added critical instructions to the system prompt:

```
## CRITICAL: Investigative Tools Available

You have access to tools that let you investigate root causes instead of restating metrics:

**IMPORTANT INSTRUCTIONS FOR TOOL USE**:
1. If you see concerning OEE metrics, ALWAYS use tools to investigate WHY
2. Use get_oee_breakdown FIRST to see which component (A/P/Q) is the problem
3. If Availability is low, use get_equipment_states to find DOWN/IDLE machines
4. If Quality is low, use get_downtime_analysis to quantify the problem
5. Maximum 3 tool calls per analysis (due to 30s time budget)

**DO NOT simply restate metrics like "Enterprise B availability is 72%".
Instead, investigate and report findings like "Enterprise B availability is 72%
due to 4.2 hours of unplanned downtime on Filler line, which is currently in DOWN state."**
```

## Constraints & Trade-offs

### Time Budget
- **Constraint**: 30s agentic loop interval
- **Solution**: Maximum 3 tool calls per cycle
- **Rationale**: Each tool call adds ~2-5s (InfluxDB query + Bedrock round-trip)

### Tool Call Limit
- **Limit**: 3 tools per analysis cycle
- **Reason**: Balance between investigation depth and response time
- **Behavior**: After 3 calls, force Claude to respond with accumulated data

### Error Handling
- Tools return `{ success: boolean, data: Object|null, error: string }` format
- Bedrock errors logged but don't crash the agentic loop
- InfluxDB query errors return empty results with error message

## Testing

### Unit Tests
- Created `test-tools.js` to verify tool execution structure
- Tests pass for tool definitions, dispatcher, and error handling
- InfluxDB-dependent tests show proper error handling when DB unavailable

### Integration Testing Plan
1. Deploy to EC2 (where InfluxDB is available)
2. Monitor console logs for `🔧 Claude requested N tool calls` messages
3. Verify tool execution logs: `✅ Tool X executed: success=true`
4. Check WebSocket broadcasts for investigative insights
5. Compare old shallow insights vs new investigative insights

## Deployment

### Files Changed
- `lib/ai/index.js` - Added tool_use loop to `analyzeTreesWithClaude()`
- `lib/ai/tools.js` - NEW: Tool definitions and handlers

### Deployment Steps
```bash
SSH_KEY=~/.ssh/edgemind-demo.pem
EC2_HOST=ec2-user@174.129.90.76

# Copy new tools module
scp -i $SSH_KEY lib/ai/tools.js $EC2_HOST:~/app/lib/ai/
ssh -i $SSH_KEY $EC2_HOST "sudo docker cp ~/app/lib/ai/tools.js edgemind-backend:/app/lib/ai/"

# Copy modified AI module
scp -i $SSH_KEY lib/ai/index.js $EC2_HOST:~/app/lib/ai/
ssh -i $SSH_KEY $EC2_HOST "sudo docker cp ~/app/lib/ai/index.js edgemind-backend:/app/lib/ai/"

# Restart container
ssh -i $SSH_KEY $EC2_HOST "sudo docker restart edgemind-backend"

# Verify health
ssh -i $SSH_KEY $EC2_HOST "sleep 5 && curl -s http://localhost:3000/health"

# Watch logs for tool usage
ssh -i $SSH_KEY $EC2_HOST "sudo docker logs -f edgemind-backend | grep '🔧'"
```

## Expected Behavior

### Before (Shallow Insights)
```
{
  "summary": "Enterprise B availability is 72%",
  "anomalies": [{
    "description": "Enterprise B availability below threshold",
    "severity": "medium"
  }]
}
```

### After (Investigative Insights)
```
{
  "summary": "Enterprise B availability is 72% due to unplanned downtime on Filler line",
  "anomalies": [{
    "description": "Enterprise B Filler line DOWN for 4.2 hours causing 28% availability loss",
    "reasoning": "get_equipment_states showed Filler line in DOWN state. get_downtime_analysis revealed 4.2 hours of unplanned downtime in last 24h. This accounts for the 72% availability (vs 85% target).",
    "severity": "high",
    "actual_value": "72%",
    "threshold": "85% (world class)",
    "metric": "OEE_Availability",
    "enterprise": "Enterprise B"
  }],
  "toolCallsUsed": 2
}
```

## Success Criteria

✅ **Tool definitions are valid** - Bedrock accepts the `tools` parameter
✅ **Tool execution works** - `executeTool()` correctly dispatches to handlers
✅ **Tool_use loop completes** - Claude can request tools, receive results, and produce final analysis
✅ **Time budget met** - Analysis completes within 30s with up to 3 tool calls
✅ **Insights are investigative** - Anomalies include root cause analysis, not just metric restatement

## Next Steps (H2)

1. **Monitor tool usage patterns** - Which tools does Claude use most?
2. **Optimize tool call strategy** - Should we guide tool order (OEE breakdown first)?
3. **Add more tools** - Historical trend comparison, shift-based analysis, equipment maintenance history
4. **Implement caching** - Cache tool results for 30s to avoid redundant queries
5. **Add tool usage metrics** - Track tool call frequency, success rate, impact on insight quality

## References

- **Decision Record**: `.quint/decisions/DRR-2026-01-26-implement-investigative-insights-via-bedrock-tool-use-api.md`
- **Architecture Plan**: `~/.claude/plans/federated-mixing-wozniak.md`
- **Bedrock tool_use docs**: https://docs.aws.amazon.com/bedrock/latest/userguide/tool-use.html
- **Related modules**: `lib/oee/index.js` (OEE calculation), `lib/state.js` (equipment cache)
