// PLANT MANAGER - OEE DRILL-DOWN VIEW
// Detailed OEE breakdown with Chart.js visualizations

import { state } from './state.js';

let refreshInterval = null;
let oeeBarChart = null;
let wasteDoughnutChart = null;

/**
 * Get OEE color based on value
 */
function getOeeColor(value) {
    if (value >= 85) return '#10b981';
    if (value >= 70) return '#f59e0b';
    return '#ef4444';
}

/**
 * Get OEE class based on value
 */
function getOeeClass(value) {
    if (value >= 85) return 'oee-green';
    if (value >= 70) return 'oee-amber';
    return 'oee-red';
}

/**
 * Destroy existing charts before recreation
 */
function destroyCharts() {
    if (oeeBarChart) {
        oeeBarChart.destroy();
        oeeBarChart = null;
    }
    if (wasteDoughnutChart) {
        wasteDoughnutChart.destroy();
        wasteDoughnutChart = null;
    }
}

/**
 * Render the large OEE display with A x P x Q breakdown
 */
function renderBigOEE(container, oeeData) {
    if (!container) return;

    const oee = oeeData?.oee ?? 0;
    const availability = oeeData?.availability ?? 0;
    const performance = oeeData?.performance ?? 0;
    const quality = oeeData?.quality ?? 0;
    const oeeClass = getOeeClass(oee);

    container.innerHTML = `
        <div class="oee-big-value ${oeeClass}">${oee.toFixed(1)}<span class="oee-big-unit">%</span></div>
        <div class="oee-big-label">Overall Equipment Effectiveness</div>
        <div class="oee-apq-display">
            <div class="oee-apq-item">
                <div class="oee-apq-bar-track">
                    <div class="oee-apq-bar-fill apq-availability" style="width: ${Math.min(100, availability)}%"></div>
                </div>
                <div class="oee-apq-detail">
                    <span class="oee-apq-label">Availability</span>
                    <span class="oee-apq-value">${availability.toFixed(1)}%</span>
                </div>
            </div>
            <div class="oee-apq-item">
                <div class="oee-apq-bar-track">
                    <div class="oee-apq-bar-fill apq-performance" style="width: ${Math.min(100, performance)}%"></div>
                </div>
                <div class="oee-apq-detail">
                    <span class="oee-apq-label">Performance</span>
                    <span class="oee-apq-value">${performance.toFixed(1)}%</span>
                </div>
            </div>
            <div class="oee-apq-item">
                <div class="oee-apq-bar-track">
                    <div class="oee-apq-bar-fill apq-quality" style="width: ${Math.min(100, quality)}%"></div>
                </div>
                <div class="oee-apq-detail">
                    <span class="oee-apq-label">Quality</span>
                    <span class="oee-apq-value">${quality.toFixed(1)}%</span>
                </div>
            </div>
        </div>
        <div class="oee-formula">A x P x Q = ${availability.toFixed(0)}% x ${performance.toFixed(0)}% x ${quality.toFixed(0)}%</div>
    `;
}

/**
 * Render OEE by line horizontal bar chart
 */
function renderOEEByLineChart(lines) {
    const canvas = document.getElementById('plant-oee-lines-chart');
    if (!canvas || typeof Chart === 'undefined') return;

    const ctx = canvas.getContext('2d');
    const sorted = [...lines].sort((a, b) => (a.oee ?? 0) - (b.oee ?? 0));

    const labels = sorted.map(l => `${l.site} (${l.line})`);
    const data = sorted.map(l => l.oee ?? 0);
    const colors = data.map(v => getOeeColor(v));

    oeeBarChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'OEE %',
                data,
                backgroundColor: colors.map(c => c + '99'),
                borderColor: colors,
                borderWidth: 1
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
                        label: (ctx) => `OEE: ${ctx.parsed.x.toFixed(1)}%`
                    }
                }
            },
            scales: {
                x: {
                    min: 0,
                    max: 100,
                    grid: { color: 'rgba(255,255,255,0.08)' },
                    ticks: { color: '#888', callback: (v) => v + '%' }
                },
                y: {
                    grid: { display: false },
                    ticks: { color: '#ccc', font: { size: 11 } }
                }
            }
        }
    });
}

/**
 * Render waste breakdown doughnut chart
 */
function renderWasteChart(breakdown) {
    const canvas = document.getElementById('plant-waste-chart');
    if (!canvas || typeof Chart === 'undefined') return;

    const ctx = canvas.getContext('2d');

    if (!breakdown || breakdown.length === 0) {
        ctx.fillStyle = '#666';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No waste data available', canvas.width / 2, canvas.height / 2);
        return;
    }

    const labels = breakdown.map(b => b.enterprise);
    const data = breakdown.map(b => b.total);
    const bgColors = ['#ef444499', '#f59e0b99', '#3b82f699', '#8b5cf699'];
    const borderColors = ['#ef4444', '#f59e0b', '#3b82f6', '#8b5cf6'];

    wasteDoughnutChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: bgColors.slice(0, data.length),
                borderColor: borderColors.slice(0, data.length),
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: '#ccc', padding: 12, font: { size: 11 } }
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `${ctx.label}: ${ctx.parsed.toFixed(1)} units`
                    }
                }
            }
        }
    });
}

/**
 * Fetch all data and render the OEE drilldown view
 */
async function fetchAndRender() {
    const bigDisplay = document.getElementById('oee-big-display');

    try {
        const enterpriseParam = state.selectedFactory && state.selectedFactory !== 'ALL'
            ? `?enterprise=${encodeURIComponent(state.selectedFactory)}`
            : '';

        const [oeeRes, linesRes, wasteRes] = await Promise.all([
            fetch(`/api/oee/v2${enterpriseParam}`),
            fetch(`/api/oee/lines${enterpriseParam}`),
            fetch('/api/waste/breakdown')
        ]);

        if (!oeeRes.ok) throw new Error(`OEE v2: ${oeeRes.status}`);
        if (!linesRes.ok) throw new Error(`OEE lines: ${linesRes.status}`);

        const oeeData = await oeeRes.json();
        const linesData = await linesRes.json();
        const wasteData = wasteRes.ok ? await wasteRes.json() : { breakdown: [] };

        // Render big OEE display
        renderBigOEE(bigDisplay, oeeData);

        // Destroy old charts before creating new ones
        destroyCharts();

        // Render OEE by line chart
        const lines = linesData.lines || [];
        if (lines.length > 0) {
            renderOEEByLineChart(lines);
        }

        // Render waste breakdown
        renderWasteChart(wasteData.breakdown || []);

    } catch (error) {
        console.error('OEE drilldown fetch error:', error);
        if (bigDisplay) {
            bigDisplay.innerHTML = `<div class="view-loading" style="color: var(--accent-red);">Failed to load OEE data: ${error.message}</div>`;
        }
    }
}

/**
 * Initialize OEE drilldown view
 */
export async function init() {
    await fetchAndRender();
    refreshInterval = setInterval(fetchAndRender, 30000);
}

/**
 * Cleanup OEE drilldown view
 */
export function cleanup() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }
    destroyCharts();
}
