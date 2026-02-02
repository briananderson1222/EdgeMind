---
kind: episteme
scope: Full stack + CI/CD pipeline + developer tooling
content_hash: 2154de976468bd49f2118fedcb2c783f
---

# Hypothesis: Tooling-First Then Fix (Moderate)

Before fixing bugs, establish the tooling foundation that will catch future bugs and validate fixes. Then fix bugs with confidence that regressions are caught.

Method:
1. Phase 1 - Tooling Setup:
   a. Add ESLint with strict rules (catches ~30% of bugs automatically)
   b. Add Prettier for consistent formatting
   c. Add pre-commit hooks via Husky (prevent bad code from being committed)
   d. Fix ESLint errors (many will overlap with identified bugs)
2. Phase 2 - Critical Bug Fixes:
   a. Fix security vulnerabilities (XSS in modals.js)
   b. Fix data integrity issues (unhandled promises, race conditions)
   c. Fix memory leaks (event listeners, Chart.js, MutationObserver)
3. Phase 3 - Infrastructure Fixes:
   a. Fix deploy-frontend.yml path patterns
   b. Remove stale deploy.yml
4. Phase 4 - Remaining Bugs:
   a. Fix medium/low priority bugs
   b. Add basic smoke tests for critical paths

Pros: Prevents future regressions, ESLint catches many bugs automatically, sustainable
Cons: Setup overhead before any bugs are fixed, ESLint noise in initial run

## Rationale
{"anomaly": "No automated detection means fixing bugs is a one-time event with no regression prevention", "approach": "Establish automated detection first, then fix with confidence", "alternatives_rejected": ["Adding TypeScript - too large a migration for current codebase size and demo timeline"]}