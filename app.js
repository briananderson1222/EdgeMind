// REAL IMPLEMENTATION - Connects to actual backend

// Format milliseconds to human readable duration
function formatStateDuration(ms) {
    if (!ms || ms < 0) return null;
    const secs = Math.floor(ms / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ${mins % 60}m`;
}

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
    selectedFactory: 'ALL',  // 'ALL', 'Enterprise A', 'Enterprise B', or 'Enterprise C'
    insightFilter: 'all',  // 'all' or 'anomalies'
    eventFilter: 'all',  // 'all', 'oee', 'state', 'alarm'
    equipmentStates: new Map(),  // Map of equipment ID to state
    activeAlarms: new Map(),  // Map of alarm ID to alarm state
    energyReadings: new Map(),  // Map of panel to power readings
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

function getActiveAlarms() {
    return Array.from(state.activeAlarms.values()).filter(a => a.active);
}

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
        // Hide chart if filtering to single enterprise
        const oeeBreakdownContainer = document.getElementById('oee-breakdown-chart');
        const chartCard = oeeBreakdownContainer ? oeeBreakdownContainer.closest('.card') : null;
        if (chartCard && state.selectedFactory !== 'ALL') {
            chartCard.style.display = 'none';
            return;
        } else if (chartCard) {
            chartCard.style.display = '';
        }

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
        const enterprise = getEnterpriseParam();
        const url = enterprise !== 'ALL'
            ? `/api/waste/trends?enterprise=${encodeURIComponent(enterprise)}`
            : '/api/waste/trends';
        const response = await fetch(url);
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
        const enterprise = getEnterpriseParam();
        const url = enterprise !== 'ALL'
            ? `/api/waste/by-line?enterprise=${encodeURIComponent(enterprise)}`
            : '/api/waste/by-line';
        const response = await fetch(url);
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
        const enterprise = getEnterpriseParam();
        const url = enterprise !== 'ALL'
            ? `/api/waste/trends?enterprise=${encodeURIComponent(enterprise)}`
            : '/api/waste/trends';
        const response = await fetch(url);
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
        const enterprise = getEnterpriseParam();
        const url = enterprise !== 'ALL'
            ? `/api/factory/status?enterprise=${encodeURIComponent(enterprise)}`
            : '/api/factory/status';

        const response = await fetch(url);
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
            const enterprise = getEnterpriseParam();
            if (enterprise !== 'ALL') {
                messages = messages.filter(msg => {
                    const topic = msg.topic || '';
                    return topic.startsWith(enterprise + '/');
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
            const mqttEnterprise = getEnterpriseParam();
            if (mqttEnterprise !== 'ALL') {
                // Topics start with "Enterprise A/", "Enterprise B/", or "Enterprise C/"
                if (!topic.startsWith(mqttEnterprise + '/')) {
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

            // Handle alarm messages
            if (message.data.type === 'alarm') {
                handleAlarmMessage(message.data);
            }

            // Handle energy messages
            if (message.data.type === 'energy') {
                handleEnergyMessage(message.data);
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
        const enterprise = getEnterpriseParam();
        const url = enterprise !== 'ALL'
            ? `/api/equipment/states?enterprise=${encodeURIComponent(enterprise)}`
            : '/api/equipment/states';
        const response = await fetch(url);
        const data = await response.json();

        if (data.states && Array.isArray(data.states)) {
            // Populate equipment states map
            state.equipmentStates.clear();
            data.states.forEach(equipment => {
                state.equipmentStates.set(equipment.id, equipment);
            });

            // Update summary counts from API response
            if (data.summary) {
                document.getElementById('state-running').textContent = data.summary.running || 0;
                document.getElementById('state-idle').textContent = data.summary.idle || 0;
                document.getElementById('state-down').textContent = data.summary.down || 0;
                document.getElementById('state-unknown').textContent = data.summary.unknown || 0;
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

// Local state history tracking (per equipment)
const localStateHistory = new Map(); // equipmentId -> [{time, status, reason}]

// Update equipment state from WebSocket message
function updateEquipmentState(data) {
    if (!data.id) return;
    
    const key = data.id;
    const previous = state.equipmentStates.get(key);
    const prevStateName = previous?.status?.toUpperCase();
    const newStateName = data.status.toString().toUpperCase();
    
    // Track when state changed (frontend-side) - only reset if actual state change
    if (newStateName && prevStateName && prevStateName !== newStateName) {
        data.stateChangedAt = Date.now();
        
        // Add to local history
        if (!localStateHistory.has(key)) localStateHistory.set(key, []);
        const history = localStateHistory.get(key);
        history.unshift({
            time: new Date().toISOString(),
            status: data.status?.toLowerCase() || 'unknown',
            reason: data.reason || data.status || 'Unknown'
        });
        if (history.length > 20) history.pop(); // Keep last 20
    } else {
        data.stateChangedAt = previous?.stateChangedAt || data.stateChangedAt || Date.now();
    }
    
    state.equipmentStates.set(key, data);
    updateEquipmentStateGrid();
    
    // Update modal if open for this equipment
    if (currentEquipmentModalId === key) {
        updateEquipmentModalRealtime(data);
    }
    
    // Detect transition TO down state
    if (newStateName === 'DOWN' && prevStateName !== 'DOWN') {
        onEquipmentDown(data);
    }
    // Update toast when equipment recovers
    else if (prevStateName === 'DOWN' && newStateName !== 'DOWN') {
        renderDownToasts();
    }
}

function updateEquipmentModalRealtime(data) {
    const statusBadge = document.getElementById('modal-status-badge');
    const statusReason = document.getElementById('modal-status-reason');
    const historyEl = document.getElementById('equipment-modal-history');
    
    if (statusBadge) {
        const statusClass = (data.status || 'unknown').toLowerCase();
        statusBadge.className = `status-badge ${statusClass}`;
        statusBadge.textContent = (data.status || 'unknown').toUpperCase();
    }
    if (statusReason) {
        statusReason.textContent = data.reason || '';
    }
    
    // Prepend to history if we have local history
    const history = localStateHistory.get(data.id);
    if (history && history.length > 0 && historyEl) {
        const timeline = historyEl.querySelector('.state-timeline');
        if (timeline) {
            const latest = history[0];
            const timeStr = new Date(latest.time).toLocaleTimeString('en-US', {
                hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3
            });
            const newEntry = document.createElement('div');
            newEntry.className = `state-entry ${latest.status}`;
            newEntry.innerHTML = `
                <span class="state-time">${timeStr}</span>
                <span class="state-status">${latest.status.toUpperCase()}</span>
                <span class="state-reason">${latest.reason}</span>
            `;
            const firstEntry = timeline.querySelector('.state-entry');
            if (firstEntry) {
                timeline.insertBefore(newEntry, firstEntry);
            } else {
                timeline.appendChild(newEntry);
            }
        }
    }
}

function onEquipmentDown(equipment) {
    showDownToast();
    
    // Dispatch event for other components
    window.dispatchEvent(new CustomEvent('equipmentDown', { detail: equipment }));
}

// Down equipment toast management
let toastContainer = null;
let toastClearTimer = null;
let toastExpanded = false;

function getToastContainer() {
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.className = 'toast-container';
        document.body.appendChild(toastContainer);
    }
    return toastContainer;
}

function showDownToast() {
    clearTimeout(toastClearTimer);
    toastClearTimer = setTimeout(() => {
        const container = getToastContainer();
        const existing = container.querySelector('.toast-group');
        if (existing) existing.remove();
        toastExpanded = false;
    }, 15000);
    renderDownToasts();
}

function getDownEquipment() {
    const down = [];
    state.equipmentStates.forEach((eq) => {
        if (eq.status?.toUpperCase() === 'DOWN') down.push(eq);
    });
    return down;
}

function renderDownToasts() {
    const container = getToastContainer();
    const existing = container.querySelector('.toast-group');
    const downList = getDownEquipment();
    
    if (downList.length === 0) {
        if (existing) existing.remove();
        return;
    }
    
    const isUpdate = !!existing;
    if (existing) existing.remove();
    
    const group = document.createElement('div');
    group.className = 'toast-group' + (downList.length === 1 || toastExpanded ? ' expanded' : '');
    if (isUpdate) group.style.animation = 'none';
    
    const header = document.createElement('div');
    header.className = 'toast-group-header';
    header.innerHTML = `<span>⚠️ ${downList.length} Equipment Down</span>${downList.length > 1 ? `<span class="toast-group-count">${group.classList.contains('expanded') ? '▲' : '▼'}</span>` : ''}`;
    header.onclick = () => {
        group.classList.toggle('expanded');
        toastExpanded = group.classList.contains('expanded');
        const count = header.querySelector('.toast-group-count');
        if (count) count.textContent = toastExpanded ? '▲' : '▼';
    };
    group.appendChild(header);
    
    const items = document.createElement('div');
    items.className = 'toast-group-items';
    downList.forEach((equipment) => {
        const item = document.createElement('div');
        item.className = 'toast-group-item';
        item.innerHTML = `<span>${equipment.machine || equipment.name}: ${equipment.reason || 'Unknown'}</span>`;
        const btn = document.createElement('button');
        btn.className = 'toast-action-btn';
        btn.textContent = 'Troubleshoot';
        btn.onclick = (e) => { e.stopPropagation(); showEquipmentModal(equipment.id, true); };
        item.appendChild(btn);
        items.appendChild(item);
    });
    group.appendChild(items);
    container.appendChild(group);
}

function showToast(message, type = 'info', equipment = null) {
    if (type === 'error' && equipment) return; // Handled by showDownToast
    
    const container = getToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 10000);
}

// Alarm toast management
let alarmToastClearTimer = null;
let alarmToastExpanded = false;

function handleAlarmMessage(data) {
    const alarmId = data.topic.replace(/\/State$/, '');
    
    // Parse payload - could be boolean or string
    const payload = data.payload;
    const isActive = payload === true || payload === 'true' || payload === 1 || payload === '1';
    
    const previous = state.activeAlarms.get(alarmId);
    const wasActive = previous?.active;
    
    const alarmData = {
        id: alarmId,
        name: data.machine || alarmId.split('/').pop(),
        topic: data.topic,
        active: isActive,
        timestamp: data.timestamp || new Date().toISOString(),
        enterprise: data.enterprise,
        site: data.site,
        area: data.area,
        equipment: data.device || 'Unknown'
    };
    
    state.activeAlarms.set(alarmId, alarmData);
    
    // Show toast on state change
    if (isActive && !wasActive) {
        showAlarmToast();
    } else if (!isActive && wasActive) {
        renderAlarmToasts();
    }
    
    updateAlarmBadge();
}

function showAlarmToast() {
    clearTimeout(alarmToastClearTimer);
    alarmToastClearTimer = setTimeout(() => {
        const container = getToastContainer();
        const existing = container.querySelector('.alarm-toast-group');
        if (existing) existing.remove();
        alarmToastExpanded = false;
    }, 30000); // Alarms stay longer than equipment toasts
    renderAlarmToasts();
}

function renderAlarmToasts() {
    const container = getToastContainer();
    const existing = container.querySelector('.alarm-toast-group');
    const alarmList = getActiveAlarms();
    
    if (alarmList.length === 0) {
        if (existing) existing.remove();
        return;
    }
    
    const isUpdate = !!existing;
    if (existing) existing.remove();
    
    const group = document.createElement('div');
    group.className = 'alarm-toast-group' + (alarmList.length === 1 || alarmToastExpanded ? ' expanded' : '');
    if (isUpdate) group.style.animation = 'none';
    
    const header = document.createElement('div');
    header.className = 'alarm-toast-header';
    header.innerHTML = `<span>🚨 ${alarmList.length} Active Alarm${alarmList.length > 1 ? 's' : ''}</span>${alarmList.length > 1 ? `<span class="toast-group-count">${group.classList.contains('expanded') ? '▲' : '▼'}</span>` : ''}`;
    header.onclick = () => {
        group.classList.toggle('expanded');
        alarmToastExpanded = group.classList.contains('expanded');
        const count = header.querySelector('.toast-group-count');
        if (count) count.textContent = alarmToastExpanded ? '▲' : '▼';
    };
    group.appendChild(header);
    
    const items = document.createElement('div');
    items.className = 'alarm-toast-items';
    alarmList.forEach((alarm) => {
        const item = document.createElement('div');
        item.className = 'alarm-toast-item';
        item.innerHTML = `<span>${alarm.name}</span><small>${alarm.equipment}</small>`;
        const btn = document.createElement('button');
        btn.className = 'alarm-action-btn';
        btn.textContent = 'Analyze';
        btn.onclick = (e) => { e.stopPropagation(); showAlarmModal(alarm.id); };
        item.appendChild(btn);
        items.appendChild(item);
    });
    group.appendChild(items);
    container.appendChild(group);
}

function updateAlarmBadge() {
    const badge = document.getElementById('alarm-badge');
    const card = document.getElementById('alarm-card');
    const countEl = document.getElementById('alarm-count');
    const listEl = document.getElementById('alarm-list');
    
    const alarms = getActiveAlarms();
    const count = alarms.length;
    
    if (badge) {
        badge.textContent = `🚨 ${count}`;
        badge.style.display = count > 0 ? 'flex' : 'none';
    }
    
    if (card) {
        card.style.display = count > 0 ? 'block' : 'none';
        if (countEl) countEl.textContent = count;
        if (listEl) {
            listEl.innerHTML = alarms.slice(0, 3).map(a => 
                `<div class="alarm-item" onclick="showAlarmModal('${a.id}')">${a.name}</div>`
            ).join('') + (count > 3 ? `<div class="alarm-more">+${count - 3} more</div>` : '');
        }
    }
}

function showAlarmModal(alarmId) {
    const alarm = state.activeAlarms.get(alarmId);
    if (!alarm) return;
    
    const modal = document.getElementById('alarm-modal-overlay');
    if (!modal) return;
    
    document.getElementById('alarm-modal-title').textContent = alarm.name;
    document.getElementById('alarm-modal-content').innerHTML = `
        <div class="alarm-status ${alarm.active ? 'active' : 'cleared'}">${alarm.active ? '🔴 ACTIVE' : '✅ CLEARED'}</div>
        <div class="alarm-meta">
            <div><strong>Enterprise:</strong> ${alarm.enterprise}</div>
            <div><strong>Area:</strong> ${alarm.area}</div>
            <div><strong>Equipment:</strong> ${alarm.equipment}</div>
            <div><strong>Since:</strong> ${new Date(alarm.timestamp).toLocaleString()}</div>
        </div>
        <button class="modal-troubleshoot-btn" onclick="analyzeAlarm('${alarmId}')">🤖 AI Analysis</button>
        <div id="alarm-analysis-result" class="alarm-analysis-result"></div>
    `;
    
    modal.classList.add('active');
}

function closeAlarmModal() {
    const modal = document.getElementById('alarm-modal-overlay');
    if (modal) modal.classList.remove('active');
}

async function analyzeAlarm(alarmId) {
    const alarm = state.activeAlarms.get(alarmId);
    if (!alarm) return;
    
    const resultEl = document.getElementById('alarm-analysis-result');
    if (!resultEl) return;
    
    resultEl.innerHTML = '<div class="loading">Analyzing alarm...</div>';
    
    try {
        const response = await fetch('/api/agent/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                question: `Analyze this industrial alarm and provide troubleshooting steps: "${alarm.name}" on equipment "${alarm.equipment}" in area "${alarm.area}". What are the likely causes and recommended actions?`
            })
        });
        
        const data = await response.json();
        resultEl.innerHTML = `<div class="analysis-content">${marked.parse(data.response || data.answer || 'No analysis available')}</div>`;
    } catch (err) {
        resultEl.innerHTML = `<div class="error">Analysis failed: ${err.message}</div>`;
    }
}

// Energy monitoring
function handleEnergyMessage(data) {
    // Parse power value from payload
    let value = 0;
    try {
        const parsed = typeof data.payload === 'string' ? JSON.parse(data.payload) : data.payload;
        value = parsed.value || 0;
    } catch { value = parseFloat(data.payload) || 0; }

    const topic = data.topic || '';
    const metric = data.metric || topic.split('/').pop() || '';
    const enterprise = data.enterprise || 'Unknown';
    const site = data.site || data.area || 'Unknown';
    const equipment = data.equipment || topic.split('/').slice(3, 5).join('/') || 'Unknown';
    
    // Categorize by metric type
    let category = 'other';
    if (metric.match(/kW_value|_kW$|^kW$/i) && !metric.includes('kWh')) category = 'kw';
    else if (metric.includes('kWh')) category = 'kwh';
    else if (metric.match(/Power_W|TruePower|ApparentPower/i)) category = 'watts';

    const key = `${enterprise}_${site}_${equipment}_${metric}`;
    state.energyReadings.set(key, { 
        enterprise,
        site,
        equipment, 
        metric,
        category,
        value, 
        timestamp: Date.now() 
    });
    updateEnergyCard();
}

function updateEnergyCard() {
    const container = document.getElementById('energy-enterprises');
    if (!container) return;

    // Group by enterprise
    const byEnterprise = new Map();
    state.energyReadings.forEach(r => {
        if (!byEnterprise.has(r.enterprise)) {
            byEnterprise.set(r.enterprise, { kw: 0, kwh: 0, equipment: new Map(), site: r.site });
        }
        const ent = byEnterprise.get(r.enterprise);
        if (r.category === 'kw') ent.kw += r.value;
        else if (r.category === 'kwh') ent.kwh = Math.max(ent.kwh, r.value);
        else if (r.category === 'watts') {
            const equip = r.equipment.split('/').pop() || r.equipment;
            ent.equipment.set(equip, (ent.equipment.get(equip) || 0) + r.value);
        }
    });

    if (byEnterprise.size === 0) {
        container.innerHTML = '<div class="energy-empty">Waiting for energy data...</div>';
        return;
    }

    container.innerHTML = Array.from(byEnterprise.entries()).map(([enterprise, data]) => {
        const topEquip = Array.from(data.equipment.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([name, watts]) => `<div class="energy-equip-row"><span>${name}</span><span>${(watts/1000).toFixed(1)} kW</span></div>`)
            .join('');
        
        return `<div class="energy-enterprise-block">
            <div class="energy-enterprise-header">
                <span class="energy-ent-name">${enterprise}</span>
                <span class="energy-ent-site">${data.site}</span>
            </div>
            <div class="energy-metrics">
                <div class="energy-metric">
                    <span class="energy-metric-value">${data.kw > 0 ? data.kw.toFixed(1) : '--'}</span>
                    <span class="energy-metric-label">kW</span>
                </div>
                <div class="energy-metric">
                    <span class="energy-metric-value">${data.kwh > 0 ? (data.kwh/1000).toFixed(1) : '--'}</span>
                    <span class="energy-metric-label">MWh</span>
                </div>
            </div>
            ${topEquip ? `<div class="energy-equipment-list">${topEquip}</div>` : ''}
        </div>`;
    }).join('');
}

async function fetchEquipmentHistory(equipment, targetId = 'equipment-history') {
    const historyEl = document.getElementById(targetId);
    if (!historyEl) return;
    
    const machine = equipment.machine || equipment.name;
    const device = equipment.device;
    if (!equipment.enterprise || !equipment.site || !machine) {
        historyEl.innerHTML = `<small>History unavailable</small>`;
        return;
    }
    
    try {
        let url = `/api/equipment/${encodeURIComponent(equipment.enterprise)}/${encodeURIComponent(equipment.site)}/${encodeURIComponent(machine)}/history?minutes=15`;
        if (device) url += `&device=${encodeURIComponent(device)}`;
        const res = await fetch(url);
        const data = await res.json();
        
        if (data.error) {
            historyEl.innerHTML = `<small>${data.error}</small>`;
            return;
        }
        
        let html = '';
        
        // Metrics section - key performance indicators
        if (data.metrics && Object.keys(data.metrics).length > 0) {
            const m = data.metrics;
            html += `<div class="metrics-grid">`;
            if (m.oee !== undefined) html += `<div class="metric"><span class="metric-value">${(m.oee * 100).toFixed(1)}%</span><span class="metric-label">OEE</span></div>`;
            if (m.availability !== undefined) html += `<div class="metric"><span class="metric-value">${(m.availability * 100).toFixed(1)}%</span><span class="metric-label">Availability</span></div>`;
            if (m.performance !== undefined) html += `<div class="metric"><span class="metric-value">${(m.performance * 100).toFixed(1)}%</span><span class="metric-label">Performance</span></div>`;
            if (m.quality !== undefined) html += `<div class="metric"><span class="metric-value">${(m.quality * 100).toFixed(1)}%</span><span class="metric-label">Quality</span></div>`;
            html += `</div>`;
            
            // Production counts
            const counts = ['countinfeed', 'countoutfeed', 'countdefect'].filter(k => m[k] !== undefined);
            if (counts.length > 0) {
                html += `<div class="counts-row">`;
                if (m.countinfeed !== undefined) html += `<span>In: ${m.countinfeed.toLocaleString()}</span>`;
                if (m.countoutfeed !== undefined) html += `<span>Out: ${m.countoutfeed.toLocaleString()}</span>`;
                if (m.countdefect !== undefined) html += `<span class="defect">Defects: ${m.countdefect.toLocaleString()}</span>`;
                html += `</div>`;
            }
        }
        
        // Merge local history with server history
        const equipmentId = equipment.id || `${equipment.enterprise}/${equipment.site}/${equipment.machine}/${equipment.device}`;
        const localHistory = localStateHistory.get(equipmentId) || [];
        let allStateChanges = [...(data.stateChanges || [])];
        
        // Add local changes that are newer than server data
        const serverLatest = allStateChanges[0]?.time ? new Date(allStateChanges[0].time).getTime() : 0;
        for (const local of localHistory) {
            if (new Date(local.time).getTime() > serverLatest) {
                allStateChanges.unshift(local);
            }
        }
        
        // State changes timeline
        if (allStateChanges.length > 0) {
            html += `<div class="state-timeline"><strong>State History</strong>`;
            for (const s of allStateChanges.slice(0, 10)) {
                const timeStr = new Date(s.time).toLocaleTimeString('en-US', {
                    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3
                });
                html += `<div class="state-entry ${s.status}">
                    <span class="state-time">${timeStr}</span>
                    <span class="state-status">${s.status.toUpperCase()}</span>
                    <span class="state-reason">${s.reason}</span>
                </div>`;
            }
            html += `</div>`;
        }
        
        historyEl.innerHTML = html || `<small>No recent history</small>`;
    } catch (err) {
        console.error('History fetch error:', err);
        historyEl.innerHTML = `<small>History unavailable</small>`;
    }
}

async function queryTroubleshootAgent(equipment) {
    const response = await fetch('/api/troubleshoot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            equipment,
            sessionId: `troubleshoot-${equipment.machine}-${Date.now()}`
        })
    });
    
    if (!response.ok) throw new Error(`Agent request failed: ${response.status}`);
    
    // Handle streaming response
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let result = '';
    
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
            if (line.startsWith('data: ')) {
                try {
                    const data = JSON.parse(line.slice(6));
                    result += typeof data === 'string' ? data : (data.text || data.content || '');
                } catch { result += line.slice(6); }
            } else if (line.trim() && !line.startsWith('event:')) {
                result += line;
            }
        }
    }
    return result || 'No response from agent';
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

    // Sort: down first, then idle, then running, then unknown
    const sortOrder = { 'down': 0, 'idle': 1, 'running': 2, 'unknown': 3 };
    states.sort((a, b) => (sortOrder[a.status] ?? 4) - (sortOrder[b.status] ?? 4));

    // Count states
    let runningCount = 0;
    let idleCount = 0;
    let downCount = 0;

    states.forEach(equipment => {
        const status = equipment.status;
        if (status === 'running') runningCount++;
        else if (status === 'idle') idleCount++;
        else if (status === 'down') downCount++;
    });

    // Update summary counts
    document.getElementById('state-running').textContent = runningCount;
    document.getElementById('state-idle').textContent = idleCount;
    document.getElementById('state-down').textContent = downCount;

    // Render equipment cards
    grid.innerHTML = states.map(equipment => {
        const stateClass = (equipment.status || 'unknown').toLowerCase();
        const reason = equipment.reason ? `<div class="equipment-reason" title="${equipment.reason}">${equipment.reason}</div>` : '';
        const displayName = equipment.device || equipment.machine || equipment.name;
        const subtitle = equipment.machine && equipment.device ? equipment.machine : '';
        return `
            <div class="equipment-card ${stateClass}" onclick="showEquipmentModal('${equipment.id}')">
                <div class="equipment-name" title="${displayName}">${displayName}</div>
                ${subtitle ? `<div class="equipment-subtitle">${subtitle}</div>` : ''}
                <div class="equipment-state">${(equipment.status || 'unknown').toUpperCase()}</div>
                ${reason}
            </div>
        `;
    }).join('');
}

let equipmentModalInterval = null;
let currentEquipmentModalId = null;

function showEquipmentModal(equipmentId, autoTroubleshoot = false) {
    const equipment = state.equipmentStates.get(equipmentId);
    if (!equipment) return;
    
    const modal = document.getElementById('equipment-modal-overlay');
    if (!modal) return;
    
    currentEquipmentModalId = equipmentId;
    
    const idParts = equipmentId.split('/');
    // Use device as the equipment name, machine as the line/parent
    const deviceName = equipment.device || equipment.machine || equipment.name || idParts[idParts.length - 1] || 'Unknown';
    const machineName = equipment.machine || (idParts.length >= 4 ? idParts[2] : null);
    const statusClass = (equipment.status || 'unknown').toLowerCase();
    const isDown = statusClass === 'down';
    
    // Build hierarchy: Enterprise > Site > [Machine >] Device
    let hierarchyHtml = `
        <span class="hierarchy-item">${equipment.enterprise || idParts[0] || 'Unknown'}</span>
        <span class="hierarchy-sep">›</span>
        <span class="hierarchy-item">${equipment.site || idParts[1] || 'Unknown'}</span>`;
    if (machineName) {
        hierarchyHtml += `
        <span class="hierarchy-sep">›</span>
        <span class="hierarchy-item">${machineName}</span>`;
    }
    hierarchyHtml += `
        <span class="hierarchy-sep">›</span>
        <span class="hierarchy-item current">${deviceName}</span>`;
    
    document.getElementById('equipment-modal-title').innerHTML = hierarchyHtml;
    
    document.getElementById('equipment-modal-content').innerHTML = `
        ${isDown ? '<button class="modal-troubleshoot-btn" onclick="triggerTroubleshootFromModal()">Troubleshoot</button>' : ''}
        <div class="equipment-first-seen">First seen: ${equipment.firstSeen ? new Date(equipment.firstSeen).toLocaleTimeString() : 'just now'}</div>
        <div class="equipment-status-row">
            <span id="modal-status-badge" class="status-badge ${statusClass}">${(equipment.status || 'unknown').toUpperCase()}</span>
            <span id="modal-status-reason" class="status-reason">${equipment.reason || ''}</span>
        </div>
        <div class="equipment-meta">
            <div><strong>In state for:</strong> <span id="modal-state-duration">${equipment.stateChangedAt ? formatStateDuration(Date.now() - equipment.stateChangedAt) : 'N/A'}</span></div>
        </div>
        <div id="equipment-modal-history" class="equipment-history"></div>
        <div id="equipment-modal-troubleshoot" class="equipment-troubleshoot-result"></div>
    `;
    
    modal.classList.add('active');
    
    // Fetch history - equipment already has machine and device
    fetchEquipmentHistory(equipment, 'equipment-modal-history');
    
    // Live update only dynamic elements
    clearInterval(equipmentModalInterval);
    equipmentModalInterval = setInterval(() => updateEquipmentModalDynamic(), 1000);
    
    // Auto-trigger troubleshoot if requested
    if (autoTroubleshoot && isDown) {
        triggerTroubleshootFromModal();
    }
}

async function triggerTroubleshootFromModal() {
    if (!currentEquipmentModalId) return;
    const equipment = state.equipmentStates.get(currentEquipmentModalId);
    if (!equipment) return;
    
    const idParts = currentEquipmentModalId.split('/');
    const machineName = equipment.machine || equipment.name || (idParts.length >= 3 ? idParts[2] : idParts[idParts.length - 1]);
    const troubleshootEl = document.getElementById('equipment-modal-troubleshoot');
    const troubleshootBtn = document.querySelector('.modal-troubleshoot-btn');
    
    if (!troubleshootEl) return;
    
    // Disable button while analyzing
    if (troubleshootBtn) troubleshootBtn.disabled = true;
    
    const analysisTime = new Date();
    const analysisState = equipment.status || 'DOWN';
    troubleshootEl.innerHTML = `
        <details class="analysis-section" open>
            <summary class="analysis-header"><span class="analysis-time">State: ${analysisState} at ${analysisTime.toLocaleTimeString()}</span></summary>
            <div class="analysis-content"><div class="troubleshoot-loading"><div class="loading-spinner"></div><span>Analyzing equipment...</span></div></div>
        </details>`;
    troubleshootEl.dataset.analysisState = analysisState;
    
    // Capture full state snapshot from UI
    const context = {
        machine: machineName,
        enterprise: equipment.enterprise,
        site: equipment.site,
        status: equipment.status,
        reason: equipment.reason,
        stateChangedAt: equipment.stateChangedAt ? new Date(equipment.stateChangedAt).toISOString() : null,
        stateDuration: equipment.stateChangedAt ? formatStateDuration(Date.now() - equipment.stateChangedAt) : null,
        analysisRequestedAt: analysisTime.toISOString()
    };
    
    try {
        const response = await queryTroubleshootAgent(context);
        const contentEl = troubleshootEl.querySelector('.analysis-content');
        if (contentEl) {
            contentEl.innerHTML = `<div class="troubleshoot-result">${parseMarkdown(response)}</div>`;
        }
    } catch (err) {
        const contentEl = troubleshootEl.querySelector('.analysis-content');
        if (contentEl) {
            contentEl.innerHTML = `<div class="troubleshoot-error">Analysis failed: ${err.message}</div>`;
        }
    } finally {
        // Re-enable button if still down
        const currentEquipment = state.equipmentStates.get(currentEquipmentModalId);
        const btn = document.querySelector('.modal-troubleshoot-btn');
        if (btn && currentEquipment?.status?.toUpperCase() === 'DOWN') {
            btn.disabled = false;
        }
    }
}

function updateEquipmentModalDynamic() {
    if (!currentEquipmentModalId) return;
    const equipment = state.equipmentStates.get(currentEquipmentModalId);
    if (!equipment) return;
    
    const statusClass = (equipment.status || 'unknown').toLowerCase();
    const badge = document.getElementById('modal-status-badge');
    const reason = document.getElementById('modal-status-reason');
    const code = document.getElementById('modal-status-code');
    const duration = document.getElementById('modal-state-duration');
    const troubleshootBtn = document.querySelector('.modal-troubleshoot-btn');
    
    if (badge) {
        badge.className = `status-badge ${statusClass}`;
        badge.textContent = (equipment.status || 'unknown').toUpperCase();
    }
    if (reason) reason.textContent = equipment.reason || '';
    if (duration) duration.textContent = equipment.stateChangedAt ? formatStateDuration(Date.now() - equipment.stateChangedAt) : 'N/A';
    
    // Show/hide troubleshoot button based on state
    const isDown = statusClass === 'down';
    if (troubleshootBtn) {
        troubleshootBtn.style.display = isDown ? '' : 'none';
    } else if (isDown) {
        // Add button if it doesn't exist and equipment is now down
        const content = document.getElementById('equipment-modal-content');
        if (content && !content.querySelector('.modal-troubleshoot-btn')) {
            content.insertAdjacentHTML('afterbegin', '<button class="modal-troubleshoot-btn" onclick="triggerTroubleshootFromModal()">Troubleshoot</button>');
        }
    }
    
    // Mark analysis as stale if state changed
    const troubleshootEl = document.getElementById('equipment-modal-troubleshoot');
    if (troubleshootEl && troubleshootEl.dataset.analysisState) {
        const analysisSection = troubleshootEl.querySelector('.analysis-section');
        if (analysisSection && troubleshootEl.dataset.analysisState !== (equipment.status || 'UNKNOWN')) {
            analysisSection.classList.add('analysis-stale');
        }
    }
}

function closeEquipmentModal() {
    clearInterval(equipmentModalInterval);
    currentEquipmentModalId = null;
    document.getElementById('equipment-modal-overlay')?.classList.remove('active');
}

// Fetch line OEE from API
async function fetchLineOEE() {
    try {
        const response = await fetch('/api/oee/lines');
        const data = await response.json();

        if (data.lines && Array.isArray(data.lines)) {
            // Filter by global selectedFactory
            const enterprise = getEnterpriseParam();
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

// Helper to convert state.selectedFactory to proper enterprise parameter
function getEnterpriseParam() {
    if (state.selectedFactory === 'ALL') return 'ALL';
    if (state.selectedFactory === 'A') return 'Enterprise A';
    if (state.selectedFactory === 'B') return 'Enterprise B';
    if (state.selectedFactory === 'C') return 'Enterprise C';
    // Already in full format
    return state.selectedFactory;
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

// Map backend type to filter category
function getFilterType(message) {
    const backendType = message.type || 'unknown';
    const typeMap = {
        // Production - OEE, counts, quality, KPIs
        'oee': 'production',
        'production_metric': 'production',
        // Equipment - state, status, config
        'equipment_state': 'equipment',
        'state_metadata': 'equipment',
        'equipment_metadata': 'equipment',
        'equipment_config': 'equipment',
        // Process - sensor readings
        'process_variable': 'process',
        'motion': 'process',
        // Energy
        'energy': 'energy',
        // Alarms
        'alarm': 'alarm',
        // Telemetry - raw edge data
        'telemetry': 'telemetry',
        'sparkplug': 'telemetry',
        'sparkplug_state': 'telemetry',
        'io_point': 'telemetry',
        // Other
        'infrastructure': 'other',
        'unknown': 'other'
    };
    return typeMap[backendType] || 'other';
}

// Format ISA-95 hierarchy with color coding
function formatHierarchy(message) {
    const parts = [];
    if (message.enterprise) parts.push(`<span class="hier-enterprise">${escapeHtml(message.enterprise)}</span>`);
    if (message.site) parts.push(`<span class="hier-site">${escapeHtml(message.site)}</span>`);
    if (message.area) parts.push(`<span class="hier-area">${escapeHtml(message.area)}</span>`);
    if (message.machine) parts.push(`<span class="hier-machine">${escapeHtml(message.machine)}</span>`);
    if (message.device) parts.push(`<span class="hier-device">${escapeHtml(message.device)}</span>`);
    if (message.metric) parts.push(`<span class="hier-metric">${escapeHtml(message.metric)}</span>`);
    return parts.length > 0 ? parts.join('<span class="hier-sep">›</span>') : escapeHtml(message.topic);
}

// Message frequency tracking
const messageFrequency = new Map(); // topic -> { count, lastSeen, avgInterval, intervals[] }

function trackMessageFrequency(topic) {
    const now = Date.now();
    let freq = messageFrequency.get(topic);
    
    if (!freq) {
        freq = { count: 0, lastSeen: now, avgInterval: 0, intervals: [] };
        messageFrequency.set(topic, freq);
    }
    
    if (freq.lastSeen) {
        const interval = now - freq.lastSeen;
        freq.intervals.push(interval);
        if (freq.intervals.length > 10) freq.intervals.shift(); // Keep last 10
        freq.avgInterval = freq.intervals.reduce((a, b) => a + b, 0) / freq.intervals.length;
    }
    
    freq.count++;
    freq.lastSeen = now;
    return freq;
}

function getFrequencyIndicator(topic) {
    const freq = messageFrequency.get(topic);
    if (!freq || freq.intervals.length < 3) return '';
    
    const sinceLastMs = Date.now() - freq.lastSeen;
    const ratio = sinceLastMs / freq.avgInterval;
    
    if (ratio > 3) return '<span class="freq-warning" title="Delayed">⚠️</span>';
    if (ratio < 0.3) return '<span class="freq-fast" title="Faster than usual">⚡</span>';
    return '';
}

// Render messages from state.messages based on current filter
function renderMessageStream() {
    const stream = document.getElementById('mqtt-stream');
    if (!stream) return;

    const filtered = state.messages.filter(m => 
        state.eventFilter === 'all' || getFilterType(m) === state.eventFilter
    ).slice(-50); // Last 50 matching

    if (filtered.length === 0) {
        const filterName = state.eventFilter === 'all' ? 'events' : state.eventFilter;
        stream.innerHTML = `<div class="stream-empty">
            <div class="stream-empty-icon">📡</div>
            <div>No ${filterName} received yet</div>
            <div class="stream-empty-hint">Waiting for data...</div>
        </div>`;
        return;
    }

    stream.innerHTML = filtered.map(message => {
        const timestamp = new Date(message.timestamp).toLocaleTimeString('en-US', {
            hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3
        });
        const escapedPayload = typeof message.payload === 'object'
            ? escapeHtml(JSON.stringify(message.payload))
            : escapeHtml(String(message.payload));
        const filterType = getFilterType(message);
        const rawType = message.type || 'unknown';
        const hierarchy = formatHierarchy(message);
        const freqIndicator = getFrequencyIndicator(message.topic);
        return `<div class="stream-line" data-event-type="${filterType}">
            <span class="stream-timestamp">[${timestamp}]</span>
            <span class="stream-type-badge type-${filterType}">${rawType}</span>
            ${freqIndicator}
            <span class="stream-hierarchy">${hierarchy}</span>
            <span class="stream-value">${escapedPayload}</span>
        </div>`;
    }).join('');

    stream.scrollTop = stream.scrollHeight;
}

// Add MQTT message to the stream display
function addMQTTMessageToStream(message) {
    // Don't render when stream is paused
    if (state.streamPaused) return;

    const filterType = getFilterType(message);

    // Skip rendering if doesn't match current filter
    if (state.eventFilter !== 'all' && filterType !== state.eventFilter) {
        return;
    }

    const stream = document.getElementById('mqtt-stream');
    if (!stream) return;

    // Clear empty state when first matching message arrives
    const emptyState = stream.querySelector('.stream-empty');
    if (emptyState) emptyState.remove();

    const timestamp = new Date(message.timestamp).toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3
    });

    // Track frequency
    trackMessageFrequency(message.topic);
    const freqIndicator = getFrequencyIndicator(message.topic);
    const rawType = message.type || 'unknown';
    const hierarchy = formatHierarchy(message);

    // Format payload - expand nested objects into key summaries
    let payloadDisplay = '';
    try {
        const payload = typeof message.payload === 'string' ? JSON.parse(message.payload) : message.payload;
        if (typeof payload === 'object' && payload !== null) {
            const keys = Object.keys(payload);
            if (keys.length <= 5) {
                // Show key=value pairs for small objects
                payloadDisplay = keys.map(k => {
                    const v = payload[k];
                    if (typeof v === 'object') return `${k}:{...}`;
                    return `${k}=${String(v).substring(0, 30)}`;
                }).join(' ');
            } else {
                // Show key count for large objects
                payloadDisplay = `{${keys.length} fields: ${keys.slice(0, 4).join(', ')}...}`;
            }
        } else {
            payloadDisplay = String(payload).substring(0, 100);
        }
    } catch {
        payloadDisplay = String(message.payload).substring(0, 100);
    }

    const line = document.createElement('div');
    line.className = 'stream-line';
    line.setAttribute('data-event-type', filterType);

    line.innerHTML = `
        <span class="stream-timestamp">[${timestamp}]</span>
        <span class="stream-type-badge type-${filterType}">${rawType}</span>
        ${freqIndicator}
        <span class="stream-hierarchy">${hierarchy}</span>
        <span class="stream-value">${escapeHtml(payloadDisplay)}</span>
    `;

    // Check if user is at bottom before adding new message
    const isAtBottom = stream.scrollHeight - stream.scrollTop <= stream.clientHeight + 10;

    stream.appendChild(line);

    // Only trim old messages when user is at bottom (not reading history)
    const maxWhileScrolled = 200;
    const normalMax = 50;

    if (isAtBottom) {
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
    let insightText = insight.summary || insight.insight || 'No insight available';
    if (typeof insightText === 'object') insightText = JSON.stringify(insightText);
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

    // Update anomaly count - filter by selected enterprise
    const anomalyCount = document.getElementById('anomaly-count');
    if (anomalyCount) {
        const enterprise = getEnterpriseParam();
        let filteredAnomalies = state.anomalies;

        if (enterprise !== 'ALL') {
            // Filter anomalies by enterprise
            filteredAnomalies = state.anomalies.filter(anomaly => {
                // Check if anomaly has enterprise field (new format)
                if (anomaly.enterprise) {
                    return anomaly.enterprise === enterprise;
                }
                // Fallback: check if anomaly text contains enterprise name
                if (anomaly.text && anomaly.text.includes(enterprise)) {
                    return true;
                }
                return false;
            });
        }

        anomalyCount.textContent = filteredAnomalies.length;
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
function selectFactory(factory, event) {
    state.selectedFactory = factory;
    document.querySelectorAll('.factory-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    if (event && event.target) {
        event.target.closest('.factory-btn').classList.add('active');
    }

    // Clear filtered data but preserve sensor count
    state.messages = [];
    // Don't clear uniqueTopics - keep cumulative sensor count
    state.enterpriseCounts = { 'Enterprise A': 0, 'Enterprise B': 0, 'Enterprise C': 0 };

    // Reset charts
    if (window.healthChart) {
        window.healthChart.data.datasets[0].data = [0, 0, 0];
        window.healthChart.update();
    }

    // Refresh all data for selected enterprise
    refreshAllData();

    // Update metrics display
    updateMetrics();

    console.log('Filtering by factory:', factory);
}

// Refresh all data cards with current filter
function refreshAllData() {
    fetchOEE();
    fetchOEEBreakdown();
    fetchFactoryStatus();
    fetchWasteTrends();
    fetchScrapByLine();
    fetchQualityMetrics();
    fetchEquipmentStates();
    fetchLineOEE();
}

// Fetch OEE from API (24h average)
async function fetchOEE() {
    try {
        const enterprise = getEnterpriseParam();
        const response = await fetch(`/api/oee?enterprise=${encodeURIComponent(enterprise)}`);
        const data = await response.json();

        const oeeScore = document.getElementById('oee-score');
        const oeeStatus = document.getElementById('oee-status');

        if (data.average !== null) {
            oeeScore.textContent = data.average.toFixed(1) + '%';
            const displayName = enterprise === 'ALL' ? 'All Enterprises' : enterprise;
            oeeStatus.textContent = `${data.period} avg • ${displayName}`;
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

    // Re-render stream from state.messages
    renderMessageStream();
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
    fetchLineOEE();

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
    setInterval(fetchLineOEE, 30000);
});

// Expose askClaudeQuestion globally
window.askClaudeQuestion = function() {
    const question = prompt('Ask Claude about the factory:');
    if (question) {
        askClaude(question);
    }
};

// Chat Widget
let chatSessionId = 'session-' + Date.now();

const USER_ICON = '<svg class="avatar" viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';
const AGENT_ICON = '<svg class="avatar" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>';

const CHAT_WELCOME = `
<div class="chat-welcome">
    <svg class="chat-welcome-icon" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
    <h3>Edge Mind Assistant</h3>
    <p>Ask me about factory metrics, OEE performance, production lines, or anomaly detection.</p>
    <div class="suggested-questions">
        <button class="suggested-question" onclick="handleSuggestedQuestion('What is impacting Enterprise B\\'s OEE?')">What is impacting Enterprise B's OEE?</button>
        <button class="suggested-question" onclick="handleSuggestedQuestion('Which equipment has been down the longest?')">Which equipment has been down the longest?</button>
        <button class="suggested-question" onclick="handleSuggestedQuestion('Where is waste coming from in Enterprise A?')">Where is waste coming from in Enterprise A?</button>
        <button class="suggested-question" onclick="handleSuggestedQuestion('What is the status of Enterprise C batches?')">What is the status of Enterprise C batches?</button>
    </div>
</div>`;

function handleSuggestedQuestion(question) {
    document.getElementById('chat-input').value = question;
    sendChat();
}

function parseMarkdown(text) {
    return marked.parse(text);
}

function toggleChat() {
    const panel = document.getElementById('chat-panel');
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) {
        document.getElementById('chat-input').focus();
        // Show welcome on first open
        const messages = document.getElementById('chat-messages');
        if (!messages.innerHTML.trim()) {
            messages.innerHTML = CHAT_WELCOME;
        }
    }
}

async function sendChat() {
    const input = document.getElementById('chat-input');
    const messages = document.getElementById('chat-messages');
    const sendBtn = document.getElementById('chat-send');
    const prompt = input.value.trim();
    
    if (!prompt) return;
    
    // Clear welcome message if present
    if (messages.querySelector('.chat-welcome')) {
        messages.innerHTML = '';
    }
    
    // Add user message
    messages.innerHTML += `<div class="chat-message user">${USER_ICON}<div class="bubble">${escapeHtml(prompt)}</div></div>`;
    input.value = '';
    sendBtn.disabled = true;
    
    // Add assistant message placeholder
    const assistantMsg = document.createElement('div');
    assistantMsg.className = 'chat-message assistant streaming';
    assistantMsg.innerHTML = `${AGENT_ICON}<div class="bubble"></div>`;
    messages.appendChild(assistantMsg);
    messages.scrollTop = messages.scrollHeight;
    
    const bubbleDiv = assistantMsg.querySelector('.bubble');
    
    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, sessionId: chatSessionId })
        });
        
        if (!response.ok) throw new Error('Chat failed');
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let text = '';
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value, { stream: true });
            for (const line of chunk.split('\n')) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        text += typeof data === 'string' ? data : (data.text || data.content || '');
                    } catch {
                        text += line.slice(6);
                    }
                } else if (line.trim() && !line.startsWith('event:')) {
                    text += line;
                }
            }
            bubbleDiv.innerHTML = parseMarkdown(text);
            messages.scrollTop = messages.scrollHeight;
        }
        
        assistantMsg.classList.remove('streaming');
    } catch (err) {
        bubbleDiv.textContent = 'Error: Could not reach assistant';
        assistantMsg.classList.remove('streaming');
    }
    
    sendBtn.disabled = false;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}


// Chat panel functionality
// let chatSessionId = null;
// let isChatPanelOpen = false;

// function toggleChatPanel() {
//     const chatPanel = document.getElementById('chat-panel');
//     const toggleBtn = document.getElementById('chat-toggle-btn');

//     if (!chatPanel || !toggleBtn) return;

//     isChatPanelOpen = !isChatPanelOpen;

//     if (isChatPanelOpen) {
//         chatPanel.classList.add('active');
//         toggleBtn.style.display = 'none';

//         // Focus on input
//         const input = document.getElementById('chat-input');
//         if (input) {
//             setTimeout(() => input.focus(), 300);
//         }
//     } else {
//         chatPanel.classList.remove('active');
//         toggleBtn.style.display = 'block';
//     }
// }

// function appendToChat(role, message) {
//     const chatMessages = document.getElementById('chat-messages');
//     if (!chatMessages) return;

//     // Remove suggested questions if they exist
//     const suggestedQuestions = chatMessages.querySelector('.suggested-questions');
//     const welcomeMsg = chatMessages.querySelector('.chat-welcome');
//     if (suggestedQuestions) suggestedQuestions.remove();
//     if (welcomeMsg) welcomeMsg.remove();

//     const messageEl = document.createElement('div');
//     messageEl.className = `chat-message ${role}`;

//     // Escape HTML to prevent XSS
//     const escapedMessage = escapeHtml(message);
//     messageEl.innerHTML = escapedMessage;

//     chatMessages.appendChild(messageEl);

//     // Auto-scroll to bottom
//     chatMessages.scrollTop = chatMessages.scrollHeight;
// }

// async function askAgent(question) {
//     if (!question || !question.trim()) return;

//     try {
//         // Append user message
//         appendToChat('user', question);

//         // Show loading indicator
//         appendToChat('loading', 'Agent is thinking...');

//         // Send request to backend
//         const response = await fetch('/api/agent/ask', {
//             method: 'POST',
//             headers: {
//                 'Content-Type': 'application/json'
//             },
//             body: JSON.stringify({
//                 question: question,
//                 sessionId: chatSessionId
//             })
//         });

//         if (!response.ok) {
//             throw new Error(`HTTP error! status: ${response.status}`);
//         }

//         const data = await response.json();

//         // Remove loading indicator
//         const chatMessages = document.getElementById('chat-messages');
//         const loadingMsg = chatMessages.querySelector('.chat-message.loading');
//         if (loadingMsg) loadingMsg.remove();

//         // Store session ID for follow-up questions
//         if (data.sessionId) {
//             chatSessionId = data.sessionId;
//         }

//         // Append agent response
//         appendToChat('agent', data.answer || 'Sorry, I could not process your request.');

//     } catch (error) {
//         console.error('Failed to ask agent:', error);

//         // Remove loading indicator
//         const chatMessages = document.getElementById('chat-messages');
//         const loadingMsg = chatMessages.querySelector('.chat-message.loading');
//         if (loadingMsg) loadingMsg.remove();

//         // Show error message
//         appendToChat('agent', 'Sorry, I encountered an error. Please try again later.');
//     }
// }

// function sendChatMessage() {
//     const input = document.getElementById('chat-input');
//     if (!input) return;

//     const question = input.value.trim();
//     if (!question) return;

//     // Clear input
//     input.value = '';

//     // Send to agent
//     askAgent(question);
// }

// function handleSuggestedQuestion(question) {
//     askAgent(question);
// }

// // Setup Enter key for chat input
// document.addEventListener('DOMContentLoaded', () => {
//     const chatInput = document.getElementById('chat-input');
//     if (chatInput) {
//         chatInput.addEventListener('keypress', (e) => {
//             if (e.key === 'Enter') {
//                 e.preventDefault();
//                 sendChatMessage();
//             }
//         });
//     }
// });
