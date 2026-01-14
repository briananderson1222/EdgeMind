// REAL IMPLEMENTATION - Connects to actual backend

// Cheeky messages when insights are disabled
const SLEEPING_AGENT_MESSAGES = [
    "The AI is taking a power nap. Data collection continues.",
    "Agent on coffee break. Factory still running smoothly.",
    "Currently in 'observe mode' - watching, not chatting.",
    "The copilot stepped out. Left the autopilot on.",
    "Shhh... the neural networks are dreaming of electric sheep.",
    "Agent is meditating on your data. Silently.",
    "Taking a byte out of downtime. Analysis paused.",
    "The AI went to grab a byte to eat. Back soon.",
    "Running in stealth mode. All sensors, no chatter.",
    "Copilot is AFK. Factory keeps on trucking.",
    "Brain on standby. Eyes still on the sensors.",
    "The algorithm is touching grass. Data still flowing.",
    "Agent is buffering... just kidding, insights are off.",
    "Currently vibing in low-power mode.",
    "The AI took a personal day. Machines don't judge."
];

// Dynamic WebSocket URL - matches page protocol (ws:// for http, wss:// for https)
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = window.location.hostname === 'localhost'
    ? 'ws://localhost:3000/ws'
    : `${wsProtocol}//${window.location.host}/ws`;
let ws = null;
let reconnectInterval = null;
let isConnected = false;
let messageRate = 0;
let lastMessageTime = Date.now();
let messagesSinceLastRate = 0;

// State
const state = {
    messages: [],
    insights: [],
    anomalies: [],  // Flat list of all anomalies from insights
    stats: {
        messageCount: 0,
        anomalyCount: 0,
        lastUpdate: null
    },
    latestOee: null,
    uniqueTopics: new Set(),
    messageRateHistory: [],
    topicCounts: {},
    enterpriseCounts: { 'Enterprise A': 0, 'Enterprise B': 0, 'Enterprise C': 0 },
    selectedFactory: 'ALL',  // 'ALL', 'A', 'B', or 'C'
    insightFilter: 'all',  // 'all' or 'anomalies'
    eventFilter: 'all',  // 'all', 'oee', 'state', 'alarm'
    equipmentStates: new Map(),  // Map of equipment ID to state
    selectedLineEnterprise: 'ALL',  // Selected enterprise for line OEE widget
    streamPaused: false,  // Pause/resume live stream
    anomalyFilters: [],  // User-defined anomaly filter rules
    thresholdSettings: {
        oeeBaseline: 70,
        oeeWorldClass: 85,
        availabilityMin: 65,
        defectRateWarning: 2,
        defectRateCritical: 5
    }
};

// Initialize Charts
window.oeeBreakdownChart = null;
window.wasteTrendChart = null;
window.scrapByLineChart = null;

