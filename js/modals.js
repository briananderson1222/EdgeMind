// MODALS - All modal dialogs (anomaly, settings, agent, card expansion)

import { state } from './state.js';
import { escapeHtml } from './utils.js';
import { createInsightElement, applyInsightFilter } from './insights.js';

const modalChartInstances = [];

/**
 * Open anomaly details modal
 */
export function openAnomalyModal(anomaly) {
    const overlay = document.getElementById('anomaly-modal-overlay');
    const textEl = document.getElementById('anomaly-modal-text');
    const severityEl = document.getElementById('anomaly-modal-severity');
    const timestampEl = document.getElementById('anomaly-modal-timestamp');
    const reasoningEl = document.getElementById('anomaly-modal-reasoning');

    if (!overlay || !textEl || !severityEl || !timestampEl) return;

    textEl.textContent = anomaly.text || anomaly.description || 'No description available';

    if (reasoningEl) {
        if (anomaly.reasoning) {
            let reasoningHtml = `<div class="reasoning-text">${escapeHtml(anomaly.reasoning)}</div>`;

            if (anomaly.metric || anomaly.actual_value || anomaly.threshold) {
                reasoningHtml += '<div class="reasoning-details">';
                if (anomaly.enterprise) {
                    reasoningHtml += `<div class="reasoning-item"><span class="reasoning-label">Enterprise:</span> ${escapeHtml(anomaly.enterprise)}</div>`;
                }
                if (anomaly.site) {
                    reasoningHtml += `<div class="reasoning-item"><span class="reasoning-label">Site:</span> ${escapeHtml(anomaly.site)}</div>`;
                }
                if (anomaly.area) {
                    reasoningHtml += `<div class="reasoning-item"><span class="reasoning-label">Area:</span> ${escapeHtml(anomaly.area)}</div>`;
                }
                if (anomaly.machine) {
                    reasoningHtml += `<div class="reasoning-item"><span class="reasoning-label">Machine:</span> ${escapeHtml(anomaly.machine)}</div>`;
                }
                if (anomaly.metric) {
                    reasoningHtml += `<div class="reasoning-item"><span class="reasoning-label">Metric:</span> ${escapeHtml(anomaly.metric)}</div>`;
                }
                if (anomaly.actual_value) {
                    reasoningHtml += `<div class="reasoning-item"><span class="reasoning-label">Actual Value:</span> ${escapeHtml(String(anomaly.actual_value))}</div>`;
                }
                if (anomaly.threshold) {
                    reasoningHtml += `<div class="reasoning-item"><span class="reasoning-label">Threshold:</span> ${escapeHtml(String(anomaly.threshold))}</div>`;
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

    const severity = anomaly.severity || 'medium';
    const severityUpper = severity.toUpperCase();
    severityEl.innerHTML = '<span class="anomaly-modal-severity ' + escapeHtml(severity) + '">' + escapeHtml(severityUpper) + '</span>';

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

    overlay.classList.add('active');
}

/**
 * Close anomaly modal
 */
export function closeAnomalyModal() {
    const overlay = document.getElementById('anomaly-modal-overlay');
    if (overlay) {
        overlay.classList.remove('active');
    }
}

/**
 * Open settings modal
 */
export function openSettingsModal() {
    const overlay = document.getElementById('settings-modal-overlay');
    if (!overlay) return;

    document.getElementById('setting-oeeBaseline').value = state.thresholdSettings.oeeBaseline;
    document.getElementById('setting-oeeWorldClass').value = state.thresholdSettings.oeeWorldClass;
    document.getElementById('setting-availabilityMin').value = state.thresholdSettings.availabilityMin;
    document.getElementById('setting-defectRateWarning').value = state.thresholdSettings.defectRateWarning;
    document.getElementById('setting-defectRateCritical').value = state.thresholdSettings.defectRateCritical;

    overlay.classList.add('active');
}

/**
 * Close settings modal
 */
export function closeSettingsModal() {
    const overlay = document.getElementById('settings-modal-overlay');
    if (overlay) {
        overlay.classList.remove('active');
    }
}

/**
 * Save settings
 */
export async function saveSettings() {
    const settings = {
        oeeBaseline: parseFloat(document.getElementById('setting-oeeBaseline').value),
        oeeWorldClass: parseFloat(document.getElementById('setting-oeeWorldClass').value),
        availabilityMin: parseFloat(document.getElementById('setting-availabilityMin').value),
        defectRateWarning: parseFloat(document.getElementById('setting-defectRateWarning').value),
        defectRateCritical: parseFloat(document.getElementById('setting-defectRateCritical').value)
    };

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

/**
 * Open agent modal
 */
export function openAgentModal() {
    const overlay = document.getElementById('agent-modal-overlay');
    const content = document.getElementById('agent-modal-content');
    const countSpan = document.getElementById('modal-anomaly-count');

    if (!overlay || !content) return;

    const insights = state.insights.slice(-20);
    content.innerHTML = '';

    if (insights.length === 0) {
        content.innerHTML = `
            <div class="agent-insights">
                <div class="insight-text">Waiting for data to analyze. Claude will provide real-time insights as factory data flows in...</div>
                <div class="insight-meta">Status: Standby • Waiting for MQTT messages</div>
            </div>
        `;
    } else {
        insights.forEach(insight => {
            renderModalInsight(insight, content);
        });
    }

    if (countSpan) {
        countSpan.textContent = state.anomalies.length;
    }

    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

/**
 * Close agent modal
 */
export function closeAgentModal() {
    const overlay = document.getElementById('agent-modal-overlay');
    if (overlay) {
        overlay.classList.remove('active');
        document.body.style.overflow = '';
    }
}

/**
 * Render modal insight
 */
function renderModalInsight(insight, container) {
    const insightEl = createInsightElement(insight);
    container.appendChild(insightEl);
}

/**
 * Filter modal insights
 */
export function filterModalInsights(filterType, clickedTab) {
    const content = document.getElementById('agent-modal-content');
    if (!content) return;

    if (clickedTab) clickedTab.classList.add('active');

    const onModalAnomalyClick = (anomaly) => {
        closeAgentModal();
        openAnomalyModal(anomaly);
    };

    applyInsightFilter(filterType, content, '.agent-modal-tabs .insight-tab', onModalAnomalyClick);
}

/**
 * Expand card to modal
 */
export function expandCard(cardElement, title) {
    const overlay = document.getElementById('card-modal-overlay');
    const modalTitle = document.getElementById('card-modal-title');
    const modalContent = document.getElementById('card-modal-content');

    if (!overlay || !modalTitle || !modalContent || !cardElement) {
        console.error('Card modal elements not found');
        return;
    }

    const clone = cardElement.cloneNode(true);
    const titleEl = clone.querySelector('.card-title');
    if (titleEl) titleEl.remove();

    const elementsWithIds = clone.querySelectorAll('[id]');
    elementsWithIds.forEach(el => {
        el.id = el.id + '-modal-clone';
    });

    modalTitle.textContent = title;
    modalContent.innerHTML = '';
    modalContent.appendChild(clone);

    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    setTimeout(() => {
        if (typeof reinitChartsInModal === 'function') {
            reinitChartsInModal(modalContent);
        }
    }, 100);
}

/**
 * Reinitialize Chart.js charts in the modal
 */
export function reinitChartsInModal(modalContent) {
    const chartConfigs = [
        {
            originalId: 'oee-breakdown-chart',
            chartInstance: window.oeeBreakdownChart
        },
        {
            originalId: 'waste-trend-chart',
            chartInstance: window.wasteTrendChart
        },
        {
            originalId: 'scrap-by-line-chart',
            chartInstance: window.scrapByLineChart
        }
    ];

    chartConfigs.forEach(({ originalId, chartInstance }) => {
        const clonedId = `${originalId}-modal-clone`;
        const clonedCanvas = modalContent.querySelector(`#${clonedId}`);

        if (clonedCanvas && chartInstance) {
            try {
                const newCanvas = document.createElement('canvas');
                newCanvas.id = clonedId;
                newCanvas.style.maxHeight = '600px';

                clonedCanvas.replaceWith(newCanvas);

                const originalConfig = {
                    type: chartInstance.config.type,
                    data: JSON.parse(JSON.stringify(chartInstance.config.data)),
                    options: JSON.parse(JSON.stringify(chartInstance.config.options))
                };

                if (originalId === 'waste-trend-chart' && chartInstance.config.options.onClick) {
                    originalConfig.options.onClick = (event, activeElements) => {
                        if (activeElements.length > 0) {
                            const index = activeElements[0].index;
                            const newChart = Chart.getChart(clonedId);
                            if (newChart) {
                                const label = newChart.data.labels[index];
                                const value = newChart.data.datasets[0].data[index];
                                const enterprise = newChart.data.datasets[0].enterprises?.[index] || 'Unknown';
                                alert(`Line: ${label}\nEnterprise: ${enterprise}\nTotal Waste/Defects: ${value}`);
                            }
                        }
                    };
                }

                if (!originalConfig.options.responsive) {
                    originalConfig.options.responsive = true;
                }
                if (!originalConfig.options.maintainAspectRatio) {
                    originalConfig.options.maintainAspectRatio = false;
                }

                const ctx = newCanvas.getContext('2d');
                const modalChart = new Chart(ctx, originalConfig);
                modalChartInstances.push(modalChart);

            } catch (error) {
                console.error(`Failed to reinitialize chart ${originalId} in modal:`, error);
            }
        }
    });
}

/**
 * Close card modal
 */
export function closeCardModal() {
    // Destroy modal chart instances to prevent memory leak
    modalChartInstances.forEach(chart => chart.destroy());
    modalChartInstances.length = 0;

    const overlay = document.getElementById('card-modal-overlay');
    if (overlay) {
        overlay.classList.remove('active');
        document.body.style.overflow = '';
    }
}
