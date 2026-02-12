# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Real-time factory intelligence dashboard for the ProveIt! Conference 2026. Connects to a virtual factory MQTT broker, stores time-series data in InfluxDB, and uses Claude AI to analyze trends and detect anomalies.

## Architecture

```
MQTT Broker (virtualfactory.proveit.services:1883)
    ↓ (subscribes to '#' - all topics)
Node.js Server (server.js)
    ├── Writes all numeric data to InfluxDB
    ├── Throttled WebSocket broadcast (every 10th message)
    └── Agentic Loop (every 30 seconds):
            ↓
        Queries InfluxDB (5-minute rolling window, 1-min aggregates)
            ↓
        Claude analyzes trends (not raw data)
            ↓
        Broadcasts insights via WebSocket
            ↓
Frontend (index.html) ← WebSocket (port 3000, /ws path)
```

**Key Components:**
- `server.js` - Backend entry point: HTTP routes, MQTT handling, WebSocket server, Claude agentic loop
- `lib/` - Modular backend code (see Backend Modules below)
- `index.html` - Live dashboard with WebSocket connection to backend
- `factory-command-center.html` - Static mockup version (no backend connection)

## Backend Modules (lib/)

The backend is modularized into focused modules:

```
lib/
├── config.js           # Centralized configuration (InfluxDB, MQTT, AI settings)
├── validation.js       # Input validation & sanitization utilities
├── state.js            # Shared state (factoryState, schemaCache, equipmentStateCache)
├── domain-context.js   # Measurement classifications & domain knowledge
├── influx/
│   ├── client.js       # InfluxDB client, writeApi, queryApi, Point
│   └── writer.js       # parseTopicToInflux (MQTT topic -> InfluxDB Point)
├── schema/
│   └── index.js        # refreshSchemaCache, refreshHierarchyCache
├── oee/
│   └── index.js        # OEE discovery, calculation (tier-based), queries
├── ai/
│   └── index.js        # Claude/Bedrock AI: trend analysis, agentic loop
├── cmms-interface.js   # Generic CMMS interface
├── cmms-maintainx.js   # MaintainX CMMS provider implementation
├── cesmii/
│   ├── detector.js      # CESMII SM Profile payload detection (JSON-LD)
│   ├── validator.js      # OPC UA type validation for SM Profile payloads
│   ├── handler.js        # MQTT message handling for CESMII payloads
│   ├── publisher.js      # Publish OEE/insights as SM Profile JSON-LD
│   ├── demo-publisher.js # Demo work order publisher for presentations
│   ├── routes.js         # REST API endpoints for CESMII data
│   └── profiles/         # SM Profile JSON-LD definitions
│       ├── WorkOrderV1.jsonld
│       ├── FeedIngredientV1.jsonld
│       ├── FactoryInsightV1.jsonld
│       └── OEEReportV1.jsonld
```

**Module Dependencies:**
- `config.js` - No dependencies (foundation)
- `validation.js` - No dependencies (foundation)
- `state.js` - No dependencies (foundation)
- `domain-context.js` - No dependencies (foundation)
- `influx/client.js` - Depends on: config
- `influx/writer.js` - Depends on: influx/client
- `schema/index.js` - Depends on: influx/client, state, config, validation, domain-context
- `oee/index.js` - Depends on: influx/client, state, schema, config, validation
- `ai/index.js` - Depends on: influx/client, state, config, domain-context (+ runtime: broadcast, cmms)
- `cesmii/detector.js` - No dependencies (foundation)
- `cesmii/validator.js` - No dependencies (uses fs, path)
- `cesmii/handler.js` - Depends on: cesmii/detector, cesmii/validator, state, config, influx/writer
- `cesmii/publisher.js` - Depends on: config, state
- `cesmii/demo-publisher.js` - Depends on: config
- `cesmii/routes.js` - Depends on: config, state, validation

## Frontend Files

