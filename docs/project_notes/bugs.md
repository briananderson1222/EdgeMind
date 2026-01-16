# Bug Log

This file tracks bugs encountered and their solutions for future reference.

## Format

- **Date** (YYYY-MM-DD)
- **Issue**: What went wrong
- **Root Cause**: Why it happened
- **Solution**: How it was fixed
- **Prevention**: How to avoid it in the future

---

## Entries

### 2026-01-15 - Container Recreation Loses Files
- **Issue**: After running `docker-compose up --force-recreate` or `toggle-insights.sh`, the app crashes
- **Root Cause**: `lib/`, `styles.css`, `app.js` are NOT bind-mounted - they're copied INTO the container and lost on recreation
- **Solution**: Re-copy files using `docker cp`:
  ```bash
  ssh -i $SSH_KEY $EC2_HOST "sudo docker cp ~/app/lib edgemind-backend:/app/"
  ssh -i $SSH_KEY $EC2_HOST "sudo docker cp ~/app/styles.css edgemind-backend:/app/ && sudo docker cp ~/app/app.js edgemind-backend:/app/"
  ```
- **Prevention**: Avoid `--force-recreate`. Use `docker restart` for safe restarts. See CLAUDE.md "Container Recreation Warning" section.

### 2026-01-15 - ChromaDB Container Network Isolation
- **Issue**: Vector store failed to initialize with "Failed to connect to chromadb"
- **Root Cause**: ChromaDB and edgemind-backend containers were on separate Docker networks - containers can't communicate across networks by default
- **Solution**: Create shared network and connect both containers:
  ```bash
  sudo docker network create edgemind-net
  sudo docker network connect edgemind-net chromadb
  sudo docker network connect edgemind-net edgemind-backend
  sudo docker network connect edgemind-net influxdb
  ```
- **Prevention**: Always add new containers to the `edgemind-net` network when deploying services that need to communicate

### 2026-01-15 - ChromaDB Client Defaulting to Localhost
- **Issue**: ChromaDB client tried to connect to `localhost:8000` instead of the chromadb container
- **Root Cause**: Code used `new ChromaClient()` without specifying the host - defaults to localhost which doesn't work in Docker
- **Solution**: Added environment variable support in `lib/vector/index.js`:
  ```javascript
  const chromaHost = process.env.CHROMA_HOST || 'localhost';
  chromaClient = new ChromaClient({ path: `http://${chromaHost}:${chromaPort}` });
  ```
  And set `CHROMA_HOST=chromadb` in container environment
- **Prevention**: Always parameterize service hostnames for Docker deployments

### 2026-01-15 - ECR Image Missing Node Modules
- **Issue**: Container crashed with "Cannot find module 'sparkplug-payload'" and other missing modules
- **Root Cause**: The ECR Docker image was built without all required dependencies - `package.json` was updated but image wasn't rebuilt
- **Solution**: Run npm install in a temporary container and mount the resulting node_modules:
  ```bash
  sudo docker run --rm -v ~/app/package.json:/app/package.json -v ~/npm_cache:/app/node_modules node:18 npm install --production
  # Then mount ~/npm_cache as /app/node_modules in the main container
  ```
- **Prevention**: Rebuild and push ECR image after any `package.json` changes, or use volume-mounted node_modules

### 2026-01-15 - WebSocket Port Not Exposed
- **Issue**: Frontend showed "DISCONNECTED" - WebSocket couldn't connect
- **Root Cause**: Docker run command only mapped port 3000, but forgot port 8080 wasn't actually needed (WebSocket is on /ws path of port 3000)
- **Solution**: The actual fix was that `app.js` was missing from container (see below)
- **Prevention**: Check container file contents when debugging connection issues

### 2026-01-15 - app.js Missing from Container
- **Issue**: Frontend connected via WebSocket but immediately disconnected
- **Root Cause**: `app.js` wasn't copied into container after recreation - only `styles.css` was present
- **Solution**: Copy app.js into container: `sudo docker cp ~/app/app.js edgemind-backend:/app/`
- **Prevention**: Always copy both `app.js` AND `styles.css` after container recreation

### 2026-01-15 - styles.css Not Linked in index.html
- **Issue**: Settings modal rendered unstyled at bottom of page, CSS broken throughout
- **Root Cause**: CSS was extracted to separate `styles.css` file but `<link rel="stylesheet" href="styles.css">` was never added to `index.html`
- **Solution**: Added the stylesheet link in the `<head>` section of `index.html`:
  ```html
  <link rel="stylesheet" href="styles.css">
  ```
- **Prevention**: When extracting inline styles to external files, always add the corresponding link tag

### 2026-01-15 - Quality Metrics Panel Wrong Width
- **Issue**: Quality Metrics panel appeared narrower than Production Heatmap panel
- **Root Cause**: `.quality-panel` was set to `grid-column: span 4` while `.chart-panel` was `span 6`
- **Solution**: Changed quality-panel to span 6 columns with min-height:
  ```css
  .quality-panel {
      grid-column: span 6;
      min-height: 450px;
  }
  ```
- **Prevention**: When adding new grid panels, ensure column spans are balanced (12-column grid)

### 2026-01-15 - ChromaDB v2 API Migration
- **Issue**: ChromaDB healthcheck returned `410 Gone` with message "The v1 API is deprecated"
- **Root Cause**: ChromaDB upgraded from v1 to v2 API - the `/api/v1/heartbeat` endpoint was removed
- **Solution**: Updated all healthcheck endpoints from `/api/v1/heartbeat` to `/api/v2/heartbeat`:
  - `docker-compose.local.yml`
  - `docker-compose.yml`
  - `local-deploy.sh`
- **Prevention**: Pin ChromaDB version in docker-compose or monitor ChromaDB release notes for breaking changes

### 2026-01-15 - ChromaDB Volume Mount Path Changed
- **Issue**: ChromaDB data not persisting despite volume mount
- **Root Cause**: Older ChromaDB versions used `/chroma/chroma` for data, newer versions use `/data`
- **Solution**: Updated volume mount from `-v chromadb-data:/chroma/chroma` to `-v chromadb-data:/data`
- **Prevention**: Check ChromaDB logs for "Saving data to:" path when debugging persistence issues

### 2026-01-15 - ChromaDB Healthcheck Curl Not Available
- **Issue**: Docker healthcheck failed with "curl: executable file not found in $PATH"
- **Root Cause**: ChromaDB container image doesn't include curl, wget, or python in PATH
- **Solution**: Changed healthcheck from curl to bash TCP check:
  ```yaml
  healthcheck:
    test: ["CMD-SHELL", "bash -c 'echo > /dev/tcp/localhost/8000'"]
  ```
- **Prevention**: Always verify what binaries are available in container images before writing healthchecks. Use `docker exec <container> ls /bin /usr/bin` to check.

### 2026-01-15 - Dockerfile Missing lib/ Folder
- **Issue**: Backend container crashed with "Cannot find module './lib/influx/client'"
- **Root Cause**: Dockerfile only copied `server.js` and `index.html`, missing the `lib/` folder and frontend files (`styles.css`, `app.js`)
- **Solution**: Added missing COPY commands to Dockerfile:
  ```dockerfile
  COPY styles.css ./
  COPY app.js ./
  COPY lib/ ./lib/
  ```
- **Prevention**: When modularizing code into new folders, always update Dockerfile to include them. Run `docker exec <container> ls -la` to verify all expected files are present.

### 2026-01-15 - ECS ChromaDB Health Check Fails (No Curl in Container)
- **Issue**: ChromaDB ECS Fargate service failed to deploy with "ECS Deployment Circuit Breaker was triggered"
- **Root Cause**: CDK health check used `curl -f http://localhost:8000/api/v2/heartbeat` but `chromadb/chroma` Docker image doesn't have curl installed. Python urllib also failed.
- **Solution**: Use bash TCP check (same solution as local Docker):
  ```python
  health_check=ecs.HealthCheck(
      command=["CMD-SHELL", "bash -c 'echo > /dev/tcp/localhost/8000'"],
      interval=Duration.seconds(30),
      timeout=Duration.seconds(5),
      retries=3,
      start_period=Duration.seconds(60)
  )
  ```
