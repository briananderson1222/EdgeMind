#!/usr/bin/env python3
"""
EdgeMind Architecture Diagram Generator

Clean architecture diagram optimized for executive presentations.
Reflects Fargate/serverless deployment with multi-agent AI system.

Requirements:
    pip install diagrams
    brew install graphviz  # macOS
"""

from diagrams import Diagram, Cluster, Edge
from diagrams.aws.iot import IotMqtt
from diagrams.aws.compute import Fargate, Lambda
from diagrams.aws.network import ElbApplicationLoadBalancer
from diagrams.aws.storage import S3, ElasticFileSystemEFS
from diagrams.aws.network import CloudFront
from diagrams.aws.ml import Bedrock
from diagrams.aws.security import SecretsManager
from diagrams.aws.general import User
from pathlib import Path


def generate_architecture_diagram() -> None:
    """Generate clean architecture diagram with logical flow."""

    output_path = Path(__file__).parent / "edgemind_architecture"

    graph_attr = {
        "fontsize": "18",
        "fontname": "Helvetica",
        "bgcolor": "white",
        "pad": "0.8",
        "ranksep": "1.5",
        "nodesep": "1.0",
    }

    node_attr = {
        "fontsize": "11",
        "fontname": "Helvetica",
    }

    edge_attr = {
        "fontsize": "10",
        "fontname": "Helvetica",
    }

    with Diagram(
        "EdgeMind Fargate Architecture",
        filename=str(output_path),
        direction="LR",
        graph_attr=graph_attr,
        node_attr=node_attr,
        edge_attr=edge_attr,
        show=False,
    ):
        # DATA SOURCE
        mqtt = IotMqtt("MQTT Broker\nVirtual Factory")

        # DATA LAYER (Fargate + EFS)
        with Cluster("Data Layer", graph_attr={"bgcolor": "#E8F4F8"}):
            efs = ElasticFileSystemEFS("EFS\nPersistence")
            with Cluster("Fargate Services"):
                influx = Fargate("InfluxDB")
                chroma = Fargate("ChromaDB")
            influx - Edge(style="dotted") - efs
            chroma - Edge(style="dotted") - efs

        # COMPUTE LAYER (Fargate + ALB)
        with Cluster("Compute Layer", graph_attr={"bgcolor": "#F3E5F5"}):
            alb = ElbApplicationLoadBalancer("ALB")
            backend = Fargate("Node.js\nBackend")
            alb >> backend

        # AI LAYER (Bedrock Multi-Agent)
        with Cluster("AI Layer", graph_attr={"bgcolor": "#FFF3E0"}):
            secrets = SecretsManager("Secrets\nManager")
            orchestrator = Bedrock("Orchestrator\nClaude Sonnet")
            with Cluster("Specialist Agents (Haiku)"):
                oee = Bedrock("OEE\nAnalyst")
                health = Bedrock("Equipment\nHealth")
                waste = Bedrock("Waste\nAnalyst")
                batch = Bedrock("Batch\nProcess")
            tool_lambda = Lambda("Tool\nExecution")

            orchestrator >> Edge(label="delegate", color="#FF6F00") >> [
                oee,
                health,
                waste,
                batch,
            ]
            [oee, health, waste, batch] >> tool_lambda

        # FRONTEND LAYER (S3 + CloudFront)
        with Cluster("Frontend Layer", graph_attr={"bgcolor": "#E8F5E9"}):
            s3 = S3("S3 Bucket\nStatic Files")
            cdn = CloudFront("CloudFront")
            s3 >> cdn

        # OUTPUT
        dashboard = User("Dashboard")

        # DATA FLOW
        mqtt >> Edge(label="sensor data", color="#1565C0", style="bold") >> backend
        backend >> Edge(label="write", color="#2E7D32") >> influx
        backend >> Edge(label="store", color="#2E7D32") >> chroma
        influx >> Edge(label="query", color="#7B1FA2", style="dashed") >> orchestrator
        chroma >> Edge(label="context", color="#7B1FA2", style="dashed") >> orchestrator
        secrets >> Edge(style="dotted") >> orchestrator
        tool_lambda >> Edge(label="results", color="#E65100") >> orchestrator
        orchestrator >> Edge(label="insights", color="#E65100") >> backend
        backend >> Edge(label="WebSocket", color="#1565C0", style="bold") >> alb
        alb >> Edge(label="stream", color="#1565C0") >> dashboard
        cdn >> Edge(label="static", color="#43A047") >> dashboard

    print(f"Generated: {output_path}.png")


if __name__ == "__main__":
    generate_architecture_diagram()
