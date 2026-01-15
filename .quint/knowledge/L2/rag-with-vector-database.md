---
scope: EdgeMind with AI-powered anomaly analysis, suitable when semantic search and pattern matching are high priority
kind: system
content_hash: d49a697e0b7c8b2ecf8eda31e3411809
---

# Hypothesis: RAG with Vector Database

Implement Retrieval-Augmented Generation with vector embeddings for semantic anomaly search.

Recipe:
1. Add vector DB (ChromaDB local, or Pinecone/Weaviate cloud)
2. Generate embeddings for each anomaly using Claude/OpenAI embeddings API
3. Store anomaly text + embedding vector
4. On new analysis, retrieve semantically similar past anomalies
5. Include retrieved context in Claude prompt

Pros: Semantic similarity ("find anomalies like this"), rich AI context, pattern discovery
Cons: New infrastructure, embedding API costs, increased complexity

## Rationale
{"anomaly": "AI lacks historical context for pattern recognition", "approach": "Vector embeddings enable semantic retrieval of similar past anomalies", "alternatives_rejected": ["Keyword search - misses semantic similarity", "Manual tagging - doesn't scale"]}