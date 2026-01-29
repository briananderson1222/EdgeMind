---
id: 2026-01-29-internal-header-click-zone-with-visible-icon-hybrid.md
type: internal
target: header-click-zone-with-visible-icon-hybrid
verdict: pass
assurance_level: L2
carrier_ref: test-runner
valid_until: 2026-04-29
date: 2026-01-29
content_hash: 25ad23daed86f15d451497f38c82754b
---

Codebase analysis:
1. EXISTING PATTERN: AI Agent card (line 100-103) ALREADY implements this pattern - button inside .card-title with margin-left:auto.
2. CSS READY: .card-title has display:flex (line 282), .maximize-btn has margin-left:auto (line 2196) - pattern already works.
3. WHY NOT RENDERING: User reports button doesn't render but code exists. Likely CSS specificity issue or the ⛶ character not displaying in their font.
4. SCALABILITY: Can easily add same button to all 14 other .card-title elements.
5. CLICK HANDLER: openAgentModal() exists (line 2240 app.js) - need to generalize for any card.
6. NO CONFLICTS: Header is separate from card content - no z-index/overlap issues.

Verdict: Pattern already exists and partially works. Just needs: (a) fix render bug, (b) replicate to all cards, (c) generalize modal system.