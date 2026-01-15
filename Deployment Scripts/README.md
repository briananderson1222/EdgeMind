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
3. Build and start the backend and InfluxDB containers
4. Wait for services to be healthy
5. Print access URLs

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
| `docker-compose.yml` | Legacy compose file |
| `deploy-ec2.sh` | Legacy EC2 deployment |
