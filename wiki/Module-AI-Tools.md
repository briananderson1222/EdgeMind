# Module: AI Tools

**Source:** `lib/ai/tools.js`

## Purpose

Provides tool definitions and handlers for Claude's `tool_use` capability during investigative trend analysis. When Claude needs to drill deeper into factory data during analysis, it invokes these tools to query OEE breakdowns, equipment states, and downtime metrics.

## Key Exports

| Export | Type | Description |
|--------|------|-------------|
| `TOOL_DEFINITIONS` | Array | Tool schemas for Bedrock API |
| `executeTool` | Function | Routes tool calls to handlers |
| `handleGetOEEBreakdown` | Function | OEE component breakdown handler |
| `handleGetEquipmentStates` | Function | Equipment state handler |
| `handleGetDowntimeAnalysis` | Function | Downtime analysis handler |
| `validateEnterpriseInput` | Function | Enterprise whitelist validator |
| `VALID_ENTERPRISES` | Array | Allowed enterprise names |
| `QUERY_TIMEOUT_MS` | Number | Query timeout (8000ms) |

## Tool Definitions

The `TOOL_DEFINITIONS` array contains JSON schemas compatible with Bedrock's `tool_use` API.

### get_oee_breakdown

Retrieves OEE with Availability, Performance, and Quality components for root cause analysis.

```javascript
{
  name: 'get_oee_breakdown',
  description: 'Get detailed OEE breakdown (Availability, Performance, Quality components) for a specific enterprise. Use this when you need to understand WHY an OEE score is low - it shows which component (A, P, or Q) is the bottleneck.',
  input_schema: {
    type: 'object',
    properties: {
      enterprise: {
        type: 'string',
        description: 'Enterprise name: "Enterprise A", "Enterprise B", or "Enterprise C"',
        enum: ['Enterprise A', 'Enterprise B', 'Enterprise C']
      },
      site: {
        type: 'string',
        description: 'Optional site filter (e.g., "Dallas Line 1", "Site3"). Leave empty to aggregate all sites.'
      }
    },
    required: ['enterprise']
  }
}
```

**Response Structure:**

```javascript
{
  success: true,
  data: {
    enterprise: 'Enterprise A',
    site: null,
    oee: 78.5,
    components: {
      availability: 92.5,
      performance: 88.2,
      quality: 96.1
    },
    calculation: {
      tier: 2,
      tierName: 'pre-computed-components',
      method: 'Calculating from A x P x Q components'
    },
    quality: { confidence: 0.90, status: 'good' },
    timestamp: '2026-01-26T10:30:00.000Z'
  }
}
```

### get_equipment_states

Retrieves current equipment states from the real-time cache.

```javascript
{
  name: 'get_equipment_states',
  description: 'Get current equipment states (DOWN, IDLE, RUNNING) for all equipment in an enterprise. Use this to identify which specific machines are DOWN or IDLE and contributing to availability problems.',
  input_schema: {
    type: 'object',
    properties: {
      enterprise: {
        type: 'string',
        description: 'Enterprise name: "Enterprise A", "Enterprise B", or "Enterprise C"',
        enum: ['Enterprise A', 'Enterprise B', 'Enterprise C']
      }
    },
    required: ['enterprise']
  }
}
```

**Response Structure:**

```javascript
{
  success: true,
  data: {
    enterprise: 'Enterprise A',
    summary: {
      DOWN: 2,
      IDLE: 3,
      RUNNING: 12,
      total: 17
    },
    equipment: [
      {
        machine: 'palletizer01',
        site: 'Dallas Line 1',
        area: 'packaging',
        state: 'DOWN',
        stateCode: 0,
        timestamp: 1706266200000,
        age_seconds: 45,
        is_fresh: true
      }
      // Sorted by priority: DOWN > IDLE > RUNNING
    ],
    cache_ttl_seconds: 300
  }
}
```

### get_downtime_analysis

Queries InfluxDB for downtime and quality metrics over 24 hours.

```javascript
{
  name: 'get_downtime_analysis',
  description: 'Analyze downtime and quality metrics for an enterprise over the last 24 hours. Returns timedownunplanned, timeidle, and countdefect aggregated data to understand root causes of low availability or quality scores.',
  input_schema: {
    type: 'object',
    properties: {
      enterprise: {
        type: 'string',
        description: 'Enterprise name: "Enterprise A", "Enterprise B", or "Enterprise C"',
        enum: ['Enterprise A', 'Enterprise B', 'Enterprise C']
      }
    },
    required: ['enterprise']
  }
}
```

**Response Structure:**

```javascript
{
  success: true,
  data: {
    enterprise: 'Enterprise A',
    period: '24h',
    summary: {
      timedownunplanned_seconds: 3600,
      timedownunplanned_hours: 1.0,
      timeidle_seconds: 7200,
      timeidle_hours: 2.0,
      countdefect_total: 145
    },
    details: [
      {
        measurement: 'timedownunplanned_metric',
        site: 'Dallas Line 1',
        area: 'packaging',
        total: 1800,
        unit: 'seconds'
      }
      // Limited to top 20 entries
    ]
  }
}
```

