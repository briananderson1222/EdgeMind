# Deploy Agents

Deploy Strands-based AI agents to AWS Bedrock AgentCore Runtime.

## Usage

```bash
./Deployment\ Scripts/deploy-agents.sh [agent1] [agent2] ...
```

## Available Agents

- `chat` - Chat assistant agent
- `anomaly` - Anomaly detection agent
- `troubleshoot` - Equipment troubleshooting agent

## Examples

Deploy all agents:
```bash
./Deployment\ Scripts/deploy-agents.sh chat anomaly troubleshoot
```

Deploy single agent:
```bash
./Deployment\ Scripts/deploy-agents.sh chat
```

## What the Script Does

1. Reads CDK stack outputs (CloudFront URL, Knowledge Base ID)
2. Creates IAM execution role for agents to call Bedrock
3. Sets up MCP Gateway (converts OpenAPI spec to MCP tools)
4. Deploys each agent to AgentCore Runtime using `agentcore deploy`
5. Stores agent IDs in SSM Parameter Store for backend discovery

## Prerequisites

- AWS CLI configured
- `agentcore` CLI installed
- CDK stacks deployed (network, backend, knowledgebase)

## Notes
- Agent source code in `agent/` directory
- Agent IDs stored in SSM: `/edgemind/agents/<agent-name>`