function initializeCharts() {
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
                    'rgba(0, 255, 255, 0.6)',   // Cyan for A
                    'rgba(255, 0, 255, 0.6)',   // Magenta for B
                    'rgba(255, 191, 0, 0.6)'    // Amber for C
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
            indexAxis: 'y',  // Horizontal bars
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
            labels: [], // Line names
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
                backgroundColor: 'rgba(255, 82, 82, 0.6)',  // Accent red
                borderColor: 'rgba(255, 82, 82, 1)',
                borderWidth: 2
            }]
        },
        options: {
            indexAxis: 'y',  // Horizontal bars
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

// Update charts with new data (removed - no longer needed)
function updateCharts() {
    // Charts are updated via their own fetch functions
}

// Fetch OEE breakdown and update chart
async function fetchOEEBreakdown() {
    try {
        const response = await fetch('/api/oee/breakdown');
        const data = await response.json();

        if (window.oeeBreakdownChart && data.data) {
            // Update chart with breakdown data
            const oeeValues = [
                data.data['Enterprise A']?.oee || 0,
                data.data['Enterprise B']?.oee || 0,
                data.data['Enterprise C']?.oee || 0
            ];

            window.oeeBreakdownChart.data.datasets[0].data = oeeValues;
            window.oeeBreakdownChart.update('none');
        }
    } catch (error) {
        console.error('Failed to fetch OEE breakdown:', error);
    }
}

// Fetch waste trends and update chart
async function fetchWasteTrends() {
    try {
        const response = await fetch('/api/waste/trends');
        const data = await response.json();

        if (window.wasteTrendChart && data.linesSummary) {
            // Map enterprise to colors
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

            // Sort and prepare data for bar chart
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

            // Update chart
            window.wasteTrendChart.data.labels = labels;
            window.wasteTrendChart.data.datasets[0].data = values;
            window.wasteTrendChart.data.datasets[0].backgroundColor = backgroundColors;
            window.wasteTrendChart.data.datasets[0].borderColor = borderColors;
            window.wasteTrendChart.data.datasets[0].enterprises = enterprises;
            window.wasteTrendChart.update('none');
        }
    } catch (error) {
        console.error('Failed to fetch waste trends:', error);
    }
}

// Fetch scrap by line and update chart
async function fetchScrapByLine() {
    try {
        const response = await fetch('/api/waste/by-line');
        const data = await response.json();

        if (window.scrapByLineChart && data.lines) {
            // Get top 10 worst lines
            const top10Lines = data.lines.slice(0, 10);

            // Format labels as "Site / Line"
            const labels = top10Lines.map(line => `${line.site} / ${line.line}`);
            const values = top10Lines.map(line => line.total);

            // Update chart
            window.scrapByLineChart.data.labels = labels;
            window.scrapByLineChart.data.datasets[0].data = values;
            window.scrapByLineChart.update('none');
        }
    } catch (error) {
        console.error('Failed to fetch scrap by line:', error);
    }
}

// Fetch and render quality metrics from waste/trends summary
async function fetchQualityMetrics() {
    try {
        const response = await fetch('/api/waste/trends');
        const data = await response.json();

        const grid = document.getElementById('quality-grid');
        if (!grid || !data.summary) return;

        // Enterprise display mapping
        const enterpriseNames = {
            'Enterprise A': { short: 'ENT A', industry: 'Glass Mfg' },
            'Enterprise B': { short: 'ENT B', industry: 'Beverage' },
            'Enterprise C': { short: 'ENT C', industry: 'Pharma' }
        };

        // Thresholds for color coding (based on average waste per hour)
        const getStatus = (avg, enterprise) => {
            // Different thresholds per enterprise type
            if (enterprise === 'Enterprise C') {
                // Pharma - very low tolerance
                if (avg < 50) return 'good';
                if (avg < 100) return 'warning';
                return 'critical';
            } else if (enterprise === 'Enterprise B') {
                // Beverage - moderate volume
                if (avg < 50000) return 'good';
                if (avg < 100000) return 'warning';
                return 'critical';
            } else {
                // Glass - high volume acceptable
                if (avg < 500000) return 'good';
                if (avg < 750000) return 'warning';
                return 'critical';
            }
        };

        // Trend arrows
        const trendArrow = (trend) => {
            switch(trend) {
                case 'rising': return '↑';
                case 'falling': return '↓';
                default: return '→';
            }
        };

        // Format large numbers
        const formatNumber = (num) => {
            if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
            if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
            return num.toFixed(0);
        };

        let html = '';
        ['Enterprise A', 'Enterprise B', 'Enterprise C'].forEach(enterprise => {
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
        console.error('Failed to fetch quality metrics:', error);
        const grid = document.getElementById('quality-grid');
        if (grid) {
            grid.innerHTML = '<div class="heatmap-loading">Failed to load quality metrics</div>';
        }
    }
}

// Fetch factory status and render production heatmap
async function fetchFactoryStatus() {
    try {
        const response = await fetch('/api/factory/status');
        const data = await response.json();

        if (data.enterprises) {
            renderProductionHeatmap(data.enterprises);
        }
    } catch (error) {
        console.error('Failed to fetch factory status:', error);
        const container = document.getElementById('production-heatmap');
        if (container) {
            container.innerHTML = '<div class="heatmap-loading">Failed to load factory status</div>';
        }
    }
}

// Render the production heatmap with enterprise and site hierarchy
function renderProductionHeatmap(enterprises) {
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

// Connect to WebSocket backend
function connectWebSocket() {
    console.log('🔌 Connecting to backend...');

    // Clean up existing WebSocket to prevent memory leaks
    if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close();
        }
    }

    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
        console.log('✅ Connected to backend!');
        isConnected = true;
        updateConnectionStatus(true);

        if (reconnectInterval) {
            clearInterval(reconnectInterval);
            reconnectInterval = null;
        }

        // Update system status
        document.getElementById('system-status').textContent = '● SYSTEM ONLINE';
        document.getElementById('agent-state').textContent = '● Monitoring factory data streams';
    };

    ws.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            handleServerMessage(message);
        } catch (error) {
            console.error('Failed to parse server message:', error);
        }
    };

    ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
    };

    ws.onclose = () => {
        console.log('🔌 Disconnected from backend');
        isConnected = false;
        updateConnectionStatus(false);
        document.getElementById('system-status').textContent = '● RECONNECTING...';

        // Attempt to reconnect
        if (!reconnectInterval) {
            reconnectInterval = setInterval(() => {
                console.log('🔄 Attempting to reconnect...');
                connectWebSocket();
            }, 5000);
        }
    };
}

