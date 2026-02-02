// DASHBOARD DATA - All data fetching functions

import { state, connection } from './state.js';
import { getEnterpriseParam } from './utils.js';
import {
    renderProductionHeatmap,
    renderLineOEEGrid,
    renderBatchOperations,
    renderBatchOperationsError,
    updateOEEGauge
} from './dashboard-render.js';
import { filterInsights } from './insights.js';

/**
 * Fetch active sensor count from server schema cache
 */
export async function fetchActiveSensorCount() {
    try {
        const response = await fetch('/api/schema/measurements');
        const data = await response.json();

        if (data.measurements && Array.isArray(data.measurements)) {
            data.measurements.forEach(measurement => {
                state.uniqueTopics.add(measurement.name);
            });

            const activeSensors = document.getElementById('active-sensors');
            if (activeSensors) {
                activeSensors.textContent = state.uniqueTopics.size.toLocaleString();
            }
            console.log(`📊 Loaded ${data.measurements.length} active sensors from schema cache`);
        }
    } catch (error) {
        console.error('Failed to fetch active sensor count:', error);
    }
}

/**
 * Fetch OEE from API (24h average)
 */
export async function fetchOEE(signal) {
    try {
        const enterprise = getEnterpriseParam(state);
        const response = await fetch(`/api/oee?enterprise=${encodeURIComponent(enterprise)}`, { signal });
        const data = await response.json();

        const oeeScore = document.getElementById('oee-score');
        const oeeStatus = document.getElementById('oee-status');

        if (data.average !== null) {
            oeeScore.textContent = data.average.toFixed(1) + '%';
            const displayName = enterprise === 'ALL' ? 'All Enterprises' : enterprise;
            oeeStatus.textContent = `${data.period} avg • ${displayName}`;
            oeeStatus.className = 'metric-change positive';
            updateOEEGauge(data.average);
        } else {
            oeeScore.textContent = '--';
            oeeStatus.textContent = 'No OEE data available';
            oeeStatus.className = 'metric-change';
            updateOEEGauge(0);
        }
    } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('Failed to fetch OEE:', error);
        document.getElementById('oee-status').textContent = 'API error';
        updateOEEGauge(0);
    }
}

/**
 * Fetch OEE breakdown and update chart
 */
export async function fetchOEEBreakdown(signal) {
    try {
        const oeeBreakdownContainer = document.getElementById('oee-breakdown-chart');
        const chartCard = oeeBreakdownContainer ? oeeBreakdownContainer.closest('.card') : null;
        if (chartCard && state.selectedFactory !== 'ALL') {
            chartCard.style.display = 'none';
            return;
        } else if (chartCard) {
            chartCard.style.display = '';
        }

        const response = await fetch('/api/oee/breakdown', { signal });
        const data = await response.json();

        if (window.oeeBreakdownChart && data.data) {
            const oeeValues = [
                data.data['Enterprise A']?.oee || 0,
                data.data['Enterprise B']?.oee || 0,
                data.data['Enterprise C']?.oee || 0
            ];

            window.oeeBreakdownChart.data.datasets[0].data = oeeValues;
            window.oeeBreakdownChart.update('none');
        }
    } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('Failed to fetch OEE breakdown:', error);
    }
}

/**
 * Fetch waste trends and update chart
 */
export async function fetchWasteTrends(signal) {
    try {
        const enterprise = getEnterpriseParam(state);
        const url = enterprise !== 'ALL'
            ? `/api/waste/trends?enterprise=${encodeURIComponent(enterprise)}`
            : '/api/waste/trends';
        const response = await fetch(url, { signal });
        const data = await response.json();

        if (window.wasteTrendChart && data.linesSummary) {
            const enterpriseColors = {
                'Enterprise A': {
                    bg: 'rgba(0, 255, 255, 0.6)',
                    border: 'rgba(0, 255, 255, 1)'
                },
                'Enterprise B': {
                    bg: 'rgba(255, 0, 255, 0.6)',
                    border: 'rgba(255, 0, 255, 1)'
                },
                'Enterprise C': {
                    bg: 'rgba(255, 191, 0, 0.6)',
                    border: 'rgba(255, 191, 0, 1)'
                }
            };

            const sortedLines = data.linesSummary.sort((a, b) => b.total - a.total);

            const labels = sortedLines.map(item => item.line);
            const values = sortedLines.map(item => item.total);
            const enterprises = sortedLines.map(item => item.enterprise);
            const backgroundColors = sortedLines.map(item =>
                enterpriseColors[item.enterprise]?.bg || 'rgba(128, 128, 128, 0.6)'
            );
            const borderColors = sortedLines.map(item =>
                enterpriseColors[item.enterprise]?.border || 'rgba(128, 128, 128, 1)'
            );

            window.wasteTrendChart.data.labels = labels;
            window.wasteTrendChart.data.datasets[0].data = values;
            window.wasteTrendChart.data.datasets[0].backgroundColor = backgroundColors;
            window.wasteTrendChart.data.datasets[0].borderColor = borderColors;
            window.wasteTrendChart.data.datasets[0].enterprises = enterprises;
            window.wasteTrendChart.update('none');
        }
    } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('Failed to fetch waste trends:', error);
    }
}

