// lib/__tests__/cesmii-routes.test.js - CESMII Routes Tests
'use strict';

const express = require('express');
const request = require('supertest');
const { router, setPublisher, setDemoPublisher } = require('../cesmii/routes');
const { factoryState } = require('../state');
const { loadAllProfiles } = require('../cesmii/validator');
const path = require('path');

// Create Express app for testing
function createTestApp() {
  const app = express();
  app.use('/api/cesmii', router);
  return app;
}

// Mock publisher
const mockPublisher = {
  publishOEEReport: jest.fn(),
  publishFactoryInsight: jest.fn()
};

// Mock demo publisher
const mockDemoPublisher = {
  startDemoWorkOrders: jest.fn(),
  stopDemoWorkOrders: jest.fn(),
  getStatus: jest.fn()
};

// Mock MQTT client
const mockMqttClient = {};

describe('CESMII Routes', () => {
  let app;

  beforeEach(() => {
    app = createTestApp();

    // Reset factory state
    factoryState.cesmiiWorkOrders = [
      {
        id: 'wo-1',
        profileType: 'WorkOrderV1',
        enterprise: 'Enterprise A',
        site: 'Dallas Line 1',
        timestamp: '2026-02-11T10:00:00Z',
        validationStatus: 'valid',
        payload: { WorkOrderId: 'WO-001' }
      },
      {
        id: 'wo-2',
        profileType: 'WorkOrderV1',
        enterprise: 'Enterprise B',
        site: 'Site3',
        timestamp: '2026-02-11T11:00:00Z',
        validationStatus: 'valid',
        payload: { WorkOrderId: 'WO-002' }
      }
    ];

    factoryState.cesmiiStats = {
      workOrdersReceived: 10,
      workOrdersValidated: 8,
      workOrdersFailed: 2,
      profilesPublished: 5,
      lastWorkOrderAt: '2026-02-11T12:00:00Z',
      lastPublishAt: '2026-02-11T12:05:00Z'
    };

    jest.clearAllMocks();
  });

  describe('GET /work-orders', () => {
    test('returns all work orders', async () => {
      const response = await request(app).get('/api/cesmii/work-orders');

      expect(response.status).toBe(200);
      expect(response.body.workOrders).toHaveLength(2);
      expect(response.body.total).toBe(2);
      expect(response.body.limit).toBe(50);
    });

    test('filters by enterprise', async () => {
      const response = await request(app).get('/api/cesmii/work-orders?enterprise=Enterprise%20A');

      expect(response.status).toBe(200);
      expect(response.body.workOrders).toHaveLength(1);
      expect(response.body.workOrders[0].enterprise).toBe('Enterprise A');
    });

    test('respects limit parameter', async () => {
      // Add more work orders
      for (let i = 3; i <= 10; i++) {
        factoryState.cesmiiWorkOrders.push({
          id: `wo-${i}`,
          profileType: 'WorkOrderV1',
          enterprise: 'Enterprise A',
          site: 'Site1',
          timestamp: `2026-02-11T${10 + i}:00:00Z`,
          validationStatus: 'valid',
          payload: { WorkOrderId: `WO-${String(i).padStart(3, '0')}` }
        });
      }

      const response = await request(app).get('/api/cesmii/work-orders?limit=5');

      expect(response.status).toBe(200);
      expect(response.body.workOrders).toHaveLength(5);
      expect(response.body.limit).toBe(5);
    });

    test('rejects negative limit', async () => {
      const response = await request(app).get('/api/cesmii/work-orders?limit=-10');

      expect(response.status).toBe(200);
      // Limit is clamped to 1
      expect(response.body.limit).toBe(1);
      expect(response.body.workOrders).toHaveLength(1);
    });

    test('clamps limit to max 100', async () => {
      const response = await request(app).get('/api/cesmii/work-orders?limit=200');

      expect(response.status).toBe(200);
      expect(response.body.limit).toBe(100);
    });

    test('returns newest first', async () => {
      const response = await request(app).get('/api/cesmii/work-orders');

      expect(response.status).toBe(200);
      expect(response.body.workOrders[0].id).toBe('wo-2'); // Newest
      expect(response.body.workOrders[1].id).toBe('wo-1'); // Oldest
    });
  });

  describe('GET /profiles', () => {
    beforeAll(() => {
      // Load profiles before running tests
      const profilesDir = path.join(__dirname, '..', 'cesmii', 'profiles');
      loadAllProfiles(profilesDir);
    });

    test('returns loaded profiles', async () => {
      const response = await request(app).get('/api/cesmii/profiles');

      expect(response.status).toBe(200);
      expect(response.body.profiles).toBeInstanceOf(Array);
      expect(response.body.profiles.length).toBeGreaterThan(0);

      const profile = response.body.profiles[0];
      expect(profile).toHaveProperty('type');
      expect(profile).toHaveProperty('name');
      expect(profile).toHaveProperty('version');
      expect(profile).toHaveProperty('description');
      expect(profile).toHaveProperty('attributeCount');
    });
  });

  describe('GET /stats', () => {
    test('returns cesmiiStats', async () => {
      const response = await request(app).get('/api/cesmii/stats');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        workOrdersReceived: 10,
        workOrdersValidated: 8,
        workOrdersFailed: 2,
        profilesPublished: 5,
        lastWorkOrderAt: '2026-02-11T12:00:00Z',
        lastPublishAt: '2026-02-11T12:05:00Z'
      });
    });
  });

  describe('POST /publish/oee', () => {
    beforeEach(() => {
      setPublisher(mockPublisher);
      mockPublisher.publishOEEReport.mockReturnValue(true);
    });

    test('publishes OEE report', async () => {
      const oeeData = {
        availability: 0.95,
        performance: 0.90,
        quality: 0.98,
        oee: 0.838
      };

      const response = await request(app)
        .post('/api/cesmii/publish/oee')
        .send({ enterprise: 'Enterprise A', oeeData });

      expect(response.status).toBe(200);
      expect(response.body.published).toBe(true);
      expect(response.body.profileType).toBe('OEEReportV1');
      expect(mockPublisher.publishOEEReport).toHaveBeenCalledWith(oeeData, 'Enterprise A', null);
    });

    test('validates enterprise parameter', async () => {
      const oeeData = { oee: 0.85 };

      // Use a string that fails sanitization (empty after removing dangerous chars)
      const response = await request(app)
        .post('/api/cesmii/publish/oee')
        .send({ enterprise: '""\\\\', oeeData });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid enterprise');
    });

    test('requires enterprise and oeeData', async () => {
      const response = await request(app)
        .post('/api/cesmii/publish/oee')
        .send({ enterprise: 'Enterprise A' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('enterprise and oeeData are required');
    });

    test('returns 503 when publisher not initialized', async () => {
      setPublisher(null);

      const response = await request(app)
        .post('/api/cesmii/publish/oee')
        .send({ enterprise: 'Enterprise A', oeeData: {} });

      expect(response.status).toBe(503);
      expect(response.body.error).toBe('Publisher not initialized');
    });
  });

  describe('POST /publish/insight', () => {
    beforeEach(() => {
      setPublisher(mockPublisher);
      mockPublisher.publishFactoryInsight.mockReturnValue(true);
    });

    test('publishes factory insight', async () => {
      const insight = {
        category: 'performance',
        severity: 'medium',
        message: 'Machine efficiency decreased by 5%'
      };

      const response = await request(app)
        .post('/api/cesmii/publish/insight')
        .send({ enterprise: 'Enterprise A', insight });

      expect(response.status).toBe(200);
      expect(response.body.published).toBe(true);
      expect(response.body.profileType).toBe('FactoryInsightV1');
      expect(mockPublisher.publishFactoryInsight).toHaveBeenCalledWith(insight, 'Enterprise A');
    });

    test('defaults to ALL when no enterprise provided', async () => {
      const insight = { message: 'Test insight' };

      const response = await request(app)
        .post('/api/cesmii/publish/insight')
        .send({ insight });

      expect(response.status).toBe(200);
      expect(mockPublisher.publishFactoryInsight).toHaveBeenCalledWith(insight, 'ALL');
    });

    test('requires insight parameter', async () => {
      const response = await request(app)
        .post('/api/cesmii/publish/insight')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('insight is required');
    });
  });

  describe('POST /demo/start', () => {
    beforeEach(() => {
      setDemoPublisher(mockDemoPublisher, mockMqttClient);
      mockDemoPublisher.startDemoWorkOrders.mockReturnValue({ running: true, interval: 5000 });
    });

    test('starts demo work orders', async () => {
      const response = await request(app).post('/api/cesmii/demo/start');

      expect(response.status).toBe(200);
      expect(response.body.running).toBe(true);
      expect(mockDemoPublisher.startDemoWorkOrders).toHaveBeenCalledWith(mockMqttClient);
    });

    test('returns 503 when demo publisher not available', async () => {
      setDemoPublisher(null, null);

      const response = await request(app).post('/api/cesmii/demo/start');

      expect(response.status).toBe(503);
      expect(response.body.error).toBe('Demo publisher not available');
    });

    test('returns 409 when demo already running', async () => {
      mockDemoPublisher.startDemoWorkOrders.mockImplementation(() => {
        throw new Error('Demo already running');
      });

      const response = await request(app).post('/api/cesmii/demo/start');

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('Demo already running');
    });
  });

  describe('POST /demo/stop', () => {
    beforeEach(() => {
      setDemoPublisher(mockDemoPublisher, mockMqttClient);
      mockDemoPublisher.stopDemoWorkOrders.mockReturnValue({ running: false });
    });

    test('stops demo work orders', async () => {
      const response = await request(app).post('/api/cesmii/demo/stop');

      expect(response.status).toBe(200);
      expect(response.body.running).toBe(false);
      expect(mockDemoPublisher.stopDemoWorkOrders).toHaveBeenCalled();
    });

    test('returns 503 when demo publisher not available', async () => {
      setDemoPublisher(null, null);

      const response = await request(app).post('/api/cesmii/demo/stop');

      expect(response.status).toBe(503);
      expect(response.body.error).toBe('Demo publisher not available');
    });
  });

  describe('GET /demo/status', () => {
    beforeEach(() => {
      setDemoPublisher(mockDemoPublisher, mockMqttClient);
      mockDemoPublisher.getStatus.mockReturnValue({ running: true, orderCount: 5 });
    });

    test('returns demo status', async () => {
      const response = await request(app).get('/api/cesmii/demo/status');

      expect(response.status).toBe(200);
      expect(response.body.running).toBe(true);
      expect(response.body.orderCount).toBe(5);
      expect(mockDemoPublisher.getStatus).toHaveBeenCalled();
    });

    test('returns default status when demo publisher not available', async () => {
      setDemoPublisher(null, null);

      const response = await request(app).get('/api/cesmii/demo/status');

      expect(response.status).toBe(200);
      expect(response.body.running).toBe(false);
      expect(response.body.orderCount).toBe(0);
    });
  });
});
