# Docker Deployment

Container-based deployment for EdgeMind using Docker and Docker Compose.

## Architecture Overview

```
                         Docker Host (edgemind-net)
+---------------------------------------------------------------------+
|                                                                     |
|   +----------------+    +------------------+    +----------------+  |
|   |   influxdb     |    | edgemind-backend |    |   chromadb     |  |
|   |   Port: 8086   |<-->|   Port: 3000     |<-->|   Port: 8000   |  |
|   |   (internal)   |    |                  |    |   (internal)   |  |
|   +----------------+    +------------------+    +----------------+  |
|         |                      |                       |            |
|         v                      v                       v            |
|   influxdb-data          ~/.aws (ro mount)       chromadb-data     |
|   (named volume)                                 (named volume)     |
|                                                                     |
+---------------------------------------------------------------------+
         |                       |                       |
         v                       v                       v
    localhost:8086         localhost:3000          localhost:8000
    (InfluxDB UI)          (Dashboard)             (ChromaDB API)
```

## Docker Compose Files

EdgeMind provides two compose files in `Deployment Scripts/`:

| File | Purpose | Use Case |
|------|---------|----------|
| `docker-compose.local.yml` | Local development | Development with hot reload, AWS creds mount |
| `docker-compose.yml` | Production deployment | Full production with required secrets |

## Local Development Compose

### File: docker-compose.local.yml

```yaml
services:
  influxdb:
    image: influxdb:2.7
    container_name: edgemind-influxdb
    ports:
      - "8086:8086"
    environment:
      - DOCKER_INFLUXDB_INIT_MODE=setup
      - DOCKER_INFLUXDB_INIT_USERNAME=${INFLUXDB_ADMIN_USER:-admin}
      - DOCKER_INFLUXDB_INIT_PASSWORD=${INFLUXDB_ADMIN_PASSWORD}
      - DOCKER_INFLUXDB_INIT_ORG=${INFLUXDB_ORG:-proveit}
      - DOCKER_INFLUXDB_INIT_BUCKET=${INFLUXDB_BUCKET:-factory}
      - DOCKER_INFLUXDB_INIT_ADMIN_TOKEN=${INFLUXDB_ADMIN_TOKEN}
    volumes:
      - influxdb-data:/var/lib/influxdb2
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8086/health"]
      interval: 10s
      timeout: 5s
      retries: 5

  backend:
    build:
      context: ..
      dockerfile: Deployment Scripts/Dockerfile
    container_name: edgemind-backend
    ports:
      - "${PORT:-3000}:3000"
    environment:
      - INFLUXDB_URL=http://influxdb:8086
      - INFLUXDB_TOKEN=${INFLUXDB_ADMIN_TOKEN}
      # ... other env vars
    volumes:
      - ${HOME}/.aws:/home/nodejs/.aws:ro
    depends_on:
      influxdb:
        condition: service_healthy

volumes:
  influxdb-data:
    name: edgemind-influxdb-data
```

### Start Local Development Stack

```bash
cd "Deployment Scripts"

# Set required environment variables
export INFLUXDB_ADMIN_PASSWORD=proveit2026
export INFLUXDB_ADMIN_TOKEN=proveit-factory-token-2026
export MQTT_PASSWORD=your_mqtt_password

# Start services
docker compose -f docker-compose.local.yml up -d
```

### View Logs

```bash
# All services
docker compose -f docker-compose.local.yml logs -f

# Backend only
docker compose -f docker-compose.local.yml logs -f backend

# InfluxDB only
docker compose -f docker-compose.local.yml logs -f influxdb
```

### Stop Services

```bash
# Stop but keep data
docker compose -f docker-compose.local.yml down

# Stop and remove data volumes
docker compose -f docker-compose.local.yml down -v
```

## Production Compose

### File: docker-compose.yml

