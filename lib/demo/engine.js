// lib/demo/engine.js - Demo Scenario Engine
// Core logic for running demo scenarios and ad-hoc anomaly injections

const express = require('express');
const DEMO_SCENARIOS = require('./scenarios');
const ANOMALY_PROFILES = require('./profiles');
const CONFIG = require('../config');

/**
 * ScenarioRunner - Manages execution of pre-configured demo scenarios
 *
 * Features:
 * - Single scenario execution at a time
 * - Multi-step scenarios with timed delays
 * - Ramp value generator with noise
 * - Timer cleanup on stop
 * - Status reporting
 */
class ScenarioRunner {
  constructor() {
    this.mqttClient = null;
    this.currentScenario = null;
    this.startTime = null;
    this.timers = []; // Track all setTimeout/setInterval IDs for cleanup
    this.stepStates = []; // Track active step states for status reporting
  }

  /**
   * Initialize the runner with MQTT client
   * @param {Object} params - Initialization parameters
   * @param {Object} params.mqttClient - Authenticated MQTT client
   */
  init({ mqttClient }) {
    this.mqttClient = mqttClient;
    console.log('[DEMO ENGINE] ScenarioRunner initialized');
  }

  /**
   * Start a demo scenario
   * @param {string} scenarioId - ID of scenario to run
   * @returns {Object} Status object
   */
  start(scenarioId) {
    // Reject if a scenario is already running
    if (this.currentScenario) {
      throw new Error(`Scenario "${this.currentScenario.id}" is already running. Stop it first.`);
    }

    // Reject if MQTT client not initialized
    if (!this.mqttClient || !this.mqttClient.connected) {
      throw new Error('MQTT client not connected. Cannot start scenario.');
    }

    // Find scenario
    const scenario = DEMO_SCENARIOS.find(s => s.id === scenarioId);
    if (!scenario) {
      throw new Error(`Unknown scenario: ${scenarioId}`);
    }

    console.log(`[DEMO ENGINE] Starting scenario: ${scenario.name}`);

    // Validate durationMs to prevent premature stop
    if (!scenario.durationMs || typeof scenario.durationMs !== 'number' || scenario.durationMs <= 0) {
      throw new Error(`Invalid scenario durationMs: ${scenario.durationMs}. Must be a positive number.`);
    }

    this.currentScenario = scenario;
    this.startTime = Date.now();
    this.stepStates = [];

    // Schedule each step
    scenario.steps.forEach((step, index) => {
      const startTimer = setTimeout(() => {
        this._executeStep(step, index);
      }, step.delayMs);

      this.timers.push(startTimer);
    });

    // Auto-stop after scenario duration
    const stopTimer = setTimeout(() => {
      console.log(`[DEMO ENGINE] Scenario "${scenario.name}" completed`);
      this.stop();
    }, scenario.durationMs);

    this.timers.push(stopTimer);

    return this.getStatus();
  }

