# Key Facts

Project configuration, constants, and frequently-needed reference information.

**NEVER store passwords, API keys, or sensitive credentials here.** This file is committed to git.

---

## Project Overview

- **Name**: EdgeMind (Factory Intelligence Dashboard)
- **Event**: ProveIt! Conference 2026
- **Purpose**: Real-time factory monitoring with AI-powered anomaly detection

---

## Infrastructure

### Hybrid ECS + S3/CloudFront Architecture (ADR-006)
- **Frontend**: S3 + CloudFront (static files)
- **Backend**: ECS Fargate behind ALB
- **Cluster**: `edgemind-prod-cluster`
- **IaC**: AWS CDK Python (`/infra/` directory)
- **CI/CD**: GitHub Actions (`.github/workflows/`)
- **AWS Profile**: `reply`

#### ⚠️ DEPLOYMENT RULES (IMPORTANT)
1. **NEVER manually fix production** - Always use CI/CD or CDK templates
2. **Push to feature branch** → Create PR to `main` → Merge triggers deploy
3. GitHub Actions pipeline triggers on push to `main` only (production)
4. EC2 instance is **active** - used as dev/staging environment
5. `deploy.yml` deploys to EC2 on push to `dev` and feature branches (dev environment)
6. `deploy-backend.yml` + `deploy-frontend.yml` deploy to ECS Fargate + S3/CloudFront on push to `main` (production)

#### CDK Stacks
| Stack | Purpose |
|-------|---------|
| `edgemind-prod-network` | VPC, security groups |
| `edgemind-prod-secrets` | MQTT, InfluxDB secrets |
| `edgemind-prod-database` | InfluxDB + ChromaDB on Fargate |
| `edgemind-prod-backend` | Node.js backend + ALB |
| `edgemind-prod-frontend` | S3 + CloudFront |
| `edgemind-prod-agentcore` | Bedrock Agents multi-agent system |

#### Deploy Commands (CDK only)
```bash
cd infra && source .venv/bin/activate
cdk deploy --all --profile reply
```

### Docker Container
- **ECR Image**: `718815871498.dkr.ecr.us-east-1.amazonaws.com/edgemind-prod-backend:latest`

#### Local Development: Frontend Live Reload (PR #9)
`docker-compose.local.yml` mounts frontend files for hot reload without rebuild.
Note: Frontend was modularized — `styles.css` → `css/` directory, `app.js` → `js/` directory.
Dockerfile now uses `COPY css/ ./css/` and `COPY js/ ./js/`.

### InfluxDB
- **Local Port**: `8086`
- **Username**: `admin`
- **Organization**: `proveit`
- **Bucket**: `factory`
- **Token Location**: Environment variable `INFLUXDB_TOKEN` or hardcoded for dev

### ChromaDB
- **Local Port**: `8000`
- **Fargate Service**: Part of `edgemind-prod-database` stack
- **API Endpoint**: `GET /api/v2/heartbeat`
- **Purpose**: Vector database for anomaly persistence and RAG
- **Backend Env**: `CHROMA_HOST=chromadb` (container name, not localhost)

#### ⚠️ ChromaDB Health Check Pattern (IMPORTANT)
The `chromadb/chroma` image does NOT have `curl`, `wget`, or `python` in PATH. Use bash TCP check:
```bash
# Works in: docker-compose, ECS Fargate - ALL environments
bash -c 'echo > /dev/tcp/localhost/8000'
```
**CDK (ECS):**
```python
health_check=ecs.HealthCheck(
    command=["CMD-SHELL", "bash -c 'echo > /dev/tcp/localhost/8000'"],
    interval=Duration.seconds(30),
    timeout=Duration.seconds(5),
    retries=3,
    start_period=Duration.seconds(60)
)
```
**docker-compose:**
```yaml
healthcheck:
  test: ["CMD-SHELL", "bash -c 'echo > /dev/tcp/localhost/8000'"]
  interval: 30s
  timeout: 5s
  retries: 3
```

---

