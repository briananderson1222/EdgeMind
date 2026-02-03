# Local Development

Day-to-day development workflow for EdgeMind.

## Starting Services

### Quick Start (Development Mode)

```bash
# Terminal 1: Start InfluxDB (if not running)
docker start influxdb

# Terminal 2: Start server with hot reload
npm run dev
```

### Full Stack with Docker Compose

```bash
cd "Deployment Scripts"
docker compose -f docker-compose.local.yml up -d
```

## Stopping Services

### Stop Server

Press `Ctrl+C` in the terminal running `npm run dev`.

### Stop InfluxDB

```bash
docker stop influxdb
```

### Stop All Docker Compose Services

```bash
cd "Deployment Scripts"
docker compose -f docker-compose.local.yml down
```

To also remove volumes (clears all data):
```bash
docker compose -f docker-compose.local.yml down -v
```

## Viewing Logs

### Server Logs

When running with `npm run dev`, logs appear in the terminal:

```
MQTT: Message on Enterprise A/Dallas Line 1/packaging/box01/conveyor/speed/value
InfluxDB write: conveyor_value
Running trend analysis...
Trend Analysis: Factory performance stable across all enterprises
```

### InfluxDB Logs

```bash
docker logs influxdb -f
```

### Filter Specific Log Types

```bash
# MQTT messages only
npm run dev 2>&1 | grep "MQTT:"

# InfluxDB writes only
npm run dev 2>&1 | grep "InfluxDB"

# Claude analysis only
npm run dev 2>&1 | grep "Trend Analysis:"
```

## Testing Changes

### Backend Changes

1. **Edit code** - nodemon auto-restarts on file changes
2. **Check logs** - Verify no errors on restart
3. **Test endpoints** - Use curl or browser

```bash
# Health check
curl http://localhost:3000/health

# Trends API
curl http://localhost:3000/api/trends

# OEE v2 API
curl "http://localhost:3000/api/oee/v2?enterprise=ALL"

# Schema hierarchy
curl http://localhost:3000/api/schema/hierarchy
```

### Frontend Changes

1. **Edit HTML/CSS/JS** - Save the file
2. **Refresh browser** - Changes appear immediately
3. **Check browser console** - Verify no JavaScript errors

### Module Changes (lib/)

Changes to files in `lib/` trigger nodemon restart automatically.

```bash
# Verify module loads correctly
npm run dev 2>&1 | head -20
```

## Hot Reload Behavior

| File Type | Behavior |
|-----------|----------|
| `server.js` | Auto-restart via nodemon |
| `lib/*.js` | Auto-restart via nodemon |
| `index.html` | Refresh browser manually |
| `css/*.css` | Refresh browser manually |
| `js/*.js` | Refresh browser manually |
| `.env` | Restart server manually |

### Force Restart

If nodemon does not detect changes:

```bash
# Press 'rs' in the nodemon terminal
rs
```

Or stop and restart:
```bash
# Ctrl+C then:
npm run dev
```

## Testing Specific Features

### Test Without AI (Cost Savings)

```bash
DISABLE_INSIGHTS=true npm run dev
```

Useful for:
- Testing MQTT message handling
- Validating InfluxDB writes
- Developing frontend without API costs

### Test CMMS Integration

```bash
CMMS_ENABLED=true \
MAINTAINX_API_KEY=your_key \
npm run dev
```

### Test with Fresh Database

```bash
# Remove existing InfluxDB container and data
docker rm -f influxdb

# Start fresh InfluxDB
docker run -d --name influxdb -p 8086:8086 \
  -e DOCKER_INFLUXDB_INIT_MODE=setup \
  -e DOCKER_INFLUXDB_INIT_USERNAME=admin \
  -e DOCKER_INFLUXDB_INIT_PASSWORD=proveit2026 \
  -e DOCKER_INFLUXDB_INIT_ORG=proveit \
  -e DOCKER_INFLUXDB_INIT_BUCKET=factory \
  -e DOCKER_INFLUXDB_INIT_ADMIN_TOKEN=proveit-factory-token-2026 \
  influxdb:2.7

# Wait for InfluxDB to initialize
sleep 10

# Start server
npm run dev
```

## API Testing with curl

### Schema Discovery

```bash
# All measurements
curl -s http://localhost:3000/api/schema/measurements | jq '.'

# Hierarchy view
curl -s http://localhost:3000/api/schema/hierarchy | jq '.'
```

### Factory Data

```bash
# Current trends
curl -s http://localhost:3000/api/trends | jq '.'

# OEE for all enterprises
curl -s "http://localhost:3000/api/oee/v2?enterprise=ALL" | jq '.'

# OEE for specific enterprise
curl -s "http://localhost:3000/api/oee/v2?enterprise=Enterprise%20A" | jq '.'

# Factory status
curl -s http://localhost:3000/api/factory/status | jq '.'
```

### OEE Discovery

```bash
# See which tier each enterprise uses
curl -s http://localhost:3000/api/oee/discovery | jq '.'
```

## WebSocket Testing

### Using websocat

```bash
# Install websocat
brew install websocat  # macOS

# Connect to WebSocket
websocat ws://localhost:3000
```

### Using Browser Console

Open `http://localhost:3000` and use browser dev tools:

```javascript
// Check WebSocket connection
console.log(window.ws.readyState);  // 1 = OPEN

// Request stats
window.ws.send(JSON.stringify({ type: 'get_stats' }));

// Ask Claude a question
window.ws.send(JSON.stringify({
  type: 'ask_claude',
  question: 'What is the current OEE?'
}));
```

## Database Management

### View InfluxDB UI

Open `http://localhost:8086` in browser:
- Username: `admin`
- Password: `proveit2026`

### Query InfluxDB from CLI

```bash
# Enter InfluxDB container
docker exec -it influxdb influx

# Query recent data
influx query '
from(bucket: "factory")
  |> range(start: -5m)
  |> filter(fn: (r) => r._field == "value")
  |> limit(n: 10)
' --org proveit --token proveit-factory-token-2026
```

### Clear All Data

```bash
# Delete all data in bucket (keeps bucket)
docker exec influxdb influx delete \
  --bucket factory \
  --org proveit \
  --token proveit-factory-token-2026 \
  --start '1970-01-01T00:00:00Z' \
  --stop '2099-12-31T23:59:59Z'
```

## Common Development Tasks

### Add New API Endpoint

1. Edit `server.js`
2. Add route handler
3. Test with curl
4. Document in [[REST-Endpoints]]

### Add New Module

1. Create file in `lib/`
2. Export functions
3. Import in `server.js`
4. Update [[Module-Architecture-Guidelines]]

### Modify Configuration

1. Add variable to `lib/config.js`
2. Update `.env.template`
3. Document in [[Configuration-Reference]]

## Troubleshooting

### Server Won't Start

```bash
# Check if port is in use
lsof -i :3000

# Kill process using port
kill -9 $(lsof -ti :3000)
```

### No MQTT Messages

1. Check MQTT password in `.env`
2. Verify network connectivity
3. Check MQTT broker status

```bash
# Test MQTT connectivity
nc -zv virtualfactory.proveit.services 1883
```

### InfluxDB Connection Failed

```bash
# Check InfluxDB is running
docker ps | grep influxdb

# Check InfluxDB logs
docker logs influxdb --tail 50

# Restart InfluxDB
docker restart influxdb
```

## Related Documentation

- [[Development-Setup]] - Initial setup guide
- [[Configuration-Reference]] - Environment variables
- [[Docker-Deployment]] - Container-based deployment
