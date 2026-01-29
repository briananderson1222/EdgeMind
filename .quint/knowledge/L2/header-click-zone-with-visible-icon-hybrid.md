---
kind: system
scope: All .card elements - header bar becomes interactive zone
content_hash: c4986157309efc3512a5c33ab72579ce
---

# Hypothesis: Header Click Zone with Visible Icon (Hybrid)

Combine the best of both approaches: (1) Entire card header/title bar is clickable as expand trigger, (2) Visible expand icon in header provides clear affordance. 

User can click anywhere on header OR click the icon specifically - both trigger expand. Icon provides discoverability, header provides large touch target.

Implementation:
- Add .expand-icon to .card-title (always visible, subtle opacity)
- Click handler on entire .card-title element
- Cursor: pointer on header hover
- Icon brightens on hover (desktop enhancement)
- Works identically on touch (tap header or icon)

## Rationale
{"anomaly": "Need both discoverability AND large touch target", "approach": "Hybrid: visible icon for discoverability + full header clickable for easy touch targeting", "alternatives_rejected": ["Icon-only (small touch target)", "Header-only without icon (not discoverable)"]}