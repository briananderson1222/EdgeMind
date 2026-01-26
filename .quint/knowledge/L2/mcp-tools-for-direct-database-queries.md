---
scope: Requires new MCP server implementation, modifications to agentic loop to support tool use, ChromaDB schema for anomaly storage
kind: system
content_hash: 011801c602ffd5fc563314c7494458b4
---

# Hypothesis: MCP Tools for Direct Database Queries

Create custom MCP tools that allow the AI agent to query InfluxDB and ChromaDB directly during the agentic loop. Tools would include: (1) query_influx_correlation - find measurements that changed around the same time as the anomaly, (2) query_equipment_history - get fault/alarm history for specific equipment, (3) query_related_metrics - find all metrics for the same machine/area when one is anomalous, (4) search_anomaly_context - RAG search in ChromaDB for similar past anomalies and their resolutions. The agent would use these tools iteratively to build an investigation narrative.

## Rationale
{"anomaly": "Agent cannot investigate because it only receives pre-aggregated trend data", "approach": "Give agent direct query capability via MCP tools so it can pull specific data on demand", "alternatives_rejected": ["Passing all raw data to agent (context window limits)", "Pre-computing all correlations (combinatorial explosion)"]}