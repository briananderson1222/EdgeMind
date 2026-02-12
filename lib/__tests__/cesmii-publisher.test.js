/**
 * @file cesmii-publisher.test.js
 * @description Tests for CESMII SM Profile publisher and demo publisher
 */

const { randomUUID } = require('crypto');
const {
  wrapAsJsonLd,
  publishOEEReport,
  publishFactoryInsight,
  init: initPublisher
} = require('../cesmii/publisher');

const {
  startDemoWorkOrders,
  stopDemoWorkOrders,
  getStatus
} = require('../cesmii/demo-publisher');

const { factoryState } = require('../state');

// Mock MQTT client
const mockMqttClient = {
  connected: true,
  publish: jest.fn()
};

const SAMPLE_OEE_DATA = {
  oee: '85',
  availability: '90',
  performance: '95',
  quality: '100',
  tier: 'tier1',
  confidence: 0.9
};

describe('CESMII Publisher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMqttClient.connected = true;
    factoryState.cesmiiStats.profilesPublished = 0;
    factoryState.cesmiiStats.lastPublishAt = null;
  });

  describe('wrapAsJsonLd', () => {
    test('creates proper JSON-LD structure', () => {
      const data = {
        ReportId: 'test-123',
        OEE: 85.5
      };
      const result = wrapAsJsonLd(data, 'OEEReportV1', 'https://example.com/profile.jsonld');

      expect(result).toHaveProperty('@context');
      expect(result['@context']).toHaveProperty('@vocab', 'https://cesmii.org/smprofile/');
      expect(result['@context']).toHaveProperty('profile', 'https://cesmii.org/smprofile/profile');
      expect(result['@context']).toHaveProperty('opc', 'http://opcfoundation.org/UA/');
      expect(result).toHaveProperty('@type', 'OEEReportV1');
      expect(result).toHaveProperty('profileDefinition', 'https://example.com/profile.jsonld');
      expect(result).toHaveProperty('ReportId', 'test-123');
      expect(result).toHaveProperty('OEE', 85.5);
    });

    test('merges data fields into JSON-LD payload', () => {
      const data = {
        Field1: 'value1',
        Field2: 42,
        Field3: true
      };
      const result = wrapAsJsonLd(data, 'TestProfile', 'https://test.com');

      expect(result.Field1).toBe('value1');
      expect(result.Field2).toBe(42);
      expect(result.Field3).toBe(true);
    });
  });

  describe('publishOEEReport', () => {
    beforeEach(() => {
      initPublisher({ mqttClient: mockMqttClient });
    });

    test('publishes correctly formatted OEE payload', () => {
      const oeeData = { ...SAMPLE_OEE_DATA, oee: '85.5', confidence: 0.95 };

      const success = publishOEEReport(oeeData, 'Enterprise A', 'Site1');

      expect(success).toBe(true);
      expect(mockMqttClient.publish).toHaveBeenCalledTimes(1);

      const [topic, payload] = mockMqttClient.publish.mock.calls[0];
      expect(topic).toBe('edgemind/oee/Enterprise A/Site1');

      const parsed = JSON.parse(payload);
      expect(parsed).toHaveProperty('@context');
      expect(parsed).toHaveProperty('@type', 'OEEReportV1');
      expect(parsed).toHaveProperty('profileDefinition');
      expect(parsed.profileDefinition).toContain('OEEReportV1.jsonld');
      expect(parsed).toHaveProperty('ReportId');
      expect(parsed).toHaveProperty('Enterprise', 'Enterprise A');
      expect(parsed).toHaveProperty('Site', 'Site1');
      expect(parsed).toHaveProperty('OEE', 85.5);
      expect(parsed).toHaveProperty('Availability', 90.0);
      expect(parsed).toHaveProperty('Performance', 95.0);
      expect(parsed).toHaveProperty('Quality', 100.0);
      expect(parsed).toHaveProperty('CalculationTier', 'tier1');
      expect(parsed).toHaveProperty('Confidence', 0.95);
      expect(parsed).toHaveProperty('CalculatedAt');
    });

    test('uses "ALL" for missing site', () => {
      const oeeData = { ...SAMPLE_OEE_DATA, oee: '80', availability: '85', performance: '90', quality: '95', tier: 'tier2' };
      publishOEEReport(oeeData, 'Enterprise B', null);

      const [topic, payload] = mockMqttClient.publish.mock.calls[0];
      expect(topic).toBe('edgemind/oee/Enterprise B/ALL');

      const parsed = JSON.parse(payload);
      expect(parsed.Site).toBe('ALL');
    });

    test('handles missing confidence with default 0.5', () => {
      const oeeData = { oee: '75', availability: '80', performance: '85', quality: '90', tier: 'tier3' };
      publishOEEReport(oeeData, 'Enterprise C', 'Site2');

      const [, payload] = mockMqttClient.publish.mock.calls[0];
      const parsed = JSON.parse(payload);
      expect(parsed.Confidence).toBe(0.5);
    });

    test('updates stats counters on publish', () => {
      const oeeData = SAMPLE_OEE_DATA;

      const initialCount = factoryState.cesmiiStats.profilesPublished;
      publishOEEReport(oeeData, 'Enterprise A', 'Site1');

      expect(factoryState.cesmiiStats.profilesPublished).toBe(initialCount + 1);
      expect(factoryState.cesmiiStats.lastPublishAt).toBeTruthy();
    });

    test('handles disconnected MQTT gracefully', () => {
      mockMqttClient.connected = false;

      const oeeData = SAMPLE_OEE_DATA;
      const success = publishOEEReport(oeeData, 'Enterprise A', 'Site1');

      expect(success).toBe(false);
      expect(mockMqttClient.publish).not.toHaveBeenCalled();
    });

    test('handles publish error gracefully', () => {
      mockMqttClient.publish.mockImplementationOnce(() => {
        throw new Error('MQTT publish failed');
      });

      const oeeData = SAMPLE_OEE_DATA;
      const success = publishOEEReport(oeeData, 'Enterprise A', 'Site1');

      expect(success).toBe(false);
    });
  });

  describe('publishFactoryInsight', () => {
    beforeEach(() => {
      initPublisher({ mqttClient: mockMqttClient });
    });

    test('publishes correctly formatted insight payload', () => {
      const insight = {
        summary: 'Temperature trending upward in packaging area',
        severity: 'warning',
        category: 'trend',
        confidence: 0.85
      };

      const success = publishFactoryInsight(insight, 'Enterprise A');

      expect(success).toBe(true);
      expect(mockMqttClient.publish).toHaveBeenCalledTimes(1);

      const [topic, payload] = mockMqttClient.publish.mock.calls[0];
      expect(topic).toBe('edgemind/insights/Enterprise A');

      const parsed = JSON.parse(payload);
      expect(parsed).toHaveProperty('@context');
      expect(parsed).toHaveProperty('@type', 'FactoryInsightV1');
      expect(parsed).toHaveProperty('profileDefinition');
      expect(parsed.profileDefinition).toContain('FactoryInsightV1.jsonld');
      expect(parsed).toHaveProperty('InsightId');
      expect(parsed).toHaveProperty('Enterprise', 'Enterprise A');
      expect(parsed).toHaveProperty('Summary', insight.summary);
      expect(parsed).toHaveProperty('Severity', 'warning');
      expect(parsed).toHaveProperty('Category', 'trend');
      expect(parsed).toHaveProperty('Confidence', 0.85);
      expect(parsed).toHaveProperty('GeneratedAt');
    });

    test('uses "ALL" for missing enterprise', () => {
      const insight = { summary: 'Test insight' };
      publishFactoryInsight(insight, null);

      const [topic, payload] = mockMqttClient.publish.mock.calls[0];
      expect(topic).toBe('edgemind/insights/ALL');

      const parsed = JSON.parse(payload);
      expect(parsed.Enterprise).toBe('ALL');
    });

    test('uses default values for missing fields', () => {
      const insight = { summary: 'Minimal insight' };
      publishFactoryInsight(insight, 'Enterprise B');

      const [, payload] = mockMqttClient.publish.mock.calls[0];
      const parsed = JSON.parse(payload);
      expect(parsed.Severity).toBe('info');
      expect(parsed.Category).toBe('trend');
      expect(parsed.Confidence).toBe(0.7);
    });

    test('extracts summary from multiple field names', () => {
      const insight1 = { text: 'Using text field' };
      publishFactoryInsight(insight1, 'Enterprise A');
      let parsed = JSON.parse(mockMqttClient.publish.mock.calls[0][1]);
      expect(parsed.Summary).toBe('Using text field');

      mockMqttClient.publish.mockClear();

      const insight2 = { analysis: 'Using analysis field' };
      publishFactoryInsight(insight2, 'Enterprise A');
      parsed = JSON.parse(mockMqttClient.publish.mock.calls[0][1]);
      expect(parsed.Summary).toBe('Using analysis field');

      mockMqttClient.publish.mockClear();

      const insight3 = {};
      publishFactoryInsight(insight3, 'Enterprise A');
      parsed = JSON.parse(mockMqttClient.publish.mock.calls[0][1]);
      expect(parsed.Summary).toBe('EdgeMind AI insight');
    });

    test('truncates long summaries to 2000 chars', () => {
      const longSummary = 'A'.repeat(3000);
      const insight = { summary: longSummary };
      publishFactoryInsight(insight, 'Enterprise A');

      const [, payload] = mockMqttClient.publish.mock.calls[0];
      const parsed = JSON.parse(payload);
      expect(parsed.Summary.length).toBe(2000);
    });

    test('updates stats counters on publish', () => {
      const insight = { summary: 'Test insight' };
      const initialCount = factoryState.cesmiiStats.profilesPublished;

      publishFactoryInsight(insight, 'Enterprise A');

      expect(factoryState.cesmiiStats.profilesPublished).toBe(initialCount + 1);
      expect(factoryState.cesmiiStats.lastPublishAt).toBeTruthy();
    });

    test('handles disconnected MQTT gracefully', () => {
      mockMqttClient.connected = false;

      const insight = { summary: 'Test insight' };
      const success = publishFactoryInsight(insight, 'Enterprise A');

      expect(success).toBe(false);
      expect(mockMqttClient.publish).not.toHaveBeenCalled();
    });
  });
});