## MQTT Configuration

### Virtual Factory Broker
- **Host**: `virtualfactory.proveit.services`
- **Port**: `1883`
- **Full URL (for secrets)**: `mqtt://virtualfactory.proveit.services:1883` *(include protocol + port!)*
- **Topic Pattern**: `Enterprise {A|B|C}/Site{N}/area/machine/component/metric/type`
- **Read-only Username**: `proveitreadonly` (default in config.js)
- **Write Username**: `conceptreply` (set via `MQTT_USERNAME` env var)
- **Secrets Manager Key**: `edgemind/mqtt` (contains host, username, password as JSON)

#### Hackathon Publish Convention (IMPORTANT)
Participant namespace goes at position [1] after enterprise:
```
Enterprise B/concept-reply/Site1/area/machine/component/metric/type
```
- Position [0] = Enterprise (standard topic structure)
- Position [1] = Participant namespace (`concept-reply`, `maintainx`, etc.)
- Position [2+] = Standard topic hierarchy
- Server strips namespace before processing: `topicParts.splice(1, 1)`
- Config: `CONFIG.demo.namespace = 'concept-reply'`

#### MQTT Client Requirements
- **Stable clientId**: `edgemind-${hostname}-${pid}` — prevents reconnect storms
- **`clean: false`**: Preserves session across reconnects
- **QoS 1**: Required for demo publishes (QoS 0 silently drops on reconnect)
- **Connect handler guard**: Must use `initialized` flag to prevent duplicate initialization on reconnect

⚠️ **MQTT_HOST Secret Format**: Must include `mqtt://` protocol prefix AND port number. Without these, the MQTT client will fail with "Missing protocol" error.

---

## API Endpoints (Local Development)

### Server
- **Port**: `3000`
- **Health**: `GET /health`
- **Trends**: `GET /api/trends`
- **OEE v2**: `GET /api/oee/v2?enterprise={ALL|Enterprise A|Enterprise B|Enterprise C}`
- **Schema Hierarchy**: `GET /api/schema/hierarchy`
- **Schema Measurements**: `GET /api/schema/measurements`
- **OEE Discovery**: `GET /api/oee/discovery`

---

## Key Configuration Values

### Timing
- **Tier 1 Delta Check**: 120,000ms (2 minutes) — env: `AGENT_CHECK_INTERVAL_MS`
- **Tier 3 Summary Interval**: 900,000ms (15 minutes) — env: `AGENT_SUMMARY_INTERVAL_MS`
- **Change Threshold**: 5% — env: `AGENT_CHANGE_THRESHOLD_PCT`
- **Anomaly Cache TTL**: 30 minutes (dedup window for work orders)
- **WebSocket Throttle**: Every 10th MQTT message
- **Schema Cache TTL**: 5 minutes
- **Trend Query Window**: 5 minutes (1-min aggregates)

### Agent Analysis Tiers (ADR-016)
The agent loop uses a three-tier architecture to minimize cost while maximizing insight quality:

| Tier | Purpose | Interval | AI Call? | Tool Budget |
|------|---------|----------|----------|-------------|
| **Tier 1** | Delta detection | 2 min | No | 0 |
| **Tier 2** | Targeted analysis | On-demand | Yes | 3 |
| **Tier 3** | Comprehensive summary | 15 min | Yes | 9 |

**Tier 1** queries InfluxDB and compares OEE/Availability/Performance/Quality per enterprise against a previous snapshot. Only triggers Tier 2 when a metric changes by ≥5%.

**Tier 2** sends Claude a focused prompt with the specific changes to investigate. Uses 3 tool calls max.

**Tier 3** cycles enterprise focus: Enterprise A → Enterprise B → Enterprise C → Cross-enterprise comparison.

**Anomaly Dedup**: `Map<string, {timestamp, count}>` with 30-min TTL prevents duplicate work orders.

**Expected Cost**: ~6 Bedrock calls/hour during stable operation (vs 120 previously).

