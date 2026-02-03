# Quick Start

Get EdgeMind running in 5 minutes.

---

## Prerequisites

Before you begin, ensure you have:

- **Node.js 18+** - [Download](https://nodejs.org/)
- **Docker** - [Download](https://www.docker.com/products/docker-desktop/)
- **AWS credentials** - For Claude AI on Bedrock (IAM role, environment variables, or AWS config)

Verify your setup:

```bash
node --version    # Should show v18.x or higher
docker --version  # Should show Docker version
```

---

## Step 1: Start InfluxDB

EdgeMind stores time-series data in InfluxDB. Start it with Docker:

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

Verify InfluxDB is running:

```bash
curl -s http://localhost:8086/health | grep -o '"status":"pass"'
```

Expected output: `"status":"pass"`

---

## Step 2: Configure Environment

Create a `.env` file in the project root:

```bash
# Required: AWS region for Bedrock AI
AWS_REGION=us-east-1

# Optional: Server port (default: 3000)
PORT=3000
```

AI uses AWS Bedrock (not Anthropic API directly). No `ANTHROPIC_API_KEY` needed. Ensure your AWS credentials are configured via `aws configure` or environment variables.

---

## Step 3: Install Dependencies

```bash
npm install
```

---

## Step 4: Start the Server

```bash
npm start
```

You should see output like:

```
Server running on port 3000
MQTT: Connecting to virtualfactory.proveit.services:1883
MQTT: Connected
InfluxDB: Connected to localhost:8086
AI Analysis: Starting trend analysis loop (30s interval)
```

---

## Step 5: Open the Dashboard

Open your browser to:

```
http://localhost:3000
```

---

## What You Should See

When everything is working:

1. **LIVE indicator** - Green badge in the header shows WebSocket connection is active
2. **MQTT stream** - Messages appearing in the data feed panel
3. **Factory metrics** - OEE, production rates updating in real-time
4. **AI insights** - Claude analysis appearing every 30 seconds

---

## Verify the Setup

Run these health checks:

**Server health:**
```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "online",
  "mqtt": true,
  "influxdb": true,
  "stats": {
    "messageCount": 0,
    "influxWrites": 0
  }
}
```

**Schema discovery:**
```bash
curl http://localhost:3000/api/schema/measurements | head -c 200
```

Should return JSON with discovered measurements.

**Trend data:**
```bash
curl http://localhost:3000/api/trends
```

Should return recent aggregated metrics.

---

## Troubleshooting

### InfluxDB not starting

Check if port 8086 is already in use:

```bash
lsof -i :8086
```

If another InfluxDB container exists:

```bash
docker stop influxdb && docker rm influxdb
```

Then run the docker command again.

### MQTT connection failed

The server connects to `virtualfactory.proveit.services:1883`. This requires:
- Internet connection
- No firewall blocking port 1883

Check MQTT connectivity:

```bash
curl -v telnet://virtualfactory.proveit.services:1883
```

### No data appearing

1. Wait 30-60 seconds for initial data to accumulate
2. Check server logs for MQTT messages
3. Verify InfluxDB is receiving data:

```bash
curl -H "Authorization: Token proveit-factory-token-2026" \
  "http://localhost:8086/api/v2/query?org=proveit" \
  --data-urlencode 'query=from(bucket:"factory") |> range(start:-1m) |> count()'
```

### Claude not responding

1. Verify AWS credentials are configured (`aws sts get-caller-identity`)
2. Check that the IAM role/user has Bedrock access
3. Look for error messages in server console

---

## Next Steps

- [[Development-Setup]] - Configure your dev environment with auto-reload
- [[Configuration-Reference]] - All configuration options explained
- [[Live-Demo-Guide]] - Prepare for ProveIt! Conference demonstration