// Handle different message types from backend
function handleServerMessage(message) {
    console.log('📨 Received:', message.type);

    switch (message.type) {
        case 'initial_state':
            // Initial data when connecting
            let messages = message.data.recentMessages || [];

            // Filter by selected enterprise
            if (state.selectedFactory !== 'ALL') {
                messages = messages.filter(msg => {
                    const topic = msg.topic || '';
                    const match = topic.match(/^Enterprise ([ABC])\//i);
                    return match && match[1].toUpperCase() === state.selectedFactory;
                });
            }

            state.messages = messages;
            state.insights = message.data.recentInsights || [];
            state.anomalies = message.data.recentAnomalies || [];
            state.stats = message.data.stats || state.stats;

            // Load anomaly filters from server
            if (message.data.anomalyFilters && Array.isArray(message.data.anomalyFilters)) {
                state.anomalyFilters = message.data.anomalyFilters;
                renderActiveFilters();
            }

            // Load threshold settings from server
            if (message.data.thresholdSettings) {
                state.thresholdSettings = message.data.thresholdSettings;
            }

            updateUI();

            // Show sleeping agent message if insights are disabled
            if (message.data.insightsEnabled === false) {
                const copilotContainer = document.getElementById('claude-insights-container');
                if (copilotContainer) {
                    const randomMsg = SLEEPING_AGENT_MESSAGES[Math.floor(Math.random() * SLEEPING_AGENT_MESSAGES.length)];
                    const sleepingDiv = document.createElement('div');
                    sleepingDiv.className = 'agent-insights';
                    sleepingDiv.style.borderLeftColor = 'var(--accent-amber)';
                    sleepingDiv.innerHTML = `
                        <div class="insight-text" style="opacity: 0.85; font-style: italic;">
                            😴 ${randomMsg}
                        </div>
                        <div class="insight-meta">
                            AI Insights: Disabled • MQTT data collection active
                        </div>
                    `;
                    copilotContainer.innerHTML = '';
                    copilotContainer.appendChild(sleepingDiv);
                }

                // Update agent state
                const agentState = document.getElementById('agent-state');
                if (agentState) {
                    agentState.textContent = '● Data collection only (insights disabled)';
                }
            }

            // Fetch persistent measurement count from server schema cache
            fetchActiveSensorCount();
            break;

        case 'mqtt_message':
            // Real-time MQTT message
            const topic = message.data.topic || '';

            // Filter by selected enterprise
            if (state.selectedFactory !== 'ALL') {
                // Topics start with "Enterprise A/", "Enterprise B/", or "Enterprise C/"
                const enterpriseMatch = topic.match(/^Enterprise ([ABC])\//i);
                if (!enterpriseMatch || enterpriseMatch[1].toUpperCase() !== state.selectedFactory) {
                    return; // Skip messages not matching filter
                }
            }

            state.messages.push(message.data);
            state.stats.messageCount++;
            messagesSinceLastRate++;
            if (state.messages.length > 100) {
                state.messages.shift();
            }

            // Track unique measurements (not full topics, to match server schema)
            const measurement = topicToMeasurement(message.data.topic);
            state.uniqueTopics.add(measurement);

            // Track enterprise counts for distribution chart
            const entMatch = topic.match(/^(Enterprise [ABC])\//i);
            if (entMatch) {
                const enterprise = entMatch[1];
                state.enterpriseCounts[enterprise] = (state.enterpriseCounts[enterprise] || 0) + 1;
            }

            addMQTTMessageToStream(message.data);
            updateMetrics();
            break;

        case 'claude_insight':
        case 'trend_insight':
            // Claude AI analysis result (supports both old and new format)
            state.insights.push(message.data);
            if (state.insights.length > 10) {
                state.insights.shift();
            }
            addClaudeInsight(message.data);

            // Update anomaly count
            if (message.data.anomalies && message.data.anomalies.length > 0) {
                state.stats.anomalyCount += message.data.anomalies.length;
                updateMetrics();
            }
            break;

        case 'claude_response':
            // Response to direct question
            displayClaudeResponse(message.data);
            break;

        case 'equipment_state':
            // Real-time equipment state update
            updateEquipmentState(message.data);
            break;

        case 'anomaly_filter_update':
            // Anomaly filter rules updated from another client or server
            if (message.data && Array.isArray(message.data.filters)) {
                state.anomalyFilters = message.data.filters;
                renderActiveFilters();
            }
            break;

        case 'settings_updated':
            // Threshold settings updated from another client or server
            if (message.data) {
                state.thresholdSettings = message.data;
                console.log('[SETTINGS] Synced from server:', message.data);
            }
            break;
    }
}

// Fetch equipment states from API
async function fetchEquipmentStates() {
    try {
        const response = await fetch('/api/equipment/states');
        const data = await response.json();

        if (data.states && Array.isArray(data.states)) {
            // Populate equipment states map
            state.equipmentStates.clear();
            data.states.forEach(equipment => {
                // Map API response to expected format
                // API returns: enterprise, site, machine, state, stateName, color, reason
                // Frontend expects: id, name, state
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

            // Update summary counts from API response
            if (data.summary) {
                const runningEl = document.getElementById('state-running');
                const idleEl = document.getElementById('state-idle');
                const downEl = document.getElementById('state-down');
                if (runningEl) runningEl.textContent = data.summary.running || 0;
                if (idleEl) idleEl.textContent = data.summary.idle || 0;
                if (downEl) downEl.textContent = data.summary.down || 0;
            }

            // Update the equipment state grid
            updateEquipmentStateGrid();
        }
    } catch (error) {
        console.error('Failed to fetch equipment states:', error);
        const grid = document.getElementById('equipment-state-grid');
        if (grid) {
            grid.innerHTML = '<div class="heatmap-loading">Failed to load equipment states</div>';
        }
    }
}

// Update equipment state from WebSocket message
function updateEquipmentState(data) {
    if (data.id && data.state) {
        state.equipmentStates.set(data.id, data);
        updateEquipmentStateGrid();
    }
}

// Render equipment state grid
function updateEquipmentStateGrid() {
    const grid = document.getElementById('equipment-state-grid');
    if (!grid) return;

    const states = Array.from(state.equipmentStates.values());

    if (states.length === 0) {
        grid.innerHTML = '<div class="heatmap-loading">No equipment data available</div>';
        return;
    }

    // Sort: DOWN first, then IDLE, then RUNNING (most critical on top)
    const sortOrder = { 'DOWN': 0, 'IDLE': 1, 'RUNNING': 2 };
    states.sort((a, b) => {
        const orderA = sortOrder[a.state.toUpperCase()] ?? 3;
        const orderB = sortOrder[b.state.toUpperCase()] ?? 3;
        return orderA - orderB;
    });

    // Count states
    let runningCount = 0;
    let idleCount = 0;
    let downCount = 0;

    states.forEach(equipment => {
        const state = equipment.state.toUpperCase();
        if (state === 'RUNNING') runningCount++;
        else if (state === 'IDLE') idleCount++;
        else if (state === 'DOWN') downCount++;
    });

    // Update summary counts
    document.getElementById('state-running').textContent = runningCount;
    document.getElementById('state-idle').textContent = idleCount;
    document.getElementById('state-down').textContent = downCount;

    // Render equipment cards
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

// Fetch line OEE from API
async function fetchLineOEE(enterprise = 'ALL') {
    try {
        const response = await fetch('/api/oee/lines');
        const data = await response.json();

        if (data.lines && Array.isArray(data.lines)) {
            // Filter by enterprise on client side (server returns all data)
            let filteredLines = data.lines;
            if (enterprise && enterprise !== 'ALL') {
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
        console.error('Failed to fetch line OEE:', error);
        const grid = document.getElementById('line-oee-grid');
        if (grid) {
            grid.innerHTML = '<div class="heatmap-loading">Failed to load line OEE</div>';
        }
    }
}

// Render line OEE grid
function renderLineOEEGrid(lines) {
    const grid = document.getElementById('line-oee-grid');
    if (!grid) return;

    if (lines.length === 0) {
        grid.innerHTML = '<div class="heatmap-loading">No lines available for selected enterprise</div>';
        return;
    }

    grid.innerHTML = lines.map(line => {
        const oee = line.oee || 0;
        let statusClass = 'critical';
        if (oee >= 85) statusClass = 'healthy';
        else if (oee >= 70) statusClass = 'warning';

        // Construct line name from available fields
        // API returns: enterprise, site, line (area), oee
        const lineName = line.name || `${line.site} - ${line.line || 'Line'}`;

        // Format breakdown - always show A/P/Q labels with "--" when unavailable
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

// Handle line enterprise selector change
function handleLineEnterpriseChange() {
    const selector = document.getElementById('line-enterprise-select');
    if (selector) {
        state.selectedLineEnterprise = selector.value;
        fetchLineOEE(state.selectedLineEnterprise);
    }
}

// Update connection status indicator
function updateConnectionStatus(connected) {
    const badge = document.getElementById('live-badge');
    const mqttIndicator = document.getElementById('mqtt-indicator');
    const claudeIndicator = document.getElementById('claude-indicator');
    const dataIndicator = document.getElementById('data-indicator');

    if (connected) {
        badge.textContent = '● LIVE';
        badge.style.borderColor = 'var(--accent-green)';
        badge.style.color = 'var(--accent-green)';
        badge.style.background = 'rgba(0, 255, 136, 0.2)';

        mqttIndicator.classList.remove('disconnected');
        claudeIndicator.classList.remove('disconnected');
        dataIndicator.classList.remove('disconnected');
    } else {
        badge.textContent = '● DISCONNECTED';
        badge.style.borderColor = 'var(--accent-red)';
        badge.style.color = 'var(--accent-red)';
        badge.style.background = 'rgba(255, 0, 0, 0.2)';

        mqttIndicator.classList.add('disconnected');
        claudeIndicator.classList.add('disconnected');
        dataIndicator.classList.add('disconnected');
    }
}

// Helper function to escape HTML and prevent XSS attacks
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Add MQTT message to the stream display
function addMQTTMessageToStream(message) {
    // Don't add messages when stream is paused
    if (state.streamPaused) return;

    const stream = document.getElementById('mqtt-stream');
    if (!stream) return;

    // Clear "waiting" message on first real message
    if (state.stats.messageCount === 1) {
        stream.innerHTML = '';
    }

    const timestamp = new Date(message.timestamp).toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3
    });

    const line = document.createElement('div');
    line.className = 'stream-line';

    // Add data attributes for filtering
    const topic = message.topic.toLowerCase();
    let eventType = 'other';
    if (topic.includes('oee')) eventType = 'oee';
    else if (topic.includes('state')) eventType = 'state';
    else if (topic.includes('alarm')) eventType = 'alarm';

    line.setAttribute('data-event-type', eventType);

    // Use escapeHtml to prevent XSS attacks on user-controlled content
    const escapedTopic = escapeHtml(message.topic);
    const escapedPayload = typeof message.payload === 'object'
        ? escapeHtml(JSON.stringify(message.payload))
        : escapeHtml(String(message.payload));

    line.innerHTML = `
        <span class="stream-timestamp">[${timestamp}]</span>
        <span class="stream-topic">${escapedTopic}</span>
        <span class="stream-value">${escapedPayload}</span>
    `;

    // Check if user is at bottom before adding new message
    // Use tighter threshold: within 10px = user is at bottom
    const isAtBottom = stream.scrollHeight - stream.scrollTop <= stream.clientHeight + 10;

    stream.appendChild(line);

    // Only trim old messages when user is at bottom (not reading history)
    // Allow buffer to grow to 200 while scrolled up, trim to 50 when back at bottom
    const maxWhileScrolled = 200;
    const normalMax = 50;

    if (isAtBottom) {
        // User is at bottom - trim to normal size and auto-scroll
        while (stream.children.length > normalMax) {
            stream.removeChild(stream.firstChild);
        }
        stream.scrollTop = stream.scrollHeight;
    } else {
        // User is scrolled up reading - only trim if buffer gets too large
        while (stream.children.length > maxWhileScrolled) {
            stream.removeChild(stream.firstChild);
        }
    }
}

// Add Claude insight to the AI agent panel
function addClaudeInsight(insight) {
    // Extract anomalies from insight - supports both old (string) and new (object) formats
    if (insight.anomalies && Array.isArray(insight.anomalies)) {
        insight.anomalies.forEach(anomalyData => {
            // Handle both string format (old) and object format (new)
            if (typeof anomalyData === 'string') {
                // Old format: anomaly is just a string
                state.anomalies.push({
                    text: anomalyData,
                    timestamp: insight.timestamp,
                    severity: insight.severity
                });
            } else if (typeof anomalyData === 'object') {
                // New format: anomaly is an object with description, reasoning, etc.
                state.anomalies.push({
                    text: anomalyData.description || 'Anomaly detected',
                    description: anomalyData.description,
                    reasoning: anomalyData.reasoning,
                    metric: anomalyData.metric,
                    enterprise: anomalyData.enterprise,
                    actual_value: anomalyData.actual_value,
                    threshold: anomalyData.threshold,
                    timestamp: insight.timestamp,
                    severity: anomalyData.severity || insight.severity
                });
            }
        });
        // Keep only last 50 anomalies
        while (state.anomalies.length > 50) {
            state.anomalies.shift();
        }
        // Update anomaly tab counter
        const tabCount = document.getElementById('anomaly-tab-count');
        if (tabCount) {
            tabCount.textContent = state.anomalies.length;
        }
        // Update active alerts in scorecard
        updateActiveAlerts();
    }

    // Only add to container if we're in 'all' view
    if (state.insightFilter !== 'all') return;

    const container = document.getElementById('claude-insights-container');
    if (!container) return;

    const insightEl = document.createElement('div');
    insightEl.className = 'agent-insights';

    const severityColor = {
        'low': 'var(--accent-cyan)',
        'medium': 'var(--accent-amber)',
        'high': 'var(--accent-red)'
    }[insight.severity] || 'var(--accent-cyan)';

    insightEl.style.borderLeftColor = severityColor;

    // Support both old format (insight) and new format (summary)
    const insightText = insight.summary || insight.insight || 'No insight available';
    const dataInfo = insight.dataPoints ? `${insight.dataPoints} data points` : `${insight.messagesAnalyzed || 0} messages`;

    // Show anomaly count in insight if present
    const anomalyInfo = insight.anomalies && insight.anomalies.length > 0
        ? `<span style="color: var(--accent-red)">⚠ ${insight.anomalies.length} anomalies</span> • `
        : '';

    // Escape user-controlled content to prevent XSS
    const escapedInsightText = escapeHtml(insightText);
    const escapedConfidence = escapeHtml(String(insight.confidence || 'N/A'));
    const escapedSeverity = escapeHtml(String(insight.severity));

    insightEl.innerHTML = `
        <div class="insight-text">${escapedInsightText}</div>
        <div class="insight-meta">
            ${anomalyInfo}Confidence: ${escapedConfidence} •
            Priority: ${escapedSeverity} •
            Analyzed ${dataInfo} •
            ${new Date(insight.timestamp).toLocaleTimeString()}
        </div>
    `;

    container.insertBefore(insightEl, container.firstChild);

    // Keep only last 5 insights visible
    while (container.children.length > 5) {
        container.removeChild(container.lastChild);
    }
}

// Extract measurement name from MQTT topic (matches server logic)
function topicToMeasurement(topic) {
    const parts = topic.split('/');
    if (parts.length >= 2) {
        return parts.slice(-2).join('_').replace(/[^a-zA-Z0-9_]/g, '_');
    }
    return topic.replace(/[^a-zA-Z0-9_]/g, '_');
}

// Fetch active sensor count from server schema cache
async function fetchActiveSensorCount() {
    try {
        const response = await fetch('/api/schema/measurements');
        const data = await response.json();

        if (data.measurements && Array.isArray(data.measurements)) {
            // Pre-populate uniqueTopics Set with known measurements from server
            // This preserves the persistent count across page loads
            data.measurements.forEach(measurement => {
                state.uniqueTopics.add(measurement.name);
            });

            // Update display
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

// Update metrics display
function updateMetrics() {
    // Update message count
    const msgCount = document.getElementById('message-count');
    if (msgCount) {
        msgCount.textContent = state.stats.messageCount.toLocaleString();
    }

    // Update active sensors count
    const activeSensors = document.getElementById('active-sensors');
    if (activeSensors) {
        activeSensors.textContent = state.uniqueTopics.size.toLocaleString();
    }

    // Update anomaly count from state.anomalies
    const anomalyCount = document.getElementById('anomaly-count');
    if (anomalyCount) {
        anomalyCount.textContent = state.anomalies.length;
    }
}

// Calculate and display message rate
function updateMessageRate() {
    const now = Date.now();
    const elapsed = (now - lastMessageTime) / 1000;

    if (elapsed >= 1) {
        messageRate = Math.round(messagesSinceLastRate / elapsed);
        messagesSinceLastRate = 0;
        lastMessageTime = now;

        // Store in history for chart
        state.messageRateHistory.push(messageRate);
        if (state.messageRateHistory.length > 20) {
            state.messageRateHistory.shift();
        }

        const rateEl = document.getElementById('data-rate');
        if (rateEl) {
            rateEl.textContent = `${messageRate} msg/sec`;
        }

        // Update charts
        updateCharts();
    }
}

// Initial UI update
function updateUI() {
    // Clear stream
    const stream = document.getElementById('mqtt-stream');
    if (stream) stream.innerHTML = '';

    // Display recent messages
    state.messages.forEach(msg => addMQTTMessageToStream(msg));

    // Clear insights container
    const container = document.getElementById('claude-insights-container');
    if (container) container.innerHTML = '';

    // Display recent insights
    state.insights.forEach(insight => addClaudeInsight(insight));

    // Update metrics
    updateMetrics();
}

// Ask Claude a question
function askClaude(question) {
    if (!isConnected) {
        alert('Not connected to backend!');
        return;
    }

    ws.send(JSON.stringify({
        type: 'ask_claude',
        question: question
    }));
}

// Display Claude's response to a question
function displayClaudeResponse(data) {
    console.log('Claude says:', data.answer);
    alert(`Q: ${data.question}\n\nA: ${data.answer}`);
}

// Factory selection
function selectFactory(factory) {
    state.selectedFactory = factory;
    document.querySelectorAll('.factory-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.closest('.factory-btn').classList.add('active');

    // Clear filtered data but preserve sensor count
    state.messages = [];
    // Don't clear uniqueTopics - keep cumulative sensor count
    state.enterpriseCounts = { 'Enterprise A': 0, 'Enterprise B': 0, 'Enterprise C': 0 };

    // Reset charts
    if (window.healthChart) {
        window.healthChart.data.datasets[0].data = [0, 0, 0];
        window.healthChart.update();
    }

    // Fetch fresh OEE and breakdown for selected enterprise
    fetchOEE();
    fetchOEEBreakdown();

    // Update metrics display
    updateMetrics();

    console.log('Filtering by factory:', factory);
}

// Fetch OEE from API (24h average)
async function fetchOEE() {
    try {
        const enterprise = state.selectedFactory;
        const response = await fetch(`/api/oee?enterprise=${enterprise}`);
        const data = await response.json();

        const oeeScore = document.getElementById('oee-score');
        const oeeStatus = document.getElementById('oee-status');

        if (data.average !== null) {
            oeeScore.textContent = data.average.toFixed(1) + '%';
            oeeStatus.textContent = `${data.period} avg • ${enterprise === 'ALL' ? 'All' : enterprise}`;
            oeeStatus.className = 'metric-change positive';

            // Update scorecard gauge
            updateOEEGauge(data.average);
        } else {
            oeeScore.textContent = '--';
            oeeStatus.textContent = 'No OEE data available';
            oeeStatus.className = 'metric-change';
            updateOEEGauge(0);
        }
    } catch (error) {
        console.error('Failed to fetch OEE:', error);
        document.getElementById('oee-status').textContent = 'API error';
        updateOEEGauge(0);
    }
}

// Update OEE gauge visualization
function updateOEEGauge(oeePercent) {
    const gaugeValue = document.getElementById('scorecard-oee-value');
    const gaugeFill = document.getElementById('oee-gauge-fill');

    if (!gaugeValue || !gaugeFill) return;

    // Update text
    gaugeValue.textContent = oeePercent > 0 ? oeePercent.toFixed(1) + '%' : '--';

    // Calculate stroke-dashoffset (502.65 = circumference of r=80 circle)
    const circumference = 502.65;
    const offset = circumference - (oeePercent / 100) * circumference;
    gaugeFill.style.strokeDashoffset = offset;

    // Color based on OEE thresholds
    let color = 'var(--accent-red)';
    if (oeePercent >= 80) {
        color = 'var(--accent-green)';
    } else if (oeePercent >= 60) {
        color = 'var(--accent-amber)';
    }
    gaugeFill.style.stroke = color;
    gaugeValue.style.color = color;
}

// Update active alerts from Claude anomalies
function updateActiveAlerts() {
    const alertsList = document.getElementById('active-alerts-list');
    if (!alertsList) return;

    // Get recent anomalies (last 5)
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

    // Render anomalies as alerts
    alertsList.innerHTML = recentAnomalies.map(anomaly => {
        const severity = anomaly.severity || 'medium';
        const severityColors = {
            'high': 'var(--accent-red)',
            'medium': 'var(--accent-amber)',
            'low': 'var(--accent-cyan)'
        };
        const severityColor = severityColors[severity];
        const alertClass = severity === 'high' ? '' : severity === 'medium' ? 'warning' : 'info';

        // Escape user-controlled content to prevent XSS
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

// Filter insights by type

// Anomaly Modal Functions
function openAnomalyModal(anomaly) {
    const overlay = document.getElementById('anomaly-modal-overlay');
    const textEl = document.getElementById('anomaly-modal-text');
    const severityEl = document.getElementById('anomaly-modal-severity');
    const timestampEl = document.getElementById('anomaly-modal-timestamp');
    const reasoningEl = document.getElementById('anomaly-modal-reasoning');

    if (!overlay || !textEl || !severityEl || !timestampEl) return;

    // Populate modal with static snapshot of anomaly data
    textEl.textContent = anomaly.text || anomaly.description || 'No description available';

    // Display reasoning if available
    if (reasoningEl) {
        if (anomaly.reasoning) {
            // Build detailed reasoning display
            let reasoningHtml = `<div class="reasoning-text">${anomaly.reasoning}</div>`;

            // Add metric details if available
            if (anomaly.metric || anomaly.actual_value || anomaly.threshold) {
                reasoningHtml += '<div class="reasoning-details">';
                if (anomaly.enterprise) {
                    reasoningHtml += `<div class="reasoning-item"><span class="reasoning-label">Enterprise:</span> ${anomaly.enterprise}</div>`;
                }
                if (anomaly.metric) {
                    reasoningHtml += `<div class="reasoning-item"><span class="reasoning-label">Metric:</span> ${anomaly.metric}</div>`;
                }
                if (anomaly.actual_value) {
                    reasoningHtml += `<div class="reasoning-item"><span class="reasoning-label">Actual Value:</span> ${anomaly.actual_value}</div>`;
                }
                if (anomaly.threshold) {
                    reasoningHtml += `<div class="reasoning-item"><span class="reasoning-label">Threshold:</span> ${anomaly.threshold}</div>`;
                }
                reasoningHtml += '</div>';
            }
            reasoningEl.innerHTML = reasoningHtml;
            reasoningEl.style.display = 'block';
        } else {
            reasoningEl.innerHTML = '<div class="reasoning-text reasoning-unavailable">Reasoning not available for this anomaly</div>';
            reasoningEl.style.display = 'block';
        }
    }

    // Format severity badge
    const severity = anomaly.severity || 'medium';
    const severityUpper = severity.toUpperCase();
    severityEl.innerHTML = '<span class="anomaly-modal-severity ' + severity + '">' + severityUpper + '</span>';

    // Format timestamp
    const date = new Date(anomaly.timestamp);
    const formattedDate = date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    timestampEl.textContent = formattedDate;

    // Show modal
    overlay.classList.add('active');
}

function closeAnomalyModal() {
    const overlay = document.getElementById('anomaly-modal-overlay');
    if (overlay) {
        overlay.classList.remove('active');
    }
}

// Settings Modal Functions
function openSettingsModal() {
    const overlay = document.getElementById('settings-modal-overlay');
    if (!overlay) return;

    // Populate inputs with current values
    document.getElementById('setting-oeeBaseline').value = state.thresholdSettings.oeeBaseline;
    document.getElementById('setting-oeeWorldClass').value = state.thresholdSettings.oeeWorldClass;
    document.getElementById('setting-availabilityMin').value = state.thresholdSettings.availabilityMin;
    document.getElementById('setting-defectRateWarning').value = state.thresholdSettings.defectRateWarning;
    document.getElementById('setting-defectRateCritical').value = state.thresholdSettings.defectRateCritical;

    overlay.classList.add('active');
}

function closeSettingsModal() {
    const overlay = document.getElementById('settings-modal-overlay');
    if (overlay) {
        overlay.classList.remove('active');
    }
}

async function saveSettings() {
    const settings = {
        oeeBaseline: parseFloat(document.getElementById('setting-oeeBaseline').value),
        oeeWorldClass: parseFloat(document.getElementById('setting-oeeWorldClass').value),
        availabilityMin: parseFloat(document.getElementById('setting-availabilityMin').value),
        defectRateWarning: parseFloat(document.getElementById('setting-defectRateWarning').value),
        defectRateCritical: parseFloat(document.getElementById('setting-defectRateCritical').value)
    };

    // Validate
    for (const [key, value] of Object.entries(settings)) {
        if (isNaN(value) || value < 0 || value > 100) {
            alert(`Invalid ${key}: must be a number between 0-100`);
            return;
        }
    }

    try {
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });

        if (!response.ok) {
            throw new Error('Failed to save settings');
        }

        const updatedSettings = await response.json();
        state.thresholdSettings = updatedSettings;
        closeSettingsModal();
        console.log('[SETTINGS] Saved:', updatedSettings);
    } catch (error) {
        console.error('Error saving settings:', error);
        alert('Failed to save settings. Please try again.');
    }
}

// Setup modal event listeners when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Close button click
    const closeBtn = document.getElementById('close-anomaly-modal');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeAnomalyModal);
    }

    // Click outside modal to close
    const overlay = document.getElementById('anomaly-modal-overlay');
    if (overlay) {
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) {
                closeAnomalyModal();
            }
        });
    }

    // Escape key to close modals
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeAnomalyModal();
            closeSettingsModal();
        }
    });

    // Settings modal - click outside to close
    const settingsOverlay = document.getElementById('settings-modal-overlay');
    if (settingsOverlay) {
        settingsOverlay.addEventListener('click', function(e) {
            if (e.target === settingsOverlay) {
                closeSettingsModal();
            }
        });
    }
});
function filterInsights(filterType, clickedTab) {
    state.insightFilter = filterType;

    // Update tab styling
    document.querySelectorAll('.insight-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    if (clickedTab) clickedTab.classList.add('active');

    // Re-render insights
    const container = document.getElementById('claude-insights-container');
    if (!container) return;
    container.innerHTML = '';

    if (filterType === 'anomalies') {
        // Show only anomalies
        if (state.anomalies.length === 0) {
            container.innerHTML = `
                <div class="agent-insights">
                    <div class="insight-text">No anomalies detected yet.</div>
                    <div class="insight-meta">Claude analyzes trends every 30 seconds</div>
                </div>
            `;
        } else {
            state.anomalies.forEach(anomaly => {
                const el = document.createElement('div');
                el.className = 'anomaly-item';

                // Escape user-controlled content to prevent XSS
                const escapedText = escapeHtml(anomaly.text);

                el.innerHTML = `
                    <div>${escapedText}</div>
                    <div class="anomaly-time">${new Date(anomaly.timestamp).toLocaleTimeString()}</div>
                `;
                // Add click handler to open modal with static anomaly snapshot
                el.addEventListener('click', () => openAnomalyModal(anomaly));
                container.appendChild(el);
            });
        }
    } else {
        // Show all insights
        if (state.insights.length === 0) {
            container.innerHTML = `
                <div class="agent-insights">
                    <div class="insight-text">Waiting for data to analyze...</div>
                    <div class="insight-meta">Status: Standby</div>
                </div>
            `;
        } else {
            state.insights.forEach(insight => addClaudeInsight(insight));
        }
    }
}

// Add anomaly filter
function addAnomalyFilter() {
    const input = document.getElementById('anomaly-filter-input');
    if (!input) return;

    const filterRule = input.value.trim();
    if (!filterRule || filterRule.length === 0) {
        return;
    }

    // Check max filter limit
    if (state.anomalyFilters.length >= 10) {
        alert('Maximum 10 filter rules allowed');
        return;
    }

    // Add to state
    state.anomalyFilters.push(filterRule);
    input.value = '';

    // Update UI
    renderActiveFilters();

    // Send to backend via WebSocket
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'update_anomaly_filter',
            filters: state.anomalyFilters
        }));
    }
}

// Remove anomaly filter
function removeAnomalyFilter(index) {
    state.anomalyFilters.splice(index, 1);

    // Update UI
    renderActiveFilters();

    // Send to backend via WebSocket
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'update_anomaly_filter',
            filters: state.anomalyFilters
        }));
    }
}

