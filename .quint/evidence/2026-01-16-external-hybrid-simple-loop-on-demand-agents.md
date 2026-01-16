---
target: hybrid-simple-loop-on-demand-agents
verdict: pass
assurance_level: L2
carrier_ref: test-runner
valid_until: 2026-04-16
date: 2026-01-16
id: 2026-01-16-external-hybrid-simple-loop-on-demand-agents.md
type: external
content_hash: 7164f4799bb410cd540a1257b287b2b5
---

FEASIBILITY CONFIRMED - BEST RISK/REWARD. Evidence: (1) Phase 1 (Enhanced Loop) can ship in 1-2 days with zero new infrastructure. (2) Phase 2 (AgentCore) adds deep analysis capability incrementally. (3) Separation of concerns validated: monitoring = low latency (simple loop), investigation = high depth (multi-agent). (4) Frontend can support both: existing WebSocket for streaming + new 'Investigate' button for on-demand. EFFORT: Phase 1: 1-2 days, Phase 2: 3-4 days = 5-6 days total but can ship Phase 1 for demo. RISK: Low for Phase 1, Medium for Phase 2. BENEFIT: Incremental delivery, demo-ready faster, full capability over time.