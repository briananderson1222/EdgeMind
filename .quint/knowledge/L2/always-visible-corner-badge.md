---
scope: All .card elements
kind: system
content_hash: 6060704efca52d864e6d170de7d8f531
---

# Hypothesis: Always-Visible Corner Badge

Small, persistent expand icon in top-right corner of every card. Subtle styling (low opacity, small size) to minimize visual noise. Increases opacity on card hover for better visibility.

Implementation: Add .expand-badge to all cards via HTML or JS injection. Fixed position in corner. Click handler triggers modal per card type.

## Rationale
{"anomaly": "Maximize feature must be discoverable without hover", "approach": "Always visible = always discoverable. Works on touch devices where hover doesn't exist", "alternatives_rejected": ["Hover-only (fails on touch devices, not discoverable)"]}