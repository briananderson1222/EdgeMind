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
    """InfluxDB on ECS Fargate with EFS for persistence."""

    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        vpc: ec2.IVpc,
        ecs_cluster: ecs.ICluster,
        influxdb_security_group: ec2.ISecurityGroup,
        efs_security_group: ec2.ISecurityGroup,
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
        log_group = logs.LogGroup(
            self, "InfluxDBLogGroup",
            log_group_name=f"/ecs/{project_name}-{environment}-influxdb",
            retention=logs.RetentionDays.ONE_WEEK,
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

        # ECS Fargate Service
        self.service = ecs.FargateService(
            self, "InfluxDBService",
            cluster=ecs_cluster,
            task_definition=task_definition,
            service_name=f"{project_name}-{environment}-influxdb",
            desired_count=1,
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
        )

        # Outputs
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
