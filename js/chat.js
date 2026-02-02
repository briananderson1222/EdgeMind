// CHAT - Chat panel functionality

import { connection } from './state.js';
import { escapeHtml } from './utils.js';

/**
 * Toggle chat panel
 */
export function toggleChatPanel() {
    const chatPanel = document.getElementById('chat-panel');
    const toggleBtn = document.getElementById('chat-toggle-btn');

    if (!chatPanel || !toggleBtn) return;

    connection.isChatPanelOpen = !connection.isChatPanelOpen;

    if (connection.isChatPanelOpen) {
        chatPanel.classList.add('active');
        toggleBtn.style.display = 'none';

        const input = document.getElementById('chat-input');
        if (input) {
            setTimeout(() => input.focus(), 300);
        }
    } else {
        chatPanel.classList.remove('active');
        toggleBtn.style.display = 'block';
    }
}

/**
 * Append message to chat
 */
export function appendToChat(role, message) {
    const chatMessages = document.getElementById('chat-messages');
    if (!chatMessages) return;

    const suggestedQuestions = chatMessages.querySelector('.suggested-questions');
    const welcomeMsg = chatMessages.querySelector('.chat-welcome');
    if (suggestedQuestions) suggestedQuestions.remove();
    if (welcomeMsg) welcomeMsg.remove();

    const messageEl = document.createElement('div');
    messageEl.className = `chat-message ${role}`;

    const escapedMessage = escapeHtml(message);
    messageEl.innerHTML = escapedMessage;

    chatMessages.appendChild(messageEl);

    chatMessages.scrollTop = chatMessages.scrollHeight;
}

/**
 * Ask agent a question
 */
export async function askAgent(question) {
    if (!question || !question.trim()) return;

    try {
        appendToChat('user', question);

        appendToChat('loading', 'Agent is thinking...');

        const response = await fetch('/api/agent/ask', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                question: question,
                sessionId: connection.chatSessionId
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        const chatMessages = document.getElementById('chat-messages');
        const loadingMsg = chatMessages.querySelector('.chat-message.loading');
        if (loadingMsg) loadingMsg.remove();

        if (data.sessionId) {
            connection.chatSessionId = data.sessionId;
        }

        appendToChat('agent', data.answer || 'Sorry, I could not process your request.');

    } catch (error) {
        console.error('Failed to ask agent:', error);

        const chatMessages = document.getElementById('chat-messages');
        const loadingMsg = chatMessages.querySelector('.chat-message.loading');
        if (loadingMsg) loadingMsg.remove();

        appendToChat('agent', 'Sorry, I encountered an error. Please try again later.');
    }
}

/**
 * Send chat message
 */
export function sendChatMessage() {
    const input = document.getElementById('chat-input');
    if (!input) return;

    const question = input.value.trim();
    if (!question) return;

    input.value = '';

    askAgent(question);
}

/**
 * Handle suggested question
 */
export function handleSuggestedQuestion(question) {
    askAgent(question);
}

/**
 * Ask Claude a question (legacy)
 */
export function askClaude(question) {
    if (!connection.isConnected) {
        alert('Not connected to backend!');
        return;
    }

    connection.ws.send(JSON.stringify({
        type: 'ask_claude',
        question: question
    }));
}

/**
 * Display Claude's response to a question (legacy)
 */
export function displayClaudeResponse(data) {
    console.log('Claude says:', data.answer);
    alert(`Q: ${data.question}\n\nA: ${data.answer}`);
}
