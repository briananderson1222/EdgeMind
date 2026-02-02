// WEBSOCKET - Connection and message dispatch

import { state, connection, WS_URL, SLEEPING_AGENT_MESSAGES } from './state.js';
import { updateConnectionStatus, updateMetrics, updateEquipmentState } from './dashboard-render.js';
import { addClaudeInsight, renderActiveFilters } from './insights.js';
import { addMQTTMessageToStream } from './stream.js';
import { displayClaudeResponse } from './chat.js';
import { topicToMeasurement, getEnterpriseParam } from './utils.js';
import { fetchActiveSensorCount } from './dashboard-data.js';

/**
 * Schedule a reconnection attempt with exponential backoff
 */
function scheduleReconnect() {
    if (!connection.reconnectAttempts) connection.reconnectAttempts = 0;
    const backoff = Math.min(5000 * Math.pow(1.5, connection.reconnectAttempts), 30000);
    connection.reconnectAttempts++;
    console.log(`🔄 Reconnecting in ${Math.round(backoff / 1000)}s (attempt ${connection.reconnectAttempts})...`);
    connection.reconnectTimeout = setTimeout(() => {
        connection.reconnectTimeout = null;
        connectWebSocket();
    }, backoff);
}

/**
 * Connect to WebSocket backend
 */
export function connectWebSocket() {
    console.log('🔌 Connecting to backend...');

    // Clean up existing WebSocket to prevent memory leaks
    if (connection.ws) {
        connection.ws.onopen = null;
        connection.ws.onmessage = null;
        connection.ws.onerror = null;
        connection.ws.onclose = null;
        if (connection.ws.readyState === WebSocket.OPEN || connection.ws.readyState === WebSocket.CONNECTING) {
            connection.ws.close();
        }
    }

    connection.ws = new WebSocket(WS_URL);

    connection.ws.onopen = () => {
        console.log('✅ Connected to backend!');
        connection.isConnected = true;
        connection.reconnectAttempts = 0;
        updateConnectionStatus(true);

        if (connection.reconnectTimeout) {
            clearTimeout(connection.reconnectTimeout);
            connection.reconnectTimeout = null;
        }

        // Update system status
        const statusEl = document.getElementById('system-status');
        if (statusEl) {
            const statusDot = statusEl.querySelector('.status__dot');
            const statusText = statusEl.querySelector('span');
            if (statusDot) statusDot.style.background = 'var(--accent-green)';
            if (statusText) statusText.textContent = 'SYSTEM ONLINE';
        }
        document.getElementById('agent-state').textContent = '● Monitoring factory data streams';
    };

    connection.ws.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            handleServerMessage(message);
        } catch (error) {
            console.error('Failed to parse server message:', error);
        }
    };

    connection.ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
    };

    connection.ws.onclose = () => {
        console.log('🔌 Disconnected from backend');
        connection.isConnected = false;
        updateConnectionStatus(false);
        const statusEl = document.getElementById('system-status');
        if (statusEl) {
            const statusDot = statusEl.querySelector('.status__dot');
            const statusText = statusEl.querySelector('span');
            if (statusDot) statusDot.style.background = 'var(--accent-red)';
            if (statusText) statusText.textContent = 'RECONNECTING...';
        }

        // Attempt to reconnect with exponential backoff
        if (!connection.reconnectTimeout) {
            scheduleReconnect();
        }
    };
}

/**
 * Handle different message types from backend
 */
