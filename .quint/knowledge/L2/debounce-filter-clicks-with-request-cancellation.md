---
scope: app.js selectFactory(), refreshAllData(), and all fetch functions
kind: system
content_hash: 14fe0f9ae362c750ae9aea2c851ab06a
---

# Hypothesis: Debounce Filter Clicks with Request Cancellation

Add debouncing and request cancellation to prevent race conditions: 1) Use AbortController to cancel in-flight requests when a new filter is selected, 2) Add 150ms debounce to selectFactory() to prevent rapid-fire API calls, 3) Track pending requests in state and abort them before starting new ones. This prevents stale data from overwriting fresh data when users click quickly.

## Rationale
{"anomaly": "Rapid filter clicks cause race conditions where old responses overwrite new ones", "approach": "AbortController for cancellation + debounce for input smoothing", "alternatives_rejected": ["Ignore responses if filter changed (still wastes network)", "Queue requests (adds latency)"]}