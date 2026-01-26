# EC2 Production Deployment

AWS EC2 deployment guide for EdgeMind production environment.

## Production Environment

| Property | Value |
|----------|-------|
| **EC2 Host** | `<YOUR_EC2_IP>` |
| **Container Name** | `edgemind-backend` |
| **Application Port** | `3000` |
| **Production URL** | `http://<YOUR_EC2_IP>:3000` |
| **Docker Network** | `edgemind-net` |

## Docker Network Architecture

All containers must be on the same Docker network for inter-container communication:

```
┌─────────────────────────────────────────────────────────────┐
│                    edgemind-net (Docker Network)             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ edgemind-backend │  │   influxdb   │  │   chromadb    │  │
│  │     :3000        │──│    :8086     │  │    :8000      │  │
│  └──────────────────┘  └──────────────┘  └───────────────┘  │
│           │                   ▲                  ▲           │
│           └───────────────────┴──────────────────┘           │
│                    Internal Container DNS                    │
└─────────────────────────────────────────────────────────────┘
```

### Network Setup

```bash
# Create shared network (one-time)
sudo docker network create edgemind-net

# Connect all containers to the network
sudo docker network connect edgemind-net edgemind-backend
sudo docker network connect edgemind-net influxdb
sudo docker network connect edgemind-net chromadb
```

### ChromaDB Container (Vector Store)

```bash
# Start ChromaDB for anomaly persistence
sudo docker run -d \
  --name chromadb \
  --network edgemind-net \
  -p 8000:8000 \
  chromadb/chroma:latest
```

## SSH Connection

### SSH Key Location

```bash
SSH_KEY=~/.ssh/edgemind-demo.pem
EC2_HOST=ec2-user@<YOUR_EC2_IP>
```

### Connect to EC2

```bash
ssh -i ~/.ssh/edgemind-demo.pem ec2-user@<YOUR_EC2_IP>
```

### Set Up Shell Aliases (Optional)

Add to `~/.bashrc` or `~/.zshrc`:

```bash
export SSH_KEY=~/.ssh/edgemind-demo.pem
export EC2_HOST=ec2-user@<YOUR_EC2_IP>

alias edgemind-ssh="ssh -i \$SSH_KEY \$EC2_HOST"
alias edgemind-deploy="scp -i \$SSH_KEY"
```

## File Mount Architecture

Production uses a hybrid approach for file updates:

```
EC2 Host ~/app/
+-------------------+
|  server.js        | <-- Bind-mounted (auto-reloads on change)
|  index.html       | <-- Bind-mounted (auto-reloads on change)
+-------------------+

Docker Container /app/
+-------------------+
|  server.js (ro)   | <-- From bind mount
|  index.html (ro)  | <-- From bind mount
|  styles.css       | <-- NOT mounted (requires docker cp)
|  app.js           | <-- NOT mounted (requires docker cp)
|  lib/             | <-- NOT mounted (requires docker cp + restart)
+-------------------+
```

| File | Mount Type | Update Method |
|------|-----------|---------------|
| `server.js` | Bind-mounted (read-only) | SCP to `~/app/` - auto-reloads |
| `index.html` | Bind-mounted (read-only) | SCP to `~/app/` - auto-reloads |
| `styles.css` | Not mounted | SCP + `docker cp` |
| `app.js` | Not mounted | SCP + `docker cp` |
| `lib/` | Not mounted | SCP + `docker cp` + restart |

## Deployment Commands

### Deploy server.js (Bind-Mounted, Auto-Reloads)

```bash
SSH_KEY=~/.ssh/edgemind-demo.pem
EC2_HOST=ec2-user@<YOUR_EC2_IP>

scp -i $SSH_KEY server.js $EC2_HOST:~/app/server.js
```

The server auto-restarts because `server.js` is bind-mounted.

### Deploy index.html (Bind-Mounted, Auto-Reloads)

```bash
scp -i $SSH_KEY index.html $EC2_HOST:~/app/
```

Changes appear immediately on browser refresh.

### Deploy styles.css and app.js (Requires docker cp)

