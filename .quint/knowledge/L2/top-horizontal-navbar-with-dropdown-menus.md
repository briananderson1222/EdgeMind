---
scope: EdgeMind frontend navigation. Applies to all HTML pages. Desktop-first (conference demo on large screen).
kind: system
content_hash: 8f281c8b4d150c07cd8a767e94275c04
---

# Hypothesis: Top Horizontal Navbar with Dropdown Menus

Classic horizontal navigation bar fixed at the top of the viewport. Structure:

**Layout:** Full-width bar at top, ~56-64px height, fixed position (stays visible on scroll).

**Information Architecture:**
- Logo/Brand (left) - "EdgeMind" with factory icon
- Primary nav items (center): Dashboard | Plant Manager | Agent Insights
- Persona selector (right): Dropdown with COO/Plant Manager persona badges
- Demo Controls (far right): Gear icon → dropdown panel for demo orchestration

**Interaction Patterns:**
- Click nav item → content area switches (SPA-style, no page reload)
- Persona selector → changes data filters and view emphasis across all pages
- Active state: bottom border accent + bold text
- Hover: subtle background color shift

**Visual Design (UX Best Practices):**
- Follow Material Design 3 / Tailwind UI patterns for nav
- Dark theme to match existing dashboard aesthetic
- 8px grid system for spacing consistency
- Accessible: keyboard navigable, ARIA roles, sufficient contrast (WCAG AA)
- Responsive: collapses to hamburger menu on mobile (though demo is desktop)

**Static Prototype Approach:**
- Create `prototype-navbar.html` with inline CSS
- No JS dependencies - pure HTML/CSS for rapid iteration
- Stefan vets layout locally, then we extract to production files

**UX Rationale (Nielsen's Heuristics):**
- Visibility of system status: Active nav item clearly highlighted
- Recognition over recall: All views visible in one glance
- Consistency: Follows established web nav conventions
- Flexibility: Dropdown menus for less-frequent actions

## Rationale
{"anomaly": "No navigation exists. Need persona switching for demo.", "approach": "Standard top navbar following established web conventions (Material Design, Nielsen heuristics). Most recognizable pattern - zero learning curve for demo audience.", "alternatives_rejected": ["Sidebar nav - takes horizontal space from data-dense dashboard", "Bottom nav - mobile pattern, inappropriate for desktop demo"]}