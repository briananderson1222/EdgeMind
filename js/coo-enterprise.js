// COO ENTERPRISE COMPARISON VIEW - Cross-enterprise analytics

let refreshInterval = null;

/**
 * Get OEE color class based on value
 */
function getOeeClass(value) {
    if (value >= 85) return 'oee-green';
    if (value >= 70) return 'oee-amber';
    return 'oee-red';
}

/**
 * Format equipment state counts from states array for a specific enterprise
 */
function countEquipmentStates(states, enterprise) {
    const counts = { running: 0, stopped: 0, faulted: 0, idle: 0, unknown: 0 };
    if (!Array.isArray(states)) return counts;

    states.forEach(eq => {
        if (eq.enterprise !== enterprise) return;
        const name = (eq.stateName || eq.state || '').toLowerCase();
        if (name === 'running' || name === 'execute') {
            counts.running++;
        } else if (name === 'down' || name === 'stopped' || name === 'aborted') {
            counts.stopped++;
        } else if (name === 'fault' || name === 'faulted') {
            counts.faulted++;
        } else if (name === 'idle' || name === 'standby') {
            counts.idle++;
        } else {
            counts.unknown++;
        }
    });
    return counts;
}

/**
 * Render enterprise comparison grid
 */
function render(oeeBreakdown, factoryStatus, equipmentData) {
    const grid = document.getElementById('enterprise-comparison-grid');
    if (!grid) return;

    const enterprises = ['Enterprise A', 'Enterprise B', 'Enterprise C'];
    const oeeData = oeeBreakdown?.data || {};
    const statusEnterprises = factoryStatus?.enterprises || {};
    const equipmentStates = equipmentData?.states || [];

    const columns = enterprises.map(name => {
        const oee = oeeData[name]?.oee ?? null;
        const oeeDisplay = oee !== null ? oee.toFixed(1) : 'N/A';
        const oeeClass = oee !== null ? getOeeClass(oee) : 'oee-amber';
        const equipCounts = countEquipmentStates(equipmentStates, name);

        // Get sites from factory status
        const enterpriseStatus = statusEnterprises[name] || {};
        const sites = enterpriseStatus.sites || {};
        const siteEntries = Object.entries(sites);

        const siteRows = siteEntries.length > 0
            ? siteEntries.map(([siteName, siteData]) => {
                const siteOee = siteData?.oee ?? null;
                const siteOeeDisplay = siteOee !== null ? `${siteOee.toFixed(1)}%` : 'N/A';
                const siteClass = siteOee !== null ? getOeeClass(siteOee) : '';
                return `<div class="enterprise-site-row">
                    <span class="site-name">${siteName}</span>
                    <span class="site-oee ${siteClass}">${siteOeeDisplay}</span>
                </div>`;
            }).join('')
            : '<div class="enterprise-site-row"><span class="site-name" style="color: var(--text-dim);">No site data available</span></div>';

        return `
            <div class="enterprise-column">
                <div class="enterprise-column-header">
                    <h3 class="enterprise-name">${name}</h3>
                </div>
                <div class="enterprise-oee-value ${oeeClass}">${oeeDisplay}<span class="oee-unit">%</span></div>
                <div class="enterprise-oee-label">Overall OEE (24h avg)</div>

                <div class="enterprise-section">
                    <h4 class="enterprise-section-title">Sites</h4>
                    <div class="enterprise-sites-list">
                        ${siteRows}
                    </div>
                </div>

                <div class="enterprise-section">
                    <h4 class="enterprise-section-title">Equipment Status</h4>
                    <div class="equipment-state-counts">
                        <div class="equipment-state-item state-running">
                            <span class="state-count">${equipCounts.running}</span>
                            <span class="state-label">Running</span>
                        </div>
                        <div class="equipment-state-item state-stopped">
                            <span class="state-count">${equipCounts.stopped}</span>
                            <span class="state-label">Stopped</span>
                        </div>
                        <div class="equipment-state-item state-faulted">
                            <span class="state-count">${equipCounts.faulted}</span>
                            <span class="state-label">Faulted</span>
                        </div>
                        <div class="equipment-state-item state-idle">
                            <span class="state-count">${equipCounts.idle}</span>
                            <span class="state-label">Idle</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    });

    grid.innerHTML = columns.join('');
}

/**
 * Fetch all data and render
 */
async function fetchAndRender() {
    const grid = document.getElementById('enterprise-comparison-grid');

    try {
        const [oeeRes, statusRes, equipRes] = await Promise.all([
            fetch('/api/oee/breakdown'),
            fetch('/api/factory/status'),
            fetch('/api/equipment/states')
        ]);

        if (!oeeRes.ok) throw new Error(`OEE breakdown: ${oeeRes.status}`);
        if (!statusRes.ok) throw new Error(`Factory status: ${statusRes.status}`);
        if (!equipRes.ok) throw new Error(`Equipment states: ${equipRes.status}`);

        const [oeeData, statusData, equipData] = await Promise.all([
            oeeRes.json(),
            statusRes.json(),
            equipRes.json()
        ]);

        render(oeeData, statusData, equipData);
    } catch (error) {
        console.error('Enterprise comparison fetch error:', error);
        if (grid) {
            grid.innerHTML = `<div class="view-loading" style="color: var(--accent-red);">Failed to load enterprise data: ${error.message}</div>`;
        }
    }
}

/**
 * Initialize the enterprise comparison view
 */
export async function init() {
    await fetchAndRender();
    refreshInterval = setInterval(fetchAndRender, 30000);
}

/**
 * Cleanup the enterprise comparison view
 */
export function cleanup() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }
}
