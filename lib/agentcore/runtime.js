// lib/agentcore/runtime.js - Shared AgentCore Runtime client

const CONFIG = require('../config');

// Runtime IDs - loaded from SSM on demand
let RUNTIME_IDS = { chat: null, troubleshoot: null, anomaly: null };

const LOCAL_URLS = {
  chat: process.env.AGENT_CHAT_URL || 'http://localhost:8080',
  troubleshoot: process.env.AGENT_TROUBLESHOOT_URL || 'http://localhost:8081',
  anomaly: process.env.AGENT_ANOMALY_URL || 'http://localhost:8082'
};

const useRuntime = process.env.NODE_ENV === 'production' || process.env.USE_AGENTCORE_RUNTIME === 'true';
let client = null;
let ssmLastLoaded = 0;
const SSM_CACHE_TTL = 60000; // Reload SSM every 60s to pick up new agents

// Load agent IDs from SSM Parameter Store
async function loadAgentIdsFromSSM(force = false) {
  if (!useRuntime) return;
  if (!force && Date.now() - ssmLastLoaded < SSM_CACHE_TTL) return;
  
  try {
    const { SSMClient, GetParametersByPathCommand } = require('@aws-sdk/client-ssm');
    const ssm = new SSMClient({ region: CONFIG.bedrock.region });
    
    const response = await ssm.send(new GetParametersByPathCommand({
      Path: '/edgemind/agents/',
      Recursive: false
    }));
    
    for (const param of response.Parameters || []) {
      const agentType = param.Name.split('/').pop();
      if (RUNTIME_IDS.hasOwnProperty(agentType)) {
        RUNTIME_IDS[agentType] = param.Value;
      }
    }
    ssmLastLoaded = Date.now();
    console.log('[AgentCore] Loaded agent IDs from SSM:', RUNTIME_IDS);
  } catch (err) {
    console.warn('[AgentCore] Could not load agent IDs from SSM:', err.message);
  }
}

if (useRuntime) {
  try {
    const { BedrockAgentCoreClient } = require('@aws-sdk/client-bedrock-agentcore');
    client = new BedrockAgentCoreClient({ region: CONFIG.bedrock.region });
    console.log('🤖 Using AgentCore Runtime SDK for agent invocations');
  } catch (err) {
    console.error('❌ Failed to initialize AgentCore SDK:', err.message);
  }
} else {
  console.log('🤖 Using local HTTP for agent invocations');
}

async function invoke(agentType, prompt, sessionId, stream = false) {
  if (useRuntime && client) {
    // Load/refresh SSM params
    await loadAgentIdsFromSSM();
    
    const { InvokeAgentRuntimeCommand } = require('@aws-sdk/client-bedrock-agentcore');
    const runtimeId = RUNTIME_IDS[agentType];
    
    if (!runtimeId) {
      throw new Error(`Agent '${agentType}' not deployed. Run: ./Deployment\\ Scripts/deploy-agents.sh ${agentType}`);
    }
    
    const accountId = process.env.AWS_ACCOUNT_ID || CONFIG.aws?.accountId;
    if (!accountId) {
      throw new Error('AWS_ACCOUNT_ID not configured');
    }
    
    const runtimeArn = `arn:aws:bedrock-agentcore:${CONFIG.bedrock.region}:${accountId}:runtime/${runtimeId}`;
    // Session ID must be at least 33 chars - pad deterministically to preserve session continuity
    let effectiveSessionId = sessionId || `${agentType}-session-${Date.now()}`;
    if (effectiveSessionId.length < 33) {
      effectiveSessionId = `${effectiveSessionId}-pad`.padEnd(33, '0');
    }
    
    console.log(`[AgentCore] Invoking ${agentType} agent: ${runtimeArn}`);
    
    const command = new InvokeAgentRuntimeCommand({
      agentRuntimeArn: runtimeArn,
      runtimeSessionId: effectiveSessionId,
      payload: Buffer.from(JSON.stringify({ prompt }), 'utf-8'),
      contentType: 'application/json',
      accept: 'application/json'
    });
    
    const response = await client.send(command);
    
    // Return stream for streaming mode
    if (stream) {
      return { 
        stream: response.response, 
        sessionId: effectiveSessionId, 
        isRuntime: true,
        isStream: true
      };
    }
    
    // Consume response stream for non-streaming mode
    let output = '';
    if (response.response) {
      for await (const chunk of response.response) {
        if (chunk) {
          output += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
        }
      }
    }
    
    // Parse SSE format: extract text from 'data: "..."' lines
    const text = output
      .split('\n')
      .filter(line => line.startsWith('data: '))
      .map(line => {
        const content = line.slice(6).trim();
        if (content.startsWith('"') && content.endsWith('"')) {
          try { return JSON.parse(content); } catch { return content; }
        }
        return content;
      })
      .join('');
    
    return { output: text, sessionId: effectiveSessionId, isRuntime: true };
  } else {
    // Local HTTP
    const url = LOCAL_URLS[agentType] || LOCAL_URLS.chat;
    const response = await fetch(`${url}/invocations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, session_id: sessionId || 'default' })
    });
    return { response, isRuntime: false };
  }
}

module.exports = { invoke, useRuntime, RUNTIME_IDS, LOCAL_URLS };
