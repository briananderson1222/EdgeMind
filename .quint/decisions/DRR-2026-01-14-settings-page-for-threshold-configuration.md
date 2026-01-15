---
winner_id: settings-page-for-threshold-configuration
created: 2026-01-14T15:55:19-05:00
type: DRR
content_hash: ed8a5a575d07526d1f41ad94ea86db57
---

# Settings Page for Threshold Configuration

## Context
AI uses hardcoded industry-generic thresholds that don't match business expectations. User's boss says 85% OEE is 'world class', but AI flags 72% availability as 'concerning'. Existing Add Filter button is freeform text and not persisted.

## Decision
**Selected Option:** settings-page-for-threshold-configuration

Implement settings-page-for-threshold-configuration: Create a dedicated Settings UI where operators can configure OEE baseline, availability thresholds, and defect rate limits per enterprise. Settings persist to backend and are injected into AI prompt context.

## Rationale
Self score: 1.00 (feasibility confirmed). R_eff penalized by stale L0 dependency but hypothesis is valid. Extends existing filter infrastructure (filter-infrastructure-exists-but-insufficient, R:1.00). User confirmed need for business-calibrated thresholds. Patterns exist in codebase for WebSocket messaging and state management.

### Characteristic Space (C.16)
complexity:medium, risk:medium, impact:high

## Consequences
Operators can tune what 'acceptable' means for their business. Requires new /api/settings endpoint, settings modal/page UI, localStorage or backend persistence. Medium complexity. Implement as Track 2 after amnesia fix.