```yaml
services:
  influxdb:
    image: influxdb:2.7
    container_name: influxdb
    ports:
      - "8086:8086"
    environment:
      - DOCKER_INFLUXDB_INIT_MODE=setup
      - DOCKER_INFLUXDB_INIT_USERNAME=${INFLUXDB_ADMIN_USER:-admin}
      - DOCKER_INFLUXDB_INIT_PASSWORD=${INFLUXDB_ADMIN_PASSWORD:?required}
      - DOCKER_INFLUXDB_INIT_ORG=${INFLUXDB_ORG:-proveit}
      - DOCKER_INFLUXDB_INIT_BUCKET=${INFLUXDB_BUCKET:-factory}
      - DOCKER_INFLUXDB_INIT_ADMIN_TOKEN=${INFLUXDB_ADMIN_TOKEN:?required}
    volumes:
      - influxdb-data:/var/lib/influxdb2
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8086/health"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  backend:
    build: .
    container_name: edgemind-backend
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - NODE_ENV=production
      - MQTT_HOST=${MQTT_HOST:-mqtt://virtualfactory.proveit.services:1883}
      - MQTT_USERNAME=${MQTT_USERNAME:?required}
      - MQTT_PASSWORD=${MQTT_PASSWORD:?required}
      - INFLUXDB_URL=http://influxdb:8086
      - INFLUXDB_TOKEN=${INFLUXDB_ADMIN_TOKEN}
      - AWS_REGION=${AWS_REGION:-us-east-1}
    depends_on:
      influxdb:
        condition: service_healthy
    restart: unless-stopped

volumes:
  influxdb-data:
```

### Required Environment Variables

Production compose requires these variables (will fail without them):

```bash
export INFLUXDB_ADMIN_PASSWORD=secure_password
export INFLUXDB_ADMIN_TOKEN=secure_token
export MQTT_USERNAME=proveitreadonly
export MQTT_PASSWORD=mqtt_password
```

## Dockerfile Explained

Located at `Deployment Scripts/Dockerfile`:

```dockerfile
FROM node:18-alpine

# Install curl for health checks
RUN apk add --no-cache curl

WORKDIR /app

# Copy package files first (layer caching)
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy application code
COPY server.js ./
COPY index.html ./
COPY factory-command-center.html ./

# Security: Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

# Expose ports
EXPOSE 3000 8080

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start server
CMD ["node", "server.js"]
```

### Key Dockerfile Features

| Feature | Purpose |
|---------|---------|
| `node:18-alpine` | Minimal Node.js base image |
| `npm ci --only=production` | Reproducible, production-only install |
| Non-root user | Security best practice |
| `HEALTHCHECK` | Container orchestration support |
| Layer ordering | Optimized build caching |

## Building the Image

### Local Build

```bash
# From project root
docker build -t edgemind:latest -f "Deployment Scripts/Dockerfile" .

# With specific tag
docker build -t edgemind:v2.0.0 -f "Deployment Scripts/Dockerfile" .
```

### Verify Build

```bash
# List images
docker images | grep edgemind

# Check image size
docker images edgemind:latest --format "{{.Size}}"
```

## Running Containers Manually

### InfluxDB Only

```bash
docker run -d --name influxdb -p 8086:8086 \
  -e DOCKER_INFLUXDB_INIT_MODE=setup \
  -e DOCKER_INFLUXDB_INIT_USERNAME=admin \
  -e DOCKER_INFLUXDB_INIT_PASSWORD=proveit2026 \
  -e DOCKER_INFLUXDB_INIT_ORG=proveit \
  -e DOCKER_INFLUXDB_INIT_BUCKET=factory \
  -e DOCKER_INFLUXDB_INIT_ADMIN_TOKEN=proveit-factory-token-2026 \
  influxdb:2.7
```

### Backend Only (External InfluxDB)

```bash
docker run -d --name edgemind-backend -p 3000:3000 \
  -e INFLUXDB_URL=http://host.docker.internal:8086 \
  -e INFLUXDB_TOKEN=proveit-factory-token-2026 \
  -e MQTT_PASSWORD=your_password \
  edgemind:latest
```

## ChromaDB

ChromaDB provides vector storage for anomaly persistence and RAG (Retrieval-Augmented Generation) capabilities.

### Container Setup