  /**
   * Execute a single scenario step
   * @param {Object} step - Step configuration
   * @param {number} index - Step index for tracking
   * @private
   */
  _executeStep(step, index) {
    console.log(`[DEMO ENGINE] Starting step ${index + 1}: ${step.topic}`);

    // Validate step parameters
    if (!step.params.durationMs || typeof step.params.durationMs !== 'number' || step.params.durationMs <= 0) {
      console.error(`[DEMO ENGINE] Step ${index + 1} has invalid durationMs: ${step.params.durationMs}, skipping`);
      return;
    }
    if (!step.params.intervalMs || typeof step.params.intervalMs !== 'number' || step.params.intervalMs <= 0) {
      console.error(`[DEMO ENGINE] Step ${index + 1} has invalid intervalMs: ${step.params.intervalMs}, skipping`);
      return;
    }

    const stepState = {
      index,
      topic: step.topic,
      generator: step.generator,
      params: step.params,
      startTime: Date.now(),
      publishCount: 0
    };

    this.stepStates.push(stepState);

    // Declare interval before publishValue closure to avoid forward-reference
    let interval = null;

    // Extract publish logic into a function so we can call it immediately AND on interval
    const publishValue = () => {
      const elapsed = Date.now() - stepState.startTime;

      // Stop if step duration exceeded
      if (elapsed >= step.params.durationMs) {
        if (interval) clearInterval(interval);
        console.log(`[DEMO ENGINE] Step ${index + 1} completed (${stepState.publishCount} publishes)`);
        return;
      }

      // Generate value
      const value = this._generateValue(step.generator, step.params, elapsed);

      // Pre-publish debug: confirms code path is reached
      console.log(`[DEMO ENGINE] Publishing: ${step.topic} = ${value.toFixed(2)} (qos:0)`);

      // Publish to MQTT - QoS 0 (fire-and-forget) so callback fires immediately
      this.mqttClient.publish(step.topic, String(value), { qos: 0 }, (err) => {
        if (err) {
          console.error(`[DEMO ENGINE] Publish error: ${err.message}`);
        } else {
          stepState.publishCount++;
          console.log(`[DEMO ENGINE] Published: ${step.topic} = ${value.toFixed(2)}`);
        }
      });
    };

    // Call immediately to publish the first value
    publishValue();

    // Create interval for repeated publishing
    interval = setInterval(publishValue, step.params.intervalMs);

    this.timers.push(interval);
  }

  /**
   * Generate a value using the specified generator
   * @param {string} generator - Generator type ('ramp', 'spike', 'constant')
   * @param {Object} params - Generator parameters
   * @param {number} elapsed - Milliseconds elapsed since step start
   * @returns {number} Generated value
   * @private
   */
  _generateValue(generator, params, elapsed) {
    let value = 0;

    switch (generator) {
      case 'ramp': {
        // Linear interpolation from startValue to endValue
        const progress = Math.min(1, elapsed / params.durationMs);
        value = params.startValue + (params.endValue - params.startValue) * progress;
        break;
      }

      case 'spike': {
        // Sharp spike then gradual decay
        const spikeProgress = Math.min(1, elapsed / params.durationMs);
        if (spikeProgress < 0.1) {
          // Quick rise to peak
          value = params.startValue + (params.endValue - params.startValue) * (spikeProgress / 0.1);
        } else {
          // Gradual decay back to start
          const decayProgress = (spikeProgress - 0.1) / 0.9;
          value = params.endValue - (params.endValue - params.startValue) * decayProgress;
        }
        break;
      }

      case 'constant':
        // Constant value with noise
        value = params.value || params.startValue;
        break;

      default:
        console.warn(`[DEMO ENGINE] Unknown generator type: ${generator}, defaulting to constant`);
        value = params.startValue;
    }

    // Add noise for realism
    if (params.noise && params.noise > 0) {
      const noiseFactor = (Math.random() - 0.5) * 2 * params.noise;
      value += noiseFactor;
    }

    return value;
  }

  /**
   * Stop the current scenario
   */
  stop() {
    if (!this.currentScenario) {
      console.log('[DEMO ENGINE] No scenario is running');
      return;
    }

    // Calculate elapsed time for diagnostics
    const elapsed = this.startTime ? Date.now() - this.startTime : 0;
    const elapsedSeconds = (elapsed / 1000).toFixed(2);

    console.log(`[DEMO ENGINE] Stopping scenario: ${this.currentScenario.name} (ran for ${elapsedSeconds}s)`);

    // Log publish counts for each step
    if (this.stepStates.length > 0) {
      console.log(`[DEMO ENGINE] Step publish counts:`);
      this.stepStates.forEach((step, idx) => {
        console.log(`  Step ${idx + 1}: ${step.publishCount} messages published`);
      });
    } else {
      console.log(`[DEMO ENGINE] WARNING: No steps executed before stop was called`);
    }

    // Clear all timers and intervals
    this.timers.forEach(timer => {
      clearTimeout(timer);
      clearInterval(timer);
    });

    this.timers = [];
    this.stepStates = [];
    this.currentScenario = null;
    this.startTime = null;
  }

