"""Bedrock Knowledge Base with S3 Vectors for EdgeMind SOPs."""

from aws_cdk import (
    Stack,
    aws_s3 as s3,
    aws_bedrock as bedrock,
    aws_iam as iam,
    custom_resources as cr,
    CfnOutput,
    RemovalPolicy,
)
from constructs import Construct


class KnowledgeBaseStack(Stack):
    """Bedrock Knowledge Base with S3 Vectors for SOP documents."""

    EMBEDDING_MODEL = "amazon.titan-embed-text-v2:0"

    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        project_name: str = "edgemind",
        environment: str = "prod",
        **kwargs
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        vector_bucket_name = f"{project_name}-{environment}-kb-vectors"
        index_name = f"{project_name}-{environment}-sops-index"

        # S3 bucket for SOP documents (regular bucket)
        self.documents_bucket = s3.Bucket(
            self, "DocumentsBucket",
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            encryption=s3.BucketEncryption.S3_MANAGED,
            versioned=True,
            removal_policy=RemovalPolicy.RETAIN,
        )

        # Create S3 Vector Bucket via custom resource
        vector_bucket = cr.AwsCustomResource(
            self, "VectorBucket",
            on_create=cr.AwsSdkCall(
                service="S3Vectors",
                action="createVectorBucket",
                parameters={"vectorBucketName": vector_bucket_name},
                physical_resource_id=cr.PhysicalResourceId.of(vector_bucket_name),
            ),
            on_delete=cr.AwsSdkCall(
                service="S3Vectors",
                action="deleteVectorBucket",
                parameters={"vectorBucketName": vector_bucket_name},
            ),
            policy=cr.AwsCustomResourcePolicy.from_statements([
                iam.PolicyStatement(
                    actions=["s3vectors:CreateVectorBucket", "s3vectors:DeleteVectorBucket"],
                    resources=["*"],
                ),
            ]),
        )

        vector_bucket_arn = f"arn:aws:s3vectors:{self.region}:{self.account}:bucket/{vector_bucket_name}"

        # Create Vector Index in the bucket
        vector_index = cr.AwsCustomResource(
            self, "VectorIndex",
            on_create=cr.AwsSdkCall(
                service="S3Vectors",
                action="createIndex",
                parameters={
                    "vectorBucketName": vector_bucket_name,
                    "indexName": index_name,
                    "dimension": 1024,  # Titan Embed v2 dimension
                    "distanceMetric": "cosine",
                    "dataType": "float32",
                },
                physical_resource_id=cr.PhysicalResourceId.of(index_name),
            ),
            on_delete=cr.AwsSdkCall(
                service="S3Vectors",
                action="deleteIndex",
                parameters={
                    "vectorBucketName": vector_bucket_name,
                    "indexName": index_name,
                },
            ),
            policy=cr.AwsCustomResourcePolicy.from_statements([
                iam.PolicyStatement(
                    actions=["s3vectors:CreateIndex", "s3vectors:DeleteIndex"],
                    resources=["*"],
                ),
            ]),
        )
        vector_index.node.add_dependency(vector_bucket)

        index_arn = f"arn:aws:s3vectors:{self.region}:{self.account}:bucket/{vector_bucket_name}/index/{index_name}"

        # IAM role for Bedrock KB
        kb_role = iam.Role(
            self, "KBRole",
            assumed_by=iam.ServicePrincipal("bedrock.amazonaws.com"),
        )

        self.documents_bucket.grant_read(kb_role)

        kb_role.add_to_policy(iam.PolicyStatement(
            actions=["bedrock:InvokeModel"],
            resources=[f"arn:aws:bedrock:{self.region}::foundation-model/{self.EMBEDDING_MODEL}"],
        ))

        kb_role.add_to_policy(iam.PolicyStatement(
            actions=["s3vectors:*"],
            resources=[vector_bucket_arn, f"{vector_bucket_arn}/*", index_arn],
        ))

        # Bedrock Knowledge Base with S3 Vectors
        self.knowledge_base = bedrock.CfnKnowledgeBase(
            self, "KnowledgeBase",
            name=f"{project_name}-{environment}-sops",
            role_arn=kb_role.role_arn,
            knowledge_base_configuration=bedrock.CfnKnowledgeBase.KnowledgeBaseConfigurationProperty(
                type="VECTOR",
                vector_knowledge_base_configuration=bedrock.CfnKnowledgeBase.VectorKnowledgeBaseConfigurationProperty(
                    embedding_model_arn=f"arn:aws:bedrock:{self.region}::foundation-model/{self.EMBEDDING_MODEL}",
                ),
            ),
            storage_configuration=bedrock.CfnKnowledgeBase.StorageConfigurationProperty(
                type="S3_VECTORS",
                s3_vectors_configuration=bedrock.CfnKnowledgeBase.S3VectorsConfigurationProperty(
                    vector_bucket_arn=vector_bucket_arn,
                    index_arn=index_arn,
                ),
            ),
        )
        self.knowledge_base.node.add_dependency(vector_index)

        # Data source with semantic chunking
        self.data_source = bedrock.CfnDataSource(
            self, "DataSource",
            name=f"{project_name}-{environment}-sops-source",
            knowledge_base_id=self.knowledge_base.attr_knowledge_base_id,
            data_source_configuration=bedrock.CfnDataSource.DataSourceConfigurationProperty(
                type="S3",
                s3_configuration=bedrock.CfnDataSource.S3DataSourceConfigurationProperty(
                    bucket_arn=self.documents_bucket.bucket_arn,
                ),
            ),
            vector_ingestion_configuration=bedrock.CfnDataSource.VectorIngestionConfigurationProperty(
                chunking_configuration=bedrock.CfnDataSource.ChunkingConfigurationProperty(
                    chunking_strategy="SEMANTIC",
                    semantic_chunking_configuration=bedrock.CfnDataSource.SemanticChunkingConfigurationProperty(
                        max_tokens=512,
                        buffer_size=0,
                        breakpoint_percentile_threshold=95,
                    ),
                ),
            ),
        )

        # Outputs
        CfnOutput(self, "KnowledgeBaseId",
            value=self.knowledge_base.attr_knowledge_base_id,
            export_name=f"{project_name}-{environment}-kb-id",
        )
        CfnOutput(self, "KnowledgeBaseArn",
            value=self.knowledge_base.attr_knowledge_base_arn,
        )
        CfnOutput(self, "DocumentsBucketName",
            value=self.documents_bucket.bucket_name,
        )
        CfnOutput(self, "VectorBucketName",
            value=vector_bucket_name,
        )
