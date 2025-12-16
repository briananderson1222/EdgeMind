#!/bin/bash
# Toggle DISABLE_INSIGHTS environment variable for EdgeMind server
# Usage: ./toggle-insights.sh [true|false]
#   true  = disable insights (sleeping mode)
#   false = enable insights
#   no arg = toggle current state

ENV_FILE=".env"

# Function to restart the server
restart_server() {
    if [ -f "docker-compose.yml" ]; then
        echo "Restarting server via docker-compose..."
        docker-compose restart backend
    elif command -v pm2 &> /dev/null; then
        echo "Restarting server via pm2..."
        pm2 restart server
    else
        echo "Please restart the server manually: npm start"
    fi
}

# Function to set the value
set_insights() {
    local VALUE=$1
    if [ ! -f "$ENV_FILE" ]; then
        echo "DISABLE_INSIGHTS=$VALUE" > "$ENV_FILE"
    elif grep -q "^DISABLE_INSIGHTS=" "$ENV_FILE"; then
        sed -i.bak "s/^DISABLE_INSIGHTS=.*/DISABLE_INSIGHTS=$VALUE/" "$ENV_FILE"
        rm -f "$ENV_FILE.bak"
    else
        echo "DISABLE_INSIGHTS=$VALUE" >> "$ENV_FILE"
    fi

    if [ "$VALUE" = "true" ]; then
        echo "😴 Insights DISABLED (DISABLE_INSIGHTS=true)"
    else
        echo "✅ Insights ENABLED (DISABLE_INSIGHTS=false)"
    fi
}

# Handle arguments
if [ "$1" = "true" ]; then
    set_insights "true"
    restart_server
    exit 0
elif [ "$1" = "false" ]; then
    set_insights "false"
    restart_server
    exit 0
elif [ -n "$1" ]; then
    echo "Usage: $0 [true|false]"
    echo "  true  = disable insights (sleeping mode)"
    echo "  false = enable insights"
    echo "  no arg = toggle current state"
    exit 1
fi

# No argument - toggle mode
if [ ! -f "$ENV_FILE" ]; then
    set_insights "false"
    restart_server
    exit 0
fi

CURRENT=$(grep -E "^DISABLE_INSIGHTS=" "$ENV_FILE" 2>/dev/null | cut -d'=' -f2)

if [ "$CURRENT" = "true" ]; then
    set_insights "false"
else
    set_insights "true"
fi

restart_server