```bash
# Copy files to EC2
scp -i $SSH_KEY styles.css app.js $EC2_HOST:~/app/

# Copy into running container
ssh -i $SSH_KEY $EC2_HOST "sudo docker cp ~/app/styles.css edgemind-backend:/app/ && \
                           sudo docker cp ~/app/app.js edgemind-backend:/app/"
```

Changes appear on browser refresh.

### Deploy lib/ Folder (Requires docker cp + Restart)

```bash
# Copy lib folder to EC2
scp -i $SSH_KEY -r lib/* $EC2_HOST:~/app/lib/

# Copy into container
ssh -i $SSH_KEY $EC2_HOST "sudo docker cp ~/app/lib edgemind-backend:/app/"

# Restart container to load new modules
ssh -i $SSH_KEY $EC2_HOST "sudo docker restart edgemind-backend"
```

### Verify Deployment

```bash
# Wait for restart and check health
ssh -i $SSH_KEY $EC2_HOST "sleep 5 && curl -s http://localhost:3000/health"
```

Expected output:
```json
{
  "status": "online",
  "mqtt": true,
  "influxdb": true,
  "stats": {
    "messageCount": 12345,
    "influxWrites": 12340
  }
}
```

## Complete Deployment Script

Deploy all files at once:

```bash
#!/bin/bash
# deploy-all.sh

SSH_KEY=~/.ssh/edgemind-demo.pem
EC2_HOST=ec2-user@<YOUR_EC2_IP>

echo "Deploying EdgeMind to production..."

# Step 1: Deploy bind-mounted files (auto-reload)
echo "1/4: Deploying server.js and index.html..."
scp -i $SSH_KEY server.js index.html $EC2_HOST:~/app/

# Step 2: Deploy frontend files
echo "2/4: Deploying styles.css and app.js..."
scp -i $SSH_KEY styles.css app.js $EC2_HOST:~/app/
ssh -i $SSH_KEY $EC2_HOST "sudo docker cp ~/app/styles.css edgemind-backend:/app/ && \
                           sudo docker cp ~/app/app.js edgemind-backend:/app/"

# Step 3: Deploy lib folder
echo "3/4: Deploying lib/ modules..."
scp -i $SSH_KEY -r lib/* $EC2_HOST:~/app/lib/
ssh -i $SSH_KEY $EC2_HOST "sudo docker cp ~/app/lib edgemind-backend:/app/"

# Step 4: Restart and verify
echo "4/4: Restarting container..."
ssh -i $SSH_KEY $EC2_HOST "sudo docker restart edgemind-backend"

echo "Waiting for server to start..."
sleep 5

echo "Verifying deployment..."
ssh -i $SSH_KEY $EC2_HOST "curl -s http://localhost:3000/health" | jq

echo "Deployment complete!"
echo "Production URL: http://<YOUR_EC2_IP>:3000"
```

Make executable and run:

```bash
chmod +x deploy-all.sh
./deploy-all.sh
```

## Container Management

### View Container Status

```bash
ssh -i $SSH_KEY $EC2_HOST "sudo docker ps"
```

### View Container Logs

```bash
# Last 100 lines
ssh -i $SSH_KEY $EC2_HOST "sudo docker logs edgemind-backend --tail 100"

# Follow logs (Ctrl+C to exit)
ssh -i $SSH_KEY $EC2_HOST "sudo docker logs edgemind-backend -f"
```

### Restart Container

```bash
ssh -i $SSH_KEY $EC2_HOST "sudo docker restart edgemind-backend"
```

### Stop Container

```bash
ssh -i $SSH_KEY $EC2_HOST "sudo docker stop edgemind-backend"
```

### Start Container

```bash
ssh -i $SSH_KEY $EC2_HOST "sudo docker start edgemind-backend"
```

## ChromaDB (Vector Store)

ChromaDB runs as a separate container for anomaly persistence and RAG capabilities.

### Configuration

| Property | Value |
|----------|-------|
| **Container Name** | `chromadb` |
| **Network** | `edgemind-net` |
| **Port** | `8000` |
| **Volume** | `chromadb-data:/data` |
| **Backend Env** | `CHROMA_HOST=chromadb` |
| **Health Endpoint** | `GET /api/v2/heartbeat` |

