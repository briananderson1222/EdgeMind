#!/usr/bin/env python3
"""
EdgeMind Architecture Diagram Generator

Clean architecture diagram optimized for executive presentations.

Requirements:
    pip install diagrams
    brew install graphviz  # macOS
"""

from diagrams import Diagram, Cluster, Edge
from diagrams.aws.iot import IotMqtt
from diagrams.aws.compute import EC2
from diagrams.aws.database import Timestream
from diagrams.aws.ml import Bedrock
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
        "ranksep": "1.2",
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
        "EdgeMind Architecture",
        filename=str(output_path),
        direction="LR",
        graph_attr=graph_attr,
        node_attr=node_attr,
        edge_attr=edge_attr,
        show=False,
    ):
        # Simple pipeline: Source → Process → Store/Analyze → Present

        # 1. DATA SOURCE
        mqtt = IotMqtt("MQTT Broker\nVirtual Factory")

        # 2. PROCESSING + INTELLIGENCE
        with Cluster("EdgeMind Platform", graph_attr={"bgcolor": "#F5F5F5"}):
            server = EC2("Node.js Server")

            with Cluster("AI Pipeline"):
                influx = Timestream("InfluxDB")
                claude = Bedrock("Claude AI")

        # 3. OUTPUT
        dashboard = User("Dashboard")

        # LINEAR FLOW (no back-edges to confuse Graphviz)
        mqtt >> Edge(label="sensor data", color="#1565C0", style="bold") >> server
        server >> Edge(label="store", color="#2E7D32") >> influx
        influx >> Edge(label="query", color="#7B1FA2", style="dashed") >> claude
        claude >> Edge(label="analyze", color="#E65100") >> dashboard
        server >> Edge(label="stream", color="#1565C0", style="bold") >> dashboard

    print(f"Generated: {output_path}.png")


if __name__ == "__main__":
    generate_architecture_diagram()
