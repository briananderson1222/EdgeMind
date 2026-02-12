// SHARED STATE - All mutable state objects

// Persona system state
export const personaState = {
    activePersona: 'coo',
    activeView: 'coo-dashboard'
};

export const personaDefaults = {
    coo: 'coo-dashboard',
    plant: 'plant-line-status',
    demo: 'demo-scenarios'
};

// WebSocket connection state (mutable primitives must be in object)
export const connection = {
    ws: null,
    reconnectInterval: null,
    isConnected: false,
    messageRate: 0,
    lastMessageTime: Date.now(),
    messagesSinceLastRate: 0,
    refreshAbortController: null,
    chatSessionId: null,
    isChatPanelOpen: false
};

// Main application state
export const state = {
    messages: [],
    insights: [],
    anomalies: [],
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
    selectedFactory: 'ALL',
    insightFilter: 'all',
    eventFilter: 'all',
    equipmentStates: new Map(),
    streamPaused: false,
    anomalyFilters: [],
    thresholdSettings: {
        oeeBaseline: 70,
        oeeWorldClass: 85,
        availabilityMin: 65,
        defectRateWarning: 2,
        defectRateCritical: 5
    },
    cesmiiWorkOrders: []
};

// Demo control state
export const demoState = {
    scenarios: [],
    profiles: [],
    activeScenario: null,
    activeInjections: [],
    scenarioStatusInterval: null,
    injectionStatusInterval: null,
    timerSeconds: 0,
    timerInterval: null,
    timerRunning: false,
    timerWarningThreshold: 120
};

// Sleeping agent messages
export const SLEEPING_AGENT_MESSAGES = [
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

// WebSocket URL constant
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
export const WS_URL = window.location.hostname === 'localhost'
    ? 'ws://localhost:3000/ws'
    : `${wsProtocol}//${window.location.host}/ws`;

// Counter for persona switching
export let switchCounter = 0;
export function incrementSwitchCounter() {
    switchCounter++;
    return switchCounter;
}
