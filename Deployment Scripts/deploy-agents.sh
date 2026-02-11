#!/bin/bash
# =============================================================================
# EdgeMind AgentCore Deployment Script
# =============================================================================
#
# PURPOSE:
# Deploys Strands-based AI agents to AWS Bedrock AgentCore Runtime, enabling
# the EdgeMind dashboard to use AI-powered chat, anomaly detection, and
# troubleshooting capabilities.
#
# WHAT IT DOES:
# 1. Reads CDK stack outputs (CloudFront URL, Knowledge Base ID)
# 2. Creates IAM execution role for agents to call Bedrock
# 3. Sets up MCP Gateway - converts OpenAPI spec to MCP tools so agents
#    can call EdgeMind REST APIs (OEE, waste, equipment status, etc.)
# 4. Deploys each agent to AgentCore Runtime using `agentcore deploy`
# 5. Stores agent IDs in SSM Parameter Store for backend discovery
#
# WHY MCP GATEWAY:
# AgentCore agents use MCP (Model Context Protocol) for tool calling.
# The gateway auto-generates MCP tools from our OpenAPI/Swagger spec,
# so agents can call endpoints like getOEEv2, getEquipmentStates, etc.
# without manual tool definitions.
#
# IAM ROLES & CREDENTIALS:
#
#   Agent Execution Role (edgemind-agentcore-execution-role):
#   - Assumed by: bedrock-agentcore.amazonaws.com
#   - Inline policy "bedrock-invoke": bedrock:InvokeModel and
#     bedrock:InvokeModelWithResponseStream on:
#       * foundation-model/* (direct regional calls)
#       * inference-profile/* (cross-region inference with us.* model IDs)
#   - Inline policy "gateway-invoke": bedrock-agentcore:InvokeGateway
#   - Inline policy "cloudwatch-logs": logs:CreateLogGroup, CreateLogStream,
#     PutLogEvents, DescribeLogStreams, DescribeLogGroups - required for
#     observability: enabled in agent config
#   - Inline policy "observability-telemetry": xray:PutTraceSegments etc,
#     cloudwatch:PutMetricData - X-Ray tracing and CW metrics
#   - Inline policy "knowledge-base-retrieve": bedrock:Retrieve on KB -
#     only attached when KB_ID is available from CDK stack
#
#   Gateway Role (edgemind-prod-gateway-role):
#   - Assumed by: bedrock-agentcore.amazonaws.com
#   - Inline policy "secrets-and-workload-access":
#     * secretsmanager:GetSecretValue - AgentCore stores API keys in
#       Secrets Manager; gateway retrieves them to inject into requests
#     * bedrock-agentcore:GetWorkloadAccessToken - gateway needs this
#       to authenticate via workload identity when calling targets
#     * bedrock-agentcore:GetResourceApiKey - gateway needs this to
#       fetch API keys from the token vault credential provider
#
#   API Key Credential Provider:
#   - When created, AgentCore stores the API key in Secrets Manager and
#     returns an apiKeySecretArn. The gateway role needs GetSecretValue
#     permission on this secret.
#   - Gateway injects the key as x-api-key header when calling EdgeMind APIs
#   - Currently uses a placeholder key (public-no-auth-required) since
#     CloudFront→ALB is already secured; can be replaced with real auth
#
# PREREQUISITES:
# - CDK stacks deployed (frontend, knowledgebase)
# - AWS CLI configured with appropriate permissions
# - `uv` installed (https://docs.astral.sh/uv/) - agentcore CLI runs via uvx
# - Agent source code in agent/{name}/src/main.py
#
# USAGE:
#   ./deploy-agents.sh              # Deploy all agents in agent/ directory
#   ./deploy-agents.sh chat         # Deploy only the chat agent
#   ./deploy-agents.sh chat anomaly # Deploy specific agents
#
# ENVIRONMENT VARIABLES:
#   CDK_STACK_PREFIX  - Stack name prefix (default: edgemind-prod)
#   AWS_REGION        - Target region (default: us-east-1)
#   API_KEY           - API key for gateway auth (default: public-no-auth-required)
#   BEDROCK_MODEL_ID  - Bedrock model ID for agents (default: from CDK or Claude Sonnet)
#
# =============================================================================

