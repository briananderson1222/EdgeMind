---
scope: EdgeMind frontend navigation. Desktop-first. Suitable for both demo and production use.
kind: system
content_hash: 01e646d8a07818fdbebba26a413c45c1
---

# Hypothesis: Hybrid Top Bar with Mega Menu and Persona Context

Combines the best of horizontal nav and persona-first design. Top bar with mega-menu dropdowns that organize content by both function and persona.

**Layout:** Two-row top bar system:
- Row 1 (primary, ~48px): Brand + main nav + persona selector + status
- Row 2 (contextual breadcrumb, ~32px): Shows current path (e.g., "COO > Enterprise Overview > Enterprise A")

**Information Architecture:**
- Row 1 left: EdgeMind logo + tagline "Factory Intelligence"
- Row 1 center: Main nav items with mega-menu on hover/click:
  - Operations ▾ → Mega menu: Dashboard, OEE Overview, Line Status, Equipment Health
  - Intelligence ▾ → Mega menu: Agent Insights, Anomaly History, Trend Analysis
  - Manufacturing ▾ → Mega menu: Filling Line, Mixing, Packaging, Palletizing (iframes)
- Row 1 right: Persona pills [COO | Plant Mgr] + connection status dot
- Row 2: Dynamic breadcrumb showing navigation context

**Interaction Patterns:**
- Hover/click main item → mega menu panel drops down (300px height)
- Mega menu has icon + label + description for each sub-item
- Persona switch applies a filter/theme overlay (doesn't change nav structure)
- Breadcrumb items are clickable for back-navigation
- Keyboard: Tab navigation through mega menu items

**Visual Design:**
- Mega menu panels have organized columns with headers
- Each section has a distinct icon from Lucide/Heroicons
- Subtle glassmorphism effect on mega menu overlay
- Breadcrumb uses / separator with muted colors
- Persona pills match ADR-011 color scheme

**Static Prototype Approach:**
- Create `prototype-mega-nav.html` with CSS + JS for mega menu behavior
- Include hover states and mega menu panel content
- Test breadcrumb updates on navigation

**UX Rationale:**
- Mega menus are proven for information-rich applications (AWS Console, Shopify Admin)
- Two-row system: primary nav is always visible, context is always clear
- Breadcrumb provides wayfinding (Jakob Nielsen's #1 recommendation for complex apps)
- Scales well: can add new sections without redesigning nav

## Rationale
{"anomaly": "No navigation exists. Need both demo persona switching and scalable information architecture.", "approach": "Hybrid approach combining established mega-menu pattern (AWS Console, enterprise apps) with persona context. Balances demo needs with production scalability.", "alternatives_rejected": ["Simple top nav without mega menus - insufficient for the number of views needed", "Three-row nav - too much vertical space consumed"]}