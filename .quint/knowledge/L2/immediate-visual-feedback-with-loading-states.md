---
scope: app.js selectFactory() and refreshAllData() functions, styles.css for loading states
kind: system
content_hash: 0bb77f5a406706f37b546267719e1587
---

# Hypothesis: Immediate Visual Feedback with Loading States

Add immediate visual feedback when filter buttons are clicked: 1) Add 'loading' class to clicked button immediately, 2) Show skeleton/spinner on each data panel before API calls, 3) Disable other filter buttons during refresh to prevent race conditions, 4) Re-enable once all API calls complete using Promise.all(). This addresses perceived slowness without changing the underlying architecture.

## Rationale
{"anomaly": "Users perceive buttons as broken because there's no visual feedback during 8 parallel API calls", "approach": "Add CSS loading states and disable buttons during refresh", "alternatives_rejected": ["Server-side rendering (too complex)", "Single mega-endpoint (breaks separation of concerns)"]}