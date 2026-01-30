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

### 2026-01-26 - OEE Line Query Missing Metrics and Wrong Filter (PR #9)
- **Issue**: `/api/oee/lines` endpoint returned incomplete data - missing A/P/Q components and some lines entirely
- **Root Cause**: Multiple issues:
  1. Query only searched `OEE_*` measurements, missing `metric_*` naming convention (Enterprise B uses `metric_availability`, not `OEE_Availability`)
  2. Value filter `r._value > 0.1` excluded valid low values (0.05 = 5% is valid)
  3. No pivot - couldn't get OEE + A/P/Q in single query
  4. Components (availability, performance, quality) returned as `null`
- **Solution**: Rewrote query in `server.js` `/api/oee/lines`:
  ```javascript
  // Query BOTH naming conventions
  r._measurement == "OEE_Availability" or r._measurement == "metric_availability"

  // Use > 0 not > 0.1
  |> filter(fn: (r) => r._value > 0 and r._value <= 150)

  // Pivot to get all metrics in one row
  |> pivot(rowKey: ["enterprise", "site", "area"], columnKey: ["_measurement"], valueColumn: "_value")

  // Normalize with fallback between naming conventions
  const availability = normalize(o.OEE_Availability ?? o.metric_availability);

  // Calculate OEE from components if not directly available
  if (oee === null && availability && performance && quality) {
    oee = (availability/100) * (performance/100) * (quality/100) * 100;
  }
  ```
- **Prevention**:
  - Always query BOTH `OEE_*` AND `metric_*` naming conventions for OEE-related measurements
  - Use `> 0` not `> 0.1` for value filters (low percentages are valid)
  - Use InfluxDB `pivot()` to get related measurements in single query
  - Commit: `4ff3dbd`

### 2026-01-28 - OEE Value Inconsistency (72% vs 10.6%)
- **Issue**: Same enterprise returned wildly different OEE values between consecutive AI trend analysis runs: 72% vs 10.6%
- **Root Cause**: Value format detection used cached `sampleValues` from schema discovery to determine if data was decimal (0.72 = 72%) or percentage (72 = 72%). The threshold of 1.5 was problematic:
  - If discovery saw values `[0.72, 0.85]` -> detected as `decimal` -> multiplied by 100 -> 72%
  - If discovery saw values `[10.6, 13.8]` -> detected as `percentage` (>1.5) -> NOT multiplied -> 10.6%
  - The `oeeConfig.enterprises` singleton cached the first detection, but schema refresh could change sample values while keeping stale valueFormat
- **Solution**: Changed normalization to detect format from **actual queried values** at runtime, not cached config:
  ```javascript
  // ROBUST NORMALIZATION: Detect format from actual value, not cached config
  // Values <= 1.5 are decimal (0.72 = 72%), values > 1.5 are already percentages
  const actualFormat = (oeeValue !== null && oeeValue <= 1.5) ? 'decimal' : 'percentage';
  if (oeeValue !== null && actualFormat === 'decimal') {
    oeeValue = oeeValue * 100;
  }
  ```
  Added comprehensive logging with request IDs to track tier, raw values, and normalization decisions.
- **Prevention**:
  - Always normalize OEE values based on the actual queried value, not cached metadata
  - Add logging with unique request IDs to trace calculation paths in production
  - Files affected: `lib/oee/index.js`

### 2026-01-28 - InfluxDB Flux Query Missing group() Before mean()
- **Issue**: Enterprise B OEE showed 10.6% with 13.8% performance, but `/api/trends` showed 70.6% OEE and 87.9% performance for the same data
- **Root Cause**: Flux queries in `lib/oee/index.js` calculated `|> mean()` without first using `|> group()` to consolidate all time series. InfluxDB returns one row per unique tag combination (site × area × machine), and the JavaScript code looped through results overwriting the value on each iteration - keeping only the **last row's value** instead of the enterprise-wide average.
  ```flux
  // WRONG - returns multiple rows, JS keeps last one only
  |> filter(fn: (r) => r._value > 0)
  |> mean()

  // CORRECT - consolidates all series before averaging
  |> filter(fn: (r) => r._value > 0)
  |> group()
  |> mean()
  ```
- **Solution**: Added `|> group()` before `|> mean()` in three locations:
  1. Tier 1 overall OEE query (~line 191)
  2. Tier 1 component queries (~line 246)
  3. Tier 2 component queries (~line 324)