### Check ChromaDB Status

```bash
ssh -i $SSH_KEY $EC2_HOST "docker ps | grep chromadb"
```

### Check ChromaDB Health

```bash
ssh -i $SSH_KEY $EC2_HOST "curl -s http://localhost:8000/api/v2/heartbeat"
```

### View ChromaDB Logs

```bash
ssh -i $SSH_KEY $EC2_HOST "docker logs chromadb --tail=20"
```

### Redeploy ChromaDB (with Persistence)

```bash
ssh -i $SSH_KEY $EC2_HOST "sudo docker stop chromadb && sudo docker rm chromadb && sudo docker run -d --name chromadb --network edgemind-net -p 8000:8000 -v chromadb-data:/data --restart unless-stopped chromadb/chroma"
```

This command:
1. Stops and removes the existing container
2. Creates a new container with persistent volume
3. Connects to `edgemind-net` for backend communication
4. Sets `--restart unless-stopped` for automatic recovery

### Verify ChromaDB Connection from Backend

```bash
ssh -i $SSH_KEY $EC2_HOST "sudo docker exec edgemind-backend curl -s http://chromadb:8000/api/v2/heartbeat"
```

## Monitoring Production

### Health Check

```bash
curl http://<YOUR_EC2_IP>:3000/health
```

### View API Endpoints

```bash
# Trends
curl http://<YOUR_EC2_IP>:3000/api/trends

# OEE
curl "http://<YOUR_EC2_IP>:3000/api/oee/v2?enterprise=ALL"

# Schema
curl http://<YOUR_EC2_IP>:3000/api/schema/hierarchy
```

### WebSocket Connection Test

Open browser console at `http://<YOUR_EC2_IP>:3000`:

```javascript
// Check connection
console.log(window.ws.readyState);  // 1 = OPEN
```

## Troubleshooting

### Container Not Responding

```bash
# Check if container is running
ssh -i $SSH_KEY $EC2_HOST "sudo docker ps | grep edgemind"

# Check container logs
ssh -i $SSH_KEY $EC2_HOST "sudo docker logs edgemind-backend --tail 50"

# Restart container
ssh -i $SSH_KEY $EC2_HOST "sudo docker restart edgemind-backend"
```

### MQTT Disconnected

```bash
# Check MQTT status in logs
ssh -i $SSH_KEY $EC2_HOST "sudo docker logs edgemind-backend 2>&1 | grep MQTT"

# Common cause: network connectivity
# Solution: restart container
ssh -i $SSH_KEY $EC2_HOST "sudo docker restart edgemind-backend"
```

### InfluxDB Errors

```bash
# Check InfluxDB container
ssh -i $SSH_KEY $EC2_HOST "sudo docker ps | grep influxdb"

# View InfluxDB logs
ssh -i $SSH_KEY $EC2_HOST "sudo docker logs influxdb --tail 50"
```

### Permission Denied on docker cp

```bash
# Ensure using sudo
ssh -i $SSH_KEY $EC2_HOST "sudo docker cp ~/app/file.js edgemind-backend:/app/"
```

### File Not Found After Deploy

```bash
# Verify file exists on EC2
ssh -i $SSH_KEY $EC2_HOST "ls -la ~/app/"

# Verify file is in container
ssh -i $SSH_KEY $EC2_HOST "sudo docker exec edgemind-backend ls -la /app/"
```

## Production Checklist

Before deploying to production:

- [ ] Test changes locally with `npm run dev`
- [ ] Verify health endpoint works
- [ ] Check for console errors in browser
- [ ] Ensure no sensitive data in code (API keys, passwords)
- [ ] Verify MQTT connection is stable

After deploying:

- [ ] Check health endpoint: `curl http://<YOUR_EC2_IP>:3000/health`
- [ ] Verify dashboard loads: `http://<YOUR_EC2_IP>:3000`
- [ ] Check LIVE indicator is green
- [ ] View container logs for errors
- [ ] Test API endpoints

## Related Documentation

- [[Docker-Deployment]] - Docker Compose and Dockerfile details
- [[Local-Development]] - Local testing before deployment
- [[Configuration-Reference]] - Environment variables
