---
type: DRR
winner_id: mcp-tools-for-direct-database-queries
created: 2026-01-26T13:32:08-05:00
content_hash: 0dc1cb3d69a82ce304c1de022db7afd3
---

# Implement Investigative Insights via Bedrock Tool Use API

## Context
AI agent produces shallow insights that restate metrics ('Enterprise B availability is 72%') instead of investigating root causes. User wants agent to dig deeper into MQTT/InfluxDB data to explain WHY metrics are suboptimal. Related: AWS Bedrock AgentCore Runtime plan exists for production architecture with container-based Python agents.

## Decision
**Selected Option:** mcp-tools-for-direct-database-queries

Implement H1 (MCP Tools for Direct Database Queries) using Bedrock tool_use API in the existing Node.js agentic loop. This provides immediate investigative capability while AgentCore Runtime is built in parallel for production.

## Rationale
1. ALIGNED WITH ARCHITECTURE: Plan in federated-mixing-wozniak.md explicitly recommends 'proceed with H1 using tool_use' as the quick path. 2. SHARED BACKEND: Tools will call same APIs as AgentCore (get_oee_breakdown, get_equipment_states, query_influxdb), ensuring consistency. 3. VALIDATED: Internal testing confirmed infrastructure exists - 744 measurements, 244K historical anomalies in ChromaDB, detailed breakdown metrics available (timedownunplanned, timeidle, countdefect). 4. R_eff: 1.00 computed, risk-adjusted to 0.70 due to implementation complexity - acceptable given architectural alignment.

### Characteristic Space (C.16)
complexity:medium, risk:medium, time_to_value:hours, alignment:high

## Consequences
IMMEDIATE: (1) Modify lib/ai/index.js to use Bedrock tool_use in InvokeModelCommand. (2) Implement tool handlers for get_oee_breakdown, get_equipment_states, query_influxdb. (3) Add tool definitions to Claude prompt. RISKS: Query efficiency - agent may make multiple queries per cycle, monitor latency. DEFERRED: H2 (pre-query context) elements may still be useful as optimization if tool calls are slow. H3 (anomaly memory) deferred to AgentCore implementation which has native memory support. REVISIT: If tool_use latency exceeds 30s loop budget or AgentCore becomes available.
