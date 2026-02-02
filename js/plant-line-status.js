// PLANT MANAGER - LINE STATUS VIEW
// Real-time production line monitoring with OEE, equipment states, and A/P/Q breakdown

import { state } from './state.js';

let refreshInterval = null;

/**
 * Get OEE color based on value
 */
function getOeeColor(value) {
    if (value >= 85) return '#10b981';
    if (value >= 70) return '#f59e0b';
    return '#ef4444';
}

/**
 * Get OEE color class based on value
 */
function getOeeClass(value) {
    if (value >= 85) return 'oee-green';
    if (value >= 70) return 'oee-amber';
    return 'oee-red';
}

/**
 * Count equipment states for a given site
 */
function countEquipmentForSite(equipmentStates, enterprise, site) {
    const counts = { running: 0, stopped: 0, faulted: 0, total: 0 };
    if (!Array.isArray(equipmentStates)) return counts;

    equipmentStates.forEach(eq => {
        if (enterprise && eq.enterprise !== enterprise) return;
        if (site && eq.site !== site) return;

        counts.total++;
        const name = (eq.stateName || eq.state || '').toLowerCase();
        if (name === 'running' || name === 'execute') {
            counts.running++;
        } else if (name === 'fault' || name === 'faulted') {
            counts.faulted++;
        } else {
            counts.stopped++;
        }
    });
    return counts;
}

/**
 * Render a single line status card
 */
function renderLineCard(line, equipCounts) {
    const oee = line.oee ?? 0;
    const oeeColor = getOeeColor(oee);
    const oeeClass = getOeeClass(oee);
    const availability = line.availability ?? 0;
    const performance = line.performance ?? 0;
    const quality = line.quality ?? 0;

    return `
        <div class="line-status-card">
            <div class="line-card-header">
                <div class="line-card-name">${line.site || 'Unknown'}</div>
                <div class="line-card-enterprise">${line.enterprise || ''}</div>
            </div>
            <div class="line-oee-value ${oeeClass}">${oee.toFixed(1)}<span class="oee-unit">%</span></div>
            <div class="line-oee-label">OEE</div>
            <div class="line-equipment-counts">
                <span class="equip-count equip-running" title="Running">${equipCounts.running}</span>
                <span class="equip-count equip-stopped" title="Stopped">${equipCounts.stopped}</span>
                <span class="equip-count equip-faulted" title="Faulted">${equipCounts.faulted}</span>
            </div>
            <div class="line-apq-bars">
                <div class="apq-bar-row">
                    <span class="apq-label">A</span>
                    <div class="apq-bar-track">
                        <div class="apq-bar-fill apq-availability" style="width: ${Math.min(100, availability)}%"></div>
                    </div>
                    <span class="apq-value">${availability.toFixed(0)}%</span>
                </div>
                <div class="apq-bar-row">
                    <span class="apq-label">P</span>
                    <div class="apq-bar-track">
                        <div class="apq-bar-fill apq-performance" style="width: ${Math.min(100, performance)}%"></div>
                    </div>
                    <span class="apq-value">${performance.toFixed(0)}%</span>
                </div>
                <div class="apq-bar-row">
                    <span class="apq-label">Q</span>
                    <div class="apq-bar-track">
                        <div class="apq-bar-fill apq-quality" style="width: ${Math.min(100, quality)}%"></div>
                    </div>
                    <span class="apq-value">${quality.toFixed(0)}%</span>
                </div>
            </div>
        </div>
    `;
}

/**
 * Fetch all data and render line status grid
 */
async function fetchAndRender() {
    const grid = document.getElementById('line-status-grid');
    if (!grid) return;

    try {
        const enterpriseParam = state.selectedFactory && state.selectedFactory !== 'ALL'
            ? `?enterprise=${encodeURIComponent(state.selectedFactory)}`
            : '';

        const [linesRes, equipRes, batchRes] = await Promise.all([
            fetch(`/api/oee/lines${enterpriseParam}`),
            fetch(`/api/equipment/states${enterpriseParam}`),
            fetch(`/api/batch/status`)
        ]);

        if (!linesRes.ok) throw new Error(`OEE lines: ${linesRes.status}`);
        if (!equipRes.ok) throw new Error(`Equipment states: ${equipRes.status}`);

        const linesData = await linesRes.json();
        const equipData = await equipRes.json();
        const batchData = batchRes.ok ? await batchRes.json() : null;

        const lines = linesData.lines || [];
        const equipmentStates = equipData.states || [];

        if (lines.length === 0 && (!batchData || !batchData.equipment || batchData.equipment.length === 0)) {
            grid.innerHTML = '<div class="view-loading">No line data available</div>';
            return;
        }

        // Sort lines by OEE descending
        lines.sort((a, b) => (b.oee ?? 0) - (a.oee ?? 0));

        // Render line cards
        const cards = lines.map(line => {
            const equipCounts = countEquipmentForSite(equipmentStates, line.enterprise, line.site);
            return renderLineCard(line, equipCounts);
        });

        grid.innerHTML = cards.join('');
    } catch (error) {
        console.error('Line status fetch error:', error);
        if (grid) {
            grid.innerHTML = `<div class="view-loading" style="color: var(--accent-red);">Failed to load line data: ${error.message}</div>`;
        }
    }
}

/**
 * Initialize line status view
 */
export async function init() {
    await fetchAndRender();
    refreshInterval = setInterval(fetchAndRender, 15000);
}

/**
 * Cleanup line status view
 */
export function cleanup() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }
}
