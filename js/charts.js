// CHARTS - Chart.js initialization and updates

/**
 * Initialize all Chart.js charts
 */
export function initializeCharts() {
    // Destroy existing charts before creating new ones to prevent memory leaks
    if (window.oeeBreakdownChart) window.oeeBreakdownChart.destroy();
    if (window.wasteTrendChart) window.wasteTrendChart.destroy();
    if (window.scrapByLineChart) window.scrapByLineChart.destroy();

    // OEE Breakdown Chart (Horizontal Bar Chart)
    const oeeBreakdownCtx = document.getElementById('oee-breakdown-chart').getContext('2d');
    window.oeeBreakdownChart = new Chart(oeeBreakdownCtx, {
        type: 'bar',
        data: {
            labels: ['Enterprise A', 'Enterprise B', 'Enterprise C'],
            datasets: [{
                label: 'OEE %',
                data: [0, 0, 0],
                backgroundColor: [
                    'rgba(0, 255, 255, 0.6)',
                    'rgba(255, 0, 255, 0.6)',
                    'rgba(255, 191, 0, 0.6)'
                ],
                borderColor: [
                    'rgba(0, 255, 255, 1)',
                    'rgba(255, 0, 255, 1)',
                    'rgba(255, 191, 0, 1)'
                ],
                borderWidth: 2
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                x: {
                    ticks: { color: '#6b7280' },
                    grid: { color: 'rgba(0, 255, 255, 0.1)' },
                    beginAtZero: true,
                    max: 100,
                    title: {
                        display: true,
                        text: 'OEE %',
                        color: '#e8e8e8'
                    }
                },
                y: {
                    ticks: { color: '#e8e8e8', font: { size: 14 } },
                    grid: { display: false }
                }
            }
        }
    });

    // Waste Trend Chart (Bar Chart - Grouped by Line)
    const wasteTrendCtx = document.getElementById('waste-trend-chart').getContext('2d');
    window.wasteTrendChart = new Chart(wasteTrendCtx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [{
                label: 'Total Waste/Defects',
                data: [],
                backgroundColor: [],
                borderColor: [],
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            onClick: (event, activeElements) => {
                if (activeElements.length > 0) {
                    const index = activeElements[0].index;
                    const label = window.wasteTrendChart.data.labels[index];
                    const value = window.wasteTrendChart.data.datasets[0].data[index];
                    const enterprise = window.wasteTrendChart.data.datasets[0].enterprises[index];
                    alert(`Line: ${label}\nEnterprise: ${enterprise}\nTotal Waste/Defects: ${value}`);
                }
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(10, 14, 26, 0.9)',
                    titleColor: '#00ffff',
                    bodyColor: '#e8e8e8',
                    borderColor: '#00ffff',
                    borderWidth: 1,
                    padding: 12,
                    displayColors: true,
                    callbacks: {
                        title: (context) => {
                            return `Line: ${context[0].label}`;
                        },
                        label: (context) => {
                            const enterprise = context.dataset.enterprises[context.dataIndex];
                            return [
                                `Enterprise: ${enterprise}`,
                                `Total: ${context.parsed.y} defects`
                            ];
                        }
                    }
                }
            },
            scales: {
                x: {
                    ticks: {
                        color: '#e8e8e8',
                        font: { size: 11 }
                    },
                    grid: { display: false }
                },
                y: {
                    ticks: { color: '#6b7280' },
                    grid: { color: 'rgba(0, 255, 255, 0.1)' },
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Total Waste/Defects',
                        color: '#e8e8e8'
                    }
                }
            }
        }
    });

    // Scrap by Line Chart (Horizontal Bar Chart)
    const scrapByLineCtx = document.getElementById('scrap-by-line-chart').getContext('2d');
    window.scrapByLineChart = new Chart(scrapByLineCtx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [{
                label: 'Total Scrap',
                data: [],
                backgroundColor: 'rgba(255, 82, 82, 0.6)',
                borderColor: 'rgba(255, 82, 82, 1)',
                borderWidth: 2
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                x: {
                    ticks: { color: '#6b7280' },
                    grid: { color: 'rgba(255, 82, 82, 0.1)' },
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Scrap Count',
                        color: '#e8e8e8'
                    }
                },
                y: {
                    ticks: { color: '#e8e8e8', font: { size: 12 } },
                    grid: { display: false }
                }
            }
        }
    });
}

/**
 * Update charts (placeholder - charts updated by individual fetch functions)
 */
export function updateCharts() {
    // Charts are updated via their own fetch functions
}
