// lib/__tests__/cesmii-handler.test.js - CESMII Handler Tests
'use strict';

// Mock Point class before requiring handler
const mockPointInstance = {
  tag: jest.fn().mockReturnThis(),
  stringField: jest.fn().mockReturnThis(),
  floatField: jest.fn().mockReturnThis()
};

const mockPointConstructor = jest.fn(() => mockPointInstance);

jest.mock('@influxdata/influxdb-client', () => ({
  Point: mockPointConstructor
}));

const { handleCesmiiMessage, init } = require('../cesmii/handler');
const { isCesmiiPayload } = require('../cesmii/detector');
const { factoryState } = require('../state');
const CONFIG = require('../config');

// Mock InfluxDB writeApi
const mockWriteApi = {
  writePoint: jest.fn()
};

// Mock broadcast function
const mockBroadcast = jest.fn();

// Sample valid WorkOrderV1 payload
const validWorkOrder = {
  '@context': { '@vocab': 'https://cesmii.org/smprofile/' },
  '@type': 'WorkOrderV1',
  'profileDefinition': 'https://example.com/WorkOrderV1.jsonld',
  'WorkOrderId': 'WO-2026-001',
  'ProductName': 'Widget A',
  'Quantity': 1000,
  'UnitOfMeasure': 'units',
  'Status': 'New',
  'Priority': 1,
  'StartTime': '2026-02-11T08:00:00Z',
  'EndTime': '2026-02-11T16:00:00Z',
  'Ingredients': [
    {
      'IngredientName': 'Raw Material X',
      'Quantity': 500.5,
      'UnitOfMeasure': 'kg',
      'LotNumber': 'LOT-001',
      'PercentOfTotal': 50.5
    }
  ]
};

// Invalid payload (missing required fields)
const invalidWorkOrder = {
  '@context': { '@vocab': 'https://cesmii.org/smprofile/' },
  '@type': 'WorkOrderV1',
  'profileDefinition': 'https://example.com/WorkOrderV1.jsonld'
  // Missing WorkOrderId, ProductName, Quantity, etc.
};

// Unknown profile type
const unknownProfilePayload = {
  '@context': { '@vocab': 'https://cesmii.org/smprofile/' },
  '@type': 'UnknownProfileType',
  'profileDefinition': 'https://example.com/Unknown.jsonld',
  'someField': 'someValue'
};

// Non-CESMII JSON
const nonCesmiiPayload = {
  temperature: 72.5,
  pressure: 101.3
};

