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
"""

import aws_cdk as cdk
from aws_cdk import aws_ecs as ecs

from stacks.network_stack import NetworkStack
from stacks.secrets_stack import SecretsStack
from stacks.database_stack import DatabaseStack
from stacks.backend_stack import BackendStack
from stacks.frontend_stack import FrontendStack
from stacks.agentcore_stack import AgentCoreStack


# Configuration
PROJECT_NAME = "edgemind"
ENVIRONMENT = "prod"
AWS_ACCOUNT = "718815871498"
AWS_REGION = "us-east-1"
AWS_PROFILE = "reply"  # For local deployment


app = cdk.App()

# Environment configuration
env = cdk.Environment(
    account=AWS_ACCOUNT,
    region=AWS_REGION
)

# Stack 1: Network Infrastructure (VPC, Subnets, Security Groups)
network_stack = NetworkStack(
    app, f"{PROJECT_NAME}-{ENVIRONMENT}-network",
    project_name=PROJECT_NAME,
    environment=ENVIRONMENT,
    env=env,
    description="VPC, subnets, NAT gateway, and security groups for EdgeMind factory dashboard"
)

# Stack 2: Secrets Manager (MQTT and InfluxDB credentials)
secrets_stack = SecretsStack(
    app, f"{PROJECT_NAME}-{ENVIRONMENT}-secrets",
    project_name=PROJECT_NAME,
    environment=ENVIRONMENT,
    env=env,
    description="Secrets Manager secrets for MQTT broker and InfluxDB credentials"
)

# Create ECS Cluster (shared by backend and database)
cluster = ecs.Cluster(
    network_stack, "EdgeMindCluster",
    cluster_name=f"{PROJECT_NAME}-{ENVIRONMENT}-cluster",
    vpc=network_stack.vpc,
    container_insights_v2=ecs.ContainerInsights.ENABLED,
)

# Stack 3: Database (InfluxDB + ChromaDB on ECS Fargate with EFS)
database_stack = DatabaseStack(
    app, f"{PROJECT_NAME}-{ENVIRONMENT}-database",
    vpc=network_stack.vpc,
    ecs_cluster=cluster,
    influxdb_security_group=network_stack.influxdb_security_group,
    chromadb_security_group=network_stack.chromadb_security_group,
    efs_security_group=network_stack.efs_security_group,
    influxdb_secret=secrets_stack.influxdb_secret,
    project_name=PROJECT_NAME,
    environment=ENVIRONMENT,
    env=env,
    description="InfluxDB and ChromaDB on ECS Fargate with EFS persistence"
)
database_stack.add_dependency(network_stack)
database_stack.add_dependency(secrets_stack)

# Stack 4: Backend (Node.js on ECS Fargate with ALB and ECR)
backend_stack = BackendStack(
    app, f"{PROJECT_NAME}-{ENVIRONMENT}-backend",
    vpc=network_stack.vpc,
    ecs_cluster=cluster,
    backend_security_group=network_stack.backend_security_group,
    alb_security_group=network_stack.alb_security_group,
    mqtt_secret=secrets_stack.mqtt_secret,
    influxdb_secret=secrets_stack.influxdb_secret,
    maintainx_secret=secrets_stack.maintainx_secret,
    project_name=PROJECT_NAME,
    environment=ENVIRONMENT,
    env=env,
    description="Node.js backend service on ECS Fargate with Application Load Balancer"
)
backend_stack.add_dependency(network_stack)
backend_stack.add_dependency(secrets_stack)
backend_stack.add_dependency(database_stack)  # Ensure InfluxDB is running first

# Stack 5: Frontend (S3 + CloudFront)
frontend_stack = FrontendStack(
    app, f"{PROJECT_NAME}-{ENVIRONMENT}-frontend",
    alb=backend_stack.alb,
    project_name=PROJECT_NAME,
    environment=ENVIRONMENT,
    env=env,
    description="S3 bucket and CloudFront distribution for frontend static files"
)
frontend_stack.add_dependency(backend_stack)  # Need ALB DNS for CloudFront origin

# Stack 6: AgentCore (Bedrock Agents Multi-Agent System)
agentcore_stack = AgentCoreStack(
    app, f"{PROJECT_NAME}-{ENVIRONMENT}-agentcore",
    backend_api_url=f"http://{backend_stack.alb.load_balancer_dns_name}",
    project_name=PROJECT_NAME,
    environment=ENVIRONMENT,
    env=env,
    description="Bedrock Agents multi-agent system for factory intelligence"
)
agentcore_stack.add_dependency(backend_stack)  # Need backend API URL

# Add tags to all resources
for stack in [network_stack, secrets_stack, database_stack, backend_stack, frontend_stack, agentcore_stack]:
    cdk.Tags.of(stack).add("Project", PROJECT_NAME)
    cdk.Tags.of(stack).add("Environment", ENVIRONMENT)
    cdk.Tags.of(stack).add("ManagedBy", "CDK")

app.synth()
