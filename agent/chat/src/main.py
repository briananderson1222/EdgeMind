import os
from pathlib import Path
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
    
    # Connect to MCP gateway with IAM auth (SigV4)
    if MCP_SERVER_URL:
        try:
            from mcp_proxy_for_aws.client import aws_iam_streamablehttp_client
            from strands.tools.mcp import MCPClient
            mcp_client = MCPClient(lambda: aws_iam_streamablehttp_client(
                endpoint=MCP_SERVER_URL,
                aws_region=os.environ.get("AWS_REGION", "us-east-1"),
                aws_service="bedrock-agentcore"
            ))
            mcp_client.__enter__()
            tools = [*mcp_client.list_tools_sync(), retrieve]
        except Exception:
            pass  # Fall back to local tools only
    
    agent = Agent(
        model=load_model(),
        tools=tools,
        system_prompt=SYSTEM_PROMPT
    )
    stream = agent.stream_async(payload.get("prompt", ""))
    async for event in stream:
        # Emit tool use events
        if "current_tool_use" in event:
            tool_info = event["current_tool_use"]
            if tool_info.get("name"):
                yield {"type": "tool_use", "name": tool_info["name"]}
        # Emit text data
        if "data" in event and isinstance(event["data"], str):
            yield event["data"]

if __name__ == "__main__":
    app.run()