```
index.html           # HTML structure, loads CSS and JS modules
css/                 # Modular CSS (22 files)
├── variables.css    # CSS custom properties, persona themes
├── base.css         # Reset, body, grid/scanline backgrounds
├── animations.css   # All @keyframes
├── layout.css       # Grid, persona-view system
├── command-bar.css  # Top nav, persona chips, sub-nav
├── cards.css        # Card styles, expand/maximize
├── metrics.css      # Metric values, factory selectors
├── stream.css       # Live MQTT stream display
├── ai-agent.css     # Insights panel, anomaly filters
├── scorecard.css    # OEE gauges, health status
├── equipment.css    # Equipment state monitors
├── batch.css        # Batch operations, cleanroom zones
├── quality.css      # Quality metrics panels
├── charts.css       # Chart panels, heatmaps
├── connection.css   # Connection status indicators
├── modals.css       # All modal overlays
├── chat.css         # Chat panel
├── demo.css         # Demo control UI
├── coo-views.css    # COO persona view styles
├── plant-views.css  # Plant Manager persona view styles
├── cesmii.css       # CESMII work order panel styles
├── footer.css       # Footer branding
└── responsive.css   # Media queries
js/                  # ES modules (22 files)
├── app.js           # Entry point: imports all, exposes window globals, init
├── state.js         # Shared state objects and constants
├── utils.js         # escapeHtml, formatMs, utility functions
├── persona.js       # Persona switching, sub-nav, keyboard shortcuts
├── websocket.js     # WebSocket connection, message dispatch
├── charts.js        # Chart.js initialization and updates
├── dashboard-data.js # All data fetching (OEE, equipment, batch, etc.)
├── dashboard-render.js # DOM rendering and update functions
├── insights.js      # Claude insights panel, anomaly filtering
├── stream.js        # MQTT message stream display
├── modals.js        # All modal dialogs
├── chat.js          # Chat panel functionality
├── coo-enterprise.js # COO: Enterprise comparison view
├── coo-trends.js    # COO: Trend analysis with Chart.js charts
├── coo-agent.js     # COO: Agent Q&A with POST /api/agent/ask
├── plant-line-status.js    # Plant Mgr: Line status grid
├── plant-oee-drilldown.js  # Plant Mgr: OEE gauge + charts
├── plant-equipment.js      # Plant Mgr: Filterable equipment grid
├── plant-alerts.js         # Plant Mgr: Alerts + CMMS work orders
├── cesmii.js             # Plant Mgr: CESMII work orders + SM Profiles
├── demo-scenarios.js # Demo scenario launcher
├── demo-inject.js   # Anomaly injection controls
└── demo-timer.js    # Reset controls, presentation timer
```

## Commands

```bash
# Install dependencies
npm install

# Start the server (requires InfluxDB running)
npm start

# Start with auto-reload (development)
npm run dev

# Start InfluxDB (Docker required)
docker run -d --name influxdb -p 8086:8086 \
  -e DOCKER_INFLUXDB_INIT_MODE=setup \
  -e DOCKER_INFLUXDB_INIT_USERNAME=admin \
  -e DOCKER_INFLUXDB_INIT_PASSWORD=proveit2026 \
  -e DOCKER_INFLUXDB_INIT_ORG=proveit \
  -e DOCKER_INFLUXDB_INIT_BUCKET=factory \
  -e DOCKER_INFLUXDB_INIT_ADMIN_TOKEN=proveit-factory-token-2026 \
  influxdb:2.7

# Check server health
curl http://localhost:3000/health

# Query trends API
curl http://localhost:3000/api/trends

# Query schema hierarchy
curl http://localhost:3000/api/schema/hierarchy

# Query schema measurements
curl http://localhost:3000/api/schema/measurements
```

## API Endpoints

### Schema Discovery

- `GET /api/schema/measurements` - Returns all measurements with metadata (count, value type, sample values, enterprises, sites). Cached for 5 minutes.
- `GET /api/schema/hierarchy` - Returns hierarchical topic structure (Enterprise → Site → Area → Machine → Measurements) with data point counts at each level. Cached for 5 minutes.

### Factory Data

- `GET /api/trends` - Returns 5-minute rolling window of factory metrics (1-min aggregates)
- `GET /api/oee?enterprise={A|B|C|ALL}` - Returns 24h average OEE for specified enterprise (legacy)
- `GET /api/oee/breakdown` - Returns 24h OEE breakdown by enterprise
- `GET /api/factory/status` - Returns hierarchical OEE status by enterprise and site

### OEE v2 (Robust Tier-Based System)

- `GET /api/oee/v2?enterprise={ALL|Enterprise A|Enterprise B|Enterprise C}&site={optional}` - Enhanced OEE calculation with tier-based strategy. Returns OEE with calculation metadata (tier, method, confidence, measurements used).
- `GET /api/oee/discovery` - Returns discovered OEE schema for all enterprises, showing available measurements and which tier each enterprise uses

