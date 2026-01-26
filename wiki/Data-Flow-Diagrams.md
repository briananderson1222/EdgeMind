# Data Flow Diagrams

> **Sequence Diagrams** - Shows how data moves through EdgeMind over time.

While C4 diagrams show static structure, these sequence diagrams show dynamic behavior. Each diagram illustrates a specific operation from start to finish, showing which components are involved and in what order. Use these to understand runtime behavior and debug issues.

## 1. MQTT Ingestion Flow

Data flows from the virtual factory MQTT broker into InfluxDB storage.

```mermaid
sequenceDiagram
    participant MQTT as MQTT Broker
    participant Handler as MQTT Handler
    participant Writer as influx/writer.js
    participant InfluxDB as InfluxDB
    participant WS as WebSocket Server
    participant Clients as Dashboard Clients

    MQTT->>Handler: message(topic, payload)
    Handler->>Handler: Increment message counter

    Handler->>Writer: parseTopicToInflux(topic, payload)
    Writer->>Writer: Extract tags from topic path
    Writer->>Writer: Parse numeric value
    Writer->>InfluxDB: writeApi.writePoint(point)

    alt Every 10th message (throttled)
        Handler->>WS: broadcast(mqtt_message)
        WS->>Clients: JSON message
    end
```

**Key Points:**
- Subscribes to `#` (all topics)
- Parses ISA-95 hierarchy from topic path
- Writes every message to InfluxDB
- Throttles WebSocket broadcast to every 10th message

## 2. Agentic Loop (AI Analysis Cycle)

Every 30 seconds, the server analyzes recent trends and broadcasts insights.

```mermaid
sequenceDiagram
    participant Timer as setInterval (30s)
    participant AI as ai/index.js
    participant InfluxDB as InfluxDB
    participant Claude as Claude AI (Bedrock)
    participant WS as WebSocket Server
    participant CMMS as MaintainX CMMS
    participant Clients as Dashboard Clients

    Timer->>AI: runAgenticLoop()

    AI->>InfluxDB: Query 5-min rolling window
    InfluxDB-->>AI: Aggregated metrics (1-min buckets)

    AI->>AI: Build context with domain knowledge
    AI->>AI: Format trend summary

    AI->>Claude: Analyze trends (messages API)
    Claude-->>AI: Structured insights JSON

    AI->>AI: Parse response, extract anomalies

    alt Anomaly detected with high confidence
        AI->>CMMS: Create work order
        CMMS-->>AI: Work order ID
    end

    AI->>WS: broadcast(trend_insight)
    WS->>Clients: JSON insight message
```

**Timing:**
- Loop interval: 30 seconds
- Query window: 5 minutes
- Aggregation: 1-minute buckets

## 3. Tool-Use Analysis Flow

When Claude detects concerning metrics, it can use tools to investigate root causes. This flow shows the iterative tool_use pattern in the agentic loop.

```mermaid
sequenceDiagram
    participant Timer as Agentic Loop
    participant AI as ai/index.js
    participant InfluxDB as InfluxDB
    participant Claude as Claude AI (Bedrock)
    participant Tools as ai/tools.js
    participant OEE as oee/index.js

    Timer->>AI: runTrendAnalysis()
    AI->>InfluxDB: Query 5-min rolling window
    InfluxDB-->>AI: Trend data

    AI->>AI: Build context + domain knowledge
    AI->>Claude: Analyze trends (with tool definitions)

    loop Max 3 iterations
        Claude-->>AI: tool_use request (e.g., get_oee_breakdown)
        AI->>Tools: executeTool(name, input)

        alt get_oee_breakdown
            Tools->>OEE: calculateOEEv2(enterprise, site)
            OEE->>InfluxDB: Query OEE components
            InfluxDB-->>OEE: A, P, Q values
            OEE-->>Tools: OEE breakdown result
        else get_equipment_states
            Tools->>Tools: Read from equipmentStateCache
            Tools-->>Tools: Filter by enterprise
        else get_downtime_analysis
            Tools->>InfluxDB: Query downtime metrics (24h)
            InfluxDB-->>Tools: timedownunplanned, timeidle, countdefect
        end

        Tools-->>AI: Tool result JSON
        AI->>Claude: tool_result message
    end

    Claude-->>AI: Final analysis JSON
    AI->>AI: Parse response, extract insights
```