set -e

CDK_STACK_PREFIX="${CDK_STACK_PREFIX:-edgemind-prod}"
REGION="${AWS_REGION:-us-east-1}"
API_KEY="${API_KEY:-public-no-auth-required}"
BEDROCK_MODEL="${BEDROCK_MODEL_ID:-}"  # Will try to get from CDK if not set
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Agents to deploy (from args or all in agent/ dir)
if [ $# -gt 0 ]; then
  AGENTS=("$@")
else
  AGENTS=($(ls -d "$PROJECT_DIR/agent"/*/ 2>/dev/null | xargs -n1 basename))
fi

echo "=========================================="
echo "EdgeMind AgentCore Deployment"
echo "=========================================="
echo "Region: $REGION"
echo "Agents: ${AGENTS[*]}"
echo ""

# ===========================================
# 1. Get CloudFront URL from CDK stack
# ===========================================
echo "--- Reading CDK outputs ---"
CLOUDFRONT_DOMAIN=$(aws cloudformation describe-stacks --stack-name $CDK_STACK_PREFIX-frontend --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDomainName'].OutputValue" --output text)

if [ -z "$CLOUDFRONT_DOMAIN" ] || [ "$CLOUDFRONT_DOMAIN" = "None" ]; then
  echo "ERROR: CloudFront domain not found. Run CDK deploy first."
  exit 1
fi

OPENAPI_URL="https://$CLOUDFRONT_DOMAIN/api/api-spec/v3"
echo "CloudFront: $CLOUDFRONT_DOMAIN"

# Get Knowledge Base ID (for chat and troubleshoot agents)
KB_ID=$(aws cloudformation describe-stacks --stack-name $CDK_STACK_PREFIX-knowledgebase --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='KnowledgeBaseId'].OutputValue" --output text 2>/dev/null || echo "")

if [ -n "$KB_ID" ] && [ "$KB_ID" != "None" ]; then
  echo "Knowledge Base: $KB_ID"
else
  echo "WARNING: Knowledge Base not found (KB retrieval will be disabled)"
  KB_ID=""
fi

if [ -n "$BEDROCK_MODEL" ]; then
  echo "Bedrock Model: $BEDROCK_MODEL"
else
  echo "WARNING: BEDROCK_MODEL_ID not set (agents will use their defaults)"
fi

# ===========================================
# 2. Create shared agent execution role
# ===========================================
echo ""
echo "--- Setting up Agent Execution Role ---"

AGENT_EXEC_ROLE="edgemind-agentcore-execution-role"

if ! aws iam get-role --role-name "$AGENT_EXEC_ROLE" &>/dev/null; then
  echo "Creating agent execution role..."
  aws iam create-role --role-name "$AGENT_EXEC_ROLE" \
    --assume-role-policy-document '{
      "Version": "2012-10-17",
      "Statement": [{
        "Effect": "Allow",
        "Principal": {"Service": "bedrock-agentcore.amazonaws.com"},
        "Action": "sts:AssumeRole"
      }]
    }' > /dev/null
fi

AGENT_EXEC_ROLE_ARN="arn:aws:iam::$ACCOUNT_ID:role/$AGENT_EXEC_ROLE"
echo "Agent role: $AGENT_EXEC_ROLE"

# Policies are idempotent (put-role-policy overwrites) - always apply to pick up changes
# Scoped permissions for agent runtime - InvokeModel only
# Includes both foundation-model (direct) and inference-profile (cross-region)
aws iam put-role-policy --role-name "$AGENT_EXEC_ROLE" --policy-name "bedrock-invoke" \
  --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{
      \"Effect\": \"Allow\",
      \"Action\": [
        \"bedrock:InvokeModel\",
        \"bedrock:InvokeModelWithResponseStream\"
      ],
      \"Resource\": [
        \"arn:aws:bedrock:*::foundation-model/*\",
        \"arn:aws:bedrock:*:$ACCOUNT_ID:inference-profile/*\"
      ]
    }]
  }"

# CloudWatch Logs permissions (required for observability: enabled)
aws iam put-role-policy --role-name "$AGENT_EXEC_ROLE" --policy-name "cloudwatch-logs" \
  --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [
      {
        \"Sid\": \"LogGroupManagement\",
        \"Effect\": \"Allow\",
        \"Action\": [
          \"logs:CreateLogGroup\",
          \"logs:DescribeLogStreams\"
        ],
        \"Resource\": \"arn:aws:logs:$REGION:$ACCOUNT_ID:log-group:/aws/bedrock-agentcore/runtimes/*\"
      },
      {
        \"Sid\": \"LogGroupDiscovery\",
        \"Effect\": \"Allow\",
        \"Action\": \"logs:DescribeLogGroups\",
        \"Resource\": \"arn:aws:logs:$REGION:$ACCOUNT_ID:log-group:*\"
      },
      {
        \"Sid\": \"LogStreamWrite\",
        \"Effect\": \"Allow\",
        \"Action\": [
          \"logs:CreateLogStream\",
          \"logs:PutLogEvents\"
        ],
        \"Resource\": \"arn:aws:logs:$REGION:$ACCOUNT_ID:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*\"
      }
    ]
  }"

# X-Ray and CloudWatch Metrics (required for observability: enabled)
aws iam put-role-policy --role-name "$AGENT_EXEC_ROLE" --policy-name "observability-telemetry" \
  --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [
      {
        \"Sid\": \"XRayTracing\",
        \"Effect\": \"Allow\",
        \"Action\": [
          \"xray:PutTraceSegments\",
          \"xray:PutTelemetryRecords\",
          \"xray:GetSamplingRules\",
          \"xray:GetSamplingTargets\"
        ],
        \"Resource\": \"*\"
      },
      {
        \"Sid\": \"CloudWatchMetrics\",
        \"Effect\": \"Allow\",
        \"Action\": \"cloudwatch:PutMetricData\",
        \"Resource\": \"*\",
        \"Condition\": {
          \"StringEquals\": {
            \"cloudwatch:namespace\": \"bedrock-agentcore\"
          }
        }
      }
    ]
  }"

# Knowledge Base retrieval (only if KB exists)
if [ -n "$KB_ID" ] && [ "$KB_ID" != "None" ]; then
  aws iam put-role-policy --role-name "$AGENT_EXEC_ROLE" --policy-name "knowledge-base-retrieve" \
    --policy-document "{
      \"Version\": \"2012-10-17\",
      \"Statement\": [{
        \"Sid\": \"KnowledgeBaseRetrieve\",
        \"Effect\": \"Allow\",
        \"Action\": \"bedrock:Retrieve\",
        \"Resource\": \"arn:aws:bedrock:$REGION:$ACCOUNT_ID:knowledge-base/$KB_ID\"
      }]
    }"
fi

# ===========================================
# 2. Setup Gateway + Target + Permissions
# ===========================================
echo ""
echo "--- Setting up MCP Gateway ---"

GATEWAY_NAME="$CDK_STACK_PREFIX-gateway"
GATEWAY_ROLE="$CDK_STACK_PREFIX-gateway-role"
API_KEY_NAME="edgemind-api"

# Create gateway role if needed
if ! aws iam get-role --role-name "$GATEWAY_ROLE" &>/dev/null; then
  echo "Creating gateway role..."
  aws iam create-role --role-name "$GATEWAY_ROLE" \
    --assume-role-policy-document '{
      "Version": "2012-10-17",
      "Statement": [{
        "Effect": "Allow",
        "Principal": {"Service": "bedrock-agentcore.amazonaws.com"},
        "Action": "sts:AssumeRole"
      }]
    }' > /dev/null
fi

# Create gateway if needed
GATEWAY_ID=$(aws bedrock-agentcore-control list-gateways --region "$REGION" \
  --query "items[?name=='$GATEWAY_NAME'].gatewayId" --output text 2>/dev/null || echo "")

if [ -z "$GATEWAY_ID" ]; then
  echo "Creating gateway..."
  GATEWAY_ID=$(aws bedrock-agentcore-control create-gateway \
    --name "$GATEWAY_NAME" \
    --description "EdgeMind MCP Gateway" \
    --protocol-type MCP \
    --authorizer-type AWS_IAM \
    --role-arn "arn:aws:iam::$ACCOUNT_ID:role/$GATEWAY_ROLE" \
    --region "$REGION" \
    --query 'gatewayId' --output text)
  echo "Waiting for gateway..."
  sleep 10
fi

GATEWAY_URL="https://$GATEWAY_ID.gateway.bedrock-agentcore.$REGION.amazonaws.com/mcp"
if [ -n "$GATEWAY_ID" ]; then
  echo "Gateway: $GATEWAY_URL"
else
  echo "WARNING: Gateway not created (MCP tools will be disabled)"
  GATEWAY_URL=""
fi

# Create API key credential provider if needed
PROVIDER_ARN=""
if aws bedrock-agentcore-control get-api-key-credential-provider --name "$API_KEY_NAME" --region "$REGION" &>/dev/null; then
  PROVIDER_ARN=$(aws bedrock-agentcore-control get-api-key-credential-provider \
    --name "$API_KEY_NAME" --region "$REGION" \
    --query 'credentialProviderArn' --output text)
fi

if [ -z "$PROVIDER_ARN" ]; then
  echo "Creating API key credential provider..."
  PROVIDER_ARN=$(aws bedrock-agentcore-control create-api-key-credential-provider \
    --name "$API_KEY_NAME" \
    --api-key "$API_KEY" \
    --region "$REGION" \
    --query 'credentialProviderArn' --output text)
fi

# Create/update gateway target with OpenAPI spec
echo "Fetching OpenAPI spec..."
SPEC=$(curl -s "$OPENAPI_URL" | jq --arg url "https://$CLOUDFRONT_DOMAIN" '.servers = [{"url": $url, "description": "CloudFront"}]')

EXISTING_TARGET=$(aws bedrock-agentcore-control list-gateway-targets \
  --gateway-identifier "$GATEWAY_ID" --region "$REGION" \
  --query "items[?name=='factoryapi'].targetId" --output text 2>/dev/null || echo "")

TARGET_CONFIG="{\"mcp\":{\"openApiSchema\":{\"inlinePayload\":$(echo "$SPEC" | jq -c '.' | jq -Rs '.')}}}"
CRED_CONFIG="[{\"credentialProviderType\":\"API_KEY\",\"credentialProvider\":{\"apiKeyCredentialProvider\":{\"providerArn\":\"$PROVIDER_ARN\",\"credentialParameterName\":\"x-api-key\",\"credentialLocation\":\"HEADER\"}}}]"

if [ -z "$EXISTING_TARGET" ]; then
  echo "Creating gateway target..."
  aws bedrock-agentcore-control create-gateway-target \
    --gateway-identifier "$GATEWAY_ID" \
    --name "factoryapi" \
    --target-configuration "$TARGET_CONFIG" \
    --credential-provider-configurations "$CRED_CONFIG" \
    --region "$REGION" > /dev/null
else
  echo "Updating gateway target..."
  aws bedrock-agentcore-control update-gateway-target \
    --gateway-identifier "$GATEWAY_ID" \
    --target-id "$EXISTING_TARGET" \
    --name "factoryapi" \
    --target-configuration "$TARGET_CONFIG" \
    --credential-provider-configurations "$CRED_CONFIG" \
    --region "$REGION" > /dev/null
fi

# Gateway role permissions
aws iam put-role-policy --role-name "$GATEWAY_ROLE" --policy-name "secrets-and-workload-access" \
  --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [
      {
        \"Sid\": \"SecretsAccess\",
        \"Effect\": \"Allow\",
        \"Action\": \"secretsmanager:GetSecretValue\",
        \"Resource\": \"arn:aws:secretsmanager:$REGION:$ACCOUNT_ID:secret:bedrock-agentcore-identity*\"
      },
      {
        \"Sid\": \"WorkloadIdentityToken\",
        \"Effect\": \"Allow\",
        \"Action\": \"bedrock-agentcore:GetWorkloadAccessToken\",
        \"Resource\": \"arn:aws:bedrock-agentcore:$REGION:$ACCOUNT_ID:workload-identity-directory/default*\"
      },
      {
        \"Sid\": \"GetResourceApiKey\",
        \"Effect\": \"Allow\",
        \"Action\": \"bedrock-agentcore:GetResourceApiKey\",
        \"Resource\": [
          \"arn:aws:bedrock-agentcore:$REGION:$ACCOUNT_ID:token-vault/default*\",
          \"arn:aws:bedrock-agentcore:$REGION:$ACCOUNT_ID:workload-identity-directory/default*\"
        ]
      }
    ]
  }" 2>/dev/null || true

# Agent role permission to invoke gateway
aws iam put-role-policy --role-name "$AGENT_EXEC_ROLE" --policy-name "gateway-invoke" \
  --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{
      \"Effect\": \"Allow\",
      \"Action\": \"bedrock-agentcore:InvokeGateway\",
      \"Resource\": \"arn:aws:bedrock-agentcore:$REGION:$ACCOUNT_ID:gateway/$GATEWAY_ID\"
    }]
  }" 2>/dev/null || true

# ===========================================
# 4. Deploy Agents
# ===========================================
echo ""
echo "--- Deploying Agents ---"

for agent in "${AGENTS[@]}"; do
  AGENT_DIR="$PROJECT_DIR/agent/$agent"
  AGENT_NAME="edgemind_${agent}"  # underscore, not hyphen
  
  if [ ! -d "$AGENT_DIR" ]; then
    echo "WARNING: Agent directory not found: $AGENT_DIR"
    continue
  fi
  
  echo ""
  echo "Deploying: $agent (as $AGENT_NAME)"
  cd "$AGENT_DIR"
  
  # Generate fresh yaml config (don't rely on checked-in file)
  cat > .bedrock_agentcore.yaml << EOF
default_agent: $AGENT_NAME
agents:
  $AGENT_NAME:
    name: $AGENT_NAME
    entrypoint: main.py
    deployment_type: direct_code_deploy
    runtime_type: PYTHON_3_10
    source_path: src
    aws:
      execution_role: $AGENT_EXEC_ROLE_ARN
      region: $REGION
      account: '$ACCOUNT_ID'
      s3_auto_create: true
      network_configuration:
        network_mode: PUBLIC
      protocol_configuration:
        server_protocol: HTTP
      observability:
        enabled: true
    memory:
      mode: NO_MEMORY
EOF
  
  # Build deploy command - pass all env vars, agents use what they need
  DEPLOY_CMD="AWS_REGION=$REGION uvx --from bedrock-agentcore-starter-toolkit agentcore deploy --agent $AGENT_NAME --auto-update-on-conflict"
  if [ -n "$GATEWAY_URL" ]; then
    DEPLOY_CMD="$DEPLOY_CMD --env MCP_SERVER_URL=$GATEWAY_URL"
  fi
  if [ -n "$KB_ID" ]; then
    DEPLOY_CMD="$DEPLOY_CMD --env KNOWLEDGE_BASE_ID=$KB_ID"
  fi
  if [ -n "$BEDROCK_MODEL" ]; then
    DEPLOY_CMD="$DEPLOY_CMD --env BEDROCK_MODEL_ID=$BEDROCK_MODEL"
  fi
  
  eval $DEPLOY_CMD
  
  # Store agent ARN in SSM for backend to discover
  AGENT_ARN=$(grep "agent_arn:" .bedrock_agentcore.yaml 2>/dev/null | head -1 | awk '{print $2}')
  if [ -n "$AGENT_ARN" ]; then
    aws ssm put-parameter \
      --name "/edgemind/agents/$agent" \
      --value "$AGENT_ARN" \
      --type String \
      --overwrite \
      --region "$REGION" > /dev/null 2>&1 || true
    echo "Stored agent ARN in SSM: /edgemind/agents/$agent"
  fi
done

echo ""
echo "=========================================="
echo "Deployment Complete"
echo "=========================================="
