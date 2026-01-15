---
scope: app.js addAnomalyFilter(), lib/ai/index.js filterRulesSection, WebSocket update_anomaly_filter message type
kind: system
content_hash: 086d05d940cd81ebe581e25c1dafafb5
---

# Hypothesis: Filter Infrastructure Exists But Insufficient

The "Add Filter" button (app.js:1430-1458) already provides a mechanism to inject rules into Claude's prompt (lib/ai/index.js:146-153). However, this infrastructure is insufficient for threshold management because: (1) Freeform text only - no structured threshold UI, (2) Not persisted - filters lost on page refresh, (3) Reactive - users add filters AFTER seeing bad alerts, (4) No baseline concept - can only suppress alerts, not define "acceptable". The fix should extend this existing infrastructure rather than build from scratch.

## Rationale
{"anomaly": "Filter mechanism exists but doesn't solve threshold calibration problem", "approach": "Extend existing filter infrastructure with structured threshold inputs and persistence", "alternatives_rejected": ["Build new system from scratch (wasteful)", "Remove filters entirely (loses existing value)"]}