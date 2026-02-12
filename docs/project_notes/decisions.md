# Architectural Decisions

This file logs architectural decisions (ADRs) with context and trade-offs.

## Format

- **ADR Number and Title** (YYYY-MM-DD)
- **Context**: Why the decision was needed
- **Decision**: What was chosen
- **Alternatives Considered**: Other options and why rejected
- **Consequences**: Trade-offs (use checkmarks for clarity)

---

## Entries

### ADR-001: Modular Backend Architecture (2025-01)

**Context:**
- `server.js` was growing too large (1000+ lines)
- Hard to maintain, test, and understand
- Need clear separation of concerns

**Decision:**
- Extract into `lib/` modules with focused responsibilities
- Each module handles one concern (config, influx, schema, oee, ai, cmms)
- Clear dependency hierarchy documented in CLAUDE.md

**Alternatives Considered:**
- Single file approach -> Rejected: unmaintainable at scale
- Microservices -> Rejected: overkill for this project, deployment complexity
- Full MVC framework -> Rejected: too much boilerplate for real-time dashboard

**Consequences:**
- Easier to understand and maintain
- Clear module boundaries
- Better testability
- Deployment requires `docker cp` for lib/ folder (not bind-mounted)

---

### ADR-002: InfluxDB for Time-Series Data (2025-01)

**Context:**
- Need to store high-frequency MQTT sensor data
- Require efficient time-range queries for trend analysis
- Need aggregation functions (mean, max, min)

**Decision:**
- Use InfluxDB 2.7 with Flux query language
- Store in `factory` bucket with tags: enterprise, site, area, machine, full_topic

**Alternatives Considered:**
- PostgreSQL with TimescaleDB -> Rejected: more complex setup
- Plain PostgreSQL -> Rejected: inefficient for time-series queries
- Redis -> Rejected: limited query capabilities

**Consequences:**
- Excellent query performance for time ranges
- Built-in aggregation and downsampling
- Flux query language has learning curve
- Docker-based local development

---

### ADR-003: Tier-Based OEE Calculation (2025-01)

**Context:**
- Different factories report OEE data differently
- Some have direct OEE metrics, others have components (availability, performance, quality)
- Some have related metrics that can estimate OEE

**Decision:**
- Implement tier-based OEE system:
  - Tier 1: Direct OEE measurement (highest confidence)
  - Tier 2: Calculated from A/P/Q components
  - Tier 3: Estimated from related metrics
- Return calculation metadata (tier, method, confidence)

**Alternatives Considered:**
- Single calculation method -> Rejected: doesn't work across all enterprises
- Separate endpoints per enterprise -> Rejected: inconsistent API

**Consequences:**
- Works across all factory configurations
- Transparent about data quality (confidence scores)
- More complex implementation
- API returns rich metadata for debugging

---

### ADR-004: ChromaDB for Anomaly Persistence (2026-01-14)

**Context:**
- AI stores detected anomalies only in memory (`factoryState.trendInsights`)
- Anomaly history lost on server restart
- No way to query historical patterns or perform semantic search
- Limited context window for AI deduplication
- AWS AgentCore imminent - need storage strategy aligned with AgentCore Memory patterns

**Decision:**
- Use ChromaDB as vector database for anomaly persistence with RAG capabilities
- Generate embeddings using AWS Bedrock `titan-embed-text-v2` (already available)
- Store anomaly text + embedding on detection
- Retrieve similar anomalies for AI context enrichment

**Alternatives Considered:**
- SQLite -> Rejected: no semantic search, would require separate embedding store
- InfluxDB anomaly storage -> Rejected: not designed for semantic queries
- Hybrid SQLite + RAG -> Rejected: unnecessary complexity, two systems to maintain
- In-memory only (status quo) -> Rejected: loses history on restart, no pattern learning
- Pinecone -> Rejected: external managed service, cost, vendor lock-in

**Rationale (from Quint FPF analysis):**
1. **AgentCore Alignment**: AgentCore Memory uses semantic retrieval - building with vectors now means minimal refactoring when migrating. AgentCore Gateway supports MCP servers, ChromaDB can be exposed as MCP.
2. **Evidence Quality**: Validated with internal testing (CL3) - confirmed Node 22 compatibility, minimal dependencies (only semver)
3. **Embedding Reuse**: AWS Bedrock titan-embed-text-v2 already available - no additional embedding API costs
4. **License**: Apache 2.0 - fully open source, commercial use permitted
5. **Simplicity**: Pure JavaScript client, no native module compilation issues unlike SQLite

