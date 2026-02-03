// INSIGHTS - Claude insights panel and anomaly filtering

import { state, connection } from './state.js';
import { escapeHtml, getEnterpriseParam, filterAnomaliesByEnterprise } from './utils.js';
import { updateActiveAlerts } from './dashboard-render.js';

/**
 * Shared helper to create insight HTML element
 */
export function createInsightElement(insight) {
    const insightEl = document.createElement('div');
    insightEl.className = 'agent-insights';

    const severityColors = {
        'low': 'var(--accent-cyan)',
        'medium': 'var(--accent-amber)',
        'high': 'var(--accent-red)'
    };
    insightEl.style.borderLeftColor = severityColors[insight.severity] || severityColors['low'];

    const insightText = insight.summary || insight.insight || 'No insight available';
    const dataInfo = insight.dataPoints ? `${insight.dataPoints} data points` : `${insight.messagesAnalyzed || 0} messages`;

    const anomalyInfo = insight.anomalies && insight.anomalies.length > 0
        ? `<span style="color: var(--accent-red)">⚠ ${insight.anomalies.length} anomalies</span> • `
        : '';

    const escapedInsightText = escapeHtml(insightText);
    const escapedConfidence = escapeHtml(String(insight.confidence || 'N/A'));
    const escapedSeverity = escapeHtml(String(insight.severity));

    insightEl.innerHTML = `
        <div class="insight-text">${escapedInsightText}</div>
        <div class="insight-meta">
            ${anomalyInfo}Confidence: ${escapedConfidence} •
            Priority: ${escapedSeverity} •
            Analyzed ${dataInfo} •
            ${insight.timestamp ? new Date(insight.timestamp).toLocaleTimeString() : ''}
        </div>
    `;

    return insightEl;
}

/**
 * Add Claude insight to the AI agent panel
 */
export function addClaudeInsight(insight) {
    // Extract anomalies from insight
    if (insight.anomalies && Array.isArray(insight.anomalies)) {
        insight.anomalies.forEach(anomalyData => {
            if (typeof anomalyData === 'string') {
                state.anomalies.push({
                    text: anomalyData,
                    timestamp: insight.timestamp,
                    severity: insight.severity
                });
            } else if (typeof anomalyData === 'object') {
                state.anomalies.push({
                    text: anomalyData.description || 'Anomaly detected',
                    description: anomalyData.description,
                    reasoning: anomalyData.reasoning,
                    metric: anomalyData.metric,
                    enterprise: anomalyData.enterprise,
                    actual_value: anomalyData.actual_value,
                    threshold: anomalyData.threshold,
                    timestamp: insight.timestamp,
                    severity: anomalyData.severity || insight.severity
                });
            }
        });
        while (state.anomalies.length > 50) {
            state.anomalies.shift();
        }
        const tabCount = document.getElementById('anomaly-tab-count');
        if (tabCount) {
            tabCount.textContent = state.anomalies.length;
        }
        updateActiveAlerts();
    }

    if (state.insightFilter !== 'all') return;

    const container = document.getElementById('claude-insights-container');
    if (!container) return;

    const insightEl = createInsightElement(insight);
    container.insertBefore(insightEl, container.firstChild);

    while (container.children.length > 5) {
        container.removeChild(container.lastChild);
    }
}

/**
 * Shared filter logic for insights (used by both main panel and modal)
 */
export function applyInsightFilter(filterType, containerEl, tabSelector, onAnomalyClick) {
    document.querySelectorAll(tabSelector).forEach(tab => {
        tab.classList.remove('active');
    });

    containerEl.innerHTML = '';

    const selectedEnterprise = getEnterpriseParam(state);

    if (filterType === 'anomalies') {
        const filteredAnomalies = filterAnomaliesByEnterprise(state.anomalies, selectedEnterprise);

        if (filteredAnomalies.length === 0) {
            const enterpriseText = selectedEnterprise !== 'ALL'
                ? ` for ${escapeHtml(selectedEnterprise)}`
                : '';
            containerEl.innerHTML = `
                <div class="agent-insights">
                    <div class="insight-text">No anomalies detected${enterpriseText}.</div>
                    <div class="insight-meta">Claude analyzes trends every 30 seconds</div>
                </div>
            `;
        } else {
            filteredAnomalies.forEach(anomaly => {
                const el = document.createElement('div');
                el.className = 'anomaly-item';
                const escapedText = escapeHtml(anomaly.text);
                el.innerHTML = `
                    <div>${escapedText}</div>
                    <div class="anomaly-time">${anomaly.timestamp ? new Date(anomaly.timestamp).toLocaleTimeString() : ''}</div>
                `;
                el.addEventListener('click', () => onAnomalyClick(anomaly));
                containerEl.appendChild(el);
            });
        }
    } else {
        if (state.insights.length === 0) {
            containerEl.innerHTML = `
                <div class="agent-insights">
                    <div class="insight-text">Waiting for data to analyze...</div>
                    <div class="insight-meta">Status: Standby</div>
                </div>
            `;
            return;
        }

        let hasVisibleInsights = false;

        state.insights.forEach(insight => {
            if (selectedEnterprise !== 'ALL') {
                if (insight.enterpriseInsights && insight.enterpriseInsights[selectedEnterprise]) {
                    const filteredInsight = {
                        ...insight,
                        summary: insight.enterpriseInsights[selectedEnterprise],
                        insight: insight.enterpriseInsights[selectedEnterprise],
                        anomalies: filterAnomaliesByEnterprise(insight.anomalies || [], selectedEnterprise)
                    };
                    const insightEl = createInsightElement(filteredInsight);
                    containerEl.appendChild(insightEl);
                    hasVisibleInsights = true;
                } else if (!insight.enterpriseInsights) {
                    const filteredInsight = {
                        ...insight,
                        anomalies: filterAnomaliesByEnterprise(insight.anomalies || [], selectedEnterprise)
                    };
                    const insightEl = createInsightElement(filteredInsight);
                    containerEl.appendChild(insightEl);
                    hasVisibleInsights = true;
                }
            } else {
                const insightEl = createInsightElement(insight);
                containerEl.appendChild(insightEl);
                hasVisibleInsights = true;
            }
        });

        if (!hasVisibleInsights) {
            const enterpriseText = selectedEnterprise !== 'ALL'
                ? ` for ${escapeHtml(selectedEnterprise)}`
                : '';
            containerEl.innerHTML = `
                <div class="agent-insights">
                    <div class="insight-text">No insights available${enterpriseText}.</div>
                    <div class="insight-meta">Claude analyzes trends every 30 seconds</div>
                </div>
            `;
        }
    }
}

