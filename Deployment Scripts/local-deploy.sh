#!/bin/bash
# EdgeMind Local Development Deployment Script
# Idempotent - safe to run multiple times

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo -e "${BLUE}==================================================${NC}"
echo -e "${BLUE}  EdgeMind Local Development Setup${NC}"
echo -e "${BLUE}==================================================${NC}"
echo ""

# -----------------------------------------------------------------------------
# Prerequisites Check
# -----------------------------------------------------------------------------
check_prerequisites() {
    echo -e "${YELLOW}[1/5] Checking prerequisites...${NC}"

    local missing=0

    if ! command -v docker &> /dev/null; then
        echo -e "${RED}  ERROR: Docker not found. Please install Docker Desktop.${NC}"
        missing=1
    else
        echo -e "${GREEN}  OK: Docker installed${NC}"
    fi

    if ! docker info &> /dev/null 2>&1; then
        echo -e "${RED}  ERROR: Docker daemon not running. Please start Docker Desktop.${NC}"
        missing=1
    else
        echo -e "${GREEN}  OK: Docker daemon running${NC}"
    fi

    if ! docker compose version &> /dev/null 2>&1; then
        echo -e "${RED}  ERROR: Docker Compose not found. Please install Docker Compose V2.${NC}"
        missing=1
    else
        echo -e "${GREEN}  OK: Docker Compose V2 installed${NC}"
    fi

    if ! command -v curl &> /dev/null; then
        echo -e "${RED}  ERROR: curl not found. Please install curl.${NC}"
        missing=1
    fi

    if [ $missing -eq 1 ]; then
        echo ""
        echo -e "${RED}Prerequisites check failed. Please install missing dependencies.${NC}"
        exit 1
    fi

    echo ""
}

# -----------------------------------------------------------------------------
# Environment Setup
# -----------------------------------------------------------------------------
setup_environment() {
    echo -e "${YELLOW}[2/5] Setting up environment...${NC}"

    if [ ! -f "$PROJECT_ROOT/.env" ]; then
        if [ -f "$PROJECT_ROOT/.env.template" ]; then
            echo -e "  Creating .env from template..."
            cp "$PROJECT_ROOT/.env.template" "$PROJECT_ROOT/.env"

            # Generate secure InfluxDB password if not set
            if grep -q "^INFLUXDB_ADMIN_PASSWORD=$" "$PROJECT_ROOT/.env" 2>/dev/null; then
                local gen_password
                gen_password=$(openssl rand -base64 16 | tr -dc 'a-zA-Z0-9' | head -c 16)
                if [[ "$OSTYPE" == "darwin"* ]]; then
                    sed -i '' "s/^INFLUXDB_ADMIN_PASSWORD=$/INFLUXDB_ADMIN_PASSWORD=${gen_password}/" "$PROJECT_ROOT/.env"
                else
                    sed -i "s/^INFLUXDB_ADMIN_PASSWORD=$/INFLUXDB_ADMIN_PASSWORD=${gen_password}/" "$PROJECT_ROOT/.env"
                fi
                echo -e "${GREEN}  Generated InfluxDB password${NC}"
            fi

            # Generate secure InfluxDB token if not set
            if grep -q "^INFLUXDB_ADMIN_TOKEN=$" "$PROJECT_ROOT/.env" 2>/dev/null; then
                local gen_token
                gen_token=$(openssl rand -hex 32)
                if [[ "$OSTYPE" == "darwin"* ]]; then
                    sed -i '' "s/^INFLUXDB_ADMIN_TOKEN=$/INFLUXDB_ADMIN_TOKEN=${gen_token}/" "$PROJECT_ROOT/.env"
                else
                    sed -i "s/^INFLUXDB_ADMIN_TOKEN=$/INFLUXDB_ADMIN_TOKEN=${gen_token}/" "$PROJECT_ROOT/.env"
                fi
                echo -e "${GREEN}  Generated InfluxDB token${NC}"
            fi

            echo -e "${GREEN}  OK: Created .env file in project root${NC}"
        else
            echo -e "${RED}  ERROR: No .env.template found in project root.${NC}"
            exit 1
        fi
    else
        echo -e "${GREEN}  OK: Using existing .env file${NC}"
    fi

    # Source and validate required variables
    set -a
    source "$PROJECT_ROOT/.env"
    set +a

    local valid=1

    if [ -z "$INFLUXDB_ADMIN_PASSWORD" ]; then
        echo -e "${RED}  ERROR: INFLUXDB_ADMIN_PASSWORD is required in .env${NC}"
        valid=0
    fi

    if [ -z "$INFLUXDB_ADMIN_TOKEN" ]; then
        echo -e "${RED}  ERROR: INFLUXDB_ADMIN_TOKEN is required in .env${NC}"
        valid=0
    fi

    if [ $valid -eq 0 ]; then
        echo ""
        echo -e "${RED}Please update $PROJECT_ROOT/.env with required values and re-run.${NC}"
        exit 1
    fi

    echo -e "${GREEN}  OK: Environment validated${NC}"
    echo ""
}

