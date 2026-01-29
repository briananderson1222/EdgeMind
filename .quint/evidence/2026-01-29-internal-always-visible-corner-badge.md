---
assurance_level: L2
carrier_ref: test-runner
valid_until: 2026-04-29
date: 2026-01-29
id: 2026-01-29-internal-always-visible-corner-badge.md
type: internal
target: always-visible-corner-badge
verdict: pass
content_hash: a972cd9fc218d9c925b8b004672254dd
---

Codebase analysis:
1. STRUCTURE: 15 cards found with .card-title divs. Most are simple text, only AI Agent has a button already.
2. CSS: .card-title already uses display:flex - can accommodate icons easily.
3. CONFLICT: "Corner badge" would require positioning over card content - could interfere with charts, heatmaps, interactive elements.
4. IMPLEMENTATION COST: Need to add floating positioned element to ALL cards, handle z-index stacking, ensure no overlap with card content.
5. ISSUE FOUND: AI Agent already has .maximize-btn in header (line 102) but user reports it doesn't render - suggests CSS issue, not missing element.

Verdict: Approach works but "corner" positioning adds complexity. Header placement (already proven on AI Agent) is simpler.