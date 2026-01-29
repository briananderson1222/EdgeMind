# Bounded Context

## Vocabulary

MQTT (message broker protocol), InfluxDB (time-series database), ChromaDB (vector database for RAG), OEE (Overall Equipment Effectiveness = Availability × Performance × Quality), Availability (% uptime), Agentic Loop (periodic AI analysis cycle), MCP (Model Context Protocol - tool interface for AI agents), Anomaly (deviation from expected behavior), Root Cause Analysis (identifying underlying cause of symptoms), ISA-88 (batch control standard for pharma/bioprocessing - phases, states, batch IDs), Sparkplug B (MQTT payload encoding format with JSON-wrapped values), Cleanroom Monitoring (environmental zones tracking temperature, humidity, PM2.5 particulates), Equipment Discovery (dynamic detection of equipment from hierarchy cache), Batch Operations (ISA-88 equipment states and phase progression for Enterprise C)

## Invariants

1. Agent insights must be actionable (identify root cause, not just symptoms).
2. Analysis must complete within agentic loop interval (30s).
3. Data queries must not overload InfluxDB or ChromaDB.
4. Insights must reference specific equipment/measurements, not just enterprise-level aggregates.
5. Solution must work with existing MQTT topic structure (Enterprise/Site/Area/Machine/Component/Metric).
6. Enterprise C uses ISA-88 batch control, NOT OEE metrics - use get_batch_status tool.
7. Cleanroom environmental thresholds: temperature 18-25°C, humidity 40-60%, PM2.5 <5 good / 5-10 warning / >10 critical.
8. Insights panel must filter anomalies and insights by selected enterprise filter.
