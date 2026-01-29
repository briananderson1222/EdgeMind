---
type: DRR
winner_id: header-click-zone-with-visible-icon-hybrid
created: 2026-01-29T12:03:04-05:00
content_hash: 105744ca7defdd31d6698a8f01cea42c
---

# Universal Card Maximize with Header Click Zone

## Context
User reported maximize button on AI Agent card doesn't render. User wants: (1) Any dashboard card to be maximizable, (2) Click anywhere intuitive, (3) Touch + Desktop support, (4) Maximum discoverability.

## Decision
**Selected Option:** header-click-zone-with-visible-icon-hybrid

Implement Header Click Zone with Visible Icon pattern. Fix existing CSS bug (card-title width), then replicate expand button to all 15 dashboard cards. Entire header becomes clickable with visible icon as affordance.

## Rationale
R_eff: 1.00. Pattern already exists in codebase (AI Agent card). Large touch target (full header vs small icon). Simple flex-based CSS. Lower implementation cost - fix bug + replicate vs build new system. Both Touch and Desktop constraints satisfied.

## Consequences
1. Add width:100% to .card-title CSS (fixes render bug). 2. Add expand button to all 15 card titles in index.html. 3. Create generic expandCard() function in app.js. 4. Create generic modal system for any card content. 5. Remove AI-Agent-specific modal code (replaced by generic). Trade-off: Header click area may conflict with future header buttons - mitigated by using event delegation.
