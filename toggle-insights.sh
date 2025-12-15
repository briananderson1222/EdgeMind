#!/bin/bash
# Toggle DISABLE_INSIGHTS environment variable for EdgeMind server

ENV_FILE=".env"

# Create .env if it doesn't exist
if [ ! -f "$ENV_FILE" ]; then
    echo "DISABLE_INSIGHTS=false" > "$ENV_FILE"
    echo "Created $ENV_FILE with insights ENABLED"
    exit 0
fi

# Read current value
CURRENT=$(grep -E "^DISABLE_INSIGHTS=" "$ENV_FILE" 2>/dev/null | cut -d'=' -f2)

if [ "$CURRENT" = "true" ]; then
    sed -i.bak 's/^DISABLE_INSIGHTS=true/DISABLE_INSIGHTS=false/' "$ENV_FILE"
    rm -f "$ENV_FILE.bak"
    echo "Insights ENABLED (DISABLE_INSIGHTS=false)"
    echo "Restart server to apply: npm start"
else
    if grep -q "^DISABLE_INSIGHTS=" "$ENV_FILE"; then
        sed -i.bak 's/^DISABLE_INSIGHTS=false/DISABLE_INSIGHTS=true/' "$ENV_FILE"
        rm -f "$ENV_FILE.bak"
    else
        echo "DISABLE_INSIGHTS=true" >> "$ENV_FILE"
    fi
    echo "Insights DISABLED (DISABLE_INSIGHTS=true)"
    echo "Restart server to apply: npm start"
fi
