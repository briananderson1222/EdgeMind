---
scope: .card-title CSS rule - affects all 15 cards
kind: system
content_hash: d0d9ff2f68c6e80eec4ee68941b83fdb
---

# Hypothesis: Fix: Card Title Width for Expand Button

Root cause identified: .card-title lacks explicit width. In flex column containers (like .ai-agent), children shrink-wrap to content. The button exists but margin-left:auto has no effect without available space.

Fix: Add width:100% to .card-title CSS rule (line 275 in styles.css).

This will:
1. Make title span full card width
2. Allow margin-left:auto to push button to right edge
3. Fix rendering for AI Agent card
4. Enable same pattern for all other cards

## Rationale
{"anomaly": "Maximize button doesn't render despite correct HTML and CSS", "approach": "Root cause analysis: flex child width shrink-wrap behavior. Fix with explicit width:100%", "alternatives_rejected": ["justify-content:space-between (changes gap behavior)", "position:absolute on button (breaks flow)"]}