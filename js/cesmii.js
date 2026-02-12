// PLANT MANAGER - CESMII WORK ORDERS VIEW
// Displays incoming CESMII SM Profile work orders with real-time updates

import { state } from './state.js';
import { escapeHtml } from './utils.js';

let refreshInterval = null;
let abortController = null;

/**
 * Format timestamp for display
 */
function formatTime(timestamp) {
    if (!timestamp) return '';
    try {
        const d = new Date(timestamp);
        return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
        return '';
    }
}

/**
 * Render a single work order card
 */
function renderWorkOrderCard(wo) {
    const p = wo.payload || {};
    const validationClass = wo.validationStatus === 'invalid' ? 'validation-invalid' :
                           wo.validationStatus === 'no_profile' ? 'validation-warning' : '';

    const woId = escapeHtml(p.WorkOrderId || wo.id);
    const product = escapeHtml(p.ProductName || 'Unknown Product');
    const quantity = typeof p.Quantity === 'number' ? p.Quantity.toLocaleString() : '—';
    const uom = escapeHtml(p.UnitOfMeasure || '');
    const status = escapeHtml(p.Status || 'Unknown');
    const priority = escapeHtml(String(p.Priority != null ? p.Priority : '---'));
    const time = formatTime(wo.timestamp);
    const enterprise = escapeHtml(wo.enterprise || '');

    let ingredientsHtml = '';
    if (Array.isArray(p.Ingredients) && p.Ingredients.length > 0) {
        const items = p.Ingredients.map(ing => `
            <div class="cesmii-ingredient">
                <span class="ingredient-name">${escapeHtml(ing.IngredientName || 'Unknown')}</span>
                <span class="ingredient-qty">${typeof ing.Quantity === 'number' ? ing.Quantity : '—'} ${escapeHtml(ing.UnitOfMeasure || '')}</span>
            </div>
        `).join('');

        ingredientsHtml = `
            <div class="cesmii-ingredient-list">
                <h4>Ingredients (${p.Ingredients.length})</h4>
                ${items}
            </div>
        `;
    }

    return `
        <div class="cesmii-work-order-card ${validationClass}">
            <div class="cesmii-wo-header">
                <span class="cesmii-wo-id">${woId}</span>
                <span class="cesmii-validation-badge ${escapeHtml(wo.validationStatus || 'unknown')}">${escapeHtml(wo.validationStatus || 'unknown')}</span>
            </div>
            <div class="cesmii-wo-product">${product}</div>
            <div class="cesmii-wo-meta">
                <span>Qty: ${quantity} ${uom}</span>
                <span>Status: ${status}</span>
                <span>Priority: ${priority}</span>
                <span>${enterprise}</span>
            </div>
            <div class="cesmii-wo-time">${time}</div>
            ${ingredientsHtml}
        </div>
    `;
}

/**
 * Render work orders list
 */
function renderWorkOrders(workOrders) {
    const listEl = document.getElementById('cesmii-work-orders-list');
    if (!listEl) return;

    if (!workOrders || workOrders.length === 0) {
        listEl.innerHTML = '<div class="view-loading">No CESMII work orders received yet</div>';
        return;
    }

    // Show newest first
    const sorted = [...workOrders].reverse();
    listEl.innerHTML = sorted.map(renderWorkOrderCard).join('');
}

/**
 * Render stats bar
 */
function renderStats(stats) {
    const el = document.getElementById('cesmii-stats');
    if (!el || !stats) return;

    el.innerHTML = `
        <span class="stat-item">Received: <span class="stat-value">${escapeHtml(String(stats.workOrdersReceived || 0))}</span></span>
        <span class="stat-item">Valid: <span class="stat-value">${escapeHtml(String(stats.workOrdersValidated || 0))}</span></span>
        <span class="stat-item">Failed: <span class="stat-value">${escapeHtml(String(stats.workOrdersFailed || 0))}</span></span>
    `;
}

/**
 * Render profiles list
 */