/**
 * Filter insights by type
 */
export function filterInsights(filterType, clickedTab) {
    state.insightFilter = filterType;

    if (clickedTab) clickedTab.classList.add('active');

    const container = document.getElementById('claude-insights-container');
    if (!container) return;

    // Import to avoid circular dependency
    import('./modals.js').then(({ openAnomalyModal }) => {
        applyInsightFilter(filterType, container, '.insight-tabs .insight-tab', openAnomalyModal);
    });

    const tabCount = document.getElementById('anomaly-tab-count');
    if (tabCount) {
        const enterprise = getEnterpriseParam(state);
        const filteredCount = filterAnomaliesByEnterprise(state.anomalies, enterprise).length;
        tabCount.textContent = filteredCount;
    }
}

/**
 * Add anomaly filter
 */
export function addAnomalyFilter() {
    const input = document.getElementById('anomaly-filter-input');
    if (!input) return;

    const filterRule = input.value.trim();
    if (!filterRule || filterRule.length === 0) {
        return;
    }

    if (state.anomalyFilters.length >= 10) {
        alert('Maximum 10 filter rules allowed');
        return;
    }

    state.anomalyFilters.push(filterRule);
    input.value = '';

    renderActiveFilters();

    if (connection.ws && connection.ws.readyState === WebSocket.OPEN) {
        connection.ws.send(JSON.stringify({
            type: 'update_anomaly_filter',
            filters: state.anomalyFilters
        }));
    }
}

/**
 * Remove anomaly filter
 */
export function removeAnomalyFilter(index) {
    state.anomalyFilters.splice(index, 1);

    renderActiveFilters();

    if (connection.ws && connection.ws.readyState === WebSocket.OPEN) {
        connection.ws.send(JSON.stringify({
            type: 'update_anomaly_filter',
            filters: state.anomalyFilters
        }));
    }
}

/**
 * Render active filter chips
 */
export function renderActiveFilters() {
    const container = document.getElementById('active-filters');
    if (!container) return;

    if (state.anomalyFilters.length === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = state.anomalyFilters.map((filter, index) => `
        <div class="filter-chip">
            <span class="filter-chip-text" title="${escapeHtml(filter)}">${escapeHtml(filter)}</span>
            <span class="filter-chip-remove" onclick="removeAnomalyFilter(${index})">×</span>
        </div>
    `).join('');
}

/**
 * Toggle agent pause/resume state
 */
export async function toggleAgentPause() {
    const btn = document.getElementById('agent-pause-btn');
    if (!btn) return;

    const isPaused = btn.classList.contains('paused');
    const endpoint = isPaused ? '/api/agent/resume' : '/api/agent/pause';

    try {
        const response = await fetch(endpoint, { method: 'POST' });
        const data = await response.json();

        if (data.isPaused) {
            btn.classList.add('paused');
            btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><polygon points="2,0 12,6 2,12"/></svg><span>Resume</span>';
            btn.title = 'Resume Analysis';

            const stateEl = document.getElementById('agent-state');
            if (stateEl) {
                stateEl.textContent = '⏸ Analysis paused';
                stateEl.style.color = 'var(--accent-red, #ff3232)';
            }
        } else {
            btn.classList.remove('paused');
            btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="1" width="4" height="10"/><rect x="7" y="1" width="4" height="10"/></svg><span>Pause</span>';
            btn.title = 'Pause Analysis';

            const stateEl = document.getElementById('agent-state');
            if (stateEl) {
                stateEl.textContent = '● Monitoring factory data streams';
                stateEl.style.color = '';
            }
        }
    } catch (error) {
        console.error('Failed to toggle agent pause:', error);
    }
}

/**
 * Check agent pause state on page load
 */
export async function checkAgentPauseState() {
    try {
        const response = await fetch('/api/agent/status');
        const data = await response.json();

        if (data.isPaused) {
            const btn = document.getElementById('agent-pause-btn');
            if (btn) {
                btn.classList.add('paused');
                btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><polygon points="2,0 12,6 2,12"/></svg><span>Resume</span>';
                btn.title = 'Resume Analysis';
            }

            const stateEl = document.getElementById('agent-state');
            if (stateEl) {
                stateEl.textContent = '⏸ Analysis paused';
                stateEl.style.color = 'var(--accent-red, #ff3232)';
            }
        }
    } catch (error) {
        console.error('Failed to check agent status:', error);
    }
}
