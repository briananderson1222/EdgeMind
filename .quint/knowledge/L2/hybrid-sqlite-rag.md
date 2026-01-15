---
kind: system
scope: EdgeMind production deployment requiring both structured reporting and AI-powered pattern discovery
content_hash: 3315b4babed9cc13b8d086533b794a07
---

# Hypothesis: Hybrid SQLite + RAG

Combine SQLite for structured storage with vector embeddings for semantic search.

Recipe:
1. SQLite for primary anomaly storage (structured queries, reporting)
2. ChromaDB (local) for vector embeddings
3. On anomaly detection:
   - Write to SQLite (source of truth)
   - Generate embedding, store in ChromaDB
4. Query paths:
   - Structured: SQLite (time, severity, enterprise filters)
   - Semantic: ChromaDB (find similar anomalies)
5. Sync mechanism to rebuild vectors from SQLite if needed

Pros: Best of both worlds, SQLite as backup/source of truth
Cons: Two storage systems to maintain, highest complexity

## Rationale
{"anomaly": "Need both structured queries AND semantic search", "approach": "Dual storage: relational for structure, vector for semantics", "alternatives_rejected": ["Single system compromise - loses capabilities of one approach"]}