```bash
docker run -d --name chromadb \
  --network edgemind-net \
  -p 8000:8000 \
  -v chromadb-data:/data \
  --restart unless-stopped \
  chromadb/chroma
```

### Environment Variables

Configure the backend to connect to ChromaDB:

| Variable | Value | Description |
|----------|-------|-------------|
| `CHROMA_HOST` | `chromadb` | Hostname when on same Docker network |
| `CHROMA_PORT` | `8000` | ChromaDB API port |

Add to your `.env` file:

```bash
CHROMA_HOST=chromadb
CHROMA_PORT=8000
```

### Health Check

Verify ChromaDB is running:

```bash
curl http://localhost:8000/api/v2/heartbeat
```

Expected response: `{"nanosecond heartbeat": <timestamp>}`

### Network Requirements

ChromaDB must be on the same Docker network as the backend container:

```bash
# Create the network if it doesn't exist
docker network create edgemind-net

# Verify containers are on the network
docker network inspect edgemind-net
```

All containers (`edgemind-backend`, `influxdb`, `chromadb`) should be connected to `edgemind-net` for inter-container communication.

### Troubleshooting ChromaDB

```bash
# Check container status
docker ps | grep chromadb

# View logs
docker logs chromadb --tail=50

# Test connectivity from backend
docker exec edgemind-backend curl http://chromadb:8000/api/v2/heartbeat

# Restart ChromaDB
docker restart chromadb
```

## Volume Mounts

### Named Volumes

| Volume | Container Path | Purpose |
|--------|---------------|---------|
| `influxdb-data` | `/var/lib/influxdb2` | InfluxDB data persistence |
| `chromadb-data` | `/data` | ChromaDB vector storage persistence |

### Bind Mounts (Local Dev)

| Host Path | Container Path | Purpose |
|-----------|---------------|---------|
| `~/.aws` | `/home/nodejs/.aws` | AWS credentials (read-only) |

## Environment Configuration

### Using .env File

Create `.env` in `Deployment Scripts/`:

```bash
# InfluxDB
INFLUXDB_ADMIN_USER=admin
INFLUXDB_ADMIN_PASSWORD=proveit2026
INFLUXDB_ORG=proveit
INFLUXDB_BUCKET=factory
INFLUXDB_ADMIN_TOKEN=proveit-factory-token-2026

# MQTT
MQTT_HOST=mqtt://virtualfactory.proveit.services:1883
MQTT_USERNAME=proveitreadonly
MQTT_PASSWORD=your_password

# AWS
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=us.anthropic.claude-sonnet-4-20250514-v1:0

# Server
PORT=3000
NODE_ENV=production
```

Docker Compose automatically loads `.env` from the same directory.

## Health Checks

### Check Container Health

```bash
# View health status
docker ps --format "table {{.Names}}\t{{.Status}}"

# Detailed health info
docker inspect --format='{{json .State.Health}}' edgemind-backend | jq
```

### Manual Health Check

```bash
# From host
curl http://localhost:3000/health

# From inside container
docker exec edgemind-backend curl http://localhost:3000/health
```

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker logs edgemind-backend

# Common causes:
# - Missing required env vars
# - InfluxDB not healthy yet
# - Port already in use
```

### InfluxDB Connection Failed

```bash
# Verify InfluxDB is healthy
docker inspect --format='{{json .State.Health}}' influxdb | jq

# Check network connectivity
docker exec edgemind-backend ping influxdb

# Verify environment
docker exec edgemind-backend env | grep INFLUX
```

### Reset Everything

```bash
cd "Deployment Scripts"

# Stop and remove containers
docker compose -f docker-compose.local.yml down

# Remove volumes
docker volume rm edgemind-influxdb-data

# Remove images
docker rmi edgemind:latest

# Start fresh
docker compose -f docker-compose.local.yml up -d --build
```

## Related Documentation

- [[Development-Setup]] - Initial environment setup
- [[Local-Development]] - Day-to-day development
- [[EC2-Production]] - AWS EC2 deployment
- [[Configuration-Reference]] - Environment variables
