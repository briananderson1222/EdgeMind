// DEMO SCENARIOS - Scenario selector and launcher

import { demoState } from './state.js';
import { escapeHtml, formatMs } from './utils.js';

/**
 * Initialize demo scenarios view
 */
export async function initDemoScenarios() {
    try {
        if (demoState.injectionStatusInterval) {
            clearInterval(demoState.injectionStatusInterval);
            demoState.injectionStatusInterval = null;
        }

        const response = await fetch('/api/demo/scenarios');
        if (!response.ok) {
            throw new Error(`Server returned ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();
        demoState.scenarios = data.scenarios;

        renderScenarios();

        if (demoState.scenarioStatusInterval) {
            clearInterval(demoState.scenarioStatusInterval);
        }
        demoState.scenarioStatusInterval = setInterval(updateScenarioStatus, 2000);
        updateScenarioStatus();

    } catch (error) {
        console.error('Failed to load scenarios:', error);
        document.getElementById('scenario-grid').innerHTML = `
            <div class="scenario-loading" style="color: var(--accent-red);">
                Failed to load scenarios: ${error.message}
            </div>
        `;
    }
}

/**
 * Render scenarios grid
 */
export function renderScenarios() {
    const grid = document.getElementById('scenario-grid');
    if (!grid) return;

    if (demoState.scenarios.length === 0) {
        grid.innerHTML = '<div class="scenario-loading">No scenarios available</div>';
        return;
    }

    grid.innerHTML = demoState.scenarios.map(scenario => `
        <div class="scenario-card" data-scenario-id="${escapeHtml(scenario.id)}">
            <div class="scenario-card-header">
                <div class="scenario-name">${escapeHtml(scenario.name)}</div>
                <div class="scenario-duration-badge">${escapeHtml(String(scenario.durationMinutes))} min</div>
            </div>
            <div class="scenario-description">${escapeHtml(scenario.description)}</div>
            <div class="scenario-equipment">Equipment: ${escapeHtml(scenario.equipment)}</div>

            <div class="scenario-progress" id="progress-${escapeHtml(scenario.id)}" style="display: none;">
                <div class="scenario-progress-bar">
                    <div class="scenario-progress-fill" id="progress-fill-${escapeHtml(scenario.id)}" style="width: 0%"></div>
                </div>
                <div class="scenario-progress-text">
                    <span id="progress-elapsed-${escapeHtml(scenario.id)}">0:00</span>
                    <span id="progress-remaining-${escapeHtml(scenario.id)}">0:00</span>
                </div>
                <div class="scenario-current-step" id="current-step-${escapeHtml(scenario.id)}"></div>
            </div>

            <button class="scenario-btn" id="launch-btn-${escapeHtml(scenario.id)}" onclick="launchScenario('${escapeHtml(scenario.id)}')">
                LAUNCH SCENARIO
            </button>
            <button class="scenario-btn scenario-btn-stop" id="stop-btn-${escapeHtml(scenario.id)}" style="display: none;" onclick="stopScenario()">
                STOP SCENARIO
            </button>
        </div>
    `).join('');
}

/**
 * Update scenario status
 */
export async function updateScenarioStatus() {
    try {
        const response = await fetch('/api/demo/scenario/status');
        if (!response.ok) {
            throw new Error(`Server returned ${response.status}: ${response.statusText}`);
        }
        const status = await response.json();

        demoState.activeScenario = status.active ? status : null;

        demoState.scenarios.forEach(scenario => {
            const isActive = status.active && status.scenario.id === scenario.id;
            const launchBtn = document.getElementById(`launch-btn-${scenario.id}`);
            const stopBtn = document.getElementById(`stop-btn-${scenario.id}`);
            const progressDiv = document.getElementById(`progress-${scenario.id}`);

            if (isActive) {
                if (progressDiv) progressDiv.style.display = 'block';
                if (launchBtn) launchBtn.style.display = 'none';
                if (stopBtn) stopBtn.style.display = 'block';

                const progressFill = document.getElementById(`progress-fill-${scenario.id}`);
                if (progressFill) progressFill.style.width = `${status.timing.progress}%`;

                const elapsedEl = document.getElementById(`progress-elapsed-${scenario.id}`);
                const remainingEl = document.getElementById(`progress-remaining-${scenario.id}`);
                if (elapsedEl) elapsedEl.textContent = formatMs(status.timing.elapsedMs);
                if (remainingEl) remainingEl.textContent = formatMs(status.timing.remainingMs);

                const currentStepEl = document.getElementById(`current-step-${scenario.id}`);
                if (currentStepEl && status.steps && status.steps.length > 0) {
                    const activeSteps = status.steps.filter(s => s.elapsedMs < 999999);
                    if (activeSteps.length > 0) {
                        currentStepEl.textContent = `Step ${activeSteps.length}/${status.steps.length}: ${activeSteps[0].topic.split('/').pop()}`;
                    }
                }
            } else {
                if (progressDiv) progressDiv.style.display = 'none';
                if (stopBtn) stopBtn.style.display = 'none';
                if (launchBtn) {
                    launchBtn.style.display = 'block';
                    launchBtn.disabled = status.active;
                }
            }
        });

    } catch (error) {
        console.error('Failed to update scenario status:', error);
    }
}

/**
 * Launch scenario
 */
export async function launchScenario(scenarioId) {
    const btn = document.getElementById(`launch-btn-${scenarioId}`);
    try {
        if (btn) btn.disabled = true;

        const response = await fetch('/api/demo/scenario/launch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scenarioId })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to launch scenario');
        }

        console.log('Scenario launched:', data);
        updateScenarioStatus();

    } catch (error) {
        console.error('Failed to launch scenario:', error);
        alert(`Failed to launch scenario: ${error.message}`);
    } finally {
        if (btn) btn.disabled = false;
    }
}

/**
 * Stop scenario
 */
export async function stopScenario() {
    const stopBtn = document.querySelector('.scenario-btn-stop[style*="display: block"]');
    try {
        if (stopBtn) stopBtn.disabled = true;

        const response = await fetch('/api/demo/scenario/stop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to stop scenario');
        }

        console.log('Scenario stopped:', data);
        updateScenarioStatus();

    } catch (error) {
        console.error('Failed to stop scenario:', error);
        alert(`Failed to stop scenario: ${error.message}`);
    } finally {
        if (stopBtn) stopBtn.disabled = false;
    }
}
