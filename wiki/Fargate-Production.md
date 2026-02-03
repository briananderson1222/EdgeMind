# Fargate Production Deployment

Automated production deployment for EdgeMind on AWS ECS Fargate, managed entirely through GitHub Actions CI/CD.

> **Rule:** Never manually fix production. All changes flow through pull requests to `main`.

## Production Environment

| Property | Value |
|----------|-------|
| **Production URL** | https://edge-mind.concept-reply-sandbox.com |
| **Health Check** | https://edge-mind.concept-reply-sandbox.com/health |
| **ECS Cluster** | `edgemind-prod-cluster` |
| **AWS Region** | `us-east-1` |
| **Auth Method** | GitHub OIDC (no long-lived credentials) |

### Services

| Service | Runtime | Image / Hosting |
|---------|---------|-----------------|
| **Backend** (Node.js) | ECS Fargate task | ECR: `edgemind-prod-backend` |
| **InfluxDB** | ECS Fargate task | `influxdb:2.7` |
| **ChromaDB** (vector store) | ECS Fargate task | `chromadb/chroma` |
| **Frontend** | S3 + CloudFront CDN | Bucket: `edgemind-prod-frontend` |

```
                    Production Architecture

  Browser ──── CloudFront CDN ──── S3 (frontend static files)
                    │
                    │ /health, /api/*, /ws
                    ▼
          ┌─────────────────────────────────────────────┐
          │         ECS Fargate: edgemind-prod-cluster   │
          │                                              │
          │  ┌──────────────┐                            │
          │  │   Backend    │──── MQTT Broker             │
          │  │   (Node.js)  │    (virtualfactory)         │
          │  │   Port 3000  │                            │
          │  └──────┬───────┘                            │
          │         │                                    │
          │    ┌────┴────┐                               │
          │    ▼         ▼                               │
          │ InfluxDB  ChromaDB                           │
          │  :8086     :8000                             │
          └─────────────────────────────────────────────┘
                    │
                    ▼
              CloudWatch Logs
```

## Deployment Workflow

All deployments are automated. Push code to a feature branch, open a pull request to `main`, and merge. GitHub Actions handles the rest.

### Step-by-step

1. Create a feature branch and make changes:

```bash
$ git checkout -b feature/my-change
# ... make changes ...
$ git add -A && git commit -m "fix: description of change"
$ git push origin feature/my-change
```

2. Open a pull request to `main`:

```bash
$ gh pr create --base main --title "Fix: description of change"
```

3. Merge the PR. GitHub Actions triggers automatically based on which files changed.

4. Verify the deployment:

```bash
$ curl -s https://edge-mind.concept-reply-sandbox.com/health | jq
```

Expected output:

```json
{
  "status": "online",
  "mqtt": true,
  "influxdb": true
}
```

## GitHub Actions Pipeline

Two independent workflows trigger on push to `main`. Each runs only when relevant files change.

### Backend: `deploy-backend.yml`

**Triggers on changes to:** `server.js`, `lib/**`, `package.json`, `package-lock.json`, `Dockerfile`

| Step | Action |
|------|--------|
| 1. Checkout | Clone repository |
| 2. Setup Node.js | Install Node.js 18 |
| 3. Install | `npm ci` |
| 4. Lint | `npm run lint` |
| 5. Test | `npm test` |
| 6. AWS Auth | OIDC credential exchange (no stored keys) |
| 7. ECR Login | Authenticate to Amazon ECR |
| 8. Build + Push | Docker build, tag with commit SHA + `latest`, push to ECR |
| 9. Task Definition | Download current ECS task definition, update image |
| 10. Deploy | Register new task definition, update ECS service |
| 11. Wait | `wait-for-service-stability: true` (blocks until healthy) |

```
Push to main (backend files)
    │
    ▼
  Lint ──► Test ──► Build Docker Image
                         │
                         ▼
                    Push to ECR
                    (edgemind-prod-backend:$SHA)
                    (edgemind-prod-backend:latest)
                         │
                         ▼
                  Update ECS Task Definition
                         │
                         ▼
                  Deploy to ECS Service
                         │
                         ▼
                  Wait for Stability ✓
```