### CMMS (MaintainX Integration)

- `GET /api/cmms/health` - CMMS provider health check (enabled, healthy, provider name)
- `GET /api/cmms/work-orders?limit={N}` - List recent work orders from MaintainX (max 50)
- `GET /api/cmms/work-orders/:id` - Get work order status by ID

### CESMII SM Profiles

- `GET /api/cesmii/work-orders` - List received CESMII work orders. Query: `?limit=50&enterprise=Enterprise+B`
- `GET /api/cesmii/profiles` - List bundled SM Profile definitions with metadata
- `GET /api/cesmii/stats` - CESMII processing statistics (received, validated, failed, published)
- `POST /api/cesmii/publish/oee` - Publish OEE report as OEEReportV1 SM Profile. Body: `{ enterprise, site, oeeData }`
- `POST /api/cesmii/publish/insight` - Publish insight as FactoryInsightV1 SM Profile. Body: `{ enterprise, insight }`
- `POST /api/cesmii/demo/start` - Start demo work order publisher
- `POST /api/cesmii/demo/stop` - Stop demo work order publisher
- `GET /api/cesmii/demo/status` - Check demo publisher status

### Demo Control

- `GET /api/demo/scenarios` - List available demo scenarios
- `POST /api/demo/scenarios/:id/start` - Start a demo scenario
- `POST /api/demo/scenarios/:id/stop` - Stop a running scenario
- `POST /api/demo/inject` - Inject an anomaly (type, equipment, severity, duration)
- `GET /api/demo/status` - Get demo engine status
- `POST /api/demo/reset` - Reset demo state

### Agent (Bedrock AgentCore)

- `POST /api/agent/ask` - Send question to orchestrator agent
- `GET /api/agent/context` - Get comprehensive factory context for agentic workflows
- `GET /api/agent/token-usage` - Get token usage tracking (inputTokens, outputTokens, callCount, dailyReset)

### Health

- `GET /health` - Server health check with MQTT and InfluxDB connection status

## Environment Variables

- `PORT` - HTTP server port (default: 3000)
- `LOG_LEVEL` - Set to 'debug' to enable verbose console.debug output (default: suppressed)
- `AWS_REGION` - AWS region for Bedrock (default: us-east-1)
- `CMMS_ENABLED` - Set to 'true' to enable MaintainX CMMS integration
- `MAINTAINX_API_KEY` - MaintainX API key (required when CMMS enabled)
- `DISABLE_INSIGHTS` - Set to 'true' to disable AI analysis loop
- `CESMII_ENABLED` - Set to 'false' to disable CESMII SM Profile support (default: enabled)
- `CESMII_IGNORED_PROFILES` - Comma-separated list of SM Profile types to skip (default: 'AssetOEEV1,FlowComputer')
- `BEDROCK_TIER_MODEL_ID` - Model ID for routine analysis (default: Sonnet, same as primary). Tier 2/3 use this model. Can be overridden to a cheaper model (e.g., Haiku) once subscribed in Bedrock Marketplace. Interactive Q&A uses `BEDROCK_MODEL_ID` (Sonnet).
- `AGENT_DAILY_TOKEN_BUDGET` - Daily input token limit for AI analysis (default: 500000). Circuit breaker pauses analysis when exceeded.

Note: AI uses **AWS Bedrock** (not Anthropic API directly). No ANTHROPIC_API_KEY needed.

## MQTT Topic Structure

Topics from ProveIt! virtual factory follow this pattern:
```
Enterprise {A|B|C}/Site{N}/area/machine/component/metric/type
```

Examples:
- `Enterprise A/Dallas Line 1/packaging/...`
- `Enterprise B/Site3/palletizing/palletizermanual01/workstation/metric/oee`

## Key Configuration (server.js)

- `TREND_ANALYSIS_INTERVAL` - How often Claude analyzes trends (default: 30000ms)
- `range(start: -5m)` in Flux query - Time window for trend analysis
- WebSocket throttling - Only broadcasts every 10th MQTT message to avoid overwhelming frontend

## WebSocket Message Types

**Server → Client:**
- `initial_state` - Sent on connection with recent messages, insights, stats, cesmiiWorkOrders, cesmiiStats
- `mqtt_message` - Real-time MQTT data (throttled)
- `trend_insight` - Claude's trend analysis results
- `cesmii_work_order` - CESMII SM Profile work order received and validated

