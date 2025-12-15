from aws_cdk import (
    Stack,
    aws_ec2 as ec2,
    CfnOutput,
)
from constructs import Construct
from typing import List


class NetworkStack(Stack):
    """Security groups for EdgeMind factory dashboard using existing default VPC."""

    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        project_name: str = "edgemind",
        environment: str = "prod",
        vpc_id: str = "vpc-0352743a1bf5ef86f",  # Default VPC
        **kwargs
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # Import existing default VPC instead of creating new one
        # This avoids VPC limit issues and saves NAT Gateway costs
        self.vpc = ec2.Vpc.from_lookup(
            self, "EdgeMindVPC",
            vpc_id=vpc_id
        )

        # Security Group for ALB (public-facing)
        self.alb_security_group = ec2.SecurityGroup(
            self, "ALBSecurityGroup",
            vpc=self.vpc,
            security_group_name=f"{project_name}-{environment}-alb-sg",
            description="Security group for Application Load Balancer",
            allow_all_outbound=True,
        )

        # Allow HTTP and HTTPS from internet
        self.alb_security_group.add_ingress_rule(
            peer=ec2.Peer.any_ipv4(),
            connection=ec2.Port.tcp(80),
            description="Allow HTTP from internet"
        )
        self.alb_security_group.add_ingress_rule(
            peer=ec2.Peer.any_ipv4(),
            connection=ec2.Port.tcp(443),
            description="Allow HTTPS from internet"
        )

        # Security Group for Backend ECS tasks
        self.backend_security_group = ec2.SecurityGroup(
            self, "BackendSecurityGroup",
            vpc=self.vpc,
            security_group_name=f"{project_name}-{environment}-backend-sg",
            description="Security group for Backend ECS tasks",
            allow_all_outbound=True,
        )

        # Allow traffic from ALB to backend on ports 3000 (HTTP) and 8080 (WebSocket)
        self.backend_security_group.add_ingress_rule(
            peer=self.alb_security_group,
            connection=ec2.Port.tcp(3000),
            description="Allow HTTP from ALB to backend"
        )
        self.backend_security_group.add_ingress_rule(
            peer=self.alb_security_group,
            connection=ec2.Port.tcp(8080),
            description="Allow WebSocket from ALB to backend"
        )

        # Security Group for InfluxDB ECS tasks
        self.influxdb_security_group = ec2.SecurityGroup(
            self, "InfluxDBSecurityGroup",
            vpc=self.vpc,
            security_group_name=f"{project_name}-{environment}-influxdb-sg",
            description="Security group for InfluxDB ECS tasks",
            allow_all_outbound=True,
        )

        # Allow traffic from backend to InfluxDB on port 8086
        self.influxdb_security_group.add_ingress_rule(
            peer=self.backend_security_group,
            connection=ec2.Port.tcp(8086),
            description="Allow InfluxDB from backend"
        )

        # Security Group for EFS (used by InfluxDB for persistence)
        self.efs_security_group = ec2.SecurityGroup(
            self, "EFSSecurityGroup",
            vpc=self.vpc,
            security_group_name=f"{project_name}-{environment}-efs-sg",
            description="Security group for EFS mount targets",
            allow_all_outbound=True,
        )

        # Allow NFS from InfluxDB tasks
        self.efs_security_group.add_ingress_rule(
            peer=self.influxdb_security_group,
            connection=ec2.Port.tcp(2049),
            description="Allow NFS from InfluxDB tasks"
        )

        # Outputs
        CfnOutput(
            self, "VPCId",
            value=self.vpc.vpc_id,
            description="VPC ID",
            export_name=f"{project_name}-{environment}-vpc-id"
        )

        CfnOutput(
            self, "ALBSecurityGroupId",
            value=self.alb_security_group.security_group_id,
            description="ALB Security Group ID",
            export_name=f"{project_name}-{environment}-alb-sg-id"
        )

        CfnOutput(
            self, "BackendSecurityGroupId",
            value=self.backend_security_group.security_group_id,
            description="Backend Security Group ID",
            export_name=f"{project_name}-{environment}-backend-sg-id"
        )

        CfnOutput(
            self, "InfluxDBSecurityGroupId",
            value=self.influxdb_security_group.security_group_id,
            description="InfluxDB Security Group ID",
            export_name=f"{project_name}-{environment}-influxdb-sg-id"
        )
