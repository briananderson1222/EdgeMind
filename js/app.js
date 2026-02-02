// MAIN ENTRY POINT - Imports all modules and exposes functions to window

// Import all modules
import { state, connection } from './state.js';
import { switchPersona, switchPersonaView, initPersonaNavigation } from './persona.js';
import { connectWebSocket } from './websocket.js';
import { initializeCharts } from './charts.js';
import {
    fetchOEE,
    fetchOEEBreakdown,
    fetchWasteTrends,
    fetchScrapByLine,
    fetchQualityMetrics,
    fetchFactoryStatus,
    fetchEquipmentStates,
    fetchLineOEE,
    refreshAllData,
    selectFactory
} from './dashboard-data.js';
import { updateMetrics, updateMessageRate } from './dashboard-render.js';
import {
    filterInsights,
    addAnomalyFilter,
    removeAnomalyFilter
} from './insights.js';
import {
    filterEvents,
    toggleStreamPause
} from './stream.js';
import {
    openAnomalyModal,
    closeAnomalyModal,
    openSettingsModal,
    closeSettingsModal,
    saveSettings,
    openAgentModal,
    closeAgentModal,
    filterModalInsights,
    expandCard,
    closeCardModal
} from './modals.js';
import {
    toggleChatPanel,
    sendChatMessage,
    handleSuggestedQuestion,
    askClaude
} from './chat.js';
import {
    initDemoScenarios,
    launchScenario,
    stopScenario
} from './demo-scenarios.js';
import {
    initDemoInject,
    stopInjection
} from './demo-inject.js';
import {
    demoResetData,
    setTimerPreset,
    setTimerCustom,
    startTimer,
    pauseTimer,
    resetTimer
} from './demo-timer.js';

// Expose all functions that are called from HTML onclick handlers to window
window.switchPersona = switchPersona;
window.switchPersonaView = switchPersonaView;
window.filterInsights = filterInsights;
window.addAnomalyFilter = addAnomalyFilter;
window.removeAnomalyFilter = removeAnomalyFilter;
window.filterEvents = filterEvents;
window.toggleStreamPause = toggleStreamPause;
window.selectFactory = selectFactory;
window.openAnomalyModal = openAnomalyModal;
window.closeAnomalyModal = closeAnomalyModal;
window.openSettingsModal = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;
window.saveSettings = saveSettings;
window.openAgentModal = openAgentModal;
window.closeAgentModal = closeAgentModal;
window.filterModalInsights = filterModalInsights;
window.expandCard = expandCard;
window.closeCardModal = closeCardModal;
window.toggleChatPanel = toggleChatPanel;
window.sendChatMessage = sendChatMessage;
window.handleSuggestedQuestion = handleSuggestedQuestion;
window.askClaudeQuestion = function() {
    const question = prompt('Ask Claude about the factory:');
    if (question) {
        askClaude(question);
    }
};
window.launchScenario = launchScenario;
window.stopScenario = stopScenario;
window.stopInjection = stopInjection;
window.demoResetData = demoResetData;
window.setTimerPreset = setTimerPreset;
window.setTimerCustom = setTimerCustom;
window.startTimer = startTimer;
window.pauseTimer = pauseTimer;
window.resetTimer = resetTimer;

// Initialize persona system on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    initPersonaNavigation();

    // Setup anomaly filter input Enter key handler
    const filterInput = document.getElementById('anomaly-filter-input');
    if (filterInput) {
        filterInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                addAnomalyFilter();
            }
        });
    }

    // Setup modal event listeners
    const closeBtn = document.getElementById('close-anomaly-modal');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeAnomalyModal);
    }

    const overlay = document.getElementById('anomaly-modal-overlay');
    if (overlay) {
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) {
                closeAnomalyModal();
            }
        });
    }

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeAnomalyModal();
            closeSettingsModal();
            closeAgentModal();
        }
    });

    const settingsOverlay = document.getElementById('settings-modal-overlay');
    if (settingsOverlay) {
        settingsOverlay.addEventListener('click', function(e) {
            if (e.target === settingsOverlay) {
                closeSettingsModal();
            }
        });
    }

    // Setup agent modal event listeners
    const agentModalOverlay = document.getElementById('agent-modal-overlay');
    if (agentModalOverlay) {
        agentModalOverlay.addEventListener('click', function(e) {
            if (e.target === agentModalOverlay) {
                closeAgentModal();
            }
        });
    }

    // Setup factory button event delegation
    const factorySelector = document.querySelector('.factory-selector');
    if (factorySelector) {
        factorySelector.addEventListener('click', (e) => {
            const btn = e.target.closest('.factory-btn');
            if (btn && !btn.classList.contains('loading')) {
                const factory = btn.dataset.factory;
                if (factory) selectFactory(factory);
            }
        });
    }

    // Setup chat input Enter key handler
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                sendChatMessage();
            }
        });
    }

    // Event delegation for all expand buttons
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.expand-btn');
        if (btn) {
            e.preventDefault();
            e.stopPropagation();

            const cardId = btn.getAttribute('data-card-id');
            const card = document.getElementById(cardId);

            if (card) {
                const titleEl = btn.closest('.card-title');
                const title = titleEl ? Array.from(titleEl.childNodes)
                    .filter(node => node.nodeType === Node.TEXT_NODE)
                    .map(node => node.textContent.trim())
                    .join(' ').trim() : 'Card Details';

                expandCard(card, title);
            }
        }
    });

    // Close card modal on escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const cardModalOverlay = document.getElementById('card-modal-overlay');
            if (cardModalOverlay && cardModalOverlay.classList.contains('active')) {
                closeCardModal();
            }
        }
    });

    // Close card modal on backdrop click
    const cardModalOverlay = document.getElementById('card-modal-overlay');
    if (cardModalOverlay) {
        cardModalOverlay.addEventListener('click', (e) => {
            if (e.target.id === 'card-modal-overlay') {
                closeCardModal();
            }
        });
    }

    // Watch for persona view changes to initialize demo views
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                const target = mutation.target;
                if (target.classList.contains('persona-view') && target.classList.contains('active')) {
                    const view = target.dataset.view;
                    if (view === 'demo-scenarios') {
                        initDemoScenarios();
                    } else if (view === 'demo-inject') {
                        initDemoInject();
                    }
                }
            }
        });
    });

    document.querySelectorAll('.persona-view').forEach(view => {
        observer.observe(view, { attributes: true });
    });
});

// Initialize on page load
window.addEventListener('load', () => {
    console.log('🚀 Initializing EdgeMind...');

    // Restore saved factory selection from localStorage
    try {
        const savedFactory = localStorage.getItem('edgemind_selectedFactory');
        if (savedFactory && ['ALL', 'A', 'B', 'C'].includes(savedFactory)) {
            state.selectedFactory = savedFactory;
            document.querySelectorAll('.factory-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.factory === savedFactory);
            });
        }
    } catch (e) {
        // localStorage unavailable
    }

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
