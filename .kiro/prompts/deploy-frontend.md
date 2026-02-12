# Deploy Frontend

Sync frontend static files to S3 bucket behind CloudFront.

## Steps

1. **Get S3 bucket name** from deployed stack:
   ```bash
   BUCKET=$(aws cloudformation describe-stacks --stack-name edgemind-prod-frontend \
     --query "Stacks[0].Outputs[?OutputKey=='FrontendBucketName'].OutputValue" --output text)
   ```

2. **Sync frontend files** to S3:
   ```bash
   aws s3 sync . s3://$BUCKET/ \
     --exclude "node_modules/*" \
     --exclude "infra/*" \
     --exclude "agent/*" \
     --exclude "lib/*" \
     --exclude "Deployment Scripts/*" \
     --exclude "knowledge-base/*" \
     --exclude ".git/*" \
     --exclude ".kiro/*" \
     --exclude "*.md" \
     --exclude "package*.json" \
     --exclude "Dockerfile" \
     --exclude "docker-compose*.yml" \
     --exclude ".env*" \
     --exclude "server.js" \
     --include "index.html" \
     --include "js/*" \
     --include "css/*" \
     --include "*.ico" \
     --include "*.png" \
     --include "*.svg"
   ```

3. **Invalidate CloudFront cache** (optional, for immediate updates):
   ```bash
   DIST_ID=$(aws cloudformation describe-stacks --stack-name edgemind-prod-frontend \
     --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" --output text)
   aws cloudfront create-invalidation --distribution-id $DIST_ID --paths "/*"
   ```

## Notes
- Frontend files: index.html, js/*, css/*
- CloudFront handles caching and HTTPS
