# AI Trend Analysis

**Source:** `lib/ai/index.js`, `lib/ai/tools.js`

## Overview

The AI Trend Analysis system runs every 30 seconds, querying InfluxDB for factory metrics and using Claude (via AWS Bedrock) to detect anomalies and provide recommendations. Claude can use investigative tools to drill down into root causes instead of simply restating metric values.

## Time Budget

The analysis cycle has a strict 30-second budget split across multiple operations.

| Operation | Timeout | Purpose |
|-----------|---------|---------|
| Total cycle | 30 seconds | Maximum time for complete analysis |
| Bedrock API call | 12 seconds | `BEDROCK_TIMEOUT_MS` - per-call limit |
| InfluxDB query | 8 seconds | `QUERY_TIMEOUT_MS` - per-query limit |

### Budget Breakdown

A typical analysis cycle with tool use:

```
Initial Bedrock call:       ~3-5 seconds
Tool execution (up to 3):   ~3-8 seconds each
Final Bedrock call:         ~3-5 seconds
-------------------------------------------
Total:                      ~15-25 seconds
```

If any operation exceeds its timeout, the system logs a warning and continues with available data.

## Tool-Use Mechanism

Claude can request investigative tools during analysis to understand **why** metrics are concerning, not just **what** the metrics are.

### How It Works

```
┌─────────────────────────────────────────────────────────────┐
│  1. Claude receives context + tool definitions              │
└─────────────────────────────────────────────────────────────┘
                           │
                           v
┌─────────────────────────────────────────────────────────────┐
│  2. Claude analyzes trends and decides:                     │
│     - Respond directly (no tools needed)                    │
│     - Request tool_use to investigate                       │
└─────────────────────────────────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              │                         │
         [No tools]              [tool_use requested]
              │                         │
              v                         v
┌─────────────────────┐   ┌─────────────────────────────────┐
│  Return analysis    │   │  3. Execute tool(s)             │
└─────────────────────┘   │     - get_oee_breakdown         │
                          │     - get_equipment_states      │
                          │     - get_downtime_analysis     │
                          └─────────────────────────────────┘
                                        │
                                        v
                          ┌─────────────────────────────────┐
                          │  4. Send tool_result back       │
                          │     to Claude                   │
                          └─────────────────────────────────┘
                                        │
                                        v
                          ┌─────────────────────────────────┐
                          │  5. Repeat up to 3 times        │
                          │     (MAX_TOOL_CALLS = 3)        │
                          └─────────────────────────────────┘
                                        │
                                        v
                          ┌─────────────────────────────────┐
                          │  6. Claude provides final       │
                          │     analysis with root causes   │
                          └─────────────────────────────────┘
```

### Available Tools

| Tool | Purpose | When Claude Uses It |
|------|---------|---------------------|
| `get_oee_breakdown` | Get A/P/Q component breakdown | When OEE is low, to identify bottleneck component |
| `get_equipment_states` | Get DOWN/IDLE/RUNNING states | When availability is low, to find specific machines |
| `get_downtime_analysis` | Get 24h downtime totals | When quality is low or defects are high |

See [[Module-AI-Tools]] for detailed tool documentation.

### Tool Call Limit

Maximum 3 tool calls per analysis cycle. This limit ensures the analysis completes within the 30-second budget.

When the limit is reached:

1. System logs: `Tool call limit (3) reached, stopping tool execution`
2. Claude receives: `Maximum tool calls reached. Provide your final analysis now.`
3. Claude generates final response with collected data

### Example Tool Flow

**Scenario:** Enterprise B OEE is at 72%

