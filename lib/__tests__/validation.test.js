/**
 * @file validation.test.js
 * @description Tests for validation and utility functions
 */

const {
  sanitizeInfluxIdentifier,
  validateEnterprise,
  validateSite,
  extractMeasurementFromTopic,
  formatDuration,
  VALID_ENTERPRISES,
  MAX_INPUT_LENGTH
} = require('../validation');

describe('sanitizeInfluxIdentifier', () => {
  test('normal string passes through unchanged', () => {
    expect(sanitizeInfluxIdentifier('Enterprise A')).toBe('Enterprise A');
  });

  test('removes double quotes', () => {
    expect(sanitizeInfluxIdentifier('Enter"prise')).toBe('Enterprise');
  });

  test('removes backslashes', () => {
    expect(sanitizeInfluxIdentifier('Enter\\prise')).toBe('Enterprise');
  });

  test('removes both quotes and backslashes', () => {
    expect(sanitizeInfluxIdentifier('Ent"er\\prise"')).toBe('Enterprise');
  });

  test('non-string input returns empty string - null', () => {
    expect(sanitizeInfluxIdentifier(null)).toBe('');
  });

  test('non-string input returns empty string - undefined', () => {
    expect(sanitizeInfluxIdentifier(undefined)).toBe('');
  });

  test('non-string input returns empty string - number', () => {
    expect(sanitizeInfluxIdentifier(123)).toBe('');
  });

  test('empty string returns empty string', () => {
    expect(sanitizeInfluxIdentifier('')).toBe('');
  });

  test('flux injection attempt strips quotes', () => {
    expect(sanitizeInfluxIdentifier('" or 1==1 //')).toBe(' or 1==1 //');
  });
});

describe('validateEnterprise', () => {
  test('whitelisted value "ALL" passes', () => {
    expect(validateEnterprise('ALL')).toBe('ALL');
  });

  test('whitelisted value "Enterprise A" passes', () => {
    expect(validateEnterprise('Enterprise A')).toBe('Enterprise A');
  });

  test('whitelisted value "Enterprise B" passes', () => {
    expect(validateEnterprise('Enterprise B')).toBe('Enterprise B');
  });

  test('whitelisted value "Enterprise C" passes', () => {
    expect(validateEnterprise('Enterprise C')).toBe('Enterprise C');
  });

  test('falsy input defaults to "ALL" - null', () => {
    expect(validateEnterprise(null)).toBe('ALL');
  });

  test('falsy input defaults to "ALL" - undefined', () => {
    expect(validateEnterprise(undefined)).toBe('ALL');
  });

  test('empty string defaults to "ALL"', () => {
    expect(validateEnterprise('')).toBe('ALL');
  });

  test('oversized input returns null', () => {
    const oversized = 'x'.repeat(1001);
    expect(validateEnterprise(oversized)).toBeNull();
  });

  test('dynamic enterprise with valid chars passes through sanitization', () => {
    expect(validateEnterprise('Custom Enterprise')).toBe('Custom Enterprise');
  });

  test('non-string input returns "ALL"', () => {
    expect(validateEnterprise(123)).toBe('ALL');
  });

  test('dynamic enterprise with invalid chars gets sanitized', () => {
    expect(validateEnterprise('Enter"prise')).toBe('Enterprise');
  });

  test('sanitized string over 100 chars returns null', () => {
    const tooLong = 'a'.repeat(101);
    expect(validateEnterprise(tooLong)).toBeNull();
  });

  test('returns null when input sanitizes to empty string', () => {
    expect(validateEnterprise('"\\\\"')).toBeNull();
  });
});

describe('validateSite', () => {
  test('valid site passes', () => {
    expect(validateSite('Dallas Line 1')).toBe('Dallas Line 1');
  });

  test('falsy input returns null - null', () => {
    expect(validateSite(null)).toBeNull();
  });

  test('falsy input returns null - undefined', () => {
    expect(validateSite(undefined)).toBeNull();
  });

  test('oversized input returns null', () => {
    const oversized = 'x'.repeat(1001);
    expect(validateSite(oversized)).toBeNull();
  });

  test('non-string input returns null', () => {
    expect(validateSite(123)).toBeNull();
  });

  test('sanitized string over 100 chars returns null', () => {
    const tooLong = 'a'.repeat(101);
    expect(validateSite(tooLong)).toBeNull();
  });

  test('empty string returns null', () => {
    expect(validateSite('')).toBeNull();
  });
});

describe('extractMeasurementFromTopic', () => {
  test('standard topic extracts measurement name', () => {
    const topic = 'Enterprise A/Dallas Line 1/packaging/machine1/quality/oee';
    expect(extractMeasurementFromTopic(topic)).toBe('quality_oee');
  });

  test('short topic with 2 parts', () => {
    expect(extractMeasurementFromTopic('quality/oee')).toBe('quality_oee');
  });

  test('too short topic (1 part) returns null', () => {
    expect(extractMeasurementFromTopic('oee')).toBeNull();
  });

  test('special characters replaced with underscore', () => {
    expect(extractMeasurementFromTopic('metric-name/oee.value')).toBe('metric_name_oee_value');
  });

  test('empty topic returns null', () => {
    expect(extractMeasurementFromTopic('')).toBeNull();
  });

  test('throws on null input', () => {
    expect(() => extractMeasurementFromTopic(null)).toThrow();
  });
});

describe('formatDuration', () => {
  test('zero duration', () => {
    expect(formatDuration(0)).toBe('0s');
  });

  test('seconds only', () => {
    expect(formatDuration(3000)).toBe('3s');
  });

  test('minutes and seconds', () => {
    expect(formatDuration(90000)).toBe('1m 30s');
  });

  test('hours and minutes', () => {
    expect(formatDuration(3660000)).toBe('1h 1m');
  });

  test('days and hours', () => {
    expect(formatDuration(90000000)).toBe('1d 1h');
  });

  test('exact minutes (no seconds remainder)', () => {
    expect(formatDuration(120000)).toBe('2m 0s');
  });

  test('exact hours (no minutes remainder)', () => {
    expect(formatDuration(7200000)).toBe('2h 0m');
  });

  test('less than one second', () => {
    expect(formatDuration(500)).toBe('0s');
  });

  test('handles negative input', () => {
    const result = formatDuration(-5000);
    expect(typeof result).toBe('string');
    // Negative duration may produce strange output like "-5s" or "-0d -0h"
    // The key is it doesn't crash and returns a string
  });
});

describe('Constants', () => {
  test('VALID_ENTERPRISES contains expected values', () => {
    expect(VALID_ENTERPRISES).toEqual(['ALL', 'Enterprise A', 'Enterprise B', 'Enterprise C']);
  });

  test('MAX_INPUT_LENGTH is 1000', () => {
    expect(MAX_INPUT_LENGTH).toBe(1000);
  });
});
