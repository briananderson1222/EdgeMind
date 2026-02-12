// lib/spc/__tests__/spc.test.js - Tests for SPC module

const {
  calculateCpk,
  calculateStatistics,
  detectOutOfControl,
  calculateProblematicScore
} = require('../index');

describe('SPC Module', () => {
  describe('calculateCpk', () => {
    it('should calculate Cpk correctly for process within limits', () => {
      const measurements = [7.0, 7.1, 6.9, 7.2, 6.8, 7.0, 7.05, 6.95];
      const lsl = 6.5;
      const usl = 7.5;

      const cpk = calculateCpk(measurements, lsl, usl);

      expect(cpk).toBeGreaterThan(1.0);
      expect(cpk).toBeLessThan(2.5);
    });

    it('should return 0 for empty measurements', () => {
      const cpk = calculateCpk([], 5, 10);
      expect(cpk).toBe(0);
    });

    it('should return 0 for single measurement', () => {
      const cpk = calculateCpk([7.0], 5, 10);
      expect(cpk).toBe(0);
    });

    it('should return 0 when standard deviation is zero', () => {
      const measurements = [7.0, 7.0, 7.0, 7.0];
      const cpk = calculateCpk(measurements, 6, 8);
      expect(cpk).toBe(0);
    });

    it('should return low Cpk for out-of-control process', () => {
      const measurements = [5.0, 7.5, 4.0, 8.0, 3.5, 9.0];
      const lsl = 6.0;
      const usl = 7.0;

      const cpk = calculateCpk(measurements, lsl, usl);

      expect(cpk).toBeLessThan(0.5);
    });

    it('should favor the tighter limit', () => {
      // Process closer to upper limit
      const measurements = [6.8, 6.9, 6.85, 6.95];
      const lsl = 5.0;
      const usl = 7.0;

      const cpk = calculateCpk(measurements, lsl, usl);

      // Cpk should be limited by upper spec
      expect(cpk).toBeLessThan(1.0);
    });
  });

  describe('calculateStatistics', () => {
    it('should calculate mean correctly', () => {
      const measurements = [10, 20, 30, 40, 50];
      const stats = calculateStatistics(measurements);

      expect(stats.mean).toBe(30);
      expect(stats.count).toBe(5);
    });

    it('should calculate standard deviation', () => {
      const measurements = [2, 4, 4, 4, 5, 5, 7, 9];
      const stats = calculateStatistics(measurements);

      expect(stats.stdDev).toBeGreaterThan(1);
      expect(stats.stdDev).toBeLessThan(3);
    });

    it('should calculate min and max', () => {
      const measurements = [15, 22, 8, 35, 12];
      const stats = calculateStatistics(measurements);

      expect(stats.min).toBe(8);
      expect(stats.max).toBe(35);
    });

    it('should handle empty array', () => {
      const stats = calculateStatistics([]);

      expect(stats.mean).toBe(0);
      expect(stats.stdDev).toBe(0);
      expect(stats.count).toBe(0);
    });

    it('should calculate variance', () => {
      const measurements = [10, 12, 14, 16, 18];
      const stats = calculateStatistics(measurements);

      expect(stats.variance).toBeGreaterThan(0);
      expect(stats.stdDev).toBe(Math.sqrt(stats.variance));
    });
  });

  describe('detectOutOfControl', () => {
    it('should detect points beyond UCL', () => {
      const measurements = [
        { timestamp: '2026-02-03T10:00:00Z', value: 50 },
        { timestamp: '2026-02-03T11:00:00Z', value: 51 },
        { timestamp: '2026-02-03T12:00:00Z', value: 80 }, // Out of control
        { timestamp: '2026-02-03T13:00:00Z', value: 49 }
      ];
      const mean = 50;
      const stdDev = 5;

      const outOfControl = detectOutOfControl(measurements, mean, stdDev);

      expect(outOfControl.length).toBeGreaterThan(0);
      expect(outOfControl[0].index).toBe(2);
      expect(outOfControl[0].violationType).toBe('upper');
    });

    it('should detect points below LCL', () => {
      const measurements = [
        { timestamp: '2026-02-03T10:00:00Z', value: 50 },
        { timestamp: '2026-02-03T11:00:00Z', value: 20 }, // Out of control
        { timestamp: '2026-02-03T12:00:00Z', value: 51 }
      ];
      const mean = 50;
      const stdDev = 5;

      const outOfControl = detectOutOfControl(measurements, mean, stdDev);

      expect(outOfControl.length).toBeGreaterThan(0);
      expect(outOfControl[0].violationType).toBe('lower');
    });

    it('should return empty array when all points in control', () => {
      const measurements = [
        { timestamp: '2026-02-03T10:00:00Z', value: 50 },
        { timestamp: '2026-02-03T11:00:00Z', value: 51 },
        { timestamp: '2026-02-03T12:00:00Z', value: 49 }
      ];
      const mean = 50;
      const stdDev = 10; // Wide limits

      const outOfControl = detectOutOfControl(measurements, mean, stdDev);

      expect(outOfControl).toHaveLength(0);
    });

    it('should handle empty measurements', () => {
      const outOfControl = detectOutOfControl([], 50, 5);
      expect(outOfControl).toHaveLength(0);
    });

    it('should handle numeric array (not objects)', () => {
      const measurements = [50, 51, 80, 49];
      const mean = 50;
      const stdDev = 5;

      const outOfControl = detectOutOfControl(measurements, mean, stdDev);

      expect(outOfControl.length).toBeGreaterThan(0);
    });
  });

  describe('calculateProblematicScore', () => {
    it('should return high score for low Cpk', () => {
      const stats = { mean: 10, stdDev: 5, count: 50 };
      const cpk = 0.5; // Poor capability
      const outOfControlCount = 0;

      const score = calculateProblematicScore(stats, cpk, outOfControlCount);

      expect(score).toBeGreaterThan(0.3);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('should return low score for good process', () => {
      const stats = { mean: 100, stdDev: 1, count: 50 };
      const cpk = 2.0; // Excellent capability
      const outOfControlCount = 0;

      const score = calculateProblematicScore(stats, cpk, outOfControlCount);

      expect(score).toBeLessThan(0.2);
      expect(score).toBeGreaterThanOrEqual(0);
    });

    it('should increase score with out-of-control points', () => {
      const stats = { mean: 50, stdDev: 2, count: 100 };
      const cpk = 1.5;

      const scoreWithoutOOC = calculateProblematicScore(stats, cpk, 0);
      const scoreWithOOC = calculateProblematicScore(stats, cpk, 10);

      expect(scoreWithOOC).toBeGreaterThan(scoreWithoutOOC);
    });

    it('should handle zero mean gracefully', () => {
      const stats = { mean: 0, stdDev: 1, count: 50 };
      const cpk = 1.5;
      const outOfControlCount = 0;

      const score = calculateProblematicScore(stats, cpk, outOfControlCount);

      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('should cap score at 1.0', () => {
      const stats = { mean: 10, stdDev: 100, count: 50 };
      const cpk = 0.1; // Very poor
      const outOfControlCount = 50;

      const score = calculateProblematicScore(stats, cpk, outOfControlCount);

      expect(score).toBeLessThanOrEqual(1); // Should be capped at 1
      expect(score).toBeGreaterThan(0.9); // Should be very high for poor process
    });
  });
});
