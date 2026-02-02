// DEMO TIMER - Reset controls and presentation timer

import { demoState, personaState } from './state.js';
import { updateScenarioStatus } from './demo-scenarios.js';
import { updateInjectionStatus } from './demo-inject.js';

/**
 * Demo reset data
 */
export async function demoResetData(type) {
    const confirmMessages = {
        'injected-data': 'Reset all injected data? This will stop active injections and clear demo data points.',
        'all-scenarios': 'Reset all scenarios? This will stop running scenarios and clear scenario data.',
        'full': 'FULL RESET? This will stop all scenarios and injections, and clear ALL demo data. This cannot be undone!'
    };

    if (!confirm(confirmMessages[type])) {
        return;
    }

    const resetButtons = document.querySelectorAll('.reset-btn');
    let triggerBtn = null;
    resetButtons.forEach(btn => {
        const onclick = btn.getAttribute('onclick');
        if (onclick && onclick.includes(`'${type}'`)) {
            triggerBtn = btn;
        }
    });

    try {
        if (triggerBtn) triggerBtn.disabled = true;

        const response = await fetch('/api/demo/reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to reset data');
        }

        console.log('Reset completed:', data);
        alert(`Reset completed successfully:\n${JSON.stringify(data.results, null, 2)}`);

        if (personaState.activeView === 'demo-scenarios') {
            updateScenarioStatus();
        } else if (personaState.activeView === 'demo-inject') {
            updateInjectionStatus();
        }

    } catch (error) {
        console.error('Failed to reset data:', error);
        alert(`Failed to reset data: ${error.message}`);
    } finally {
        if (triggerBtn) triggerBtn.disabled = false;
    }
}

/**
 * Set timer preset
 */
export function setTimerPreset(seconds) {
    if (demoState.timerRunning) {
        pauseTimer();
    }

    demoState.timerSeconds = seconds;
    updateTimerDisplay();
    updateTimerStatus('Ready');

    const display = document.getElementById('timer-display');
    if (display) display.classList.remove('timer-warning');
}

/**
 * Set timer custom
 */
export function setTimerCustom() {
    const input = document.getElementById('timer-custom-input');
    const minutes = parseInt(input.value);

    if (!minutes || minutes < 1 || minutes > 120) {
        alert('Please enter a valid duration (1-120 minutes)');
        return;
    }

    demoState.timerSeconds = minutes * 60;
    updateTimerDisplay();
    updateTimerStatus('Ready');
    input.value = '';
}

/**
 * Start timer
 */
export function startTimer() {
    if (demoState.timerSeconds <= 0) {
        alert('Please set a timer duration first');
        return;
    }

    demoState.timerRunning = true;
    updateTimerButtons();

    const display = document.getElementById('timer-display');
    if (display) display.classList.remove('timer-warning');

    demoState.timerInterval = setInterval(() => {
        demoState.timerSeconds = Math.max(0, demoState.timerSeconds - 1);

        updateTimerDisplay();

        if (demoState.timerSeconds <= demoState.timerWarningThreshold) {
            display.classList.add('timer-warning');
        }

        if (demoState.timerSeconds <= 0) {
            pauseTimer();
            updateTimerStatus('Time\'s Up!');

            const audioEnabled = document.getElementById('timer-audio-enabled').checked;
            if (audioEnabled) {
                playTimerAlert();
            }
        }
    }, 1000);

    updateTimerStatus('Running');
}

/**
 * Pause timer
 */
export function pauseTimer() {
    demoState.timerRunning = false;
    if (demoState.timerInterval) {
        clearInterval(demoState.timerInterval);
        demoState.timerInterval = null;
    }
    updateTimerButtons();
    updateTimerStatus('Paused');
}

/**
 * Reset timer
 */
export function resetTimer() {
    pauseTimer();
    demoState.timerSeconds = 0;
    updateTimerDisplay();
    updateTimerStatus('Ready');

    const display = document.getElementById('timer-display');
    if (display) display.classList.remove('timer-warning');
}

/**
 * Update timer display
 */
export function updateTimerDisplay() {
    const display = document.getElementById('timer-display');
    if (!display) return;

    const minutes = Math.floor(demoState.timerSeconds / 60);
    const seconds = demoState.timerSeconds % 60;
    display.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Update timer status
 */
function updateTimerStatus(status) {
    const statusEl = document.getElementById('timer-status');
    if (statusEl) statusEl.textContent = status;
}

/**
 * Update timer buttons
 */
export function updateTimerButtons() {
    const startBtn = document.getElementById('timer-start-btn');
    const pauseBtn = document.getElementById('timer-pause-btn');

    if (startBtn) startBtn.disabled = demoState.timerRunning;
    if (pauseBtn) pauseBtn.disabled = !demoState.timerRunning;
}

/**
 * Play timer alert
 */
export function playTimerAlert() {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.value = 800;
        oscillator.type = 'sine';

        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.5);

        oscillator.onended = () => audioContext.close();
    } catch (error) {
        console.error('Failed to play timer alert:', error);
    }
}
