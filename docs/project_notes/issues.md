# Work Log

Completed work and issue tracking. For quick reference - full details live in git history.

## Format

- **Date** (YYYY-MM-DD)
- **Description**: Brief summary
- **Status**: Completed / In Progress / Blocked
- **Commit/PR**: Reference if applicable

---

## Entries

### 2025-01 - Backend Modularization
- **Status**: Completed
- **Description**: Extracted server.js into lib/ modules (config, influx, schema, oee, ai, cmms, demo, vector)
- **Branch**: `refactor/modularization` (merged to main)

### 2026-01-15 - Deployment Scripts ChromaDB Integration
- **Status**: Completed
- **Description**: Full ChromaDB integration across all deployment configurations
- **Changes**:
  - `docker-compose.yml` - Added ChromaDB service with healthcheck, persistence, backend depends_on
  - `docker-compose.local.yml` - Updated to ChromaDB latest, v2 API, correct `/data` mount
  - `local-deploy.sh` - Updated healthcheck to v2 API endpoint
  - `README.md` - Added architecture diagram, updated service descriptions
  - `.env.template` - Added CHROMA_PORT configuration

### 2026-01-15 - ChromaDB EC2 Production Deployment
- **Status**: Completed
- **Description**: ChromaDB deployed to EC2 with persistence and restart policy
- **Changes**:
  - Redeployed ChromaDB with `-v chromadb-data:/data --restart unless-stopped`
  - Added ChromaDB service to `Deployment Scripts/docker-compose.yml`
  - Updated `docker-compose.local.yml` for v2 API healthcheck
  - Updated CLAUDE.md with ChromaDB EC2 docs
  - Updated key_facts.md and README.md

### 2025-01 - ChromaDB RAG Integration
- **Status**: Completed
- **Description**: Added vector database for anomaly persistence and semantic search
- **Commit**: `5545772`

### 2025-01 - Sparkplug B Protocol Support
- **Status**: Completed
- **Description**: Universal MQTT ingestion with Sparkplug B decoder
- **Commit**: `e50c223`

### 2025-01 - AI Improvements
- **Status**: Completed
- **Description**: Memory injection, settings page, anomaly reasoning
- **Commit**: `d72abb7`

### 2025-01 - Security & Code Quality Fixes
- **Status**: Completed
- **Description**: Critical security and code quality issues
- **Commit**: `efe60b4`

### 2026-01-30 - OEE Calculation Fix + AVEVA Normalization
- **Status**: Completed
- **Description**: Fixed OEE discrepancy between dashboard card (76.4%) and AI insights (60.8%). Legacy `queryOEE()` blended A/P/Q/OEE into single mean. Redirected all legacy endpoints to v2 tier-based system. Added enterprise/site alias normalization for AVEVA-prefixed names. Fixed 5 critical bugs: normalizeTag null crash, totalOee NaN poisoning, Tier 2 truthiness (0% treated as null), queryOEE('ALL') including null enterprises.
- **Commit**: `fafaee4`
- **Files**: `lib/influx/writer.js`, `lib/oee/index.js`

### 2026-01-30 - Dockerfile CSS/JS Directory Fix
- **Status**: Completed
- **Description**: Docker build failed because Dockerfile still referenced `styles.css` and `app.js` (deleted during CSS/JS modularization). Updated to `COPY css/ ./css/` and `COPY js/ ./js/`.
- **Commit**: `4a18841`
- **Files**: `Dockerfile`

### 2026-01-30 - Persona Sub-Nav Race Condition Fix
- **Status**: Completed
- **Description**: Menu items disappeared on persona switch. `incrementSwitchCounter()` called inside setTimeout guards caused counter to always mismatch. Fixed to read-only comparison.
- **Commit**: `31df780`
- **Files**: `js/persona.js`

### 2026-01-30 - URL Hash Persona Persistence
- **Status**: Completed
- **Description**: Page always reset to COO on refresh. Added hash-based persistence (`#coo`, `#plant`, `#demo`) with write-on-switch, read-on-init, and hashchange listener.
- **Commit**: `7c1c00c`
- **Files**: `js/persona.js`

### 2026-01-30 - Restore Production Line OEE Styles
- **Status**: Completed
- **Description**: ~170 lines of CSS dropped during modularization. Created `css/line-oee.css` from git history, added import in `index.html`.
- **Commit**: `a6f999b`
- **Files**: `css/line-oee.css` (new), `index.html`

### 2026-01-30 - Wire Production Heatmap to Enterprise Filter
- **Status**: Completed
- **Description**: `/api/factory/status` never read `req.query.enterprise`. Added parameter validation and conditional Flux filter to `queryFactoryStatus()`.
- **Commit**: `cc0c662`
- **Files**: `server.js`, `lib/oee/index.js`

### 2026-01-30 - Restructure Demo Topics to Hackathon Convention
- **Status**: Completed
- **Description**: Demo topics used `concept-reply/Enterprise B/...` but convention is `Enterprise B/concept-reply/...` (namespace at position [1]). Restructured all 11 scenario topics + 4 engine topics + server intercept logic.
- **Commit**: `70d92d9`
- **Files**: `lib/demo/scenarios.js`, `lib/demo/engine.js`, `server.js`

### 2026-01-30 - Fix MQTT Reconnect Storm
- **Status**: Completed
- **Description**: No stable clientId caused constant reconnection. `on('connect')` re-initialized everything on each reconnect, spawning duplicate trend analysis loops → Bedrock 429 throttling → InfluxDB timeouts. Added stable clientId, `initialized` guard, QoS 1 for demo publishes.
- **Commit**: `dbeded3`
- **Files**: `server.js`, `lib/demo/engine.js`

