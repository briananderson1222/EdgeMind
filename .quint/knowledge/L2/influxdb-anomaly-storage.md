---
scope: EdgeMind with existing InfluxDB, suitable for time-based anomaly queries
kind: system
content_hash: e145b53b7210d1840516bc0bd54514d8
---

# Hypothesis: InfluxDB Anomaly Storage

Store anomalies in existing InfluxDB instance as a new measurement.

Recipe:
1. Create 'anomalies' measurement in InfluxDB
2. Write each anomaly with tags: enterprise, severity, metric
3. Store description and reasoning as field values
4. Query by time range and tags

Pros: No new infrastructure, time-range queries work well
Cons: InfluxDB not ideal for document storage, no semantic search

## Rationale
{"anomaly": "Need anomaly persistence without new infrastructure", "approach": "Leverage existing InfluxDB for document-like storage", "alternatives_rejected": ["Adding new database - increases operational complexity"]}