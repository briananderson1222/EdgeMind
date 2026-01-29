# Module: CMMS

**Sources:**
- `lib/cmms-interface.js` - Generic CMMS interface
- `lib/cmms-maintainx.js` - MaintainX provider implementation

## Purpose

Provides a pluggable architecture for integrating with Computerized Maintenance Management Systems (CMMS). When Claude detects high-severity anomalies, the CMMS module automatically creates work orders for maintenance teams.

## Architecture

```
lib/cmms-interface.js          lib/cmms-maintainx.js
        |                              |
        v                              v
  CMmsProvider (abstract)  <--- MaintainXProvider
        |
        +-- createWorkOrder()
        +-- getWorkOrderStatus()
        +-- listRecentWorkOrders()
        +-- healthCheck()
        +-- isEnabled()
        +-- getProviderName()
```

## Key Exports

### cmms-interface.js

| Export | Type | Description |
|--------|------|-------------|
| `CMmsProvider` | Class | Abstract base class for CMMS integrations |
| `createCmmsProvider` | Function | Factory function for provider instances |

### cmms-maintainx.js

| Export | Type | Description |
|--------|------|-------------|
| `MaintainXProvider` | Class | MaintainX implementation |

## Class: CMmsProvider (Abstract)

Base class that all CMMS implementations must extend.

### Constructor

```javascript
class CMmsProvider {
  constructor(config) {
    if (this.constructor === CMmsProvider) {
      throw new Error('CMmsProvider is abstract and cannot be instantiated directly');
    }
    this.config = config || {};
    this.enabled = config.enabled ?? false;
  }
}
```

### Abstract Methods

These methods must be implemented by subclasses:

| Method | Description |
|--------|-------------|
| `createWorkOrder(anomaly, equipment)` | Create a maintenance work order |
| `getWorkOrderStatus(workOrderId)` | Get current status of a work order |
| `listRecentWorkOrders(limit)` | List recent work orders |
| `healthCheck()` | Test connectivity and authentication |

### Implemented Methods

| Method | Description |
|--------|-------------|
| `isEnabled()` | Returns true if provider is enabled |
| `getProviderName()` | Returns the class name |

## Function: createCmmsProvider

Factory function to create CMMS provider instances.

### Signature

```javascript
function createCmmsProvider(providerName: string, config: Object): CMmsProvider
```

### Supported Providers

| Provider Name | Class |
|---------------|-------|
| `maintainx` | MaintainXProvider |

### Usage Example

```javascript
const { createCmmsProvider } = require('./lib/cmms-interface');

const cmms = createCmmsProvider('maintainx', {
  enabled: true,
  apiKey: 'your-api-key',
  baseUrl: 'https://api.getmaintainx.com/v1'
});
```

## Class: MaintainXProvider

Production implementation for MaintainX.com CMMS.

### Configuration

```javascript
const config = {
  enabled: true,                    // Enable/disable integration
  apiKey: 'your-api-key',           // Or MAINTAINX_API_KEY env var
  baseUrl: 'https://api.getmaintainx.com/v1', // Or MAINTAINX_BASE_URL
  defaultPriority: 'MEDIUM',        // LOW, MEDIUM, HIGH, URGENT
  retryAttempts: 3,                 // API retry attempts
  retryDelayMs: 1000,               // Delay between retries (ms)
  defaultLocationId: 'loc-123',     // Or MAINTAINX_DEFAULT_LOCATION_ID
  defaultAssigneeId: 'user-456'     // Or MAINTAINX_DEFAULT_ASSIGNEE_ID
};
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `CMMS_ENABLED` | Set to 'true' to enable |
| `CMMS_PROVIDER` | Provider name (default: 'maintainx') |
| `MAINTAINX_API_KEY` | API authentication key |
| `MAINTAINX_BASE_URL` | API base URL |
| `MAINTAINX_DEFAULT_LOCATION_ID` | Default location for work orders |
| `MAINTAINX_DEFAULT_ASSIGNEE_ID` | Default assignee for work orders |

## Method: createWorkOrder

Creates a maintenance work order from anomaly data.

### Signature

```javascript
async createWorkOrder(anomaly: Object, equipment: Object): Promise<Object>
```

### Parameters

#### anomaly Object

| Property | Type | Description |
|----------|------|-------------|
| `summary` | string | Brief description of the issue |
| `severity` | string | 'low', 'medium', or 'high' |
| `anomalies` | string[] | List of specific concerns |
| `recommendations` | string[] | Suggested actions |
| `confidence` | number | Claude's confidence (0-1) |
| `timestamp` | string | ISO timestamp |
| `id` | string | Analysis ID |

#### equipment Object

| Property | Type | Description |
|----------|------|-------------|
| `enterprise` | string | Enterprise name |
| `site` | string | Site name |
| `machine` | string | Machine identifier |
| `area` | string | Area/line identifier |
| `stateName` | string | Current state (RUNNING/IDLE/DOWN) |

### Return Value

```javascript
{
  workOrderId: 'wo-12345',
  workOrderNumber: 'WO-2026-0001',
  status: 'OPEN',
  url: 'https://app.getmaintainx.com/work-orders/wo-12345',
  createdAt: '2026-01-14T18:30:00.000Z',
  provider: 'MaintainX'
}
```

### Usage Example

```javascript
const MaintainXProvider = require('./lib/cmms-maintainx');

