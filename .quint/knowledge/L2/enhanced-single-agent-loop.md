---
scope: EdgeMind backend, lib/ai/index.js, 30-second monitoring loop
kind: system
content_hash: 06f6502ca81db40444c99d372d9c3eeb
---

# Hypothesis: Enhanced Single-Agent Loop

Keep the existing 30-second Claude loop but enrich the prompt with pre-computed context:
- Query OEE components and identify limiting factor before calling Claude
- Include equipment state summary (DOWN/IDLE/RUNNING counts)
- Add waste attribution data (top contributors by line)
- For Enterprise C, include batch health metrics instead of OEE

Claude receives richer context but remains a single synchronous call. All analysis happens in one prompt/response cycle.

## Rationale
{"anomaly": "Single prompt lacks context for complex questions", "approach": "Pre-compute analysis, enrich prompt with structured data, let Claude synthesize", "alternatives_rejected": ["Raw data dump (too verbose)", "Multiple sequential Claude calls (high latency)"]}