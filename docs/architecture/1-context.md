# C4 Level 1: System Context

This diagram shows EdgeMind within its operating environment, including all external systems and actors.

## System Context Diagram

```mermaid
C4Context
    title EdgeMind System Context

    Person(operator, "Plant Operator", "Monitors factory performance and responds to anomalies")
    Person(engineer, "Process Engineer", "Analyzes trends and optimizes production")

    System(edgemind, "EdgeMind", "Real-time factory intelligence platform with AI-powered anomaly detection")

    System_Ext(mqtt, "Virtual Factory MQTT Broker", "ProveIt! Conference factory simulator publishing OPC-UA style topics")
    System_Ext(influxdb, "InfluxDB", "Time-series database for factory metrics")
    System_Ext(claude, "Claude AI (Bedrock)", "Anthropic's LLM for trend analysis and anomaly reasoning")
    System_Ext(cmms, "MaintainX CMMS", "Computerized maintenance management system")

    Rel(operator, edgemind, "Views dashboard, receives alerts")
    Rel(engineer, edgemind, "Analyzes trends, asks questions")
    Rel(mqtt, edgemind, "Publishes factory telemetry", "MQTT/TCP 1883")
    Rel(edgemind, influxdb, "Stores and queries metrics", "HTTP/8086")
    Rel(edgemind, claude, "Sends trend data, receives insights", "AWS Bedrock API")
    Rel(edgemind, cmms, "Creates work orders for anomalies", "REST API")
```

## Simplified View (GitHub Compatible)

```mermaid
flowchart TB
    subgraph Users
        OP[Plant Operator]
        ENG[Process Engineer]
    end

    subgraph EdgeMind System
        EM[EdgeMind Platform]
    end

    subgraph External Systems
        MQTT[Virtual Factory<br/>MQTT Broker]
        INFLUX[InfluxDB]
        CLAUDE[Claude AI<br/>AWS Bedrock]
        CMMS[MaintainX<br/>CMMS]
    end

    MQTT -->|MQTT TCP 1883<br/>Factory telemetry| EM
    EM -->|HTTP 8086<br/>Store & query| INFLUX
    EM -->|Bedrock API<br/>Trend analysis| CLAUDE
    EM -->|REST API<br/>Work orders| CMMS
    OP -->|View dashboard| EM
    ENG -->|Analyze trends| EM
```

## External System Details

### Virtual Factory MQTT Broker

- **Host:** `virtualfactory.proveit.services:1883`
- **Protocol:** MQTT over TCP (no TLS)
- **Topics:** ISA-95 hierarchy with 3 enterprises, multiple sites
- **Message Rate:** ~500+ messages/second across all topics

### InfluxDB

- **Version:** 2.7
- **Port:** 8086
- **Organization:** proveit
- **Bucket:** factory
- **Retention:** Default (infinite)

### Claude AI (AWS Bedrock)

- **Model:** Claude 3.5 Sonnet (claude-3-5-sonnet-20241022)
- **Region:** us-east-1
- **Purpose:** Trend analysis, anomaly reasoning, natural language queries

### MaintainX CMMS

- **Integration:** REST API
- **Purpose:** Create work orders for detected anomalies
- **Status:** Optional integration (configurable)

## Data Volumes

| Flow | Volume | Frequency |
|------|--------|-----------|
| MQTT Ingestion | ~500 msg/sec | Continuous |
| InfluxDB Writes | ~500 points/sec | Continuous |
| AI Analysis | 1 request | Every 30 seconds |
| WebSocket Broadcast | ~50 msg/sec | Throttled (1/10th) |
