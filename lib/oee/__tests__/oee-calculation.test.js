/**
 * @file oee-calculation.test.js
 * @description Tests for OEE runtime normalization and calculation logic
 */

// Mock the influx client before requiring OEE module
jest.mock('../../influx/client', () => ({
  queryApi: {
    queryRows: jest.fn()
  }
}));

const { calculateOEEv2, oeeConfig } = require('../index');
const { queryApi } = require('../../influx/client');

describe('OEE Runtime Normalization', () => {
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Pre-populate oeeConfig to skip discovery
    oeeConfig.enterprises = {
      'Enterprise A': {
        tier: 1,
        measurements: {
          overall: 'metric_oee',
          availability: 'metric_availability',
          performance: 'metric_performance',
          quality: 'metric_quality'
        },
        valueFormat: 'unknown',
        sites: ['Site1'],
        lastDiscovery: new Date().toISOString(),
        confidence: 0.95,
        reason: 'Using pre-computed OEE from metric_oee'
      },
      'Enterprise B': {
        tier: 2,
        measurements: {
          availability: 'metric_availability',
          performance: 'metric_performance',
          quality: 'metric_quality'
        },
        valueFormat: 'unknown',
        sites: ['Site1'],
        lastDiscovery: new Date().toISOString(),
        confidence: 0.90,
        reason: 'Calculating from A x P x Q components'
      }
    };
  });

  afterEach(() => {
    // Clean up config
    oeeConfig.enterprises = {};
  });

  describe('Tier 1 - Decimal values (<=1.5 multiplied by 100)', () => {
    test('raw 0.72 normalizes to 72.0', async () => {
      queryApi.queryRows.mockImplementation((query, callbacks) => {
        // Overall OEE query
        if (query.includes('metric_oee')) {
          callbacks.next([], { toObject: () => ({ _value: 0.72 }) });
        }
        callbacks.complete();
      });

      const result = await calculateOEEv2('Enterprise A');
      expect(result.oee).toBe(72.0);
    });

    test('raw 0.85 normalizes to 85.0', async () => {
      queryApi.queryRows.mockImplementation((query, callbacks) => {
        if (query.includes('metric_oee')) {
          callbacks.next([], { toObject: () => ({ _value: 0.85 }) });
        }
        callbacks.complete();
      });

      const result = await calculateOEEv2('Enterprise A');
      expect(result.oee).toBe(85.0);
    });

    test('raw 1.0 normalizes to 100.0', async () => {
      queryApi.queryRows.mockImplementation((query, callbacks) => {
        if (query.includes('metric_oee')) {
          callbacks.next([], { toObject: () => ({ _value: 1.0 }) });
        }
        callbacks.complete();
      });

      const result = await calculateOEEv2('Enterprise A');
      expect(result.oee).toBe(100.0);
    });
  });

  describe('Tier 1 - Percentage values (>1.5 used as-is)', () => {
    test('raw 72.5 stays 72.5', async () => {
      queryApi.queryRows.mockImplementation((query, callbacks) => {
        if (query.includes('metric_oee')) {
          callbacks.next([], { toObject: () => ({ _value: 72.5 }) });
        }
        callbacks.complete();
      });

      const result = await calculateOEEv2('Enterprise A');
      expect(result.oee).toBe(72.5);
    });

    test('raw 85.0 stays 85.0', async () => {
      queryApi.queryRows.mockImplementation((query, callbacks) => {
        if (query.includes('metric_oee')) {
          callbacks.next([], { toObject: () => ({ _value: 85.0 }) });
        }
        callbacks.complete();
      });

      const result = await calculateOEEv2('Enterprise A');
      expect(result.oee).toBe(85.0);
    });
  });

  describe('Tier 1 - Boundary value 1.5 (critical edge case)', () => {
    test('raw 1.5 detected as decimal, normalized to 100.0 (clamped)', async () => {
      queryApi.queryRows.mockImplementation((query, callbacks) => {
        if (query.includes('metric_oee')) {
          callbacks.next([], { toObject: () => ({ _value: 1.5 }) });
        }
        callbacks.complete();
      });

      const result = await calculateOEEv2('Enterprise A');
      // 1.5 <= 1.5, so it's decimal: 1.5 * 100 = 150, clamped to 100
      expect(result.oee).toBe(100.0);
    });

    test('raw 1.51 detected as percentage, stays 1.5 (rounded)', async () => {
      queryApi.queryRows.mockImplementation((query, callbacks) => {
        if (query.includes('metric_oee')) {
          callbacks.next([], { toObject: () => ({ _value: 1.51 }) });
        }
        callbacks.complete();
      });

      const result = await calculateOEEv2('Enterprise A');
      // 1.51 > 1.5, so it's percentage: stays 1.51, rounded to 1.5
      expect(result.oee).toBe(1.5);
    });
  });

  describe('Tier 1 - Null handling', () => {
    test('no rows returned returns null OEE', async () => {
      queryApi.queryRows.mockImplementation((query, callbacks) => {
        // No rows, just complete
        callbacks.complete();
      });

      const result = await calculateOEEv2('Enterprise A');
      expect(result.oee).toBeNull();
    });

    test('query error returns gracefully with null OEE', async () => {
      queryApi.queryRows.mockImplementation((query, callbacks) => {
        callbacks.error(new Error('Query failed'));
      });

      const result = await calculateOEEv2('Enterprise A');
      expect(result.oee).toBeNull();
      expect(result.quality.status).toBe('unavailable');
    });
  });

  describe('Tier 2 - A×P×Q calculation', () => {
    test('A=90, P=80, Q=95 calculates to 68.4', async () => {
      queryApi.queryRows.mockImplementation((query, callbacks) => {
        if (query.includes('metric_availability')) {
          callbacks.next([], { toObject: () => ({ _value: 90 }) });
        } else if (query.includes('metric_performance')) {
          callbacks.next([], { toObject: () => ({ _value: 80 }) });
        } else if (query.includes('metric_quality')) {
          callbacks.next([], { toObject: () => ({ _value: 95 }) });
        }
        callbacks.complete();
      });

      const result = await calculateOEEv2('Enterprise B');
      // (90/100) * (80/100) * (95/100) * 100 = 68.4
      expect(result.oee).toBe(68.4);
      expect(result.components.availability).toBe(90.0);
      expect(result.components.performance).toBe(80.0);
      expect(result.components.quality).toBe(95.0);
    });

    test('A=0.9, P=0.8, Q=0.95 (decimal) normalizes to same result 68.4', async () => {
      queryApi.queryRows.mockImplementation((query, callbacks) => {
        if (query.includes('metric_availability')) {
          callbacks.next([], { toObject: () => ({ _value: 0.9 }) });
        } else if (query.includes('metric_performance')) {
          callbacks.next([], { toObject: () => ({ _value: 0.8 }) });
        } else if (query.includes('metric_quality')) {
          callbacks.next([], { toObject: () => ({ _value: 0.95 }) });
        }
        callbacks.complete();
      });

      const result = await calculateOEEv2('Enterprise B');
      // Normalized: 90, 80, 95 -> (90/100) * (80/100) * (95/100) * 100 = 68.4
      expect(result.oee).toBe(68.4);
    });

    test('one component null returns null OEE', async () => {
      queryApi.queryRows.mockImplementation((query, callbacks) => {
        if (query.includes('metric_availability')) {
          callbacks.next([], { toObject: () => ({ _value: 90 }) });
        } else if (query.includes('metric_performance')) {
          // No data for performance
        } else if (query.includes('metric_quality')) {
          callbacks.next([], { toObject: () => ({ _value: 95 }) });
        }
        callbacks.complete();
      });

      const result = await calculateOEEv2('Enterprise B');
      expect(result.oee).toBeNull();
      expect(result.components.availability).toBe(90.0);
      expect(result.components.performance).toBeNull();
      expect(result.components.quality).toBe(95.0);
    });

    test('all components zero returns 0 OEE', async () => {
      queryApi.queryRows.mockImplementation((query, callbacks) => {
        if (query.includes('metric_availability')) {
          callbacks.next([], { toObject: () => ({ _value: 0 }) });
        } else if (query.includes('metric_performance')) {
          callbacks.next([], { toObject: () => ({ _value: 0 }) });
        } else if (query.includes('metric_quality')) {
          callbacks.next([], { toObject: () => ({ _value: 0 }) });
        }
        callbacks.complete();
      });

      const result = await calculateOEEv2('Enterprise B');
      // (0/100) * (0/100) * (0/100) * 100 = 0
      expect(result.oee).toBe(0.0);
    });
  });

  describe('Tier 2 - Mixed formats', () => {
    test('A=0.9 (decimal), P=80 (percentage), Q=0.95 (decimal) normalizes correctly', async () => {
      queryApi.queryRows.mockImplementation((query, callbacks) => {
        if (query.includes('metric_availability')) {
          callbacks.next([], { toObject: () => ({ _value: 0.9 }) }); // decimal
        } else if (query.includes('metric_performance')) {
          callbacks.next([], { toObject: () => ({ _value: 80 }) }); // percentage
        } else if (query.includes('metric_quality')) {
          callbacks.next([], { toObject: () => ({ _value: 0.95 }) }); // decimal
        }
        callbacks.complete();
      });

      const result = await calculateOEEv2('Enterprise B');
      // Normalized: A=90 (0.9*100), P=80 (no change), Q=95 (0.95*100)
      // (90/100) * (80/100) * (95/100) * 100 = 68.4
      expect(result.oee).toBe(68.4);
      expect(result.components.availability).toBe(90.0);
      expect(result.components.performance).toBe(80.0);
      expect(result.components.quality).toBe(95.0);
    });
  });

  describe('Tier metadata', () => {
    test('Tier 1 result includes correct metadata', async () => {
      queryApi.queryRows.mockImplementation((query, callbacks) => {
        if (query.includes('metric_oee')) {
          callbacks.next([], { toObject: () => ({ _value: 0.85 }) });
        }
        callbacks.complete();
      });

      const result = await calculateOEEv2('Enterprise A');
      expect(result.calculation.tier).toBe(1);
      expect(result.calculation.tierName).toBe('pre-computed-overall');
      expect(result.calculation.measurementsUsed).toContain('metric_oee');
      expect(result.quality.confidence).toBe(0.95);
    });

    test('Tier 2 result includes correct metadata', async () => {
      queryApi.queryRows.mockImplementation((query, callbacks) => {
        if (query.includes('metric_availability')) {
          callbacks.next([], { toObject: () => ({ _value: 90 }) });
        } else if (query.includes('metric_performance')) {
          callbacks.next([], { toObject: () => ({ _value: 80 }) });
        } else if (query.includes('metric_quality')) {
          callbacks.next([], { toObject: () => ({ _value: 95 }) });
        }
        callbacks.complete();
      });

      const result = await calculateOEEv2('Enterprise B');
      expect(result.calculation.tier).toBe(2);
      expect(result.calculation.tierName).toBe('pre-computed-components');
      expect(result.calculation.measurementsUsed).toEqual([
        'metric_availability',
        'metric_performance',
        'metric_quality'
      ]);
      expect(result.quality.confidence).toBe(0.90);
    });
  });

  describe('Enterprise not found', () => {
    test('returns tier 4 with null OEE for unknown enterprise', async () => {
      const result = await calculateOEEv2('Enterprise Z');
      expect(result.oee).toBeNull();
      expect(result.calculation.tier).toBe(4);
      expect(result.calculation.tierName).toBe('insufficient-data');
      expect(result.quality.status).toBe('unavailable');
    });
  });
});
