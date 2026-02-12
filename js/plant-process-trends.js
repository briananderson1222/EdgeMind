// PLANT MANAGER - PROCESS TRENDS VIEW
// SPC measurements, downtime Pareto, production volume, energy consumption

import { state } from './state.js';

let refreshInterval = null;
let spcChart = null;
let downtimeChart = null;
let productionChart = null;
let energyChart = null;

const CHART_COLORS = {
    cyan: '#00ffff',
    green: '#10b981',
    amber: '#f59e0b',
    red: '#ef4444',
    purple: '#a78bfa',
    blue: '#3b82f6',
    pink: '#ec4899'
};

const DARK_THEME = {
    gridColor: 'rgba(255, 255, 255, 0.1)',
    tickColor: '#e8e8e8',
    backgroundColor: 'transparent'
};

/**
 * Destroy a chart instance safely
 */
function destroyChart(chart) {
    if (chart && typeof chart.destroy === 'function') {
        chart.destroy();
    }
    return null;
}

/**
 * Render SPC measurements dropdown
 */
function renderSPCDropdown(measurements) {
    const select = document.getElementById('plant-spc-measurement-select');
    if (!select) return;

    select.innerHTML = measurements.map((m, idx) => `
        <option value="${m.measurement}" ${idx === 0 ? 'selected' : ''}>
            ${m.displayName} - Cpk: ${m.statistics.cpk.toFixed(2)} (${m.reason})
        </option>
    `).join('');

    select.addEventListener('change', (e) => {
        const selectedMeasurement = e.target.value;
        loadSPCData(selectedMeasurement);
    });
}

/**
 * Create SPC control chart with UCL/LCL
 */
