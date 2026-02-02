---
type: DRR
winner_id: hybrid-fix-critical-now-tooling-targeted-tests-pragmatic
created: 2026-02-02T12:18:20-05:00
content_hash: fb3a5983c5392bc08da74f4b38a2b0bc
---

# Comprehensive Bug Discovery and Resolution Strategy

## Context
EdgeMind project has 13 confirmed bugs across backend (4), frontend (5), and infrastructure (2) with zero test coverage, no linting, and no static analysis. A conference demo deadline (ProveIt! 2026) creates timeline pressure. The deploy-frontend.yml CI/CD pipeline is broken (references deleted files), creating an immediate deployment risk.

## Decision
**Selected Option:** hybrid-fix-critical-now-tooling-targeted-tests-pragmatic

We decided to use the Hybrid Pragmatic approach: fix critical bugs immediately (Phases 0-2), then layer in lightweight tooling (Phase 3: ESLint + CI gate), then add targeted Jest tests only for historically buggy areas (Phase 4: OEE, MQTT parsing, validation), followed by a final sweep (Phase 5). Backend and frontend fixes run in parallel since they touch different files.

## Rationale
R_eff: 1.00 (all evidence internal, CL3). The Hybrid approach was the only hypothesis to pass both verification (respects all 8 bounded context invariants) and validation (all 13 bugs confirmed at exact file:line locations). It correctly sequences security fixes before tooling setup (unlike Tooling-First which delays critical XSS and unhandled promise fixes). It incorporates the best element of Test-Driven (targeted Jest tests for OEE/MQTT) without the poor-ROI frontend test infrastructure overhead. It provides regression prevention (unlike Triage-and-Fix which is purely reactive). Phased structure means even partial completion (Phases 0-2 only) addresses all critical and medium bugs.

### Characteristic Space (C.16)
Scope: Full EdgeMind stack (backend, frontend, CI/CD). Confidence: HIGH (all bugs empirically verified). Risk: LOW (phased delivery, incremental value). Timeline alignment: YES (critical fixes first, tooling after).

## Consequences
1. All 13 bugs will be fixed across 5 phases. 2. ESLint + CI gate will catch common issues in future PRs. 3. Jest tests for OEE, MQTT parsing, and validation will prevent regressions in the historically buggiest areas. 4. deploy-frontend.yml will correctly trigger and sync CSS/JS directories. 5. Trade-off: No comprehensive test coverage - only 3 test files targeting highest-risk modules. 6. Trade-off: No pre-commit hooks (Husky) until after conference demo. 7. Revisit after conference: consider adding Husky, expanding test coverage, evaluating TypeScript migration.
