---
type: DRR
winner_id: rag-with-vector-database
created: 2026-01-14T16:56:17-05:00
content_hash: c4bcbc64d6b0e375ad7e4989d483f64e
---

# Use ChromaDB RAG for Anomaly Persistence

## Context
EdgeMind AI currently stores detected anomalies only in memory (factoryState.trendInsights). This means: (1) Anomaly history is lost on server restart, (2) No way to query historical patterns, (3) No semantic search for similar anomalies, (4) Limited context window for AI deduplication. Additionally, AWS AgentCore is imminent and we need a storage strategy that aligns with AgentCore Memory patterns for smooth migration.

## Decision
**Selected Option:** rag-with-vector-database

We decided to use ChromaDB as a vector database for anomaly persistence with RAG (Retrieval-Augmented Generation) capabilities. This enables semantic search over historical anomalies and provides the best migration path to AWS AgentCore Memory.

## Rationale
1. AGENTCORE ALIGNMENT: AgentCore Memory uses semantic retrieval patterns - building with vectors now means minimal refactoring when migrating. AgentCore Gateway supports MCP servers, and ChromaDB can be exposed as MCP. 2. EVIDENCE QUALITY: Only hypothesis validated with internal testing (CL3) - confirmed Node 22 compatibility, minimal dependencies (only semver). 3. EMBEDDING REUSE: AWS Bedrock titan-embed-text-v2 already available - no additional embedding API costs. 4. LICENSE: Apache 2.0 - fully open source, commercial use permitted. 5. SIMPLICITY: Pure JavaScript client, no native module compilation issues unlike SQLite.

### Characteristic Space (C.16)
Evidence: CL3 (internal validation), AgentCore Fit: Excellent, License: Apache 2.0, Dependencies: Minimal

## Consequences
IMPLEMENTATION REQUIRED: (1) Add chromadb dependency to package.json, (2) Create lib/vector/index.js for ChromaDB client, (3) Generate embeddings for anomalies using Bedrock titan-embed-text-v2, (4) Store anomaly text + embedding on detection, (5) Retrieve similar anomalies for AI context enrichment. TRADE-OFFS: Adds new dependency and operational component (ChromaDB server or embedded mode). FUTURE: When AgentCore Memory GA, migrate from ChromaDB to managed service with minimal code changes. REVISIT: When AgentCore Memory becomes generally available (expected 2026).
