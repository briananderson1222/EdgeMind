---
target: fix-card-title-width-for-expand-button
verdict: pass
assurance_level: L2
carrier_ref: test-runner
valid_until: 2026-04-29
date: 2026-01-29
id: 2026-01-29-internal-fix-card-title-width-for-expand-button.md
type: internal
content_hash: b5dfb985b2bd8d9c85e42f05522e1154
---

Code analysis confirms:
1. .ai-agent (line 474-478) has display:flex and flex-direction:column
2. .card-title (line 275-285) has display:flex, gap:10px, NO width property
3. .maximize-btn (line 2188-2198) has margin-left:auto which requires parent width
4. CSS spec confirms: flex children in column direction default to width:auto

Fix validation:
- Adding `width: 100%` to .card-title will make title span full card width
- margin-left:auto on button will then push it to right edge
- Existing gap:10px will provide spacing between title text and button
- No side effects: cards already constrained by grid column spans

Single-line fix at styles.css line 281 (after margin-bottom: 15px):
  width: 100%;