describe('CESMII Demo Publisher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMqttClient.connected = true;
    stopDemoWorkOrders();
    jest.useFakeTimers();
  });

  afterEach(() => {
    stopDemoWorkOrders();
    jest.useRealTimers();
  });

  describe('Work Order Generation', () => {
    test('generates valid WorkOrderV1 structure', () => {
      startDemoWorkOrders(mockMqttClient, 10000);

      expect(mockMqttClient.publish).toHaveBeenCalled();
      const [, payload] = mockMqttClient.publish.mock.calls[0];
      const workOrder = JSON.parse(payload);

      // Check JSON-LD structure
      expect(workOrder).toHaveProperty('@context');
      expect(workOrder['@context']).toHaveProperty('@vocab', 'https://cesmii.org/smprofile/');
      expect(workOrder).toHaveProperty('@type', 'WorkOrderV1');
      expect(workOrder).toHaveProperty('profileDefinition');
      expect(workOrder.profileDefinition).toContain('WorkOrderV1.jsonld');

      // Check required fields
      expect(workOrder).toHaveProperty('WorkOrderId');
      expect(workOrder.WorkOrderId).toMatch(/^WO-\d{4}-\d{4}$/);
      expect(workOrder).toHaveProperty('ProductName');
      expect(workOrder).toHaveProperty('Quantity');
      expect(workOrder).toHaveProperty('UnitOfMeasure');
      expect(workOrder).toHaveProperty('Status');
      expect(workOrder).toHaveProperty('Priority');
      expect(workOrder).toHaveProperty('StartTime');
      expect(workOrder).toHaveProperty('EndTime');
      expect(workOrder).toHaveProperty('Ingredients');

      // Validate ingredients array
      expect(Array.isArray(workOrder.Ingredients)).toBe(true);
      expect(workOrder.Ingredients.length).toBeGreaterThan(0);

      workOrder.Ingredients.forEach(ing => {
        expect(ing).toHaveProperty('IngredientName');
        expect(ing).toHaveProperty('Quantity');
        expect(ing).toHaveProperty('UnitOfMeasure');
        expect(ing).toHaveProperty('LotNumber');
        expect(ing).toHaveProperty('PercentOfTotal');
        expect(typeof ing.PercentOfTotal).toBe('number');
      });
    });

    test('publishes to correct topic', () => {
      startDemoWorkOrders(mockMqttClient, 10000);

      const [topic] = mockMqttClient.publish.mock.calls[0];
      expect(topic).toBe('Enterprise B/conceptreply/cesmii/WorkOrder');
    });

    test('generates unique work order IDs', () => {
      startDemoWorkOrders(mockMqttClient, 1000);

      // Get initial work order ID
      const ids = new Set();
      const [, initialPayload] = mockMqttClient.publish.mock.calls[0];
      ids.add(JSON.parse(initialPayload).WorkOrderId);

      // Get IDs from subsequent intervals
      for (let i = 0; i < 5; i++) {
        jest.advanceTimersByTime(1000);
        const [, payload] = mockMqttClient.publish.mock.calls[mockMqttClient.publish.mock.calls.length - 1];
        const workOrder = JSON.parse(payload);
        ids.add(workOrder.WorkOrderId);
      }

      expect(ids.size).toBe(6); // Initial + 5 intervals
    });
  });

  describe('Publisher Lifecycle', () => {
    test('starts publishing immediately', () => {
      startDemoWorkOrders(mockMqttClient, 10000);

      expect(mockMqttClient.publish).toHaveBeenCalledTimes(1);
    });

    test('publishes at regular intervals', () => {
      startDemoWorkOrders(mockMqttClient, 5000);

      expect(mockMqttClient.publish).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(5000);
      expect(mockMqttClient.publish).toHaveBeenCalledTimes(2);

      jest.advanceTimersByTime(5000);
      expect(mockMqttClient.publish).toHaveBeenCalledTimes(3);
    });

    test('throws error when starting while already running', () => {
      startDemoWorkOrders(mockMqttClient, 10000);

      expect(() => {
        startDemoWorkOrders(mockMqttClient, 10000);
      }).toThrow('Demo work order publisher already running');
    });

    test('stops publishing', () => {
      startDemoWorkOrders(mockMqttClient, 5000);
      const initialCount = mockMqttClient.publish.mock.calls.length;

      const result = stopDemoWorkOrders();

      expect(result.status).toBe('stopped');

      jest.advanceTimersByTime(10000);
      expect(mockMqttClient.publish).toHaveBeenCalledTimes(initialCount);
    });

    test('returns not_running when stopping already stopped publisher', () => {
      const result = stopDemoWorkOrders();
      expect(result.status).toBe('not_running');
    });

    test('handles MQTT disconnect gracefully', () => {
      mockMqttClient.connected = false;
      startDemoWorkOrders(mockMqttClient, 5000);

      // Should attempt to publish but fail silently
      expect(mockMqttClient.publish).not.toHaveBeenCalled();
    });
  });

  describe('Status Reporting', () => {
    test('reports running status', () => {
      let status = getStatus();
      expect(status.running).toBe(false);

      startDemoWorkOrders(mockMqttClient, 10000);
      status = getStatus();
      expect(status.running).toBe(true);

      stopDemoWorkOrders();
      status = getStatus();
      expect(status.running).toBe(false);
    });

    test('tracks order count', () => {
      startDemoWorkOrders(mockMqttClient, 1000);
      let status = getStatus();
      const initialCount = status.orderCount;

      jest.advanceTimersByTime(3000);
      status = getStatus();
      expect(status.orderCount).toBe(initialCount + 3);
    });
  });
});
