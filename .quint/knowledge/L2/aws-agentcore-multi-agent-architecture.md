---
scope: New AWS AgentCore deployment, MCP integration, separate from monitoring loop
kind: system
content_hash: 6eb6e8a1a67c54461a85e4bdf6b6b84c
---

# Hypothesis: AWS AgentCore Multi-Agent Architecture

Deploy AWS AgentCore with specialized agents:
- OEE Analyst Agent: Understands OEE formula, identifies limiting factors, correlates with equipment
- Equipment Health Agent: Monitors states, tracks downtime, predicts maintenance
- Waste Attribution Agent: Analyzes defect patterns, identifies root causes
- Batch Process Agent: Handles Enterprise C ISA-88 metrics, phase tracking

Orchestrator agent routes questions to specialists. Agents can query each other. ChromaDB provides shared memory.

Triggered on-demand for complex questions rather than continuous loop.

## Rationale
{"anomaly": "Complex questions require multi-step reasoning across domains", "approach": "Specialized agents with orchestration", "alternatives_rejected": ["Single mega-agent (prompt too long)", "Hardcoded workflow (inflexible)"]}