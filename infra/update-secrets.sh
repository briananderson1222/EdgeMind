#!/bin/bash
set -e

# EdgeMind - Update Secrets Manager Script
# Run this after deploying infrastructure to update MQTT and InfluxDB credentials

PROFILE="reply"
REGION="us-east-1"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo "=================================================="
echo "EdgeMind - Update Secrets Manager"
echo "=================================================="
echo ""

# Prompt for MQTT credentials
echo -e "${YELLOW}Enter MQTT Broker Details:${NC}"
read -p "Host [virtualfactory.proveit.services]: " MQTT_HOST
MQTT_HOST=${MQTT_HOST:-virtualfactory.proveit.services}

read -p "Port [1883]: " MQTT_PORT
MQTT_PORT=${MQTT_PORT:-1883}

read -p "Username: " MQTT_USERNAME
read -sp "Password: " MQTT_PASSWORD
echo ""

# Update MQTT secret
echo ""
echo -e "${YELLOW}Updating MQTT secret...${NC}"
aws secretsmanager update-secret \
  --secret-id edgemind/mqtt \
  --secret-string "{\"host\":\"$MQTT_HOST\",\"port\":$MQTT_PORT,\"username\":\"$MQTT_USERNAME\",\"password\":\"$MQTT_PASSWORD\"}" \
  --region $REGION \
  --profile $PROFILE

echo -e "${GREEN}✓ MQTT secret updated${NC}"
echo ""

# Prompt for InfluxDB credentials (optional)
echo -e "${YELLOW}Update InfluxDB credentials? (y/n) [n]:${NC}"
read -p "" UPDATE_INFLUX
UPDATE_INFLUX=${UPDATE_INFLUX:-n}

if [[ "$UPDATE_INFLUX" == "y" ]]; then
    echo ""
    echo -e "${YELLOW}Enter InfluxDB Details:${NC}"
    read -p "URL [http://influxdb.edgemind.local:8086]: " INFLUX_URL
    INFLUX_URL=${INFLUX_URL:-http://influxdb.edgemind.local:8086}

    read -p "Token: " INFLUX_TOKEN
    read -p "Organization [proveit]: " INFLUX_ORG
    INFLUX_ORG=${INFLUX_ORG:-proveit}

    read -p "Bucket [factory]: " INFLUX_BUCKET
    INFLUX_BUCKET=${INFLUX_BUCKET:-factory}

    read -p "Username [admin]: " INFLUX_USER
    INFLUX_USER=${INFLUX_USER:-admin}

    echo ""
    echo -e "${YELLOW}Updating InfluxDB secret...${NC}"
    aws secretsmanager update-secret \
      --secret-id edgemind/influxdb \
      --secret-string "{\"url\":\"$INFLUX_URL\",\"token\":\"$INFLUX_TOKEN\",\"org\":\"$INFLUX_ORG\",\"bucket\":\"$INFLUX_BUCKET\",\"username\":\"$INFLUX_USER\"}" \
      --region $REGION \
      --profile $PROFILE

    echo -e "${GREEN}✓ InfluxDB secret updated${NC}"
fi

echo ""
echo "=================================================="
echo -e "${GREEN}Secrets updated successfully!${NC}"
echo "=================================================="
echo ""
echo -e "${YELLOW}Note: ECS tasks will automatically use the updated secrets on next restart.${NC}"
echo "To restart tasks immediately:"
echo ""
echo "  aws ecs update-service \\"
echo "    --cluster edgemind-prod-cluster \\"
echo "    --service edgemind-prod-backend \\"
echo "    --force-new-deployment \\"
echo "    --profile $PROFILE"
echo ""
