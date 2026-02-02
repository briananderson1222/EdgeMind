// STREAM - MQTT message stream display

import { state } from './state.js';
import { escapeHtml } from './utils.js';

/**
 * Add MQTT message to the stream display
 */
export function addMQTTMessageToStream(message) {
    if (state.streamPaused) return;

    const stream = document.getElementById('mqtt-stream');
    if (!stream) return;

    if (state.stats.messageCount === 1) {
        stream.innerHTML = '';
    }

    const timestamp = new Date(message.timestamp).toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3
    });

    const line = document.createElement('div');
    line.className = 'stream-line';

    const topic = message.topic.toLowerCase();
    let eventType = 'other';
    if (topic.includes('oee')) eventType = 'oee';
    else if (topic.includes('state')) eventType = 'state';
    else if (topic.includes('alarm')) eventType = 'alarm';

    line.setAttribute('data-event-type', eventType);

    const escapedTopic = escapeHtml(message.topic);
    const escapedPayload = typeof message.payload === 'object'
        ? escapeHtml(JSON.stringify(message.payload))
        : escapeHtml(String(message.payload));

    line.innerHTML = `
        <span class="stream-timestamp">[${timestamp}]</span>
        <span class="stream-topic">${escapedTopic}</span>
        <span class="stream-value">${escapedPayload}</span>
    `;

    const isAtBottom = stream.scrollHeight - stream.scrollTop <= stream.clientHeight + 10;

    stream.appendChild(line);

    const maxWhileScrolled = 200;
    const normalMax = 50;

    if (isAtBottom) {
        while (stream.children.length > normalMax) {
            stream.removeChild(stream.firstChild);
        }
        stream.scrollTop = stream.scrollHeight;
    } else {
        while (stream.children.length > maxWhileScrolled) {
            stream.removeChild(stream.firstChild);
        }
    }
}

/**
 * Filter events by type
 */
export function filterEvents(eventType, clickedTab) {
    state.eventFilter = eventType;

    document.querySelectorAll('.event-tab:not(.pause-btn)').forEach(tab => {
        tab.classList.remove('active');
    });
    if (clickedTab) clickedTab.classList.add('active');

    const stream = document.getElementById('mqtt-stream');
    if (!stream) return;

    const lines = stream.querySelectorAll('.stream-line');
    lines.forEach(line => {
        const lineEventType = line.getAttribute('data-event-type');
        if (eventType === 'all' || lineEventType === eventType) {
            line.style.display = '';
        } else {
            line.style.display = 'none';
        }
    });
}

/**
 * Toggle stream pause/resume
 */
export function toggleStreamPause() {
    state.streamPaused = !state.streamPaused;

    const pauseBtn = document.getElementById('stream-pause-btn');
    const pauseBtnText = document.getElementById('pause-btn-text');
    const stream = document.getElementById('mqtt-stream');

    if (state.streamPaused) {
        pauseBtn.classList.add('paused');
        pauseBtnText.textContent = '▶ Resume';
        stream.classList.add('paused');
    } else {
        pauseBtn.classList.remove('paused');
        pauseBtnText.textContent = '⏸ Pause';
        stream.classList.remove('paused');
    }
}
