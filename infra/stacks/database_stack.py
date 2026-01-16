from aws_cdk import (
    Stack,
    aws_ecs as ecs,
    aws_efs as efs,
    aws_ec2 as ec2,
    aws_logs as logs,
    aws_servicediscovery as servicediscovery,
    aws_secretsmanager as secretsmanager,
    CfnOutput,
    Duration,
    RemovalPolicy,
)
from constructs import Construct


class DatabaseStack(Stack):
    """InfluxDB and ChromaDB on ECS Fargate with EFS for persistence.

    Services:
    - InfluxDB 2.7: Time-series database for factory metrics
    - ChromaDB: Vector database for anomaly persistence and RAG
    """

    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        vpc: ec2.IVpc,
        ecs_cluster: ecs.ICluster,
        influxdb_security_group: ec2.ISecurityGroup,
        efs_security_group: ec2.ISecurityGroup,
        chromadb_security_group: ec2.ISecurityGroup,
        influxdb_secret: secretsmanager.ISecret,
        project_name: str = "edgemind",
        environment: str = "prod",
        **kwargs
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # EFS File System for InfluxDB data persistence
        self.file_system = efs.FileSystem(
            self, "InfluxDBFileSystem",
            vpc=vpc,
            file_system_name=f"{project_name}-{environment}-influxdb-efs",
            security_group=efs_security_group,
            encrypted=True,
            lifecycle_policy=efs.LifecyclePolicy.AFTER_14_DAYS,
            performance_mode=efs.PerformanceMode.GENERAL_PURPOSE,
            throughput_mode=efs.ThroughputMode.BURSTING,
            removal_policy=RemovalPolicy.RETAIN,  # Don't delete data on stack destroy
        )

        # Access Point for InfluxDB
        access_point = self.file_system.add_access_point(
            "InfluxDBAccessPoint",
            path="/influxdb",
            create_acl=efs.Acl(
                owner_uid="1000",
                owner_gid="1000",
                permissions="755"
            ),
            posix_user=efs.PosixUser(
                uid="1000",
                gid="1000"
            )
        )

        # Task Definition for InfluxDB
        task_definition = ecs.FargateTaskDefinition(
            self, "InfluxDBTaskDef",
            family=f"{project_name}-{environment}-influxdb",
            cpu=512,  # 0.5 vCPU
            memory_limit_mib=1024,  # 1 GB
            runtime_platform=ecs.RuntimePlatform(
                cpu_architecture=ecs.CpuArchitecture.X86_64,
                operating_system_family=ecs.OperatingSystemFamily.LINUX
            )
        )

        # Add EFS volume to task definition
        task_definition.add_volume(
            name="influxdb-data",
            efs_volume_configuration=ecs.EfsVolumeConfiguration(
                file_system_id=self.file_system.file_system_id,
                transit_encryption="ENABLED",
                authorization_config=ecs.AuthorizationConfig(
                    access_point_id=access_point.access_point_id,
                    iam="ENABLED"
                )
            )
        )

        # Grant task access to EFS
        self.file_system.grant_root_access(task_definition.task_role.grant_principal)

        # CloudWatch Logs
        # SECURITY: Retention extended to 30 days for security incident investigation
        log_group = logs.LogGroup(
            self, "InfluxDBLogGroup",
            log_group_name=f"/ecs/{project_name}-{environment}-influxdb",
            retention=logs.RetentionDays.ONE_MONTH,
            removal_policy=RemovalPolicy.DESTROY
        )

        # InfluxDB container
        container = task_definition.add_container(
            "influxdb",
            image=ecs.ContainerImage.from_registry("influxdb:2.7"),
            logging=ecs.LogDriver.aws_logs(
                stream_prefix="influxdb",
                log_group=log_group
            ),
            environment={
                "DOCKER_INFLUXDB_INIT_MODE": "setup",
                "DOCKER_INFLUXDB_INIT_USERNAME": "admin",
            },
            secrets={
                # Get token from Secrets Manager
                "DOCKER_INFLUXDB_INIT_PASSWORD": ecs.Secret.from_secrets_manager(
                    influxdb_secret, "token"
                ),
                "DOCKER_INFLUXDB_INIT_ADMIN_TOKEN": ecs.Secret.from_secrets_manager(
                    influxdb_secret, "token"
                ),
                "DOCKER_INFLUXDB_INIT_ORG": ecs.Secret.from_secrets_manager(
                    influxdb_secret, "org"
                ),
                "DOCKER_INFLUXDB_INIT_BUCKET": ecs.Secret.from_secrets_manager(
                    influxdb_secret, "bucket"
                ),
            },
            health_check=ecs.HealthCheck(
                command=["CMD-SHELL", "curl -f http://localhost:8086/health || exit 1"],
                interval=Duration.seconds(30),
                timeout=Duration.seconds(5),
                retries=3,
                start_period=Duration.seconds(60)
            )
        )

        # Add port mapping
        container.add_port_mappings(
            ecs.PortMapping(
                container_port=8086,
                protocol=ecs.Protocol.TCP,
                name="influxdb"
            )
        )

        # Mount EFS volume
        container.add_mount_points(
            ecs.MountPoint(
                container_path="/var/lib/influxdb2",
                source_volume="influxdb-data",
                read_only=False
            )
        )

        # Create Cloud Map namespace for service discovery
        namespace = servicediscovery.PrivateDnsNamespace(
            self, "EdgeMindNamespace",
            name="edgemind.local",
            vpc=vpc,
            description="Service discovery namespace for EdgeMind services"
        )

        # ECS Fargate Service (using Spot for cost savings - ~70% cheaper)
        self.service = ecs.FargateService(
            self, "InfluxDBService",
            cluster=ecs_cluster,
            task_definition=task_definition,
            service_name=f"{project_name}-{environment}-influxdb",
            desired_count=1,
            min_healthy_percent=0,  # Allow service to scale down during Spot interruptions
            max_healthy_percent=200,  # Allow new task to start before stopping old
            security_groups=[influxdb_security_group],
            vpc_subnets=ec2.SubnetSelection(
                subnet_type=ec2.SubnetType.PUBLIC  # Default VPC only has public subnets
            ),
            assign_public_ip=True,  # Required for public subnet
            cloud_map_options=ecs.CloudMapOptions(
                name="influxdb",
                cloud_map_namespace=namespace,
                dns_record_type=servicediscovery.DnsRecordType.A,
                dns_ttl=Duration.seconds(10)
            ),
            circuit_breaker=ecs.DeploymentCircuitBreaker(
                rollback=True
            ),
            enable_execute_command=True,  # For debugging
            capacity_provider_strategies=[
                ecs.CapacityProviderStrategy(
                    capacity_provider="FARGATE_SPOT",
                    weight=1,  # Prefer Spot
                ),
                ecs.CapacityProviderStrategy(
                    capacity_provider="FARGATE",
                    weight=0,  # Fallback to on-demand if no Spot available
                    base=0,
                ),
            ],
        )

        # InfluxDB Outputs
        CfnOutput(
            self, "InfluxDBServiceName",
            value=self.service.service_name,
            description="InfluxDB ECS Service Name"
        )

        CfnOutput(
            self, "InfluxDBFileSystemId",
            value=self.file_system.file_system_id,
            description="InfluxDB EFS File System ID"
        )

        CfnOutput(
            self, "InfluxDBInternalURL",
            value="http://influxdb.edgemind.local:8086",
            description="InfluxDB internal URL via Cloud Map"
        )

        # ==========================================================================
        # ChromaDB - Vector Database for Anomaly Persistence and RAG
        # ==========================================================================

        # EFS Access Point for ChromaDB (separate from InfluxDB)
        chromadb_access_point = self.file_system.add_access_point(
            "ChromaDBAccessPoint",
            path="/chromadb",
            create_acl=efs.Acl(
                owner_uid="1000",
                owner_gid="1000",
                permissions="755"
            ),
            posix_user=efs.PosixUser(
                uid="1000",
                gid="1000"
            )
        )

        # Task Definition for ChromaDB
        chromadb_task_definition = ecs.FargateTaskDefinition(
            self, "ChromaDBTaskDef",
            family=f"{project_name}-{environment}-chromadb",
            cpu=256,  # 0.25 vCPU - ChromaDB is lightweight
            memory_limit_mib=512,  # 512 MB
            runtime_platform=ecs.RuntimePlatform(
                cpu_architecture=ecs.CpuArchitecture.X86_64,
                operating_system_family=ecs.OperatingSystemFamily.LINUX
            )
        )

        # Add EFS volume to ChromaDB task definition
        chromadb_task_definition.add_volume(
            name="chromadb-data",
            efs_volume_configuration=ecs.EfsVolumeConfiguration(
                file_system_id=self.file_system.file_system_id,
                transit_encryption="ENABLED",
                authorization_config=ecs.AuthorizationConfig(
                    access_point_id=chromadb_access_point.access_point_id,
                    iam="ENABLED"
                )
            )
        )

        # Grant ChromaDB task access to EFS
        self.file_system.grant_root_access(chromadb_task_definition.task_role.grant_principal)

        # CloudWatch Logs for ChromaDB
        chromadb_log_group = logs.LogGroup(
            self, "ChromaDBLogGroup",
            log_group_name=f"/ecs/{project_name}-{environment}-chromadb",
            retention=logs.RetentionDays.ONE_MONTH,
            removal_policy=RemovalPolicy.DESTROY
        )

        # ChromaDB container
        chromadb_container = chromadb_task_definition.add_container(
            "chromadb",
            image=ecs.ContainerImage.from_registry("chromadb/chroma:latest"),
            logging=ecs.LogDriver.aws_logs(
                stream_prefix="chromadb",
                log_group=chromadb_log_group
            ),
            environment={
                "IS_PERSISTENT": "TRUE",
                "PERSIST_DIRECTORY": "/chroma/chroma",
                "ANONYMIZED_TELEMETRY": "FALSE",
            },
            # Health check using bash TCP check - chromadb/chroma image lacks curl/wget
            # but has bash with /dev/tcp support
            health_check=ecs.HealthCheck(
                command=["CMD-SHELL", "bash -c 'echo > /dev/tcp/localhost/8000'"],
                interval=Duration.seconds(30),
                timeout=Duration.seconds(5),
                retries=3,
                start_period=Duration.seconds(60)
            )
        )

        # Add port mapping for ChromaDB
        chromadb_container.add_port_mappings(
            ecs.PortMapping(
                container_port=8000,
                protocol=ecs.Protocol.TCP,
                name="chromadb"
            )
        )

        # Mount EFS volume for ChromaDB persistence
        chromadb_container.add_mount_points(
            ecs.MountPoint(
                container_path="/chroma/chroma",
                source_volume="chromadb-data",
                read_only=False
            )
        )

        # ChromaDB ECS Fargate Service (using Spot for cost savings - ~70% cheaper)
        self.chromadb_service = ecs.FargateService(
            self, "ChromaDBService",
            cluster=ecs_cluster,
            task_definition=chromadb_task_definition,
            service_name=f"{project_name}-{environment}-chromadb",
            desired_count=1,
            min_healthy_percent=0,  # Allow service to scale down during Spot interruptions
            max_healthy_percent=200,  # Allow new task to start before stopping old
            security_groups=[chromadb_security_group],
            vpc_subnets=ec2.SubnetSelection(
                subnet_type=ec2.SubnetType.PUBLIC
            ),
            assign_public_ip=True,
            cloud_map_options=ecs.CloudMapOptions(
                name="chromadb",
                cloud_map_namespace=namespace,
                dns_record_type=servicediscovery.DnsRecordType.A,
                dns_ttl=Duration.seconds(10)
            ),
            circuit_breaker=ecs.DeploymentCircuitBreaker(
                rollback=True
            ),
            enable_execute_command=True,
            capacity_provider_strategies=[
                ecs.CapacityProviderStrategy(
                    capacity_provider="FARGATE_SPOT",
                    weight=1,  # Prefer Spot
                ),
                ecs.CapacityProviderStrategy(
                    capacity_provider="FARGATE",
                    weight=0,  # Fallback to on-demand if no Spot available
                    base=0,
                ),
            ],
        )

        # ChromaDB Outputs
        CfnOutput(
            self, "ChromaDBServiceName",
            value=self.chromadb_service.service_name,
            description="ChromaDB ECS Service Name"
        )

        CfnOutput(
            self, "ChromaDBInternalURL",
            value="http://chromadb.edgemind.local:8000",
            description="ChromaDB internal URL via Cloud Map"
        )
