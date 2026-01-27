# EdgeMind Deployment Guide

This document covers the CI/CD pipeline and deployment process for EdgeMind.

## Overview

EdgeMind uses GitHub Actions for automated deployments. When code is pushed to the `main` branch, the appropriate workflow triggers based on which files changed:

- **Backend changes** deploy to ECS Fargate
- **Frontend changes** deploy to S3 + CloudFront

Authentication uses OIDC (no stored AWS credentials). See [github-oidc-setup.md](./github-oidc-setup.md) for IAM configuration.

## Architecture

```
GitHub Repository
       │
       │ push to main
       ▼
┌─────────────────────────────────────────────────────┐
│              GitHub Actions                         │
│                                                     │
│  ┌─────────────────┐    ┌─────────────────┐        │
│  │ deploy-backend  │    │ deploy-frontend │        │
│  │ (server changes)│    │ (UI changes)    │        │
│  └────────┬────────┘    └────────┬────────┘        │
└───────────┼──────────────────────┼─────────────────┘
            │                      │
            ▼                      ▼
     ┌──────────────┐       ┌─────────────┐
     │  Amazon ECR  │       │  Amazon S3  │
     │  (container  │       │  (static    │
     │   registry)  │       │   files)    │
     └──────┬───────┘       └──────┬──────┘
            │                      │
            ▼                      ▼
     ┌──────────────┐       ┌─────────────┐
     │ ECS Fargate  │       │ CloudFront  │
     │ (backend)    │       │ (CDN)       │
     └──────────────┘       └─────────────┘
            │                      │
            └──────────┬───────────┘
                       ▼
                   Users
```

## Deployment Triggers

### Backend Deployment

**Workflow:** `.github/workflows/deploy-backend.yml`

Triggers when these files change on `main`:

| Path | Description |
|------|-------------|
| `server.js` | Main application entry point |
| `lib/**` | Backend modules (influx, ai, oee, schema) |
| `package.json` | Node.js dependencies |
| `package-lock.json` | Dependency lock file |
| `Dockerfile` | Container build instructions |

**What happens:**
1. Builds Docker image with commit SHA tag
2. Pushes to ECR repository `edgemind-prod-backend`
3. Updates ECS task definition with new image
4. Deploys to service `edgemind-prod-backend`
5. Waits for service stability

### Frontend Deployment

**Workflow:** `.github/workflows/deploy-frontend.yml`

Triggers when these files change on `main`:

| Path | Description |
|------|-------------|
| `index.html` | Dashboard HTML |
| `styles.css` | CSS styles |
| `app.js` | Frontend JavaScript |
| `assets/**` | Static assets (images, fonts) |

**What happens:**
1. Syncs changed files to S3 bucket `edgemind-prod-frontend`
2. Creates CloudFront cache invalidation for `/*`

## Manual Deployment

Both workflows support `workflow_dispatch` for manual triggers.

**Via GitHub UI:**
1. Go to Actions tab
2. Select "Deploy Backend" or "Deploy Frontend"
3. Click "Run workflow"
4. Select branch (usually `main`)
5. Click "Run workflow"

**Via GitHub CLI:**

```bash
# Deploy backend manually
gh workflow run deploy-backend.yml --ref main

# Deploy frontend manually
gh workflow run deploy-frontend.yml --ref main
```

## Viewing Logs

Production logs are in CloudWatch. Use the AWS CLI to tail logs.

### Backend Logs

```bash
# Last 10 minutes
aws logs tail /ecs/edgemind-prod-backend --since 10m --format short

# Follow live logs
aws logs tail /ecs/edgemind-prod-backend --follow --format short

# Filter for errors
aws logs tail /ecs/edgemind-prod-backend --since 1h --filter-pattern "ERROR"
```

### InfluxDB Logs

```bash
aws logs tail /ecs/edgemind-prod-influxdb --since 10m --format short
```

### ChromaDB Logs

```bash
aws logs tail /ecs/edgemind-prod-chromadb --since 10m --format short
```

## Production URLs

| Resource | URL |
|----------|-----|
| Dashboard | https://edge-mind.concept-reply-sandbox.com |
| Health Check | https://edge-mind.concept-reply-sandbox.com/health |
| API Base | https://edge-mind.concept-reply-sandbox.com/api |

### Health Check Verification

```bash
# Check overall health
curl -s https://edge-mind.concept-reply-sandbox.com/health | jq

# Expected response
{
  "status": "healthy",
  "mqtt": "connected",
  "influxdb": "connected",
  "uptime": 12345
}
```

## Infrastructure Resources

| Resource | Name/ID |
|----------|---------|
| ECS Cluster | `edgemind-prod-cluster` |
| ECS Service | `edgemind-prod-backend` |
| ECR Repository | `edgemind-prod-backend` |
| S3 Bucket | `edgemind-prod-frontend` |
| CloudFront | See GitHub secrets |

## Deployment Checklist

Before deploying to production:

1. Test changes locally with `npm run dev`
2. Verify tests pass (if applicable)
3. Create PR to `main` branch
4. Review changes in PR
5. Merge PR (triggers deployment)
6. Monitor GitHub Actions for success
7. Verify health endpoint after deployment

## Troubleshooting

### Deployment Stuck or Failed

1. Check GitHub Actions log for the specific step that failed
2. For ECS issues, check CloudWatch logs:
   ```bash
   aws logs tail /ecs/edgemind-prod-backend --since 30m
   ```
3. Verify the service is running:
   ```bash
   aws ecs describe-services \
     --cluster edgemind-prod-cluster \
     --services edgemind-prod-backend \
     --query 'services[0].{status:status,running:runningCount,desired:desiredCount}'
   ```

### OIDC Authentication Failures

See [github-oidc-setup.md](./github-oidc-setup.md) for troubleshooting IAM and trust policy issues.

### CloudFront Cache Issues

If changes are not visible after frontend deployment:

```bash
# Check invalidation status
aws cloudfront list-invalidations --distribution-id YOUR_DISTRIBUTION_ID

# Force manual invalidation
aws cloudfront create-invalidation \
  --distribution-id YOUR_DISTRIBUTION_ID \
  --paths "/*"
```

## Related Documentation

- [GitHub OIDC Setup](./github-oidc-setup.md) - IAM role and trust policy configuration
- [Container Architecture](../architecture/2-containers.md) - System container diagram
- [CMMS Integration](../CMMS_INTEGRATION.md) - CMMS configuration including production setup
