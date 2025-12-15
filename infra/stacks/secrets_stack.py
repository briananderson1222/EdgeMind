from aws_cdk import (
    Stack,
    aws_secretsmanager as secretsmanager,
    CfnOutput,
    RemovalPolicy,
    SecretValue,
)
from constructs import Construct
import json


class SecretsStack(Stack):
    """Secrets Manager secrets for MQTT and InfluxDB credentials."""

    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        project_name: str = "edgemind",
        environment: str = "prod",
        **kwargs
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # MQTT credentials secret
        # Format: {"host": "mqtt://virtualfactory.proveit.services:1883", "port": "1883", "username": "proveitreadonly", "password": "..."}
        # NOTE: Update the password in AWS Console after deployment
        self.mqtt_secret = secretsmanager.Secret(
            self, "MQTTSecret",
            secret_name=f"{project_name}/mqtt",
            description="MQTT broker credentials for EdgeMind factory dashboard",
            secret_object_value={
                "host": SecretValue.unsafe_plain_text("mqtt://virtualfactory.proveit.services:1883"),
                "port": SecretValue.unsafe_plain_text("1883"),
                "username": SecretValue.unsafe_plain_text("proveitreadonly"),
                "password": SecretValue.unsafe_plain_text("UPDATE_THIS_IN_CONSOLE"),
            },
            removal_policy=RemovalPolicy.RETAIN,  # Don't delete secrets on stack destroy
        )

        # InfluxDB credentials secret
        # Format: {"url": "http://influxdb:8086", "token": "...", "org": "proveit", "bucket": "factory"}
        # NOTE: Update the token in AWS Console after deployment
        self.influxdb_secret = secretsmanager.Secret(
            self, "InfluxDBSecret",
            secret_name=f"{project_name}/influxdb",
            description="InfluxDB credentials for EdgeMind factory dashboard",
            secret_object_value={
                "url": SecretValue.unsafe_plain_text("http://influxdb.edgemind.local:8086"),
                "org": SecretValue.unsafe_plain_text("proveit"),
                "bucket": SecretValue.unsafe_plain_text("factory"),
                "token": SecretValue.unsafe_plain_text("UPDATE_THIS_IN_CONSOLE"),
            },
            removal_policy=RemovalPolicy.RETAIN,
        )

        # Outputs
        CfnOutput(
            self, "MQTTSecretArn",
            value=self.mqtt_secret.secret_arn,
            description="ARN of MQTT credentials secret",
            export_name=f"{project_name}-{environment}-mqtt-secret-arn"
        )

        CfnOutput(
            self, "InfluxDBSecretArn",
            value=self.influxdb_secret.secret_arn,
            description="ARN of InfluxDB credentials secret",
            export_name=f"{project_name}-{environment}-influxdb-secret-arn"
        )

        # Export secret names for easy reference
        CfnOutput(
            self, "MQTTSecretName",
            value=self.mqtt_secret.secret_name,
            description="Name of MQTT credentials secret"
        )

        CfnOutput(
            self, "InfluxDBSecretName",
            value=self.influxdb_secret.secret_name,
            description="Name of InfluxDB credentials secret"
        )
