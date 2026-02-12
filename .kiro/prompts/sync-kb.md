# Sync Knowledge Base

Sync local knowledge-base folder to Bedrock Knowledge Base and trigger ingestion.

## Steps

1. **Run the sync script**:
   ```bash
   ./Deployment\ Scripts/sync-kb.sh
   ```

The script will:
- Get KB bucket, ID, and data source ID from CloudFormation stack outputs
- Sync `knowledge-base/` folder to S3
- Start an ingestion job
- Wait for ingestion to complete

## Manual Steps (if script unavailable)

1. **Get stack outputs**:
   ```bash
   STACK_NAME="edgemind-prod-knowledgebase"
   BUCKET=$(aws cloudformation describe-stacks --stack-name $STACK_NAME \
     --query "Stacks[0].Outputs[?OutputKey=='DocumentsBucketName'].OutputValue" --output text)
   KB_ID=$(aws cloudformation describe-stacks --stack-name $STACK_NAME \
     --query "Stacks[0].Outputs[?OutputKey=='KnowledgeBaseId'].OutputValue" --output text)
   DS_ID=$(aws bedrock-agent list-data-sources --knowledge-base-id $KB_ID \
     --query "dataSourceSummaries[0].dataSourceId" --output text)
   ```

2. **Sync documents**:
   ```bash
   aws s3 sync knowledge-base/ s3://$BUCKET/
   ```

3. **Start ingestion**:
   ```bash
   aws bedrock-agent start-ingestion-job --knowledge-base-id $KB_ID --data-source-id $DS_ID
   ```

## Notes
- Knowledge base supports: PDF, TXT, MD, PNG, JPEG (multimodal)
- Documents stored in `knowledge-base/` directory
