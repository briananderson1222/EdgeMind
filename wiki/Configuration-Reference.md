# Configuration Reference

Complete reference for all EdgeMind environment variables. Configuration is loaded from environment variables with sensible defaults defined in `lib/config.js`.

## Configuration Architecture

```
Environment Variables (.env)
        |
        v
    lib/config.js
        |
        v
   CONFIG object
        |
        +-- mqtt.*
        +-- bedrock.*
        +-- influxdb.*
        +-- cmms.*
        +-- agentcore.*
        +-- disableInsights
        |
        v
   lib/vector/index.js (ChromaDB config loaded directly from env)
```

## InfluxDB Configuration

Time-series database for factory metrics storage.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `INFLUXDB_URL` | Yes | `http://localhost:8086` | InfluxDB server URL |
| `INFLUXDB_TOKEN` | Yes | (empty) | Authentication token |
| `INFLUXDB_ORG` | No | `proveit` | Organization name |
| `INFLUXDB_BUCKET` | No | `factory` | Bucket for factory data |

### InfluxDB Setup Values

For local development with Docker:
```bash
INFLUXDB_URL=http://localhost:8086
INFLUXDB_TOKEN=proveit-factory-token-2026
INFLUXDB_ORG=proveit
INFLUXDB_BUCKET=factory
```

For Docker Compose (internal network):
```bash
INFLUXDB_URL=http://influxdb:8086
```

## MQTT Broker Configuration

Connection to ProveIt! virtual factory broker.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MQTT_HOST` | No | `mqtt://virtualfactory.proveit.services:1883` | MQTT broker URL |
| `MQTT_USERNAME` | No | `proveitreadonly` | Authentication username |
| `MQTT_PASSWORD` | Yes | (empty) | Authentication password |

### MQTT Topics

The system subscribes to all topics (`#`) by default. This is configured in `lib/config.js`:

```javascript
mqtt: {
  topics: ['#']  // Subscribe to all factory topics
}
```

## AWS Bedrock Configuration

Claude AI integration for trend analysis. See [[Module-AI]] for implementation details.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AWS_REGION` | No | `us-east-1` | AWS region for Bedrock |
| `AWS_PROFILE` | No | `default` | AWS CLI profile to use |
| `BEDROCK_MODEL_ID` | No | `us.anthropic.claude-sonnet-4-20250514-v1:0` | Claude model identifier |
| `BEDROCK_EMBEDDING_MODEL_ID` | No | `amazon.titan-embed-text-v2:0` | Titan embedding model for vector search |

The embedding model is used by [[Module-Vector]] for generating semantic embeddings of anomalies.

### Alternative: Direct Anthropic API

If not using AWS Bedrock:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | No | (empty) | Direct Anthropic API key |

## ChromaDB Configuration

Vector database for anomaly persistence and semantic search. See [[Module-Vector]] for implementation details.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CHROMA_HOST` | No | `localhost` | ChromaDB server hostname |
| `CHROMA_PORT` | No | `8000` | ChromaDB server port |

### ChromaDB Setup

For local development with Docker:
```bash
CHROMA_HOST=localhost
CHROMA_PORT=8000
```

For Docker Compose (internal network):
```bash
CHROMA_HOST=chromadb
CHROMA_PORT=8000
```

ChromaDB stores anomaly embeddings in the `edgemind_anomalies` collection for RAG-based context enrichment during trend analysis.

## AgentCore Configuration

AWS Bedrock Agent integration for agentic AI workflows. See [[Module-AgentCore]] for implementation details.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AGENTCORE_AGENT_ID` | No | (empty) | Bedrock Agent ID (from CDK output) |
| `AGENTCORE_ALIAS_ID` | No | (empty) | Bedrock Agent Alias ID (from CDK output) |

### AgentCore Setup

These values come from your CDK deployment output:
```bash
AGENTCORE_AGENT_ID=ABCDEFGHIJ
AGENTCORE_ALIAS_ID=TSTALIASID
```

When both values are set, the system uses Bedrock Agents for orchestrated AI workflows. When not set, the system falls back to direct Claude API calls.

## Server Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | HTTP server port |
| `NODE_ENV` | No | `development` | Environment mode |
| `DISABLE_INSIGHTS` | No | `false` | Disable AI trend analysis |

### Disabling AI Insights

For testing without API costs:
```bash
DISABLE_INSIGHTS=true
```

When disabled, the server:
- Receives and stores MQTT data
- Responds to API queries
- Does NOT run Claude trend analysis
- Does NOT incur Bedrock API costs

## CMMS Integration

Computerized Maintenance Management System for work order creation. See [[Module-CMMS]] for implementation details.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CMMS_ENABLED` | No | `false` | Enable CMMS integration |
| `CMMS_PROVIDER` | No | `maintainx` | CMMS provider to use |

### MaintainX Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MAINTAINX_API_KEY` | When CMMS enabled | (empty) | MaintainX API key |
| `MAINTAINX_BASE_URL` | No | `https://api.getmaintainx.com/v1` | API base URL |
| `MAINTAINX_DEFAULT_LOCATION_ID` | No | (null) | Default location for work orders |
| `MAINTAINX_DEFAULT_ASSIGNEE_ID` | No | (null) | Default assignee for work orders |

## Example .env Files

### Local Development