- **Prevention**: When writing ECS health checks, verify what binaries are available in the container image. For containers with bash, use TCP checks via `/dev/tcp/`. This is the same solution used in docker-compose.

### 2026-01-16 - CloudFront WebSocket Path Pattern Mismatch
- **Issue**: WebSocket showed "DISCONNECTED" - frontend couldn't connect through CloudFront
- **Root Cause**: CloudFront behavior pattern `/ws/*` doesn't match `/ws` (without trailing slash). CloudFront patterns are exact - `/ws/*` matches `/ws/anything` but NOT `/ws` alone.
- **Solution**: Add separate behavior for `/ws` in addition to `/ws/*`:
  ```python
  additional_behaviors={
      "/ws": cloudfront.BehaviorOptions(...),   # Matches /ws exactly
      "/ws/*": cloudfront.BehaviorOptions(...), # Matches /ws/anything
  }
  ```
- **Prevention**: When routing paths in CloudFront, always add both exact path and wildcard pattern if the endpoint might be accessed with or without trailing content.

### 2026-01-16 - MQTT Secret Missing Protocol Prefix
- **Issue**: Backend failed to connect to MQTT broker with "Missing protocol" error
- **Root Cause**: MQTT_HOST secret contained `virtualfactory.proveit.services` without the `mqtt://` protocol prefix and port
- **Solution**: Update secret to include full URL with protocol and port:
  ```json
  {"host":"mqtt://virtualfactory.proveit.services:1883", ...}
  ```
- **Prevention**: MQTT host values must always include the protocol (`mqtt://` or `mqtts://`) and port. Document the expected format in key_facts.md.

### 2026-01-15 - AWS Secrets Manager: Special Characters in Passwords
- **Issue**: Backend ECS task failed with "invalid character '!' in string escape code" when retrieving MQTT secret
- **Root Cause**: Password containing `!` was escaped as `\!` when using inline JSON in shell command. Bash history expansion and shell escaping mangled the password.
- **Solution**: Write JSON to a temp file and use `file://` prefix:
  ```bash
  cat > /tmp/secret.json << 'ENDJSON'
  {"host":"example.com","password":"pass!word"}
  ENDJSON
  aws secretsmanager put-secret-value --secret-id my-secret --secret-string file:///tmp/secret.json
  rm /tmp/secret.json
  ```
- **Prevention**: Always use heredoc with `'ENDJSON'` (single-quoted delimiter) and file:// for secrets containing special characters (`!`, `$`, backticks, etc.)

<!-- Add new bugs above this line -->
