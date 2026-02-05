# EdgeMind Deployment Scripts

This folder contains deployment scripts for running EdgeMind locally and on AWS.

## Local Development

### Quick Start

```bash
cd "Deployment Scripts"
./local-deploy.sh
```

This will:
1. Check prerequisites (Docker, Docker Compose)
2. Create `.env` from template if it doesn't exist (auto-generates InfluxDB credentials)
3. Build and start the backend, InfluxDB, and ChromaDB containers
4. Wait for services to be healthy
5. Print access URLs

### Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    ChromaDB     │     │    InfluxDB     │     │     Backend     │
│  (Vector DB)    │     │  (Time Series)  │     │   (Node.js)     │
│  Port: 8000     │     │  Port: 8086     │     │  Port: 3000     │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         └───────────────────────┴───────────────────────┘
                        Docker Network
```

- **ChromaDB**: Vector database for anomaly persistence and semantic search (RAG)
- **InfluxDB**: Time-series database for sensor data storage
- **Backend**: Node.js server with MQTT ingestion, AI analysis, and WebSocket broadcast

### Prerequisites

- Docker Desktop
- Docker Compose V2 (`docker compose` command)
- curl

### Configuration

Environment variables are stored in `/.env` (project root). The template is at `/.env.template`.

| Variable | Description | Required |
|----------|-------------|----------|
| `INFLUXDB_ADMIN_PASSWORD` | InfluxDB admin password | Yes (auto-generated) |
| `INFLUXDB_ADMIN_TOKEN` | InfluxDB API token | Yes (auto-generated) |
| `MQTT_HOST` | MQTT broker URL | No (has default) |
| `MQTT_USERNAME` | MQTT username | Yes |
| `MQTT_PASSWORD` | MQTT password | Yes |
| `AWS_PROFILE` | AWS profile for Bedrock | No |
| `AWS_REGION` | AWS region | No (default: us-east-1) |
| `CHROMA_PORT` | ChromaDB port | No (default: 8000) |
| `DISABLE_INSIGHTS` | Disable AI insights | No (default: false) |

### Commands

Run these from the `Deployment Scripts` folder:

```bash
# Start services
./local-deploy.sh

# View logs
docker compose --env-file ../.env -f docker-compose.local.yml logs -f

# Stop services
docker compose --env-file ../.env -f docker-compose.local.yml down

# Restart backend only
docker compose --env-file ../.env -f docker-compose.local.yml restart backend

# Full reset (deletes all data)
docker compose --env-file ../.env -f docker-compose.local.yml down -v
```

### Access URLs

| Service | URL |
|---------|-----|
| Dashboard | http://localhost:3000/ |
| API Health | http://localhost:3000/health |
| API Trends | http://localhost:3000/api/trends |
| InfluxDB UI | http://localhost:8086 |
| ChromaDB API | http://localhost:8000 |

## AWS Deployment

### Manual Backend Deployment

The ECS task definition uses **X86_64** architecture by default (configurable via `-c cpu_architecture=ARM64`).

```bash
# Login to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com

# Build for X86_64 (default)
docker build --platform linux/amd64 -t <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/edgemind-prod-backend:latest .

# Push
docker push <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/edgemind-prod-backend:latest

# Force ECS deployment
aws ecs update-service --region us-east-1 --cluster edgemind-prod-cluster --service edgemind-prod-backend --force-new-deployment
```

### Knowledge Base Sync

Sync documents and images to Bedrock Knowledge Base:

```bash
./sync-kb.sh
```

Supported formats: PDF, TXT, MD, HTML, DOC/DOCX, CSV, XLS/XLSX, PNG, JPEG (images max 3.75MB).

### EC2 (Legacy)

`deploy-ec2.sh` - Deploys to a single EC2 instance. **Note:** Contains hardcoded values that need updating.

### CDK (Recommended)

See `/infra/` folder for AWS CDK deployment with:
- ECS Fargate backend
- Managed InfluxDB
- CloudFront distribution
- Secrets Manager integration

## Files

| File | Description |
|------|-------------|
| `local-deploy.sh` | Idempotent local deployment script |
| `docker-compose.local.yml` | Docker Compose for local dev |
| `Dockerfile` | Backend container image |
| `docker-compose.yml` | Production Docker Compose (InfluxDB + ChromaDB + Backend) |
| `deploy-ec2.sh` | Legacy EC2 deployment |
