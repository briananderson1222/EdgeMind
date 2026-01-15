---
scope: lib/ai/index.js analyzeTreesWithClaude(), factoryState.trendInsights usage, prompt engineering
kind: system
content_hash: 65d262e3d686059fd8c1b09562087a27
---

# Hypothesis: AI Memory via Previous Insights Injection

Modify lib/ai/index.js to pass the last N insights (e.g., 3) to Claude as context. The prompt should include a section like "## Previous Analysis (Last 90 seconds)" with summary of what was already flagged. Claude should be instructed to: (1) Not repeat identical alerts, (2) Only flag NEW anomalies or WORSENING trends, (3) Acknowledge when issues persist but avoid redundant warnings. This leverages the existing factoryState.trendInsights array (line 380) which already stores recent insights but doesn't use them.

## Rationale
{"anomaly": "AI repeats identical alerts every 30 seconds due to no memory between cycles", "approach": "Inject previous insights into prompt context, instruct Claude to deduplicate", "alternatives_rejected": ["Client-side dedup (doesn't fix root cause)", "Increase interval (just hides problem)", "Hash-based dedup (loses nuance of 'still ongoing' vs 'new')"]}