// lib/demo/profiles.js - Anomaly Type Profiles
// Defines normal operating ranges and severity multipliers for simulated anomalies

/**
 * Anomaly type profiles with normal ranges and severity multipliers.
 * Each profile defines:
 * - unit: Measurement unit
 * - normalRange: [min, max] for normal operation
 * - severity: Peak values for mild, moderate, severe anomalies
 * - publishIntervalMs: How often to publish data (milliseconds)
 * - noise: Random noise to add for realism
 */
const ANOMALY_PROFILES = {
  vibration: {
    unit: 'mm/s',
    normalRange: [1.5, 3.0],
    severity: { mild: 5.0, moderate: 8.0, severe: 12.0 }, // peak values
    publishIntervalMs: 5000,
    noise: 0.3
  },
  temperature: {
    unit: '°C',
    normalRange: [30, 45],
    severity: { mild: 50, moderate: 60, severe: 75 },
    publishIntervalMs: 5000,
    noise: 0.5
  },
  pressure: {
    unit: 'bar',
    normalRange: [2.0, 3.5],
    severity: { mild: 4.0, moderate: 5.5, severe: 7.0 },
    publishIntervalMs: 5000,
    noise: 0.1
  },
  torque: {
    unit: 'Nm',
    normalRange: [10, 25],
    severity: { mild: 30, moderate: 40, severe: 55 },
    publishIntervalMs: 5000,
    noise: 1.0
  },
  efficiency: {
    unit: '%',
    normalRange: [85, 95],
    severity: { mild: 75, moderate: 60, severe: 45 }, // drops for efficiency
    publishIntervalMs: 5000,
    noise: 2.0
  }
};

module.exports = ANOMALY_PROFILES;