```bash
# =============================================================================
# INFLUXDB CONFIGURATION
# =============================================================================
INFLUXDB_URL=http://localhost:8086
INFLUXDB_TOKEN=proveit-factory-token-2026
INFLUXDB_ORG=proveit
INFLUXDB_BUCKET=factory

# =============================================================================
# MQTT BROKER (ProveIt! Virtual Factory)
# =============================================================================
MQTT_HOST=mqtt://virtualfactory.proveit.services:1883
MQTT_USERNAME=proveitreadonly
MQTT_PASSWORD=your_password_here

# =============================================================================
# AI CONFIGURATION (AWS Bedrock)
# =============================================================================
AWS_REGION=us-east-1
AWS_PROFILE=default
BEDROCK_MODEL_ID=us.anthropic.claude-sonnet-4-20250514-v1:0
BEDROCK_EMBEDDING_MODEL_ID=amazon.titan-embed-text-v2:0

# =============================================================================
# CHROMADB (Vector Storage)
# =============================================================================
CHROMA_HOST=localhost
CHROMA_PORT=8000

# =============================================================================
# AGENTCORE (Bedrock Agents - Optional)
# =============================================================================
# AGENTCORE_AGENT_ID=your_agent_id
# AGENTCORE_ALIAS_ID=your_alias_id

# =============================================================================
# SERVER CONFIGURATION
# =============================================================================
PORT=3000
NODE_ENV=development

# =============================================================================
# CMMS INTEGRATION (Optional)
# =============================================================================
CMMS_ENABLED=false
CMMS_PROVIDER=maintainx
```

### Production Deployment

```bash
# InfluxDB (Docker internal network)
INFLUXDB_URL=http://influxdb:8086
INFLUXDB_TOKEN=secure-production-token
INFLUXDB_ORG=proveit
INFLUXDB_BUCKET=factory

# MQTT
MQTT_HOST=mqtt://virtualfactory.proveit.services:1883
MQTT_USERNAME=proveitreadonly
MQTT_PASSWORD=production_password

# AI
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=us.anthropic.claude-sonnet-4-20250514-v1:0
BEDROCK_EMBEDDING_MODEL_ID=amazon.titan-embed-text-v2:0

# ChromaDB (Docker internal network)
CHROMA_HOST=chromadb
CHROMA_PORT=8000

# AgentCore (if using Bedrock Agents)
AGENTCORE_AGENT_ID=ABCDEFGHIJ
AGENTCORE_ALIAS_ID=TSTALIASID

# Server
PORT=3000
NODE_ENV=production

# CMMS (enabled for production)
CMMS_ENABLED=true
CMMS_PROVIDER=maintainx
MAINTAINX_API_KEY=your_api_key
MAINTAINX_DEFAULT_LOCATION_ID=loc_12345
```

### Testing Without AI

```bash
# Minimal configuration for data collection testing
INFLUXDB_URL=http://localhost:8086
INFLUXDB_TOKEN=proveit-factory-token-2026
MQTT_PASSWORD=your_password

# Disable AI to avoid API costs
DISABLE_INSIGHTS=true
```

## Configuration Loading

Configuration is loaded at module initialization in `lib/config.js`:

```javascript
require('dotenv').config();

const CONFIG = {
  mqtt: {
    host: process.env.MQTT_HOST || 'mqtt://virtualfactory.proveit.services:1883',
    username: process.env.MQTT_USERNAME || 'proveitreadonly',
    password: process.env.MQTT_PASSWORD || '',
    topics: ['#']
  },
  bedrock: {
    region: process.env.AWS_REGION || 'us-east-1',
    modelId: process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-sonnet-4-20250514-v1:0',
    embeddingModelId: process.env.BEDROCK_EMBEDDING_MODEL_ID || 'amazon.titan-embed-text-v2:0'
  },
  agentcore: {
    agentId: process.env.AGENTCORE_AGENT_ID || '',
    agentAliasId: process.env.AGENTCORE_ALIAS_ID || ''
  },
  // ... other config sections
};

module.exports = CONFIG;
```

ChromaDB configuration is loaded directly in `lib/vector/index.js`:

```javascript
const chromaHost = process.env.CHROMA_HOST || 'localhost';
const chromaPort = process.env.CHROMA_PORT || '8000';
```

## Runtime Configuration Access

Other modules import configuration:

```javascript
const CONFIG = require('./config');

// Access configuration values
console.log(CONFIG.mqtt.host);
console.log(CONFIG.influxdb.bucket);
console.log(CONFIG.bedrock.embeddingModelId);
console.log(CONFIG.agentcore.agentId);
console.log(CONFIG.disableInsights);
```

## Validation

The system validates critical configuration at startup:

1. **InfluxDB Token** - Required for data storage
2. **MQTT Password** - Required for broker connection
3. **AWS Credentials** - Required if insights enabled (via AWS CLI profile)
4. **ChromaDB Connection** - Optional, gracefully degrades if unavailable
5. **AgentCore IDs** - Optional, falls back to direct API if not set

Missing required values will result in connection errors logged to console.

## Related Documentation

- [[Development-Setup]] - Initial environment setup
- [[Local-Development]] - Day-to-day workflow
- [[Docker-Deployment]] - Container configuration
- [[Module-Config]] - Config module internals
- [[Module-AI]] - AI trend analysis implementation
- [[Module-Vector]] - ChromaDB vector storage implementation
- [[Module-AgentCore]] - Bedrock Agent integration
