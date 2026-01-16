# C4 Level 3: Component Diagram

This diagram shows the internal structure of the backend, focusing on the modular lib/ architecture and the AgentCore multi-agent system.

## Component Overview

```mermaid
flowchart TB
    subgraph server[server.js - Entry Point]
        ROUTES[HTTP Routes]
        MQTT_SUB[MQTT Subscriber]
        WS_SERVER[WebSocket Server]
        LOOP[Simple Loop Timer]
        AGENT_ROUTE[Agent API Route<br/>POST /api/agent/ask]
    end

    subgraph lib[lib/ - Backend Modules]
        subgraph foundation[Foundation Layer]
            CONFIG[config.js<br/>Settings & constants]
            VALID[validation.js<br/>Input sanitization]
            STATE[state.js<br/>Shared state objects]
            DOMAIN[domain-context.js<br/>Measurement classifications]
        end

        subgraph data[Data Layer]
            INFLUX_C[influx/client.js<br/>InfluxDB connection]
            INFLUX_W[influx/writer.js<br/>Topic parser & writer]
        end

        subgraph business[Business Logic Layer]
            SCHEMA[schema/index.js<br/>Schema discovery & cache]
            OEE[oee/index.js<br/>OEE calculation engine]
            AI[ai/index.js<br/>Claude integration]
        end

        subgraph integrations[Integration Layer]
            CMMS_I[cmms-interface.js<br/>Generic CMMS interface]
            CMMS_M[cmms-maintainx.js<br/>MaintainX provider]
        end
    end

    subgraph agentcore[AgentCore - AWS Bedrock Agents]
        subgraph orchestration[Orchestration]
            ORCH[Orchestrator Agent<br/>edgemind-orchestrator<br/>Supervisor Mode]
        end
        subgraph specialists[Specialist Agents]
            OEE_A[OEE Analyst<br/>edgemind-oee-analyst]
            EQUIP_A[Equipment Health<br/>edgemind-equipment-health]
            WASTE_A[Waste Analyst<br/>edgemind-waste-analyst]
            BATCH_A[Batch Process<br/>edgemind-batch-process]
        end
        subgraph tools[Lambda Action Groups]
            LAMBDA[Tool Router Lambda]
        end
    end

    ROUTES --> SCHEMA
    ROUTES --> OEE
    MQTT_SUB --> INFLUX_W
    LOOP --> AI
    WS_SERVER --> AI

    CONFIG --> INFLUX_C
    INFLUX_C --> INFLUX_W
    INFLUX_C --> SCHEMA
    INFLUX_C --> OEE
    INFLUX_C --> AI

    STATE --> SCHEMA
    STATE --> OEE
    STATE --> AI

    VALID --> SCHEMA
    VALID --> OEE

    DOMAIN --> SCHEMA
    DOMAIN --> AI

    CMMS_I --> CMMS_M
    AI -.-> CMMS_I

    %% AgentCore Flow
    AGENT_ROUTE -->|Invoke| ORCH
    ORCH -->|Route| OEE_A
    ORCH -->|Route| EQUIP_A
    ORCH -->|Route| WASTE_A
    ORCH -->|Route| BATCH_A
    OEE_A --> LAMBDA
    EQUIP_A --> LAMBDA
    WASTE_A --> LAMBDA
    BATCH_A --> LAMBDA
    LAMBDA -->|get_oee_breakdown| ROUTES
    LAMBDA -->|get_equipment_states| ROUTES
    LAMBDA -->|query_influxdb| INFLUX_C
```

## Module Dependency Graph

```mermaid
flowchart BT
    subgraph Layer 0 - Foundation
        CONFIG[config.js]
        VALID[validation.js]
        STATE[state.js]
        DOMAIN[domain-context.js]
    end

    subgraph Layer 1 - Data
        INFLUX_C[influx/client.js]
        INFLUX_W[influx/writer.js]
    end

    subgraph Layer 2 - Business
        SCHEMA[schema/index.js]
        OEE[oee/index.js]
        AI[ai/index.js]
    end

    subgraph Layer 3 - Integration
        CMMS_I[cmms-interface.js]
        CMMS_M[cmms-maintainx.js]
    end

    INFLUX_C --> CONFIG
    INFLUX_W --> INFLUX_C

    SCHEMA --> INFLUX_C
    SCHEMA --> STATE
    SCHEMA --> CONFIG
    SCHEMA --> VALID
    SCHEMA --> DOMAIN

    OEE --> INFLUX_C
    OEE --> STATE
    OEE --> SCHEMA
    OEE --> CONFIG
    OEE --> VALID

    AI --> INFLUX_C
    AI --> STATE
    AI --> CONFIG
    AI --> DOMAIN

    CMMS_M --> CMMS_I
```

## Module Details

### Foundation Layer (No Dependencies)

| Module | Purpose | Key Exports |
|--------|---------|-------------|
| `config.js` | Centralized configuration | `INFLUX_*`, `MQTT_*`, `AI_*` constants |
| `validation.js` | Input sanitization | `sanitizeString()`, `validateEnterprise()` |
| `state.js` | Shared state containers | `factoryState`, `schemaCache`, `equipmentStateCache` |
| `domain-context.js` | Domain knowledge | `MEASUREMENT_CLASSIFICATIONS`, context for AI |

