# EdgeMind Architecture Documentation

This directory contains C4-model architecture diagrams for the EdgeMind factory intelligence platform.

## Overview

EdgeMind is a real-time factory intelligence dashboard that connects to industrial MQTT brokers, stores time-series data in InfluxDB, and uses Claude AI to analyze trends and detect anomalies.

## Diagram Index

| Level | Document | Description |
|-------|----------|-------------|
| C4 L1 | [1-context.md](1-context.md) | System context - EdgeMind and external actors |
| C4 L2 | [2-containers.md](2-containers.md) | Container view - Major runtime components |
| C4 L3 | [3-components.md](3-components.md) | Component view - lib/ module structure |
| Flows | [4-data-flows.md](4-data-flows.md) | Sequence diagrams for key data flows |

## Quick Architecture Summary

```
Virtual Factory (MQTT)
        |
        v
+------------------+
|   EdgeMind       |
|   server.js      |-----> InfluxDB (time-series storage)
|                  |-----> Claude AI (trend analysis)
+------------------+
        |
        v (WebSocket)
+------------------+
|   Dashboard      |
|   index.html     |
+------------------+
```

## Key Concepts

**Agentic Loop:** Every 30 seconds, the server queries InfluxDB for a 5-minute rolling window of metrics, sends aggregated data to Claude AI for analysis, and broadcasts insights to connected dashboards.

**MQTT Topic Structure:** Topics follow the ISA-95 hierarchy:
```
Enterprise {A|B|C}/Site{N}/area/machine/component/metric/type
```

**OEE Calculation:** Tier-based system that adapts to available data, from direct OEE metrics (Tier 1) to availability-only estimates (Tier 4).

## Technology Stack

- **Runtime:** Node.js
- **Data Ingestion:** MQTT.js
- **Time-Series DB:** InfluxDB 2.7
- **AI Analysis:** Anthropic Claude (via AWS Bedrock)
- **Real-time:** WebSocket (ws library)
- **Frontend:** Vanilla HTML/CSS/JS