**Client → Server:**
- `get_stats` - Request current statistics
- `ask_claude` - Send a question to Claude with factory context

## InfluxDB Schema

Data is written with these tags:
- `enterprise`, `site`, `area`, `machine`, `full_topic`

Field: `value` (float for numeric, string otherwise)

Measurement name: last 2 parts of topic joined with underscore

## Production Deployment (Fargate)

Production runs on AWS ECS Fargate cluster `edgemind-prod-cluster`.

### ⚠️ DEPLOYMENT RULES (CRITICAL)

1. **NEVER manually fix production** - Always use CI/CD or CDK templates
2. **Push to feature branch** → Create PR to `main` → Merge triggers deploy
3. GitHub Actions pipeline triggers on push to `main` only

### Deployment Workflow

```bash
# 1. Make changes on feature branch
git checkout -b feature/my-fix
# ... make changes ...
git add . && git commit -m "fix: description"
git push origin feature/my-fix

# 2. Create PR to main (via GitHub UI or gh CLI)
gh pr create --base main --title "Fix: description"

# 3. Merge PR triggers GitHub Actions:
#    - Backend: builds Docker image → pushes to ECR → deploys to ECS
#    - Frontend: syncs to S3 → invalidates CloudFront
```

### Production URLs
- **Dashboard**: https://edge-mind.concept-reply-sandbox.com
- **Health Check**: https://edge-mind.concept-reply-sandbox.com/health

### Viewing Logs (CloudWatch)

```bash
# Backend logs
aws logs tail /ecs/edgemind-prod-backend --since 10m --format short

# InfluxDB logs
aws logs tail /ecs/edgemind-prod-influxdb --since 10m --format short

# ChromaDB logs
aws logs tail /ecs/edgemind-prod-chromadb --since 10m --format short
```

### CDK Infrastructure Commands

```bash
cd infra && source .venv/bin/activate

# Deploy all stacks
cdk deploy --all --profile reply

# Deploy specific stack
cdk deploy edgemind-prod-backend --profile reply

# Check diff before deploying
cdk diff --profile reply
```

## Backend Modules (lib/demo/)

Demo engine for conference presentation:

```
lib/demo/
├── engine.js        # ScenarioRunner, InjectionManager, REST endpoints
├── scenarios.js     # 6 pre-configured factory scenarios
└── profiles.js      # 5 anomaly type profiles
```

## Testing

- **Framework**: Jest
- **Run**: `npm test`
- **Test location**: `lib/__tests__/*.test.js`
- **Test suites**: validation, influx writer, OEE calculation, CMMS MaintainX provider, CESMII validator, CESMII handler, CESMII publisher, trends, SPC

**IMPORTANT: All tests must pass before pushing any frontend or backend code changes.** Run `npm test` and verify the full suite passes. CI will also run `npm test` — failed tests block deployment.

## Git Workflow

- Never add `Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>` to commit messages
- Main branch: `main`
- Dev branch: `dev` (deploys to EC2 via deploy.yml)
- CI runners: pinned to `ubuntu-24.04` (not `ubuntu-latest`)

## Project Memory System

This project maintains institutional knowledge in `docs/project_notes/` for consistency across sessions.

### Memory Files

- **bugs.md** - Bug log with dates, solutions, and prevention notes
- **decisions.md** - Architectural Decision Records (ADRs) with context and trade-offs
- **key_facts.md** - Project configuration, credentials, ports, important URLs
- **issues.md** - Work log with ticket IDs, descriptions, and URLs

### Memory-Aware Protocols

**Before proposing architectural changes:**
- Check `docs/project_notes/decisions.md` for existing decisions
- Verify the proposed approach doesn't conflict with past choices
- If it does conflict, acknowledge the existing decision and explain why a change is warranted

**When encountering errors or bugs:**
- Search `docs/project_notes/bugs.md` for similar issues
- Apply known solutions if found
- Document new bugs and solutions when resolved

**When looking up project configuration:**
- Check `docs/project_notes/key_facts.md` for credentials, ports, URLs, service accounts
- Prefer documented facts over assumptions

**When completing work on tickets:**
- Log completed work in `docs/project_notes/issues.md`
- Include date, brief description, and commit reference

**When user requests memory updates:**
- Update the appropriate memory file (bugs, decisions, key_facts, or issues)
- Follow the established format and style (bullet lists, dates, concise entries)
