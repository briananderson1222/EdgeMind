// lib/demo/scenarios.js - Pre-configured Demo Scenarios
// Six demo scenarios for ProveIt! Conference 2026 presentations

const CONFIG = require('../config');
const DEMO_NAMESPACE = CONFIG.demo?.namespace || 'concept-reply';

/**
 * Demo scenarios for conference presentations.
 * Each scenario defines:
 * - id: Unique scenario identifier
 * - name: Display name
 * - description: What this scenario demonstrates
 * - equipment: Which equipment is affected
 * - durationMs: Total scenario duration
 * - steps: Array of data injection steps, each with:
 *   - delayMs: When to start this step (from scenario start)
 *   - topic: MQTT topic to publish to (with concept-reply/ prefix)
 *   - generator: Value generator type ('ramp', 'spike', 'constant')
 *   - params: Generator parameters (startValue, endValue, durationMs, intervalMs, noise)
 */
const DEMO_SCENARIOS = [
  {
    id: 'filler-vibration',
    name: 'Filler Vibration Anomaly',
    description: 'Real-time detection of bearing degradation on high-speed rotary filler',
    equipment: 'Filler (Asset 23)',
    durationMs: 240000, // 4 min
    steps: [
      {
        delayMs: 0,
        topic: `Enterprise B/${DEMO_NAMESPACE}/Site1/fillerproduction/fillingline01/filler/processdata/vibration/level`,
        generator: 'ramp',
        params: { startValue: 2.1, endValue: 8.4, durationMs: 180000, intervalMs: 5000, noise: 0.2 }
      },
      {
        delayMs: 60000,
        topic: `Enterprise B/${DEMO_NAMESPACE}/Site1/fillerproduction/fillingline01/filler/metric/input/rateactual`,
        generator: 'ramp',
        params: { startValue: 307, endValue: 280, durationMs: 180000, intervalMs: 5000, noise: 3 }
      }
    ]
  },
  {
    id: 'mixing-temp-drift',
    name: 'Mixing Vat Temperature Drift',
    description: 'Process parameter anomaly on Vat01 "Jeff" - cooling jacket failure',
    equipment: 'Vat01 "Jeff" (Asset 31)',
    durationMs: 240000,
    steps: [
      {
        delayMs: 0,
        topic: `Enterprise B/${DEMO_NAMESPACE}/Site1/liquidprocessing/mixroom01/vat01/processdata/process/temperature`,
        generator: 'ramp',
        params: { startValue: 32.5, endValue: 38.2, durationMs: 200000, intervalMs: 5000, noise: 0.3 }
      }
    ]
  },
  {
    id: 'capper-torque',
    name: 'Capper Torque Degradation',
    description: 'Predictive maintenance - clutch wear on capping machine',
    equipment: 'CapLoader (Asset 22)',
    durationMs: 240000,
    steps: [
      {
        delayMs: 0,
        topic: `Enterprise B/${DEMO_NAMESPACE}/Site1/fillerproduction/fillingline01/caploader/processdata/torque/actual`,
        generator: 'ramp',
        params: { startValue: 18, endValue: 28, durationMs: 200000, intervalMs: 5000, noise: 1.5 }
      },
      {
        delayMs: 0,
        topic: `Enterprise B/${DEMO_NAMESPACE}/Site1/fillerproduction/fillingline01/caploader/processdata/torque/variance`,
        generator: 'ramp',
        params: { startValue: 2, endValue: 17, durationMs: 200000, intervalMs: 5000, noise: 0.5 }
      }
    ]
  },
  {
    id: 'line-cascade',
    name: 'Line Cascade Prevention',
    description: 'Multi-agent collaboration - washer degradation cascading through filling line',
    equipment: 'FillingLine01 (Asset 7)',
    durationMs: 300000, // 5 min
    steps: [
      {
        delayMs: 0,
        topic: `Enterprise B/${DEMO_NAMESPACE}/Site1/fillerproduction/fillingline01/washer/metric/oee`,
        generator: 'ramp',
        params: { startValue: 98, endValue: 72, durationMs: 240000, intervalMs: 5000, noise: 1.5 }
      },
      {
        delayMs: 60000,
        topic: `Enterprise B/${DEMO_NAMESPACE}/Site1/fillerproduction/fillingline01/filler/metric/oee`,
        generator: 'ramp',
        params: { startValue: 87.8, endValue: 75, durationMs: 180000, intervalMs: 5000, noise: 1.0 }
      },
      {
        delayMs: 120000,
        topic: `Enterprise B/${DEMO_NAMESPACE}/Site1/fillerproduction/fillingline01/caploader/metric/oee`,
        generator: 'ramp',
        params: { startValue: 91, endValue: 80, durationMs: 120000, intervalMs: 5000, noise: 1.0 }
      }
    ]
  },
  {
    id: 'quality-root-cause',
    name: 'Quality Root Cause Analysis',
    description: 'AI investigation of cross-line defect correlation',
    equipment: 'Cross-line',
    durationMs: 180000, // 3 min
    steps: [
      {
        delayMs: 0,
        topic: `Enterprise B/${DEMO_NAMESPACE}/Site1/fillerproduction/fillingline01/filler/metric/defectrate`,
        generator: 'ramp',
        params: { startValue: 0.5, endValue: 2.5, durationMs: 150000, intervalMs: 5000, noise: 0.2 }
      }
    ]
  },
  {
    id: 'nlp-interface',
    name: 'Natural Language Interface',
    description: 'Conversational AI queries - no data injection needed',
    equipment: 'All assets',
    durationMs: 180000,
    steps: [] // No MQTT publishing — this is a UI-only scenario
  }
];

module.exports = DEMO_SCENARIOS;