- **Prevention**:
  - **ALWAYS use `|> group()` before `|> mean()` when you need a single aggregate value across multiple tag combinations**
  - InfluxDB groups by tags by default - each unique tag combination creates a separate series
  - Without `group()`, aggregate functions operate per-series and return multiple rows
  - This is an InfluxDB/Flux gotcha that's easy to miss and produces subtly wrong results
- **Files affected**: `lib/oee/index.js`

### 2026-01-30 - OEE Blended Mean Inflates Dashboard Values
- **Issue**: Dashboard card showed 76.4% OEE for Enterprise A while AI insights reported 60.8%
- **Root Cause**: Legacy `queryOEE()` averaged Availability, Performance, Quality, AND OEE into a single `mean()`, inflating the result. The v2 endpoint correctly separated A/P/Q/OEE.
- **Solution**: Redirected `queryOEE()` and `queryOEEBreakdown()` to delegate to `calculateOEEv2()`, eliminating the legacy blended-mean code path
- **Prevention**: Only one OEE calculation path should exist. All endpoints should delegate to the tier-based v2 system.
- **Commit**: `fafaee4`

### 2026-01-30 - AVEVA Enterprise Name Collision
- **Issue**: Two separate "AVEVA - DALLAS" and "Dallas Line 1" entries appeared for the same site; enterprises appeared duplicated
- **Root Cause**: MQTT broker publishes both `Enterprise A` and `AVEVA Enterprise A` topic prefixes. No normalization at write time, so InfluxDB stored both as separate tag values.
- **Solution**: Added enterprise/site alias normalization maps in `lib/influx/writer.js` with `normalizeTag()` applied at write time. Old data self-heals within 24h query window.
- **Prevention**: Always normalize incoming tag values at the InfluxDB write layer. Add new aliases to `ENTERPRISE_ALIASES` or `SITE_ALIASES` maps when new naming variants appear.
- **Commit**: `fafaee4`

### 2026-01-30 - normalizeTag() Null Crash on Sparkplug Paths
- **Issue**: Server crash when Sparkplug B messages provided null enterprise/site values
- **Root Cause**: `normalizeTag()` didn't handle null/undefined inputs from Sparkplug topic parsing
- **Solution**: Added null guard: `if (!value || typeof value !== 'string') return value || 'unknown'`
- **Prevention**: All tag normalization functions must handle null/undefined gracefully
- **Commit**: `fafaee4`

### 2026-01-30 - totalOee += null Produces NaN
- **Issue**: Enterprise-level OEE averages returned NaN when any site had null OEE
- **Root Cause**: `totalOee += null` evaluates to NaN in JavaScript, poisoning the running sum
- **Solution**: Added null check before accumulating: skip sites with null OEE, only average sites with valid values
- **Commit**: `fafaee4`

### 2026-01-30 - Tier 2 OEE Treats 0% as Null
- **Issue**: Legitimate 0% OEE values were treated as missing data
- **Root Cause**: Truthiness check `normAvail ? ... : null` treats `0` as falsy, so 0% availability was treated as null
- **Solution**: Changed to explicit null check: `normAvail !== null ? ... : null`
- **Prevention**: Never use truthiness checks for numeric values that can legitimately be 0. Always use `!== null` or `!== undefined`.
- **Commit**: `fafaee4`

### 2026-01-30 - Dockerfile References Deleted Files After CSS Modularization
- **Issue**: Docker build failed: `COPY styles.css ./` and `COPY app.js ./` — files no longer exist after splitting into `css/` and `js/` directories
- **Root Cause**: Dockerfile wasn't updated when frontend was modularized from monolithic files to directory-based modules
- **Solution**: Changed to `COPY css/ ./css/` and `COPY js/ ./js/`
- **Prevention**: When restructuring files (especially renaming or splitting), always update Dockerfile COPY commands
- **Commit**: `4a18841`

### 2026-01-30 - Persona Sub-Nav Race Condition
- **Issue**: Menu items disappeared when clicking persona chips — sub-nav showed blank
- **Root Cause**: `incrementSwitchCounter()` was called inside `setTimeout` guards, incrementing the counter on every poll check. The guard `if (switchCounter !== currentSwitch)` always triggered because the counter kept changing.
- **Solution**: Changed setTimeout guards to read-only `switchCounter` comparison instead of calling `incrementSwitchCounter()` inside the guard
- **Prevention**: Never mutate state inside guard conditions. Guard checks should be read-only comparisons.
- **Commit**: `31df780`