/**
 * Fetch scrap by line and update chart
 */
export async function fetchScrapByLine(signal) {
    try {
        const enterprise = getEnterpriseParam(state);
        const url = enterprise !== 'ALL'
            ? `/api/waste/by-line?enterprise=${encodeURIComponent(enterprise)}`
            : '/api/waste/by-line';
        const response = await fetch(url, { signal });
        const data = await response.json();

        if (window.scrapByLineChart && data.lines) {
            const top10Lines = data.lines.slice(0, 10);
            const labels = top10Lines.map(line => `${line.site} / ${line.line}`);
            const values = top10Lines.map(line => line.total);

            window.scrapByLineChart.data.labels = labels;
            window.scrapByLineChart.data.datasets[0].data = values;
            window.scrapByLineChart.update('none');
        }
    } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('Failed to fetch scrap by line:', error);
    }
}

/**
 * Fetch and render quality metrics from waste/trends summary
 */
export async function fetchQualityMetrics(signal) {
    try {
        const enterprise = getEnterpriseParam(state);
        const url = enterprise !== 'ALL'
            ? `/api/waste/trends?enterprise=${encodeURIComponent(enterprise)}`
            : '/api/waste/trends';
        const response = await fetch(url, { signal });
        const data = await response.json();

        const grid = document.getElementById('quality-grid');
        if (!grid || !data.summary) return;

        const enterpriseNames = {
            'Enterprise A': { short: 'ENT A', industry: 'Glass Mfg' },
            'Enterprise B': { short: 'ENT B', industry: 'Beverage' },
            'Enterprise C': { short: 'ENT C', industry: 'Pharma' }
        };

        const getStatus = (avg, enterprise) => {
            if (enterprise === 'Enterprise C') {
                if (avg < 50) return 'good';
                if (avg < 100) return 'warning';
                return 'critical';
            } else if (enterprise === 'Enterprise B') {
                if (avg < 50000) return 'good';
                if (avg < 100000) return 'warning';
                return 'critical';
            } else {
                if (avg < 500000) return 'good';
                if (avg < 750000) return 'warning';
                return 'critical';
            }
        };

        const trendArrow = (trend) => {
            switch(trend) {
                case 'rising': return '↑';
                case 'falling': return '↓';
                default: return '→';
            }
        };

        const formatNumber = (num) => {
            if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
            if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
            return num.toFixed(0);
        };

        let html = '';
        const selectedEnterprise = getEnterpriseParam(state);
        const enterprises = selectedEnterprise === 'ALL'
            ? ['Enterprise A', 'Enterprise B', 'Enterprise C']
            : [selectedEnterprise];
        enterprises.forEach(enterprise => {
            const summary = data.summary[enterprise];
            if (summary) {
                const status = getStatus(summary.avg, enterprise);
                const info = enterpriseNames[enterprise];
                html += `
                    <div class="quality-card ${status}">
                        <div class="quality-enterprise">${info.short}</div>
                        <div class="quality-rate">${formatNumber(summary.avg)}</div>
                        <div class="quality-trend ${summary.trend}">
                            ${trendArrow(summary.trend)} ${summary.trend}
                        </div>
                        <div class="quality-total">24h Total: ${formatNumber(summary.total)}</div>
                    </div>
                `;
            } else {
                const info = enterpriseNames[enterprise];
                html += `
                    <div class="quality-card good">
                        <div class="quality-enterprise">${info.short}</div>
                        <div class="quality-rate">--</div>
                        <div class="quality-trend stable">No data</div>
                        <div class="quality-total">24h Total: --</div>
                    </div>
                `;
            }
        });

        grid.innerHTML = html;
    } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('Failed to fetch quality metrics:', error);
        const grid = document.getElementById('quality-grid');
        if (grid) {
            grid.innerHTML = '<div class="heatmap-loading">Failed to load quality metrics</div>';
        }
    }
}

/**
 * Fetch factory status and render production heatmap
 */
export async function fetchFactoryStatus(signal) {
    try {
        const enterprise = getEnterpriseParam(state);
        const url = enterprise !== 'ALL'
            ? `/api/factory/status?enterprise=${encodeURIComponent(enterprise)}`
            : '/api/factory/status';

        const response = await fetch(url, { signal });
        const data = await response.json();

        if (data.enterprises) {
            renderProductionHeatmap(data.enterprises);
        }
    } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('Failed to fetch factory status:', error);
        const container = document.getElementById('production-heatmap');
        if (container) {
            container.innerHTML = '<div class="heatmap-loading">Failed to load factory status</div>';
        }
    }
}

/**
 * Fetch equipment states from API
 */