### OEE Tiers
- **Tier 1**: Direct OEE measurement (highest confidence)
- **Tier 2**: Calculated from A/P/Q components
- **Tier 3**: Estimated from related metrics

### OEE Measurement Naming Conventions (IMPORTANT)
OEE measurements use TWO naming conventions depending on enterprise/source:

| Convention | Enterprise | Examples |
|------------|------------|----------|
| `OEE_*` | Enterprise A (Glass) | `OEE_Availability`, `OEE_Performance`, `OEE_Quality` |
| `metric_*` | Enterprise B (Beverage) | `metric_availability`, `metric_performance`, `metric_quality`, `metric_oee` |

**Always query BOTH conventions** in InfluxDB:
```flux
r._measurement == "OEE_Availability" or r._measurement == "metric_availability"
```

**Value normalization pattern** (handles both decimal 0-1 and percentage 0-100):
```javascript
const normalize = (val) => {
  if (val === undefined || val === null) return null;
  if (val > 0 && val <= 1.5) val = val * 100;  // Convert decimal to percentage
  return parseFloat(Math.min(100, Math.max(0, val)).toFixed(1));
};
```

**Calculate OEE from components** when direct measurement unavailable:
```javascript
if (oee === null && availability && performance && quality) {
  oee = (availability/100) * (performance/100) * (quality/100) * 100;
}
```

---

## CMMS Integration (MaintainX)

### Configuration
- **Provider**: MaintainX (`https://api.getmaintainx.com/v1`)
- **Enable**: Set `CMMS_ENABLED=true` in `.env`
- **API Key**: Set `MAINTAINX_API_KEY` in `.env`
- **Auto Work Orders**: Created automatically when AI detects `high` severity anomalies (30s analysis loop)
- **Valid Priority Values**: `NONE`, `LOW`, `MEDIUM`, `HIGH` (NOT `URGENT`)
- **API Accepts**: Only `title`, `description`, `priority` fields for work order creation

### Docker-Compose CMMS Env Vars (IMPORTANT)
All CMMS env vars must be explicitly listed in docker-compose `environment:` section:
```yaml
- CMMS_ENABLED=${CMMS_ENABLED:-false}
- CMMS_PROVIDER=${CMMS_PROVIDER:-maintainx}
- MAINTAINX_API_KEY=${MAINTAINX_API_KEY:-}
```
Docker `.env` vars are NOT auto-forwarded to containers.

### URL Construction Gotcha
`new URL('/path', 'https://host/v1')` drops `/v1` because leading `/` resolves from origin root. Must normalize:
```javascript
const base = this.baseUrl.endsWith('/') ? this.baseUrl : this.baseUrl + '/';
const cleanPath = path.startsWith('/') ? path.slice(1) : path;
```

---

## Dev Environment (EC2)

- **Host**: `18.232.156.144`
- **SSH**: `ssh -i ~/.ssh/edgemind-demo.pem ec2-user@18.232.156.144`
- **App Dir**: `/home/ec2-user/app`
- **Dev URL**: `https://dev.edge-mind.concept-reply-sandbox.com`
- **Deploy**: Push to `dev` branch triggers `deploy.yml` → ECR build → SSM deploy to EC2
- **Logs**: `docker-compose logs -f edgemind-backend`

---

## Testing

- **Framework**: Jest
- **Run**: `npm test`
- **Test Suites**: 11 (validation, influx writer, OEE calculation x2, CMMS MaintainX, change detection, CESMII validator, CESMII handler, CESMII publisher, trends, SPC)
- **Total Tests**: 407

---

## Git Workflow

- **Main Branch**: `main` (production deploys to ECS Fargate + S3/CloudFront)
- **Dev Branch**: `dev` (dev deploys to EC2 via SSM)
- **Commit Convention**: No `Co-Authored-By` lines
- **CI Runners**: Pinned to `ubuntu-24.04` (not `ubuntu-latest` — avoids runner pickup delays)

---

## Environment Variables

