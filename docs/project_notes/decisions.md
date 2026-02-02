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

### ADR-008: AWS AgentCore Multi-Agent Architecture (2026-01-16)

**Context:**
- Dashboard needs to answer complex analytical questions:
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
- Implement **AWS Bedrock Agents with multi-agent collaboration**
- Deploy 4 specialized agents:
  - **OEE Analyst Agent**: A×P×Q understanding, limiting factor identification
  - **Equipment Health Agent**: State monitoring, downtime tracking, maintenance prediction
  - **Waste Attribution Agent**: Defect patterns, root cause analysis by line
  - **Batch Process Agent**: Enterprise C ISA-88 metrics, phase tracking, yield rates
- Orchestrator agent routes questions to specialists
- Triggered on-demand via `/api/agent/ask` endpoint (not continuous loop)
- ChromaDB provides shared memory for agent context

**Alternatives Considered:**
- Enhanced Single-Agent Loop → Rejected: User chose multi-agent despite lower complexity option. Single-turn reasoning insufficient for complex questions.
- Hybrid Simple Loop + On-Demand Agents → Rejected: User explicitly chose full AgentCore over incremental approach.

**Rationale (from Quint FPF analysis):**
1. **R_eff: 1.00** - All validation checks passed
2. **Multi-agent GA (March 2025)**: AWS Blog confirms production-ready
3. **CDK Support**: Both CfnAgent (L1) and Agent (L2) constructs available
4. **Lambda Action Groups**: Well-documented tool execution pattern
5. **Pricing**: Consumption-based, no per-invocation charge for InvokeAgent

**Consequences:**
- ✅ Multi-step reasoning for complex questions
- ✅ Specialized domain knowledge per agent
- ✅ Tool use during analysis (InfluxDB queries, ChromaDB retrieval)
- ✅ Scalable architecture for future question types
- ⚠️ 4-5 day implementation timeline (tight for demo)
- ⚠️ New infrastructure: Lambdas, IAM roles, OpenAPI schemas
- ⚠️ Debugging complexity with multiple agents

**Implementation:**
1. Create `infra/stacks/agentcore_stack.py` CDK stack
2. Create Lambda Action Group functions (`lib/agentcore/tools.js` or Python)
3. Define OpenAPI schemas for tools
4. Add `/api/agent/ask` endpoint to `server.js`
5. Build frontend chat panel for "Ask Agent" UI

**Fallback:**
If blocked, can pivot to enhanced-single-agent-loop in 1-2 days.

**DRR Reference:** `.quint/decisions/DRR-2026-01-16-aws-agentcore-multi-agent-architecture-for-edgemind-intelligence.md`

**Revisit:** When AgentCore Memory becomes GA or if demo timeline requires simplification

---

### ADR-009: Cost Optimization - Haiku Specialists + Fargate Spot (2026-01-16)

**Context:**
- Initial AgentCore deployment used Claude Sonnet for all 5 agents
- Fargate services (Backend, InfluxDB, ChromaDB) used On-Demand pricing
- Backend ran 2 instances for HA (overkill for demo environment)
- Estimated monthly cost: ~$250/month

**Decision:**
- **AgentCore Model Selection:**
  - Orchestrator: Keep **Claude Sonnet** (needs reasoning for routing decisions)
  - 4 Specialists: Switch to **Claude Haiku** (~75% cheaper, sufficient for domain-specific tasks)
- **Fargate Capacity Providers:**
  - InfluxDB + ChromaDB: Use **Fargate Spot** (70% cheaper, tolerable brief interruptions)
  - Backend: Keep On-Demand (user-facing, needs stability)
- **Instance Count:**
  - Backend: Reduce from 2 to 1 (demo environment, HA unnecessary)

**Alternatives Considered:**
- All agents on Haiku → Rejected: Orchestrator needs better reasoning for routing
- All agents on Sonnet → Rejected: Specialists don't need reasoning, just domain knowledge
- Fargate Spot for Backend → Rejected: User-facing service, interruptions unacceptable
- NAT Gateway elimination → Already optimized: using public subnets, no NAT Gateway

**Cost Analysis:**

| Component | Before | After | Savings |
|-----------|--------|-------|---------|
| Bedrock AI (50 q/day) | $115/mo | ~$35/mo | 70% |
| Fargate Backend | $43.80/mo | $21.90/mo | 50% |
| Fargate InfluxDB | $21.90/mo | ~$6.60/mo | 70% |
| Fargate ChromaDB | $8.95/mo | ~$2.70/mo | 70% |
| Other (ALB, S3, etc.) | $60/mo | $60/mo | 0% |
| **TOTAL** | **~$250/mo** | **~$127/mo** | **~49%** |

**Consequences:**
- ✅ ~49% cost reduction (~$123/month saved)
- ✅ Specialists still effective for domain-specific tasks
- ✅ Spot interruptions tolerable for databases (EFS persistence)
- ⚠️ Haiku may produce less nuanced responses than Sonnet
- ⚠️ Spot interruptions cause brief database unavailability (~2 min recovery)
- ⚠️ Single backend instance means no HA during deployments

**Implementation:**
```python
# agentcore_stack.py
ORCHESTRATOR_MODEL = "anthropic.claude-3-5-sonnet-20241022-v2:0"
SPECIALIST_MODEL = "anthropic.claude-3-5-haiku-20241022-v1:0"

# database_stack.py - Fargate Spot
capacity_provider_strategies=[
    ecs.CapacityProviderStrategy(capacity_provider="FARGATE_SPOT", weight=1),
    ecs.CapacityProviderStrategy(capacity_provider="FARGATE", weight=0, base=0),
]
```

**Revisit:**
- If Haiku responses are insufficient, upgrade specific specialists to Sonnet
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

<!-- Add new decisions above this line -->
