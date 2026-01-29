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
    echo -e "${YELLOW}[1/4] Checking prerequisites...${NC}"

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
    echo -e "${YELLOW}[2/4] Setting up environment...${NC}"

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
# AWS Credentials Setup
# -----------------------------------------------------------------------------
setup_aws_credentials() {
    echo -e "${YELLOW}[3/4] Setting up AWS credentials...${NC}"

    # Helper to update .env file with credentials
    update_env_creds() {
        local env_file="$PROJECT_ROOT/.env"
        # Remove old AWS creds (including expiration)
        grep -v "^AWS_ACCESS_KEY_ID=" "$env_file" | grep -v "^AWS_SECRET_ACCESS_KEY=" | grep -v "^AWS_SESSION_TOKEN=" | grep -v "^AWS_CREDENTIAL_EXPIRATION=" > "$env_file.tmp"
        mv "$env_file.tmp" "$env_file"
        # Add new ones
        echo "AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID" >> "$env_file"
        echo "AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY" >> "$env_file"
        [ -n "$AWS_SESSION_TOKEN" ] && echo "AWS_SESSION_TOKEN=$AWS_SESSION_TOKEN" >> "$env_file"
    }

    # Determine which profile to use
    local profile="${AWS_PROFILE:-default}"
    
    # Check if profile uses credential_process (helper that won't work in container)
    local uses_helper=false
    if grep -A5 "^\[profile $profile\]" ~/.aws/config 2>/dev/null | grep -q "credential_process"; then
        uses_helper=true
    elif grep -A5 "^\[$profile\]" ~/.aws/config 2>/dev/null | grep -q "credential_process"; then
        uses_helper=true
    elif grep -A5 "^\[$profile\]" ~/.aws/credentials 2>/dev/null | grep -q "credential_process"; then
        uses_helper=true
    fi

    if [ "$uses_helper" = true ]; then
        echo -e "  Profile '$profile' uses credential helper - extracting credentials..."
        
        # Get the credential_process command
        local cred_cmd
        cred_cmd=$(grep -A5 "^\[$profile\]" ~/.aws/config 2>/dev/null | grep "credential_process" | sed 's/^[[:space:]]*credential_process[[:space:]]*=[[:space:]]*//')
        if [ -z "$cred_cmd" ]; then
            cred_cmd=$(grep -A5 "^\[profile $profile\]" ~/.aws/config 2>/dev/null | grep "credential_process" | sed 's/^[[:space:]]*credential_process[[:space:]]*=[[:space:]]*//')
        fi
        
        if [ -n "$cred_cmd" ]; then
            # Run the credential process directly
            local creds
            creds=$(eval "$cred_cmd" 2>/dev/null)
            
            if [ -n "$creds" ] && echo "$creds" | jq -e '.AccessKeyId' &>/dev/null; then
                export AWS_ACCESS_KEY_ID=$(echo "$creds" | jq -r '.AccessKeyId')
                export AWS_SECRET_ACCESS_KEY=$(echo "$creds" | jq -r '.SecretAccessKey')
                export AWS_SESSION_TOKEN=$(echo "$creds" | jq -r '.SessionToken')
                update_env_creds
                echo -e "${GREEN}  OK: Extracted credentials from helper${NC}"
            else
                echo -e "${RED}  ERROR: Failed to get credentials from helper${NC}"
                echo -e "  You may need to run: mwinit"
                exit 1
            fi
        else
            echo -e "${RED}  ERROR: Could not find credential_process command${NC}"
            exit 1
        fi
    else
        # Simple profile - ~/.aws mount will work
        if aws sts get-caller-identity --profile "$profile" &>/dev/null; then
            echo -e "${GREEN}  OK: Using AWS profile '$profile' (via ~/.aws mount)${NC}"
            export AWS_PROFILE="$profile"
        else
            echo -e "${RED}  ERROR: Cannot authenticate with profile '$profile'${NC}"
            echo -e "  Run 'aws configure' or set AWS_PROFILE in .env"
            exit 1
        fi
    fi
    
    echo ""
}

# -----------------------------------------------------------------------------
# Docker Operations (Idempotent)
# -----------------------------------------------------------------------------
deploy_services() {
    echo -e "${YELLOW}[4/4] Deploying services...${NC}"

    # Stop existing containers first for clean restart
    docker compose -f docker-compose.local.yml --env-file "$PROJECT_ROOT/.env" down 2>/dev/null || true

    # Start all services (builds if needed, pulls if needed)
    docker compose -f docker-compose.local.yml --env-file "$PROJECT_ROOT/.env" up -d --build

    echo -e "${GREEN}  OK: Services deployed${NC}"
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
    docker compose -f docker-compose.local.yml --env-file "$PROJECT_ROOT/.env" ps
    echo ""
    echo -e "${YELLOW}Access URLs:${NC}"
    echo "  Dashboard:        http://localhost:3000/"
    echo "  API Health:       http://localhost:3000/health"
    echo "  API Docs:         http://localhost:3000/api/docs/"
    echo "  InfluxDB UI:      http://localhost:8086"
    echo "  ChromaDB API:     http://localhost:8002"
    echo "  MCP Gateway:      http://localhost:8001"
    echo "  Agent Chat:       http://localhost:8080"
    echo "  Agent Troubleshoot: http://localhost:8081"
    echo "  Agent Anomaly:    http://localhost:8082"
    echo ""
    echo -e "${YELLOW}Useful commands:${NC}"
    echo "  View logs:      cd 'Deployment Scripts' && docker compose -f docker-compose.local.yml logs -f"
    echo "  Stop services:  cd 'Deployment Scripts' && docker compose -f docker-compose.local.yml down"
    echo "  Clean reset:    cd 'Deployment Scripts' && docker compose -f docker-compose.local.yml down -v"
    echo ""
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
main() {
    check_prerequisites
    setup_environment
    setup_aws_credentials
    deploy_services
    print_status
}

main "$@"
