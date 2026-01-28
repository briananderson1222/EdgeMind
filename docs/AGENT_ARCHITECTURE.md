# EdgeMind Agent Architecture

This document describes the specialized AI agents deployed via AWS Bedrock AgentCore.

## Overview

EdgeMind uses three specialized agents, each with a distinct purpose:

| Agent | Purpose | Trigger |
|-------|---------|---------|
| **Anomaly** | Continuous trend analysis and threshold monitoring | Scheduled (30s) |
| **Chat** | Interactive Q&A with factory data | On-demand |
| **Troubleshoot** | Equipment diagnostics and SOP-guided resolution | On-demand |

## Directory Structure

```
agent/
├── anomaly/
│   ├── .bedrock_agentcore.yaml   # AgentCore deployment config
│   ├── Dockerfile
│   ├── pyproject.toml
│   └── src/
│       ├── main.py               # Agent entrypoint
│       ├── prompt.yaml           # System prompt
│       └── model/load.py         # Model configuration
├── chat/
│   ├── .bedrock_agentcore.yaml
│   ├── Dockerfile
│   ├── pyproject.toml
│   └── src/
│       ├── main.py
│       ├── prompt.yaml
│       ├── model/load.py
│       └── tools/                # Knowledge base tools
│           ├── __init__.py
│           └── local_kb.py
└── troubleshoot/
    ├── .bedrock_agentcore.yaml
    ├── Dockerfile
    ├── pyproject.toml
    └── src/
        ├── main.py
        ├── prompt.yaml
        ├── model/load.py
        └── tools/
            ├── __init__.py
            └── local_kb.py
```

## Agent Details

### Anomaly Agent

**Purpose:** Continuous monitoring of factory metrics with threshold-based alerting.

**Capabilities:**
- Analyzes 5-minute rolling window of trend data
- Detects anomalies based on operator-defined thresholds
- Tracks waste/defect/reject metrics for quality issues
- Provides enterprise-specific insights (glass, beverage, pharma)

**Output Format:**
```json
{
  "summary": "brief overview",
  "trends": [{"metric": "name", "direction": "rising|falling|stable"}],
  "anomalies": [{"description": "...", "severity": "low|medium|high"}],
  "wasteAlerts": [{"enterprise": "...", "metric": "...", "threshold": "warning|critical"}],
  "recommendations": ["actionable suggestions"],
  "enterpriseInsights": {"Enterprise A": "...", "Enterprise B": "...", "Enterprise C": "..."}
}
```

### Chat Agent

**Purpose:** Interactive assistant for factory data queries.

**Capabilities:**
- OEE analysis for Enterprise A & B (discrete manufacturing)
- Batch process metrics for Enterprise C (pharmaceutical)
- Equipment state queries (RUNNING, IDLE, DOWN, MAINTENANCE)
- Knowledge base search for SOPs and documentation

**Domain Knowledge:**
- Enterprise A & B: OEE = Availability × Performance × Quality (target: 85%)
- Enterprise C: ISA-88 batch control (yield, cycle time, phase progress)

### Troubleshoot Agent

**Purpose:** Guided diagnostics for equipment failures.

**Workflow:**
1. Query knowledge base for relevant SOPs
2. Gather equipment state and recent metrics
3. Provide structured diagnosis with:
   - Likely causes
   - Troubleshooting steps (with SOP citations)
   - Immediate actions
   - Escalation criteria

## Deployment

Agents are deployed via AWS Bedrock AgentCore using the `.bedrock_agentcore.yaml` configuration:

```yaml
default_agent: edgemindassistant_Agent
agents:
  edgemindassistant_Agent:
    deployment_type: direct_code_deploy
    runtime_type: PYTHON_3_10
    platform: linux/amd64
```

### Local Development

```bash
# Install dependencies
cd agent/chat
uv sync

# Run locally
uv run python src/main.py
```

### Docker Build

```bash
docker build -t edgemind-chat-agent agent/chat/
```

## Integration with Backend

The backend (`server.js`) invokes agents via the Agent API:

```
POST /api/agent/ask
{
  "question": "Why is OEE dropping in Enterprise A?",
  "agent": "chat"  // or "troubleshoot"
}
```

The Anomaly agent runs on a 30-second schedule via the Simple Loop in `lib/ai/index.js`.

## Tools

### Knowledge Base Tools (Chat & Troubleshoot)

Located in `src/tools/local_kb.py`:

```python
def search_knowledge_base(query: str) -> list:
    """Search SOPs and documentation for relevant content."""
```

Returns matching documents with citations for SOP references.
