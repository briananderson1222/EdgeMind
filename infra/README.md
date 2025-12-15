# EdgeMind Factory Dashboard - AWS CDK Infrastructure

Production-ready AWS infrastructure for the EdgeMind real-time factory intelligence dashboard using AWS CDK with Python.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        CloudFront CDN                            │
│  (Static Assets: S3)  (API/WebSocket: ALB Origin)              │
└────────────┬────────────────────────────────┬───────────────────┘
             │                                 │
             │                                 ▼
             │                    ┌────────────────────────┐
             │                    │  Application Load      │
             │                    │  Balancer (ALB)        │
             │                    │  - Sticky Sessions     │
             │                    │  - Health Checks       │
             │                    └────────┬───────────────┘
             │                             │
             ▼                             ▼
    ┌────────────────┐        ┌───────────────────────────┐
    │  S3 Bucket     │        │  ECS Fargate Backend      │
    │  Frontend      │        │  - Node.js Server         │
    │  Static Files  │        │  - MQTT Client            │
    └────────────────┘        │  - WebSocket Server       │
                              │  - Claude AI (Bedrock)    │
                              └────────┬──────────────────┘
                                       │
                         ┌─────────────┼─────────────┐
                         ▼             ▼             ▼
                   ┌─────────┐   ┌─────────┐   ┌─────────┐
                   │ Secrets │   │InfluxDB │   │ Bedrock │
                   │ Manager │   │ on ECS  │   │ Claude  │
                   └─────────┘   │ + EFS   │   └─────────┘
                                 └─────────┘
