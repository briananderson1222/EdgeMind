#!/usr/bin/env python3
"""
EdgeMind Factory Dashboard - AWS CDK Application

Deploys the complete infrastructure for the EdgeMind real-time factory
intelligence dashboard on AWS using ECS Fargate, InfluxDB, and CloudFront.

Architecture:
- VPC with 2 AZs, public/private subnets, NAT Gateway
- ECS Fargate cluster running Node.js backend and InfluxDB
- Application Load Balancer with WebSocket support
- S3 + CloudFront for frontend static files
- Secrets Manager for MQTT and InfluxDB credentials
- IAM roles with Bedrock permissions for Claude AI

Configuration:
- Set CDK_DEFAULT_ACCOUNT or pass -c account=XXXX to override account
- Set CDK_DEFAULT_REGION or pass -c region=XXXX to override region
- Pass -c stack_suffix=XXXX to add suffix to stack names (e.g., for personal stacks)
"""

import os
import aws_cdk as cdk
from aws_cdk import aws_ecs as ecs

from stacks.network_stack import NetworkStack
from stacks.secrets_stack import SecretsStack
from stacks.database_stack import DatabaseStack
from stacks.backend_stack import BackendStack
from stacks.frontend_stack import FrontendStack
from stacks.knowledge_base_stack import KnowledgeBaseStack


# Configuration with environment variable / context overrides
PROJECT_NAME = "edgemind"
ENVIRONMENT = "prod"

# Default values (CI/CD account) - can be overridden via context or env vars
DEFAULT_ACCOUNT = "718815871498"
DEFAULT_REGION = "us-east-1"
DEFAULT_VPC_ID = "vpc-0352743a1bf5ef86f"  # CI/CD account default VPC

app = cdk.App()

# Allow override via CDK context (-c account=XXX) or environment variables
aws_account = app.node.try_get_context("account") or os.environ.get("CDK_DEFAULT_ACCOUNT") or DEFAULT_ACCOUNT
aws_region = app.node.try_get_context("region") or os.environ.get("CDK_DEFAULT_REGION") or DEFAULT_REGION
resource_suffix = app.node.try_get_context("resource_suffix") or ""  # For globally-unique resources (S3 buckets)
vpc_id = app.node.try_get_context("vpc_id") or DEFAULT_VPC_ID
bedrock_model_id = app.node.try_get_context("bedrock_model_id")  # None uses stack default
cpu_architecture = app.node.try_get_context("cpu_architecture") or "X86_64"  # X86_64 or ARM64

# Stack names are always edgemind-prod-* (no suffix)
stack_prefix = f"{PROJECT_NAME}-{ENVIRONMENT}"

# Environment configuration
env = cdk.Environment(
    account=aws_account,
    region=aws_region
)

# Stack 1: Network Infrastructure (VPC, Subnets, Security Groups)
network_stack = NetworkStack(
    app, f"{stack_prefix}-network",
    project_name=PROJECT_NAME,
    environment=ENVIRONMENT,
    resource_suffix=resource_suffix,
    vpc_id=vpc_id,
    env=env,
    description="VPC, subnets, NAT gateway, and security groups for EdgeMind factory dashboard"
)

# Stack 2: Secrets Manager (MQTT and InfluxDB credentials)
secrets_stack = SecretsStack(
    app, f"{stack_prefix}-secrets",
    project_name=PROJECT_NAME,
    environment=ENVIRONMENT,
    resource_suffix=resource_suffix,
    env=env,
    description="Secrets Manager secrets for MQTT broker and InfluxDB credentials"
)

# Create ECS Cluster (shared by backend and database)
cluster = ecs.Cluster(
    network_stack, "EdgeMindCluster",
    cluster_name=f"{stack_prefix}-cluster",
    vpc=network_stack.vpc,
    container_insights_v2=ecs.ContainerInsights.ENABLED,
)

# Stack 3: Database (InfluxDB + ChromaDB on ECS Fargate with EFS)
database_stack = DatabaseStack(
    app, f"{stack_prefix}-database",
    vpc=network_stack.vpc,
    ecs_cluster=cluster,
    influxdb_security_group=network_stack.influxdb_security_group,
    chromadb_security_group=network_stack.chromadb_security_group,
    efs_security_group=network_stack.efs_security_group,
    influxdb_secret=secrets_stack.influxdb_secret,
    project_name=PROJECT_NAME,
    environment=ENVIRONMENT,
    resource_suffix=resource_suffix,
    env=env,
    description="InfluxDB and ChromaDB on ECS Fargate with EFS persistence"
)
database_stack.add_dependency(network_stack)
database_stack.add_dependency(secrets_stack)

# Stack 4: Backend (Node.js on ECS Fargate with ALB and ECR)
backend_kwargs = {
    "vpc": network_stack.vpc,
    "ecs_cluster": cluster,
    "backend_security_group": network_stack.backend_security_group,
    "alb_security_group": network_stack.alb_security_group,
    "mqtt_secret": secrets_stack.mqtt_secret,
    "influxdb_secret": secrets_stack.influxdb_secret,
    "maintainx_secret": secrets_stack.maintainx_secret,
    "project_name": PROJECT_NAME,
    "environment": ENVIRONMENT,
    "resource_suffix": resource_suffix,
    "cpu_architecture": cpu_architecture,
    "env": env,
    "description": "Node.js backend service on ECS Fargate with Application Load Balancer",
}
if bedrock_model_id:
    backend_kwargs["bedrock_model_id"] = bedrock_model_id

backend_stack = BackendStack(app, f"{stack_prefix}-backend", **backend_kwargs)
backend_stack.add_dependency(network_stack)
backend_stack.add_dependency(secrets_stack)
backend_stack.add_dependency(database_stack)  # Ensure InfluxDB is running first

# Stack 5: Frontend (S3 + CloudFront)
frontend_stack = FrontendStack(
    app, f"{stack_prefix}-frontend",
    alb=backend_stack.alb,
    project_name=PROJECT_NAME,
    environment=ENVIRONMENT,
    resource_suffix=resource_suffix,
    env=env,
    description="S3 bucket and CloudFront distribution for frontend static files"
)
frontend_stack.add_dependency(backend_stack)  # Need ALB DNS for CloudFront origin

# Stack 6: Knowledge Base (Bedrock KB with S3 Vectors for SOPs)
knowledgebase_stack = KnowledgeBaseStack(
    app, f"{stack_prefix}-knowledgebase",
    project_name=PROJECT_NAME,
    environment=ENVIRONMENT,
    resource_suffix=resource_suffix,
    env=env,
    description="Bedrock Knowledge Base with S3 Vectors for SOP documents"
)

# Add tags to all resources
for stack in [network_stack, secrets_stack, database_stack, backend_stack, frontend_stack, knowledgebase_stack]:
    cdk.Tags.of(stack).add("Project", PROJECT_NAME)
    cdk.Tags.of(stack).add("Environment", ENVIRONMENT)
    cdk.Tags.of(stack).add("ManagedBy", "CDK")

app.synth()