**Consequences:**
- ✅ Semantic search for similar anomalies
- ✅ RAG pipeline for AI context enrichment
- ✅ Anomaly history persists across restarts
- ✅ Ready for AWS AgentCore Memory migration
- ⚠️ Adds new dependency and operational component (ChromaDB container)
- ⚠️ Additional storage and memory requirements

**Implementation:**
1. Add `chromadb` dependency to package.json
2. Create `lib/vector/index.js` for ChromaDB client
3. Generate embeddings using Bedrock titan-embed-text-v2
4. Store anomaly text + embedding on detection
5. Retrieve similar anomalies for AI context enrichment

**Revisit:** When AWS AgentCore Memory becomes GA (expected 2026)

---

### ADR-005: Sparkplug B Protocol Support (2025-01)

**Context:**
- Need to support industrial MQTT data from various sources
- Sparkplug B is an industry standard for MQTT in IIoT
- Universal ingestion for different factory configurations

**Decision:**
- Add Sparkplug B decoder for MQTT messages
- Detect protocol automatically based on topic pattern
- Parse Sparkplug B payloads into standard format

**Alternatives Considered:**
- Only plain MQTT -> Rejected: limits factory compatibility
- Custom protocol per factory -> Rejected: not scalable

**Consequences:**
- Wider factory compatibility
- More complex message parsing
- Additional dependency (sparkplug-payload)
- Need to install in container after recreation

### ADR-006: Hybrid ECS + S3/CloudFront Deployment (2026-01-15)

**Context:**
- EC2-based deployment caused friction: manual `scp` + `docker cp` commands
- Container recreation loses files (lib/, styles.css, app.js)
- Complex recovery steps documented in CLAUDE.md
- Goal: frictionless deployment while maintaining WebSocket/MQTT architecture

**Decision:**
- Static frontend (index.html, styles.css, app.js) on **S3 + CloudFront**
- Backend (server.js, lib/) on **ECS Fargate** behind ALB
- Infrastructure defined using **AWS CDK with Python (latest version)**
- CloudFront behaviors: `/` → S3, `/ws/*` → Backend ALB

**Alternatives Considered:**
- Full Fargate (everything in containers) → Rejected: 2-3x cost increase without proportional benefit, no frontend/backend separation advantage
- ECS EC2 with Immutable AMI → Rejected: trades docker cp pain for AMI management pain, operational overhead exceeds cost savings (~$15/mo)
- CI/CD on existing EC2 → Rejected: automates broken process, doesn't fix root cause (bind mounts + docker cp)

**Rationale (from Quint FPF analysis):**
1. **Highest R_eff (0.90)**: Best evidence quality among candidates
2. **AWS Endorsed**: AWS Prescriptive Guidance explicitly recommends this pattern for SPAs
3. **Friction Elimination**: Frontend deploys = `aws s3 sync` (seconds), Backend = ECR push
4. **Immutable Containers**: No more docker cp - everything baked into image
5. **Independent Deploys**: Can update frontend without touching backend

**Consequences:**
- ✅ Frontend deploys become trivial (`aws s3 sync`)
- ✅ Backend deploys are immutable container pushes
- ✅ Clear separation enables independent deploy cycles
- ✅ Python CDK for type-safe infrastructure
- ⚠️ Two deployment pipelines to maintain (but each is simple)
- ⚠️ Need CORS headers on backend for cross-origin WebSocket
- ⚠️ Need dedicated backend subdomain (e.g., api.edgemind.com)

**Implementation:**
1. Create CDK stack: S3 bucket, CloudFront distribution, ECS Fargate service, ALB
2. Update Dockerfile to include ALL files (no bind mounts)
3. Configure CloudFront behaviors for path-based routing
4. Configure CORS on backend for cross-origin WebSocket
5. Set up CI/CD: S3 sync for frontend, ECR push for backend

**DRR Reference:** `.quint/decisions/DRR-2026-01-15-hybrid-ecs-backend-s3-cloudfront-frontend-deployment.md`

**Revisit:** If monthly cost exceeds $100 or WebSocket latency issues arise

---

### ADR-007: GitHub Actions for CI/CD (2026-01-15)

**Context:**
- Need automated deployment pipeline for hybrid ECS + S3/CloudFront architecture
- Must handle frontend deploys to S3, backend builds to ECR, ECS service updates
- Evaluated AWS CodePipeline vs GitHub Actions

**Decision:**
- Use **GitHub Actions** with OIDC federation for AWS credentials
- Two workflows: `deploy-frontend.yml` and `deploy-backend.yml`
- Path-based triggers for efficient deployments

**Alternatives Considered:**
- AWS CodePipeline + CodeBuild → Rejected: Higher complexity (5+ resources vs 1 YAML), overkill for single-developer project, $5-10/mo cost vs free tier

