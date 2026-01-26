---
scope: New MCP server, ChromaDB schema design, anomaly persistence logic, modifications to agentic loop
kind: system
content_hash: 7ab0416f12a27daa99d2cfd64518ee9f
---

# Hypothesis: Hybrid MCP + Anomaly Memory System

Combine MCP query tools with a ChromaDB-backed anomaly memory system. (1) When anomalies are detected, store them in ChromaDB with full context (related metrics, equipment state, time patterns). (2) Provide MCP tools for: query_similar_anomalies (RAG search), query_equipment_timeline, query_correlated_events. (3) Agent can iteratively investigate using tools AND learn from past similar situations. This builds institutional memory - the agent gets smarter over time as it sees more anomalies and their resolutions.

## Rationale
{"anomaly": "Agent has no memory of past anomalies or their resolutions", "approach": "Build anomaly memory in ChromaDB + MCP tools for investigation + learning from history", "alternatives_rejected": ["Stateless investigation only (loses learning)", "Full data lake approach (overkill for this scale)"]}