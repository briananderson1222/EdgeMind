# C4 Level 3: Component Diagram

This diagram shows the internal structure of the backend, focusing on the modular lib/ architecture.

## Component Overview

```mermaid
flowchart TB
    subgraph server[server.js - Entry Point]
        ROUTES[HTTP Routes]
        MQTT_SUB[MQTT Subscriber]
        WS_SERVER[WebSocket Server]
        LOOP[Agentic Loop Timer]
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
