// DEMO INJECT - Anomaly injection controls

import { demoState } from './state.js';
import { escapeHtml, formatMs } from './utils.js';

/**
 * Initialize demo inject view
 */
export async function initDemoInject() {
    try {
        if (demoState.scenarioStatusInterval) {
            clearInterval(demoState.scenarioStatusInterval);
            demoState.scenarioStatusInterval = null;
        }

        const response = await fetch('/api/demo/profiles');
        if (!response.ok) {
            throw new Error(`Server returned ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();
        demoState.profiles = data.profiles;

        renderAnomalyTypes();
        setupInjectControls();

        await populateEquipmentDropdown();

        if (demoState.injectionStatusInterval) {
            clearInterval(demoState.injectionStatusInterval);
        }
        demoState.injectionStatusInterval = setInterval(updateInjectionStatus, 2000);
        updateInjectionStatus();

    } catch (error) {
        console.error('Failed to load injection profiles:', error);
        document.getElementById('inject-anomaly-types').innerHTML = `
            <div style="color: var(--accent-red); padding: 10px;">
                Failed to load profiles: ${error.message}
            </div>
        `;
    }
}

/**
 * Populate equipment dropdown
 */
export async function populateEquipmentDropdown() {
    const selectElement = document.getElementById('inject-equipment');
    if (!selectElement) return;

    try {
        const response = await fetch('/api/schema/hierarchy');
        if (!response.ok) {
            throw new Error(`Failed to fetch hierarchy: ${response.status}`);
        }

        const data = await response.json();
        const hierarchy = data.hierarchy;

        if (!hierarchy || Object.keys(hierarchy).length === 0) {
            selectElement.innerHTML = '<option value="" disabled selected>No equipment data available</option>';
            return;
        }

        selectElement.innerHTML = '<option value="" disabled selected>Select equipment...</option>';

        const enterprises = Object.keys(hierarchy).sort();

        for (const enterprise of enterprises) {
            const enterpriseData = hierarchy[enterprise];
            const optgroup = document.createElement('optgroup');
            optgroup.label = enterprise;

            const machines = [];

            for (const siteName in enterpriseData.sites) {
                const site = enterpriseData.sites[siteName];
                for (const areaName in site.areas) {
                    const area = site.areas[areaName];
                    for (const machineName in area.machines) {
                        const fullPath = `${enterprise}/${siteName}/${areaName}/${machineName}`;
                        const label = `${siteName} > ${areaName} > ${machineName}`;
                        machines.push({ fullPath, label, machineName });
                    }
                }
            }

            machines.sort((a, b) => a.label.localeCompare(b.label));

            for (const machine of machines) {
                const option = document.createElement('option');
                option.value = machine.fullPath;
                option.textContent = machine.label;
                optgroup.appendChild(option);
            }

            if (machines.length > 0) {
                selectElement.appendChild(optgroup);
            }
        }

    } catch (error) {
        console.error('Failed to populate equipment dropdown:', error);
        selectElement.innerHTML = '<option value="" disabled selected>Failed to load equipment data</option>';
    }
}

/**
 * Render anomaly types
 */
export function renderAnomalyTypes() {
    const container = document.getElementById('inject-anomaly-types');
    if (!container) return;

    container.innerHTML = demoState.profiles.map(profile => `
        <div class="inject-radio-option">
            <input type="radio" name="anomaly-type" id="type-${profile.type}" value="${profile.type}">
            <label class="inject-radio-label" for="type-${profile.type}">
                ${profile.type}
                <div style="font-size: 0.75rem; opacity: 0.7; margin-top: 4px;">${profile.unit}</div>
            </label>
        </div>
    `).join('');

    if (demoState.profiles.length > 0) {
        document.getElementById(`type-${demoState.profiles[0].type}`).checked = true;
    }
}

/**
 * Setup inject controls
 */
export function setupInjectControls() {
    const durationSlider = document.getElementById('inject-duration');
    const durationValue = document.getElementById('inject-duration-value');
    if (durationSlider && durationValue) {
        durationSlider.oninput = (e) => {
            durationValue.textContent = e.target.value;
        };
    }

    const injectBtn = document.getElementById('inject-start-btn');
    if (injectBtn) {
        injectBtn.onclick = startInjection;
    }
}

/**
 * Start injection
 */
export async function startInjection() {
    const injectBtn = document.getElementById('inject-start-btn');
    try {
        if (injectBtn) injectBtn.disabled = true;

        const equipment = document.getElementById('inject-equipment').value.trim();
        const anomalyTypeRadio = document.querySelector('input[name="anomaly-type"]:checked');
        const severitySlider = document.getElementById('inject-severity');
        const durationSlider = document.getElementById('inject-duration');

        if (!equipment) {
            alert('Please select an equipment from the dropdown');
            return;
        }

        if (!anomalyTypeRadio) {
            alert('Please select an anomaly type');
            return;
        }

        const anomalyType = anomalyTypeRadio.value;
        const severityMap = { '1': 'mild', '2': 'moderate', '3': 'severe' };
        const severity = severityMap[severitySlider.value];
        const durationMs = parseInt(durationSlider.value) * 1000;

        const response = await fetch('/api/demo/inject', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                equipment,
                anomalyType,
                severity,
                durationMs
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to start injection');
        }

        console.log('Injection started:', data);
        updateInjectionStatus();

    } catch (error) {
        console.error('Failed to start injection:', error);
        alert(`Failed to start injection: ${error.message}`);
    } finally {
        if (injectBtn) injectBtn.disabled = false;
    }
}

/**
 * Update injection status
 */
export async function updateInjectionStatus() {
    try {
        const response = await fetch('/api/demo/inject/status');
        if (!response.ok) {
            throw new Error(`Server returned ${response.status}: ${response.statusText}`);
        }
        const status = await response.json();

        demoState.activeInjections = status.active;

        const countEl = document.getElementById('inject-concurrent-count');
        const maxEl = document.getElementById('inject-concurrent-max');
        if (countEl) countEl.textContent = status.count;
        if (maxEl) maxEl.textContent = status.maxConcurrent;

        const injectBtn = document.getElementById('inject-start-btn');
        if (injectBtn) {
            injectBtn.disabled = status.count >= status.maxConcurrent;
        }

        renderActiveInjections(status.active);

    } catch (error) {
        console.error('Failed to update injection status:', error);
    }
}

/**
 * Render active injections
 */
export function renderActiveInjections(injections) {
    const container = document.getElementById('active-injections-list');
    if (!container) return;

    if (injections.length === 0) {
        container.innerHTML = '<div class="no-injections">No active injections</div>';
        return;
    }

    container.innerHTML = injections.map(inj => `
        <div class="injection-item">
            <div class="injection-header">
                <div class="injection-title">${escapeHtml(inj.equipment)} - ${escapeHtml(inj.anomalyType)} (${escapeHtml(inj.severity)})</div>
                <button class="injection-stop-btn" onclick="stopInjection('${escapeHtml(inj.id)}')">STOP</button>
            </div>
            <div class="injection-details">
                <div class="injection-detail">
                    <strong>Equipment</strong>
                    ${escapeHtml(inj.equipment)}
                </div>
                <div class="injection-detail">
                    <strong>Type</strong>
                    ${escapeHtml(inj.anomalyType)}
                </div>
                <div class="injection-detail">
                    <strong>Severity</strong>
                    ${escapeHtml(inj.severity)}
                </div>
                <div class="injection-detail">
                    <strong>Remaining</strong>
                    ${formatMs(inj.timing.remainingMs)}
                </div>
            </div>
            <div class="injection-progress-bar">
                <div class="injection-progress-fill" style="width: ${Math.min(100, Math.max(0, inj.timing.progress))}%"></div>
            </div>
        </div>
    `).join('');
}

/**
 * Stop injection
 */
export async function stopInjection(injectionId) {
    const injectionItems = document.querySelectorAll('.injection-item');
    let stopBtn = null;
    injectionItems.forEach(item => {
        const btn = item.querySelector('.injection-stop-btn');
        if (btn && btn.getAttribute('onclick').includes(injectionId)) {
            stopBtn = btn;
        }
    });

    try {
        if (stopBtn) stopBtn.disabled = true;

        const response = await fetch('/api/demo/inject/stop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ injectionId })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to stop injection');
        }

        console.log('Injection stopped:', data);
        updateInjectionStatus();

    } catch (error) {
        console.error('Failed to stop injection:', error);
        alert(`Failed to stop injection: ${error.message}`);
    } finally {
        if (stopBtn) stopBtn.disabled = false;
    }
}
