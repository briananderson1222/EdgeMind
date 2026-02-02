---
scope: Full stack with Jest test infrastructure
kind: episteme
content_hash: c6581e2570bbac120714e23e9168b3bd
---

# Hypothesis: Test-Driven Bug Fixes (Moderate-Aggressive)

Write failing tests for each identified bug FIRST, then fix them. This creates a regression test suite as a byproduct of bug fixing.

Method:
1. Phase 1 - Test Infrastructure:
   a. Add Jest as test framework
   b. Configure for both backend (Node.js) and frontend (jsdom)
   c. Add test scripts to package.json
   d. Add test step to CI/CD pipeline
2. Phase 2 - Write Failing Tests for Critical Bugs:
   a. Test: XSS payload in anomaly severity → should be escaped
   b. Test: Claude API timeout → client should receive error response
   c. Test: Concurrent startAgenticLoop calls → only one loop runs
   d. Test: Schema refresh race condition → only one refresh at a time
3. Phase 3 - Fix Bugs (Tests Go Green):
   a. Fix each bug, verify test passes
   b. Each fix is proven correct by its test
4. Phase 4 - Expand Coverage:
   a. Write tests for remaining bugs
   b. Add integration tests for WebSocket message flow
   c. Add API endpoint tests

Pros: Every fix is verified, regression suite grows automatically, TDD best practice
Cons: Significant upfront investment, slower to show initial results, requires test expertise for MQTT/WebSocket/InfluxDB mocking

## Rationale
{"anomaly": "Zero test coverage means any fix could break something else silently", "approach": "Test-first approach ensures each fix is verified and regressions are caught", "alternatives_rejected": ["E2E tests with Playwright - too heavy for current project maturity, better suited after unit tests exist"]}