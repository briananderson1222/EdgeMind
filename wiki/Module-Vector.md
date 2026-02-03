# Module: Vector Store

Vector storage module for anomaly persistence using ChromaDB, providing semantic search over historical anomalies for RAG-based context enrichment.

## Overview

| Property | Value |
|----------|-------|
| **File** | `lib/vector/index.js` |
| **Purpose** | Store and retrieve anomalies using vector embeddings |
| **Dependencies** | `chromadb`, `@aws-sdk/client-bedrock-runtime` |
| **Runtime Dependencies** | Bedrock client (for embeddings) |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     AI Analysis Loop                         │
├─────────────────────────────────────────────────────────────┤
│  1. Query similar anomalies  ──►  findSimilarAnomalies()    │
│  2. Include in Claude prompt (historical context)            │
│  3. Claude analyzes current trends                           │
│  4. Store new anomalies      ──►  storeAnomaly()            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Vector Store Module                       │
├─────────────────────────────────────────────────────────────┤
│  generateEmbedding()  ──►  AWS Bedrock Titan Embed          │
│  storeAnomaly()       ──►  ChromaDB Collection              │
│  findSimilarAnomalies() ◄──  ChromaDB Semantic Search       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    ChromaDB Server                           │
│              (Docker: chromadb/chroma:latest)                │
└─────────────────────────────────────────────────────────────┘
```

## Exports

### `init({ bedrockClient })`

Initialize the vector storage module with runtime dependencies.

```javascript
const vectorStore = require('./lib/vector');

await vectorStore.init({ bedrockClient });
```

**Parameters:**
- `bedrockClient` - AWS Bedrock client instance for generating embeddings

**Behavior:**
- Connects to ChromaDB server (configurable via `CHROMA_HOST` env var)
- Creates or gets the `edgemind_anomalies` collection
- Logs initialization status

### `generateEmbedding(text)`

Generate embedding vector for text using AWS Bedrock Titan Embeddings.

```javascript
const embedding = await vectorStore.generateEmbedding("High temperature detected in Enterprise A");
// Returns: number[] (512 dimensions)
```

**Parameters:**
- `text` - Text to embed (truncated to 8000 chars for Titan limit)

**Returns:** `Promise<number[]>` - 512-dimensional embedding vector

### `storeAnomaly(anomaly, insight)`

Store an anomaly with its embedding in ChromaDB.

```javascript
await vectorStore.storeAnomaly(
  {
    description: "OEE dropped below 70%",
    reasoning: "Equipment downtime increased",
    metric: "oee",
    enterprise: "Enterprise B",
    severity: "high",
    actual_value: "68.5%",
    threshold: "70%"
  },
  {
    timestamp: "2026-01-15T18:30:00Z"
  }
);
```

**Parameters:**
- `anomaly` - Anomaly object from Claude analysis
- `insight` - Parent insight object containing timestamp

**Stored Metadata:**
- `enterprise` - Which enterprise the anomaly occurred in
- `metric` - The metric that triggered the anomaly
- `severity` - low, medium, or high
- `timestamp` - When the anomaly was detected
- `actual_value` - The value that triggered the anomaly
- `threshold` - The threshold that was exceeded

### `findSimilarAnomalies(queryText, limit)`

Find similar historical anomalies using semantic search.

```javascript
const similar = await vectorStore.findSimilarAnomalies(
  "Temperature spike in packaging line",
  5  // Return top 5 matches
);

// Returns:
[
  {
    id: "anomaly_1234567890_abc123",
    document: "High temperature detected in packaging area...",
    metadata: {
      enterprise: "Enterprise A",
      metric: "temperature",
      severity: "medium",
      timestamp: "2026-01-14T10:30:00Z"
    },
    distance: 0.15  // Lower = more similar
  },
  // ...
]
```

**Parameters:**
- `queryText` - Text to find similar anomalies for
- `limit` - Maximum results (default: 5)

**Returns:** `Promise<Array>` - Similar anomalies with metadata and distance scores

### `getAnomalyCount()`

Get the count of stored anomalies.

```javascript
const count = await vectorStore.getAnomalyCount();
console.log(`${count} anomalies in vector store`);
```

### `isReady()`

Check if the vector store is initialized and ready.

```javascript
if (vectorStore.isReady()) {
  // Safe to query/store
}
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CHROMA_HOST` | `localhost` | ChromaDB server hostname |
| `CHROMA_PORT` | `8000` | ChromaDB server port |

### Bedrock Embedding Model

Configured in `lib/config.js`:

```javascript
bedrock: {
  embeddingModelId: process.env.BEDROCK_EMBEDDING_MODEL_ID || 'amazon.titan-embed-text-v2:0'
}
```

## Docker Deployment

### ChromaDB Container

```bash
# Start ChromaDB server
docker run -d \
  --name chromadb \
  --network edgemind-net \
  -p 8000:8000 \
  chromadb/chroma:latest
```

### Network Configuration

All containers must be on the same Docker network:

```bash
# Create shared network
docker network create edgemind-net

# Connect containers
docker network connect edgemind-net chromadb
docker network connect edgemind-net edgemind-backend
docker network connect edgemind-net influxdb
```

### Backend Container Environment

```bash
docker run -d \
  --name edgemind-backend \
  --network edgemind-net \
  -e CHROMA_HOST=chromadb \
  # ... other env vars
```

## RAG Integration

The vector store integrates with the AI module to provide historical context:

### In `lib/ai/index.js`

```javascript
// Before Claude analysis - query historical context
let historicalContextSection = '';
if (vectorStoreInstance && vectorStoreInstance.isReady()) {
  const similarAnomalies = await vectorStoreInstance.findSimilarAnomalies(trendSummary, 3);
  if (similarAnomalies.length > 0) {
    historicalContextSection = `\n## Historical Context (Similar Past Anomalies)\n`;
    similarAnomalies.forEach(a => {
      historicalContextSection += `- ${a.metadata.timestamp}: ${a.document}\n`;
    });
  }
}

// After Claude analysis - store new anomalies
if (insight.anomalies?.length > 0) {
  for (const anomaly of insight.anomalies) {
    await vectorStoreInstance.storeAnomaly(anomaly, insight);
  }
}
```

## Error Handling

The module is designed to fail gracefully:

- **Initialization failure**: Server continues without RAG (logs warning)
- **Query failure**: Returns empty array (logs warning)
- **Store failure**: Continues without storing (logs warning)

```javascript
// Safe initialization
try {
  await vectorStore.init({ bedrockClient });
} catch (vectorError) {
  console.warn('Vector store initialization failed (continuing without RAG):', vectorError.message);
}
```

## Future: AWS AgentCore Migration

The vector store architecture is designed for easy migration to AWS AgentCore Memory:

| Current | AgentCore Equivalent |
|---------|---------------------|
| ChromaDB collection | AgentCore Memory Store |
| `storeAnomaly()` | AgentCore Memory API |
| `findSimilarAnomalies()` | AgentCore Retrieval |
| Bedrock Titan Embed | AgentCore Embeddings |

When AgentCore becomes available, the module interface remains the same - only the implementation changes.

## Related Documentation

- [[Module-AI]] - AI trend analysis that uses vector store
- [[Module-Config]] - Configuration including embedding model
- [[Fargate-Production]] - Production deployment with ChromaDB
- [[Docker-Deployment]] - Docker networking setup
