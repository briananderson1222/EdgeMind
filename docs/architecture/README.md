# EdgeMind Architecture Documentation

This directory contains C4-model architecture diagrams for the EdgeMind factory intelligence platform.

## Overview

EdgeMind is a real-time factory intelligence dashboard that connects to industrial MQTT brokers, stores time-series data in InfluxDB, and uses a **dual AI architecture** - a simple Claude loop for continuous monitoring plus an AgentCore multi-agent system for on-demand deep analysis.

## Diagram Index

| Level | Document | Description |
|-------|----------|-------------|
| C4 L1 | [1-context.md](1-context.md) | System context - EdgeMind and external actors |
| C4 L2 | [2-containers.md](2-containers.md) | Container view - Major runtime components |
| C4 L3 | [3-components.md](3-components.md) | Component view - lib/ module structure + AgentCore |
| Flows | [4-data-flows.md](4-data-flows.md) | Sequence diagrams for key data flows |

## Quick Architecture Summary

```
Virtual Factory (MQTT)
        |
        v
+------------------+
|   EdgeMind       |
|   server.js      |-----> InfluxDB (time-series storage)
|                  |
|   Dual AI:       |
|   - Simple Loop -|-----> Claude AI (continuous, 30s)
|   - AgentCore ---|-----> Multi-Agent System (on-demand)
+------------------+
        |
        v (WebSocket + Ask Agent)
+------------------+
|   Dashboard      |
|   index.html     |
+------------------+
```

## Key Concepts

### Dual AI Architecture

EdgeMind uses two complementary AI systems:

| System | Purpose | Trigger | Latency |
|--------|---------|---------|---------|
| **Simple Loop** | Continuous monitoring, real-time alerts | Automatic (30s) | 2-5s |
| **AgentCore** | Deep analysis, complex questions | User-initiated | 10-30s |

### Simple Loop (Continuous)

Every 30 seconds, the server queries InfluxDB for a 5-minute rolling window of metrics, sends aggregated data to Claude AI for analysis, and broadcasts insights to connected dashboards.

### AgentCore Multi-Agent System (On-Demand)

When users ask questions via the "Ask Agent" panel, the orchestrator routes to domain specialists:

| Agent | Domain |
|-------|--------|
| **OEE Analyst** | OEE analysis for Enterprise A/B |
| **Equipment Health** | Equipment state monitoring |
| **Waste Analyst** | Defect/quality analysis |
| **Batch Process** | ISA-88 batch metrics for Enterprise C (pharma) |

**Key Design Decision:** Enterprise C (Pharmaceutical) uses batch process metrics instead of OEE.

### MQTT Topic Structure

Topics follow the ISA-95 hierarchy:
```
Enterprise {A|B|C}/Site{N}/area/machine/component/metric/type
```

### OEE Calculation

Tier-based system that adapts to available data, from direct OEE metrics (Tier 1) to availability-only estimates (Tier 4).

## Technology Stack

- **Runtime:** Node.js
- **Data Ingestion:** MQTT.js
- **Time-Series DB:** InfluxDB 2.7
- **Simple Loop AI:** Claude Sonnet 4 (via AWS Bedrock)
- **AgentCore:** AWS Bedrock Agents (multi-agent collaboration)
- **Real-time:** WebSocket (ws library)
- **Frontend:** Vanilla HTML/CSS/JS
- **Infrastructure:** AWS CDK (Python)
