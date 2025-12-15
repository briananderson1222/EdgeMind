#!/bin/bash
set -e

# EdgeMind Factory Dashboard - Deployment Script
# This script deploys the complete AWS infrastructure using CDK

echo "=================================================="
echo "EdgeMind Factory Dashboard - AWS CDK Deployment"
echo "=================================================="
echo ""

# Configuration
PROFILE="reply"
REGION="us-east-1"
PROJECT="edgemind"
ENV="prod"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check prerequisites
check_prerequisites() {
    echo -e "${YELLOW}Checking prerequisites...${NC}"

    if ! command -v aws &> /dev/null; then
        echo -e "${RED}ERROR: AWS CLI not found. Please install it first.${NC}"
        exit 1
    fi

    if ! command -v cdk &> /dev/null; then
        echo -e "${RED}ERROR: AWS CDK not found. Run: npm install -g aws-cdk${NC}"
        exit 1
    fi

    if ! command -v python3 &> /dev/null; then
        echo -e "${RED}ERROR: Python 3 not found. Please install it first.${NC}"
        exit 1
    fi

    if ! command -v docker &> /dev/null; then
        echo -e "${RED}ERROR: Docker not found. Please install it first.${NC}"
        exit 1
    fi

    echo -e "${GREEN}✓ All prerequisites met${NC}"
    echo ""
}

# Get AWS Account ID
get_account_id() {
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text --profile $PROFILE 2>/dev/null)
    if [ -z "$ACCOUNT_ID" ]; then
        echo -e "${RED}ERROR: Could not get AWS Account ID. Is your AWS CLI configured with profile '$PROFILE'?${NC}"
        exit 1
    fi
    echo -e "${GREEN}AWS Account ID: $ACCOUNT_ID${NC}"
    echo ""
}

# Update app.py with actual account ID
update_account_id() {
    echo -e "${YELLOW}Updating app.py with your AWS Account ID...${NC}"
    sed -i.bak "s/AWS_ACCOUNT = \"123456789012\"/AWS_ACCOUNT = \"$ACCOUNT_ID\"/" app.py
    echo -e "${GREEN}✓ Updated app.py${NC}"
    echo ""
}

# Setup Python virtual environment
setup_venv() {
    echo -e "${YELLOW}Setting up Python virtual environment...${NC}"

    if [ ! -d ".venv" ]; then
        python3 -m venv .venv
    fi

    source .venv/bin/activate
    pip install -q --upgrade pip
    pip install -q -r requirements.txt

    echo -e "${GREEN}✓ Python dependencies installed${NC}"
    echo ""
}

# Bootstrap CDK (if needed)
bootstrap_cdk() {
    echo -e "${YELLOW}Checking if CDK is bootstrapped...${NC}"

    # Check if bootstrap stack exists
    if ! aws cloudformation describe-stacks --stack-name CDKToolkit --profile $PROFILE --region $REGION &> /dev/null; then
        echo -e "${YELLOW}CDK not bootstrapped. Running bootstrap...${NC}"
        cdk bootstrap aws://$ACCOUNT_ID/$REGION --profile $PROFILE
        echo -e "${GREEN}✓ CDK bootstrapped${NC}"
    else
        echo -e "${GREEN}✓ CDK already bootstrapped${NC}"
    fi
    echo ""
}

# Deploy infrastructure
deploy_infrastructure() {
    echo -e "${YELLOW}Deploying CDK stacks...${NC}"
    echo -e "${YELLOW}This will take approximately 15-20 minutes.${NC}"
    echo ""

    cdk deploy --all --profile $PROFILE --require-approval never

    echo ""
    echo -e "${GREEN}✓ Infrastructure deployed successfully${NC}"
    echo ""
}

# Get stack outputs
get_outputs() {
    echo -e "${YELLOW}Retrieving stack outputs...${NC}"

    ECR_URI=$(aws cloudformation describe-stacks \
        --stack-name $PROJECT-$ENV-backend \
        --query "Stacks[0].Outputs[?OutputKey=='ECRRepositoryURI'].OutputValue" \
        --output text \
        --profile $PROFILE)

    FRONTEND_BUCKET=$(aws cloudformation describe-stacks \
        --stack-name $PROJECT-$ENV-frontend \
        --query "Stacks[0].Outputs[?OutputKey=='FrontendBucketName'].OutputValue" \
        --output text \
        --profile $PROFILE)

    CLOUDFRONT_URL=$(aws cloudformation describe-stacks \
        --stack-name $PROJECT-$ENV-frontend \
        --query "Stacks[0].Outputs[?OutputKey=='FrontendURL'].OutputValue" \
        --output text \
        --profile $PROFILE)

    CLOUDFRONT_ID=$(aws cloudformation describe-stacks \
        --stack-name $PROJECT-$ENV-frontend \
        --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDistributionId'].OutputValue" \
        --output text \
        --profile $PROFILE)

    echo -e "${GREEN}✓ Outputs retrieved${NC}"
    echo ""
}

# Print next steps
print_next_steps() {
    echo "=================================================="
    echo "DEPLOYMENT COMPLETE!"
    echo "=================================================="
    echo ""
    echo -e "${GREEN}Next Steps:${NC}"
    echo ""
    echo "1. Update Secrets Manager with actual credentials:"
    echo ""
    echo "   # MQTT credentials"
    echo "   aws secretsmanager update-secret \\"
    echo "     --secret-id $PROJECT/mqtt \\"
    echo "     --secret-string '{\"host\":\"virtualfactory.proveit.services\",\"port\":1883,\"username\":\"YOUR_USER\",\"password\":\"YOUR_PASS\"}' \\"
    echo "     --profile $PROFILE"
    echo ""
    echo "2. Build and push Docker image:"
    echo ""
    echo "   cd .."
    echo "   aws ecr get-login-password --region $REGION --profile $PROFILE | \\"
    echo "     docker login --username AWS --password-stdin $ECR_URI"
    echo "   docker build -t $PROJECT-$ENV-backend ."
    echo "   docker tag $PROJECT-$ENV-backend:latest $ECR_URI:latest"
    echo "   docker push $ECR_URI:latest"
    echo ""
    echo "3. Deploy frontend to S3:"
    echo ""
    echo "   aws s3 sync . s3://$FRONTEND_BUCKET/ \\"
    echo "     --exclude '*' --include '*.html' --include '*.js' --include '*.css' \\"
    echo "     --profile $PROFILE"
    echo ""
    echo "   aws cloudfront create-invalidation \\"
    echo "     --distribution-id $CLOUDFRONT_ID \\"
    echo "     --paths '/*' \\"
    echo "     --profile $PROFILE"
    echo ""
    echo "4. Access your application:"
    echo ""
    echo -e "   ${GREEN}$CLOUDFRONT_URL${NC}"
    echo ""
    echo "=================================================="
}

# Main execution
main() {
    check_prerequisites
    get_account_id
    update_account_id
    setup_venv
    bootstrap_cdk
    deploy_infrastructure
    get_outputs
    print_next_steps
}

# Run main function
main
