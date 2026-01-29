# EdgeMind AgentCore Deployment Guide

Deploy EdgeMind agents to AWS Bedrock AgentCore Runtime with Knowledge Base for SOPs.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  S3 Documents   │────▶│  Bedrock KB      │────▶│  AgentCore      │
│  (SOP PDFs)     │     │  (S3 Vectors)    │     │  Agents         │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                                                          ▼
                                                 ┌─────────────────┐
                                                 │  AgentCore      │
                                                 │  Gateway (IAM)  │
                                                 └────────┬────────┘
                                                          │
                                                          ▼
                                                 ┌─────────────────┐
                                                 │  Backend API    │
                                                 │  (OpenAPI)      │
                                                 └─────────────────┘
```

## Prerequisites

- AWS CLI configured with appropriate credentials
- AgentCore CLI: `pip install bedrock-agentcore`
- CDK CLI: `npm install -g aws-cdk`
- jq: `brew install jq` (macOS)

### Required IAM Permissions

The deploying user/role needs:
- `bedrock:*` - Bedrock KB and model access
- `bedrock-agentcore-control:*` - Gateway management
- `s3:*` - Bucket creation and document upload
- `iam:PassRole`, `iam:CreateRole` - Role creation for KB
- `cloudformation:*` - CDK stack deployment

## Deployment Steps

### Step 1: Deploy Knowledge Base CDK Stack

```bash
cd infra
cdk deploy edgemind-prod-knowledgebase
```

This creates:
- S3 bucket for SOP documents (encrypted, versioned)
- S3 Vectors bucket for embeddings
- Bedrock Knowledge Base with semantic chunking

### Step 2: Upload SOPs to S3

```bash
# Get bucket name from CDK outputs
BUCKET=$(aws cloudformation describe-stacks \
  --stack-name edgemind-prod-knowledgebase \
  --query "Stacks[0].Outputs[?OutputKey=='DocumentsBucketName'].OutputValue" \
  --output text)

# Upload SOPs
aws s3 sync knowledge-base/ s3://$BUCKET/
```

To manually trigger ingestion:

```bash
KB_ID=$(aws cloudformation describe-stacks \
  --stack-name edgemind-prod-knowledgebase \
  --query "Stacks[0].Outputs[?OutputKey=='KnowledgeBaseId'].OutputValue" \
  --output text)

DS_ID=$(aws bedrock-agent list-data-sources --knowledge-base-id $KB_ID \
  --query "dataSourceSummaries[0].dataSourceId" --output text)

aws bedrock-agent start-ingestion-job --knowledge-base-id $KB_ID --data-source-id $DS_ID
```

### Step 3: Deploy AgentCore Agents and Gateway

```bash
# Set backend URL (or let script auto-detect from CDK)
export BACKEND_URL="http://your-alb-dns.amazonaws.com"

# Run deployment script
./Deployment\ Scripts/deploy-agents.sh
```

This:
- Deploys chat, anomaly, troubleshoot agents to AgentCore Runtime
- Creates Gateway with IAM authentication
- Adds OpenAPI target pointing to backend
- Stores agent IDs in SSM Parameter Store (`/edgemind/agents/*`)

### Step 4: Verify Deployment

```bash
# Check agent status
agentcore status

# Check gateway
aws bedrock-agentcore-control get-gateway --gateway-id <gateway-id>

# View agent IDs from SSM
aws ssm get-parameters-by-path --path /edgemind/agents/
```

## Configuration

### Environment Variables

| Variable | Description |
|----------|-------------|
| `AWS_REGION` | AWS region (default: us-east-1) |
| `BACKEND_URL` | Backend API URL (auto-detected if not set) |
| `USE_BEDROCK_KB` | Use Bedrock KB instead of local ChromaDB |

## Local vs Deployed Mode

### Local Development (ChromaDB)
```bash
# Use local ChromaDB for vector storage
USE_BEDROCK_KB=false npm start
```

### Deployed Mode (Bedrock KB)
```bash
# Production uses Bedrock KB automatically when USE_AGENTCORE_RUNTIME=true
NODE_ENV=production npm start
```

## Security Considerations

- Gateway uses IAM authentication - callers must sign requests with SigV4
- S3 buckets have public access blocked and encryption enabled
- Documents bucket has versioning for audit trail
- KB role follows least-privilege with scoped permissions

## Cost Considerations

- **Bedrock KB**: Charges for storage and queries
- **S3 Vectors**: Storage costs for embeddings
- **AgentCore Runtime**: Per-invocation charges
- **S3**: Standard storage costs for documents

See [AWS Pricing Calculator](https://calculator.aws) for estimates.

## Rollback

### Remove AgentCore Resources
```bash
# Delete gateway
aws bedrock-agentcore-control delete-gateway --gateway-id <gateway-id>

# Undeploy agents
cd agent/chat && agentcore undeploy
cd agent/anomaly && agentcore undeploy
cd agent/troubleshoot && agentcore undeploy
```

### Remove CDK Stack
```bash
cd infra
cdk destroy edgemind-prod-knowledgebase
```

Note: S3 buckets are retained by default. Delete manually if needed.

## Troubleshooting

### Agent deployment fails
- Ensure AgentCore CLI is installed: `pip install bedrock-agentcore`
- Check AWS credentials: `aws sts get-caller-identity`
- Verify agent directory has `.bedrock_agentcore.yaml`

### Gateway creation fails
- Check IAM permissions for `bedrock-agentcore-control:*`
- Verify region supports AgentCore

### Knowledge Base ingestion fails
- Check S3 bucket permissions
- Verify documents are in supported format (PDF, TXT, MD)
- Check Bedrock model access is enabled for Titan Embeddings
- View ingestion job status: `aws bedrock-agent list-ingestion-jobs --knowledge-base-id $KB_ID`
