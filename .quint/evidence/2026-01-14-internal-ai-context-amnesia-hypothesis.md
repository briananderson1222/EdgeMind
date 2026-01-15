---
id: 2026-01-14-internal-ai-context-amnesia-hypothesis.md
type: internal
target: ai-context-amnesia-hypothesis
verdict: pass
assurance_level: L2
carrier_ref: test-runner
valid_until: 2026-04-14
date: 2026-01-14
content_hash: fe526b83e186958b02e71c28a3597ee6
---

CONFIRMED via code trace. lib/ai/index.js:155-187 builds fresh prompt each 30s cycle. factoryState.trendInsights stores up to 20 insights (line 380-382) but is NEVER passed to analyzeTreesWithClaude(). The askClaudeWithContext() function (line 461-462) DOES use recentTrends, proving the pattern works but is not applied to the agentic loop. Direct evidence: user logs show identical alerts every 30s with no deduplication.