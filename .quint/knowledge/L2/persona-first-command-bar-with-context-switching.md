---
scope: EdgeMind frontend navigation. Optimized for conference demo storytelling. Desktop presentation (1920x1080 projector).
kind: system
content_hash: 6f1a251f0c91a365b3d4554a1e31d9dd
---

# Hypothesis: Persona-First Command Bar with Context Switching

Radical approach: Instead of traditional navigation, use a persona-first command bar that changes the entire UI context based on who is using it.

**Layout:** Slim top bar (~48px) with persona switcher as the PRIMARY interaction. Below it, contextual sub-navigation adapts per persona.

**Information Architecture:**
- Top bar (always visible):
  - Left: EdgeMind logo
  - Center: PERSONA SELECTOR (large, prominent) - chips/pills: [COO] [Plant Manager] [Demo Control]
  - Right: Status indicators (MQTT connected, data freshness)
- Context bar (below top, changes per persona):
  - COO: Overview | Enterprise Comparison | Trends | Agent Q&A
  - Plant Manager: Line Status | OEE Drill-down | Alerts | Work Orders
  - Demo Control: Scenarios | Reset | Inject Anomaly | Timer

**Interaction Patterns:**
- Click persona chip → entire sub-nav and content area transitions
- Animated context switch (crossfade, 200ms)
- Persona chip shows active state with filled background + checkmark
- Sub-nav items are contextual - different for each persona
- Keyboard shortcut: 1/2/3 to switch personas (demo-friendly)

**Visual Design:**
- Persona chips use distinct colors:
  - COO: Blue (#3b82f6) - authority, overview
  - Plant Manager: Green (#10b981) - operations, health
  - Demo Control: Orange (#f59e0b) - caution, special mode
- Sub-nav has subtle background differentiation per persona
- Transition animation signals context change

**Static Prototype Approach:**
- Create `prototype-command-bar.html` with CSS + minimal JS for persona switching
- Show all three persona states in prototype
- Demonstrate the contextual sub-nav adaptation

**UX Rationale (Novel):**
- Matches the demo narrative: "Now let's switch to the Plant Manager's perspective"
- Reduces cognitive load: only show nav items relevant to current persona
- Progressive disclosure: don't overwhelm with all options at once
- Storytelling-friendly: persona switch IS the navigation event

## Rationale
{"anomaly": "No navigation exists. Demo requires persona-driven storytelling.", "approach": "Persona-first design where the persona IS the navigation. Radical departure from traditional nav - optimized specifically for the demo narrative flow.", "alternatives_rejected": ["Traditional nav with persona as afterthought - doesn't support storytelling", "Separate URLs per persona - breaks presentation flow"]}