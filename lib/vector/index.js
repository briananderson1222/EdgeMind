/**
 * @module lib/vector
 * @description Vector storage module for anomaly persistence using ChromaDB.
 * Provides semantic search over historical anomalies for RAG-based context enrichment.
 */

const { ChromaClient } = require('chromadb');
const { InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const CONFIG = require('../config');

// Runtime dependencies (set via init)
let chromaClient = null;
let collection = null;
let bedrockClientInstance = null;
let isInitialized = false;

/**
 * Initialize the vector storage module with runtime dependencies
 * @param {Object} deps - Dependencies object
 * @param {Object} deps.bedrockClient - AWS Bedrock client instance for embeddings
 */
async function init({ bedrockClient }) {
  if (isInitialized) {
    console.log('Vector store already initialized');
    return;
  }

  try {
    bedrockClientInstance = bedrockClient;

    // Initialize ChromaDB client - connects to ChromaDB server
    const chromaHost = process.env.CHROMA_HOST || 'localhost';
    const chromaPort = process.env.CHROMA_PORT || '8000';
    chromaClient = new ChromaClient({
      path: `http://${chromaHost}:${chromaPort}`
    });
    console.log(`Connecting to ChromaDB at ${chromaHost}:${chromaPort}`);

    // Get or create the anomalies collection
    collection = await chromaClient.getOrCreateCollection({
      name: 'edgemind_anomalies',
      metadata: {
        description: 'Factory anomaly history for RAG-based context enrichment',
        created: new Date().toISOString()
      }
    });

    isInitialized = true;
    console.log('Vector store initialized (ChromaDB embedded mode)');
  } catch (error) {
    console.error('Failed to initialize vector store:', error.message);
    // Don't throw - allow server to continue without vector store
    isInitialized = false;
  }
}

/**
 * Generate embedding for text using AWS Bedrock Titan Embeddings
 * @param {string} text - Text to embed
 * @returns {Promise<number[]>} Embedding vector
 */
async function generateEmbedding(text) {
  if (!bedrockClientInstance) {
    throw new Error('Bedrock client not initialized');
  }

  const payload = {
    inputText: text.substring(0, 8000), // Titan has 8k token limit
    dimensions: 512,
    normalize: true
  };

  const command = new InvokeModelCommand({
    modelId: CONFIG.bedrock.embeddingModelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(payload)
  });

  const response = await bedrockClientInstance.send(command);
  const result = JSON.parse(new TextDecoder().decode(response.body));
  return result.embedding;
}

/**
 * Store an anomaly with its embedding in ChromaDB
 * @param {Object} anomaly - Anomaly object from Claude analysis
 * @param {Object} insight - Parent insight object containing timestamp
 */
async function storeAnomaly(anomaly, insight) {
  if (!isInitialized || !collection) {
    console.warn('Vector store not initialized, skipping anomaly storage');
    return;
  }

  try {
    // Build text representation for embedding
    const text = [
      anomaly.description || '',
      anomaly.reasoning || '',
      anomaly.metric ? `Metric: ${anomaly.metric}` : '',
      anomaly.enterprise ? `Enterprise: ${anomaly.enterprise}` : ''
    ].filter(Boolean).join('. ');

    if (!text.trim()) {
      console.warn('Empty anomaly text, skipping storage');
      return;
    }

    const embedding = await generateEmbedding(text);
    const id = `anomaly_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    await collection.add({
      ids: [id],
      embeddings: [embedding],
      documents: [text],
      metadatas: [{
        enterprise: anomaly.enterprise || 'unknown',
        metric: anomaly.metric || 'unknown',
        severity: anomaly.severity || 'low',
        timestamp: insight.timestamp || new Date().toISOString(),
        actual_value: anomaly.actual_value || '',
        threshold: anomaly.threshold || '',
        description: anomaly.description || ''
      }]
    });

    console.log(`Stored anomaly: ${id} (${anomaly.severity})`);
  } catch (error) {
    console.error('Failed to store anomaly:', error.message);
    // Don't throw - allow analysis to continue
  }
}

/**
 * Find similar historical anomalies using semantic search
 * @param {string} queryText - Text to find similar anomalies for
 * @param {number} limit - Maximum number of results to return
 * @returns {Promise<Array>} Array of similar anomalies with metadata
 */
async function findSimilarAnomalies(queryText, limit = 5) {
  if (!isInitialized || !collection) {
    return [];
  }

  try {
    // Check if collection has any documents
    const count = await collection.count();
    if (count === 0) {
      return [];
    }

    const queryEmbedding = await generateEmbedding(queryText);

    const results = await collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: Math.min(limit, count)
    });

    // Transform results into a more usable format
    if (!results.ids || !results.ids[0] || results.ids[0].length === 0) {
      return [];
    }

    return results.ids[0].map((id, i) => ({
      id,
      document: results.documents[0][i],
      metadata: results.metadatas[0][i],
      distance: results.distances?.[0]?.[i] || 0
    }));
  } catch (error) {
    console.error('Failed to find similar anomalies:', error.message);
    return [];
  }
}

/**
 * Get the count of stored anomalies
 * @returns {Promise<number>} Number of anomalies in the collection
 */
async function getAnomalyCount() {
  if (!isInitialized || !collection) {
    return 0;
  }

  try {
    return await collection.count();
  } catch (error) {
    console.error('Failed to get anomaly count:', error.message);
    return 0;
  }
}

/**
 * Check if the vector store is initialized and ready
 * @returns {boolean} True if initialized
 */
function isReady() {
  return isInitialized;
}

module.exports = {
  init,
  generateEmbedding,
  storeAnomaly,
  findSimilarAnomalies,
  getAnomalyCount,
  isReady
};
