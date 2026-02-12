# Deploy Backend

Build and deploy the EdgeMind Node.js backend to ECS Fargate.

## Steps

1. **Get deployment configuration** from deployed stack:
   ```bash
   # Get ECR repository URI
   ECR_REPO=$(aws cloudformation describe-stacks --stack-name edgemind-prod-backend \
     --query "Stacks[0].Outputs[?OutputKey=='EcrRepositoryUri'].OutputValue" --output text)
   
   # Get ECS cluster and service names
   CLUSTER=$(aws cloudformation describe-stacks --stack-name edgemind-prod-backend \
     --query "Stacks[0].Outputs[?OutputKey=='ClusterName'].OutputValue" --output text)
   SERVICE=$(aws cloudformation describe-stacks --stack-name edgemind-prod-backend \
     --query "Stacks[0].Outputs[?OutputKey=='ServiceName'].OutputValue" --output text)
   ```

2. **Determine CPU architecture** - check deployed task definition first, fallback to CDK:
   ```bash
   # Check deployed task definition
   TASK_DEF=$(aws ecs describe-services --cluster $CLUSTER --services $SERVICE \
     --query "services[0].taskDefinition" --output text)
   ARCH=$(aws ecs describe-task-definition --task-definition $TASK_DEF \
     --query "taskDefinition.runtimePlatform.cpuArchitecture" --output text)
   ```
   If not found, check `infra/app.py` for `cpu_architecture` context (default: ARM64).

3. **Build Docker image** matching the architecture:
   ```bash
   # For ARM64
   docker build --platform linux/arm64 -t edgemind-backend .
   
   # For X86_64
   docker build --platform linux/amd64 -t edgemind-backend .
   ```

4. **Login to ECR and push**:
   ```bash
   aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin $ECR_REPO
   docker tag edgemind-backend:latest $ECR_REPO:latest
   docker push $ECR_REPO:latest
   ```

5. **Trigger ECS deployment**:
   ```bash
   aws ecs update-service --cluster $CLUSTER --service $SERVICE --force-new-deployment
   ```

6. **Wait for deployment** and monitor status:
   ```bash
   aws ecs wait services-stable --cluster $CLUSTER --services $SERVICE
   ```
   If deployment fails repeatedly, check task stopped reasons:
   ```bash
   aws ecs describe-tasks --cluster $CLUSTER \
     --tasks $(aws ecs list-tasks --cluster $CLUSTER --service-name $SERVICE --desired-status STOPPED --query "taskArns[0]" --output text) \
     --query "tasks[0].stoppedReason"
   ```

## Notes
- ECR repo: edgemind-prod-backend
- Default architecture: ARM64 (Graviton)
- Health check endpoint: /health
