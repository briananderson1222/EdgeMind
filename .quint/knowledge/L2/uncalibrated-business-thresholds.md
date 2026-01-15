---
scope: lib/domain-context.js thresholds, AI prompt construction, operator configuration
kind: system
content_hash: 245998099058d0d398895569a6c71aae
---

# Hypothesis: Uncalibrated Business Thresholds

The AI uses hardcoded industry-generic thresholds that don't match actual business expectations. The domain-context.js defines thresholds (e.g., defects warning=10, critical=25) but: (1) No "acceptable baseline" concept exists - only warning/critical, (2) Thresholds aren't calibrated to what THIS business considers good (boss says 85% OEE is world class), (3) No operator-configurable way to set expectations per enterprise. The fix requires adding configurable baseline thresholds that operators can tune, plus teaching the AI the difference between "below world-class" and "actually problematic".

## Rationale
{"anomaly": "AI flags 72% availability as 'concerning' when business considers 85% OEE world-class", "approach": "Add configurable baseline/acceptable/warning/critical tiers with business-calibrated defaults, allow operator override", "alternatives_rejected": ["Remove all thresholds (loses value)", "Hardcode boss's numbers (not maintainable)", "Let AI decide (current problem)"]}