**Key details:**
- Runner: `ubuntu-24.04` (pinned)
- ECR repository: `edgemind-prod-backend`
- ECS service: `edgemind-prod-backend`
- Container name: `backend`
- Images tagged with both commit SHA and `latest`

### Frontend: `deploy-frontend.yml`

**Triggers on changes to:** `index.html`, `css/**`, `js/**`, `assets/**`

| Step | Action |
|------|--------|
| 1. Checkout | Clone repository |
| 2. AWS Auth | OIDC credential exchange |
| 3. S3 Sync | Sync frontend files to S3 bucket with `--delete` |
| 4. Invalidate | Create CloudFront cache invalidation (`/*`) |

```
Push to main (frontend files)
    │
    ▼
  S3 Sync ──► CloudFront Invalidation ✓
```

**Key details:**
- Runner: `ubuntu-24.04` (pinned)
- S3 bucket: `edgemind-prod-frontend`
- Syncs only: `index.html`, `css/*`, `js/*`, `assets/*`
- Old files deleted from S3 (`--delete` flag)
- Full CDN cache invalidation after sync

### GitHub Secrets Required

| Secret | Purpose |
|--------|---------|
| `AWS_ROLE_ARN` | IAM role ARN for OIDC authentication |
| `CLOUDFRONT_DISTRIBUTION_ID` | CloudFront distribution for cache invalidation |

Both workflows can also be triggered manually via `workflow_dispatch` in the GitHub Actions UI.

## Viewing Logs

All ECS services write to CloudWatch. Use the AWS CLI to tail logs in real time.

### Backend Logs

```bash
$ aws logs tail /ecs/edgemind-prod-backend --since 10m --format short
```

### InfluxDB Logs

```bash
$ aws logs tail /ecs/edgemind-prod-influxdb --since 10m --format short
```

### ChromaDB Logs

```bash
$ aws logs tail /ecs/edgemind-prod-chromadb --since 10m --format short
```

### Useful Log Options

```bash
# Follow logs in real time
$ aws logs tail /ecs/edgemind-prod-backend --follow --format short

# Search for errors in the last hour
$ aws logs tail /ecs/edgemind-prod-backend --since 1h --format short \
    --filter-pattern "ERROR"

# Last 30 minutes of a specific service
$ aws logs tail /ecs/edgemind-prod-influxdb --since 30m --format short
```

## CDK Infrastructure

Production infrastructure is defined as Python CDK in the `infra/` directory. Use CDK to create, update, or inspect AWS resources.

### Prerequisites

- AWS CLI configured with the `reply` profile
- Python virtual environment in `infra/`

### Commands

```bash
# Activate the CDK environment
$ cd infra && source .venv/bin/activate

# Preview changes before deploying
$ cdk diff --profile reply

# Deploy all stacks
$ cdk deploy --all --profile reply

# Deploy a specific stack
$ cdk deploy edgemind-prod-backend --profile reply

# List all stacks
$ cdk list --profile reply
```

### When to Use CDK vs CI/CD

| Change | Method |
|--------|--------|
| Application code (backend/frontend) | PR to `main` (CI/CD) |
| New environment variables | CDK deploy (task definition) |
| New AWS resources (S3, IAM, etc.) | CDK deploy |
| Scaling configuration | CDK deploy |
| Infrastructure teardown | CDK destroy |

## Monitoring and Health Checks

### Health Endpoint

The backend exposes `GET /health` with connection status for MQTT and InfluxDB:

```bash
$ curl -s https://edge-mind.concept-reply-sandbox.com/health | jq
```

```json
{
  "status": "online",
  "mqtt": true,
  "influxdb": true,
  "stats": {
    "messageCount": 54321,
    "influxWrites": 54300
  }
}
```

### ECS Service Status

```bash
# Check service status and running task count
$ aws ecs describe-services \
    --cluster edgemind-prod-cluster \
    --services edgemind-prod-backend \
    --query 'services[0].{status:status,running:runningCount,desired:desiredCount}' \
    --output table
```

### CloudWatch Metrics

Key metrics to monitor in the AWS Console under ECS:

