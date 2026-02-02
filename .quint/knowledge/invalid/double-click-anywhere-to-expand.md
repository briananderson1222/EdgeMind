---
scope: All .card elements
kind: system
content_hash: 683edf6a6d6e5ed7a776bb46840d99be
---

# Hypothesis: Double-Click Anywhere to Expand

Double-click anywhere on card (except interactive elements) triggers maximize. Single clicks work normally for buttons/filters. Provides large click target without conflicting with existing interactions.

Implementation: dblclick event on .card. Check if target is interactive element (button, input, select) and ignore if so. Otherwise trigger modal.

## Rationale
{"anomaly": "Want large click target without breaking existing interactions", "approach": "Double-click is power-user gesture - familiar from file managers, IDEs", "alternatives_rejected": ["Single click anywhere (would break all interactive elements inside cards)"]}