const cmms = new MaintainXProvider({
  enabled: true,
  apiKey: process.env.MAINTAINX_API_KEY
});

const anomaly = {
  summary: 'Packaging line efficiency dropped below threshold',
  severity: 'high',
  anomalies: ['Speed decreased 15%', 'Reject rate increased'],
  recommendations: ['Inspect conveyor belt', 'Check sensor calibration'],
  confidence: 0.92,
  timestamp: new Date().toISOString(),
  id: 'trend_1705258200000'
};

const equipment = {
  enterprise: 'Enterprise A',
  site: 'Dallas Line 1',
  machine: 'wrapper01',
  area: 'packaging',
  stateName: 'IDLE'
};

const result = await cmms.createWorkOrder(anomaly, equipment);
console.log(`Created work order: ${result.workOrderNumber}`);
```

## Work Order Description Format

The provider generates a structured description:

```markdown
AI-Detected Anomaly - HIGH severity

## Summary
Packaging line efficiency dropped below threshold

## Equipment
- Enterprise: Enterprise A
- Site: Dallas Line 1
- Area/Line: packaging
- Machine: wrapper01
- Current State: IDLE

## Issues Detected
- Speed decreased 15%
- Reject rate increased

## Recommended Actions
- Inspect conveyor belt
- Check sensor calibration

## AI Analysis Details
- Confidence: 92.0%
- Detected At: 1/14/2026, 6:30:00 PM
- Analysis ID: trend_1705258200000

---
_This work order was automatically created by EdgeMind OPE Insights AI monitoring system._
```

## Severity to Priority Mapping

| Claude Severity | MaintainX Priority |
|-----------------|-------------------|
| low | LOW |
| medium | MEDIUM |
| high | URGENT |

## Method: getWorkOrderStatus

Retrieves the current status of a work order.

### Signature

```javascript
async getWorkOrderStatus(workOrderId: string): Promise<Object>
```

### Return Value

```javascript
{
  id: 'wo-12345',
  status: 'IN_PROGRESS',
  assignedTo: 'John Smith',
  updatedAt: '2026-01-14T19:00:00.000Z',
  completedAt: null
}
```

## Method: listRecentWorkOrders

Lists recent work orders created by the integration.

### Signature

```javascript
async listRecentWorkOrders(limit: number = 10): Promise<Array<Object>>
```

### Return Value

```javascript
[
  {
    id: 'wo-12345',
    number: 'WO-2026-0001',
    title: 'Enterprise A - Dallas Line 1 - wrapper01: ...',
    status: 'OPEN',
    priority: 'URGENT',
    createdAt: '2026-01-14T18:30:00.000Z',
    assignedTo: null
  }
]
```

## Method: healthCheck

Tests connectivity to the MaintainX API.

### Signature

```javascript
async healthCheck(): Promise<Object>
```

### Return Value

```javascript
// Success
{
  healthy: true,
  message: 'MaintainX connection OK',
  provider: 'MaintainX',
  baseUrl: 'https://api.getmaintainx.com/v1'
}

// Failure
{
  healthy: false,
  message: 'MaintainX connection failed: 401 Unauthorized',
  provider: 'MaintainX'
}
```

## Retry Logic

The provider implements exponential backoff for transient failures:

- **Retry Conditions:** 5xx errors, 429 (rate limiting), network errors
- **Max Attempts:** 3 (configurable)
- **Backoff:** `retryDelayMs * attemptNumber`

```javascript
// Attempt 1: immediate
// Attempt 2: wait 1000ms
// Attempt 3: wait 2000ms
```

## Integration with AI Module

The AI module calls the CMMS integration when it detects high-severity anomalies:

```javascript
// In lib/ai/index.js
if (cmmsProviderInstance && cmmsProviderInstance.isEnabled() &&
    insight.severity === 'high' && insight.anomalies?.length > 0) {
  processAnomaliesForWorkOrders(insight, trends);
}
```

## Complete Integration Flow

### Startup Sequence

```text
server.js startup
    │
    ├─► createCmmsProvider('maintainx', config)
    │       └─► MaintainXProvider instance created
    │
    ├─► initializeAIModule({ cmms: cmmsProvider, ... })
    │       └─► cmmsProviderInstance stored in AI module
    │
    └─► startAgenticLoop()
            └─► runTrendAnalysis() scheduled every 30 seconds
