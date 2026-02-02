// COO TRENDS VIEW - Chart.js trend analysis charts

let refreshInterval = null;
let oeeChart = null;
let wasteChart = null;
let equipmentChart = null;

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
 * Create OEE by Enterprise bar chart
 */
function createOEEChart(data) {
    oeeChart = destroyChart(oeeChart);

    const canvas = document.getElementById('coo-oee-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const oeeData = data?.data || {};
    const enterprises = Object.keys(oeeData);
    const values = enterprises.map(e => oeeData[e]?.oee || 0);
    const colors = values.map(v => {
        if (v >= 85) return CHART_COLORS.green;
        if (v >= 70) return CHART_COLORS.amber;
        return CHART_COLORS.red;
    });

    oeeChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: enterprises.map(e => e.replace('Enterprise ', 'Ent. ')),
            datasets: [{
                label: 'OEE %',
                data: values,
                backgroundColor: colors.map(c => c + '99'),
                borderColor: colors,
                borderWidth: 2,
                borderRadius: 6,
                barPercentage: 0.6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `OEE: ${ctx.parsed.y.toFixed(1)}%`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    grid: { color: DARK_THEME.gridColor },
                    ticks: {
                        color: DARK_THEME.tickColor,
                        callback: (v) => v + '%'
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: DARK_THEME.tickColor }
                }
            }
        }
    });
}

/**
 * Create Waste trends bar chart
 */
function createWasteChart(data) {
    wasteChart = destroyChart(wasteChart);

    const canvas = document.getElementById('coo-waste-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const summary = data?.summary || {};
    const enterprises = Object.keys(summary);
    const totals = enterprises.map(e => summary[e]?.total || 0);
    const trends = enterprises.map(e => summary[e]?.trend || 'stable');

    const barColors = trends.map(t => {
        if (t === 'rising') return CHART_COLORS.red;
        if (t === 'falling') return CHART_COLORS.green;
        return CHART_COLORS.amber;
    });

    wasteChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: enterprises.map(e => e.replace('Enterprise ', 'Ent. ')),
            datasets: [{
                label: 'Total Waste (24h)',
                data: totals,
                backgroundColor: barColors.map(c => c + '99'),
                borderColor: barColors,
                borderWidth: 2,
                borderRadius: 6,
                barPercentage: 0.6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const idx = ctx.dataIndex;
                            const trend = trends[idx] || 'stable';
                            const arrow = trend === 'rising' ? ' (rising)' : trend === 'falling' ? ' (falling)' : '';
                            return `Waste: ${ctx.parsed.y.toFixed(1)}${arrow}`;
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
                    ticks: { color: DARK_THEME.tickColor }
                }
            }
        }
    });
}

/**
 * Create Equipment state doughnut chart
 */
function createEquipmentChart(data) {
    equipmentChart = destroyChart(equipmentChart);

    const canvas = document.getElementById('coo-equipment-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const summary = data?.summary || { running: 0, idle: 0, down: 0, unknown: 0 };
    const labels = ['Running', 'Idle', 'Down', 'Unknown'];
    const values = [summary.running || 0, summary.idle || 0, summary.down || 0, summary.unknown || 0];
    const colors = [CHART_COLORS.green, CHART_COLORS.amber, CHART_COLORS.red, '#666666'];

    // Filter out zero values for cleaner display
    const filteredLabels = [];
    const filteredValues = [];
    const filteredColors = [];
    labels.forEach((label, i) => {
        if (values[i] > 0) {
            filteredLabels.push(label);
            filteredValues.push(values[i]);
            filteredColors.push(colors[i]);
        }
    });

    // If all zero, show placeholder
    if (filteredValues.length === 0) {
        filteredLabels.push('No Data');
        filteredValues.push(1);
        filteredColors.push('#333333');
    }

    equipmentChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: filteredLabels,
            datasets: [{
                data: filteredValues,
                backgroundColor: filteredColors.map(c => c + 'cc'),
                borderColor: filteredColors,
                borderWidth: 2,
                hoverOffset: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '55%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: DARK_THEME.tickColor,
                        padding: 16,
                        usePointStyle: true,
                        pointStyleWidth: 12
                    }
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : 0;
                            return `${ctx.label}: ${ctx.parsed} (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
}

/**
 * Fetch all data and create/update charts
 */
async function fetchAndRender() {
    try {
        const [oeeRes, wasteRes, equipRes] = await Promise.all([
            fetch('/api/oee/breakdown'),
            fetch('/api/waste/trends'),
            fetch('/api/equipment/states')
        ]);

        if (!oeeRes.ok) throw new Error(`OEE breakdown: ${oeeRes.status}`);
        if (!wasteRes.ok) throw new Error(`Waste trends: ${wasteRes.status}`);
        if (!equipRes.ok) throw new Error(`Equipment states: ${equipRes.status}`);

        const [oeeData, wasteData, equipData] = await Promise.all([
            oeeRes.json(),
            wasteRes.json(),
            equipRes.json()
        ]);

        createOEEChart(oeeData);
        createWasteChart(wasteData);
        createEquipmentChart(equipData);
    } catch (error) {
        console.error('COO trends fetch error:', error);
    }
}

/**
 * Initialize the trends view
 */
export async function init() {
    await fetchAndRender();
    refreshInterval = setInterval(fetchAndRender, 30000);
}

/**
 * Cleanup the trends view
 */
export function cleanup() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }
    oeeChart = destroyChart(oeeChart);
    wasteChart = destroyChart(wasteChart);
    equipmentChart = destroyChart(equipmentChart);
}
