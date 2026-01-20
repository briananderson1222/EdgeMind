import os
from mcp.client.sse import sse_client
from strands import Agent
from strands.tools.mcp import MCPClient
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from model.load import load_model

app = BedrockAgentCoreApp()

EDGEMIND_MCP_SERVER_URL = os.environ.get("EDGEMIND_MCP_SERVER_URL", "http://localhost:8000/sse")

@app.entrypoint
async def invoke(payload, context):
    mcp_client = MCPClient(lambda: sse_client(EDGEMIND_MCP_SERVER_URL))
    
    with mcp_client:
        tools = mcp_client.list_tools_sync()
        agent = Agent(
            model=load_model(),
            tools=tools,
            system_prompt="""You are EdgeMind Assistant, an AI helper for a factory intelligence dashboard.
You help users understand factory metrics, OEE (Overall Equipment Effectiveness), and production data.
Use the available tools to query live factory data when users ask about metrics, trends, or equipment status.
Be concise and helpful."""
        )

        stream = agent.stream_async(payload.get("prompt"))
        async for event in stream:
            if "data" in event and isinstance(event["data"], str):
                yield event["data"]

if __name__ == "__main__":
    app.run()
