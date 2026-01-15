---
scope: EdgeMind single-instance deployment, suitable for structured queries and reporting
kind: system
content_hash: e410e8c75ba69395498147a1531cf1a7
---

# Hypothesis: SQLite Local Database

Add SQLite for structured anomaly storage with full query capabilities.

Recipe:
1. Add better-sqlite3 dependency
2. Create anomalies table: id, timestamp, enterprise, metric, severity, description, reasoning, actual_value, threshold
3. Write anomalies on detection
4. Query by any field combination
5. Optional: Add FTS5 for full-text search

Pros: Structured queries, no external service, single file backup
Cons: New dependency, no semantic similarity search

## Rationale
{"anomaly": "Need structured anomaly queries beyond time-range", "approach": "Relational database for document storage with flexible querying", "alternatives_rejected": ["PostgreSQL - overkill for single instance", "MongoDB - new operational burden"]}