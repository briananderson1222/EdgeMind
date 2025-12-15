# EdgeMind Documentation

This directory contains documentation and architecture diagrams for the EdgeMind Factory Intelligence Platform.

## Architecture Diagram

The architecture diagram (`edgemind_architecture.png`) visualizes the complete data flow from the ProveIt! Virtual Factory through the EdgeMind server to the frontend dashboard.

### Generating the Diagram

The diagram is generated using the Python `diagrams` library:

```bash
# Navigate to docs directory
cd /Users/stefanbekker/Projects/EdgeMind/docs

# Activate virtual environment
source .venv/bin/activate

# Generate diagram
python generate_architecture_diagram.py
```

### Prerequisites

The script has already set up a virtual environment with the required dependencies:

- **Python packages** (in `.venv`):
  - `diagrams` - Architecture diagram generation library

- **System dependencies** (installed via Homebrew):
  - `graphviz` - Graph visualization software

### Output

The script generates:
- `edgemind_architecture.png` - Professional architecture diagram suitable for executive presentations

### What the Diagram Shows

The architecture diagram illustrates:

1. **Data Source**: ProveIt! Virtual Factory MQTT Broker (virtualfactory.proveit.services:1883)
2. **EdgeMind Server**: Node.js application that:
   - Subscribes to all MQTT topics (#)
   - Writes numeric data to InfluxDB
   - Runs an agentic loop every 30 seconds to analyze trends
   - Broadcasts real-time data and insights via WebSocket
3. **Time-Series Storage**: InfluxDB for factory metrics
4. **AI Analysis**: AWS Bedrock (Claude Sonnet) for trend analysis and anomaly detection
5. **Frontend**: Live dashboard (factory-live.html) receiving real-time updates

### Customizing the Diagram

To modify the diagram, edit `generate_architecture_diagram.py` and regenerate:

- Adjust graph attributes (spacing, colors, fonts)
- Modify edge labels and styles
- Add/remove components
- Change the layout direction (TB, LR, BT, RL)

See the [diagrams library documentation](https://diagrams.mingrammer.com/) for more options.
