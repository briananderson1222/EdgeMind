import os
from pathlib import Path
import yaml
from strands import Agent
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from model.load import load_model

app = BedrockAgentCoreApp()

with open(Path(__file__).parent / "prompt.yaml") as f:
    SYSTEM_PROMPT = yaml.safe_load(f)["system_prompt"]

@app.entrypoint
async def invoke(payload, context):
    """
    Anomaly agent - no MCP tools, receives pre-gathered data in prompt.
    The backend gathers InfluxDB trends and passes them in the prompt.
    """
    agent = Agent(
        model=load_model(),
        tools=[],  # No tools - data provided in prompt
        system_prompt=SYSTEM_PROMPT
    )
    stream = agent.stream_async(payload.get("prompt"))
    async for event in stream:
        if "data" in event and isinstance(event["data"], str):
            yield event["data"]

if __name__ == "__main__":
    app.run()