### Required
- `INFLUXDB_ADMIN_PASSWORD` - InfluxDB admin password
- `INFLUXDB_ADMIN_TOKEN` - InfluxDB API token
- `MQTT_USERNAME` - MQTT broker username (use `conceptreply` for write access)
- `MQTT_PASSWORD` - MQTT broker password

### Optional
- `PORT` - HTTP server port (default: 3000)
- `AWS_REGION` - AWS region for Bedrock (default: us-east-1)
- `AWS_PROFILE` - AWS profile for credentials
- `DISABLE_INSIGHTS` - Set to 'true' to disable AI analysis loop
- `AGENT_CHECK_INTERVAL_MS` - Tier 1 delta check interval (default: 120000 = 2 min)
- `AGENT_SUMMARY_INTERVAL_MS` - Tier 3 summary interval (default: 900000 = 15 min)
- `AGENT_CHANGE_THRESHOLD_PCT` - % change to trigger Tier 2 analysis (default: 5)
- `CHROMA_HOST` - ChromaDB hostname (default: localhost, use 'chromadb' in Docker)
- `CHROMA_PORT` - ChromaDB port (default: 8000)

### AI Configuration (IMPORTANT)
- **Uses AWS Bedrock** - NOT direct Anthropic API
- **No ANTHROPIC_API_KEY needed** - Uses IAM role permissions
- Backend uses `@aws-sdk/client-bedrock-runtime` which authenticates via IAM
- Task role needs `bedrock:InvokeModel` permission on `anthropic.claude-*` AND `amazon.nova-*` models
- **Primary model** (interactive Q&A): Claude Sonnet (`us.anthropic.claude-sonnet-4-20250514-v1:0`)
- **Tier model** (routine Tier 2/3 analysis): Amazon Nova Lite (`us.amazon.nova-lite-v1:0`) — 61x cheaper, no Marketplace subscription needed
- Tier model configurable via `BEDROCK_TIER_MODEL_ID` env var
- Nova uses camelCase token fields (`inputTokens`/`outputTokens`), Claude uses snake_case (`input_tokens`/`output_tokens`) — code handles both

⚠️ **Bedrock IAM Pattern (Cross-Region)**: Inference profiles route to models in different regions. The IAM policy must use wildcard region (`arn:aws:bedrock:*::foundation-model/...`) to allow cross-region inference. See `backend_stack.py` for the full pattern.

### GitHub Actions CI/CD
- **OIDC Provider**: `https://token.actions.githubusercontent.com`
- **IAM Role**: `github-actions-edgemind` (in AWS account)
- **Required Secrets** (GitHub repo settings):
  - `AWS_ROLE_ARN` - ARN of the IAM role for OIDC auth
  - `CLOUDFRONT_DISTRIBUTION_ID` - CloudFront distribution ID for cache invalidation
- **Workflows**:
  - `.github/workflows/deploy-frontend.yml` - S3 sync + CloudFront invalidation (production, triggers on `main`)
  - `.github/workflows/deploy-backend.yml` - ECR build + ECS deploy (production, triggers on `main`)
  - `.github/workflows/deploy.yml` - ECR build + EC2 deploy via SSM (dev, triggers on `dev` and feature branches)

---

## Important URLs

### Production (Fargate + CloudFront)
- **Production Dashboard**: https://edge-mind.concept-reply-sandbox.com
- **Health Check**: https://edge-mind.concept-reply-sandbox.com/health

### Documentation
- **CLAUDE.md**: Project instructions for AI assistants
- **IMPLEMENTATION_CHECKLIST.md**: Refactoring progress tracker

---

## Documentation Wiki Structure

**IMPORTANT**: Always check and update these docs when making architectural changes.

### Location: `docs/`

