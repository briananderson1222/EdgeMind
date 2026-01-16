---
type: DRR
winner_id: aws-agentcore-multi-agent-architecture
created: 2026-01-16T14:03:47-05:00
content_hash: 185345cdd34c168a77bd6fdbcaa2ae9d
---

# AWS AgentCore Multi-Agent Architecture for EdgeMind Intelligence

## Context
EdgeMind dashboard needs to answer complex analytical questions: (1) What is impacting my OEE? (2) What is the status of my equipment? (3) Where is wastage coming from? (4) Why no OEE for Enterprise C? The existing 30-second Claude loop provides real-time insights but lacks multi-step reasoning, tool use, and domain specialization needed for these questions.

## Decision
**Selected Option:** aws-agentcore-multi-agent-architecture

Implement AWS Bedrock Agents with multi-agent collaboration. Deploy specialized agents: OEE Analyst, Equipment Health, Waste Attribution, and Batch Process (for Enterprise C ISA-88). Orchestrator agent routes questions to specialists. Triggered on-demand via /api/agent/ask endpoint.

## Rationale
User explicitly chose full AgentCore despite timeline risk, prioritizing capability over speed. Evidence confirms: (1) Multi-agent collaboration GA since March 2025, (2) CDK supports Agent constructs, (3) Lambda Action Groups well-documented, (4) Pricing is consumption-based (no per-invocation charge). R_eff: 1.00. Risk: MEDIUM-HIGH but user accepted.

### Characteristic Space (C.16)
Capability: HIGH, Risk: MEDIUM-HIGH, Effort: 4-5 days, Demo Fitness: MEDIUM

## Consequences
IMPLEMENTATION: 4-5 days minimum. INFRASTRUCTURE: New CDK stack (agentcore_stack.py), 4+ Lambda functions, IAM roles, S3 for OpenAPI schemas. INTEGRATION: New /api/agent/ask endpoint in server.js, frontend chat panel. RISK: Timeline pressure for ProveIt! Conference - must start immediately. FALLBACK: If blocked, can pivot to enhanced-single-agent-loop in 1-2 days.
