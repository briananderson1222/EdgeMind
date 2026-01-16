// lib/agentcore/index.js - AWS Bedrock Agent Integration
// Proxies questions to AWS AgentCore orchestrator agent

const {
  BedrockAgentRuntimeClient,
  InvokeAgentCommand
} = require('@aws-sdk/client-bedrock-agent-runtime');
const { randomUUID } = require('crypto');

/**
 * AgentCore client for proxying questions to AWS Bedrock Agents orchestrator.
 * Handles session management and streaming responses from the agent.
 *
 * @module lib/agentcore
 */

class AgentCoreClient {
  /**
   * @param {Object} config - Configuration object
   * @param {string} config.region - AWS region for Bedrock Agent
   * @param {string} config.agentId - Bedrock Agent ID
   * @param {string} config.agentAliasId - Bedrock Agent Alias ID
   */
  constructor(config) {
    if (!config.agentId || !config.agentAliasId) {
      throw new Error('AgentCore requires agentId and agentAliasId configuration');
    }

    this.config = config;
    this.client = new BedrockAgentRuntimeClient({ region: config.region });
    console.log('✅ AgentCore client initialized');
  }

  /**
   * Invokes the Bedrock Agent with a question.
   * Handles streaming response and returns the complete answer.
   *
   * @param {string} question - User question to send to the agent
   * @param {string} [sessionId] - Optional session ID for conversation continuity
   * @returns {Promise<{answer: string, sessionId: string}>} Agent response
   * @throws {Error} If agent invocation fails
   */
  async ask(question, sessionId = null) {
    if (!question || typeof question !== 'string') {
      throw new Error('Question must be a non-empty string');
    }

    if (question.length > 1000) {
      throw new Error('Question exceeds maximum length (1000 characters)');
    }

    // Generate session ID if not provided
    const effectiveSessionId = sessionId || randomUUID();

    console.log(`[AgentCore] Invoking agent for session: ${effectiveSessionId}`);

    try {
      const command = new InvokeAgentCommand({
        agentId: this.config.agentId,
        agentAliasId: this.config.agentAliasId,
        sessionId: effectiveSessionId,
        inputText: question,
        enableTrace: false // Set to true for debugging
      });

      const response = await this.client.send(command);

      // Stream the response and concatenate chunks
      let answer = '';
      const completion = response.completion;

      for await (const event of completion) {
        if (event.chunk && event.chunk.bytes) {
          const chunkText = new TextDecoder('utf-8').decode(event.chunk.bytes);
          answer += chunkText;
        }
      }

      console.log(`[AgentCore] Received response (${answer.length} chars)`);

      return {
        answer: answer.trim(),
        sessionId: effectiveSessionId
      };

    } catch (error) {
      console.error('[AgentCore] Invocation failed:', error.message);

      // Handle specific error types
      if (error.name === 'ResourceNotFoundException') {
        throw new Error('Agent not found. Check agentId and agentAliasId configuration.');
      } else if (error.name === 'ThrottlingException') {
        throw new Error('Agent request throttled. Please retry.');
      } else if (error.name === 'ValidationException') {
        throw new Error(`Invalid request: ${error.message}`);
      }

      throw new Error(`Agent invocation failed: ${error.message}`);
    }
  }

  /**
   * Health check for AgentCore connectivity.
   * Attempts a minimal invocation to verify configuration.
   *
   * @returns {Promise<{healthy: boolean, message: string}>}
   */
  async healthCheck() {
    try {
      // Simple test question to verify agent is reachable
      await this.ask('Hello', randomUUID());
      return {
        healthy: true,
        message: 'AgentCore is reachable'
      };
    } catch (error) {
      return {
        healthy: false,
        message: error.message
      };
    }
  }
}

/**
 * Factory function to create AgentCore client instance.
 *
 * @param {Object} config - Configuration object
 * @param {string} config.region - AWS region
 * @param {string} config.agentId - Agent ID
 * @param {string} config.agentAliasId - Agent Alias ID
 * @returns {AgentCoreClient|null} Client instance or null if not configured
 */
function createAgentCoreClient(config) {
  if (!config.agentId || !config.agentAliasId) {
    console.log('⚠️  AgentCore not configured (missing agentId or agentAliasId)');
    return null;
  }

  try {
    return new AgentCoreClient(config);
  } catch (error) {
    console.error('❌ Failed to create AgentCore client:', error.message);
    return null;
  }
}

module.exports = {
  AgentCoreClient,
  createAgentCoreClient
};
