// PLANT MANAGER - ALERTS & WORK ORDERS VIEW
// Active alerts from WebSocket anomalies + CMMS work order integration

import { state } from './state.js';

let refreshInterval = null;
let currentSeverityFilter = 'all';
let cmmsConnected = false;

/**
 * Get severity color
 */
function getSeverityColor(severity) {
    const s = (severity || '').toLowerCase();
    if (s === 'critical' || s === 'high') return '#ef4444';
    if (s === 'warning' || s === 'medium') return '#f59e0b';
    return '#3b82f6'; // info / low
}

/**
 * Classify severity from anomaly data
 */
function classifySeverity(anomaly) {
    const text = (anomaly.title || anomaly.description || anomaly.message || '').toLowerCase();
    if (text.includes('critical') || text.includes('fault') || text.includes('emergency') || text.includes('alarm')) {
        return 'critical';
    }
    if (text.includes('warning') || text.includes('deviation') || text.includes('threshold') || text.includes('drop')) {
        return 'warning';
    }
    return 'info';
}

/**
 * Format timestamp for display
 */
function formatTime(timestamp) {
    if (!timestamp) return '';
    try {
        const d = new Date(timestamp);
        return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
        return '';
    }
}

/**
 * Render alerts section from state.anomalies
 */
function renderAlerts(filter) {
    const listEl = document.getElementById('alerts-list');
    if (!listEl) return;

    const anomalies = state.anomalies || [];

    if (anomalies.length === 0) {
        listEl.innerHTML = '<div class="view-loading">No active alerts</div>';
        return;
    }

    // Add severity classification and filter
    const classified = anomalies.map(a => ({
        ...a,
        severity: a.severity || classifySeverity(a)
    }));

    const filtered = filter === 'all'
        ? classified
        : classified.filter(a => a.severity === filter);

    if (filtered.length === 0) {
        listEl.innerHTML = `<div class="view-loading">No ${filter} alerts</div>`;
        return;
    }

    // Sort newest first
    const sorted = [...filtered].sort((a, b) => {
        const ta = new Date(a.timestamp || 0).getTime();
        const tb = new Date(b.timestamp || 0).getTime();
        return tb - ta;
    });

    const cards = sorted.map(alert => {
        const severity = alert.severity || 'info';
        const description = alert.title || alert.description || alert.message || 'Unknown alert';
        const time = formatTime(alert.timestamp);
        const enterprise = alert.enterprise ? `<span class="alert-enterprise">${alert.enterprise}</span>` : '';

        return `
            <div class="alert-card alert-${severity}">
                <div class="alert-card-header">
                    <span class="severity-badge severity-${severity}">${severity.toUpperCase()}</span>
                    <span class="alert-time">${time}</span>
                </div>
                <div class="alert-description">${description}</div>
                ${enterprise}
            </div>
        `;
    });

    listEl.innerHTML = cards.join('');
}

/**
 * Render work orders section
 */
async function renderWorkOrders() {
    const listEl = document.getElementById('work-orders-list');
    if (!listEl) return;

    // Check CMMS health first
    try {
        const healthRes = await fetch('/api/cmms/health');
        if (!healthRes.ok) throw new Error('CMMS health check failed');

        const health = await healthRes.json();
        cmmsConnected = health.enabled && health.healthy;
    } catch {
        cmmsConnected = false;
    }

    if (!cmmsConnected) {
        listEl.innerHTML = `
            <div class="cmms-disconnected">
                <div class="cmms-disconnected-icon">&#9888;</div>
                <div class="cmms-disconnected-title">CMMS Not Connected</div>
                <div class="cmms-disconnected-text">Work order integration is not available. Configure CMMS provider to enable.</div>
            </div>
        `;
        return;
    }

    // Fetch work orders
    try {
        const res = await fetch('/api/cmms/work-orders?limit=20');
        if (!res.ok) throw new Error(`Work orders: ${res.status}`);

        const data = await res.json();
        const workOrders = data.workOrders || [];

        if (workOrders.length === 0) {
            listEl.innerHTML = '<div class="view-loading">No work orders found</div>';
            return;
        }

        const cards = workOrders.map(wo => {
            const statusClass = getStatusClass(wo.status);
            const priorityLabel = wo.priority || 'Normal';

            return `
                <div class="work-order-card">
                    <div class="work-order-header">
                        <span class="work-order-title">${wo.title || wo.description || 'Untitled'}</span>
                        <span class="wo-status-badge wo-status-${statusClass}">${wo.status || 'Unknown'}</span>
                    </div>
                    <div class="work-order-meta">
                        <span class="wo-priority">Priority: ${priorityLabel}</span>
                        ${wo.assignee ? `<span class="wo-assignee">Assigned: ${wo.assignee}</span>` : ''}
                    </div>
                </div>
            `;
        });

        listEl.innerHTML = cards.join('');
    } catch (error) {
        console.error('Work orders fetch error:', error);
        listEl.innerHTML = `<div class="view-loading" style="color: var(--accent-red);">Failed to load work orders: ${error.message}</div>`;
    }
}

/**
 * Get status CSS class
 */
function getStatusClass(status) {
    const s = (status || '').toLowerCase();
    if (s === 'open' || s === 'new' || s === 'pending') return 'open';
    if (s === 'in progress' || s === 'in_progress' || s === 'active') return 'in-progress';
    if (s === 'completed' || s === 'done' || s === 'closed') return 'completed';
    return 'open';
}

/**
 * Update filter button active states
 */
function updateFilterButtons(activeFilter) {
    const alertsSection = document.querySelector('.alerts-section');
    if (!alertsSection) return;
    const buttons = alertsSection.querySelectorAll('.filter-btn');
    buttons.forEach(btn => {
        const btnFilter = btn.textContent.trim().toLowerCase();
        btn.classList.toggle('active', btnFilter === activeFilter);
    });
}

/**
 * Filter alerts by severity (called from UI buttons)
 */
export function filterAlerts(severity) {
    currentSeverityFilter = severity;
    updateFilterButtons(severity);
    renderAlerts(severity);
}

/**
 * Fetch and render all sections
 */
async function fetchAndRender() {
    renderAlerts(currentSeverityFilter);
    await renderWorkOrders();
}

/**
 * Initialize alerts & work orders view
 */
export async function init() {
    currentSeverityFilter = 'all';
    await fetchAndRender();
    refreshInterval = setInterval(fetchAndRender, 30000);
}

/**
 * Cleanup alerts & work orders view
 */
export function cleanup() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }
    currentSeverityFilter = 'all';
    cmmsConnected = false;
}