function createSPCChart(data) {
    spcChart = destroyChart(spcChart);

    const canvas = document.getElementById('plant-spc-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const labels = data.data.map(d => new Date(d.timestamp));
    const values = data.data.map(d => d.value);
    const outOfControlIndices = data.data
        .map((d, i) => d.outOfControl ? i : null)
        .filter(i => i !== null);

    spcChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: data.measurement,
                    data: values,
                    borderColor: CHART_COLORS.cyan,
                    borderWidth: 2,
                    pointRadius: values.map((_, i) => outOfControlIndices.includes(i) ? 6 : 3),
                    pointBackgroundColor: values.map((_, i) =>
                        outOfControlIndices.includes(i) ? CHART_COLORS.red : CHART_COLORS.cyan
                    ),
                    pointBorderColor: values.map((_, i) =>
                        outOfControlIndices.includes(i) ? CHART_COLORS.red : CHART_COLORS.cyan
                    ),
                    fill: false,
                    tension: 0.1
                },
                {
                    label: 'UCL (Upper Control Limit)',
                    data: Array(values.length).fill(data.controlLimits.ucl),
                    borderColor: CHART_COLORS.red,
                    borderWidth: 1,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    fill: false
                },
                {
                    label: 'Mean',
                    data: Array(values.length).fill(data.controlLimits.mean),
                    borderColor: CHART_COLORS.green,
                    borderWidth: 1,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    fill: false
                },
                {
                    label: 'LCL (Lower Control Limit)',
                    data: Array(values.length).fill(data.controlLimits.lcl),
                    borderColor: CHART_COLORS.red,
                    borderWidth: 1,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    fill: false
                },
                {
                    label: 'Target',
                    data: Array(values.length).fill(data.controlLimits.target),
                    borderColor: CHART_COLORS.amber,
                    borderWidth: 2,
                    borderDash: [10, 5],
                    pointRadius: 0,
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: DARK_THEME.tickColor,
                        padding: 10,
                        font: { size: 10 }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            if (ctx.datasetIndex === 0) {
                                const idx = ctx.dataIndex;
                                const point = data.data[idx];
                                return [
                                    `Value: ${ctx.parsed.y.toFixed(2)}`,
                                    point.outOfControl ? `⚠️ OUT OF CONTROL (${point.violationType})` : '✓ In Control'
                                ];
                            }
                            return `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: 'time',
                    grid: { color: DARK_THEME.gridColor },
                    ticks: { color: DARK_THEME.tickColor }
                },
                y: {
                    grid: { color: DARK_THEME.gridColor },
                    ticks: { color: DARK_THEME.tickColor }
                }
            }
        }
    });

    // Show Cpk badge
    const cpkBadge = document.getElementById('spc-cpk-badge');
    if (cpkBadge) {
        const cpk = data.statistics.cpk;
        const cpkClass = cpk >= 1.67 ? 'excellent' : cpk >= 1.33 ? 'adequate' : 'poor';
        cpkBadge.innerHTML = `
            <span class="cpk-label">Process Capability (Cpk):</span>
            <span class="cpk-value ${cpkClass}">${cpk.toFixed(2)}</span>
            <span class="cpk-interpretation">
                ${cpk >= 1.67 ? '✓ Excellent' : cpk >= 1.33 ? '✓ Adequate' : '⚠️ Needs Improvement'}
            </span>
        `;
    }
}

/**
 * Load SPC data for selected measurement
 */
async function loadSPCData(measurement) {
    try {
        const enterprise = state.selectedFactory === 'ALL' ? 'Enterprise A' : state.selectedFactory;
        const res = await fetch(`/api/spc/data?measurement=${encodeURIComponent(measurement)}&window=daily&enterprise=${encodeURIComponent(enterprise)}`);
        if (!res.ok) throw new Error(`SPC data: ${res.status}`);

        const data = await res.json();
        createSPCChart(data);
    } catch (error) {
        console.error('SPC data fetch error:', error);
    }
}

/**
 * Create enterprise-specific downtime Pareto
 */
function createDowntimeChart(data) {
    downtimeChart = destroyChart(downtimeChart);

    const canvas = document.getElementById('plant-downtime-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const topN = data.paretoData.slice(0, 10);
    const labels = topN.map(d => `${d.machine}\n(${d.site})`);
    const values = topN.map(d => d.downtimeMinutes);
    const percentages = topN.map(d => d.percentOfTotal);

    downtimeChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Downtime (minutes)',
                data: values,
                backgroundColor: values.map((v, i) => {
                    if (i === 0) return CHART_COLORS.red + '99';
                    if (i < 3) return CHART_COLORS.amber + '99';
                    return CHART_COLORS.cyan + '99';
                }),
                borderColor: values.map((v, i) => {
                    if (i === 0) return CHART_COLORS.red;
                    if (i < 3) return CHART_COLORS.amber;
                    return CHART_COLORS.cyan;
                }),
                borderWidth: 2,
                borderRadius: 6
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const idx = ctx.dataIndex;
                            return [
                                `Downtime: ${ctx.parsed.x} minutes`,
                                `Percent: ${percentages[idx].toFixed(1)}%`,
                                `Incidents: ${topN[idx].incidentCount}`
                            ];
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: DARK_THEME.gridColor },
                    ticks: {
                        color: DARK_THEME.tickColor,
                        callback: (v) => v + ' min'
                    }
                },
                y: {
                    grid: { display: false },
                    ticks: { color: DARK_THEME.tickColor, font: { size: 9 } }
                }
            }
        }
    });
}

/**
 * Create production volume vs target grouped bar chart
 */
function createProductionChart(data) {
    productionChart = destroyChart(productionChart);

    const canvas = document.getElementById('plant-production-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const byLine = data.byLine.slice(0, 8); // Top 8 lines
    const labels = byLine.map(l => l.line);
    const actualValues = byLine.map(l => l.actual);
    const targetValues = byLine.map(l => l.target);

    productionChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Actual',
                    data: actualValues,
                    backgroundColor: actualValues.map((actual, idx) => {
                        const pct = byLine[idx].percentOfTarget;
                        if (pct >= 100) return CHART_COLORS.green + '99';
                        if (pct >= 90) return CHART_COLORS.amber + '99';
                        return CHART_COLORS.red + '99';
                    }),
                    borderColor: actualValues.map((actual, idx) => {
                        const pct = byLine[idx].percentOfTarget;
                        if (pct >= 100) return CHART_COLORS.green;
                        if (pct >= 90) return CHART_COLORS.amber;
                        return CHART_COLORS.red;
                    }),
                    borderWidth: 2,
                    borderRadius: 6
                },
                {
                    label: 'Target',
                    data: targetValues,
                    backgroundColor: CHART_COLORS.cyan + '33',
                    borderColor: CHART_COLORS.cyan,
                    borderWidth: 2,
                    borderRadius: 6,
                    borderDash: [5, 5]
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: DARK_THEME.tickColor,
                        padding: 10,
                        font: { size: 11 }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const idx = ctx.dataIndex;
                            const line = byLine[idx];
                            if (ctx.datasetIndex === 0) {
                                return [
                                    `Actual: ${ctx.parsed.y} units`,
                                    `Target: ${line.target} units`,
                                    `Performance: ${line.percentOfTarget.toFixed(1)}%`
                                ];
                            }
                            return `Target: ${ctx.parsed.y} units`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: DARK_THEME.gridColor },
                    ticks: { color: DARK_THEME.tickColor }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: DARK_THEME.tickColor, font: { size: 9 } }
                }
            }
        }
    });
}

/**
 * Create energy consumption multi-line chart
 */
function createEnergyChart(data) {
    energyChart = destroyChart(energyChart);

    const canvas = document.getElementById('plant-energy-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const byLine = data.byLine.slice(0, 5); // Top 5 consumers

    // Create datasets (one per line)
    const datasets = byLine.map((line, idx) => {
        const colors = [CHART_COLORS.cyan, CHART_COLORS.green, CHART_COLORS.amber, CHART_COLORS.purple, CHART_COLORS.pink];
        const timeSeriesData = line.timeSeries.map(d => ({
            x: new Date(d.timestamp),
            y: d.value
        }));

        return {
            label: line.line,
            data: timeSeriesData,
            borderColor: colors[idx],
            borderWidth: 2,
            pointRadius: 2,
            fill: false,
            tension: 0.1
        };
    });

    energyChart = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: DARK_THEME.tickColor,
                        padding: 8,
                        font: { size: 10 },
                        usePointStyle: true
                    }
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)} kW`
                    }
                }
            },
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: 'hour'
                    },
                    grid: { color: DARK_THEME.gridColor },
                    ticks: { color: DARK_THEME.tickColor }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: DARK_THEME.gridColor },
                    ticks: {
                        color: DARK_THEME.tickColor,
                        callback: (v) => v + ' kW'
                    }
                }
            }
        }
    });
}

