---
scope: lib/ai/index.js agentic loop, trend analysis prompts, insight broadcasting
kind: system
content_hash: efd64bb84eee3d9f4555ce5218506de2
---

# Hypothesis: AI Context Amnesia Hypothesis

The agentic loop lacks memory between iterations. Each 30-second cycle treats the data fresh without knowing it already flagged the same issues. The AI has no mechanism to: (1) suppress duplicate alerts, (2) remember what it already reported, (3) distinguish "still anomalous" from "newly anomalous".

## Rationale
{"anomaly": "Identical insights generated every 30 seconds without deduplication", "approach": "Review AI module to see if previous insights are passed as context, implement insight memory/deduplication", "alternatives_rejected": ["Increase interval (just hides the problem)", "Client-side dedup (doesn't fix root cause)"]}