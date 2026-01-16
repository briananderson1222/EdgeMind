---
scope: EdgeMind full stack - backend loop + AgentCore integration + frontend UI
kind: system
content_hash: a32fb455d5c5dc3e28e77cb73f43a49d
---

# Hypothesis: Hybrid: Simple Loop + On-Demand Agents

Best of both worlds:

**Continuous Monitoring (Status Quo Enhanced)**:
- Keep 30-second Claude loop for real-time alerts
- Enrich with pre-computed OEE breakdown, equipment summary
- Fast, low-latency, always-on

**Deep Analysis (AgentCore On-Demand)**:
- User clicks "Investigate" or asks complex question
- Triggers AgentCore workflow with specialized agents
- Multi-step reasoning, tool use, cross-domain correlation
- Returns detailed report with recommendations

Frontend shows both: streaming insights + "Ask Deep Question" button.

## Rationale
{"anomaly": "Trade-off between latency (continuous) and depth (on-demand)", "approach": "Separate concerns - monitoring vs investigation", "alternatives_rejected": ["All continuous (too slow)", "All on-demand (misses real-time alerts)"]}