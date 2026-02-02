---
scope: All .card elements in dashboard grid
kind: system
content_hash: 230a9bcc5411bbe8d8a718f4e124a1e6
---

# Hypothesis: Hover-Reveal Expand Icon

Show a subtle expand icon (⛶ or ↗) in the top-right corner ONLY when user hovers over the card. Icon appears with fade-in animation. Clicking the icon maximizes the card. Rest of card remains fully interactive.

Implementation: CSS :hover on .card shows .expand-icon. JavaScript click handler on icon triggers modal. Event.stopPropagation() prevents bubbling.

## Rationale
{"anomaly": "Need discoverable but non-intrusive expand trigger", "approach": "Hover reveals intent-based UI - common pattern in Grafana, Notion, modern dashboards", "alternatives_rejected": ["Always visible icon (visual clutter with 12+ cards)"]}