## Function: executeTool

Routes tool invocations to the appropriate handler.

### Signature

```javascript
async function executeTool(toolName: string, input: Object): Promise<Object>
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `toolName` | string | Name of the tool to execute |
| `input` | Object | Tool input parameters |

### Usage Example

```javascript
const { executeTool } = require('./lib/ai/tools');

const result = await executeTool('get_oee_breakdown', {
  enterprise: 'Enterprise A',
  site: 'Dallas Line 1'
});

if (result.success) {
  console.log('OEE:', result.data.oee);
} else {
  console.error('Error:', result.error);
}
```

### Return Format

All tool handlers return a consistent structure:

```javascript
// Success
{
  success: true,
  data: { /* tool-specific data */ }
}

// Error
{
  success: false,
  error: 'Error message',
  data: null
}
```

## Security Measures

### Enterprise Validation

All tools validate the `enterprise` parameter against a whitelist to prevent unauthorized data access and injection attacks.

```javascript
const VALID_ENTERPRISES = ['Enterprise A', 'Enterprise B', 'Enterprise C'];

function validateEnterpriseInput(enterprise) {
  if (!enterprise || typeof enterprise !== 'string') {
    return { valid: false, error: 'Enterprise parameter is required and must be a string' };
  }
  if (!VALID_ENTERPRISES.includes(enterprise)) {
    return {
      valid: false,
      error: `Invalid enterprise: ${enterprise}. Must be one of: ${VALID_ENTERPRISES.join(', ')}`
    };
  }
  return { valid: true };
}
```

### Flux Injection Prevention

The `get_downtime_analysis` tool uses `sanitizeInfluxIdentifier()` from the [[Module-Validation]] to sanitize enterprise names before embedding in Flux queries.

```javascript
const safeEnterprise = sanitizeInfluxIdentifier(enterprise);

const fluxQuery = `
  from(bucket: "${CONFIG.influxdb.bucket}")
    |> range(start: -24h)
    |> filter(fn: (r) => r.enterprise == "${safeEnterprise}")
    ...
`;
```

### Query Timeout

InfluxDB queries are wrapped with a timeout to prevent long-running queries from consuming the 30-second analysis budget.

```javascript
const QUERY_TIMEOUT_MS = 8000; // 8 seconds

await Promise.race([
  queryPromise,
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error('InfluxDB query timeout')), QUERY_TIMEOUT_MS)
  )
]);
```

Timeout events are logged for monitoring:

```javascript
if (error.message.includes('timeout')) {
  console.warn(`InfluxDB query timeout (${QUERY_TIMEOUT_MS}ms) for enterprise: ${input.enterprise}`);
}
```

## Integration with AI Module

The [[Module-AI]] imports and uses these tools during investigative trend analysis.

### Tool Flow

```
Claude receives trend data
        |
        v
Claude decides to investigate
        |
        v
Claude returns tool_use response
        |
        v
AI module calls executeTool()
        |
        v
Tool handler queries data
        |
        v
Results returned to Claude
        |
        v
Claude synthesizes insights
```

### Example Integration

```javascript
// In lib/ai/index.js
const { TOOL_DEFINITIONS, executeTool } = require('./tools');

// Include tools in Bedrock request
const bedrockParams = {
  modelId: CONFIG.bedrock.modelId,
  body: JSON.stringify({
    messages: [...],
    tools: TOOL_DEFINITIONS,
    // ...
  })
};

// Handle tool_use responses
if (response.stop_reason === 'tool_use') {
  const toolBlock = response.content.find(c => c.type === 'tool_use');
  const toolResult = await executeTool(toolBlock.name, toolBlock.input);
  // Continue conversation with tool result
}
```

## Dependencies

| Module | Usage |
|--------|-------|
| [[Module-Influx-Client]] | `queryApi` for InfluxDB queries |
| [[Module-OEE]] | `calculateOEEv2` for OEE breakdown |
| [[Module-State]] | `equipmentStateCache` for equipment states |
| [[Module-Config]] | `CONFIG` for InfluxDB bucket name |
| [[Module-Validation]] | `sanitizeInfluxIdentifier` for Flux injection prevention |

## Error Handling

All handlers follow consistent error handling:

1. Validate input parameters
2. Return structured error on validation failure
3. Catch and log execution errors
4. Return error with `success: false`

```javascript
async function handleTool(input) {
  try {
    // Validate
    const validation = validateEnterpriseInput(input.enterprise);
    if (!validation.valid) {
      return { success: false, error: validation.error, data: null };
    }

    // Execute
    const result = await doWork(input);
    return { success: true, data: result };

  } catch (error) {
    console.error('Tool error (tool_name):', error.message);
    return { success: false, error: error.message, data: null };
  }
}
```

## See Also

- [[Module-AI]] - Parent module that uses these tools
- [[Module-OEE]] - OEE calculation logic
- [[Module-State]] - Equipment state cache
- [[Module-Validation]] - Input sanitization
