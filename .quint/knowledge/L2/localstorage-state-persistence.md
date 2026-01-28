---
scope: app.js initialization and selectFactory() function
kind: system
content_hash: 47948ff4c3f8852df494009ee1e0ef3f
---

# Hypothesis: localStorage State Persistence

Persist the selected enterprise filter in localStorage: 1) On selectFactory() call, save state.selectedFactory to localStorage, 2) On page load (DOMContentLoaded), read localStorage and restore filter state, 3) Trigger initial data refresh with restored filter. This ensures filter preference survives page reloads and browser sessions.

## Rationale
{"anomaly": "Filter resets to ALL on every page load, forcing users to re-select their enterprise", "approach": "Use localStorage for simple key-value persistence", "alternatives_rejected": ["sessionStorage (doesn't survive browser close)", "IndexedDB (overkill for single value)", "Server-side user preferences (requires auth)"]}