export function handleServerMessage(message) {
    console.log('📨 Received:', message.type);

    switch (message.type) {
        case 'initial_state': {
            // Initial data when connecting
            let messages = message.data.recentMessages || [];

            // Filter by selected enterprise
            const enterprise = getEnterpriseParam(state);
            if (enterprise !== 'ALL') {
                messages = messages.filter(msg => {
                    const topic = msg.topic || '';
                    return topic.startsWith(enterprise + '/');
                });
            }

            state.messages = messages;
            state.insights = message.data.recentInsights || [];
            state.anomalies = message.data.recentAnomalies || [];
            state.stats = message.data.stats || state.stats;

            // Load anomaly filters from server
            if (message.data.anomalyFilters && Array.isArray(message.data.anomalyFilters)) {
                state.anomalyFilters = message.data.anomalyFilters;
                renderActiveFilters();
            }

            // Load threshold settings from server
            if (message.data.thresholdSettings) {
                state.thresholdSettings = message.data.thresholdSettings;
            }

            updateUI();

            // Show sleeping agent message if insights are disabled
            if (message.data.insightsEnabled === false) {
                const copilotContainer = document.getElementById('claude-insights-container');
                if (copilotContainer) {
                    const randomMsg = SLEEPING_AGENT_MESSAGES[Math.floor(Math.random() * SLEEPING_AGENT_MESSAGES.length)];
                    const sleepingDiv = document.createElement('div');
                    sleepingDiv.className = 'agent-insights';
                    sleepingDiv.style.borderLeftColor = 'var(--accent-amber)';
                    sleepingDiv.innerHTML = `
                        <div class="insight-text" style="opacity: 0.85; font-style: italic;">
                            😴 ${randomMsg}
                        </div>
                        <div class="insight-meta">
                            AI Insights: Disabled • MQTT data collection active
                        </div>
                    `;
                    copilotContainer.innerHTML = '';
                    copilotContainer.appendChild(sleepingDiv);
                }

                // Update agent state
                const agentState = document.getElementById('agent-state');
                if (agentState) {
                    agentState.textContent = '● Data collection only (insights disabled)';
                }
            }

            // Fetch persistent measurement count from server schema cache
            fetchActiveSensorCount();
            break;
        }

        case 'mqtt_message': {
            // Real-time MQTT message
            const topic = message.data.topic || '';

            // Filter by selected enterprise
            const mqttEnterprise = getEnterpriseParam(state);
            if (mqttEnterprise !== 'ALL') {
                if (!topic.startsWith(mqttEnterprise + '/')) {
                    return;
                }
            }

            state.messages.push(message.data);
            state.stats.messageCount++;
            connection.messagesSinceLastRate++;
            if (state.messages.length > 100) {
                state.messages.shift();
            }

            // Track unique measurements
            const measurement = topicToMeasurement(message.data.topic);
            state.uniqueTopics.add(measurement);

            // Track enterprise counts
            const entMatch = topic.match(/^(Enterprise [ABC])\//i);
            if (entMatch) {
                const enterprise = entMatch[1];
                state.enterpriseCounts[enterprise] = (state.enterpriseCounts[enterprise] || 0) + 1;
            }

            addMQTTMessageToStream(message.data);
            updateMetrics();
            break;
        }

        case 'claude_insight':
        case 'trend_insight':
            // Claude AI analysis result
            state.insights.push(message.data);
            if (state.insights.length > 10) {
                state.insights.shift();
            }
            addClaudeInsight(message.data);

            // Update anomaly count
            if (message.data.anomalies && message.data.anomalies.length > 0) {
                state.stats.anomalyCount += message.data.anomalies.length;
                updateMetrics();
            }
            break;

        case 'claude_response':
            // Response to direct question
            displayClaudeResponse(message.data);
            break;

        case 'equipment_state':
            // Real-time equipment state update
            updateEquipmentState(message.data);
            break;

        case 'anomaly_filter_update':
            // Anomaly filter rules updated
            if (message.data && Array.isArray(message.data.filters)) {
                state.anomalyFilters = message.data.filters;
                renderActiveFilters();
            }
            break;

        case 'settings_updated':
            // Threshold settings updated
            if (message.data) {
                state.thresholdSettings = message.data;
                console.log('[SETTINGS] Synced from server:', message.data);
            }
            break;
    }
}

/**
 * Initial UI update helper (used by initial_state handler)
 */
function updateUI() {
    // Clear stream
    const stream = document.getElementById('mqtt-stream');
    if (stream) stream.innerHTML = '';

    // Display recent messages
    state.messages.forEach(msg => addMQTTMessageToStream(msg));

    // Clear insights container
    const container = document.getElementById('claude-insights-container');
    if (container) container.innerHTML = '';

    // Display recent insights
    state.insights.forEach(insight => addClaudeInsight(insight));

    // Update metrics
    updateMetrics();
}
