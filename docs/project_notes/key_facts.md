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

### EC2 Production Server
- **Host**: `174.129.90.76`
- **SSH Key**: `~/.ssh/edgemind-demo.pem`
- **SSH Command**: `ssh -i ~/.ssh/edgemind-demo.pem ec2-user@174.129.90.76`
- **Production URL**: http://174.129.90.76:3000

### Docker Container
- **Container Name**: `edgemind-backend`
- **ECR Image**: `718815871498.dkr.ecr.us-east-1.amazonaws.com/edgemind-prod-backend:latest`
- **Bind Mounts**: `server.js`, `index.html` (read-only)
- **NOT Bind-Mounted**: `lib/`, `styles.css`, `app.js` (must use `docker cp`)

#### ⚠️ CRITICAL: Files That Must Be In Container
These files are NOT bind-mounted and must be copied manually after container recreation:
```
lib/          # Backend modules - REQUIRED or server crashes
styles.css    # Frontend styles - REQUIRED or UI breaks
app.js        # Frontend JavaScript - REQUIRED or dashboard non-functional
```
**Recovery command:**
```bash
ssh -i $SSH_KEY $EC2_HOST "sudo docker cp ~/app/lib edgemind-backend:/app/ && sudo docker cp ~/app/styles.css edgemind-backend:/app/ && sudo docker cp ~/app/app.js edgemind-backend:/app/"
```
**Dockerfile must include:**
```dockerfile
COPY lib/ ./lib/
COPY styles.css ./
COPY app.js ./
```

### InfluxDB
- **Local Port**: `8086`
- **Username**: `admin`
- **Organization**: `proveit`
- **Bucket**: `factory`
- **Token Location**: Environment variable `INFLUXDB_TOKEN` or hardcoded for dev

### ChromaDB
- **Local Port**: `8000`
- **EC2 Container**: `chromadb` (image: `chromadb/chroma:latest`)
- **EC2 Network**: `edgemind-net` (shared with backend and influxdb)
- **EC2 Volume**: `chromadb-data:/data` (persistent)
- **Health Check**: `GET /api/v2/heartbeat`
- **Purpose**: Vector database for anomaly persistence and RAG
- **Backend Env**: `CHROMA_HOST=chromadb` (container name, not localhost)

#### EC2 ChromaDB Deployment Command
```bash
# With persistence and restart policy
sudo docker run -d \
  --name chromadb \
  --network edgemind-net \
  -p 8000:8000 \
  -v chromadb-data:/data \
  --restart unless-stopped \
  chromadb/chroma
```

---

## MQTT Configuration

### Virtual Factory Broker
- **Host**: `virtualfactory.proveit.services`
- **Port**: `1883`
- **Topic Pattern**: `Enterprise {A|B|C}/Site{N}/area/machine/component/metric/type`

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
- **Trend Analysis Interval**: 30,000ms (30 seconds)
- **WebSocket Throttle**: Every 10th MQTT message
- **Schema Cache TTL**: 5 minutes
- **Trend Query Window**: 5 minutes (1-min aggregates)

### OEE Tiers
- **Tier 1**: Direct OEE measurement (highest confidence)
- **Tier 2**: Calculated from A/P/Q components
- **Tier 3**: Estimated from related metrics

---

## Git Workflow

- **Main Branch**: `main`
- **Current Refactor Branch**: `refactor/modularization`
- **Commit Convention**: No `Co-Authored-By` lines

---

## Environment Variables

### Required
- `INFLUXDB_ADMIN_PASSWORD` - InfluxDB admin password
- `INFLUXDB_ADMIN_TOKEN` - InfluxDB API token
- `MQTT_USERNAME` - MQTT broker username
- `MQTT_PASSWORD` - MQTT broker password

### Optional
- `PORT` - HTTP server port (default: 3000)
- `ANTHROPIC_API_KEY` - Direct Anthropic API (if not using Bedrock)
- `AWS_REGION` - AWS region for Bedrock (default: us-east-1)
- `AWS_PROFILE` - AWS profile for credentials
- `DISABLE_INSIGHTS` - Set to 'true' to disable AI analysis loop
- `CHROMA_HOST` - ChromaDB hostname (default: localhost, use 'chromadb' in Docker)
- `CHROMA_PORT` - ChromaDB port (default: 8000)

---

## Important URLs

### Monitoring
- **Production Dashboard**: http://174.129.90.76:3000
- **Health Check**: http://174.129.90.76:3000/health

### Documentation
- **CLAUDE.md**: Project instructions for AI assistants
- **IMPLEMENTATION_CHECKLIST.md**: Refactoring progress tracker

<!-- Add new facts above this line -->
