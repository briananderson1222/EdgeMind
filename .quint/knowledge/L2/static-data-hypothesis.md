---
scope: EdgeMind agentic loop, virtualfactory.proveit.services MQTT broker, trend analysis window
kind: system
content_hash: 5657b902888b3911c6527a5240407746
---

# Hypothesis: Static Data Hypothesis

The virtual factory MQTT broker is publishing static/constant values. This is normal behavior for a demo/simulation environment that doesn't model real-time variance. The AI is correctly detecting "no change" but incorrectly interpreting it as anomalous because it lacks context that this is a synthetic data source.

## Rationale
{"anomaly": "AI repeatedly flags 0% change as anomalous every 30 seconds", "approach": "Verify MQTT data variance by querying InfluxDB directly - if values are truly static, the virtual factory is the source", "alternatives_rejected": ["Assume AI is broken without checking data"]}