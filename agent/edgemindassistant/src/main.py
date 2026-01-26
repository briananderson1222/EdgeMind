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

# Load system prompt from YAML
with open(Path(__file__).parent / "prompt.yaml") as f:
    SYSTEM_PROMPT = yaml.safe_load(f)["system_prompt"]

@app.entrypoint
async def invoke(payload, context):
    mcp_client = MCPClient(lambda: streamablehttp_client(EDGEMIND_MCP_SERVER_URL))
    
    with mcp_client:
        mcp_tools = mcp_client.list_tools_sync()
        agent = Agent(
            model=load_model(),
            tools=[*mcp_tools, retrieve],
            system_prompt=SYSTEM_PROMPT
        )

        stream = agent.stream_async(payload.get("prompt"))
        async for event in stream:
            if "data" in event and isinstance(event["data"], str):
                yield event["data"]

if __name__ == "__main__":
    app.run()
