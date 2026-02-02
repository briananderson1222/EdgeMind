// DASHBOARD RENDER - DOM rendering and update functions

import { state, connection } from './state.js';
import { escapeHtml, getEnterpriseParam, filterAnomaliesByEnterprise } from './utils.js';

/**
 * Render the production heatmap with enterprise and site hierarchy
 */
export function renderProductionHeatmap(enterprises) {
    const container = document.getElementById('production-heatmap');
    if (!container) return;

    if (enterprises.length === 0) {
        container.innerHTML = '<div class="heatmap-loading">No factory data available</div>';
        return;
    }

    let html = '';

    enterprises.forEach(enterprise => {
        html += `
            <div class="enterprise-group">
                <div class="enterprise-header ${enterprise.status}">
                    <div class="enterprise-name">${enterprise.name}</div>
                    <div class="enterprise-oee ${enterprise.status}">${enterprise.oee}%</div>
                </div>
                <div class="sites-grid">
        `;

        enterprise.sites.forEach(site => {
            html += `
                <div class="site-card ${site.status}">
                    <div class="site-name">${site.name}</div>
                    <div class="site-oee ${site.status}">${site.oee}%</div>
                    <div class="site-status">${site.status}</div>
                </div>
            `;
        });

        html += `
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

/**
 * Render line OEE grid
 */
export function renderLineOEEGrid(lines) {
    const grid = document.getElementById('line-oee-grid');
    const title = document.getElementById('line-panel-title');
    if (!grid) return;

    if (title) {
        title.textContent = 'Production Line OEE';
    }

    if (lines.length === 0) {
        grid.innerHTML = '<div class="heatmap-loading">No lines available for selected enterprise</div>';
        return;
    }

    grid.innerHTML = lines.map(line => {
        const oee = line.oee || 0;
        let statusClass = 'critical';
        if (oee >= 85) statusClass = 'healthy';
        else if (oee >= 70) statusClass = 'warning';

        const lineName = line.name || `${line.site} - ${line.line || 'Line'}`;

        const fmtVal = (v) => (v !== null && v !== undefined) ? `${v}%` : '--';
        const breakdownHtml = `
            <div class="line-breakdown">
                <div class="line-breakdown-item">
                    <span class="line-breakdown-label">A</span>
                    <span class="line-breakdown-value">${fmtVal(line.availability)}</span>
                </div>
                <div class="line-breakdown-item">
                    <span class="line-breakdown-label">P</span>
                    <span class="line-breakdown-value">${fmtVal(line.performance)}</span>
                </div>
                <div class="line-breakdown-item">
                    <span class="line-breakdown-label">Q</span>
                    <span class="line-breakdown-value">${fmtVal(line.quality)}</span>
                </div>
            </div>
        `;

        return `
            <div class="line-card ${statusClass}" data-enterprise="${line.enterprise || ''}">
                <div class="line-name" title="${lineName}">${lineName}</div>
                <div class="line-oee-value">${oee.toFixed(1)}%</div>
                <div class="line-oee-bar">
                    <div class="line-oee-bar-fill" style="width: ${oee}%"></div>
                </div>
                ${breakdownHtml}
            </div>
        `;
    }).join('');
}

/**
 * Render batch operations panel
 */
export function renderBatchOperations(data) {
    const grid = document.getElementById('line-oee-grid');
    const title = document.getElementById('line-panel-title');
    if (!grid) return;

    if (title) {
        title.textContent = 'Batch Operations';
    }

    if (!data.equipment || data.equipment.length === 0) {
        grid.innerHTML = '<div class="heatmap-loading">No batch equipment data available</div>';
        return;
    }

    const stateColors = {
        'Running': 'var(--accent-green)',
        'Idle': 'var(--accent-amber)',
        'Complete': 'var(--accent-cyan)',
        'Fault': 'var(--accent-magenta)',
        'Stopped': 'var(--accent-red)'
    };

    const summary = data.summary || { running: 0, idle: 0, complete: 0, fault: 0, total: 0 };
    const summaryHtml = `
        <div class="batch-summary">
            <span class="summary-item running">${summary.running} Running</span>
            <span class="summary-item idle">${summary.idle} Idle</span>
            <span class="summary-item complete">${summary.complete} Complete</span>
            <span class="summary-item fault">${summary.fault} Fault</span>
        </div>
    `;

    const cardsHtml = data.equipment.map(equip => {
        const state = equip.state || 'Unknown';
        const stateColor = stateColors[state] || 'var(--text-dim)';
        const stateClass = state.toLowerCase().replace(/\s+/g, '-');

        return `
            <div class="batch-card ${stateClass}">
                <div class="batch-header">
                    <span class="equipment-name">${escapeHtml(equip.name || equip.id)}</span>
                    <span class="equipment-state state-${stateClass}" style="color: ${stateColor};">${escapeHtml(state)}</span>
                </div>
                <div class="batch-details">
                    <div class="batch-phase">Phase: ${escapeHtml(equip.phase || 'N/A')}</div>
                    <div class="batch-id">Batch: ${escapeHtml(equip.batchId || 'N/A')}</div>
                    <div class="batch-recipe">Recipe: ${escapeHtml(equip.recipe || 'N/A')}</div>
                </div>
            </div>
        `;
    }).join('');

    let cleanroomHtml = '';
    if (data.cleanroom && data.cleanroom.zones && data.cleanroom.zones.length > 0) {
        const cleanroomSummary = data.cleanroom.summary || {};

        cleanroomHtml = `
            <div class="cleanroom-section">
                <div class="cleanroom-header">
                    <h4>Cleanroom Environmental Zones</h4>
                    <div class="cleanroom-summary">
                        ${cleanroomSummary.avgTemp !== null && !isNaN(cleanroomSummary.avgTemp) ? `<span>Avg Temp: ${cleanroomSummary.avgTemp.toFixed(1)}°C</span>` : ''}
                        ${cleanroomSummary.avgHumidity !== null && !isNaN(cleanroomSummary.avgHumidity) ? `<span>Avg Humidity: ${cleanroomSummary.avgHumidity.toFixed(0)}%</span>` : ''}
                        ${cleanroomSummary.avgPm25 !== null && !isNaN(cleanroomSummary.avgPm25) ? `<span>Avg PM2.5: ${cleanroomSummary.avgPm25.toFixed(1)} µg/m³</span>` : ''}
                        <span class="pm25-status ${cleanroomSummary.pm25Status?.toLowerCase() || 'good'}">
                            PM2.5: ${cleanroomSummary.pm25Status || 'Unknown'}
                        </span>
                        ${cleanroomSummary.zonesWithIssues > 0 ? `<span class="zones-issues">Issues: ${cleanroomSummary.zonesWithIssues}/${cleanroomSummary.totalZones}</span>` : ''}
                    </div>
                </div>
                <div class="cleanroom-grid">
                    ${data.cleanroom.zones.map(zone => {
                        const statusClass = (zone.status || 'Unknown').toLowerCase();
                        return `
                            <div class="cleanroom-card ${statusClass}">
                                <div class="zone-name">${escapeHtml(zone.name)}</div>
                                <div class="zone-metrics">
                                    ${zone.temperature !== null && zone.temperature !== undefined && !isNaN(zone.temperature) ?
                                        `<span class="metric">${zone.temperature.toFixed(1)}°C</span>` :
                                        '<span class="metric">--°C</span>'}
                                    ${zone.humidity !== null && zone.humidity !== undefined && !isNaN(zone.humidity) ?
                                        `<span class="metric">${zone.humidity.toFixed(0)}%</span>` :
                                        '<span class="metric">--%</span>'}
                                    ${zone.pm25 !== null && zone.pm25 !== undefined && !isNaN(zone.pm25) ?
                                        `<span class="metric pm25">${zone.pm25.toFixed(1)} µg/m³</span>` :
                                        '<span class="metric pm25">-- µg/m³</span>'}
                                </div>
                                <div class="zone-status ${statusClass}">${escapeHtml(zone.status || 'Unknown')}</div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    grid.innerHTML = `
        ${summaryHtml}
        <div class="batch-equipment-grid">${cardsHtml}</div>
        ${cleanroomHtml}
    `;
}

/**
 * Render batch operations error state
 */
export function renderBatchOperationsError() {
    const grid = document.getElementById('line-oee-grid');
    const title = document.getElementById('line-panel-title');
    if (!grid) return;

    if (title) {
        title.textContent = 'Batch Operations';
    }

    grid.innerHTML = '<div class="heatmap-loading">Failed to load batch operations</div>';
}

/**
 * Update equipment state from WebSocket message
 */
export function updateEquipmentState(data) {
    if (data.id && data.state) {
        state.equipmentStates.set(data.id, data);
        updateEquipmentStateGrid();
    }
}

/**
 * Render equipment state grid
 */
export function updateEquipmentStateGrid() {
    const grid = document.getElementById('equipment-state-grid');
    if (!grid) return;

    const states = Array.from(state.equipmentStates.values());

    if (states.length === 0) {
        grid.innerHTML = '<div class="heatmap-loading">No equipment data available</div>';
        return;
    }

    const sortOrder = { 'DOWN': 0, 'IDLE': 1, 'RUNNING': 2 };
    states.sort((a, b) => {
        const orderA = sortOrder[a.state.toUpperCase()] ?? 3;
        const orderB = sortOrder[b.state.toUpperCase()] ?? 3;
        return orderA - orderB;
    });

    let runningCount = 0;
    let idleCount = 0;
    let downCount = 0;

    states.forEach(equipment => {
        const state = equipment.state.toUpperCase();
        if (state === 'RUNNING') runningCount++;
        else if (state === 'IDLE') idleCount++;
        else if (state === 'DOWN') downCount++;
    });

    document.getElementById('state-running').textContent = runningCount;
    document.getElementById('state-idle').textContent = idleCount;
    document.getElementById('state-down').textContent = downCount;

    grid.innerHTML = states.map(equipment => {
        const stateClass = equipment.state.toLowerCase();
        return `
            <div class="equipment-card ${stateClass}">
                <div class="equipment-name" title="${equipment.name}">${equipment.name}</div>
                <div class="equipment-state">${equipment.state}</div>
            </div>
        `;
    }).join('');
}

/**
 * Update connection status indicator
 */
export function updateConnectionStatus(connected) {
    const badge = document.getElementById('live-badge');
    const mqttIndicator = document.getElementById('mqtt-indicator');
    const claudeIndicator = document.getElementById('claude-indicator');
    const dataIndicator = document.getElementById('data-indicator');

    if (connected) {
        if (badge) {
            badge.textContent = '● LIVE';
            badge.style.borderColor = 'var(--accent-green)';
            badge.style.color = 'var(--accent-green)';
            badge.style.background = 'rgba(0, 255, 136, 0.2)';
        }

        if (mqttIndicator) mqttIndicator.classList.remove('disconnected');
        if (claudeIndicator) claudeIndicator.classList.remove('disconnected');
        if (dataIndicator) dataIndicator.classList.remove('disconnected');
    } else {
        if (badge) {
            badge.textContent = '● DISCONNECTED';
            badge.style.borderColor = 'var(--accent-red)';
            badge.style.color = 'var(--accent-red)';
            badge.style.background = 'rgba(255, 0, 0, 0.2)';
        }

        if (mqttIndicator) mqttIndicator.classList.add('disconnected');
        if (claudeIndicator) claudeIndicator.classList.add('disconnected');
        if (dataIndicator) dataIndicator.classList.add('disconnected');
    }
}

/**
 * Update metrics display
 */
export function updateMetrics() {
    const msgCount = document.getElementById('message-count');
    if (msgCount) {
        msgCount.textContent = state.stats.messageCount.toLocaleString();
    }

    const activeSensors = document.getElementById('active-sensors');
    if (activeSensors) {
        activeSensors.textContent = state.uniqueTopics.size.toLocaleString();
    }

    const anomalyCount = document.getElementById('anomaly-count');
    if (anomalyCount) {
        const enterprise = getEnterpriseParam(state);
        const filteredAnomalies = filterAnomaliesByEnterprise(state.anomalies, enterprise);
        anomalyCount.textContent = filteredAnomalies.length;
    }
}

/**
 * Calculate and display message rate
 */
export function updateMessageRate() {
    const now = Date.now();
    const elapsed = (now - connection.lastMessageTime) / 1000;

    if (elapsed >= 1) {
        connection.messageRate = Math.round(connection.messagesSinceLastRate / elapsed);
        connection.messagesSinceLastRate = 0;
        connection.lastMessageTime = now;

        state.messageRateHistory.push(connection.messageRate);
        if (state.messageRateHistory.length > 20) {
            state.messageRateHistory.shift();
        }

        const rateEl = document.getElementById('data-rate');
        if (rateEl) {
            rateEl.textContent = `${connection.messageRate} msg/sec`;
        }

        // Import to avoid circular dependency
        import('./charts.js').then(({ updateCharts }) => {
            updateCharts();
        });
    }
}

/**
 * Update OEE gauge visualization
 */
export function updateOEEGauge(oeePercent) {
    const gaugeValue = document.getElementById('scorecard-oee-value');
    const gaugeFill = document.getElementById('oee-gauge-fill');

    if (!gaugeValue || !gaugeFill) return;

    gaugeValue.textContent = oeePercent > 0 ? oeePercent.toFixed(1) + '%' : '--';

    const circumference = 502.65;
    const offset = circumference - (oeePercent / 100) * circumference;
    gaugeFill.style.strokeDashoffset = offset;

    let color = 'var(--accent-red)';
    if (oeePercent >= 80) {
        color = 'var(--accent-green)';
    } else if (oeePercent >= 60) {
        color = 'var(--accent-amber)';
    }
    gaugeFill.style.stroke = color;
    gaugeValue.style.color = color;
}

/**
 * Update active alerts from Claude anomalies
 */
export function updateActiveAlerts() {
    const alertsList = document.getElementById('active-alerts-list');
    if (!alertsList) return;

    const recentAnomalies = state.anomalies.slice(-5).reverse();

    if (recentAnomalies.length === 0) {
        alertsList.innerHTML = `
            <div class="alert-item info">
                <div class="alert-header">
                    <span class="alert-severity" style="color: var(--accent-green);">ALL CLEAR</span>
                    <span class="alert-time">now</span>
                </div>
                <div class="alert-message">
                    No active alerts. Factory operating normally.
                </div>
            </div>
        `;
        return;
    }

    alertsList.innerHTML = recentAnomalies.map(anomaly => {
        const severity = anomaly.severity || 'medium';
        const severityColors = {
            'high': 'var(--accent-red)',
            'medium': 'var(--accent-amber)',
            'low': 'var(--accent-cyan)'
        };
        const severityColor = severityColors[severity];
        const alertClass = severity === 'high' ? '' : severity === 'medium' ? 'warning' : 'info';

        const escapedText = escapeHtml(anomaly.text);

        return `
            <div class="alert-item ${alertClass}">
                <div class="alert-header">
                    <span class="alert-severity" style="color: ${severityColor};">${severity.toUpperCase()}</span>
                    <span class="alert-time">${new Date(anomaly.timestamp).toLocaleTimeString()}</span>
                </div>
                <div class="alert-message">${escapedText}</div>
            </div>
        `;
    }).join('');
}
