# Module: AgentCore

**Source:** `lib/agentcore/index.js`

## Purpose

Provides a client for AWS Bedrock Agents (AgentCore) integration. Enables the EdgeMind backend to proxy user questions to an AWS orchestrator agent, handling session management and streaming responses.

## Key Exports

| Export | Type | Description |
|--------|------|-------------|
| `AgentCoreClient` | Class | Client for invoking AWS Bedrock Agents |
| `createAgentCoreClient` | Function | Factory to create client instance |

## AgentCoreClient Class

The main client class for interacting with AWS Bedrock Agents.

### Constructor

```javascript
const client = new AgentCoreClient({
  region: 'us-east-1',
  agentId: 'ABCDEFGHIJ',
  agentAliasId: 'TSTALIASID'
});
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `config.region` | string | Yes | AWS region for Bedrock Agent |
| `config.agentId` | string | Yes | Bedrock Agent ID (from CDK output) |
| `config.agentAliasId` | string | Yes | Bedrock Agent Alias ID (from CDK output) |

**Throws:** `Error` if `agentId` or `agentAliasId` is missing.

### Method: ask(question, sessionId)

Sends a question to the Bedrock Agent and returns the complete response.

```javascript
const result = await client.ask('What is the current OEE for Enterprise A?');
console.log(result.answer);     // Agent's response text
console.log(result.sessionId);  // Session ID for conversation continuity
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `question` | string | Yes | User question (max 1000 characters) |
| `sessionId` | string | No | Session ID for conversation continuity |

**Returns:**

```javascript
{
  answer: string,    // Complete agent response
  sessionId: string  // Session ID (provided or auto-generated)
}
```

**Validation:**
- Question must be a non-empty string
- Question must not exceed 1000 characters
- If no sessionId provided, a UUID is generated

### Method: healthCheck()

Verifies connectivity to the Bedrock Agent.

```javascript
const health = await client.healthCheck();
console.log(health.healthy);  // true or false
console.log(health.message);  // 'AgentCore is reachable' or error message
```

**Returns:**

```javascript
{
  healthy: boolean,
  message: string
}
```

## Factory Function: createAgentCoreClient

Creates an AgentCoreClient instance with graceful handling of missing configuration.

```javascript
const { createAgentCoreClient } = require('./lib/agentcore');

const client = createAgentCoreClient({
  region: 'us-east-1',
  agentId: process.env.AGENTCORE_AGENT_ID,
  agentAliasId: process.env.AGENTCORE_ALIAS_ID
});

if (client) {
  // AgentCore is available
  const response = await client.ask('Hello');
} else {
  // AgentCore not configured, handle gracefully
}
```

**Returns:** `AgentCoreClient` instance or `null` if not configured.

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `AGENTCORE_AGENT_ID` | Bedrock Agent ID from CDK deployment | Yes |
| `AGENTCORE_ALIAS_ID` | Bedrock Agent Alias ID from CDK deployment | Yes |

### Configuration in lib/config.js

```javascript
agentcore: {
  agentId: process.env.AGENTCORE_AGENT_ID || '',
  agentAliasId: process.env.AGENTCORE_ALIAS_ID || ''
}
```

## Streaming Response Handling

The Bedrock Agent API returns streaming responses. The client handles this transparently:

```
InvokeAgentCommand
        |
        v
  response.completion (async iterator)
        |
        v
  for await (event of completion)
        |
        v
  event.chunk.bytes -> TextDecoder -> concatenate
        |
        v
  Complete answer string
```

**Implementation:**

```javascript
let answer = '';
const completion = response.completion;

for await (const event of completion) {
  if (event.chunk && event.chunk.bytes) {
    const chunkText = new TextDecoder('utf-8').decode(event.chunk.bytes);
    answer += chunkText;
  }
}
```

## Error Handling

The client handles specific AWS Bedrock errors with meaningful messages.

### ResourceNotFoundException

Thrown when the agent ID or alias ID is invalid.

```javascript
try {
  await client.ask('Hello');
} catch (error) {
  // error.message: 'Agent not found. Check agentId and agentAliasId configuration.'
}
```

### ThrottlingException

Thrown when request rate limits are exceeded.

```javascript
try {
  await client.ask('Hello');
} catch (error) {
  // error.message: 'Agent request throttled. Please retry.'
}
```

### ValidationException

Thrown when the request is malformed.

```javascript
try {
  await client.ask('Hello');
} catch (error) {
  // error.message: 'Invalid request: <details>'
}
```

### Connection Errors

All other errors are wrapped with context.

```javascript
try {
  await client.ask('Hello');
} catch (error) {
  // error.message: 'Agent invocation failed: <original error>'
}
```

## Usage in server.js

### Initialization

```javascript
const { createAgentCoreClient } = require('./lib/agentcore');
const CONFIG = require('./lib/config');

let agentCoreClient = null;
if (CONFIG.agentcore.agentId && CONFIG.agentcore.agentAliasId) {
  try {
    agentCoreClient = createAgentCoreClient({
      region: CONFIG.bedrock.region,
      agentId: CONFIG.agentcore.agentId,
      agentAliasId: CONFIG.agentcore.agentAliasId
    });
  } catch (error) {
    console.error(`Failed to initialize AgentCore client: ${error.message}`);
  }
}
```

### REST Endpoint: POST /api/agent/ask

```javascript
app.post('/api/agent/ask', express.json(), async (req, res) => {
  if (!agentCoreClient) {
    return res.status(503).json({
      error: 'AgentCore is not configured',
      message: 'Set AGENTCORE_AGENT_ID and AGENTCORE_ALIAS_ID environment variables'
    });
  }

  const { question, sessionId } = req.body;
  const result = await agentCoreClient.ask(question, sessionId);

  res.json({
    answer: result.answer,
    sessionId: result.sessionId
  });
});
```

### REST Endpoint: GET /api/agent/health

```javascript
app.get('/api/agent/health', async (req, res) => {
  if (!agentCoreClient) {
    return res.json({
      enabled: false,
      healthy: false,
      message: 'AgentCore not configured'
    });
  }

  const health = await agentCoreClient.healthCheck();
  res.json({
    enabled: true,
    healthy: health.healthy,
    message: health.message
  });
});
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `@aws-sdk/client-bedrock-agent-runtime` | AWS Bedrock Agent API client |
| `crypto` | UUID generation for session IDs |

## Related Modules

| Module | Relationship |
|--------|--------------|
| [[Module-Config]] | Provides `agentcore` configuration settings |
| [[Module-AI]] | Alternative AI integration using direct Bedrock calls |

## See Also

- [[REST-Endpoints]] - API endpoint documentation
- [[Module-AI]] - Claude AI integration for trend analysis
- [[Configuration-Reference]] - Environment variable reference