**Rationale (from Quint FPF analysis):**
1. **Higher R_eff (0.88)** vs CodePipeline (0.75)
2. **Simpler setup**: Single YAML file vs 5+ AWS resources
3. **Free tier**: 2000 minutes/month sufficient
4. **OIDC federation**: No long-lived AWS credentials to manage
5. **Faster iteration**: Edit YAML, push, done

**Consequences:**
- ✅ Simple, fast deployments
- ✅ No credential management (OIDC)
- ✅ Free for this usage level
- ⚠️ Not defined in CDK (separate from infrastructure)
- ⚠️ Rolling deploys only (no native blue/green)

**Implementation:**
- `.github/workflows/deploy-frontend.yml` - triggers on index.html, styles.css, app.js changes
- `.github/workflows/deploy-backend.yml` - triggers on server.js, lib/, Dockerfile changes
- OIDC provider must be configured in AWS IAM (see docs/deployment/github-oidc-setup.md)

**Required Secrets:**
- `AWS_ROLE_ARN` - IAM role ARN for GitHub Actions
- `CLOUDFRONT_DISTRIBUTION_ID` - CloudFront distribution ID

**DRR Reference:** `.quint/decisions/DRR-2026-01-15-github-actions-for-ci-cd.md`

**Revisit:** If blue/green deployments become necessary

---

### ADR-008: AWS Bedrock AgentCore for On-Demand Intelligence (2026-01-16, revised 2026-02-09)

**Context:**
- Dashboard needs to answer complex analytical questions interactively:
  1. "What is impacting my OEE?" - Root cause analysis
  2. "What is the status of my equipment?" - Equipment correlation with AI
  3. "Where is wastage coming from?" - Waste attribution
  4. "Why no OEE for Enterprise C?" - Alternative metrics for batch processing
- Existing 30-second Claude loop provides real-time insights but lacks:
  - Multi-step reasoning for complex questions
  - Tool use during analysis
  - Domain specialization per question type
- Enterprise C uses ISA-88 batch processing, not continuous OEE

**Decision:**
- Use **AWS Bedrock AgentCore** — a managed agentic platform (distinct from the older Bedrock Agents service)
- Deploy agents as **Python code via AgentCore Runtime** using the Strands SDK
- Expose backend REST APIs as agent tools via **AgentCore Gateway** (MCP protocol)
- Secure tool access with **Workload Identity** and **Token Vault** (API key credential provider)
- Agent invoked on-demand via `POST /api/agent/chat` with SSE streaming

**AgentCore Components Used:**
| Component | Usage |
|-----------|-------|
| **Runtime** | Serverless agent execution, direct code deploy (`PYTHON_3_10`), public network mode |
| **Gateway** | Converts backend OpenAPI spec into MCP tools, IAM-authenticated |
| **Workload Identity** | Gateway authenticates via `GetWorkloadAccessToken` |
| **Token Vault** | API key credential provider for gateway → backend auth |
| **Observability** | CloudWatch Logs + X-Ray tracing enabled |
| **Memory** | Not used (`NO_MEMORY`) — session context managed in-app |

**Current Agent: Chat** (`agent/chat/src/main.py`):
- Built with **Strands SDK** + `BedrockAgentCoreApp` entrypoint
- Connects to MCP Gateway for factory API tools (OEE, equipment, batch, etc.)
- Optional **Bedrock Knowledge Base** integration for SOP retrieval
- Supports IAM-authenticated MCP in production, plain HTTP locally
- System prompt covers OEE (Enterprise A/B) and ISA-88 batch (Enterprise C)

**Planned Agents** (not yet implemented):
- **Troubleshoot Agent** — Equipment diagnostics with SOP-guided resolution
- **Anomaly Agent** — Continuous trend analysis (may replace or augment the tiered loop in `lib/ai/index.js`)

**Alternatives Considered:**
- Old Bedrock Agents (CfnAgent/Agent constructs, Lambda Action Groups, OpenAPI schemas) → Rejected: AgentCore is the newer, more flexible platform. Strands SDK + MCP Gateway replaces Lambda Action Groups entirely.
- Enhanced Single-Agent Loop → Rejected: Single-turn reasoning insufficient for complex questions. AgentCore provides managed runtime, tool orchestration, and observability out of the box.