describe('CESMII Handler', () => {
  let originalValidationStrict;

  beforeEach(() => {
    // Save original config
    originalValidationStrict = CONFIG.cesmii.validationStrict;

    factoryState.cesmiiWorkOrders = [];
    factoryState.cesmiiStats = {
      workOrdersReceived: 0,
      workOrdersValidated: 0,
      workOrdersFailed: 0,
      profilesPublished: 0,
      lastWorkOrderAt: null,
      lastPublishAt: null
    };
    factoryState.stats.influxWrites = 0;

    jest.clearAllMocks();

    // Reset Point mock
    mockPointInstance.tag.mockClear().mockReturnThis();
    mockPointInstance.stringField.mockClear().mockReturnThis();
    mockPointInstance.floatField.mockClear().mockReturnThis();
    mockPointConstructor.mockClear();

    init({ writeApi: mockWriteApi, broadcast: mockBroadcast });
  });

  afterEach(() => {
    // Restore original config
    CONFIG.cesmii.validationStrict = originalValidationStrict;
  });

  describe('handleCesmiiMessage with valid payload', () => {
    test('should store work order in factoryState', () => {
      const topic = 'Enterprise A/Dallas Line 1/cesmii/work-orders';
      const result = handleCesmiiMessage(topic, validWorkOrder);

      expect(result).toBe(true);
      expect(factoryState.cesmiiWorkOrders).toHaveLength(1);

      const stored = factoryState.cesmiiWorkOrders[0];
      expect(stored.profileType).toBe('WorkOrderV1');
      expect(stored.enterprise).toBe('Enterprise A');
      expect(stored.site).toBe('Dallas Line 1');
      expect(stored.validationStatus).toBe('valid');
      expect(stored.payload).toEqual(validWorkOrder);
    });

    test('should increment stats counters', () => {
      const topic = 'Enterprise B/Site3/cesmii/work-orders';
      handleCesmiiMessage(topic, validWorkOrder);

      expect(factoryState.cesmiiStats.workOrdersReceived).toBe(1);
      expect(factoryState.cesmiiStats.workOrdersValidated).toBe(1);
      expect(factoryState.cesmiiStats.workOrdersFailed).toBe(0);
      expect(factoryState.cesmiiStats.lastWorkOrderAt).toBeTruthy();
    });

    test('should broadcast via WebSocket', () => {
      const topic = 'Enterprise A/Site1/cesmii/work-orders';
      handleCesmiiMessage(topic, validWorkOrder);

      expect(mockBroadcast).toHaveBeenCalledTimes(1);
      expect(mockBroadcast).toHaveBeenCalledWith({
        type: 'cesmii_work_order',
        data: expect.objectContaining({
          profileType: 'WorkOrderV1',
          validationStatus: 'valid'
        })
      });
    });

    test('should write to InfluxDB', () => {
      const topic = 'Enterprise A/Site1/cesmii/work-orders';
      handleCesmiiMessage(topic, validWorkOrder);

      expect(mockWriteApi.writePoint).toHaveBeenCalledTimes(1);
      expect(factoryState.stats.influxWrites).toBe(1);
    });

    test('should handle injected flag', () => {
      const topic = 'Enterprise A/Site1/cesmii/work-orders';
      handleCesmiiMessage(topic, validWorkOrder, { isInjected: true });

      const stored = factoryState.cesmiiWorkOrders[0];
      expect(stored.isInjected).toBe(true);
    });
  });

  describe('handleCesmiiMessage with invalid payload', () => {
    test('should increment workOrdersFailed counter', () => {
      const topic = 'Enterprise A/Site1/cesmii/work-orders';
      handleCesmiiMessage(topic, invalidWorkOrder);

      expect(factoryState.cesmiiStats.workOrdersReceived).toBe(1);
      expect(factoryState.cesmiiStats.workOrdersFailed).toBe(1);
      expect(factoryState.cesmiiStats.workOrdersValidated).toBe(0);
    });

    test('should NOT store in strict mode', () => {
      CONFIG.cesmii.validationStrict = true;

      const topic = 'Enterprise A/Site1/cesmii/work-orders';
      const result = handleCesmiiMessage(topic, invalidWorkOrder);

      expect(result).toBe(true); // Handled but rejected
      expect(factoryState.cesmiiWorkOrders).toHaveLength(0);
    });

    test('should still store in non-strict mode', () => {
      CONFIG.cesmii.validationStrict = false;

      const topic = 'Enterprise A/Site1/cesmii/work-orders';
      const result = handleCesmiiMessage(topic, invalidWorkOrder);

      expect(result).toBe(true);
      expect(factoryState.cesmiiWorkOrders).toHaveLength(1);

      const stored = factoryState.cesmiiWorkOrders[0];
      expect(stored.validationStatus).toBe('invalid');
      expect(stored.validationErrors.length).toBeGreaterThan(0);
    });
  });

  describe('handleCesmiiMessage with unknown profile type', () => {
    test('should store with validationStatus no_profile', () => {
      const topic = 'Enterprise A/Site1/cesmii/work-orders';
      const result = handleCesmiiMessage(topic, unknownProfilePayload);

      expect(result).toBe(true);
      expect(factoryState.cesmiiWorkOrders).toHaveLength(1);

      const stored = factoryState.cesmiiWorkOrders[0];
      expect(stored.profileType).toBe('UnknownProfileType');
      expect(stored.validationStatus).toBe('no_profile');
    });
  });

  describe('isCesmiiPayload integration', () => {
    test('should NOT handle non-CESMII JSON', () => {
      const topic = 'Enterprise A/Site1/sensors/temp';
      const result = handleCesmiiMessage(topic, nonCesmiiPayload);

      expect(result).toBe(false);
      expect(factoryState.cesmiiWorkOrders).toHaveLength(0);
      expect(factoryState.cesmiiStats.workOrdersReceived).toBe(0);
    });

    test('should detect CESMII payload correctly', () => {
      expect(isCesmiiPayload(validWorkOrder)).toBe(true);
      expect(isCesmiiPayload(nonCesmiiPayload)).toBe(false);
    });
  });

  describe('State management', () => {
    test('should cap work orders at maxWorkOrders', () => {
      const maxOrders = CONFIG.cesmii.maxWorkOrders;
      const topic = 'Enterprise A/Site1/cesmii/work-orders';

      // Add more than max
      for (let i = 0; i < maxOrders + 5; i++) {
        const payload = { ...validWorkOrder, WorkOrderId: `WO-${i}` };
        handleCesmiiMessage(topic, payload);
      }

      expect(factoryState.cesmiiWorkOrders.length).toBe(maxOrders);
      expect(factoryState.cesmiiStats.workOrdersReceived).toBe(maxOrders + 5);
    });

    test('should update lastWorkOrderAt timestamp', () => {
      const topic = 'Enterprise A/Site1/cesmii/work-orders';
      const before = new Date();

      handleCesmiiMessage(topic, validWorkOrder);

      const timestamp = new Date(factoryState.cesmiiStats.lastWorkOrderAt);
      expect(timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });
  });

  describe('InfluxDB point creation', () => {
    test('should create point with proper tags and fields', () => {
      const topic = 'Enterprise A/Dallas Line 1/cesmii/work-orders';

      handleCesmiiMessage(topic, validWorkOrder);

      expect(mockWriteApi.writePoint).toHaveBeenCalledTimes(1);

      // Verify Point constructor was called with measurement name
      expect(mockPointConstructor).toHaveBeenCalledWith('cesmii_work_order');

      // Verify tags
      expect(mockPointInstance.tag).toHaveBeenCalledWith('enterprise', 'Enterprise A');
      expect(mockPointInstance.tag).toHaveBeenCalledWith('site', 'Dallas Line 1');
      expect(mockPointInstance.tag).toHaveBeenCalledWith('profile_type', 'WorkOrderV1');
      expect(mockPointInstance.tag).toHaveBeenCalledWith('validation_status', 'valid');

      // Verify fields
      expect(mockPointInstance.stringField).toHaveBeenCalledWith('work_order_id', 'WO-2026-001');
      expect(mockPointInstance.stringField).toHaveBeenCalledWith('product_name', 'Widget A');
      expect(mockPointInstance.floatField).toHaveBeenCalledWith('quantity', 1000);
      expect(mockPointInstance.stringField).toHaveBeenCalledWith('status', 'New');
      expect(mockPointInstance.stringField).toHaveBeenCalledWith('raw_payload', expect.any(String));
    });

    test('should handle InfluxDB write errors gracefully', () => {
      mockWriteApi.writePoint.mockImplementationOnce(() => {
        throw new Error('InfluxDB connection failed');
      });

      const topic = 'Enterprise A/Site1/cesmii/work-orders';

      // Should not throw
      expect(() => {
        handleCesmiiMessage(topic, validWorkOrder);
      }).not.toThrow();

      // Work order should still be stored
      expect(factoryState.cesmiiWorkOrders).toHaveLength(1);
    });
  });

  describe('Topic parsing', () => {
    test('should extract enterprise and site from topic', () => {
      const topic = 'Enterprise B/Site3/cesmii/work-orders';
      handleCesmiiMessage(topic, validWorkOrder);

      const stored = factoryState.cesmiiWorkOrders[0];
      expect(stored.enterprise).toBe('Enterprise B');
      expect(stored.site).toBe('Site3');
    });

    test('should handle malformed topics gracefully', () => {
      const topic = 'malformed';
      handleCesmiiMessage(topic, validWorkOrder);

      const stored = factoryState.cesmiiWorkOrders[0];
      expect(stored.enterprise).toBe('malformed');
      expect(stored.site).toBe('unknown');
    });
  });
});