# -----------------------------------------------------------------------------
# Docker Operations (Idempotent)
# -----------------------------------------------------------------------------
deploy_services() {
    echo -e "${YELLOW}[3/5] Deploying services...${NC}"

    # Pull latest images
    echo -e "  Pulling ChromaDB image..."
    docker compose --env-file "$PROJECT_ROOT/.env" -f docker-compose.local.yml pull chromadb 2>/dev/null || true
    echo -e "  Pulling InfluxDB image..."
    docker compose --env-file "$PROJECT_ROOT/.env" -f docker-compose.local.yml pull influxdb 2>/dev/null || true

    # Build backend (always rebuild to pick up code changes)
    echo -e "  Building backend image..."
    docker compose --env-file "$PROJECT_ROOT/.env" -f docker-compose.local.yml build backend --quiet

    # Start services (docker compose handles idempotency)
    echo -e "  Starting services..."
    docker compose --env-file "$PROJECT_ROOT/.env" -f docker-compose.local.yml up -d

    echo -e "${GREEN}  OK: Services deployed${NC}"
    echo ""
}

# -----------------------------------------------------------------------------
# Health Check
# -----------------------------------------------------------------------------
wait_for_services() {
    echo -e "${YELLOW}[4/5] Waiting for services to be healthy...${NC}"

    local max_attempts=30
    local attempt=0

    # Wait for ChromaDB
    echo -n "  ChromaDB: "
    while [ $attempt -lt $max_attempts ]; do
        if curl -sf http://localhost:8000/api/v1/heartbeat > /dev/null 2>&1; then
            echo -e "${GREEN}healthy${NC}"
            break
        fi
        attempt=$((attempt + 1))
        echo -n "."
        sleep 2
    done

    if [ $attempt -eq $max_attempts ]; then
        echo -e "${RED}failed${NC}"
        echo -e "${RED}  ChromaDB failed to start. Logs:${NC}"
        docker compose --env-file "$PROJECT_ROOT/.env" -f docker-compose.local.yml logs chromadb --tail=10
        exit 1
    fi

    # Wait for InfluxDB
    attempt=0
    echo -n "  InfluxDB: "
    while [ $attempt -lt $max_attempts ]; do
        if curl -sf http://localhost:8086/health > /dev/null 2>&1; then
            echo -e "${GREEN}healthy${NC}"
            break
        fi
        attempt=$((attempt + 1))
        echo -n "."
        sleep 2
    done

    if [ $attempt -eq $max_attempts ]; then
        echo -e "${RED}failed${NC}"
        echo -e "${RED}  InfluxDB failed to start. Logs:${NC}"
        docker compose --env-file "$PROJECT_ROOT/.env" -f docker-compose.local.yml logs influxdb --tail=10
        exit 1
    fi

    # Wait for backend
    attempt=0
    echo -n "  Backend:  "
    while [ $attempt -lt $max_attempts ]; do
        if curl -sf http://localhost:3000/health > /dev/null 2>&1; then
            echo -e "${GREEN}healthy${NC}"
            break
        fi
        attempt=$((attempt + 1))
        echo -n "."
        sleep 2
    done

    if [ $attempt -eq $max_attempts ]; then
        echo -e "${YELLOW}check logs${NC}"
        echo -e "${YELLOW}  Backend may still be starting. Check logs:${NC}"
        echo -e "  docker compose --env-file "$PROJECT_ROOT/.env" -f docker-compose.local.yml logs backend"
    fi

    echo ""
}

# -----------------------------------------------------------------------------
# Print Status
# -----------------------------------------------------------------------------
print_status() {
    echo -e "${BLUE}==================================================${NC}"
    echo -e "${GREEN}  EdgeMind Local Deployment Complete!${NC}"
    echo -e "${BLUE}==================================================${NC}"
    echo ""
    echo -e "${YELLOW}Services:${NC}"
    docker compose --env-file "$PROJECT_ROOT/.env" -f docker-compose.local.yml ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || \
        docker compose --env-file "$PROJECT_ROOT/.env" -f docker-compose.local.yml ps
    echo ""
    echo -e "${YELLOW}Access URLs:${NC}"
    echo "  Dashboard:      http://localhost:3000/"
    echo "  API Health:     http://localhost:3000/health"
    echo "  API Trends:     http://localhost:3000/api/trends"
    echo "  InfluxDB UI:    http://localhost:8086"
    echo "  ChromaDB API:   http://localhost:8000"
    echo ""
    echo -e "${YELLOW}Useful commands:${NC}"
    echo "  View logs:      docker compose --env-file "$PROJECT_ROOT/.env" -f docker-compose.local.yml logs -f"
    echo "  Stop services:  docker compose --env-file "$PROJECT_ROOT/.env" -f docker-compose.local.yml down"
    echo "  Restart:        docker compose --env-file "$PROJECT_ROOT/.env" -f docker-compose.local.yml restart"
    echo "  Clean reset:    docker compose --env-file "$PROJECT_ROOT/.env" -f docker-compose.local.yml down -v"
    echo ""
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
main() {
    check_prerequisites
    setup_environment
    deploy_services
    wait_for_services
    print_status
}

main "$@"
