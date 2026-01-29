---
id: 2026-01-29-audit_report-fix-card-title-width-for-expand-button.md
type: audit_report
target: fix-card-title-width-for-expand-button
verdict: pass
assurance_level: L2
carrier_ref: auditor
valid_until: 2026-04-29
date: 2026-01-29
content_hash: c7841aa108f43919e28c8e828f705b11
---

WLNK: 1.00 (depends on header-hybrid at R:1.00, CL:3). Bias Check: None - this is pure CSS debugging. Risk: Extremely low - single-line CSS fix, affects all cards uniformly. Root cause is well understood (flex child width behavior). No side effects expected. PREREQUISITE for header-hybrid approach.