function renderProfiles(profiles) {
    const listEl = document.getElementById('cesmii-profiles-list');
    if (!listEl) return;

    if (!profiles || profiles.length === 0) {
        listEl.innerHTML = '<div class="view-loading">No profiles loaded</div>';
        return;
    }

    listEl.innerHTML = profiles.map(p => `
        <div class="cesmii-profile-card">
            <div class="cesmii-profile-name">${escapeHtml(p.name)} v${escapeHtml(p.version)}</div>
            <div class="cesmii-profile-meta">${escapeHtml(p.description)} &middot; ${parseInt(p.attributeCount, 10) || 0} attributes</div>
        </div>
    `).join('');
}

/**
 * Fetch and render data
 */
async function fetchAndRender() {
    try {
        // Fetch work orders
        const woRes = await fetch('/api/cesmii/work-orders?limit=50', {
            signal: abortController?.signal
        });
        if (woRes.ok) {
            const data = await woRes.json();
            state.cesmiiWorkOrders = data.workOrders || [];
            renderWorkOrders(state.cesmiiWorkOrders);
        }

        // Fetch stats
        const statsRes = await fetch('/api/cesmii/stats', {
            signal: abortController?.signal
        });
        if (statsRes.ok) {
            const stats = await statsRes.json();
            renderStats(stats);
        }
    } catch (error) {
        // Ignore abort errors
        if (error.name === 'AbortError') return;

        console.error('CESMII fetch error:', error);
        const listEl = document.getElementById('cesmii-work-orders-list');
        if (listEl) {
            listEl.innerHTML = '<div class="view-loading" style="color: var(--accent-red);">Failed to load CESMII data</div>';
        }
    }
}

/**
 * Fetch and render profiles (only once)
 */
async function fetchProfiles() {
    try {
        const res = await fetch('/api/cesmii/profiles', {
            signal: abortController?.signal
        });
        if (res.ok) {
            const data = await res.json();
            renderProfiles(data.profiles || []);
        }
    } catch (error) {
        // Ignore abort errors
        if (error.name === 'AbortError') return;

        console.error('CESMII profiles fetch error:', error);
    }
}

/**
 * Handle real-time work order from WebSocket
 */
export function handleRealtimeWorkOrder(data) {
    if (!data) return;

    // Add to state
    if (!state.cesmiiWorkOrders) state.cesmiiWorkOrders = [];
    state.cesmiiWorkOrders.push(data);
    if (state.cesmiiWorkOrders.length > 100) {
        state.cesmiiWorkOrders.shift();
    }

    // If the CESMII view is currently visible, prepend the card
    const listEl = document.getElementById('cesmii-work-orders-list');
    if (listEl) {
        // Remove "no work orders" placeholder if present
        const placeholder = listEl.querySelector('.view-loading');
        if (placeholder) placeholder.remove();

        const cardHtml = renderWorkOrderCard(data);
        listEl.insertAdjacentHTML('afterbegin', cardHtml);

        // Cap displayed cards at 50
        while (listEl.children.length > 50) {
            listEl.removeChild(listEl.lastChild);
        }
    }

    // Update stats if visible
    renderStats(data.cesmiiStats || {
        workOrdersReceived: state.cesmiiWorkOrders.length,
        workOrdersValidated: state.cesmiiWorkOrders.filter(wo => wo.validationStatus === 'valid').length,
        workOrdersFailed: state.cesmiiWorkOrders.filter(wo => wo.validationStatus === 'invalid').length
    });
}

/**
 * Initialize CESMII view
 */
export async function init() {
    // Clean up any previous initialization
    cleanup();

    // Create new abort controller for this initialization
    abortController = new AbortController();

    await fetchAndRender();
    await fetchProfiles();
    refreshInterval = setInterval(fetchAndRender, 30000);
}

/**
 * Cleanup CESMII view
 */
export function cleanup() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }
    if (abortController) {
        abortController.abort();
        abortController = null;
    }
}