  /**
   * Get current scenario status
   * @returns {Object} Status information
   */
  getStatus() {
    if (!this.currentScenario) {
      return {
        active: false,
        scenario: null
      };
    }

    const elapsed = Date.now() - this.startTime;
    const remaining = Math.max(0, this.currentScenario.durationMs - elapsed);

    return {
      active: true,
      scenario: {
        id: this.currentScenario.id,
        name: this.currentScenario.name,
        description: this.currentScenario.description,
        equipment: this.currentScenario.equipment
      },
      timing: {
        startTime: this.startTime,
        elapsedMs: elapsed,
        remainingMs: remaining,
        durationMs: this.currentScenario.durationMs,
        progress: Math.min(100, (elapsed / this.currentScenario.durationMs) * 100)
      },
      steps: this.stepStates.map(step => ({
        topic: step.topic,
        generator: step.generator,
        publishCount: step.publishCount,
        elapsedMs: Date.now() - step.startTime
      }))
    };
  }
}

/**
 * InjectionManager - Manages ad-hoc anomaly injections
 *
 * Features:
 * - Multiple concurrent injections (up to MAX_CONCURRENT)
 * - Equipment-based targeting
 * - Severity-based value generation
 * - Automatic cleanup after duration
 */
class InjectionManager {
  constructor() {
    this.mqttClient = null;
    this.injections = new Map(); // Map<injectionId, InjectionState>
    this.nextId = 1;
  }

  /**
   * Initialize the manager with MQTT client
   * @param {Object} params - Initialization parameters
   * @param {Object} params.mqttClient - Authenticated MQTT client
   */
  init({ mqttClient }) {
    this.mqttClient = mqttClient;
    console.log('[DEMO ENGINE] InjectionManager initialized');
  }

  /**
   * Start an ad-hoc anomaly injection
   * @param {Object} params - Injection parameters
   * @param {string} params.equipment - Equipment identifier (e.g., "filler", "vat01")
   * @param {string} params.anomalyType - Type from ANOMALY_PROFILES
   * @param {string} params.severity - 'mild' | 'moderate' | 'severe'
   * @param {number} params.durationMs - How long to inject data
   * @returns {Object} Injection status
   */
  start({ equipment, anomalyType, severity, durationMs }) {
    // Validate concurrent injection limit
    if (this.injections.size >= CONFIG.demo.maxConcurrentInjections) {
      throw new Error(`Maximum ${CONFIG.demo.maxConcurrentInjections} concurrent injections reached`);
    }

    // Validate MQTT client
    if (!this.mqttClient || !this.mqttClient.connected) {
      throw new Error('MQTT client not connected. Cannot start injection.');
    }

    // Validate anomaly type
    const profile = ANOMALY_PROFILES[anomalyType];
    if (!profile) {
      throw new Error(`Unknown anomaly type: ${anomalyType}. Valid types: ${Object.keys(ANOMALY_PROFILES).join(', ')}`);
    }

    // Validate severity
    if (!profile.severity[severity]) {
      throw new Error(`Invalid severity: ${severity}. Valid severities: ${Object.keys(profile.severity).join(', ')}`);
    }

    const injectionId = `inj_${this.nextId++}`;
    const startTime = Date.now();

    // Build topic based on equipment
    // Equipment names: filler, vat01, caploader, washer
    // Map to actual MQTT topics
    const topicMap = {
      'filler': `Enterprise B/${CONFIG.demo.namespace}/Site1/fillerproduction/fillingline01/filler/processdata/${anomalyType}/level`,
      'vat01': `Enterprise B/${CONFIG.demo.namespace}/Site1/liquidprocessing/mixroom01/vat01/processdata/process/${anomalyType}`,
      'caploader': `Enterprise B/${CONFIG.demo.namespace}/Site1/fillerproduction/fillingline01/caploader/processdata/${anomalyType}/actual`,
      'washer': `Enterprise B/${CONFIG.demo.namespace}/Site1/fillerproduction/fillingline01/washer/processdata/${anomalyType}/level`
    };

    const topic = topicMap[equipment.toLowerCase()];
    if (!topic) {
      throw new Error(`Unknown equipment: ${equipment}. Valid equipment: ${Object.keys(topicMap).join(', ')}`);
    }

    const injection = {
      id: injectionId,
      equipment,
      anomalyType,
      severity,
      topic,
      profile,
      targetValue: profile.severity[severity],
      startValue: (profile.normalRange[0] + profile.normalRange[1]) / 2,
      startTime,
      durationMs,
      publishCount: 0,
      timers: []
    };

    // Extract publish logic into a function so we can call it immediately AND on interval
    const publishValue = () => {
      const elapsed = Date.now() - startTime;

      // Stop if duration exceeded
      if (elapsed >= durationMs) {
        clearInterval(interval);
        this.injections.delete(injectionId);
        console.log(`[DEMO ENGINE] Injection ${injectionId} completed (${injection.publishCount} publishes)`);
        return;
      }

      // Ramp from normal to target value
      const progress = Math.min(1, elapsed / durationMs);
      let value = injection.startValue + (injection.targetValue - injection.startValue) * progress;

      // Add noise
      if (profile.noise > 0) {
        const noiseFactor = (Math.random() - 0.5) * 2 * profile.noise;
        value += noiseFactor;
      }

      // Pre-publish debug: confirms code path is reached
      console.log(`[DEMO ENGINE] Publishing injection: ${topic} = ${value.toFixed(2)} (qos:0)`);

      // Publish to MQTT - QoS 0 (fire-and-forget) so callback fires immediately
      this.mqttClient.publish(topic, String(value), { qos: 0 }, (err) => {
        if (err) {
          console.error(`[DEMO ENGINE] Publish error: ${err.message}`);
        } else {
          injection.publishCount++;
          console.log(`[DEMO ENGINE] Injected: ${topic} = ${value.toFixed(2)} ${profile.unit}`);
        }
      });
    };

    // Call immediately to publish the first value
    publishValue();

    // Create interval for repeated publishing
    const interval = setInterval(publishValue, profile.publishIntervalMs);

    injection.timers.push(interval);
    this.injections.set(injectionId, injection);

    console.log(`[DEMO ENGINE] Started injection ${injectionId}: ${equipment} - ${anomalyType} (${severity})`);

    return {
      injectionId,
      equipment,
      anomalyType,
      severity,
      topic,
      durationMs,
      startTime
    };
  }

