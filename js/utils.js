// UTILITY FUNCTIONS - Pure helpers with no state dependencies

/**
 * Escape HTML to prevent XSS attacks
 */
export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Format milliseconds to M:SS
 */
export function formatMs(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Extract measurement name from MQTT topic (matches server logic)
 */
export function topicToMeasurement(topic) {
    const parts = topic.split('/');
    if (parts.length >= 2) {
        return parts.slice(-2).join('_').replace(/[^a-zA-Z0-9_]/g, '_');
    }
    return topic.replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * Helper to convert state.selectedFactory to proper enterprise parameter
 */
export function getEnterpriseParam(state) {
    if (state.selectedFactory === 'ALL') return 'ALL';
    if (state.selectedFactory === 'A') return 'Enterprise A';
    if (state.selectedFactory === 'B') return 'Enterprise B';
    if (state.selectedFactory === 'C') return 'Enterprise C';
    return state.selectedFactory;
}

/**
 * Filter anomalies by enterprise selection
 */
export function filterAnomaliesByEnterprise(anomalies, enterprise) {
    if (enterprise === 'ALL') return anomalies;
    return anomalies.filter(a =>
        a.enterprise === enterprise ||
        (!a.enterprise && a.text && a.text.includes(enterprise))
    );
}