**Available Tools:**

| Tool | Purpose | Data Source |
|------|---------|-------------|
| `get_oee_breakdown` | Availability, Performance, Quality components | InfluxDB (OEE calculation) |
| `get_equipment_states` | Current DOWN/IDLE/RUNNING states | In-memory cache |
| `get_downtime_analysis` | 24h downtime and defect aggregates | InfluxDB |

**Constraints:**
- Maximum 3 tool calls per analysis (30-second budget)
- Each Bedrock API call has 12-second timeout
- Each InfluxDB query has 8-second timeout

## 4. User Question Flow

When a user asks Claude a question through the dashboard.

```mermaid
sequenceDiagram
    participant User as Dashboard User
    participant DASH as Dashboard (app.js)
    participant WS as WebSocket Server
    participant AI as ai/index.js
    participant InfluxDB as InfluxDB
    participant Claude as Claude AI (Bedrock)

    User->>DASH: Type question, click Send
    DASH->>WS: ask_claude { question }

    WS->>AI: handleUserQuestion(question, ws)

    AI->>InfluxDB: Query current metrics
    InfluxDB-->>AI: Recent data

    AI->>AI: Build context (metrics + history + domain)
    AI->>AI: Inject memory context if available

    AI->>Claude: messages API with user question
    Claude-->>AI: Response

    AI->>WS: Send response to specific client
    WS->>DASH: JSON response
    DASH->>User: Display AI response
```

## 5. AgentCore Question Flow

When a user question is routed to AWS Bedrock Agents orchestrator for complex multi-turn queries.

```mermaid
sequenceDiagram
    participant User as Dashboard User
    participant DASH as Dashboard (app.js)
    participant WS as WebSocket Server
    participant Server as server.js
    participant AC as agentcore/index.js
    participant Client as BedrockAgentRuntimeClient
    participant Agent as AWS Bedrock Agent

    User->>DASH: Type complex question
    DASH->>WS: ask_agent { question, sessionId? }
    WS->>Server: Route to AgentCore handler

    Server->>AC: ask(question, sessionId)
    AC->>AC: Generate sessionId if not provided

    AC->>Client: InvokeAgentCommand
    Client->>Agent: Send question to orchestrator

    loop Streaming response
        Agent-->>Client: chunk.bytes (partial response)
        Client-->>AC: Decode chunk
        AC->>AC: Concatenate to answer
    end

    Agent-->>Client: Stream complete
    AC-->>Server: { answer, sessionId }

    Server->>WS: Send response to client
    WS->>DASH: JSON { answer, sessionId }
    DASH->>User: Display agent response
```

**Key Characteristics:**
- Streaming response (chunked delivery)
- Session continuity via sessionId (UUID)
- 1000 character question limit
- Handles specific error types: ResourceNotFoundException, ThrottlingException, ValidationException

**Session Management:**
- New session: Random UUID generated if sessionId not provided
- Continued session: Pass sessionId from previous response for multi-turn conversations

## 6. OEE Calculation Flow

OEE queries use a tier-based strategy to adapt to available data.

```mermaid
sequenceDiagram
    participant Client as API Client
    participant Routes as HTTP Routes
    participant OEE as oee/index.js
    participant Schema as schema/index.js
    participant InfluxDB as InfluxDB

    Client->>Routes: GET /api/oee/v2?enterprise=A
    Routes->>OEE: calculateOEE("Enterprise A")

    OEE->>Schema: discoverOEESchema()
    Schema->>InfluxDB: Query available measurements
    InfluxDB-->>Schema: Measurement list
    Schema-->>OEE: Schema with available metrics

    OEE->>OEE: Determine tier based on available data

    alt Tier 1: Direct OEE metric exists
        OEE->>InfluxDB: Query OEE measurement
    else Tier 2: A + P + Q components
        OEE->>InfluxDB: Query availability, performance, quality
        OEE->>OEE: Calculate OEE = A * P * Q
    else Tier 3: A + P only
        OEE->>InfluxDB: Query availability, performance
        OEE->>OEE: Calculate OEE = A * P (degraded)
    else Tier 4: Availability only
        OEE->>InfluxDB: Query availability
        OEE->>OEE: Use availability as proxy (degraded)
    end

    InfluxDB-->>OEE: Metric values
    OEE-->>Routes: OEE result with metadata
    Routes-->>Client: JSON response
```