| File/Folder | Purpose | Update When |
|-------------|---------|-------------|
| `docs/architecture-diagram.md` | Main architecture overview with ASCII diagrams | Adding new components/services |
| `docs/edgemind_architecture.mmd` | Mermaid diagram source (renders to PNG) | Adding new data flows |
| `docs/architecture/` | C4 model documentation (context → components) | Architectural changes |
| `docs/architecture/1-context.md` | System context (external actors) | New integrations |
| `docs/architecture/2-containers.md` | Container diagram (runtime units) | New services/containers |
| `docs/architecture/3-components.md` | Component breakdown (internal modules) | New modules in lib/ |
| `docs/architecture/4-data-flows.md` | Data flow sequences | New API patterns |
| `docs/project_notes/` | Project memory (bugs, decisions, facts) | Always |
| `docs/deployment/` | Deployment guides | Infrastructure changes |

### Architecture Diagram Files
- `docs/edgemind_architecture.mmd` - Mermaid source
- `docs/edgemind_architecture.png` - Generated PNG
- `docs/edgemind_architecture.html` - Interactive HTML version
- `docs/generate_architecture_diagram.py` - Python script to regenerate

### When to Update Docs
1. **New CDK stack** → Update `architecture-diagram.md`, `2-containers.md`
2. **New API endpoint** → Update `3-components.md`, `4-data-flows.md`
3. **New integration** → Update `1-context.md`, main diagram
4. **Bug fix** → Log in `project_notes/bugs.md`
5. **Architecture decision** → Log in `project_notes/decisions.md`

---

## AgentCore (Bedrock Agents Multi-Agent System)

### Agents
| Agent | ID Pattern | Model | Purpose |
|-------|------------|-------|---------|
| Orchestrator | `edgemind-orchestrator` | **Sonnet** | Supervisor - routes to specialists |
| OEE Analyst | `edgemind-oee-analyst` | Haiku | OEE analysis (Enterprise A/B only) |
| Equipment Health | `edgemind-equipment-health` | Haiku | Equipment state monitoring |
| Waste Analyst | `edgemind-waste-analyst` | Haiku | Defect/waste attribution |
| Batch Process | `edgemind-batch-process` | Haiku | ISA-88 batch metrics (Enterprise C only) |

**Model Strategy:** Orchestrator uses Sonnet for routing reasoning. Specialists use Haiku for cost efficiency (~75% cheaper).

### Deployed Agent IDs (us-east-1)
- Orchestrator: `HRR41EHLP7` / Alias: `YTCP5LUQFT`
- OEE Analyst: `8ERJAT0AWU`
- Equipment Health: `4WDR8HDNQJ`
- Waste Analyst: `D6BAMMCTET`
- Batch Process: `2GEE5FJYKD`

### Environment Variables
- `AGENTCORE_AGENT_ID` - Orchestrator agent ID (`HRR41EHLP7`)
- `AGENTCORE_ALIAS_ID` - Orchestrator alias ID (`YTCP5LUQFT`)

### API Endpoints
- `POST /api/agent/ask` - Proxy questions to orchestrator
- `GET /api/agent/health` - AgentCore availability check

### CDK Files
- `infra/stacks/agentcore_stack.py` - Main CDK stack
- `infra/agent_instructions/*.txt` - Agent prompts (5 files)
- `infra/schemas/tools.yaml` - OpenAPI tool definitions

### Key Design Decision
**Enterprise C uses batch processing (ISA-88), NOT OEE.** The Batch Process agent handles Enterprise C queries with batch terminology (yield, phase progress, batch completion) instead of OEE metrics.

---

## Cost Optimization (ADR-009)

### Monthly Cost Breakdown (~$127/month)

| Component | Configuration | Cost |
|-----------|---------------|------|
| **Fargate Backend** | 0.5 vCPU, 1GB, 1 instance | $21.90 |
| **Fargate InfluxDB** | 0.5 vCPU, 1GB, Spot | ~$6.60 |
| **Fargate ChromaDB** | 0.25 vCPU, 512MB, Spot | ~$2.70 |
| **Bedrock AI** | Sonnet (orchestrator) + Haiku (specialists) | ~$35 |
| **ALB** | Application Load Balancer | $16.20 |
| **CloudFront** | ~50GB transfer | $4.25 |
| **S3 + EFS + Logs** | Storage | ~$5.50 |
| **TOTAL** | | **~$127/mo** |

