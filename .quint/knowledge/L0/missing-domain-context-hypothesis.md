---
scope: lib/domain-context.js, AI system prompt construction, measurement classifications
kind: system
content_hash: 83e5b7c168741d84660f739a656c6d21
---

# Hypothesis: Missing Domain Context Hypothesis

The AI prompt lacks sufficient domain context to make accurate judgments. Evidence: (1) Switches between "glass manufacturing" and "beverage bottling" thresholds arbitrarily, (2) Uses inconsistent critical thresholds (10 defects/hr vs 25 defects/hr vs 100x over limit), (3) Doesn't know this is a virtual/demo factory. The domain-context.js module may be incomplete or not used effectively.

## Rationale
{"anomaly": "AI applies inconsistent industry standards and thresholds across analyses", "approach": "Review domain-context.js content and how it's incorporated into AI prompts, enhance with explicit thresholds and factory type", "alternatives_rejected": ["Hardcode thresholds in prompt (not maintainable)", "Remove domain context entirely (loses value)"]}