**Consequences:**
- ✅ Multi-step reasoning with tool use for complex questions
- ✅ MCP Gateway auto-generates tools from OpenAPI spec (no manual Lambda wiring)
- ✅ Managed serverless runtime — no container orchestration for agents
- ✅ Built-in observability (CloudWatch, X-Ray) without extra infra
- ✅ Workload Identity + Token Vault for secure, credential-free tool access
- ✅ Streaming responses via SSE for real-time chat UX
- ⚠️ Agent deployment via bash script (`Deployment Scripts/deploy-agents.sh`), not CDK
- ⚠️ Only chat agent implemented; troubleshoot and anomaly agents still planned
- ⚠️ AgentCore Memory not yet adopted — potential future enhancement

**Implementation (actual):**
1. Agent source: `agent/chat/src/main.py` (Strands SDK + BedrockAgentCoreApp)
2. Agent prompt: `agent/chat/src/prompt.yaml`
3. Runtime client: `lib/agentcore/runtime.js` (dual-mode: AgentCore SDK or local HTTP)
4. Agent ARNs stored in SSM: `/edgemind/agents/{chat|troubleshoot|anomaly}`
5. Deployment: `Deployment Scripts/deploy-agents.sh` (creates IAM roles, Gateway, deploys agent)
6. Backend endpoint: `POST /api/agent/chat` in `server.js`
7. Frontend: `js/chat.js` (streaming chat panel)

**Correction Note (2026-02-09):**
Original ADR incorrectly described this as "AWS Bedrock Agents with multi-agent collaboration" using Lambda Action Groups, CfnAgent/Agent CDK constructs, and an orchestrator + 4 specialist agents. That describes the older Bedrock Agents service. AWS Bedrock AgentCore is a separate, newer managed platform with its own Runtime, Gateway (MCP), Identity, Memory, Policy, and Observability components. The actual implementation uses AgentCore with the Strands SDK, not the older Bedrock Agents API.

**Revisit:**
- Add troubleshoot and anomaly agents when needed
- Evaluate AgentCore Memory when ready to replace in-app session management
- Consider AgentCore Policy for guardrails on tool invocations
- Move deployment to CDK or GitHub Actions when stabilized

---

### ADR-009: Cost Optimization - Fargate Spot + Single Instance (2026-01-16, revised 2026-02-09)

**Context:**
- Fargate services (Backend, InfluxDB, ChromaDB) used On-Demand pricing
- Backend ran 2 instances for HA (overkill for demo environment)
- AgentCore Runtime is pay-per-use (no idle cost), so agent compute isn't a Fargate concern
- Estimated monthly cost before optimization: ~$135/month (Fargate + ALB + S3)

**Decision:**
- **Fargate Capacity Providers:**
  - InfluxDB + ChromaDB: Use **Fargate Spot** (70% cheaper, tolerable brief interruptions)
  - Backend: Keep On-Demand (user-facing, needs stability)
- **Instance Count:**
  - Backend: Reduce from 2 to 1 (demo environment, HA unnecessary)
- **AgentCore Model:** Chat agent model configured via `BEDROCK_MODEL_ID` env var in deploy script (currently Sonnet)

**Alternatives Considered:**
- Fargate Spot for Backend → Rejected: User-facing service, interruptions unacceptable
- NAT Gateway elimination → Already optimized: using public subnets, no NAT Gateway

**Consequences:**
- ✅ ~40% Fargate cost reduction from Spot pricing on databases
- ✅ Spot interruptions tolerable for databases (EFS persistence)
- ✅ AgentCore Runtime is consumption-based — no idle compute cost for agents
- ⚠️ Single backend instance means no HA during deployments

**Implementation:**
```python
# database_stack.py - Fargate Spot
capacity_provider_strategies=[
    ecs.CapacityProviderStrategy(capacity_provider="FARGATE_SPOT", weight=1),
    ecs.CapacityProviderStrategy(capacity_provider="FARGATE", weight=0, base=0),
]
```

**Correction Note (2026-02-09):**
Original ADR referenced Orchestrator + 4 Specialist agents with Sonnet/Haiku model split. That was based on the incorrect multi-agent architecture from original ADR-008. Actual deployment uses AgentCore Runtime (pay-per-use), so agent model costs are consumption-based, not Fargate-based. Cost optimization is primarily about Fargate Spot for databases and right-sizing backend instances.

**Revisit:**
- If Spot interruptions are problematic, switch databases back to On-Demand
- For production (non-demo), consider 2+ backend instances

---

### ADR-010: Claude Code Agent Workflow (2026-01-28)

**Context:**
- Claude Code has specialized agents for different tasks
- Confusion arose about which agent should diagnose vs implement fixes
- code-reviewer was incorrectly used to both diagnose AND write code

**Decision:**
- **Strict separation of responsibilities:**
  - **Engineers** (python-engineer, typescript-engineer, go-engineer) → WRITE code
  - **code-reviewer** → REVIEW/DIAGNOSE code (never writes production code)
  - **architect** → Plan and approve (never writes implementation code)

