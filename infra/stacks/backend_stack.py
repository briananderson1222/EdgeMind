from aws_cdk import (
    Stack,
    aws_ecs as ecs,
    aws_ec2 as ec2,
    aws_ecr as ecr,
    aws_elasticloadbalancingv2 as elbv2,
    aws_logs as logs,
    aws_iam as iam,
    aws_secretsmanager as secretsmanager,
    CfnOutput,
    Duration,
    RemovalPolicy,
)
from constructs import Construct


class BackendStack(Stack):
    """Node.js backend on ECS Fargate with ALB and ECR repository.

    The backend connects to:
    - MQTT broker for factory data ingestion
    - InfluxDB for time-series storage
    - ChromaDB for anomaly persistence
    - Claude AI (via Bedrock or direct API) for analysis
    """

    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        vpc: ec2.IVpc,
        ecs_cluster: ecs.ICluster,
        backend_security_group: ec2.ISecurityGroup,
        alb_security_group: ec2.ISecurityGroup,
        mqtt_secret: secretsmanager.ISecret,
        influxdb_secret: secretsmanager.ISecret,
        maintainx_secret: secretsmanager.ISecret,
        project_name: str = "edgemind",
        environment: str = "prod",
        **kwargs
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # ECR Repository - import existing repository
        # The ECR repo is created separately (manually or via CI/CD) to avoid
        # chicken-and-egg problems with ECS needing an image before the stack deploys
        ecr_repo_name = f"{project_name}-{environment}-backend"
        self.ecr_repository = ecr.Repository.from_repository_name(
            self, "BackendRepository",
            repository_name=ecr_repo_name
        )

        # Application Load Balancer
        self.alb = elbv2.ApplicationLoadBalancer(
            self, "BackendALB",
            vpc=vpc,
            load_balancer_name=f"{project_name}-{environment}-alb",
            internet_facing=True,
            security_group=alb_security_group,
            vpc_subnets=ec2.SubnetSelection(
                subnet_type=ec2.SubnetType.PUBLIC
            )
        )

        # Target Group for HTTP/WebSocket traffic
        target_group = elbv2.ApplicationTargetGroup(
            self, "BackendTargetGroup",
            vpc=vpc,
            target_group_name=f"{project_name}-{environment}-tg",
            port=3000,
            protocol=elbv2.ApplicationProtocol.HTTP,
            target_type=elbv2.TargetType.IP,
            health_check=elbv2.HealthCheck(
                path="/health",
                interval=Duration.seconds(30),
                timeout=Duration.seconds(5),
                healthy_threshold_count=2,
                unhealthy_threshold_count=3,
                protocol=elbv2.Protocol.HTTP
            ),
            deregistration_delay=Duration.seconds(30),
            # Enable sticky sessions for WebSocket support
            stickiness_cookie_duration=Duration.hours(1),
            stickiness_cookie_name="EDGEMIND_SESSION"
        )

        # HTTP Listener
        # SECURITY TODO: Add HTTPS listener with ACM certificate for production
        # To add HTTPS:
        # 1. Create ACM certificate for your domain
        # 2. Add HTTPS listener:
        #    https_listener = self.alb.add_listener("HTTPSListener",
        #        port=443, protocol=elbv2.ApplicationProtocol.HTTPS,
        #        certificates=[certificate],
        #        default_action=elbv2.ListenerAction.forward([target_group]))
        # 3. Redirect HTTP to HTTPS:
        #    http_listener.add_action("HTTPRedirect",
        #        action=elbv2.ListenerAction.redirect(protocol="HTTPS", port="443"))
        http_listener = self.alb.add_listener(
            "HTTPListener",
            port=80,
            protocol=elbv2.ApplicationProtocol.HTTP,
            default_action=elbv2.ListenerAction.forward([target_group])
        )

        # Task Definition
        task_definition = ecs.FargateTaskDefinition(
            self, "BackendTaskDef",
            family=f"{project_name}-{environment}-backend",
            cpu=512,  # 0.5 vCPU
            memory_limit_mib=1024,  # 1 GB
            runtime_platform=ecs.RuntimePlatform(
                cpu_architecture=ecs.CpuArchitecture.X86_64,
                operating_system_family=ecs.OperatingSystemFamily.LINUX
            )
        )

        # Grant Bedrock permissions (Claude models, Titan embeddings, and inference profiles)
        # Note: Inference profiles use cross-region routing, need permissions in multiple regions
        task_definition.task_role.add_to_policy(
            iam.PolicyStatement(
                effect=iam.Effect.ALLOW,
                actions=["bedrock:InvokeModel"],
                resources=[
                    # Claude foundation models in any region (cross-region inference)
                    "arn:aws:bedrock:*::foundation-model/anthropic.claude-*",
                    "arn:aws:bedrock:*::foundation-model/us.anthropic.claude-*",
                    # Titan embedding models (for ChromaDB vector storage)
                    "arn:aws:bedrock:*::foundation-model/amazon.titan-embed-*",
                    # Inference profiles (cross-region routing)
                    f"arn:aws:bedrock:{self.region}:{self.account}:inference-profile/us.anthropic.claude-*",
                    f"arn:aws:bedrock:{self.region}:{self.account}:inference-profile/anthropic.claude-*",
                ]
            )
        )

        # Grant Bedrock Agent invocation permissions (for AgentCore multi-agent system)
        task_definition.task_role.add_to_policy(
            iam.PolicyStatement(
                effect=iam.Effect.ALLOW,
                actions=["bedrock:InvokeAgent"],
                resources=[
                    f"arn:aws:bedrock:{self.region}:{self.account}:agent/*",
                    f"arn:aws:bedrock:{self.region}:{self.account}:agent-alias/*",
                ]
            )
        )

        # Grant Secrets Manager read permissions
        mqtt_secret.grant_read(task_definition.task_role)
        influxdb_secret.grant_read(task_definition.task_role)
        maintainx_secret.grant_read(task_definition.task_role)

        # CloudWatch Logs
        # SECURITY: Retention extended to 30 days for security incident investigation
        log_group = logs.LogGroup(
            self, "BackendLogGroup",
            log_group_name=f"/ecs/{project_name}-{environment}-backend",
            retention=logs.RetentionDays.ONE_MONTH,
            removal_policy=RemovalPolicy.DESTROY
        )

        # Backend container
        container = task_definition.add_container(
            "backend",
            image=ecs.ContainerImage.from_ecr_repository(
                repository=self.ecr_repository,
                tag="latest"
            ),
            logging=ecs.LogDriver.aws_logs(
                stream_prefix="backend",
                log_group=log_group
            ),
            environment={
                "PORT": "3000",
                "NODE_ENV": "production",
                "AWS_REGION": self.region,
                # ChromaDB service discovery URL (via Cloud Map)
                "CHROMA_HOST": "chromadb.edgemind.local",
                "CHROMA_PORT": "8000",
                # AgentCore (Bedrock Agents) configuration
                "AGENTCORE_AGENT_ID": "TNVA1PNEZT",
                "AGENTCORE_ALIAS_ID": "R1EEGTBSIT",
                "CMMS_ENABLED": "true",
                "CMMS_PROVIDER": "maintainx",
                "MAINTAINX_BASE_URL": "https://api.getmaintainx.com/v1",
            },
            secrets={
                # MQTT credentials from Secrets Manager
                "MQTT_HOST": ecs.Secret.from_secrets_manager(mqtt_secret, "host"),
                "MQTT_USERNAME": ecs.Secret.from_secrets_manager(mqtt_secret, "username"),
                "MQTT_PASSWORD": ecs.Secret.from_secrets_manager(mqtt_secret, "password"),
                # InfluxDB credentials from Secrets Manager
                "INFLUXDB_URL": ecs.Secret.from_secrets_manager(influxdb_secret, "url"),
                "INFLUXDB_TOKEN": ecs.Secret.from_secrets_manager(influxdb_secret, "token"),
                "INFLUXDB_ORG": ecs.Secret.from_secrets_manager(influxdb_secret, "org"),
                "INFLUXDB_BUCKET": ecs.Secret.from_secrets_manager(influxdb_secret, "bucket"),
                "MAINTAINX_API_KEY": ecs.Secret.from_secrets_manager(maintainx_secret, "api_key"
        ),
                # Note: AI uses AWS Bedrock via IAM role - no API key needed
            },
            health_check=ecs.HealthCheck(
                command=["CMD-SHELL", "curl -f http://localhost:3000/health || exit 1"],
                interval=Duration.seconds(30),
                timeout=Duration.seconds(5),
                retries=3,
                start_period=Duration.seconds(60)
            )
        )

        # Add port mapping for HTTP (WebSocket runs on same port at /ws path)
        container.add_port_mappings(
            ecs.PortMapping(
                container_port=3000,
                protocol=ecs.Protocol.TCP,
                name="http"
            )
        )

        # ECS Fargate Service
        self.service = ecs.FargateService(
            self, "BackendService",
            cluster=ecs_cluster,
            task_definition=task_definition,
            service_name=f"{project_name}-{environment}-backend",
            desired_count=1,  # Single instance for cost efficiency (demo environment)
            min_healthy_percent=100,  # Keep existing tasks running during deploy
            max_healthy_percent=200,  # Allow new tasks to start before stopping old
            security_groups=[backend_security_group],
            vpc_subnets=ec2.SubnetSelection(
                subnet_type=ec2.SubnetType.PUBLIC  # Default VPC only has public subnets
            ),
            assign_public_ip=True,  # Required for public subnet
            circuit_breaker=ecs.DeploymentCircuitBreaker(
                rollback=True
            ),
            enable_execute_command=True,  # For debugging
        )

        # Attach service to target group
        self.service.attach_to_application_target_group(target_group)

        # Auto Scaling
        scaling = self.service.auto_scale_task_count(
            min_capacity=1,
            max_capacity=4
        )

        # CPU-based scaling
        scaling.scale_on_cpu_utilization(
            "CPUScaling",
            target_utilization_percent=70,
            scale_in_cooldown=Duration.seconds(60),
            scale_out_cooldown=Duration.seconds(60)
        )

        # Memory-based scaling
        scaling.scale_on_memory_utilization(
            "MemoryScaling",
            target_utilization_percent=80,
            scale_in_cooldown=Duration.seconds(60),
            scale_out_cooldown=Duration.seconds(60)
        )

        # Outputs
        CfnOutput(
            self, "ECRRepositoryURI",
            value=self.ecr_repository.repository_uri,
            description="ECR Repository URI for backend Docker image",
            export_name=f"{project_name}-{environment}-ecr-uri"
        )

        CfnOutput(
            self, "ECRRepositoryName",
            value=self.ecr_repository.repository_name,
            description="ECR Repository Name"
        )

        CfnOutput(
            self, "ALBDNSName",
            value=self.alb.load_balancer_dns_name,
            description="Application Load Balancer DNS name",
            export_name=f"{project_name}-{environment}-alb-dns"
        )

        CfnOutput(
            self, "BackendServiceName",
            value=self.service.service_name,
            description="Backend ECS Service Name"
        )

        CfnOutput(
            self, "BackendURL",
            value=f"http://{self.alb.load_balancer_dns_name}",
            description="Backend URL"
        )
