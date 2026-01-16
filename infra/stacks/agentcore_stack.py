"""
EdgeMind AgentCore Stack - AWS Bedrock Agents Multi-Agent Architecture

Deploys a multi-agent system using AWS Bedrock Agents for intelligent
factory analytics:

- Orchestrator Agent (Supervisor): Routes questions to specialists
- OEE Analyst Agent: Overall Equipment Effectiveness analysis
- Equipment Health Agent: Equipment state and downtime monitoring
- Waste Attribution Agent: Defect and waste analysis
- Batch Process Agent: ISA-88 batch control for Enterprise C

The agents share a common Lambda function for tool execution that
calls back to the EdgeMind backend APIs.
"""

from aws_cdk import (
    Stack,
    aws_bedrock as bedrock,
    aws_iam as iam,
    aws_lambda as lambda_,
    aws_logs as logs,
    CfnOutput,
    Duration,
    RemovalPolicy,
)
from constructs import Construct
from pathlib import Path


class AgentCoreStack(Stack):
    """AWS Bedrock Agents multi-agent architecture for EdgeMind.

    Creates a supervisor orchestrator agent that routes to specialized
    sub-agents for OEE analysis, equipment health, waste attribution,
    and batch process monitoring.
    """

    # Claude models - Use inference profiles (required for Bedrock Agents)
    # NOTE: Claude 4 models require enablement in Bedrock console (Model access).
    # Using Claude 3.5 Sonnet v1 and Claude 3 Haiku until Claude 4 is enabled.
    # To upgrade: Enable Claude Sonnet 4.5 and Haiku 4.5 in Bedrock console, then update these:
    #   ORCHESTRATOR_MODEL = "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
    #   SPECIALIST_MODEL = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
    ORCHESTRATOR_MODEL = "us.anthropic.claude-3-5-sonnet-20240620-v1:0"
    SPECIALIST_MODEL = "us.anthropic.claude-3-haiku-20240307-v1:0"

    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        backend_api_url: str,
        project_name: str = "edgemind",
        environment: str = "prod",
        **kwargs
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # Load agent instructions from files
        instructions_dir = Path(__file__).parent.parent / "agent_instructions"
        orchestrator_instructions = self._load_instructions(instructions_dir / "orchestrator.txt")
        oee_analyst_instructions = self._load_instructions(instructions_dir / "oee_analyst.txt")
        equipment_health_instructions = self._load_instructions(instructions_dir / "equipment_health.txt")
        waste_analyst_instructions = self._load_instructions(instructions_dir / "waste_analyst.txt")
        batch_process_instructions = self._load_instructions(instructions_dir / "batch_process.txt")

        # Load OpenAPI schema for tools
        schemas_dir = Path(__file__).parent.parent / "schemas"
        tools_schema = self._load_schema(schemas_dir / "tools.yaml")

        # ========================================
        # IAM Roles
        # ========================================

        # Agent execution role - allows Bedrock to assume this role
        self.agent_execution_role = iam.Role(
            self, "AgentExecutionRole",
            role_name=f"{project_name}-{environment}-agent-execution-role",
            assumed_by=iam.ServicePrincipal("bedrock.amazonaws.com"),
            description="Execution role for EdgeMind Bedrock Agents",
        )

        # Grant Bedrock model invocation permissions (Sonnet 4.5 for orchestrator, Haiku 4.5 for specialists)
        # Using broad permissions for model invocation - inference profiles require wildcard access
        self.agent_execution_role.add_to_policy(
            iam.PolicyStatement(
                sid="BedrockInvokeModel",
                effect=iam.Effect.ALLOW,
                actions=[
                    "bedrock:InvokeModel",
                    "bedrock:InvokeModelWithResponseStream",
                ],
                resources=["*"]  # Bedrock Agents require broad access for model invocation
            )
        )

        # Grant agent collaboration permissions (for multi-agent)
        self.agent_execution_role.add_to_policy(
            iam.PolicyStatement(
                sid="BedrockAgentCollaboration",
                effect=iam.Effect.ALLOW,
                actions=[
                    "bedrock:InvokeAgent",
                    "bedrock:GetAgent",
                    "bedrock:GetAgentAlias",
                ],
                resources=[
                    f"arn:aws:bedrock:{self.region}:{self.account}:agent/*",
                    f"arn:aws:bedrock:{self.region}:{self.account}:agent-alias/*",
                ]
            )
        )

        # Lambda execution role
        self.lambda_execution_role = iam.Role(
            self, "ToolsLambdaRole",
            role_name=f"{project_name}-{environment}-agent-tools-lambda-role",
            assumed_by=iam.ServicePrincipal("lambda.amazonaws.com"),
            description="Execution role for EdgeMind agent tools Lambda",
            managed_policies=[
                iam.ManagedPolicy.from_aws_managed_policy_name(
                    "service-role/AWSLambdaBasicExecutionRole"
                )
            ]
        )

        # ========================================
        # Lambda Function for Action Groups
        # ========================================

        # CloudWatch log group for Lambda
        lambda_log_group = logs.LogGroup(
            self, "ToolsLambdaLogGroup",
            log_group_name=f"/aws/lambda/{project_name}-{environment}-agent-tools",
            retention=logs.RetentionDays.TWO_WEEKS,
            removal_policy=RemovalPolicy.DESTROY,
        )

        # Tools Lambda function
        self.tools_lambda = lambda_.Function(
            self, "ToolsLambda",
            function_name=f"{project_name}-{environment}-agent-tools",
            runtime=lambda_.Runtime.PYTHON_3_12,
            handler="index.handler",
            code=lambda_.Code.from_inline(self._get_lambda_code()),
            timeout=Duration.seconds(30),
            memory_size=256,
            role=self.lambda_execution_role,
            environment={
                "BACKEND_API_URL": backend_api_url,
                "PROJECT_NAME": project_name,
                "ENVIRONMENT": environment,
            },
            log_group=lambda_log_group,
            description="Handles tool calls from EdgeMind Bedrock Agents",
        )

        # Grant Bedrock permission to invoke the Lambda
        self.tools_lambda.grant_invoke(
            iam.ServicePrincipal("bedrock.amazonaws.com")
        )

        # ========================================
        # Sub-Agents (Specialists)
        # ========================================

        # OEE Analyst Agent (uses Haiku for cost efficiency)
        self.oee_analyst_agent = bedrock.CfnAgent(
            self, "OEEAnalystAgent",
            agent_name=f"{project_name}-oee-analyst",
            agent_resource_role_arn=self.agent_execution_role.role_arn,
            foundation_model=self.SPECIALIST_MODEL,
            instruction=oee_analyst_instructions,
            description="Specialist agent for OEE analysis - Availability, Performance, Quality",
            idle_session_ttl_in_seconds=600,
            auto_prepare=True,
            action_groups=[
                self._create_action_group(
                    "OEETools",
                    "Tools for OEE analysis including get_oee_breakdown, get_equipment_states, and query_influxdb",
                    tools_schema,
                )
            ],
        )

        # Equipment Health Agent (uses Haiku for cost efficiency)
        self.equipment_health_agent = bedrock.CfnAgent(
            self, "EquipmentHealthAgent",
            agent_name=f"{project_name}-equipment-health",
            agent_resource_role_arn=self.agent_execution_role.role_arn,
            foundation_model=self.SPECIALIST_MODEL,
            instruction=equipment_health_instructions,
            description="Specialist agent for equipment state monitoring and downtime analysis",
            idle_session_ttl_in_seconds=600,
            auto_prepare=True,
            action_groups=[
                self._create_action_group(
                    "EquipmentTools",
                    "Tools for equipment monitoring including get_equipment_states and query_influxdb",
                    tools_schema,
                )
            ],
        )

        # Waste Attribution Agent (uses Haiku for cost efficiency)
        self.waste_analyst_agent = bedrock.CfnAgent(
            self, "WasteAnalystAgent",
            agent_name=f"{project_name}-waste-analyst",
            agent_resource_role_arn=self.agent_execution_role.role_arn,
            foundation_model=self.SPECIALIST_MODEL,
            instruction=waste_analyst_instructions,
            description="Specialist agent for waste and defect analysis by production line",
            idle_session_ttl_in_seconds=600,
            auto_prepare=True,
            action_groups=[
                self._create_action_group(
                    "WasteTools",
                    "Tools for waste analysis including get_waste_by_line, get_equipment_states, and query_influxdb",
                    tools_schema,
                )
            ],
        )

        # Batch Process Agent - Enterprise C only (uses Haiku for cost efficiency)
        self.batch_process_agent = bedrock.CfnAgent(
            self, "BatchProcessAgent",
            agent_name=f"{project_name}-batch-process",
            agent_resource_role_arn=self.agent_execution_role.role_arn,
            foundation_model=self.SPECIALIST_MODEL,
            instruction=batch_process_instructions,
            description="Specialist agent for ISA-88 batch processing (Enterprise C only)",
            idle_session_ttl_in_seconds=600,
            auto_prepare=True,
            action_groups=[
                self._create_action_group(
                    "BatchTools",
                    "Tools for batch process monitoring including get_batch_health and query_influxdb",
                    tools_schema,
                )
            ],
        )

        # ========================================
        # Agent Aliases (for sub-agents)
        # ========================================

        # Create aliases for sub-agents (required for multi-agent collaboration)
        self.oee_analyst_alias = bedrock.CfnAgentAlias(
            self, "OEEAnalystAlias",
            agent_id=self.oee_analyst_agent.attr_agent_id,
            agent_alias_name="live",
            description="Production alias for OEE Analyst agent",
        )
        self.oee_analyst_alias.add_dependency(self.oee_analyst_agent)

        self.equipment_health_alias = bedrock.CfnAgentAlias(
            self, "EquipmentHealthAlias",
            agent_id=self.equipment_health_agent.attr_agent_id,
            agent_alias_name="live",
            description="Production alias for Equipment Health agent",
        )
        self.equipment_health_alias.add_dependency(self.equipment_health_agent)

        self.waste_analyst_alias = bedrock.CfnAgentAlias(
            self, "WasteAnalystAlias",
            agent_id=self.waste_analyst_agent.attr_agent_id,
            agent_alias_name="live",
            description="Production alias for Waste Analyst agent",
        )
        self.waste_analyst_alias.add_dependency(self.waste_analyst_agent)

        self.batch_process_alias = bedrock.CfnAgentAlias(
            self, "BatchProcessAlias",
            agent_id=self.batch_process_agent.attr_agent_id,
            agent_alias_name="live",
            description="Production alias for Batch Process agent",
        )
        self.batch_process_alias.add_dependency(self.batch_process_agent)

        # ========================================
        # Orchestrator Agent (Supervisor)
        # ========================================

        # The orchestrator uses SUPERVISOR collaboration mode to route to sub-agents
        # Orchestrator uses Sonnet for better reasoning on routing decisions
        self.orchestrator_agent = bedrock.CfnAgent(
            self, "OrchestratorAgent",
            agent_name=f"{project_name}-orchestrator",
            agent_resource_role_arn=self.agent_execution_role.role_arn,
            foundation_model=self.ORCHESTRATOR_MODEL,
            instruction=orchestrator_instructions,
            description="Supervisor agent that routes questions to specialist sub-agents",
            idle_session_ttl_in_seconds=1800,
            auto_prepare=True,
            # Multi-agent collaboration configuration
            agent_collaboration="SUPERVISOR",
            agent_collaborators=[
                bedrock.CfnAgent.AgentCollaboratorProperty(
                    agent_descriptor=bedrock.CfnAgent.AgentDescriptorProperty(
                        alias_arn=f"arn:aws:bedrock:{self.region}:{self.account}:agent-alias/{self.oee_analyst_agent.attr_agent_id}/{self.oee_analyst_alias.attr_agent_alias_id}",
                    ),
                    collaborator_name="OEEAnalyst",
                    collaboration_instruction="Use this agent for questions about OEE (Overall Equipment Effectiveness), availability, performance, quality metrics, and limiting factors. Do NOT use for Enterprise C.",
                    relay_conversation_history="TO_COLLABORATOR",
                ),
                bedrock.CfnAgent.AgentCollaboratorProperty(
                    agent_descriptor=bedrock.CfnAgent.AgentDescriptorProperty(
                        alias_arn=f"arn:aws:bedrock:{self.region}:{self.account}:agent-alias/{self.equipment_health_agent.attr_agent_id}/{self.equipment_health_alias.attr_agent_alias_id}",
                    ),
                    collaborator_name="EquipmentHealth",
                    collaboration_instruction="Use this agent for questions about equipment status, downtime, machine states (RUNNING/IDLE/DOWN), and reliability.",
                    relay_conversation_history="TO_COLLABORATOR",
                ),
                bedrock.CfnAgent.AgentCollaboratorProperty(
                    agent_descriptor=bedrock.CfnAgent.AgentDescriptorProperty(
                        alias_arn=f"arn:aws:bedrock:{self.region}:{self.account}:agent-alias/{self.waste_analyst_agent.attr_agent_id}/{self.waste_analyst_alias.attr_agent_alias_id}",
                    ),
                    collaborator_name="WasteAnalyst",
                    collaboration_instruction="Use this agent for questions about defects, scrap, rework, waste sources, and quality issues by production line.",
                    relay_conversation_history="TO_COLLABORATOR",
                ),
                bedrock.CfnAgent.AgentCollaboratorProperty(
                    agent_descriptor=bedrock.CfnAgent.AgentDescriptorProperty(
                        alias_arn=f"arn:aws:bedrock:{self.region}:{self.account}:agent-alias/{self.batch_process_agent.attr_agent_id}/{self.batch_process_alias.attr_agent_alias_id}",
                    ),
                    collaborator_name="BatchProcess",
                    collaboration_instruction="Use this agent ONLY for questions about Enterprise C. Enterprise C uses batch processing (ISA-88), NOT OEE. Always use batch terminology.",
                    relay_conversation_history="TO_COLLABORATOR",
                ),
            ],
        )

        # Orchestrator must wait for all sub-agents and their aliases
        self.orchestrator_agent.add_dependency(self.oee_analyst_alias)
        self.orchestrator_agent.add_dependency(self.equipment_health_alias)
        self.orchestrator_agent.add_dependency(self.waste_analyst_alias)
        self.orchestrator_agent.add_dependency(self.batch_process_alias)

        # Orchestrator alias (for backend to invoke)
        self.orchestrator_alias = bedrock.CfnAgentAlias(
            self, "OrchestratorAlias",
            agent_id=self.orchestrator_agent.attr_agent_id,
            agent_alias_name="live",
            description="Production alias for Orchestrator supervisor agent",
        )
        self.orchestrator_alias.add_dependency(self.orchestrator_agent)

        # ========================================
        # Outputs
        # ========================================

        CfnOutput(
            self, "OrchestratorAgentId",
            value=self.orchestrator_agent.attr_agent_id,
            description="Orchestrator Agent ID",
            export_name=f"{project_name}-{environment}-orchestrator-agent-id"
        )

        CfnOutput(
            self, "OrchestratorAliasId",
            value=self.orchestrator_alias.attr_agent_alias_id,
            description="Orchestrator Agent Alias ID",
            export_name=f"{project_name}-{environment}-orchestrator-alias-id"
        )

        CfnOutput(
            self, "OrchestratorAliasArn",
            value=f"arn:aws:bedrock:{self.region}:{self.account}:agent-alias/{self.orchestrator_agent.attr_agent_id}/{self.orchestrator_alias.attr_agent_alias_id}",
            description="Orchestrator Agent Alias ARN (use this in backend)",
            export_name=f"{project_name}-{environment}-orchestrator-alias-arn"
        )

        CfnOutput(
            self, "ToolsLambdaArn",
            value=self.tools_lambda.function_arn,
            description="Agent tools Lambda function ARN",
            export_name=f"{project_name}-{environment}-agent-tools-lambda-arn"
        )

        CfnOutput(
            self, "OEEAnalystAgentId",
            value=self.oee_analyst_agent.attr_agent_id,
            description="OEE Analyst Agent ID"
        )

        CfnOutput(
            self, "EquipmentHealthAgentId",
            value=self.equipment_health_agent.attr_agent_id,
            description="Equipment Health Agent ID"
        )

        CfnOutput(
            self, "WasteAnalystAgentId",
            value=self.waste_analyst_agent.attr_agent_id,
            description="Waste Analyst Agent ID"
        )

        CfnOutput(
            self, "BatchProcessAgentId",
            value=self.batch_process_agent.attr_agent_id,
            description="Batch Process Agent ID"
        )

    def _load_instructions(self, path: Path) -> str:
        """Load agent instructions from a text file."""
        try:
            return path.read_text(encoding="utf-8")
        except FileNotFoundError:
            raise FileNotFoundError(
                f"Agent instruction file not found: {path}. "
                "Please create the file in infra/agent_instructions/"
            )

    def _load_schema(self, path: Path) -> str:
        """Load OpenAPI schema from a YAML file."""
        try:
            return path.read_text(encoding="utf-8")
        except FileNotFoundError:
            raise FileNotFoundError(
                f"OpenAPI schema file not found: {path}. "
                "Please create the file in infra/schemas/"
            )

    def _create_action_group(
        self,
        name: str,
        description: str,
        schema: str
    ) -> bedrock.CfnAgent.AgentActionGroupProperty:
        """Create an action group configuration for a Bedrock Agent."""
        return bedrock.CfnAgent.AgentActionGroupProperty(
            action_group_name=name,
            description=description,
            action_group_executor=bedrock.CfnAgent.ActionGroupExecutorProperty(
                lambda_=self.tools_lambda.function_arn,
            ),
            api_schema=bedrock.CfnAgent.APISchemaProperty(
                payload=schema,
            ),
            action_group_state="ENABLED",
        )

    def _get_lambda_code(self) -> str:
        """Return inline Python code for the tools Lambda function."""
        return '''
import json
import os
import urllib.request
import urllib.error
import urllib.parse

BACKEND_API_URL = os.environ.get("BACKEND_API_URL", "http://localhost:3000")

def handler(event, context):
    """Handle tool calls from Bedrock Agents (OpenAPI schema format).

    Routes tool calls to the appropriate backend API endpoint.
    """
    print(f"Received event: {json.dumps(event)}")

    # Extract fields from the OpenAPI schema format event
    action_group = event.get("actionGroup", "")
    api_path = event.get("apiPath", "")
    http_method = event.get("httpMethod", "POST")
    request_body = event.get("requestBody", {})

    # Extract parameters from requestBody (OpenAPI format)
    params = {}
    try:
        properties = request_body.get("content", {}).get("application/json", {}).get("properties", [])
        for prop in properties:
            params[prop.get("name")] = prop.get("value")
    except Exception as e:
        print(f"Error parsing parameters: {e}")

    # Derive function name from apiPath (e.g., "/get_oee_breakdown" -> "get_oee_breakdown")
    function_name = api_path.lstrip("/") if api_path else ""

    print(f"Action: {action_group}/{function_name}, Params: {params}")

    try:
        result = route_tool_call(function_name, params)

        # Return response in OpenAPI format (must include apiPath and httpMethod)
        return {
            "messageVersion": "1.0",
            "response": {
                "actionGroup": action_group,
                "apiPath": api_path,
                "httpMethod": http_method,
                "responseBody": {
                    "application/json": {
                        "body": json.dumps(result)
                    }
                }
            }
        }
    except Exception as e:
        print(f"Error handling tool call: {e}")
        return {
            "messageVersion": "1.0",
            "response": {
                "actionGroup": action_group,
                "apiPath": api_path,
                "httpMethod": http_method,
                "responseBody": {
                    "application/json": {
                        "body": json.dumps({"error": str(e)})
                    }
                }
            }
        }

def route_tool_call(function_name: str, params: dict) -> dict:
    """Route tool calls to backend API endpoints."""

    # Helper to clean and URL-encode parameter values
    def encode_param(value):
        # Remove extra quotes if present (agent sometimes adds them)
        if value.startswith('"') and value.endswith('"'):
            value = value[1:-1]
        return urllib.parse.quote(value, safe='')

    if function_name == "get_oee_breakdown":
        enterprise = encode_param(params.get("enterprise", "ALL"))
        return call_backend_api(f"/api/oee/v2?enterprise={enterprise}")

    elif function_name == "get_equipment_states":
        enterprise = encode_param(params.get("enterprise", "ALL"))
        return call_backend_api(f"/api/factory/status?enterprise={enterprise}")

    elif function_name == "get_waste_by_line":
        enterprise = encode_param(params.get("enterprise", "ALL"))
        # Note: This endpoint may need to be implemented in the backend
        return call_backend_api(f"/api/waste/breakdown?enterprise={enterprise}")

    elif function_name == "get_batch_health":
        # Enterprise C batch health - may need backend implementation
        return call_backend_api("/api/batch/health?enterprise=Enterprise%20C")

    elif function_name == "query_influxdb":
        query = params.get("query", "")
        max_rows = params.get("max_rows", 1000)
        # POST the query to backend
        return call_backend_api(
            "/api/influx/query",
            method="POST",
            data={"query": query, "max_rows": max_rows}
        )

    else:
        return {"error": f"Unknown function: {function_name}"}

def call_backend_api(path: str, method: str = "GET", data: dict = None) -> dict:
    """Call the EdgeMind backend API."""
    url = f"{BACKEND_API_URL}{path}"
    print(f"Calling backend: {method} {url}")

    try:
        if method == "POST" and data:
            req = urllib.request.Request(
                url,
                data=json.dumps(data).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST"
            )
        else:
            req = urllib.request.Request(url, method=method)

        with urllib.request.urlopen(req, timeout=10) as response:
            body = response.read().decode("utf-8")
            return json.loads(body)

    except urllib.error.HTTPError as e:
        print(f"HTTP error: {e.code} {e.reason}")
        return {"error": f"Backend returned {e.code}: {e.reason}"}

    except urllib.error.URLError as e:
        print(f"URL error: {e.reason}")
        return {"error": f"Failed to connect to backend: {e.reason}"}

    except Exception as e:
        print(f"Error calling backend: {e}")
        return {"error": str(e)}
'''