```

**Relevant code:** [server.js:49-56](../server.js#L49-L56)

### Runtime Flow

```text
runTrendAnalysis() [every 30 seconds]
    │
    ├─► queryTrends()
    │       └─► InfluxDB: 5-minute rolling window, 1-min aggregates
    │
    ├─► analyzeTreesWithClaude(trends)
    │       └─► Claude returns insight with severity rating
    │
    └─► IF all trigger conditions met:
            │
            ├─► processAnomaliesForWorkOrders(insight, trends)
            │       │
            │       ├─► extractAffectedEquipment(trends, insight)
            │       │
            │       └─► For each affected equipment:
            │               │
            │               ├─► cmmsProviderInstance.createWorkOrder(insight, equipment)
            │               │       └─► POST to MaintainX API
            │               │
            │               └─► broadcast('cmms_work_order_created', ...)
            │
            └─► Log: "Created X/Y work orders successfully"
```

**Relevant code:** [lib/ai/index.js:712-769](../lib/ai/index.js#L712-L769)

### Trigger Conditions

Work orders are created only when **ALL** conditions are true:

| Condition | Check | Location |
|-----------|-------|----------|
| Provider exists | `cmmsProviderInstance` is not null | AI module initialization |
| Provider enabled | `cmmsProviderInstance.isEnabled()` returns `true` | `CMMS_ENABLED=true` env var |
| High severity | `insight.severity === 'high'` | Claude's assessment |
| Anomalies present | `insight.anomalies?.length > 0` | Claude detected issues |

**Note:** Low and medium severity anomalies do NOT create work orders automatically.

### Work Order API Payload

The exact payload sent to MaintainX API (`POST /workorders`):

```javascript
{
  // Title: truncated to 200 chars
  title: "Enterprise A - Dallas Line 1 - Palletizer01: Temperature spike detected",

  // Structured markdown description (see format below)
  description: "AI-Detected Anomaly - HIGH severity\n\n## Summary\n...",

  // Mapped from severity: high→URGENT, medium→MEDIUM, low→LOW
  priority: "URGENT",

  // Initial status
  status: "OPEN",

  // Optional - only included if configured
  locationId: "loc-123",    // From MAINTAINX_DEFAULT_LOCATION_ID
  assigneeId: "user-456",   // From MAINTAINX_DEFAULT_ASSIGNEE_ID

  // Custom fields for filtering and tracking in MaintainX
  customFields: {
    source: "EdgeMind-AI",
    enterprise: "Enterprise A",
    site: "Dallas Line 1",
    machine: "Palletizer01",
    area: "packaging",
    severity: "high",
    confidence: 0.87,
    detectedAt: "2026-01-28T10:30:00.000Z"
  }
}
```

### Data Sources

| Work Order Field | Source |
|------------------|--------|
| `title` | Equipment context + `anomaly.summary` |
| `description` | Built from all anomaly and equipment fields |
| `priority` | Mapped from `anomaly.severity` |
| `customFields.enterprise` | Extracted from InfluxDB trend tags |
| `customFields.site` | Extracted from InfluxDB trend tags |
| `customFields.machine` | Extracted from InfluxDB trend tags |
| `customFields.confidence` | `anomaly.confidence` from Claude |
| `customFields.detectedAt` | `anomaly.timestamp` |

### Deduplication

The `extractAffectedEquipment()` function deduplicates by equipment to avoid creating multiple work orders for the same machine in a single analysis cycle.

## Adding New Providers

To add a new CMMS provider:

1. Create `lib/cmms-<provider>.js`
2. Extend `CMmsProvider`
3. Implement all abstract methods
4. Add to the factory in `cmms-interface.js`:

```javascript
const providers = {
  'maintainx': () => require('./cmms-maintainx'),
  'fiix': () => require('./cmms-fiix'),       // New provider
  'limble': () => require('./cmms-limble'),   // New provider
};
```

## WebSocket Events

When a work order is created, the AI module broadcasts:

```javascript
{
  type: 'cmms_work_order_created',
  data: {
    workOrder: {
      workOrderId: 'wo-12345',
      workOrderNumber: 'WO-2026-0001',
      status: 'OPEN',
      url: 'https://...'
    },
    equipment: {
      enterprise: 'Enterprise A',
      site: 'Dallas Line 1',
      machine: 'wrapper01'
    },
    anomaly: {
      summary: '...',
      severity: 'high',
      timestamp: '...'
    }
  }
}
```

## Related Modules

| Module | Relationship |
|--------|--------------|
| [Module-AI](Module-AI) | Triggers work order creation for high-severity anomalies |

## See Also

- [MaintainX API Documentation](https://developer.getmaintainx.com/)
- [CMMS Integration Guide](docs/CMMS_INTEGRATION.md)
