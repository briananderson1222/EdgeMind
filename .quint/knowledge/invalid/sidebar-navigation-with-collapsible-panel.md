---
scope: EdgeMind frontend navigation. Desktop-first. Requires minimum 1440px viewport width for comfortable use.
kind: system
content_hash: 9cdbc2465cd22a3e9090d77138b5f7e7
---

# Hypothesis: Sidebar Navigation with Collapsible Panel

Vertical sidebar navigation on the left edge, collapsible to icon-only mode.

**Layout:** 240px expanded / 64px collapsed sidebar, fixed left. Content area fills remaining width.

**Information Architecture:**
- Brand/Logo at top of sidebar
- Navigation sections with grouping headers:
  - VIEWS: Dashboard, Plant Manager, Manufacturing Lines
  - INTELLIGENCE: Agent Insights, Anomaly History
  - DEMO: Control Panel, Scenario Selector
- Persona badge at bottom of sidebar (avatar + role name)
- Collapse toggle button (hamburger or chevron)

**Interaction Patterns:**
- Click item → content area transitions (slide animation)
- Hover on collapsed sidebar → tooltip with label
- Section headers are non-clickable group labels
- Active state: left accent bar + filled background
- Nested items expand/collapse within sections

**Visual Design:**
- Dark sidebar (#1a1a2e) against slightly lighter content area
- Icon + label pairs for each nav item
- Lucide or Heroicons for consistent icon set
- Smooth expand/collapse animation (300ms ease)
- Persona badge shows current role context

**Static Prototype Approach:**
- Create `prototype-sidebar.html` with inline CSS + minimal JS for collapse toggle
- Test both expanded and collapsed states
- Verify dashboard content doesn't feel cramped at 1920px - 240px = 1680px

**UX Rationale:**
- Scales better for many nav items (vertical scroll vs horizontal overflow)
- Icon-only mode preserves screen real estate
- Common in analytics dashboards (Grafana, Metabase, Datadog)
- Section grouping provides clear information hierarchy

## Rationale
{"anomaly": "No navigation exists. Need persona switching for demo.", "approach": "Vertical sidebar common in analytics/monitoring dashboards. Scales to many items, collapsible to preserve space.", "alternatives_rejected": ["Full-width sidebar always expanded - wastes too much horizontal space for data-dense dashboard"]}