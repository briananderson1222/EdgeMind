import os
from pathlib import Path
import yaml
from mcp.client.streamable_http import streamablehttp_client
from strands import Agent
from strands.tools.mcp import MCPClient
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from model.load import load_model
from tools import retrieve

app = BedrockAgentCoreApp()

EDGEMIND_MCP_SERVER_URL = os.environ.get("EDGEMIND_MCP_SERVER_URL", "http://localhost:8000/mcp")

# Load prompts from YAML
with open(Path(__file__).parent / "prompt.yaml") as f:
    PROMPTS = yaml.safe_load(f)

SYSTEM_PROMPT = PROMPTS["system_prompt"]
AGENT_CONFIGS = PROMPTS.get("agents", {})

@app.entrypoint
async def invoke(payload, context):
    mcp_client = MCPClient(lambda: streamablehttp_client(EDGEMIND_MCP_SERVER_URL))
    
    # Get agent config based on agent_type
    agent_type = payload.get("agent_type", "chat")
    agent_config = AGENT_CONFIGS.get(agent_type, {"prompt": SYSTEM_PROMPT})
    system_prompt = agent_config.get("prompt", SYSTEM_PROMPT)
    allowed_tools = agent_config.get("tools")  # None means all tools
    
    with mcp_client:
        mcp_tools = mcp_client.list_tools_sync()
        
        # Filter MCP tools if agent specifies allowed tools
        if allowed_tools:
            mcp_tools = [t for t in mcp_tools if t.name in allowed_tools]
        
        # Add local tools based on agent config
        local_tools = []
        if not allowed_tools or "retrieve" in allowed_tools:
            local_tools.append(retrieve)
        
        agent = Agent(
            model=load_model(),
            tools=[*mcp_tools, *local_tools],
            system_prompt=system_prompt
        )

        stream = agent.stream_async(payload.get("prompt"))
        async for event in stream:
            if "data" in event and isinstance(event["data"], str):
                yield event["data"]

if __name__ == "__main__":
    app.run()
