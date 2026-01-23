#!/bin/bash
# Start EdgeMind with fresh AWS credentials
cd "$(dirname "$0")"

echo "🔐 Fetching AWS credentials..."
eval $(aws configure export-credentials --format env)

echo "🚀 Starting EdgeMind..."
cd "Deployment Scripts"
docker compose -f docker-compose.local.yml --env-file ../.env up -d

echo "✅ EdgeMind running at http://localhost:3000"