// Render active filter chips
function renderActiveFilters() {
    const container = document.getElementById('active-filters');
    if (!container) return;

    if (state.anomalyFilters.length === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = state.anomalyFilters.map((filter, index) => `
        <div class="filter-chip">
            <span class="filter-chip-text" title="${filter}">${filter}</span>
            <span class="filter-chip-remove" onclick="removeAnomalyFilter(${index})">×</span>
        </div>
    `).join('');
}

// Handle Enter key in filter input
document.addEventListener('DOMContentLoaded', () => {
    const filterInput = document.getElementById('anomaly-filter-input');
    if (filterInput) {
        filterInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                addAnomalyFilter();
            }
        });
    }
});

// Filter events by type
function filterEvents(eventType, clickedTab) {
    state.eventFilter = eventType;

    // Update tab styling
    document.querySelectorAll('.event-tab:not(.pause-btn)').forEach(tab => {
        tab.classList.remove('active');
    });
    if (clickedTab) clickedTab.classList.add('active');

    // Show/hide events based on filter
    const stream = document.getElementById('mqtt-stream');
    if (!stream) return;

    const lines = stream.querySelectorAll('.stream-line');
    lines.forEach(line => {
        const lineEventType = line.getAttribute('data-event-type');
        if (eventType === 'all' || lineEventType === eventType) {
            line.style.display = '';
        } else {
            line.style.display = 'none';
        }
    });
}

