---
type: DRR
winner_id: ai-memory-via-previous-insights-injection
created: 2026-01-14T15:55:19-05:00
content_hash: 820fdf6b46bc1e9932ea14d83533af9a
---

# Fix AI Alert Repetition via Memory Injection

## Context
EdgeMind AI generates identical anomaly alerts every 30 seconds because the agentic loop has no memory between cycles. User logs showed the same alerts (Enterprise A defects, Enterprise B availability) repeating endlessly, causing alert fatigue.

## Decision
**Selected Option:** ai-memory-via-previous-insights-injection

Implement ai-memory-via-previous-insights-injection: Modify lib/ai/index.js to inject the last 3 insights into Claude's prompt context, instructing it to not repeat identical alerts and only flag NEW anomalies or WORSENING trends.

## Rationale
R_eff: 1.00 with clean dependency chain. Pattern already proven in askClaudeWithContext() (line 461-462). Implementation requires ~10 lines of code change. Low risk, high impact. Root cause (ai-context-amnesia-hypothesis) definitively confirmed via code trace.

### Characteristic Space (C.16)
complexity:low, risk:low, impact:high

## Consequences
Alerts will no longer repeat every 30 seconds. AI will acknowledge persistent issues without redundant warnings. May need prompt tuning to get the right balance between 'still ongoing' vs 'resolved'. Implement first as Track 1.
