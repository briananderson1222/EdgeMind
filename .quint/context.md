# Bounded Context

## Vocabulary

MQTT (message broker protocol), InfluxDB (time-series database), ChromaDB (vector database for RAG), OEE (Overall Equipment Effectiveness = Availability × Performance × Quality), Availability (% uptime), Agentic Loop (periodic AI analysis cycle), MCP (Model Context Protocol - tool interface for AI agents), Anomaly (deviation from expected behavior), Root Cause Analysis (identifying underlying cause of symptoms)

## Invariants

1. Agent insights must be actionable (identify root cause, not just symptoms).
2. Analysis must complete within agentic loop interval (30s).
3. Data queries must not overload InfluxDB or ChromaDB.
4. Insights must reference specific equipment/measurements, not just enterprise-level aggregates.
5. Solution must work with existing MQTT topic structure (Enterprise/Site/Area/Machine/Component/Metric).