  /**
   * Stop a specific injection
   * @param {string} injectionId - Injection ID to stop
   */
  stop(injectionId) {
    const injection = this.injections.get(injectionId);
    if (!injection) {
      throw new Error(`Injection not found: ${injectionId}`);
    }

    console.log(`[DEMO ENGINE] Stopping injection ${injectionId}`);

    // Clear all timers
    injection.timers.forEach(timer => {
      clearTimeout(timer);
      clearInterval(timer);
    });

    this.injections.delete(injectionId);
  }

  /**
   * Stop all active injections
   */
  stopAll() {
    console.log(`[DEMO ENGINE] Stopping ${this.injections.size} active injections`);

    for (const injection of this.injections.values()) {
      injection.timers.forEach(timer => {
        clearTimeout(timer);
        clearInterval(timer);
      });
    }

    this.injections.clear();
  }

  /**
   * Get status of all active injections
   * @returns {Object} Status summary
   */
  getStatus() {
    const active = [];

    for (const [id, injection] of this.injections.entries()) {
      const elapsed = Date.now() - injection.startTime;
      const remaining = Math.max(0, injection.durationMs - elapsed);

      active.push({
        id,
        equipment: injection.equipment,
        anomalyType: injection.anomalyType,
        severity: injection.severity,
        topic: injection.topic,
        publishCount: injection.publishCount,
        timing: {
          startTime: injection.startTime,
          elapsedMs: elapsed,
          remainingMs: remaining,
          durationMs: injection.durationMs,
          progress: Math.min(100, (elapsed / injection.durationMs) * 100)
        }
      });
    }

    return {
      active,
      count: active.length,
      maxConcurrent: CONFIG.demo.maxConcurrentInjections
    };
  }
}

// Singleton instances
const scenarioRunner = new ScenarioRunner();
const injectionManager = new InjectionManager();