export async function fetchEquipmentStates(signal) {
    try {
        const enterprise = getEnterpriseParam(state);
        const url = enterprise !== 'ALL'
            ? `/api/equipment/states?enterprise=${encodeURIComponent(enterprise)}`
            : '/api/equipment/states';
        const response = await fetch(url, { signal });
        const data = await response.json();

        if (data.states && Array.isArray(data.states)) {
            state.equipmentStates.clear();
            data.states.forEach(equipment => {
                const key = `${equipment.enterprise}/${equipment.site}/${equipment.machine}`;
                state.equipmentStates.set(key, {
                    id: key,
                    name: equipment.machine,
                    state: equipment.stateName || equipment.state,
                    enterprise: equipment.enterprise,
                    site: equipment.site,
                    reason: equipment.reason,
                    color: equipment.color
                });
            });

            if (data.summary) {
                const runningEl = document.getElementById('state-running');
                const idleEl = document.getElementById('state-idle');
                const downEl = document.getElementById('state-down');
                if (runningEl) runningEl.textContent = data.summary.running || 0;
                if (idleEl) idleEl.textContent = data.summary.idle || 0;
                if (downEl) downEl.textContent = data.summary.down || 0;
            }

            // Import needed here to avoid circular dependency
            const { updateEquipmentStateGrid } = await import('./dashboard-render.js');
            updateEquipmentStateGrid();
        }
    } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('Failed to fetch equipment states:', error);
        const grid = document.getElementById('equipment-state-grid');
        if (grid) {
            grid.innerHTML = '<div class="heatmap-loading">Failed to load equipment states</div>';
        }
    }
}

/**
 * Fetch batch status for Enterprise C
 */
export async function fetchBatchStatus(signal) {
    try {
        const response = await fetch('/api/batch/status', { signal });
        if (!response.ok) {
            throw new Error(`HTTP error: ${response.status}`);
        }
        const data = await response.json();
        renderBatchOperations(data);
    } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('Error fetching batch status:', error);
        renderBatchOperationsError();
    }
}

/**
 * Fetch line OEE from API (or batch status for Enterprise C)
 */
export async function fetchLineOEE(signal) {
    const enterprise = getEnterpriseParam(state);
    if (enterprise === 'Enterprise C') {
        await fetchBatchStatus(signal);
        return;
    }

    try {
        const response = await fetch('/api/oee/lines', { signal });
        const data = await response.json();

        if (data.lines && Array.isArray(data.lines)) {
            let filteredLines = data.lines;
            if (enterprise !== 'ALL') {
                filteredLines = data.lines.filter(line => line.enterprise === enterprise);
            }
            renderLineOEEGrid(filteredLines);
        } else {
            const grid = document.getElementById('line-oee-grid');
            if (grid) {
                grid.innerHTML = '<div class="heatmap-loading">No line OEE data available</div>';
            }
        }
    } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('Failed to fetch line OEE:', error);
        const grid = document.getElementById('line-oee-grid');
        if (grid) {
            grid.innerHTML = '<div class="heatmap-loading">Failed to load line OEE</div>';
        }
    }
}

/**
 * Refresh all data cards with current filter
 */
export async function refreshAllData() {
    connection.refreshAbortController = new AbortController();
    const signal = connection.refreshAbortController.signal;

    await Promise.allSettled([
        fetchOEE(signal),
        fetchOEEBreakdown(signal),
        fetchFactoryStatus(signal),
        fetchWasteTrends(signal),
        fetchScrapByLine(signal),
        fetchQualityMetrics(signal),
        fetchEquipmentStates(signal),
        fetchLineOEE(signal)
    ]);
}

/**
 * Factory selection handler
 */
export function selectFactory(factory) {
    if (state.selectedFactory === factory) return;

    if (connection.refreshAbortController) connection.refreshAbortController.abort();

    state.selectedFactory = factory;
    try {
        localStorage.setItem('edgemind_selectedFactory', factory);
    } catch (e) {
        // localStorage unavailable
    }

    document.querySelectorAll('.factory-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.factory === factory);
    });

    const selector = document.querySelector('.factory-selector');
    const activeBtn = document.querySelector(`.factory-btn[data-factory="${factory}"]`);
    if (selector) selector.classList.add('loading');
    if (activeBtn) activeBtn.classList.add('loading');

    state.messages = [];
    state.enterpriseCounts = { 'Enterprise A': 0, 'Enterprise B': 0, 'Enterprise C': 0 };

    if (window.healthChart) {
        window.healthChart.data.datasets[0].data = [0, 0, 0];
        window.healthChart.update();
    }

    refreshAllData().finally(() => {
        if (selector) selector.classList.remove('loading');
        if (activeBtn) activeBtn.classList.remove('loading');
    });

    // Import needed to avoid circular dependency
    import('./dashboard-render.js').then(({ updateMetrics }) => {
        updateMetrics();
    });

    filterInsights(state.insightFilter);

    console.log('Filtering by factory:', factory);
}
