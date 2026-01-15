---
carrier_ref: test-runner
valid_until: 2026-04-14
date: 2026-01-14
id: 2026-01-14-internal-static-data-hypothesis.md
type: internal
target: static-data-hypothesis
verdict: pass
assurance_level: L2
content_hash: 3cbb4e6cbbe6095cc15459dce3a2c3ee
---

EMPIRICALLY CONFIRMED via production API query. 108/162 metrics show 0% variance over 5-minute window. Enterprise A OEE metrics ALL static. However, individual machine metrics (metric_availability) DO vary (47%-93%). The AI sees AGGREGATED data which is static, not raw machine data. Root cause is aggregation level, not MQTT broker.