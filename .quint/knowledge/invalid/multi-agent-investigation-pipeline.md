---
scope: Major architectural change to lib/ai/, new agent orchestration logic, MCP tools for data access, increased API costs (multiple Claude calls per cycle)
kind: system
content_hash: 645c7530df4d0b5adb5edcacc1f845e2
---

# Hypothesis: Multi-Agent Investigation Pipeline

Replace single agentic loop with a multi-agent pipeline: (1) Detector Agent - identifies anomalies from trend data (current behavior), (2) Investigator Agent - given an anomaly, uses MCP tools to query InfluxDB/ChromaDB and build evidence, (3) Analyst Agent - synthesizes investigation findings into root cause hypothesis, (4) Reporter Agent - formats actionable insight for user. Each agent is specialized and can be tuned independently. Radical approach with highest complexity but most flexibility.

## Rationale
{"anomaly": "Single agent trying to do detection + investigation + reporting produces mediocre results", "approach": "Specialized agents for each phase of the analysis pipeline", "alternatives_rejected": ["Single mega-prompt (context limits)", "Human-in-the-loop investigation (defeats automation purpose)"]}