// Toggle stream pause/resume
function toggleStreamPause() {
    state.streamPaused = !state.streamPaused;

    const pauseBtn = document.getElementById('stream-pause-btn');
    const pauseBtnText = document.getElementById('pause-btn-text');
    const stream = document.getElementById('mqtt-stream');

    if (state.streamPaused) {
        // Paused state
        pauseBtn.classList.add('paused');
        pauseBtnText.textContent = '▶ Resume';
        stream.classList.add('paused');
    } else {
        // Resumed state
        pauseBtn.classList.remove('paused');
        pauseBtnText.textContent = '⏸ Pause';
        stream.classList.remove('paused');
    }
}

// Initialize connection on page load
window.addEventListener('load', () => {
    console.log('🚀 Initializing EdgeMind...');

    // Initialize charts first
    initializeCharts();

    // Then connect to backend
    connectWebSocket();

    // Fetch initial OEE, breakdown, and factory status
    fetchOEE();
    fetchOEEBreakdown();
    fetchFactoryStatus();
    fetchWasteTrends();
    fetchScrapByLine();
    fetchQualityMetrics();

    // Fetch equipment states and line OEE
    fetchEquipmentStates();
    fetchLineOEE(state.selectedLineEnterprise);

    // Update message rate every second
    setInterval(updateMessageRate, 1000);

    // Refresh OEE, breakdown, and factory status every 30 seconds
    setInterval(fetchOEE, 30000);
    setInterval(fetchOEEBreakdown, 30000);
    setInterval(fetchFactoryStatus, 30000);
    setInterval(fetchWasteTrends, 30000);
    setInterval(fetchScrapByLine, 30000);
    setInterval(fetchQualityMetrics, 30000);

    // Refresh equipment states and line OEE every 30 seconds
    setInterval(fetchEquipmentStates, 30000);
    setInterval(() => fetchLineOEE(state.selectedLineEnterprise), 30000);
});

// Expose askClaudeQuestion globally
window.askClaudeQuestion = function() {
    const question = prompt('Ask Claude about the factory:');
    if (question) {
        askClaude(question);
    }
};