```

## Deployed Resources

### 1. Network Stack (`network_stack.py`)
- **VPC**: 10.0.0.0/16 across 2 Availability Zones
- **Subnets**: Public and private subnets in each AZ
- **NAT Gateway**: Single NAT for cost optimization
- **Security Groups**:
  - ALB: Ports 80, 443 from internet
  - Backend: Ports 3000, 8080 from ALB
  - InfluxDB: Port 8086 from backend
  - EFS: Port 2049 from InfluxDB

### 2. Secrets Stack (`secrets_stack.py`)
- **MQTT Secret** (`edgemind/mqtt`):
  - host, username, password
- **InfluxDB Secret** (`edgemind/influxdb`):
  - url, token, org, bucket

### 3. Database Stack (`database_stack.py`)
- **InfluxDB 2.7** on ECS Fargate (512 CPU, 1GB RAM)
- **EFS File System**: Encrypted, lifecycle policy (14 days)
- **Cloud Map Service Discovery**: `influxdb.edgemind.local`
- **Health Checks**: `/health` endpoint every 30s

### 4. Backend Stack (`backend_stack.py`)
- **ECR Repository**: For backend Docker images
- **ECS Fargate Service**: 2 tasks (512 CPU, 1GB RAM each)
- **Application Load Balancer**:
  - HTTP (80) → HTTPS redirect
  - HTTPS (443) → Backend targets
  - Sticky sessions for WebSocket
  - Health check: `/health`
- **Auto Scaling**: 1-4 tasks based on CPU (70%) and Memory (80%)
- **IAM Permissions**:
  - `bedrock:InvokeModel` for Claude Sonnet 4
  - `secretsmanager:GetSecretValue` for credentials

### 5. Frontend Stack (`frontend_stack.py`)
- **S3 Bucket**: Versioned, encrypted, lifecycle policies
- **CloudFront Distribution**:
  - Default behavior: S3 origin (static files)
  - `/api/*`: ALB origin (no caching)
  - `/health`: ALB origin (health checks)
  - HTTPS redirect, Brotli/Gzip compression
  - CloudFront logs to S3

## Prerequisites

1. **AWS CLI** configured with `reply` profile:
   ```bash
   aws configure --profile reply
   ```

2. **Python 3.9+** and pip:
   ```bash
   python3 --version
   ```

3. **Node.js** for AWS CDK:
   ```bash
   npm install -g aws-cdk
   cdk --version
   ```

4. **Docker** (for building backend image):
   ```bash
   docker --version
   ```

## Installation

1. **Install Python dependencies**:
   ```bash
   cd /Users/stefanbekker/Projects/EdgeMind/infra
   python3 -m venv .venv
   source .venv/bin/activate  # On Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   ```

2. **Update AWS Account ID** in `app.py`:
   ```python
   AWS_ACCOUNT = "123456789012"  # Replace with your actual AWS account ID
   ```

3. **Bootstrap CDK** (first time only):
   ```bash
   cdk bootstrap aws://ACCOUNT-ID/us-east-1 --profile reply
   ```

## Deployment

### Step 1: Deploy Infrastructure

```bash
# Activate virtual environment
source .venv/bin/activate

# Synthesize CloudFormation templates (review changes)
cdk synth --profile reply

# Preview changes (optional)
cdk diff --all --profile reply

# Deploy all stacks
cdk deploy --all --profile reply --require-approval never

# Or deploy stacks individually:
cdk deploy edgemind-prod-network --profile reply
cdk deploy edgemind-prod-secrets --profile reply
cdk deploy edgemind-prod-database --profile reply
cdk deploy edgemind-prod-backend --profile reply
cdk deploy edgemind-prod-frontend --profile reply
```

Deployment takes approximately 15-20 minutes.

### Step 2: Configure Secrets

After deployment, update Secrets Manager with actual credentials:

```bash
# Update MQTT credentials
aws secretsmanager update-secret \
  --secret-id edgemind/mqtt \
  --secret-string '{
    "host": "virtualfactory.proveit.services",
    "port": 1883,
    "username": "your-username",
    "password": "your-password"
  }' \
  --profile reply

# Update InfluxDB credentials (optional - auto-generated)
aws secretsmanager update-secret \
  --secret-id edgemind/influxdb \
  --secret-string '{
    "url": "http://influxdb.edgemind.local:8086",
    "token": "your-influxdb-token",
    "org": "proveit",
    "bucket": "factory",
    "username": "admin"
  }' \
  --profile reply
```

### Step 3: Build and Push Backend Docker Image

```bash
# Get ECR login credentials
aws ecr get-login-password --region us-east-1 --profile reply | \
  docker login --username AWS --password-stdin ACCOUNT-ID.dkr.ecr.us-east-1.amazonaws.com

# Build Docker image
cd /Users/stefanbekker/Projects/EdgeMind
docker build -t edgemind-prod-backend .

# Tag image
docker tag edgemind-prod-backend:latest ACCOUNT-ID.dkr.ecr.us-east-1.amazonaws.com/edgemind-prod-backend:latest

# Push to ECR
docker push ACCOUNT-ID.dkr.ecr.us-east-1.amazonaws.com/edgemind-prod-backend:latest
```

**Note**: Replace `ACCOUNT-ID` with your AWS account ID (found in CDK outputs).

### Step 4: Deploy Frontend to S3

```bash
# Get S3 bucket name from CDK outputs
BUCKET_NAME=$(aws cloudformation describe-stacks \
  --stack-name edgemind-prod-frontend \
  --query "Stacks[0].Outputs[?OutputKey=='FrontendBucketName'].OutputValue" \
  --output text \
  --profile reply)

# Upload frontend files
cd /Users/stefanbekker/Projects/EdgeMind
aws s3 sync ./ s3://$BUCKET_NAME/ \
  --exclude '*' \
  --include '*.html' \
  --include '*.js' \
  --include '*.css' \
  --include '*.png' \
  --include '*.jpg' \
  --profile reply

# Invalidate CloudFront cache
DISTRIBUTION_ID=$(aws cloudformation describe-stacks \
  --stack-name edgemind-prod-frontend \
  --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDistributionId'].OutputValue" \
  --output text \
  --profile reply)

aws cloudfront create-invalidation \
  --distribution-id $DISTRIBUTION_ID \
  --paths "/*" \
  --profile reply
```

## Accessing the Application

After deployment, get the URLs from CDK outputs:

```bash
# Get CloudFront URL (frontend)
aws cloudformation describe-stacks \
  --stack-name edgemind-prod-frontend \
  --query "Stacks[0].Outputs[?OutputKey=='FrontendURL'].OutputValue" \
  --output text \
  --profile reply

# Get ALB URL (backend API - for testing)
aws cloudformation describe-stacks \
  --stack-name edgemind-prod-backend \
  --query "Stacks[0].Outputs[?OutputKey=='BackendURL'].OutputValue" \
  --output text \
  --profile reply
```

Access the dashboard at the CloudFront URL.

## Creating Backend Dockerfile

The CDK expects a Dockerfile in the project root. Here's a production-ready example:

```dockerfile
# /Users/stefanbekker/Projects/EdgeMind/Dockerfile
FROM node:18-alpine

# Install curl for health checks
RUN apk add --no-cache curl

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY server.js ./
COPY factory-live.html ./
COPY factory-command-center.html ./

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

# Expose ports
EXPOSE 3000 8080

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start server
CMD ["node", "server.js"]
```

## Monitoring and Debugging

### View ECS Service Logs

```bash
# Backend logs
aws logs tail /ecs/edgemind-prod-backend --follow --profile reply

# InfluxDB logs
aws logs tail /ecs/edgemind-prod-influxdb --follow --profile reply
```

### Check Service Health

```bash
# Backend health
curl http://ALB-DNS-NAME/health

# InfluxDB health (from within VPC)
curl http://influxdb.edgemind.local:8086/health
```

### ECS Exec (SSH into containers)

```bash
# List running tasks
aws ecs list-tasks \
  --cluster edgemind-prod-cluster \
  --service-name edgemind-prod-backend \
  --profile reply

# Execute command in container
aws ecs execute-command \
  --cluster edgemind-prod-cluster \
  --task TASK-ID \
  --container backend \
  --command "/bin/sh" \
  --interactive \
  --profile reply
```

## Cost Optimization

**Estimated Monthly Cost** (us-east-1):
- **ECS Fargate**: ~$50-80 (3 tasks, 0.5 vCPU, 1GB RAM each)
- **ALB**: ~$20-25
- **NAT Gateway**: ~$35-45
- **EFS**: ~$5-10 (1GB stored)
- **CloudFront**: ~$1-5 (first 1TB free tier)
- **S3**: ~$1-2
- **Secrets Manager**: ~$1-2
- **CloudWatch Logs**: ~$5-10

**Total**: ~$120-180/month

**Cost-Saving Tips**:
1. Reduce NAT Gateways to 1 (already done)
2. Use Fargate Spot for dev/test environments
3. Enable S3 lifecycle policies (already done)
4. Use CloudWatch Logs retention (7 days - already done)
5. Stop non-prod environments overnight

## Destroying Infrastructure

**WARNING**: This will delete all resources and data (except secrets and EFS - they have `RemovalPolicy.RETAIN`).

```bash
# Destroy all stacks (reverse order)
cdk destroy --all --profile reply

# Or destroy individually:
cdk destroy edgemind-prod-frontend --profile reply
cdk destroy edgemind-prod-backend --profile reply
cdk destroy edgemind-prod-database --profile reply
cdk destroy edgemind-prod-secrets --profile reply
cdk destroy edgemind-prod-network --profile reply

# Manually delete retained resources:
# - Secrets Manager secrets (edgemind/mqtt, edgemind/influxdb)
# - EFS file system (if you want to delete data)
# - ECR images
```

## Troubleshooting

### CDK Bootstrap Error
```bash
# If bootstrap fails, specify the profile explicitly:
cdk bootstrap aws://ACCOUNT-ID/us-east-1 \
  --profile reply \
  --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess
```

### ECR Push Authentication Failed
```bash
# Re-authenticate with ECR:
aws ecr get-login-password --region us-east-1 --profile reply | \
  docker login --username AWS --password-stdin ACCOUNT-ID.dkr.ecr.us-east-1.amazonaws.com
```

### Backend Tasks Not Starting
Check CloudWatch Logs for errors:
```bash
aws logs tail /ecs/edgemind-prod-backend --follow --profile reply
```

Common issues:
- Secrets not configured correctly
- Docker image not pushed to ECR
- IAM permissions missing

### InfluxDB Connection Failed
Verify service discovery:
```bash
# From backend container:
nslookup influxdb.edgemind.local
curl http://influxdb.edgemind.local:8086/health
```

## Architecture Decisions

1. **Single NAT Gateway**: Cost optimization. Multi-AZ NAT costs $90+/month extra.
2. **Fargate vs EC2**: Fargate chosen for simplicity, no server management.
3. **EFS for InfluxDB**: Persistent storage across container restarts.
4. **Cloud Map**: Service discovery for backend→InfluxDB communication.
5. **ALB Sticky Sessions**: Required for WebSocket connections.
6. **CloudFront**: CDN for static assets, caching, HTTPS.
7. **Secrets Manager**: Secure credential storage with auto-rotation support.

## Next Steps

1. **Custom Domain**: Add Route53 + ACM certificate for custom domain
2. **HTTPS**: Add ACM certificate to ALB HTTPS listener
3. **CI/CD**: Set up CodePipeline for automatic deployments
4. **Monitoring**: Add CloudWatch alarms for service health
5. **Backup**: Enable automated EFS backups
6. **WAF**: Add AWS WAF to CloudFront for DDoS protection

## Support

For issues or questions:
1. Check CloudWatch Logs: `/ecs/edgemind-prod-*`
2. Review ECS Service Events in AWS Console
3. Verify security group rules in VPC console
4. Test connectivity with ECS Exec

## License

MIT License - See project root for details.