/**
 * Initialize both runners with MQTT client
 * @param {Object} params - Initialization parameters
 * @param {Object} params.mqttClient - Authenticated MQTT client
 */
function init({ mqttClient }) {
  scenarioRunner.init({ mqttClient });
  injectionManager.init({ mqttClient });
}

// =============================================================================
// EXPRESS ROUTER - Demo API Endpoints
// =============================================================================

const router = express.Router();
router.use(express.json());

/**
 * POST /api/demo/scenario/launch - Start a pre-configured demo scenario
 * Body: { scenarioId: string }
 */
router.post('/scenario/launch', (req, res) => {
  try {
    const { scenarioId } = req.body;

    if (!scenarioId || typeof scenarioId !== 'string') {
      return res.status(400).json({
        error: 'Missing or invalid scenarioId parameter',
        availableScenarios: DEMO_SCENARIOS.map(s => s.id)
      });
    }

    const status = scenarioRunner.start(scenarioId);

    res.json({
      success: true,
      status,
      message: `Scenario "${status.scenario.name}" started`
    });

  } catch (error) {
    console.error('[DEMO ENGINE] Launch error:', error);
    res.status(400).json({
      error: error.message
    });
  }
});

/**
 * POST /api/demo/scenario/stop - Stop the current scenario
 */
router.post('/scenario/stop', (req, res) => {
  try {
    scenarioRunner.stop();

    res.json({
      success: true,
      message: 'Scenario stopped'
    });

  } catch (error) {
    console.error('[DEMO ENGINE] Stop error:', error);
    res.status(400).json({
      error: error.message
    });
  }
});

/**
 * GET /api/demo/scenario/status - Get current scenario status
 */
router.get('/scenario/status', (req, res) => {
  try {
    const status = scenarioRunner.getStatus();

    res.json(status);

  } catch (error) {
    console.error('[DEMO ENGINE] Status error:', error);
    res.status(500).json({
      error: error.message
    });
  }
});

/**
 * GET /api/demo/scenarios - List all available scenarios
 */
router.get('/scenarios', (req, res) => {
  try {
    const scenarios = DEMO_SCENARIOS.map(s => ({
      id: s.id,
      name: s.name,
      description: s.description,
      equipment: s.equipment,
      durationMs: s.durationMs,
      durationMinutes: (s.durationMs / 60000).toFixed(1),
      stepCount: s.steps.length
    }));

    res.json({
      scenarios,
      count: scenarios.length
    });

  } catch (error) {
    console.error('[DEMO ENGINE] Scenarios list error:', error);
    res.status(500).json({
      error: error.message
    });
  }
});

/**
 * POST /api/demo/inject - Start an ad-hoc anomaly injection
 * Body: { equipment: string, anomalyType: string, severity: string, durationMs: number }
 */
router.post('/inject', (req, res) => {
  try {
    const { equipment, anomalyType, severity, durationMs } = req.body;

    // Validate required parameters
    if (!equipment || typeof equipment !== 'string') {
      return res.status(400).json({
        error: 'Missing or invalid equipment parameter'
      });
    }

    if (!anomalyType || typeof anomalyType !== 'string') {
      return res.status(400).json({
        error: 'Missing or invalid anomalyType parameter',
        availableTypes: Object.keys(ANOMALY_PROFILES)
      });
    }

    if (!severity || typeof severity !== 'string') {
      return res.status(400).json({
        error: 'Missing or invalid severity parameter',
        validSeverities: ['mild', 'moderate', 'severe']
      });
    }

    if (!durationMs || typeof durationMs !== 'number' || durationMs <= 0) {
      return res.status(400).json({
        error: 'Missing or invalid durationMs parameter (must be positive number)'
      });
    }

    // Limit duration to 10 minutes
    if (durationMs > 600000) {
      return res.status(400).json({
        error: 'Duration too long (max 600000ms / 10 minutes)'
      });
    }

    const result = injectionManager.start({
      equipment,
      anomalyType,
      severity,
      durationMs
    });

    res.json({
      success: true,
      injection: result,
      message: `Injection started: ${equipment} - ${anomalyType} (${severity})`
    });

  } catch (error) {
    console.error('[DEMO ENGINE] Injection start error:', error);
    res.status(400).json({
      error: error.message
    });
  }
});

