---
verdict: pass
assurance_level: L2
carrier_ref: test-runner
valid_until: 2026-05-03
date: 2026-02-02
id: 2026-02-02-internal-hybrid-fix-critical-now-tooling-targeted-tests-pragmatic.md
type: internal
target: hybrid-fix-critical-now-tooling-targeted-tests-pragmatic
content_hash: 969c33c9509f5facbc5a3981a5a98a9a
---

All bugs in the hybrid plan verified at exact lines via direct code reads:

BACKEND CONFIRMED:
- B1: server.js:465 - .then() without .catch() on askClaudeWithContext. CONFIRMED.
- B7: server.js:962,1094,1576 - All three use hardcoded from(bucket: "factory") instead of CONFIG.influxdb.bucket. CONFIRMED.
- B8: factoryState.anomalies has no cap anywhere in codebase. CONFIRMED.
- B2: startAgenticLoop() at lib/ai/index.js:776 has no guard against duplicate calls. Only checks CONFIG.disableInsights. CONFIRMED.

FRONTEND CONFIRMED:
- F1: js/modals.js:60 - severity injected into innerHTML class attribute without escapeHtml(). CONFIRMED.
- F4: js/modals.js:320 - new Chart(ctx, originalConfig) result not stored, never destroyed on modal close. CONFIRMED.
- F3: js/app.js:226 - MutationObserver created, no disconnect() call anywhere in the file. CONFIRMED.
- F5: js/websocket.js:77-81 - Fixed 5000ms reconnect interval, no backoff. CONFIRMED.
- F9: js/demo-scenarios.js:29 - updateScenarioStatus() called without await or .catch(). CONFIRMED.

INFRASTRUCTURE CONFIRMED:
- I1: deploy-frontend.yml lines 8-9 reference 'styles.css' and 'app.js' (deleted files). Lines 42-43 in S3 sync also reference them. css/ and js/ directories exist but are not included. CONFIRMED CRITICAL.

SEQUENCING VALIDATED: Phase 0 (infra) has no dependencies. Phases 1+2 are independent (different files). Phase 3 depends on 1+2 (don't want lint blocking critical fixes). Phase 4 depends on 3 (needs jest installed). Phase 5 is final sweep. Dependency chain is correct.