# Bounded Context

## Vocabulary

- **Enterprise**: A top-level organizational unit (A, B, C) in the factory hierarchy.
- **Site**: A physical factory location within an enterprise (e.g., Dallas Line 1, Site3).
- **OEE**: Overall Equipment Effectiveness - key manufacturing metric combining Availability, Performance, Quality.
- **MQTT**: Message Queue Telemetry Transport - pub/sub protocol for factory sensor data.
- **InfluxDB**: Time-series database storing factory metrics. Agentic
- **Loop**: Periodic AI analysis cycle (30s intervals) that queries trends and broadcasts insights.
- **SchemaCache**: In-memory cache of discovered MQTT topic structure.
- **WebSocket**: Real-time bidirectional communication between server and frontend dashboard.
- **Measurement**: A specific metric type derived from MQTT topic (last 2 path segments).
- **Point**: InfluxDB data point with tags (enterprise, site, area, machine) and value field.

## Invariants

1883. WebSocket on port 8080 for frontend. HTTP API on port
3000. Schema cache refresh: 5 minutes. Trend analysis window: 5 minutes rolling with 1-min aggregates. Topic structure: Enterprise/Site/area/machine/component/metric/type. Main branch: main. Current branch: refactor/modularization. No circular dependencies in lib/ modules. lib/ changes require docker cp + container restart for EC2 deployment.