**Response includes:**
- OEE value (0-100)
- Tier used
- Confidence level
- Measurements used
- Calculation method

## 7. Schema Discovery Flow

Dynamic schema discovery builds a cache of all measurements and hierarchy.

```mermaid
sequenceDiagram
    participant Client as API Client
    participant Routes as HTTP Routes
    participant Schema as schema/index.js
    participant State as state.js
    participant InfluxDB as InfluxDB

    Client->>Routes: GET /api/schema/hierarchy
    Routes->>Schema: refreshHierarchyCache()

    Schema->>State: Check cache age

    alt Cache valid (< 5 min old)
        State-->>Schema: Return cached hierarchy
    else Cache stale or empty
        Schema->>InfluxDB: Query distinct tag values
        InfluxDB-->>Schema: Enterprises, sites, areas, machines

        Schema->>InfluxDB: Query measurement counts per level
        InfluxDB-->>Schema: Data point counts

        Schema->>Schema: Build hierarchy tree
        Schema->>State: Update cache
    end

    Schema-->>Routes: Hierarchy JSON
    Routes-->>Client: Response
```

## 8. WebSocket Connection Lifecycle

```mermaid
sequenceDiagram
    participant Browser as Browser
    participant DASH as app.js
    participant WS as WebSocket Server
    participant State as state.js

    Browser->>DASH: Page load
    DASH->>WS: new WebSocket(ws://host:8080)
    WS->>WS: connection event

    WS->>State: Get recent messages, insights
    State-->>WS: Initial state data
    WS->>DASH: initial_state message

    DASH->>DASH: Render initial UI

    loop Real-time updates
        WS->>DASH: mqtt_message (throttled)
        DASH->>DASH: Update metrics display
    end

    loop Every 30 seconds
        WS->>DASH: trend_insight
        DASH->>DASH: Update AI panel
    end

    alt User asks question
        DASH->>WS: ask_claude message
        WS->>DASH: Response
    end

    Browser->>WS: close (navigate away)
    WS->>WS: Remove from clients set
```

## Data Flow Summary

```
                    +-----------------+
                    |  MQTT Broker    |
                    | (500+ msg/sec)  |
                    +--------+--------+
                             |
                             v
+------------------------------------------------------------------+
|                        server.js                                  |
|  +-------------+    +-------------+    +------------------+       |
|  | MQTT Handler|--->| Writer      |--->| InfluxDB         |       |
|  | (subscribe) |    | (parse)     |    | (store)          |       |
|  +-------------+    +-------------+    +--------+---------+       |
|        |                                        |                 |
|        | (1/10)                                 | (every 30s)     |
|        v                                        v                 |
|  +-------------+    +-------------+    +------------------+       |
|  | WebSocket   |<---| AI Module   |<---| Query            |       |
|  | Broadcast   |    | (analyze)   |    | (5-min window)   |       |
|  +------+------+    +------+------+    +------------------+       |
|         |                  |                                      |
+---------+------------------+--------------------------------------+
          |                  |
          v                  v
    +----------+      +-------------+
    | Dashboard |      | Claude AI   |
    | (browser) |      | (Bedrock)   |
    +----------+      +-------------+
```

## Tool-Use Summary

```
+------------------+
|  Agentic Loop    |
|  (every 30s)     |
+--------+---------+
         |
         v
+------------------+     +------------------+
| Build Context    |---->| Claude Bedrock   |
| (trends, domain) |     | (tool_use API)   |
+------------------+     +--------+---------+
                                  |
                    +-------------+-------------+
                    |             |             |
                    v             v             v
            +-----------+  +-----------+  +-----------+
            | get_oee   |  | get_equip |  | get_down  |
            | breakdown |  | states    |  | analysis  |
            +-----+-----+  +-----+-----+  +-----+-----+
                  |              |              |
                  v              v              v
            +-----------+  +-----------+  +-----------+
            | InfluxDB  |  | Memory    |  | InfluxDB  |
            | (OEE)     |  | Cache     |  | (24h)     |
            +-----------+  +-----------+  +-----------+
```

---

**Previous:** [[Component-Diagram]] - The internal module structure.

**Related:**
- [[System-Context]] - External systems and users
- [[Container-Diagram]] - Runtime architecture
