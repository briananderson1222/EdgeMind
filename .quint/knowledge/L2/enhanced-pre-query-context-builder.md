---
scope: Modifications to lib/ai/index.js agentic loop, new query functions in lib/influx/, may increase InfluxDB query load
kind: system
content_hash: 8e6f11d9aeedec43fd73a635db4df591
---

# Hypothesis: Enhanced Pre-Query Context Builder

Expand the existing agentic loop to perform multiple targeted InfluxDB queries BEFORE calling Claude, building a rich investigation context. When an anomaly is detected: (1) Query the specific equipment's full metric set for the past hour, (2) Query fault/alarm measurements in the same area, (3) Query the same metric across sibling equipment for comparison, (4) Query historical patterns for this equipment at same time-of-day/day-of-week. Bundle all this context into the Claude prompt. No MCP needed - just smarter pre-fetching.

## Rationale
{"anomaly": "Agent only sees 5-min rolling aggregates, not enough context for root cause analysis", "approach": "Pre-fetch investigation-relevant data server-side before AI call", "alternatives_rejected": ["Real-time streaming of all data (bandwidth/cost)", "Client-side investigation (security concerns)"]}