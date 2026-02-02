// PLANT MANAGER - EQUIPMENT HEALTH VIEW
// Filterable equipment card grid with state badges and summary bar

import { state } from './state.js';

let refreshInterval = null;
let allEquipment = [];
let currentFilter = 'all';

/**
 * Classify equipment state into running/stopped/faulted
 */
function classifyState(stateName) {
    const name = (stateName || '').toLowerCase();
    if (name === 'running' || name === 'execute') return 'running';
    if (name === 'fault' || name === 'faulted') return 'faulted';
    return 'stopped';
}

/**
 * Get display label for state
 */
function getStateLabel(stateName) {
    const name = (stateName || '').toLowerCase();
    if (name === 'running' || name === 'execute') return 'Running';
    if (name === 'fault' || name === 'faulted') return 'Faulted';
    if (name === 'down') return 'Down';
    if (name === 'idle' || name === 'standby') return 'Idle';
    if (name === 'stopped' || name === 'aborted') return 'Stopped';
    return stateName || 'Unknown';
}

/**
 * Render the summary bar with total/running/stopped/faulted counts
 */
function renderSummary(equipment) {
    const summaryEl = document.getElementById('equipment-summary');
    if (!summaryEl) return;

    let running = 0, stopped = 0, faulted = 0;
    equipment.forEach(eq => {
        const cls = classifyState(eq.stateName || eq.state);
        if (cls === 'running') running++;
        else if (cls === 'faulted') faulted++;
        else stopped++;
    });

    summaryEl.innerHTML = `
        <div class="equipment-stat">
            <div class="equipment-stat-value">${equipment.length}</div>
            <div class="equipment-stat-label">Total</div>
        </div>
        <div class="equipment-stat">
            <div class="equipment-stat-icon" style="color: #10b981;">&#9679;</div>
            <div class="equipment-stat-value" style="color: #10b981;">${running}</div>
            <div class="equipment-stat-label">Running</div>
        </div>
        <div class="equipment-stat">
            <div class="equipment-stat-icon" style="color: #f59e0b;">&#9679;</div>
            <div class="equipment-stat-value" style="color: #f59e0b;">${stopped}</div>
            <div class="equipment-stat-label">Stopped</div>
        </div>
        <div class="equipment-stat">
            <div class="equipment-stat-icon" style="color: #ef4444;">&#9679;</div>
            <div class="equipment-stat-value" style="color: #ef4444;">${faulted}</div>
            <div class="equipment-stat-label">Faulted</div>
        </div>
    `;
}

/**
 * Render equipment cards based on current filter
 */
function renderCards(equipment, filter) {
    const grid = document.getElementById('equipment-grid');
    if (!grid) return;

    const filtered = filter === 'all'
        ? equipment
        : equipment.filter(eq => classifyState(eq.stateName || eq.state) === filter);

    if (filtered.length === 0) {
        grid.innerHTML = `<div class="view-loading">No ${filter === 'all' ? '' : filter + ' '}equipment found</div>`;
        return;
    }

    const cards = filtered.map(eq => {
        const cls = classifyState(eq.stateName || eq.state);
        const label = getStateLabel(eq.stateName || eq.state);
        const reason = eq.reason ? `<div class="equipment-card-reason">${eq.reason}</div>` : '';
        const duration = eq.durationFormatted ? `<div class="equipment-card-duration">${eq.durationFormatted}</div>` : '';

        return `
            <div class="equipment-card equipment-state-${cls}">
                <div class="equipment-card-header">
                    <div class="equipment-card-name">${eq.machine || 'Unknown'}</div>
                    <span class="state-badge state-${cls}">
                        <span class="state-dot"></span>
                        ${label}
                    </span>
                </div>
                <div class="equipment-card-meta">
                    <span class="equipment-card-site">${eq.site || ''}</span>
                    <span class="equipment-card-enterprise">${eq.enterprise || ''}</span>
                </div>
                ${reason}
                ${duration}
            </div>
        `;
    });

    grid.innerHTML = cards.join('');
}

/**
 * Update filter button active states
 */
function updateFilterButtons(activeFilter) {
    const buttons = document.querySelectorAll('#equipment-grid')?.closest('.persona-view')?.querySelectorAll('.filter-btn');
    if (!buttons) return;
    buttons.forEach(btn => {
        const btnFilter = btn.textContent.trim().toLowerCase();
        btn.classList.toggle('active', btnFilter === activeFilter);
    });
}

/**
 * Fetch equipment data and render
 */
async function fetchAndRender() {
    const grid = document.getElementById('equipment-grid');

    try {
        const enterpriseParam = state.selectedFactory && state.selectedFactory !== 'ALL'
            ? `?enterprise=${encodeURIComponent(state.selectedFactory)}`
            : '';

        const res = await fetch(`/api/equipment/states${enterpriseParam}`);
        if (!res.ok) throw new Error(`Equipment states: ${res.status}`);

        const data = await res.json();
        allEquipment = data.states || [];

        renderSummary(allEquipment);
        renderCards(allEquipment, currentFilter);
    } catch (error) {
        console.error('Equipment health fetch error:', error);
        if (grid) {
            grid.innerHTML = `<div class="view-loading" style="color: var(--accent-red);">Failed to load equipment data: ${error.message}</div>`;
        }
    }
}

/**
 * Filter equipment by state (called from UI buttons)
 */
export function filterEquipment(filterState) {
    currentFilter = filterState;
    updateFilterButtons(filterState);
    renderCards(allEquipment, filterState);
}

/**
 * Initialize equipment health view
 */
export async function init() {
    currentFilter = 'all';
    await fetchAndRender();
    refreshInterval = setInterval(fetchAndRender, 15000);
}

/**
 * Cleanup equipment health view
 */
export function cleanup() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }
    allEquipment = [];
    currentFilter = 'all';
}
