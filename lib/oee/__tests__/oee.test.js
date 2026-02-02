/**
 * @file oee.test.js
 * @description Tests for OEE pure functions (analyzeEnterpriseOEE, createOEEResult)
 * Tests only pure functions that don't require InfluxDB mocking
 */

const {
  analyzeEnterpriseOEE,
  createOEEResult,
  OEE_TIERS
} = require('../index');

describe('analyzeEnterpriseOEE', () => {
  test('Tier 1 detection - has overall OEE measurement', () => {
    const measurements = [
      { name: 'metric_oee', sampleValues: [0.72], sites: ['Site1'] }
    ];
    const result = analyzeEnterpriseOEE('Enterprise B', measurements);

    expect(result.tier).toBe(1);
    expect(result.measurements.overall).toBe('metric_oee');
    expect(result.confidence).toBe(0.95);
    expect(result.reason).toContain('pre-computed OEE');
  });

  test('Tier 1 with oee_overall pattern', () => {
    const measurements = [
      { name: 'oee_overall', sampleValues: [72.5], sites: ['Site1'] }
    ];
    const result = analyzeEnterpriseOEE('Enterprise B', measurements);

    expect(result.tier).toBe(1);
    expect(result.measurements.overall).toBe('oee_overall');
  });

  test('Tier 2 detection - has A, P, Q but no overall', () => {
    const measurements = [
      { name: 'metric_availability', sampleValues: [0.90], sites: ['Site1'] },
      { name: 'metric_performance', sampleValues: [0.85], sites: ['Site1'] },
      { name: 'metric_quality', sampleValues: [0.95], sites: ['Site1'] }
    ];
    const result = analyzeEnterpriseOEE('Enterprise B', measurements);

    expect(result.tier).toBe(2);
    expect(result.measurements.availability).toBe('metric_availability');
    expect(result.measurements.performance).toBe('metric_performance');
    expect(result.measurements.quality).toBe('metric_quality');
    expect(result.measurements.overall).toBeNull();
    expect(result.confidence).toBe(0.90);
    expect(result.reason).toContain('A x P x Q');
  });

  test('Tier 4 - insufficient data (empty measurements)', () => {
    const measurements = [];
    const result = analyzeEnterpriseOEE('Enterprise B', measurements);

    expect(result.tier).toBe(4);
    expect(result.confidence).toBe(0.0);
    expect(result.reason).toContain('Insufficient OEE data');
  });

  test('Tier 4 - missing quality component', () => {
    const measurements = [
      { name: 'metric_availability', sampleValues: [0.90], sites: ['Site1'] },
      { name: 'metric_performance', sampleValues: [0.85], sites: ['Site1'] }
    ];
    const result = analyzeEnterpriseOEE('Enterprise B', measurements);

    expect(result.tier).toBe(4);
    expect(result.confidence).toBe(0.0);
  });

  test('Value format detection - decimal', () => {
    const measurements = [
      { name: 'metric_oee', sampleValues: [0.72, 0.68, 0.75], sites: ['Site1'] }
    ];
    const result = analyzeEnterpriseOEE('Enterprise B', measurements);

    expect(result.valueFormat).toBe('decimal');
  });

  test('Value format detection - percentage', () => {
    const measurements = [
      { name: 'metric_oee', sampleValues: [72.5, 68.0, 75.3], sites: ['Site1'] }
    ];
    const result = analyzeEnterpriseOEE('Enterprise B', measurements);

    expect(result.valueFormat).toBe('percentage');
  });

  test('Value format detection - mixed values default to percentage', () => {
    const measurements = [
      { name: 'metric_oee', sampleValues: [0.72, 72.5], sites: ['Site1'] }
    ];
    const result = analyzeEnterpriseOEE('Enterprise B', measurements);

    expect(result.valueFormat).toBe('percentage');
  });

  test('Value format unknown when no sample values', () => {
    const measurements = [
      { name: 'metric_oee', sampleValues: [], sites: ['Site1'] }
    ];
    const result = analyzeEnterpriseOEE('Enterprise B', measurements);

    expect(result.valueFormat).toBe('unknown');
  });

  test('Tier 1 preferred over Tier 2 when both available', () => {
    const measurements = [
      { name: 'metric_oee', sampleValues: [0.72], sites: ['Site1'] },
      { name: 'metric_availability', sampleValues: [0.90], sites: ['Site1'] },
      { name: 'metric_performance', sampleValues: [0.85], sites: ['Site1'] },
      { name: 'metric_quality', sampleValues: [0.95], sites: ['Site1'] }
    ];
    const result = analyzeEnterpriseOEE('Enterprise B', measurements);

    expect(result.tier).toBe(1);
    expect(result.measurements.overall).toBe('metric_oee');
  });

  test('Sites are collected from measurements', () => {
    const measurements = [
      { name: 'metric_oee', sampleValues: [0.72], sites: ['Site1', 'Site2'] },
      { name: 'metric_availability', sampleValues: [0.90], sites: ['Site3'] }
    ];
    const result = analyzeEnterpriseOEE('Enterprise A', measurements);

    expect(result.sites).toEqual(expect.arrayContaining(['Site1', 'Site2', 'Site3']));
  });

  test('lastDiscovery timestamp is ISO string', () => {
    const measurements = [
      { name: 'metric_oee', sampleValues: [0.72], sites: ['Site1'] }
    ];
    const result = analyzeEnterpriseOEE('Enterprise B', measurements);

    expect(result.lastDiscovery).toBeDefined();
    expect(new Date(result.lastDiscovery).toISOString()).toBe(result.lastDiscovery);
  });
});