### Cost Optimization Applied
1. **Specialists on Haiku** (~75% AI cost reduction)
2. **Fargate Spot for databases** (~70% compute reduction)
3. **Single backend instance** (50% backend reduction)
4. **No NAT Gateway** (using public subnets)

### Cost Monitoring
```bash
# Check Bedrock usage
aws bedrock get-model-invocation-logging-configuration --region us-east-1

# Check Fargate Spot savings
aws ecs describe-services --cluster edgemind-prod-cluster --services edgemind-prod-influxdb
```

## CESMII SM Profiles (ADR-017)

### External References
- **CESMII SM Profile reference repo**: https://github.com/eukodyne/cesmii
- **ProveIt SM Profiles guide**: https://github.com/cesmii/ProveIt-SMProfiles
- **FPF decision record**: `.fpf/decisions/DRR-001-cesmii-profiles.md`

### MQTT Integration
- **eukodyne publisher topic pattern**: `Enterprise B/{username}/cesmii/WorkOrder`
- **Work order frequency**: Every 10 seconds, retained MQTT messages (QoS 1)
- **Enterprise B topic count**: ~3,340 topics, 7-day simulation window

### Bundled SM Profiles
| Profile | Source | Status |
|---------|--------|--------|
| `WorkOrderV1.jsonld` | eukodyne/cesmii | Bundled |
| `FeedIngredientV1.jsonld` | eukodyne/cesmii | Bundled |
| `FactoryInsightV1.jsonld` | Custom (EdgeMind) | Planned |
| `OEEReportV1.jsonld` | Custom (EdgeMind) | Planned |

### Custom Profile Method
- **Method 2: JSON Schema on GitHub** (not CESMII Profile Designer)
- Custom profiles published as `.jsonld` files in GitHub repo
- Can be registered on Profile Designer (Method 1) later if formality needed

### CESMII Integration
- **SM Profile validation:** 13 OPC UA types supported (Boolean, Int16-64, UInt16-64, Float, Double, String, DateTime, UtcTime, Guid)
- **Profiles directory:** lib/cesmii/profiles/ (4 JSON-LD files)
- **Consumer topics:** Subscribes to '#' (catches all CESMII payloads in MQTT stream)
- **Publisher topics:** edgemind/oee/{enterprise}/{site}, edgemind/insights/{enterprise}
- **Demo publisher topic:** Enterprise B/conceptreply/cesmii/WorkOrder
- **CESMII_ENABLED:** Defaults to true (set to 'false' to disable)
- **Validation mode:** Non-strict by default (stores with warnings). Set validationStrict: true in config for rejection.

### Module Structure
```
lib/cesmii/
├── detector.js      # CESMII SM Profile payload detection (JSON-LD)
├── validator.js      # OPC UA type validation for SM Profile payloads
├── handler.js        # MQTT message handling for CESMII payloads
├── publisher.js      # Publish OEE/insights as SM Profile JSON-LD
├── demo-publisher.js # Demo work order publisher for presentations
├── routes.js         # REST API endpoints for CESMII data
└── profiles/         # SM Profile JSON-LD definitions
    ├── WorkOrderV1.jsonld
    ├── FeedIngredientV1.jsonld
    ├── FactoryInsightV1.jsonld
    └── OEEReportV1.jsonld
```

---

## ProveIt! Conference 2026

### Presentation Format
- **Duration**: 45 minutes (30-35 demo + 10-15 Q&A)
- **Date**: Feb 16-20, 2026

### 4 Mandatory Presentation Questions
1. What problem are you solving?
2. How did you solve it?
3. How long did it take?
4. How much did it cost?

### CESMII Requirements
- **Publishing to UNS**: HARD REQUIREMENT (per Sponsors Documentation)
- **SM Profiles**: "Should attempt" (strongly recommended, per CESMII collaboration section)

---

<!-- Add new facts above this line -->
