---
scope: index.html button attributes, app.js selectFactory() event handling
kind: system
content_hash: ae4d2dc2432c3fb08970d9f2a28b9973
---

# Hypothesis: Fix Event Target Detection Bug

Fix the active class assignment bug: 1) Replace event.target.closest('.factory-btn') with document.querySelector lookup using data attributes, 2) Add data-factory attribute to each button in HTML, 3) Use data-factory to reliably find and style the correct button regardless of click target. This ensures consistent visual feedback.

## Rationale
{"anomaly": "Active class may not apply correctly when clicking nested div elements inside buttons", "approach": "Use data attributes for reliable button targeting", "alternatives_rejected": ["Event delegation (more complex)", "CSS pointer-events:none on children (breaks accessibility)"]}