### 2026-01-30 - Page Always Resets to COO View on Refresh
- **Issue**: Refreshing the browser always returned to COO persona regardless of which persona was active
- **Root Cause**: No persistence mechanism — persona state was only in memory
- **Solution**: Added URL hash-based persistence (`#coo`, `#plant`, `#demo`). Hash is written on persona switch, read on init, and monitored via `hashchange` listener.
- **Commit**: `7c1c00c`

### 2026-01-30 - Production Line OEE Styles Lost in CSS Modularization
- **Issue**: Enterprise B's Production Line OEE panel rendered unstyled — cards stacked without grid layout
- **Root Cause**: ~170 lines of CSS for `.line-oee-panel`, `.line-card`, `.line-oee-grid` etc. were dropped during the CSS modularization refactor (splitting `styles.css` into 20 files)
- **Solution**: Created `css/line-oee.css` with recovered styles from git history (`git show fe37f36^:styles.css`), added import in `index.html`
- **Prevention**: When splitting a monolithic CSS file, verify every class selector is preserved in one of the output files. Use `grep` to cross-reference.
- **Commit**: `a6f999b`

### 2026-01-30 - Production Heatmap Ignores Enterprise Filter
- **Issue**: Production heatmap showed all enterprises regardless of filter selection
- **Root Cause**: `/api/factory/status` endpoint never read `req.query.enterprise`, and `queryFactoryStatus()` accepted no parameters — always queried all enterprises
- **Solution**: Added enterprise parameter to `queryFactoryStatus(enterprise)` with input validation and conditional Flux filter. Updated endpoint to pass `req.query.enterprise`.
- **Commit**: `cc0c662`

### 2026-01-30 - MQTT Reconnect Storm (Cascading Failures)
- **Issue**: Multiple `✅ Connected to MQTT broker!` log entries, Bedrock 429 throttling, InfluxDB timeouts — all simultaneously
- **Root Cause**: No stable `clientId` on MQTT connection caused broker to treat each reconnect as new client. The `on('connect')` handler re-initialized everything (trend analysis loop, schema refresh, etc.) on every reconnect, spawning duplicate intervals.
- **Solution**: Added stable `clientId: edgemind-${hostname}-${pid}`, `clean: false` for session persistence, and `initialized` guard flag on connect handler to prevent duplicate initialization
- **Prevention**: MQTT clients MUST use stable clientIds. Connect handlers must be idempotent — use guard flags to prevent re-initialization on reconnect.
- **Commit**: `dbeded3`

### 2026-01-30 - Demo MQTT Publishes Not Appearing on Broker (QoS 0)
- **Issue**: Demo engine logged "Published" but messages never appeared in MQTT Explorer
- **Root Cause**: QoS 0 (fire-and-forget) combined with reconnect instability silently dropped messages
- **Solution**: Changed both `mqttClient.publish()` calls in demo engine from `{ qos: 0 }` to `{ qos: 1 }` (at-least-once delivery)
- **Prevention**: Use QoS 1 for any publishes that need confirmation. QoS 0 is only appropriate for high-frequency telemetry where occasional loss is acceptable.
- **Commit**: `dbeded3`

### 2026-01-30 - npm audit Blocks GitHub Actions Deploy (fast-xml-parser CVE)
- **Issue**: `npm audit --audit-level=high` exit code 1 — blocked deploy pipeline
- **Root Cause**: `fast-xml-parser@5.2.5` (transitive dependency via `@aws-sdk/xml-builder@3.972.2`) has vulnerability GHSA-37qj-frw5-hhjh. AWS SDK hadn't updated to the patched version.
- **Solution**: Added npm `overrides` in `package.json` to force `fast-xml-parser@5.3.4`. Audit now passes cleanly.
- **Prevention**: Use npm `overrides` for transitive dependency vulnerabilities when the direct dependency maintainer hasn't released a fix. Check periodically if the upstream has updated and remove the override.
- **Commit**: `97ccfa1`

<!-- Add new bugs above this line -->
