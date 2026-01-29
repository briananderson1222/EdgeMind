---
type: DRR
winner_id: persona-first-command-bar-with-context-switching
created: 2026-01-29T13:39:20-05:00
content_hash: 00ccdd309c06e2094580e053be0655d4
---

# Persona-First Command Bar for EdgeMind Navigation

## Context
EdgeMind is a single-page factory intelligence dashboard with no navigation structure. The ProveIt! Conference demo (Feb 15, 2026) requires persona-driven storytelling with seamless transitions between COO and Plant Manager views across 6 demo scenarios. Additional views needed: demo control panel, agent workflow visualization, manufacturing-specific views (filling line, mixing, packaging, palletizing). Navigation must support iframe embedding for Harjat's dashboards. Stefan requires iterative static HTML/CSS prototyping before production integration.

## Decision
**Selected Option:** persona-first-command-bar-with-context-switching

Implement a Persona-First Command Bar with Context Switching. A slim top bar (~48px) with persona switcher as the PRIMARY interaction. Persona chips (COO, Plant Manager, Demo Control) are the main navigation mechanism. Below it, a contextual sub-navigation adapts per persona: COO sees enterprise-level views, Plant Manager sees equipment/line-level views, Demo Control sees scenario management. Keyboard shortcuts (1/2/3) enable presentation-friendly switching without mouse interaction.

## Rationale
1. HIGHEST QUALITATIVE R_eff (0.88): Best evidence alignment with the specific use case (conference demo + persona storytelling). Research from InsightSoftware validates persona-segmented dashboards, Storylane/Supademo validate demo segment transitions, Material Design validates role-based priority assignment.

2. DEMO NARRATIVE FIT: The demo scenarios document defines two clear personas (COO, Plant Manager) with distinct views. Persona-first design makes the context switch THE navigation event, which is exactly what a conference demo needs — big, visible, understandable actions that the audience can follow.

3. NNG WARNING MITIGATED: Nielsen Norman Group warns against audience-based navigation for self-service products. This concern is mitigated because EdgeMind demo is presenter-controlled — the presenter narrates transitions, eliminating user anxiety about missing content. NNG recommends "easy switching between audience sections" which persona chips satisfy.

4. INDUSTRIAL HMI ALIGNMENT: HMI best practices support role-based interfaces where "different users see only relevant controls." Progressive levels of detail (COO=enterprise, Plant Manager=equipment) align with ISA-95 hierarchy.

5. KEYBOARD SHORTCUTS: 1/2/3 for persona switching eliminates mouse navigation during live demo, reducing misclick risk on conference stage.

## Consequences
POSITIVE:
- Demo transitions become the narrative device ("Now let's switch to the Plant Manager's perspective")
- Contextual sub-nav reduces cognitive overload per persona
- Keyboard shortcuts enable smooth stage presentation
- Static prototype can show all 3 persona states in one HTML file

NEGATIVE:
- Novel pattern with no established precedent in industrial dashboards
- NNG audience-nav warning exists (mitigated but unvalidated in practice)
- 3 different sub-nav states increase implementation complexity
- If EdgeMind becomes a production tool, persona-first nav would need redesign per NNG research

REVISIT CONDITIONS:
- If test audiences find persona switching confusing during rehearsal
- If EdgeMind transitions from demo tool to production product (revisit Top Horizontal Navbar, R_eff 0.82)
- If NNG audience-nav concerns materialize in practice
- After conference demo (Feb 15) to evaluate effectiveness

RUNNER-UP PRESERVED: Top Horizontal Navbar (L2, R_eff 0.82) retained in knowledge base with full evidence trail for future revisit.