**Correct Workflow for Bug Fixes:**
1. **code-reviewer** → Diagnose the root cause
2. **typescript-engineer** (or appropriate language engineer) → Implement the fix
3. **code-reviewer** → Validate the fix

**Correct Workflow for New Features:**
1. **architect** → Design architecture
2. **Engineer** → Implement each module
3. **code-reviewer** → Validate logic
4. **security-reviewer** → Check vulnerabilities (if applicable)
5. **architect** → Final approval

**Consequences:**
- ✅ Clear ownership of tasks
- ✅ Engineers write production-quality code
- ✅ Reviewers focus on quality, not implementation
- ⚠️ May require multiple agent calls for a single task

**Key Rule:** If you're about to have code-reviewer write code, STOP. Use an engineer instead.

---

### ADR-011: Frontend Navigation Bar for Persona-Driven Demo (2026-01-29)

**Context:**
- ProveIt! Conference demo (Feb 15) requires persona-driven storytelling
- Demo scenarios document defines multiple views:
  - COO/Executive: High-level organizational insights (Stefan's current UI)
  - Plant Manager: Line-specific details (Harjat's dashboards via iframe)
- Need seamless transitions between persona contexts during live presentation
- Additional views needed: demo control panel, agent workflow visualization, manufacturing-specific views (filling line, mixing, packaging, palletizing)
- Current frontend is a single-page dashboard with no navigation structure

**Decision:**
- Add a navigation bar to the frontend for switching between persona views and demo features
- Navbar must support:
  1. Persona switching (COO view, Plant Manager view)
  2. Demo control panel access
  3. Navigation to manufacturing-specific views (Harjat's iframed dashboards)
  4. Agent workflow visualization panel
  5. Main dashboard (existing view)

**Alternatives Considered:**
- Tab-based switching within current layout → Rejected: doesn't support iframe embedding or deep navigation
- URL-based routing only → Rejected: not presentation-friendly, requires typing URLs during demo
- Side panel navigation → Rejected: takes horizontal space from dashboard data

**Consequences:**
- ✅ Smooth demo transitions between persona views
- ✅ Natural place to embed Harjat's dashboards via iframe
- ✅ Scalable for future views and features
- ⚠️ Requires restructuring current single-page layout
- ⚠️ Must integrate with existing WebSocket connections across views

**Revisit:** After conference demo to evaluate if views should be separate pages or SPA routes

---

### ADR-012: Demo MQTT Topic Convention — Namespace at Position [1] (2026-01-30)

**Context:**
- Demo engine publishes simulated factory data back to the shared MQTT broker
- Initial implementation prefixed topics with namespace: `concept-reply/Enterprise B/Site1/...`
- Other hackathon participants (e.g., MaintainX) use convention: `Enterprise B/maintainx/Site1/...`
- Namespace as prefix broke the standard topic structure (Enterprise at position [0])

**Decision:**
- Place participant namespace at position [1] after enterprise: `Enterprise B/concept-reply/Site1/area/machine/...`
- Server intercept strips namespace before processing: `topicParts.splice(1, 1)`
- Detection is position-based (`topicParts[1] === DEMO_NS`), not prefix-based

**Alternatives Considered:**
- Namespace as prefix (`concept-reply/Enterprise B/...`) → Rejected: breaks topic structure convention used by all other participants
- Namespace as suffix → Rejected: not how other participants do it
- No namespace (publish as raw enterprise topics) → Rejected: can't distinguish demo data from real factory data

**Consequences:**
- ✅ Follows hackathon convention established by other participants
- ✅ Enterprise remains at position [0] for standard topic parsing
- ✅ Server can detect and strip demo namespace cleanly
- ⚠️ Requires all demo topic strings to be restructured (11 scenarios + 4 engine topics)

**Commit:** `70d92d9`

---

### ADR-013: npm Overrides for Transitive Dependency Vulnerabilities (2026-01-30)

**Context:**
- GitHub Actions deploy blocked by `npm audit --audit-level=high` failing on `fast-xml-parser@5.2.5` (CVE: GHSA-37qj-frw5-hhjh)
- Vulnerability is in a transitive dependency: `@aws-sdk/xml-builder` → `fast-xml-parser`
- AWS SDK v3.972.2 (latest) still pins the vulnerable version
- Initial reaction was to bypass audit with `|| true` — user correctly pushed back on this

**Decision:**
- Use npm `overrides` field in `package.json` to force the patched version:
  ```json
  "overrides": {
    "fast-xml-parser": "5.3.4"
  }
  ```
- Keep `npm audit --audit-level=high` strict (no `|| true` bypass)

**Alternatives Considered:**
- `npm audit || true` bypass → Rejected: silences ALL future audit failures, not just this one. User correctly identified this as too aggressive.
- Wait for AWS SDK update → Rejected: blocks all deploys indefinitely. AWS hasn't released a fix yet.
- `--ignore` specific advisory → Rejected: npm doesn't support `--ignore` natively without third-party tools

**Consequences:**
- ✅ Audit gate remains strict — future vulnerabilities will still block
- ✅ Only the specific transitive dependency is overridden
- ✅ Clean audit pass
- ⚠️ Must periodically check if AWS SDK has updated and remove override when no longer needed
- ⚠️ Override could mask breaking changes in fast-xml-parser (low risk — patch version bump)

**Commit:** `97ccfa1`

---

### ADR-014: Frontend Modularization — CSS and JS Split (2026-01-31)

**Context:**
- `styles.css` grew to ~3,869 lines and `app.js` to ~3,368 lines
- Both exceeded the 25k token limit for AI agent file reads
- Single monolithic files made it hard to find and edit specific features
- CSS cascade order matters — can't arbitrarily split without preserving load order

**Decision:**
- Split `styles.css` into 20 CSS files in `css/` directory, loaded via `<link>` tags in cascade order
- Split `app.js` into 15 ES modules in `js/` directory, loaded via `<script type="module">`
- Entry point `js/app.js` imports all modules and exposes functions to `window` for `onclick` handlers
- Shared state via `js/state.js` using object properties (not `let` primitives) for cross-module mutability

**Alternatives Considered:**
- Build tools (Vite, Webpack) → Rejected: project goal is zero build tooling, vanilla JS
- CSS-in-JS → Rejected: not appropriate for vanilla JS project
- Web Components → Rejected: overkill, would require rewriting all existing code

**Consequences:**
- ✅ Each file ~150-300 lines, well within agent read limits
- ✅ Clear separation of concerns (persona views, charts, websocket, etc.)
- ✅ Easy to add new views without touching other files
- ⚠️ 20+ `<link>` tags and `<script type="module">` in `index.html`
- ⚠️ ES modules scope differently — need `window.fn = fn` for HTML onclick handlers
- ⚠️ Must maintain CSS load order (variables first, responsive last)

**Commits:** `f3ae1a2` (CSS), `9f116ba` (JS), `fe37f36` (cleanup)

---

### ADR-015: Persona View Init/Cleanup Pattern (2026-01-31)

**Context:**
- 7 new persona views (3 COO + 4 Plant Manager) each need initialization and teardown
- Views have refresh intervals, chart instances, and event listeners that must be cleaned up
- Views are shown/hidden by toggling `.active` class on `.persona-view` divs

**Decision:**
- Each view module exports `init()` and `cleanup()` functions
- `MutationObserver` in `js/app.js` watches for `.active` class changes on `.persona-view` divs
- When a view becomes active → call `init()` (fetch data, start intervals)
- When a view becomes inactive → call `cleanup()` (clear intervals, destroy charts)
- View modules are self-contained with no cross-view dependencies

**Consequences:**
- ✅ No memory leaks from orphaned intervals or chart instances
- ✅ Views only fetch data when active (no background polling)
- ✅ Easy to add new views — just export init/cleanup
- ⚠️ MutationObserver adds slight complexity vs manual lifecycle management

---

### ADR-016: Tiered Agent Analysis Loop (2026-02-03)

**Context:**
- The agent loop ran every 30 seconds, calling Claude via AWS Bedrock with up to 9 tool calls each time
- This produced ~120 Bedrock API calls/hour — expensive and noisy
- Most calls returned near-identical insights because factory metrics rarely change meaningfully in 30-second windows
- Duplicate work orders were created for the same anomaly
- Operators experienced "alert fatigue" from repetitive insights

**Decision:**
Replace the fixed 30-second analysis interval with a three-tier architecture:

1. **Tier 1 — Cheap Local Delta Detection** (every 2 min, NO AI call):
   - Query InfluxDB for current metrics, compare against in-memory snapshot
   - Only trigger AI analysis when key metrics (OEE, Availability, Performance, Quality) change by ≥5% (configurable)
   - Track equipment state transitions (RUNNING→DOWN, etc.)
   - Cost: $0 per check

2. **Tier 2 — Targeted AI Analysis** (triggered by Tier 1):
   - Called only when Tier 1 detects meaningful changes
   - Focused prompt with specific changes to investigate (not "analyze everything")
   - Max 3 tool calls per analysis (vs 9 previously)
   - Cost: ~$0.01 per call, but called rarely

3. **Tier 3 — Scheduled Comprehensive Summary** (every 15 min):
   - Full analysis regardless of changes, for dashboard freshness
   - Enterprise rotation: cycles through Enterprise A → B → C → Cross-enterprise comparison
   - Max 9 tool calls (same as old system)

4. **Deduplication Cache:**
   - In-memory `Map<string, {timestamp, count, lastInsight}>` with 30-minute TTL
   - Prevents repeated work orders for the same anomaly within the TTL window

**Configuration (env vars):**
- `AGENT_CHECK_INTERVAL_MS` — Tier 1 interval (default: 120000 = 2 min)
- `AGENT_SUMMARY_INTERVAL_MS` — Tier 3 interval (default: 900000 = 15 min)
- `AGENT_CHANGE_THRESHOLD_PCT` — Change threshold to trigger Tier 2 (default: 5%)

**Alternatives Considered:**
- Adaptive intervals (exponential backoff) → Rejected: complex, hard to reason about timing
- ML-based anomaly filtering → Rejected: over-engineered for current scale
- Simply increasing interval to 5 min → Rejected: still wastes calls when nothing changes

**Consequences:**
- ✅ ~95% reduction in Bedrock API calls during stable operation (120/hr → ~6/hr)
- ✅ Faster response to actual anomalies (Tier 2 fires immediately on detection)
- ✅ Dashboard always has fresh content via Tier 3 rotation
- ✅ No duplicate work orders within 30-minute windows
- ✅ Backward compatible — `runTrendAnalysis()` still works for manual invocation
- ⚠️ First run has no previous snapshot, so no Tier 2 until second Tier 1 check
- ⚠️ In-memory dedup cache lost on restart (acceptable for demo system)

**Files Modified:** `lib/state.js`, `lib/ai/index.js`, `server.js`
**Tests Added:** `lib/ai/__tests__/change-detection.test.js` (11 tests)

---

### ADR-017: Bidirectional CESMII SM Profile Support (2026-02-10)

**Context:**
- ProveIt! Conference 2026 (Feb 16-20) requires participants to publish data back to UNS (hard requirement)
- CESMII SM Profiles are "should attempt" (strongly recommended) per CESMII collaboration section
- eukodyne/cesmii reference implementation publishes WorkOrderV1 payloads to MQTT every 10 seconds
- EdgeMind needs to both consume incoming SM Profile payloads AND publish its own data as SM Profile-compliant JSON-LD
- Reference implementation is Python; EdgeMind is Node.js

**Decision:**
- Implement **bidirectional** CESMII SM Profile support:
  - **Consumer (H1):** Detect, validate, and store incoming WorkOrderV1 JSON-LD payloads from MQTT
  - **Publisher (H2):** Publish EdgeMind's own OEE reports and AI insights as custom SM Profile-compliant JSON-LD back to UNS
- Port the Python SM Profile validator from eukodyne/cesmii to Node.js (~500-800 lines)
- Custom profiles use **Method 2: JSON Schema on GitHub** (not CESMII Profile Designer tool)
- New module: `lib/cesmii/` with validator, detector, publisher, and bundled profile schemas
- Bundle existing profiles: WorkOrderV1.jsonld, FeedIngredientV1.jsonld
- Define custom profiles: FactoryInsightV1.jsonld, OEEReportV1.jsonld
- Include CESMII demo publisher fallback in demo engine (in case eukodyne publisher isn't running at conference)

**Alternatives Considered:**
- H3: Lightweight Semantic Layer (skip validation, just detect/display) → Rejected: lacks credibility at a conference focused on SM Profiles
- H4: AI-Powered Profile Interpreter (feed profiles to Claude for semantic reasoning) → Deferred: AI output quality untested (R_eff=0.60), focus on core compliance first. Can be added post-conference.
- Method 1: CESMII Profile Designer → Not used: JSON Schema on GitHub is simpler, officially supported, and sufficient for hackathon

**Rationale (from FPF analysis):**
1. **High confidence:** H1 R_eff=1.00, H2 R_eff=0.90 (weakest link: JSON Schema method documented but no ProveIt vendor example seen)
2. **Publishing is mandatory:** ProveIt 2026 Sponsors Documentation requires publishing data back to UNS — not optional
3. **Validator portable:** Python validator logic (OPC UA type checking) maps cleanly to Node.js — no native dependencies
4. **MQTT already works:** Existing `#` subscription catches eukodyne topics; existing `conceptreply` user can publish
5. **Demo fallback:** Self-contained publisher mitigates risk of eukodyne publisher not running at conference

**Consequences:**
- ✅ Full ProveIt 2026 compliance (consume from + publish to UNS)
- ✅ CESMII collaboration requirement met (SM Profiles implemented)
- ✅ Reusable CESMII module for future SM Profile integrations
- ✅ Self-contained demo fallback for conference reliability
- ⚠️ H4 (AI Profile Interpreter) deferred — misses differentiator opportunity
- ⚠️ JSON Schema method is less formal than Profile Designer registration
- ⚠️ Custom Node.js validator, not official CESMII .NET libraries

**Implementation Plan:**
1. Phase 1: `lib/cesmii/` module — profiles, validator, detector (Day 1-2)
2. Phase 2: Consumer integration — MQTT interception, InfluxDB storage, REST endpoints (Day 2-3)
3. Phase 3: Publisher — custom profiles, JSON-LD wrapper, MQTT publish (Day 3-4)
4. Phase 4: Frontend work orders panel + demo fallback (Day 4-5)
5. Phase 5: Integration testing + demo polish (Day 5-6)

**DRR Reference:** `.fpf/decisions/DRR-001-cesmii-profiles.md`

**Revisit:**
- Add H4 (AI Profile Interpreter) post-conference as enhancement
- Register custom profiles on CESMII Profile Designer (Method 1) if needed for formality
- Expand validator for additional SM Profiles beyond WorkOrderV1

---

### ADR-DRR-001: CESMII SM Profile Integration (2026-02-11)
- **Context:** ProveIt! Conference 2026 requires demonstration of CESMII SM Profile interoperability
- **Decision:** Implemented bidirectional CESMII SM Profile support (H1: Consumer + H2: Publisher). H4 (AI Interpreter) deferred.
- **Approach:** Native JSON-LD consumer with OPC UA type validation (13 types), plus publisher for OEE reports and AI insights
- **Key choices:**
  - Treat JSON-LD as plain JSON (no RDF library) -- sufficient for validation
  - Profile detection via @type + (@context OR profileDefinition) heuristic
  - Non-strict validation by default (store with warnings, don't reject)
  - Publisher topics: `edgemind/oee/{enterprise}/{site}` and `edgemind/insights/{enterprise}`
  - Demo publisher publishes to `Enterprise B/conceptreply/cesmii/WorkOrder`
- **Trade-offs:** No full RDF/SPARQL support, but dramatically simpler implementation. Custom profiles follow CESMII Method 2 format.

---

### ADR-018: Bedrock Cost Optimization — Single-Shot + Nova Lite (2026-02-12)

**Context:**
- Tier 2/3 analysis used Claude Sonnet ($3/$15 per M tokens) for routine OEE summaries
- Tool call loops caused 4-10 Bedrock invocations per analysis (token accumulation)
- Haiku 4.5 and Claude 3.5 Haiku both failed with AWS Marketplace subscription errors
- Need an accessible, cheap model for routine analysis without new Marketplace subscriptions

**Decision:**
- **Phase 1 (PR #51):** Pre-fetch all tool data before AI call, eliminating tool call loops (1 Bedrock call instead of 4-10). Increased Tier 3 interval from 15min to 30min. Added daily token budget circuit breaker.
- **Phase 2 (DRR-002):** Switch tier model to Amazon Nova Lite (`us.amazon.nova-lite-v1:0`) — an Amazon-native model that requires no Marketplace subscription. 61x cheaper per call ($0.00007 vs $0.0044).
- Code changes: `temperature: 0` in Nova inferenceConfig, token tracking handles both snake_case (Claude) and camelCase (Nova) field names.
- Interactive Q&A stays on Claude Sonnet.

**Alternatives Considered:**
- Haiku 4.5 → Rejected: Marketplace subscription required (not subscribed, policy: don't subscribe)
- Claude 3.5 Haiku → Rejected: Also requires Marketplace subscription
- Converse API migration → Rejected: Unnecessary scope, existing Nova adapters already work
- Nova Micro → Rejected: Higher quality risk without testing; Nova Lite already 61x cheaper

**Consequences:**
- ✅ 61x cost reduction per tier analysis call (~$0.10/month vs ~$6.60 with Sonnet)
- ✅ No Marketplace subscription needed (Amazon-native model)
- ✅ ~8 lines of code change total
- ✅ Trivially reversible via `BEDROCK_TIER_MODEL_ID` env var
- ⚠️ Analysis quality may be slightly less nuanced than Sonnet (acceptable for routine analysis)
- ⚠️ N=1 test sample — production is the real test

**FPF Reference:** `.fpf/decisions/DRR-002-nova-lite-tier-model.md`

**Revisit:** If Nova Lite JSON quality proves insufficient (>20% parse failures), or if Haiku becomes subscribed in the AWS account.

---

<!-- Add new decisions above this line -->
