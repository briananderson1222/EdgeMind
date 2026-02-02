---
valid_until: 2026-04-29
date: 2026-01-29
id: 2026-01-29-research-persona-first-command-bar-with-context-switching.md
type: research
target: persona-first-command-bar-with-context-switching
verdict: pass
assurance_level: L2
carrier_ref: test-runner
content_hash: 56895fd1a78e9bd5f879796b6589e6ab
---

RESEARCH FINDINGS:

1. NNG CRITICAL WARNING - MITIGATED FOR DEMO CONTEXT:
- NNG article "Audience-Based Navigation: 5 Reasons to Avoid It" warns that role-based navigation increases cognitive load and user anxiety about missing content.
- HOWEVER: NNG's concerns apply to SELF-SERVICE products where users choose their own path. EdgeMind demo is PRESENTER-CONTROLLED. The presenter narrates "Now let's switch to Plant Manager" - eliminating anxiety about missing content because the audience trusts the presenter's guided flow.
- NNG themselves recommend: "Design navigation that allows users to easily switch between audiences" and "Avoid portals that lock users into an audience section with no obvious way to move between sections." Our persona chips are always visible and switchable - satisfying this recommendation.

2. PERSONA-SEGMENTED DASHBOARD RESEARCH (Strong Support):
- InsightSoftware: "If multiple use-cases for the dashboard are known for multiple end users, then the best way to design the dashboard is through a persona-segmented approach."
- "Some designers assume it's best to start by building a one-size-fits-all version... many users will churn without experiencing the product's full potential." This validates segmenting by persona.
- Pencil & Paper: "Design navigation around user roles and personas rather than a one-size-fits-all approach."
- Material Design: "Identify your app's users and their potential roles, identify the most common tasks they may want to perform, assign priority levels."

3. DEMO PRESENTATION OPTIMIZATION (Strongest Fit):
- Storylane 2026: "Use separate demo segments if your product requires complex flows... link them through a clear transition rather than switching back and forth."
- Persona chips ARE those clear transitions. COO → Plant Manager is a visible, understandable segment switch.
- Supademo: "Interactive demos can be used to give live guided demos... in a fully controlled environment."
- Reprise: "Crafting a detailed demo script that incorporates a compelling narrative" - persona switching IS the narrative device.

4. INDUSTRIAL HMI ALIGNMENT (Moderate):
- HMI best practices support role-based interfaces: "Different users see only relevant controls" (DataParc).
- Inductive Automation: HMI screens organize by progressive levels of detail - our persona approach does this (COO=high-level, Plant Manager=detail).
- Manufacturing context validates the ISA-95 hierarchy mapping: COO sees Enterprise level, Plant Manager sees Area/Line/Equipment level.

5. CONTEXTUAL SUB-NAV RESEARCH (Strong):
- NNG: "Add additional context by showing subcategories early on. Surfacing deeper links introduces users to the scope of a section."
- This validates our contextual sub-nav that adapts per persona - COO sees enterprise-level items, Plant Manager sees equipment-level items.
- HMI research: "Broad and Shallow" organization (multiple overarching categories with minimal info per category) matches our persona-first approach where each persona has a few focused sub-items.

6. KEYBOARD SHORTCUTS FOR DEMO (Unique Advantage):
- Demo best practices emphasize rehearsal and clean clicks. Keyboard shortcuts 1/2/3 for persona switching eliminate mouse navigation entirely during live demo - reducing chance of misclicks on stage.

RISKS:
- Novel pattern = higher implementation complexity than standard top nav.
- If future production use is needed, NNG warns against audience-based nav for self-service users.
- Requires clear visual affordance that persona chips are the primary interaction.

VERDICT RATIONALE: Research validates persona-segmented dashboards as best practice. NNG's audience-nav warnings are mitigated by controlled demo context. Demo presentation research directly supports persona-as-segment-transition. Strongest evidence alignment with the specific use case (conference demo storytelling).