// MAIN ENTRY POINT - Imports all modules and exposes functions to window

// Import all modules
import { state } from './state.js';
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
    selectFactory
} from './dashboard-data.js';
import { updateMessageRate } from './dashboard-render.js';
import {
    filterInsights,
    addAnomalyFilter,
    removeAnomalyFilter,
    toggleAgentPause,
    checkAgentPauseState
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
    updateScrollToBottomBtn
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
import { init as initCOOEnterprise, cleanup as cleanupCOOEnterprise } from './coo-enterprise.js';
import { init as initCOOTrends, cleanup as cleanupCOOTrends } from './coo-trends.js';
import { init as initCOOAgent, cleanup as cleanupCOOAgent, sendQuestion as sendCOOAgentQuestion, askSuggested as askCOOSuggested } from './coo-agent.js';
import { init as initLineStatus, cleanup as cleanupLineStatus } from './plant-line-status.js';
import { init as initOEEDrilldown, cleanup as cleanupOEEDrilldown } from './plant-oee-drilldown.js';
import { init as initEquipmentHealth, cleanup as cleanupEquipmentHealth, filterEquipment } from './plant-equipment.js';
import { init as initAlerts, cleanup as cleanupAlerts, filterAlerts } from './plant-alerts.js';
import { init as initPlantProcessTrends, cleanup as cleanupPlantProcessTrends } from './plant-process-trends.js';
import { init as initCesmii, cleanup as cleanupCesmii } from './cesmii.js';

// Expose all functions that are called from HTML onclick handlers to window
window.switchPersona = switchPersona;
window.switchPersonaView = switchPersonaView;
window.filterInsights = filterInsights;
window.addAnomalyFilter = addAnomalyFilter;
window.removeAnomalyFilter = removeAnomalyFilter;
window.toggleAgentPause = toggleAgentPause;
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
window.launchScenario = launchScenario;
window.stopScenario = stopScenario;
window.stopInjection = stopInjection;
window.askCOOQuestion = askCOOSuggested;
window.sendCOOQuestion = sendCOOAgentQuestion;
window.filterEquipmentByState = filterEquipment;
window.filterAlertsBySeverity = filterAlerts;
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

    // Chat event delegation - works for original and modal clones
    document.addEventListener('keypress', (e) => {
        if (e.target?.classList?.contains('chat-input') && e.key === 'Enter') {
            e.preventDefault();
            sendChatMessage(e.target);
        }
    });
    
    document.addEventListener('input', (e) => {
        if (e.target?.classList?.contains('chat-input')) {
            const messages = e.target.closest('.chat-body, .chat-wrapper')?.querySelector('.chat-messages');
            if (messages) messages.scrollTop = messages.scrollHeight;
        }
    });
    
    document.addEventListener('click', (e) => {
        if (e.target?.classList?.contains('chat-send')) {
            const container = e.target.closest('.chat-body, .chat-wrapper');
            const input = container?.querySelector('.chat-input');
            sendChatMessage(input);
        }
        if (e.target?.classList?.contains('chat-scroll-btn')) {
            const container = e.target.closest('.chat-body, .chat-wrapper, .card');
            const messages = container?.querySelector('.chat-messages');
            if (messages) {
                messages.scrollTo({ top: messages.scrollHeight, behavior: 'smooth' });
                e.target.classList.remove('visible');
            }
        }
    });
    
    document.addEventListener('scroll', (e) => {
        if (e.target?.classList?.contains('chat-messages')) {
            updateScrollToBottomBtn(e.target);
        }
    }, true); // capture phase for scroll

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

    // Track previously active view for cleanup
    let previousActiveView = null;

    // Cleanup map for views that need it
    const viewCleanup = {
        'coo-enterprise': cleanupCOOEnterprise,
        'coo-trends': cleanupCOOTrends,
        'coo-agent': cleanupCOOAgent,
        'plant-line-status': cleanupLineStatus,
        'plant-oee-drilldown': cleanupOEEDrilldown,
        'plant-equipment': cleanupEquipmentHealth,
        'plant-alerts': cleanupAlerts,
        'plant-process-trends': cleanupPlantProcessTrends,
        'plant-cesmii': cleanupCesmii
    };

    // Watch for persona view changes to initialize views
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                const target = mutation.target;
                if (target.classList.contains('persona-view') && target.classList.contains('active')) {
                    const view = target.dataset.view;

                    // Cleanup previous view if needed
                    if (previousActiveView && previousActiveView !== view && viewCleanup[previousActiveView]) {
                        viewCleanup[previousActiveView]();
                    }
                    previousActiveView = view;

                    // Initialize the newly active view
                    if (view === 'demo-scenarios') {
                        initDemoScenarios();
                    } else if (view === 'demo-inject') {
                        initDemoInject();
                    } else if (view === 'coo-enterprise') {
                        initCOOEnterprise();
                    } else if (view === 'coo-trends') {
                        initCOOTrends();
                    } else if (view === 'coo-agent') {
                        initCOOAgent();
                    } else if (view === 'plant-line-status') {
                        initLineStatus();
                    } else if (view === 'plant-oee-drilldown') {
                        initOEEDrilldown();
                    } else if (view === 'plant-equipment') {
                        initEquipmentHealth();
                    } else if (view === 'plant-alerts') {
                        initAlerts();
                    } else if (view === 'plant-process-trends') {
                        initPlantProcessTrends();
                    } else if (view === 'plant-cesmii') {
                        initCesmii();
                    }
                }
            }
        });
    });

    document.querySelectorAll('.persona-view').forEach(view => {
        observer.observe(view, { attributes: true });
    });

    window.addEventListener('beforeunload', () => {
        observer.disconnect();
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

    // Check agent pause state on init
    checkAgentPauseState();

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
