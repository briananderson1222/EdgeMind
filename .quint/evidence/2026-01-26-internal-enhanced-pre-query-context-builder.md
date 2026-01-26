---
id: 2026-01-26-internal-enhanced-pre-query-context-builder.md
type: internal
target: enhanced-pre-query-context-builder
verdict: pass
assurance_level: L2
carrier_ref: test-runner
valid_until: 2026-04-26
date: 2026-01-26
content_hash: 0f59869094994adb222cf0eb52f42555
---

VALIDATED. Key findings: (1) Current queryTrends() only fetches 5-min rolling aggregates grouped by measurement - misses equipment-level detail. (2) Enterprise B has rich operational data NOT being passed to Claude: input_timedownunplanned (7,904 points), input_timedownplanned (11,183 points), input_timeidle (11,520 points), input_countdefect (2,880 points). (3) Equipment state cache exists (lib/state.js:105-113) with DOWN/IDLE/RUNNING states but is NOT included in Claude prompt - only used for work order creation AFTER analysis. (4) Hierarchy API shows Enterprise B has 14.5M data points across Site/Area/Machine structure. IMPLEMENTATION PATH: Extend queryTrends() to include related metrics when anomaly detected, inject equipment state into prompt context.