### 2026-01-30 - npm Override for fast-xml-parser Vulnerability
- **Status**: Completed
- **Description**: `npm audit --audit-level=high` blocked deploy due to `fast-xml-parser@5.2.5` vulnerability in AWS SDK transitive dependency. AWS SDK hasn't updated yet. Added npm `overrides` to force `5.3.4`. Reverted initial `|| true` audit bypass.
- **Commit**: `97ccfa1`
- **Files**: `package.json`, `.github/workflows/deploy.yml`

### 2026-01-30 - Known Issue: InfluxDB Type Conflict
- **Status**: In Progress
- **Description**: `sub_HV_250_001_PV` field type conflict (float vs string). Writer doesn't unwrap JSON strings or maintain a type registry. Root cause identified by code-reviewer but fix not yet implemented.
- **Files**: `lib/influx/writer.js`

### 2026-01-31 - Frontend Modularization (CSS + JS)
- **Status**: Completed
- **Description**: Monolithic `styles.css` (~3,869 lines) split into 20 CSS files in `css/`. Monolithic `app.js` (~3,368 lines) split into 15 ES modules in `js/`. Files exceeded 25k token agent read limits.
- **Commits**: `f3ae1a2` (CSS), `9f116ba` (JS), `fe37f36` (cleanup)
- **Files**: `css/*.css` (20 files), `js/*.js` (15 files), `index.html`, `deploy.yml`, `CLAUDE.md`

### 2026-01-31 - Build 7 Remaining Persona Views
- **Status**: Completed
- **Description**: Built 3 COO views (Enterprise Comparison, Trend Analysis, Agent Q&A) and 4 Plant Manager views (Line Status, OEE Drill-down, Equipment Health, Alerts & Work Orders). Used git worktree on feature/remaining-views branch, merged to dev.
- **Commits**: `52481f0` (views), `1abb270` (comments), `23e4cfa` (ESLint fixes)
- **Files**: `js/coo-*.js` (3), `js/plant-*.js` (4), `css/coo-views.css`, `css/plant-views.css`, `index.html`

### 2026-02-02 - Enable CMMS (MaintainX) on Dev Environment
- **Status**: Completed
- **Description**: CMMS integration was disabled on EC2 dev instance. Root cause: docker-compose didn't map CMMS env vars to container. Also fixed env var typo (CMMS_ENABLE → CMMS_ENABLED).
- **Commit**: `79f5c09`
- **Files**: `deploy/docker-compose.yml`, `Deployment Scripts/docker-compose.yml`

### 2026-02-02 - Fix MaintainX API Integration (3 Bugs)
- **Status**: Completed
- **Description**: Three cascading bugs in MaintainX provider: (1) URL construction dropped `/v1` base path → 404, (2) unsupported `sort` query param → 500, (3) invalid payload fields (`status`, `customFields`) + wrong priority value (`URGENT`) → 400. All fixed and regression tests added (48 tests).
- **Commits**: `c74d8fc` (URL fix), `096aa57` (sort param), `86a328b` (payload), `ee63a0a` (tests)
- **Files**: `lib/cmms-maintainx.js`, `lib/__tests__/cmms-maintainx.test.js` (new)

### 2026-02-02 - Pin GitHub Actions Runners to ubuntu-24.04
- **Status**: Completed
- **Description**: Repeated runner pickup delays with `ubuntu-latest`. Pinned all 3 workflows to `ubuntu-24.04`.
- **Commit**: `65e8219`
- **Files**: `.github/workflows/deploy.yml`, `.github/workflows/deploy-backend.yml`, `.github/workflows/deploy-frontend.yml`

### 2026-02-11 - CESMII SM Profile Integration
- **Status**: Completed
- **Description**: Full bidirectional CESMII SM Profile support
- **Files:** 10 new files (lib/cesmii/*, css/cesmii.css, js/cesmii.js, 3 test files), 9 modified files
- **Tests:** 369 tests passing (11 suites), 3 new CESMII test files
- **Features:** JSON-LD detection, OPC UA validation (13 types), MQTT interception, InfluxDB storage, WebSocket broadcast, REST APIs, frontend panel, OEE/insight publisher, demo work order publisher
- **Branch:** feature/cesmii

### 2026-02-12 - Bedrock Cost Optimization (PR #51)
- **Status**: Completed
- **Description**: Single-shot Bedrock calls (pre-fetch tool data, eliminate tool loops), Tier 3 interval 15min→30min, daily token budget circuit breaker, log noise reduction (`console.debug` suppression), CESMII ignored profile types config.
- **PR**: #51 (merged to dev)
- **Branch**: feature/cost-optimization

### 2026-02-12 - Tier Model Marketplace Subscription Errors
- **Status**: Completed
- **Description**: Haiku 4.5 and Claude 3.5 Haiku both failed with AWS Marketplace subscription errors ("Model access is denied"). Amazon-native models (Nova) don't require subscriptions. Temporarily set tier model to Sonnet as fallback.
- **Root cause**: Anthropic models on Bedrock require Marketplace subscription; policy is to not subscribe to new models.
- **Branch**: dev

### 2026-02-12 - DRR-002: Switch Tier Model to Nova Lite
- **Status**: Completed
- **Description**: FPF reasoning cycle confirmed Nova Lite works via InvokeModelCommand. 3 code changes: (1) `temperature: 0` in Nova inferenceConfig, (2) token tracking handles both camelCase and snake_case, (3) default tierModelId → `us.amazon.nova-lite-v1:0`. 61x cheaper per call.
- **FPF Reference**: `.fpf/decisions/DRR-002-nova-lite-tier-model.md`
- **Files**: `lib/config.js`, `lib/ai/index.js`
- **Branch**: dev

<!-- Add new entries above this line -->
