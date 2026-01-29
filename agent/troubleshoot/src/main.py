from pathlib import Path
import os
import yaml
from strands import Agent
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from model.load import load_model
from src.kb_tools import retrieve

app = BedrockAgentCoreApp()

MCP_SERVER_URL = os.environ.get("MCP_SERVER_URL", "")

with open(Path(__file__).parent / "prompt.yaml") as f:
    SYSTEM_PROMPT = yaml.safe_load(f)["system_prompt"]

@app.entrypoint
async def invoke(payload, context):
    tools = [retrieve]
    
    # Connect to MCP server if configured
    if MCP_SERVER_URL:
        try:
            from mcp.client.streamable_http import streamablehttp_client
            from strands.tools.mcp import MCPClient
            mcp_client = MCPClient(lambda: streamablehttp_client(MCP_SERVER_URL))
            mcp_client.__enter__()
            tools = [*mcp_client.list_tools_sync(), retrieve]
        except Exception:
            pass
    
    agent = Agent(
        model=load_model(),
        tools=tools,
        system_prompt=SYSTEM_PROMPT
    )
    stream = agent.stream_async(payload.get("prompt", ""))
    async for event in stream:
        if "data" in event and isinstance(event["data"], str):
            yield event["data"]

if __name__ == "__main__":
    app.run()
