---
scope: Modifications to lib/ai/index.js prompt templates only, no infrastructure changes
kind: system
content_hash: f22236911cf8060d96ef851a1711dd03
---

# Hypothesis: Structured Investigation Prompt Engineering

Keep the existing data pipeline but dramatically improve the prompt engineering to force investigative thinking. (1) Add explicit investigation framework to system prompt (5 Whys, Fishbone categories), (2) Require agent to output structured investigation steps before conclusions, (3) Include domain knowledge about common factory failure modes (motor overheating → check load, vibration; low availability → check fault counts, changeover times), (4) Add few-shot examples of good vs bad insights. Conservative approach - no infrastructure changes, just better prompts.

## Rationale
{"anomaly": "Agent produces shallow insights despite having some data available", "approach": "Better prompting may extract more investigative behavior from existing data", "alternatives_rejected": ["Assuming prompt engineering alone is insufficient (may be wrong)"]}