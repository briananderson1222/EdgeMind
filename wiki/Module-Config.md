# Module: Config

**Source:** `lib/config.js`

Centralized configuration module that loads all application settings from environment variables with sensible defaults.

## Purpose

Provides a single source of truth for configuration across the EdgeMind application. All modules import configuration from here rather than reading environment variables directly.

## Key Exports

| Name | Type | Description |
|------|------|-------------|
| `CONFIG` | `Object` | Main configuration object (default export) |
| `CONFIG.mqtt` | `Object` | MQTT broker connection settings |
| `CONFIG.bedrock` | `Object` | AWS Bedrock (Claude AI) settings |
| `CONFIG.influxdb` | `Object` | InfluxDB time-series database settings |
| `CONFIG.disableInsights` | `boolean` | Flag to disable Claude trend analysis loop |
| `CONFIG.cmms` | `Object` | CMMS integration settings |

## Configuration Sections

### MQTT Configuration

| Property | Environment Variable | Default | Description |
|----------|---------------------|---------|-------------|
| `mqtt.host` | `MQTT_HOST` | `mqtt://virtualfactory.proveit.services:1883` | MQTT broker URL |
| `mqtt.username` | `MQTT_USERNAME` | `proveitreadonly` | Authentication username |
| `mqtt.password` | `MQTT_PASSWORD` | `''` | Authentication password |
| `mqtt.topics` | - | `['#']` | Topics to subscribe (wildcard) |

### AWS Bedrock Configuration

| Property | Environment Variable | Default | Description |
|----------|---------------------|---------|-------------|
| `bedrock.region` | `AWS_REGION` | `us-east-1` | AWS region for Bedrock |
| `bedrock.modelId` | `BEDROCK_MODEL_ID` | `us.anthropic.claude-sonnet-4-20250514-v1:0` | Claude model ID |
| `bedrock.embeddingModelId` | `BEDROCK_EMBEDDING_MODEL_ID` | `amazon.titan-embed-text-v2:0` | Titan embedding model for vector store |

### InfluxDB Configuration

| Property | Environment Variable | Default | Description |
|----------|---------------------|---------|-------------|
| `influxdb.url` | `INFLUXDB_URL` | `http://localhost:8086` | InfluxDB server URL |
| `influxdb.token` | `INFLUXDB_TOKEN` | `''` | Authentication token |
| `influxdb.org` | `INFLUXDB_ORG` | `proveit` | Organization name |
| `influxdb.bucket` | `INFLUXDB_BUCKET` | `factory` | Bucket for factory data |

### CMMS Configuration

| Property | Environment Variable | Default | Description |
|----------|---------------------|---------|-------------|
| `cmms.enabled` | `CMMS_ENABLED` | `false` | Enable CMMS integration |
| `cmms.provider` | `CMMS_PROVIDER` | `maintainx` | CMMS provider name |
| `cmms.maintainx.apiKey` | `MAINTAINX_API_KEY` | `''` | MaintainX API key |
| `cmms.maintainx.baseUrl` | `MAINTAINX_BASE_URL` | `https://api.getmaintainx.com/v1` | API base URL |
| `cmms.maintainx.defaultLocationId` | `MAINTAINX_DEFAULT_LOCATION_ID` | `null` | Default location for work orders |
| `cmms.maintainx.defaultAssigneeId` | `MAINTAINX_DEFAULT_ASSIGNEE_ID` | `null` | Default assignee for work orders |

### Feature Flags

| Property | Environment Variable | Default | Description |
|----------|---------------------|---------|-------------|
| `disableInsights` | `DISABLE_INSIGHTS` | `false` | Disable Claude trend analysis |

## Usage Example

```javascript
const CONFIG = require('./lib/config');

// Access MQTT settings
const mqttClient = mqtt.connect(CONFIG.mqtt.host, {
  username: CONFIG.mqtt.username,
  password: CONFIG.mqtt.password
});

// Check if insights are enabled
if (!CONFIG.disableInsights) {
  startTrendAnalysisLoop();
}

// Access InfluxDB settings
const influxClient = new InfluxDB({
  url: CONFIG.influxdb.url,
  token: CONFIG.influxdb.token
});
```

## Environment File Example

Create a `.env` file in the project root:

```bash
# MQTT
MQTT_HOST=mqtt://virtualfactory.proveit.services:1883
MQTT_USERNAME=proveitreadonly
MQTT_PASSWORD=

# AWS Bedrock
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=us.anthropic.claude-sonnet-4-20250514-v1:0

# InfluxDB
INFLUXDB_URL=http://localhost:8086
INFLUXDB_TOKEN=proveit-factory-token-2026
INFLUXDB_ORG=proveit
INFLUXDB_BUCKET=factory

# Feature Flags
DISABLE_INSIGHTS=false

# CMMS (optional)
CMMS_ENABLED=false
CMMS_PROVIDER=maintainx
MAINTAINX_API_KEY=
```

## Related Modules

- [[Module-State]] - Uses config for cache TTL values
- [[Module-Validation]] - Validates config-related inputs
- `lib/influx/client.js` - Uses InfluxDB config
- `lib/ai/index.js` - Uses Bedrock config
