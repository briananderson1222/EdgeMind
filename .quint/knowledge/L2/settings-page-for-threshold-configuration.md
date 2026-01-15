---
scope: New settings UI component, new /api/settings endpoint, lib/config.js or new lib/settings.js, AI prompt construction
kind: system
content_hash: fdf8c623371ca0ae715ddd70c247290f
---

# Hypothesis: Settings Page for Threshold Configuration

Create a dedicated Settings page/modal where operators can configure: (1) OEE baseline per enterprise (default: 70% acceptable, 85% world-class), (2) Availability/Performance/Quality component baselines, (3) Defect rate thresholds per enterprise type (glass vs beverage vs pharma), (4) Alert severity mapping (what triggers warning vs critical vs info). Settings should persist to backend (new API endpoint) and be loaded on page init. The AI prompt should incorporate these operator-defined thresholds instead of hardcoded domain-context.js values.

## Rationale
{"anomaly": "No way for operators to define what 'acceptable' means for their business", "approach": "Settings page with structured inputs, persisted to backend, injected into AI context", "alternatives_rejected": ["Hardcode boss's numbers (not maintainable)", "Use freeform filter text (not structured enough)", "Let AI decide (current problem)"]}