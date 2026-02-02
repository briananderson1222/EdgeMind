---
scope: Full stack, prioritized for conference demo readiness
kind: episteme
content_hash: 4bd25eefd3afe3644680147cd4ae2d76
---

# Hypothesis: Hybrid: Fix Critical Now + Tooling + Targeted Tests (Pragmatic)

A blended approach: immediately fix the most dangerous bugs, then layer in tooling and targeted tests for the areas that matter most. Optimized for the conference demo timeline.

Method:
1. Phase 1 - Emergency Fixes (Critical/Security):
   a. Fix XSS in modals.js (severity injection)
   b. Fix unhandled promise in server.js:465 (client hang)
   c. Fix duplicate agentic loop race condition (cost/resource leak)
   d. Fix deploy-frontend.yml broken path patterns
2. Phase 2 - Memory & Stability Fixes:
   a. Fix MutationObserver leak (app.js)
   b. Fix Chart.js modal memory leak (modals.js)
   c. Fix event listener accumulation (app.js)
   d. Fix schema refresh race condition (schema/index.js)
   e. Fix unbounded anomaly array (state.js)
   f. Add InfluxDB health check before processing
3. Phase 3 - Lightweight Tooling:
   a. Add ESLint (catches future issues)
   b. Add to CI pipeline (automated gate)
   c. Fix ESLint-detectable issues
4. Phase 4 - Targeted Tests (High-Value Only):
   a. Jest setup with minimal config
   b. Tests for OEE calculation (historically buggy per bugs.md)
   c. Tests for MQTT message parsing (data integrity)
   d. Tests for input validation/sanitization
5. Phase 5 - Remaining Bug Sweep:
   a. Fix remaining medium/low bugs
   b. Fix CSS responsive issues
   c. Address accessibility gaps

Pros: Immediate risk reduction, pragmatic tooling, tests where they matter most, aligned with demo timeline
Cons: Not comprehensive test coverage, some low-priority bugs may be deferred

## Rationale
{"anomaly": "38+ bugs across full stack with conference demo deadline, need to balance speed with sustainability", "approach": "Fix critical bugs immediately, add lightweight tooling, write tests only where historically buggy", "alternatives_rejected": ["Full TDD approach - too slow for demo timeline", "Fix-only approach - no regression prevention", "Tooling-first - delays critical security fixes"]}