| Metric | Healthy Range |
|--------|---------------|
| CPUUtilization | < 80% |
| MemoryUtilization | < 80% |
| RunningTaskCount | Matches DesiredTaskCount |
| HealthCheckStatus | Passing |

### API Spot Checks

```bash
# Verify data flow (trends endpoint)
$ curl -s https://edge-mind.concept-reply-sandbox.com/api/trends | jq '.length'

# Verify OEE calculation
$ curl -s "https://edge-mind.concept-reply-sandbox.com/api/oee/v2?enterprise=ALL" | jq

# Verify schema discovery
$ curl -s https://edge-mind.concept-reply-sandbox.com/api/schema/hierarchy | jq '.enterprises | length'
```

## Troubleshooting

### Issue: Deployment workflow fails at "Wait for service stability"

**Symptoms:**
- GitHub Actions step "Deploy to ECS" times out
- ECS tasks keep restarting

**Checks:**

1. View the latest task's stopped reason:
```bash
$ aws ecs describe-tasks \
    --cluster edgemind-prod-cluster \
    --tasks $(aws ecs list-tasks --cluster edgemind-prod-cluster \
      --service-name edgemind-prod-backend --desired-status STOPPED \
      --query 'taskArns[0]' --output text) \
    --query 'tasks[0].stoppedReason' --output text
```

2. Check CloudWatch logs for crash output:
```bash
$ aws logs tail /ecs/edgemind-prod-backend --since 15m --format short
```

**Common causes:**
- Missing or incorrect environment variables in the task definition
- Health check failing (app crashes before responding on `/health`)
- Out of memory (increase task memory in CDK)

**Fix:** Correct the issue, push a new commit to `main`, and let CI/CD redeploy.

---

### Issue: Health check returns unhealthy MQTT or InfluxDB

**Symptoms:**
- `/health` returns `"mqtt": false` or `"influxdb": false`
- Dashboard shows no live data

**Checks:**

1. Verify InfluxDB task is running:
```bash
$ aws ecs list-tasks --cluster edgemind-prod-cluster \
    --family edgemind-prod-influxdb --desired-status RUNNING
```

2. Check InfluxDB logs:
```bash
$ aws logs tail /ecs/edgemind-prod-influxdb --since 10m --format short
```

3. Check MQTT connectivity in backend logs:
```bash
$ aws logs tail /ecs/edgemind-prod-backend --since 10m --format short \
    --filter-pattern "MQTT"
```

**Fix:** If InfluxDB or ChromaDB tasks have stopped, force a new deployment:
```bash
$ aws ecs update-service --cluster edgemind-prod-cluster \
    --service edgemind-prod-influxdb --force-new-deployment
```

---

### Issue: Frontend changes not visible after merge

**Symptoms:**
- PR merged to `main` with frontend changes
- Production still shows old version

**Checks:**

1. Verify the frontend workflow ran in GitHub Actions (check the Actions tab).

2. Check if the files changed match the trigger paths (`index.html`, `css/**`, `js/**`, `assets/**`).

3. Verify CloudFront invalidation completed:
```bash
$ aws cloudfront list-invalidations \
    --distribution-id $CLOUDFRONT_DISTRIBUTION_ID \
    --query 'InvalidationList.Items[0]'
```

**Fix:** If the workflow did not trigger, run it manually from GitHub Actions using the "Run workflow" button. If CloudFront is still caching, create a manual invalidation:
```bash
$ aws cloudfront create-invalidation \
    --distribution-id $CLOUDFRONT_DISTRIBUTION_ID \
    --paths "/*"
```

---

### Issue: "Not authorized to perform sts:AssumeRoleWithWebIdentity"

**Symptoms:**
- GitHub Actions fails at the AWS credentials step

**Fix:** The OIDC trust policy is misconfigured. See [[GitHub-OIDC-Setup]] for the correct trust policy and verify the `sub` condition matches the repository name.

## Related Documentation

- [[Docker-Deployment]] - Docker Compose and Dockerfile details
- [[Local-Development]] - Local development setup and testing
- [[Configuration-Reference]] - Environment variables reference
- [[GitHub-OIDC-Setup]] - OIDC authentication between GitHub Actions and AWS
