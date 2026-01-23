import os
from mcp.client.streamable_http import streamablehttp_client
from strands import Agent
from strands.tools.mcp import MCPClient
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from model.load import load_model
from tools import retrieve

app = BedrockAgentCoreApp()

EDGEMIND_MCP_SERVER_URL = os.environ.get("EDGEMIND_MCP_SERVER_URL", "http://localhost:8000/mcp")

SYSTEM_PROMPT = """You are EdgeMind Assistant - an AI expert for a real-time factory intelligence dashboard.

## Factory Structure
Three enterprises with different manufacturing paradigms:
- **Enterprise A & B**: Discrete manufacturing using OEE (Overall Equipment Effectiveness)
- **Enterprise C**: Pharmaceutical bioprocessing using ISA-88 batch control (NO OEE)

## OEE Analysis (Enterprise A & B only)
OEE = Availability × Performance × Quality
- **Availability** = Run Time / Planned Time (losses: breakdowns, changeovers)
- **Performance** = Ideal Cycle Time × Count / Run Time (losses: slow cycles, stops)
- **Quality** = Good Count / Total Count (losses: defects, scrap)

World-class OEE target: 85%. Always identify the limiting factor (lowest component).

## Equipment Health
States: RUNNING, IDLE, DOWN, MAINTENANCE
- Lead with critical issues (DOWN equipment first)
- Include downtime duration
- Quantify production capacity impact

## Waste Attribution
- Identify top contributors (Pareto: 80/20 rule)
- Express as absolute units AND percentage
- Correlate with equipment states when relevant

Defect codes - Enterprise A (Glass): CHK (chips), DIM (dimensional), SED (seeds/bubbles)
Defect codes - Enterprise B (Packaging): SEAL, LABEL, FILL

## Batch Processing (Enterprise C ONLY)
NEVER use OEE terminology for Enterprise C. Use batch control language:
- Yield rate (not quality)
- Batch completion rate (not performance)
- Phase progress: Inoculation → Growth → Stationary → Harvest
- Key parameters: pH, dissolved oxygen, temperature

## Response Guidelines
- Be concise and data-driven
- Cite specific numbers from tool results
- Prioritize by business impact
- If data is unavailable, say so explicitly
- Recommend next steps when appropriate"""

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
