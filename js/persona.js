// PERSONA SYSTEM - Navigation and view switching

import { personaState, personaDefaults, demoState, switchCounter, incrementSwitchCounter } from './state.js';

/**
 * Switch active persona (COO, Plant Manager, Demo Control)
 * Updates theme, active chip, sub-nav panel, and switches to default view
 */
export function switchPersona(key) {
    if (key === personaState.activePersona) return;

    personaState.activePersona = key;
    const currentSwitch = incrementSwitchCounter();

    // Update URL hash
    window.location.hash = key;

    // Update body theme attribute
    const themeMap = { coo: 'coo', plant: 'plant', demo: 'demo' };
    document.body.setAttribute('data-theme', themeMap[key]);

    // Update active chip
    document.querySelectorAll('.persona-chip').forEach(chip => {
        chip.classList.remove('active');
        if (chip.dataset.persona === key) {
            chip.classList.add('active');
        }
    });

    // Switch sub-nav panel with transition
    document.querySelectorAll('.sub-nav__panel').forEach(panel => {
        if (panel.dataset.panel === key) {
            panel.style.display = 'flex';
            setTimeout(() => {
                if (currentSwitch !== switchCounter) return;
                panel.classList.add('active');
            }, 10);
        } else {
            panel.classList.remove('active');
            setTimeout(() => {
                if (currentSwitch !== switchCounter) return;
                panel.style.display = 'none';
            }, 200);
        }
    });

    // Switch to default view for persona
    const defaultView = personaDefaults[key];
    switchPersonaView(defaultView);
}

/**
 * Switch view within current persona
 * Updates active sub-nav item and shows/hides persona-view divs
 */
export function switchPersonaView(viewKey) {
    personaState.activeView = viewKey;

    // Clean up demo intervals when leaving demo views
    if (!viewKey.startsWith('demo-')) {
        if (typeof demoState !== 'undefined') {
            if (demoState.scenarioStatusInterval) {
                clearInterval(demoState.scenarioStatusInterval);
                demoState.scenarioStatusInterval = null;
            }
            if (demoState.injectionStatusInterval) {
                clearInterval(demoState.injectionStatusInterval);
                demoState.injectionStatusInterval = null;
            }
        }
    }

    // Update active sub-nav item
    const activePanel = document.querySelector(`.sub-nav__panel[data-panel="${personaState.activePersona}"]`);
    if (activePanel) {
        activePanel.querySelectorAll('.sub-nav__item').forEach(item => {
            item.classList.remove('active');
            if (item.dataset.view === viewKey) {
                item.classList.add('active');
            }
        });
    }

    // Show/hide persona views
    document.querySelectorAll('.persona-view').forEach(view => {
        if (view.dataset.view === viewKey) {
            view.classList.add('active');

            // If returning to coo-dashboard, resize charts
            if (viewKey === 'coo-dashboard') {
                setTimeout(() => {
                    if (window.oeeBreakdownChart) window.oeeBreakdownChart.resize();
                    if (window.wasteTrendChart) window.wasteTrendChart.resize();
                    if (window.scrapByLineChart) window.scrapByLineChart.resize();
                }, 100);
            }
        } else {
            view.classList.remove('active');
        }
    });
}

/**
 * Initialize persona navigation system
 */
export function initPersonaNavigation() {
    // Persona chip clicks
    document.querySelectorAll('.persona-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            switchPersona(chip.dataset.persona);
        });
    });

    // Sub-nav item clicks
    document.querySelectorAll('.sub-nav__item').forEach(item => {
        item.addEventListener('click', () => {
            switchPersonaView(item.dataset.view);
        });
    });

    // Keyboard shortcuts (1, 2, 3)
    document.addEventListener('keydown', (e) => {
        // Only if not typing in input/textarea/contenteditable
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.target.isContentEditable) return;

        const keyMap = { '1': 'coo', '2': 'plant', '3': 'demo' };
        if (keyMap[e.key]) {
            switchPersona(keyMap[e.key]);
        }
    });

    // Handle browser back/forward and hash changes
    window.addEventListener('hashchange', () => {
        const hash = window.location.hash.slice(1); // Remove '#' prefix
        const validPersonas = ['coo', 'plant', 'demo'];
        if (validPersonas.includes(hash)) {
            switchPersona(hash);
        }
    });

    // Read initial persona from URL hash, or default to COO
    const initialHash = window.location.hash.slice(1); // Remove '#' prefix
    const validPersonas = ['coo', 'plant', 'demo'];
    const initialPersona = validPersonas.includes(initialHash) ? initialHash : 'coo';
    switchPersona(initialPersona);
}
