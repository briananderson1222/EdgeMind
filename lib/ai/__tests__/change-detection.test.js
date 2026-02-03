/**
 * @file change-detection.test.js
 * @description Tests for Tier 1 delta detection — detectChanges() function (ADR-016)
 */

// Mock dependencies before requiring the module
jest.mock('../../influx/client', () => ({
  queryApi: { queryRows: jest.fn() }
}));
jest.mock('../../config', () => ({
  influxdb: { bucket: 'factory' },
  bedrock: { region: 'us-east-1', modelId: 'test-model' },
  disableInsights: false
}));
jest.mock('../../domain-context', () => ({
  ENTERPRISE_DOMAIN_CONTEXT: {}
}));
jest.mock('../tools', () => ({
  TOOL_DEFINITIONS: [],
  executeTool: jest.fn()
}));

const { detectChanges } = require('../index');

describe('detectChanges', () => {
  // Helper to build trend data
  function makeTrend(enterprise, measurement, value) {
    return {
      measurement,
      enterprise,
      site: 'Site1',
      area: 'Area1',
      time: new Date().toISOString(),
      value
    };
  }

  // Helper to build a previous snapshot
  function makeSnapshot(metrics, equipmentStates) {
    return {
      timestamp: new Date().toISOString(),
      metrics: metrics || {},
      equipmentStates: equipmentStates || {}
    };
  }

  test('returns empty array when no changes', () => {
    const trends = [
      makeTrend('Enterprise A', 'OEE_Availability', 85),
      makeTrend('Enterprise A', 'OEE_Performance', 90),
      makeTrend('Enterprise B', 'metric_oee', 72)
    ];
    const previous = makeSnapshot({
      'Enterprise A::OEE_Availability': 85,
      'Enterprise A::OEE_Performance': 90,
      'Enterprise B::metric_oee': 72
    });

    const changes = detectChanges(trends, previous, 5);
    expect(changes).toEqual([]);
  });

  test('detects OEE drop above threshold', () => {
    const trends = [
      makeTrend('Enterprise B', 'metric_oee', 68) // dropped from 85 to 68
    ];
    const previous = makeSnapshot({
      'Enterprise B::metric_oee': 85
    });

    const changes = detectChanges(trends, previous, 5);
    expect(changes.length).toBe(1);
    expect(changes[0]).toMatchObject({
      type: 'metric_change',
      enterprise: 'Enterprise B',
      measurement: 'metric_oee',
      direction: 'decreased'
    });
    expect(changes[0].changePct).toBeGreaterThan(5);
  });

  test('detects availability increase above threshold', () => {
    const trends = [
      makeTrend('Enterprise A', 'OEE_Availability', 95) // jumped from 80
    ];
    const previous = makeSnapshot({
      'Enterprise A::OEE_Availability': 80
    });

    const changes = detectChanges(trends, previous, 5);
    expect(changes.length).toBe(1);
    expect(changes[0]).toMatchObject({
      type: 'metric_change',
      direction: 'increased'
    });
  });

  test('ignores small fluctuations below threshold', () => {
    const trends = [
      makeTrend('Enterprise A', 'OEE_Availability', 84), // 84 vs 85 = ~1.2%
      makeTrend('Enterprise A', 'OEE_Performance', 89),   // 89 vs 90 = ~1.1%
      makeTrend('Enterprise B', 'metric_oee', 73)          // 73 vs 72 = ~1.4%
    ];
    const previous = makeSnapshot({
      'Enterprise A::OEE_Availability': 85,
      'Enterprise A::OEE_Performance': 90,
      'Enterprise B::metric_oee': 72
    });

    const changes = detectChanges(trends, previous, 5);
    expect(changes).toEqual([]);
  });

  test('handles missing/null previous snapshot gracefully (first run)', () => {
    const trends = [
      makeTrend('Enterprise A', 'OEE_Availability', 85),
      makeTrend('Enterprise B', 'metric_oee', 72)
    ];

    // null previous snapshot
    expect(detectChanges(trends, null, 5)).toEqual([]);

    // undefined previous snapshot
    expect(detectChanges(trends, undefined, 5)).toEqual([]);
  });

  test('handles empty trends array', () => {
    const previous = makeSnapshot({
      'Enterprise A::OEE_Availability': 85
    });

    expect(detectChanges([], previous, 5)).toEqual([]);
    expect(detectChanges(null, previous, 5)).toEqual([]);
  });

  test('ignores non-OEE metrics', () => {
    const trends = [
      makeTrend('Enterprise A', 'temperature', 150),      // not a key metric
      makeTrend('Enterprise A', 'waste_count', 200)        // not a key metric
    ];
    const previous = makeSnapshot({
      'Enterprise A::temperature': 100,
      'Enterprise A::waste_count': 50
    });

    const changes = detectChanges(trends, previous, 5);
    expect(changes).toEqual([]);
  });

  test('detects multiple changes across enterprises', () => {
    const trends = [
      makeTrend('Enterprise A', 'OEE_Availability', 60),  // dropped from 85
      makeTrend('Enterprise B', 'metric_quality', 50)      // dropped from 90
    ];
    const previous = makeSnapshot({
      'Enterprise A::OEE_Availability': 85,
      'Enterprise B::metric_quality': 90
    });

    const changes = detectChanges(trends, previous, 5);
    expect(changes.length).toBe(2);
    expect(changes.map(c => c.enterprise).sort()).toEqual(['Enterprise A', 'Enterprise B']);
  });

  test('skips metrics with zero previous value (avoid division by zero)', () => {
    const trends = [
      makeTrend('Enterprise A', 'OEE_Availability', 85)
    ];
    const previous = makeSnapshot({
      'Enterprise A::OEE_Availability': 0
    });

    const changes = detectChanges(trends, previous, 5);
    expect(changes).toEqual([]);
  });

  test('uses configurable threshold', () => {
    const trends = [
      makeTrend('Enterprise A', 'OEE_Availability', 82) // ~3.5% drop from 85
    ];
    const previous = makeSnapshot({
      'Enterprise A::OEE_Availability': 85
    });

    // With 5% threshold — should NOT trigger
    expect(detectChanges(trends, previous, 5)).toEqual([]);

    // With 2% threshold — should trigger
    const changes = detectChanges(trends, previous, 2);
    expect(changes.length).toBe(1);
  });

  test('handles previous snapshot with no metrics property', () => {
    const trends = [
      makeTrend('Enterprise A', 'OEE_Availability', 85)
    ];
    const previous = { timestamp: new Date().toISOString() }; // no metrics key

    // Should not throw
    const changes = detectChanges(trends, previous, 5);
    expect(changes).toEqual([]);
  });
});