/**
 * POST /api/demo/inject/stop - Stop a specific injection
 * Body: { injectionId: string }
 */
router.post('/inject/stop', (req, res) => {
  try {
    const { injectionId } = req.body;

    if (!injectionId || typeof injectionId !== 'string') {
      return res.status(400).json({
        error: 'Missing or invalid injectionId parameter'
      });
    }

    injectionManager.stop(injectionId);

    res.json({
      success: true,
      message: `Injection ${injectionId} stopped`
    });

  } catch (error) {
    console.error('[DEMO ENGINE] Injection stop error:', error);
    res.status(400).json({
      error: error.message
    });
  }
});

/**
 * GET /api/demo/inject/status - Get status of all active injections
 */
router.get('/inject/status', (req, res) => {
  try {
    const status = injectionManager.getStatus();

    res.json(status);

  } catch (error) {
    console.error('[DEMO ENGINE] Injection status error:', error);
    res.status(500).json({
      error: error.message
    });
  }
});

/**
 * POST /api/demo/reset - Reset demo data
 * Body: { type: "injected-data" | "all-scenarios" | "full" }
 */
router.post('/reset', async (req, res) => {
  try {
    const { type } = req.body;

    if (!type || typeof type !== 'string') {
      return res.status(400).json({
        error: 'Missing or invalid type parameter',
        validTypes: ['injected-data', 'all-scenarios', 'full']
      });
    }

    const results = {
      scenariosStopped: false,
      injectionsStopped: false,
      dataDeleted: false
    };

    // Stop scenarios if requested
    if (type === 'all-scenarios' || type === 'full') {
      scenarioRunner.stop();
      results.scenariosStopped = true;
    }

    // Stop injections if requested
    if (type === 'injected-data' || type === 'full') {
      injectionManager.stopAll();
      results.injectionsStopped = true;
    }

    // Delete InfluxDB data if requested
    if (type === 'injected-data' || type === 'full') {
      try {
        // Use InfluxDB HTTP API to delete data with source="demo-injected" tag
        const deleteUrl = `${CONFIG.influxdb.url}/api/v2/delete`;
        const predicate = `source="demo-injected"`;
        const startTime = new Date(Date.now() - 86400000).toISOString(); // Last 24h
        const stopTime = new Date().toISOString();

        const deleteBody = {
          org: CONFIG.influxdb.org,
          bucket: CONFIG.influxdb.bucket,
          start: startTime,
          stop: stopTime,
          predicate
        };

        const response = await fetch(deleteUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Token ${CONFIG.influxdb.token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(deleteBody)
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`InfluxDB delete failed: ${response.status} ${errorText}`);
        }

        results.dataDeleted = true;
        console.log(`[DEMO ENGINE] Deleted InfluxDB data with predicate: ${predicate}`);

      } catch (deleteError) {
        console.error('[DEMO ENGINE] InfluxDB delete error:', deleteError);
        // Don't fail the entire reset if delete fails
        results.dataDeleteError = deleteError.message;
      }
    }

    res.json({
      success: true,
      type,
      results,
      message: `Reset completed: ${type}`
    });

  } catch (error) {
    console.error('[DEMO ENGINE] Reset error:', error);
    res.status(500).json({
      error: error.message
    });
  }
});

/**
 * GET /api/demo/profiles - List all available anomaly profiles
 */
router.get('/profiles', (req, res) => {
  try {
    const profiles = Object.entries(ANOMALY_PROFILES).map(([type, profile]) => ({
      type,
      unit: profile.unit,
      normalRange: profile.normalRange,
      severities: Object.keys(profile.severity)
    }));

    res.json({
      profiles,
      count: profiles.length
    });

  } catch (error) {
    console.error('[DEMO ENGINE] Profiles list error:', error);
    res.status(500).json({
      error: error.message
    });
  }
});

module.exports = {
  init,
  router,
  scenarioRunner,
  injectionManager
};