/**
 * Get the selected enterprise from the dropdown or state
 */
function getSelectedEnterprise() {
    const dropdown = document.getElementById('plant-process-enterprise');
    if (dropdown) return dropdown.value;
    return state.selectedFactory === 'ALL' ? 'Enterprise A' : state.selectedFactory;
}

/**
 * Safely fetch JSON from an endpoint
 */
async function safeFetch(url, label) {
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${label}: ${res.status}`);
        return await res.json();
    } catch (error) {
        console.error(`Plant process trends - ${label} error:`, error);
        return null;
    }
}

/**
 * Fetch and render all plant process trend data
 */
async function fetchAndRender() {
    const enterprise = getSelectedEnterprise();

    // Fetch all data in parallel - each request is independent
    const [spcData, downtimeData, productionData, energyData] = await Promise.all([
        safeFetch(`/api/spc/measurements?enterprise=${encodeURIComponent(enterprise)}&limit=5`, 'SPC measurements'),
        safeFetch(`/api/trends/downtime-pareto?window=daily&enterprise=${encodeURIComponent(enterprise)}`, 'Downtime'),
        safeFetch(`/api/production/volume?enterprise=${encodeURIComponent(enterprise)}&window=shift`, 'Production'),
        safeFetch(`/api/production/energy?enterprise=${encodeURIComponent(enterprise)}&window=shift`, 'Energy')
    ]);

    // Render SPC independently - don't block other charts
    if (spcData && spcData.measurements && spcData.measurements.length > 0) {
        renderSPCDropdown(spcData.measurements);
        await loadSPCData(spcData.measurements[0].measurement);
    } else {
        const select = document.getElementById('plant-spc-measurement-select');
        if (select) {
            select.innerHTML = '<option>No SPC measurements available</option>';
        }
        const cpkBadge = document.getElementById('spc-cpk-badge');
        if (cpkBadge) {
            cpkBadge.innerHTML = '<span class="cpk-label">No SPC data available for this enterprise</span>';
        }
    }

    // Render other charts independently
    if (downtimeData) createDowntimeChart(downtimeData);
    if (productionData) createProductionChart(productionData);
    if (energyData) createEnergyChart(energyData);
}

/**
 * Initialize view
 */
export async function init() {
    // Wire up enterprise dropdown
    const dropdown = document.getElementById('plant-process-enterprise');
    if (dropdown) {
        const enterprise = state.selectedFactory === 'ALL' ? 'Enterprise A' : state.selectedFactory;
        dropdown.value = enterprise;
        dropdown.addEventListener('change', () => fetchAndRender());
    }

    await fetchAndRender();
    refreshInterval = setInterval(fetchAndRender, 60000); // 1 minute refresh
}

/**
 * Cleanup view
 */
export function cleanup() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }
    spcChart = destroyChart(spcChart);
    downtimeChart = destroyChart(downtimeChart);
    productionChart = destroyChart(productionChart);
    energyChart = destroyChart(energyChart);
}