### Data Layer

| Module | Purpose | Dependencies |
|--------|---------|--------------|
| `influx/client.js` | InfluxDB connection setup | config |
| `influx/writer.js` | MQTT topic to InfluxDB point | influx/client |

**Topic Parsing Logic:**
```
Input:  "Enterprise A/Dallas Line 1/packaging/box01/motor/temperature/actual"
Output: Measurement: "temperature_actual"
        Tags: { enterprise: "Enterprise A", site: "Dallas Line 1",
                area: "packaging", machine: "box01" }
        Field: value (float)
```

### Business Logic Layer

| Module | Purpose | Dependencies |
|--------|---------|--------------|
| `schema/index.js` | Dynamic schema discovery | influx/client, state, config, validation, domain-context |
| `oee/index.js` | Tier-based OEE calculation | influx/client, state, schema, config, validation |
| `ai/index.js` | Claude AI integration | influx/client, state, config, domain-context |

**OEE Tier Strategy:**
```
Tier 1: Direct OEE metric available
Tier 2: Availability + Performance + Quality components
Tier 3: Availability + Performance only
Tier 4: Availability only (degraded)
```

### Integration Layer

| Module | Purpose | Dependencies |
|--------|---------|--------------|
| `cmms-interface.js` | Generic CMMS abstraction | None |
| `cmms-maintainx.js` | MaintainX implementation | cmms-interface |

## State Objects

```mermaid
classDiagram
    class factoryState {
        +Map enterprises
        +Map sites
        +Object currentMetrics
        +Array recentAnomalies
    }

    class schemaCache {
        +Map measurements
        +Object hierarchy
        +Date lastRefresh
        +Number ttlMs
    }

    class equipmentStateCache {
        +Map equipmentStates
        +Date lastUpdate
    }
```

## API Routes to Module Mapping

| Endpoint | Module | Function |
|----------|--------|----------|
| `GET /api/schema/measurements` | schema/index.js | `refreshSchemaCache()` |
| `GET /api/schema/hierarchy` | schema/index.js | `refreshHierarchyCache()` |
| `GET /api/trends` | ai/index.js | Direct InfluxDB query |
| `GET /api/oee/v2` | oee/index.js | `calculateOEE()` |
| `GET /api/oee/discovery` | oee/index.js | `discoverOEESchema()` |
| `GET /api/factory/status` | oee/index.js | `getFactoryStatus()` |
| `POST /api/agent/ask` | server.js | AgentCore proxy (invokes Bedrock Agent) |

## AgentCore Component Details

### Orchestrator Agent

The orchestrator operates in **Supervisor Mode**, routing user questions to the appropriate specialist:

```
User: "Why is OEE dropping in Enterprise A?"
  |
  v
Orchestrator: Analyzes question, identifies OEE + Enterprise A
  |
  v
Routes to: OEE Analyst Agent
  |
  v
OEE Analyst: Calls get_oee_breakdown tool, analyzes data
  |
  v
Response: Returns through orchestrator to user
```

**Routing Logic:**
- OEE questions for Enterprise A/B -> OEE Analyst
- Equipment state/fault questions -> Equipment Health Agent
- Quality/defect questions -> Waste Analyst Agent
- Enterprise C (pharma) questions -> Batch Process Agent (NOT OEE)

### Specialist Agents

| Agent | Responsibilities | Tools Used |
|-------|------------------|------------|
| **OEE Analyst** | Analyze OEE trends, breakdowns, comparisons | `get_oee_breakdown`, `query_influxdb` |
| **Equipment Health** | Equipment states, fault patterns, maintenance | `get_equipment_states`, `query_influxdb` |
| **Waste Analyst** | Defect analysis, quality trends, waste attribution | `get_waste_by_line`, `query_influxdb` |
| **Batch Process** | ISA-88 batch metrics, yield, cycle time | `get_batch_health`, `query_influxdb` |

### Lambda Action Groups

Single Lambda function routes tool calls to backend API:

```python
# Tool routing logic (simplified)
def handler(event):
    tool_name = event['actionGroup']
    params = event['parameters']

    if tool_name == 'get_oee_breakdown':
        return call_backend('/api/oee/breakdown', params)
    elif tool_name == 'get_equipment_states':
        return call_backend('/api/equipment/states', params)
    elif tool_name == 'query_influxdb':
        return execute_flux_query(params['query'])
    # ... etc
```

**Available Tools:**

| Tool | Description | Backend Endpoint |
|------|-------------|------------------|
| `get_oee_breakdown` | 24h OEE by enterprise | `GET /api/oee/breakdown` |
| `get_equipment_states` | Current equipment states | `GET /api/equipment/states` |
| `get_waste_by_line` | Defect counts by production line | `GET /api/waste/by-line` |
| `get_batch_health` | Batch process metrics (Enterprise C) | `GET /api/batch/health` |
| `query_influxdb` | Direct Flux query for custom analysis | Direct InfluxDB |

### CDK Infrastructure

AgentCore is deployed via CDK:

| File | Purpose |
|------|---------|
| `infra/stacks/agentcore_stack.py` | CDK stack defining all agents |
| `infra/agent_instructions/*.txt` | Agent prompt instructions |
| `infra/schemas/tools.yaml` | OpenAPI schema for Lambda tools |
