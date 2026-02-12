# Deploy CDK Infrastructure

Deploy EdgeMind CDK stacks with environment-specific overrides.

## Steps

1. **Determine AWS Account**: Use AWS CLI to get the account ID for the specified profile (or default if not specified):
   ```bash
   aws sts get-caller-identity --query Account --output text
   ```

2. **Check for existing VPC**: Query deployed network stack for VPC ID:
   ```bash
   aws cloudformation describe-stacks --stack-name edgemind-prod-network \
     --query "Stacks[0].Outputs[?OutputKey=='VpcId'].OutputValue" --output text
   ```
   If stack exists, use this VPC ID for subsequent deployments.

3. **Deploy CDK stacks** from `infra/` directory:
   ```bash
   cd infra
   source .venv/bin/activate
   cdk deploy --all -c account=<ACCOUNT_ID> -c vpc_id=<VPC_ID> --require-approval never
   ```

4. **Context overrides** (pass as needed):
   - `-c account=<ACCOUNT_ID>` - AWS account
   - `-c region=<REGION>` - AWS region (default: us-east-1)
   - `-c vpc_id=<VPC_ID>` - Use existing VPC
   - `-c resource_suffix=<SUFFIX>` - For personal stacks (e.g., `-anderbs`)
   - `-c cpu_architecture=X86_64|ARM64` - Container architecture (default: X86_64)

## Notes
- Default account: 718815871498 (CI/CD account)
- Default VPC: vpc-0352743a1bf5ef86f
- Stack prefix: edgemind-prod-*
