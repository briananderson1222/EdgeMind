# C4 Level 2: Container Diagram

This diagram shows the major runtime containers that make up the EdgeMind system.

## Container Diagram

```mermaid
flowchart TB
    subgraph users[Users]
        OP[Plant Operator]
        ENG[Process Engineer]
    end

    subgraph edgemind[EdgeMind System]
        subgraph backend[Backend - server.js]
            HTTP[HTTP Server<br/>Express.js<br/>Port 3000]
            WS[WebSocket Server<br/>ws library<br/>Port 8080]
            MQTT_H[MQTT Handler<br/>lib/mqtt/topic-classifier.js]
            AGENT[Simple Loop<br/>30-second cycle]
            AGENTAPI[Agent API<br/>POST /api/agent/ask]
        end

        subgraph frontend[Frontend]
            DASH[Dashboard<br/>index.html + app.js<br/>Vanilla JS + Ask Agent Panel]
        end
    end

    subgraph external[External Systems]
        MQTT_B[MQTT Broker<br/>virtualfactory:1883]
        INFLUX[(InfluxDB<br/>Time-series DB<br/>Port 8086)]
        CLAUDE[Claude AI<br/>AWS Bedrock]
        CMMS[MaintainX<br/>CMMS API]
    end

    subgraph agentcore[AgentCore - Bedrock AgentCore]
        subgraph agents[Specialized Agents]
            ANOMALY[Anomaly Agent<br/>agent/anomaly<br/>Trend Analysis]
            CHAT[Chat Agent<br/>agent/chat<br/>Interactive Q&A]
            TROUBLE[Troubleshoot Agent<br/>agent/troubleshoot<br/>Diagnostics]
        end
    end

    MQTT_B -->|Subscribe '#'| MQTT_H
    MQTT_H -->|Write points| INFLUX
    AGENT -->|Query trends| INFLUX
    AGENT -->|Analyze| CLAUDE
    AGENT -->|Broadcast insights| WS
    MQTT_H -->|Throttled broadcast| WS

    WS <-->|Real-time data| DASH
    HTTP -->|Serve static files| DASH
    HTTP -->|REST API| OP
    HTTP -->|REST API| ENG

    AGENT -.->|Create work orders| CMMS

    %% AgentCore Flow
    DASH -->|User question| AGENTAPI
    AGENTAPI -->|Invoke| CHAT
    AGENTAPI -->|Invoke| TROUBLE
    ANOMALY -->|Scheduled analysis| INFLUX
    CHAT -->|Query data| HTTP
    TROUBLE -->|Query data| HTTP
    AGENTAPI -->|Response| DASH

    OP --> DASH
    ENG --> DASH
```

## Container Descriptions

### Backend (server.js)

Single Node.js process handling all backend responsibilities:

| Component | Technology | Responsibility |
|-----------|------------|----------------|
| HTTP Server | Express.js | Serve static files, REST API endpoints |
| WebSocket Server | ws library | Real-time bidirectional communication |
| MQTT Handler | mqtt.js | Subscribe to all topics, parse messages |
| Agentic Loop | setInterval | Periodic AI analysis cycle |

**Ports:**
- HTTP: 3000
- WebSocket: 8080 (separate port)

### Frontend (Dashboard)

Static web application served by the backend:

| File | Lines | Purpose |
|------|-------|---------|
| index.html | ~300 | HTML structure, layout |
| styles.css | ~1800 | All CSS styling |
| app.js | ~1500 | WebSocket client, UI logic, charts |

**Features:**
- Real-time metric display
- Enterprise/site hierarchy navigation
- AI insight panel
- OEE gauges and trend charts

### InfluxDB

Time-series database optimized for factory telemetry:

- **Data Model:** Measurement per metric type, tagged by hierarchy
- **Query Language:** Flux
- **Retention:** Configurable (default: infinite)
- **Aggregation:** 1-minute windows for AI analysis

### Claude AI (Bedrock) - Simple Loop

AI service for continuous trend analysis:

- **Input:** 5-minute rolling window of aggregated metrics
- **Output:** Structured JSON with insights, anomalies, recommendations
- **Trigger:** Automatic every 30 seconds

### AgentCore - Specialized Agents (Bedrock AgentCore)

Three specialized agents deployed via AWS Bedrock AgentCore:

| Agent | Directory | Purpose |
|-------|-----------|---------|
| **Anomaly Agent** | `agent/anomaly/` | Continuous trend analysis, threshold monitoring, waste alerts |
| **Chat Agent** | `agent/chat/` | Interactive Q&A with knowledge base tools |
| **Troubleshoot Agent** | `agent/troubleshoot/` | Equipment diagnostics, SOP lookup, guided troubleshooting |

**Agent Structure:**
```
agent/{name}/
├── .bedrock_agentcore.yaml  # AgentCore deployment config
├── Dockerfile               # Container build
├── pyproject.toml           # Python dependencies
└── src/
    ├── main.py              # Agent entrypoint
    ├── prompt.yaml          # System prompt
    ├── model/load.py        # Model configuration
    └── tools/               # Agent-specific tools (chat/troubleshoot)
```

**Key Design Decisions:**
- Enterprise C (Pharmaceutical) uses batch metrics, not OEE
- Chat and Troubleshoot agents have knowledge base tools for SOP lookup
- Anomaly agent runs on schedule for continuous monitoring

### Dual AI Architecture Comparison

| Aspect | Simple Loop | AgentCore Agents |
|--------|-------------|------------------|
| **Trigger** | Automatic (30s) | On-demand (user query) |
| **Purpose** | Continuous monitoring | Deep analysis & interaction |
| **Model** | Claude Sonnet 4 | Bedrock AgentCore |
| **Latency** | ~2-5 seconds | ~5-15 seconds |
| **Use Case** | Real-time alerts | Complex questions, troubleshooting |

## Port Mapping

```
+-------------------+
|     Container     |
+-------------------+
| HTTP  :3000  <----|----- Browser requests (REST API, static files)
| WS    :8080  <----|----- Browser WebSocket connection
| MQTT  :1883  -----|----- Outbound to broker (subscriber)
| Influx:8086  -----|----- Outbound to InfluxDB
+-------------------+
```

## Deployment Architecture

```mermaid
flowchart LR
    subgraph EC2[AWS EC2 Instance]
        subgraph docker[Docker Container]
            SERVER[server.js]
        end
        BIND[Bind Mounts:<br/>server.js<br/>index.html]
    end

    subgraph local[Local Development]
        DEV[npm run dev]
    end

    EC2 --> |Port 3000| USERS[Users]
    local --> |Port 3000| DEVUSER[Developer]
```

**Production (EC2):**
- Container: `edgemind-backend`
- Bind mounts: server.js, index.html (hot reload)
- Manual copy: lib/, styles.css, app.js

**Development (Local):**
- `npm run dev` with nodemon for auto-reload
- Same ports, same configuration