```
Claude: "I see Enterprise B OEE is 72%. Let me investigate why."

   ──► Tool: get_oee_breakdown(enterprise: "Enterprise B")
       Returns: { availability: 82%, performance: 95%, quality: 92% }

   ──► Tool: get_equipment_states(enterprise: "Enterprise B")
       Returns: { DOWN: 2, IDLE: 1, RUNNING: 5 }
       Equipment: [Filler-01: DOWN, Labeler-03: DOWN, Palletizer: IDLE]

Claude: "Enterprise B OEE is 72% due to availability issues (82%).
         Root cause: 2 machines are currently DOWN (Filler-01, Labeler-03)
         and 1 machine is IDLE (Palletizer). Recommend dispatching
         maintenance to Filler-01 first as it's a bottleneck machine."
```

## Message Flow

The Bedrock API uses a multi-turn conversation pattern for tool use:

```javascript
// Turn 1: Initial request with tools
messages: [{ role: 'user', content: prompt }]
response: { content: [{ type: 'tool_use', name: 'get_oee_breakdown', ... }] }

// Turn 2: Tool result
messages: [
  { role: 'user', content: prompt },
  { role: 'assistant', content: [{ type: 'tool_use', ... }] },
  { role: 'user', content: [{ type: 'tool_result', ... }] }
]
response: { content: [{ type: 'text', text: '{"summary": ...}' }] }
```

### Response Types

Claude's response can contain:

| Block Type | Description |
|------------|-------------|
| `tool_use` | Request to execute a tool |
| `text` | Final analysis (JSON format) |

When `tool_use` blocks are present, the system executes tools and loops back to Claude. When only `text` blocks are present, the analysis is complete.

## Timeout Handling

### Bedrock API Timeout

```javascript
const BEDROCK_TIMEOUT_MS = 12000;

const response = await Promise.race([
  bedrockClient.send(command),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Bedrock API timeout')), BEDROCK_TIMEOUT_MS)
  )
]);
```

If a Bedrock call times out:
- Warning logged: `Bedrock API call timeout (12000ms)`
- Analysis cycle fails gracefully
- Next cycle runs in 30 seconds

### InfluxDB Query Timeout

```javascript
const QUERY_TIMEOUT_MS = 8000;

await Promise.race([
  queryRows(fluxQuery, callbacks),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error('InfluxDB query timeout')), QUERY_TIMEOUT_MS)
  )
]);
```

If a tool query times out:
- Warning logged: `InfluxDB query timeout (8000ms)`
- Tool returns `{ success: false, error: 'InfluxDB query timeout' }`
- Claude continues with partial data

## Configuration

### Constants

| Constant | Value | Location |
|----------|-------|----------|
| `TREND_ANALYSIS_INTERVAL` | 30,000 ms | `lib/ai/index.js` |
| `BEDROCK_TIMEOUT_MS` | 12,000 ms | `lib/ai/index.js` |
| `QUERY_TIMEOUT_MS` | 8,000 ms | `lib/ai/tools.js` |
| `MAX_TOOL_CALLS` | 3 | `lib/ai/index.js` |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `AWS_REGION` | AWS region for Bedrock (default: us-east-1) |
| `BEDROCK_MODEL_ID` | Claude model ID |
| `DISABLE_INSIGHTS` | Set to 'true' to disable AI analysis |

## Insight Output

Each analysis produces an insight object:

```json
{
  "id": "trend_1706000000000",
  "timestamp": "2026-01-23T12:00:00.000Z",
  "summary": "Enterprise B operating at 72% OEE...",
  "trends": [...],
  "anomalies": [...],
  "wasteAlerts": [...],
  "recommendations": [...],
  "enterpriseInsights": {...},
  "severity": "medium",
  "confidence": 0.85,
  "dataPoints": 150,
  "toolCallsUsed": 2
}
```

The `toolCallsUsed` field indicates how many investigative tools were used during analysis.

## Related Documentation

| Document | Description |
|----------|-------------|
| [[Module-AI]] | Full AI module documentation |
| [[Module-AI-Tools]] | Tool definitions and handlers |
| [[Module-State]] | Factory state and equipment cache |
| [[Module-Domain-Context]] | Enterprise-specific knowledge |
