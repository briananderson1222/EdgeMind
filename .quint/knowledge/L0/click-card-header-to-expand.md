---
scope: All .card elements - title bar only
kind: system
content_hash: f23593d77e8924886228c942af60faa7
---

# Hypothesis: Click Card Header to Expand

Make the entire .card-title bar clickable to trigger maximize. Title bar acts as drag handle / expand trigger. Cursor changes to pointer on hover over title. Visual feedback on title hover (subtle highlight).

Implementation: Click handler on .card-title triggers modal. No conflicts since title bar has no interactive elements (except current broken button which would be removed).

## Rationale
{"anomaly": "Need clear click target that doesn't conflict with card content", "approach": "Title bar is natural affordance - users expect headers to be interactive (like window title bars)", "alternatives_rejected": ["Click anywhere on card (conflicts with buttons, inputs, filters inside cards)"]}