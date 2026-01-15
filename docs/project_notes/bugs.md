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

### 2025-01-15 - Container Recreation Loses Files
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

<!-- Add new bugs above this line -->