describe('createOEEResult', () => {
  test('Full result with all components', () => {
    const result = createOEEResult(
      'Enterprise A',
      'Site1',
      85.5,
      { availability: 90, performance: 85, quality: 95 },
      1,
      'Direct OEE',
      { measurementsUsed: ['metric_oee'], dataPoints: 100 }
    );

    expect(result.oee).toBe(85.5);
    expect(result.enterprise).toBe('Enterprise A');
    expect(result.site).toBe('Site1');
    expect(result.components).toEqual({ availability: 90, performance: 85, quality: 95 });
    expect(result.calculation.tier).toBe(1);
    expect(result.calculation.tierName).toBe(OEE_TIERS[1]);
    expect(result.calculation.method).toBe('Direct OEE');
    expect(result.calculation.measurementsUsed).toEqual(['metric_oee']);
    expect(result.calculation.dataPoints).toBe(100);
    expect(result.quality.confidence).toBe(0.95);
    expect(result.quality.status).toBe('good');
  });

  test('Null OEE returns unavailable status', () => {
    const result = createOEEResult(
      'Enterprise A',
      null,
      null,
      null,
      4,
      'No data'
    );

    expect(result.oee).toBeNull();
    expect(result.components).toBeNull();
    expect(result.quality.status).toBe('unavailable');
    expect(result.quality.confidence).toBe(0.0);
  });

  test('Tier 2 confidence is 0.90', () => {
    const result = createOEEResult(
      'Enterprise B',
      'Site2',
      75.0,
      { availability: 85, performance: 90, quality: 98 },
      2,
      'Calculated from A x P x Q'
    );

    expect(result.quality.confidence).toBe(0.90);
  });

  test('Tier 1 confidence is 0.95', () => {
    const result = createOEEResult(
      'Enterprise B',
      'Site2',
      75.0,
      null,
      1,
      'Pre-computed'
    );

    expect(result.quality.confidence).toBe(0.95);
  });

  test('Result includes timestamp in ISO format', () => {
    const result = createOEEResult(
      'Enterprise A',
      'Site1',
      85.5,
      null,
      1,
      'Direct OEE'
    );

    expect(result.timestamp).toBeDefined();
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
  });

  test('Result includes enterprise and site', () => {
    const result = createOEEResult(
      'Enterprise C',
      'Site3',
      90.0,
      null,
      1,
      'Test'
    );

    expect(result.enterprise).toBe('Enterprise C');
    expect(result.site).toBe('Site3');
  });

  test('OEE value is rounded to 1 decimal place', () => {
    const result = createOEEResult(
      'Enterprise A',
      'Site1',
      85.5678,
      null,
      1,
      'Test'
    );

    expect(result.oee).toBe(85.6);
  });

  test('Default empty meta when not provided', () => {
    const result = createOEEResult(
      'Enterprise A',
      'Site1',
      85.5,
      null,
      1,
      'Test'
    );

    expect(result.calculation.measurementsUsed).toEqual([]);
    expect(result.calculation.dataPoints).toBe(0);
  });

  test('Time range is included in calculation metadata', () => {
    const result = createOEEResult(
      'Enterprise A',
      'Site1',
      85.5,
      null,
      1,
      'Test'
    );

    expect(result.calculation.timeRange).toEqual({ start: '-24h', end: 'now()' });
  });

  test('Components can be null', () => {
    const result = createOEEResult(
      'Enterprise A',
      'Site1',
      85.5,
      null,
      1,
      'Test'
    );

    expect(result.components).toBeNull();
  });

  test('Site can be null', () => {
    const result = createOEEResult(
      'Enterprise A',
      null,
      85.5,
      null,
      1,
      'Test'
    );

    expect(result.site).toBeNull();
  });
});

describe('OEE_TIERS constant', () => {
  test('Tier 1 is pre-computed-overall', () => {
    expect(OEE_TIERS[1]).toBe('pre-computed-overall');
  });

  test('Tier 2 is pre-computed-components', () => {
    expect(OEE_TIERS[2]).toBe('pre-computed-components');
  });

  test('Tier 3 is calculated-from-raw', () => {
    expect(OEE_TIERS[3]).toBe('calculated-from-raw');
  });

  test('Tier 4 is insufficient-data', () => {
    expect(OEE_TIERS[4]).toBe('insufficient-data');
  });
});
