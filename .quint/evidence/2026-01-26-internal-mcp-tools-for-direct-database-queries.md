---
assurance_level: L2
carrier_ref: test-runner
valid_until: 2026-04-26
date: 2026-01-26
id: 2026-01-26-internal-mcp-tools-for-direct-database-queries.md
type: internal
target: mcp-tools-for-direct-database-queries
verdict: pass
content_hash: 23e3668a81c3dd6531a645f91fb11463
---

VALIDATED. Infrastructure exists: (1) InfluxDB queryApi available with 744 measurements across 5 enterprises. (2) ChromaDB running locally with 244,433 historical anomalies. (3) Enterprise B has detailed metrics: input_timedownunplanned, input_timedownplanned, input_timeidle, input_timerunning, input_countdefect - exactly what's needed for root cause investigation of availability issues. (4) Schema/hierarchy endpoints provide equipment topology for correlation queries. MCP tools would expose these capabilities to the agent via Bedrock tool_use API.