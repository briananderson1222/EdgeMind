/**
 * @file cmms-maintainx.test.js
 * @description Tests for MaintainX CMMS provider
 */

const MaintainXProvider = require('../cmms-maintainx');
const https = require('https');

// Mock the https module
jest.mock('https');

describe('MaintainXProvider - Constructor', () => {
  beforeEach(() => {
    // Clear environment variables
    delete process.env.MAINTAINX_API_KEY;
    delete process.env.MAINTAINX_BASE_URL;
    jest.clearAllMocks();
  });

  test('creates provider with valid config (apiKey, enabled: true)', () => {
    const provider = new MaintainXProvider({
      apiKey: 'test-key-123',
      enabled: true
    });

    expect(provider.apiKey).toBe('test-key-123');
    expect(provider.enabled).toBe(true);
    expect(provider.baseUrl).toBe('https://api.getmaintainx.com/v1');
    expect(provider.defaultPriority).toBe('MEDIUM');
    expect(provider.retryAttempts).toBe(3);
    expect(provider.retryDelayMs).toBe(1000);
  });

  test('disables itself when apiKey is missing but enabled is true', () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

    const provider = new MaintainXProvider({
      enabled: true
      // No apiKey provided
    });

    expect(provider.enabled).toBe(false);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[MaintainX] API key not configured. Integration disabled.'
    );

    consoleWarnSpy.mockRestore();
  });

  test('uses defaults for baseUrl, defaultPriority, retryAttempts, retryDelayMs', () => {
    const provider = new MaintainXProvider({
      apiKey: 'test-key',
      enabled: true
    });

    expect(provider.baseUrl).toBe('https://api.getmaintainx.com/v1');
    expect(provider.defaultPriority).toBe('MEDIUM');
    expect(provider.retryAttempts).toBe(3);
    expect(provider.retryDelayMs).toBe(1000);
  });

  test('allows overriding defaults', () => {
    const provider = new MaintainXProvider({
      apiKey: 'test-key',
      enabled: true,
      baseUrl: 'https://custom.api.com/v2',
      defaultPriority: 'HIGH',
      retryAttempts: 5,
      retryDelayMs: 2000
    });

    expect(provider.baseUrl).toBe('https://custom.api.com/v2');
    expect(provider.defaultPriority).toBe('HIGH');
    expect(provider.retryAttempts).toBe(5);
    expect(provider.retryDelayMs).toBe(2000);
  });

  test('retryAttempts defaults correctly when set to 0', () => {
    const provider = new MaintainXProvider({
      apiKey: 'test-key',
      enabled: true,
      retryAttempts: 0
    });

    expect(provider.retryAttempts).toBe(0);
  });

  test('reads apiKey from environment variable', () => {
    process.env.MAINTAINX_API_KEY = 'env-key-456';

    const provider = new MaintainXProvider({
      enabled: true
    });

    expect(provider.apiKey).toBe('env-key-456');
  });

  test('config apiKey overrides environment variable', () => {
    process.env.MAINTAINX_API_KEY = 'env-key';

    const provider = new MaintainXProvider({
      apiKey: 'config-key',
      enabled: true
    });

    expect(provider.apiKey).toBe('config-key');
  });
});

describe('MaintainXProvider - _mapSeverityToPriority', () => {
  let provider;

  beforeEach(() => {
    provider = new MaintainXProvider({
      apiKey: 'test-key',
      enabled: true
    });
  });

  test('maps "low" to "LOW"', () => {
    expect(provider._mapSeverityToPriority('low')).toBe('LOW');
  });

  test('maps "medium" to "MEDIUM"', () => {
    expect(provider._mapSeverityToPriority('medium')).toBe('MEDIUM');
  });

  test('maps "high" to "HIGH"', () => {
    expect(provider._mapSeverityToPriority('high')).toBe('HIGH');
  });

  test('unknown severity falls back to defaultPriority (MEDIUM)', () => {
    expect(provider._mapSeverityToPriority('critical')).toBe('MEDIUM');
    expect(provider._mapSeverityToPriority('unknown')).toBe('MEDIUM');
    expect(provider._mapSeverityToPriority('urgent')).toBe('MEDIUM');
  });

  test('null falls back to defaultPriority', () => {
    expect(provider._mapSeverityToPriority(null)).toBe('MEDIUM');
  });

  test('undefined falls back to defaultPriority', () => {
    expect(provider._mapSeverityToPriority(undefined)).toBe('MEDIUM');
  });

  test('respects custom defaultPriority', () => {
    const customProvider = new MaintainXProvider({
      apiKey: 'test-key',
      enabled: true,
      defaultPriority: 'HIGH'
    });

    expect(customProvider._mapSeverityToPriority('unknown')).toBe('HIGH');
    expect(customProvider._mapSeverityToPriority(null)).toBe('HIGH');
  });
});

describe('MaintainXProvider - _makeRequest URL construction', () => {
  let provider;
  let mockRequest;

  beforeEach(() => {
    provider = new MaintainXProvider({
      apiKey: 'test-key',
      enabled: true,
      baseUrl: 'https://api.getmaintainx.com/v1'
    });

    // Mock https.request to capture the URL
    mockRequest = {
      write: jest.fn(),
      end: jest.fn(),
      on: jest.fn()
    };

    https.request.mockImplementation((url, options, callback) => {
      // Capture the URL for testing
      mockRequest.capturedUrl = url;

      // Simulate successful response
      setImmediate(() => {
        const mockResponse = {
          statusCode: 200,
          on: jest.fn((event, handler) => {
            if (event === 'data') {
              handler('{"success":true}');
            } else if (event === 'end') {
              handler();
            }
          })
        };
        callback(mockResponse);
      });

      return mockRequest;
    });
  });

  test('path "/workorders" with baseUrl ending in "/v1" produces correct URL', async () => {
    await provider._makeRequest('GET', '/workorders');

    const url = mockRequest.capturedUrl;
    expect(url.href).toBe('https://api.getmaintainx.com/v1/workorders');
    expect(url.pathname).toBe('/v1/workorders');
  });

  test('path "/workorders?limit=1" preserves query string', async () => {
    await provider._makeRequest('GET', '/workorders?limit=1');

    const url = mockRequest.capturedUrl;
    expect(url.href).toBe('https://api.getmaintainx.com/v1/workorders?limit=1');
    expect(url.pathname).toBe('/v1/workorders');
    expect(url.search).toBe('?limit=1');
  });

  test('path with leading slash is handled correctly', async () => {
    await provider._makeRequest('GET', '/workorders/123');

    const url = mockRequest.capturedUrl;
    expect(url.pathname).toBe('/v1/workorders/123');
  });

  test('path without leading slash is handled correctly', async () => {
    await provider._makeRequest('GET', 'workorders/123');

    const url = mockRequest.capturedUrl;
    expect(url.pathname).toBe('/v1/workorders/123');
  });

  test('baseUrl with trailing slash works correctly', async () => {
    const providerWithTrailingSlash = new MaintainXProvider({
      apiKey: 'test-key',
      enabled: true,
      baseUrl: 'https://api.getmaintainx.com/v1/'
    });

    await providerWithTrailingSlash._makeRequest('GET', '/workorders');

    const url = mockRequest.capturedUrl;
    expect(url.pathname).toBe('/v1/workorders');
  });

  test('baseUrl without trailing slash works correctly', async () => {
    const providerWithoutTrailingSlash = new MaintainXProvider({
      apiKey: 'test-key',
      enabled: true,
      baseUrl: 'https://api.getmaintainx.com/v1'
    });

    await providerWithoutTrailingSlash._makeRequest('GET', '/workorders');

    const url = mockRequest.capturedUrl;
    expect(url.pathname).toBe('/v1/workorders');
  });

  test('complex path with multiple segments', async () => {
    await provider._makeRequest('GET', '/workorders/123/comments');

    const url = mockRequest.capturedUrl;
    expect(url.pathname).toBe('/v1/workorders/123/comments');
  });
});

describe('MaintainXProvider - createWorkOrder payload', () => {
  let provider;
  let makeRequestSpy;

  beforeEach(() => {
    provider = new MaintainXProvider({
      apiKey: 'test-key',
      enabled: true
    });

    // Spy on _makeRequest to capture payload
    makeRequestSpy = jest.spyOn(provider, '_makeRequest').mockResolvedValue({
      id: 'WO-12345',
      number: 'WO-12345',
      status: 'OPEN',
      createdAt: '2026-02-02T10:00:00Z'
    });
  });

  afterEach(() => {
    makeRequestSpy.mockRestore();
  });

  test('only sends title, description, priority fields', async () => {
    const anomaly = {
      id: 'anomaly-123',
      summary: 'Temperature spike detected',
      severity: 'high',
      anomalies: ['Temperature exceeded threshold'],
      recommendations: ['Check cooling system'],
      confidence: 0.95,
      timestamp: '2026-02-02T10:00:00Z'
    };

    const equipment = {
      enterprise: 'Enterprise A',
      site: 'Dallas Line 1',
      machine: 'Packaging Unit 1',
      area: 'packaging',
      stateName: 'RUNNING'
    };

    await provider.createWorkOrder(anomaly, equipment);

    expect(makeRequestSpy).toHaveBeenCalledWith('POST', '/workorders', {
      title: expect.any(String),
      description: expect.any(String),
      priority: 'HIGH'
    });

    const payload = makeRequestSpy.mock.calls[0][2];
    expect(Object.keys(payload)).toEqual(['title', 'description', 'priority']);
    expect(payload.status).toBeUndefined();
    expect(payload.customFields).toBeUndefined();
    expect(payload.locationId).toBeUndefined();
    expect(payload.assigneeId).toBeUndefined();
  });

  test('title is truncated to 200 chars', async () => {
    const anomaly = {
      summary: 'A'.repeat(300),
      severity: 'low',
      anomalies: [],
      recommendations: [],
      confidence: 0.8,
      timestamp: '2026-02-02T10:00:00Z'
    };

    const equipment = {
      enterprise: 'Enterprise B',
      site: 'Site3',
      machine: 'Machine XYZ'
    };

    await provider.createWorkOrder(anomaly, equipment);

    const payload = makeRequestSpy.mock.calls[0][2];
    expect(payload.title.length).toBeLessThanOrEqual(200);
  });

  test('priority is correctly mapped from anomaly severity', async () => {
    const equipment = {
      enterprise: 'Enterprise A',
      site: 'Site1',
      machine: 'Machine1'
    };

    const baseAnomaly = {
      summary: 'Test',
      anomalies: [],
      recommendations: [],
      confidence: 0.9,
      timestamp: '2026-02-02T10:00:00Z'
    };

    // Test low severity
    await provider.createWorkOrder({ ...baseAnomaly, severity: 'low' }, equipment);
    expect(makeRequestSpy.mock.calls[0][2].priority).toBe('LOW');

    // Test medium severity
    await provider.createWorkOrder({ ...baseAnomaly, severity: 'medium' }, equipment);
    expect(makeRequestSpy.mock.calls[1][2].priority).toBe('MEDIUM');

    // Test high severity
    await provider.createWorkOrder({ ...baseAnomaly, severity: 'high' }, equipment);
    expect(makeRequestSpy.mock.calls[2][2].priority).toBe('HIGH');
  });

  test('throws when provider is not enabled', async () => {
    const disabledProvider = new MaintainXProvider({
      enabled: false
    });

    const anomaly = {
      summary: 'Test',
      severity: 'low',
      anomalies: [],
      recommendations: [],
      confidence: 0.8,
      timestamp: '2026-02-02T10:00:00Z'
    };

    const equipment = {
      enterprise: 'Enterprise A',
      site: 'Site1',
      machine: 'Machine1'
    };

    await expect(disabledProvider.createWorkOrder(anomaly, equipment))
      .rejects
      .toThrow('MaintainX provider is not enabled');
  });

  test('description includes all anomaly and equipment details', async () => {
    const anomaly = {
      summary: 'OEE dropped significantly',
      severity: 'high',
      anomalies: ['Availability decreased by 15%', 'Quality issues detected'],
      recommendations: ['Inspect production line', 'Review quality control'],
      confidence: 0.92,
      timestamp: '2026-02-02T10:00:00Z',
      id: 'anom-456'
    };

    const equipment = {
      enterprise: 'Enterprise B',
      site: 'Dallas Line 1',
      area: 'packaging',
      machine: 'Palletizer 1',
      stateName: 'RUNNING'
    };

    await provider.createWorkOrder(anomaly, equipment);

    const payload = makeRequestSpy.mock.calls[0][2];
    expect(payload.description).toContain('OEE dropped significantly');
    expect(payload.description).toContain('Enterprise B');
    expect(payload.description).toContain('Dallas Line 1');
    expect(payload.description).toContain('packaging');
    expect(payload.description).toContain('Palletizer 1');
    expect(payload.description).toContain('Availability decreased by 15%');
    expect(payload.description).toContain('Quality issues detected');
    expect(payload.description).toContain('Inspect production line');
    expect(payload.description).toContain('Review quality control');
    expect(payload.description).toContain('92.0%'); // confidence
  });
});

describe('MaintainXProvider - healthCheck', () => {
  let provider;
  let makeRequestSpy;

  beforeEach(() => {
    // Clear environment variables
    delete process.env.MAINTAINX_API_KEY;
    delete process.env.MAINTAINX_BASE_URL;

    provider = new MaintainXProvider({
      apiKey: 'test-key',
      enabled: true,
      baseUrl: 'https://api.getmaintainx.com/v1'
    });
  });

  afterEach(() => {
    if (makeRequestSpy) {
      makeRequestSpy.mockRestore();
    }
  });

  test('returns healthy: true when API call succeeds', async () => {
    makeRequestSpy = jest.spyOn(provider, '_makeRequest').mockResolvedValue({
      data: []
    });

    const result = await provider.healthCheck();

    expect(result.healthy).toBe(true);
    expect(result.message).toBe('MaintainX connection OK');
    expect(result.provider).toBe('MaintainX');
    expect(result.baseUrl).toBe('https://api.getmaintainx.com/v1');
    expect(makeRequestSpy).toHaveBeenCalledWith('GET', '/workorders?limit=1');
  });

  test('returns healthy: false when API call throws', async () => {
    makeRequestSpy = jest.spyOn(provider, '_makeRequest').mockRejectedValue(
      new Error('Network error')
    );

    const result = await provider.healthCheck();

    expect(result.healthy).toBe(false);
    expect(result.message).toContain('MaintainX connection failed');
    expect(result.message).toContain('Network error');
    expect(result.provider).toBe('MaintainX');
  });

  test('returns healthy: false when provider is disabled', async () => {
    const disabledProvider = new MaintainXProvider({
      enabled: false
    });

    const result = await disabledProvider.healthCheck();

    expect(result.healthy).toBe(false);
    expect(result.message).toBe('MaintainX provider is disabled or not configured');
  });

  test('returns healthy: false when provider disabled due to missing API key', async () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const noKeyProvider = new MaintainXProvider({
      enabled: true
      // No apiKey - constructor will set enabled = false and warn
    });

    // Verify the provider auto-disabled itself
    expect(noKeyProvider.enabled).toBe(false);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[MaintainX] API key not configured. Integration disabled.'
    );

    consoleWarnSpy.mockRestore();

    const result = await noKeyProvider.healthCheck();

    expect(result.healthy).toBe(false);
    expect(result.message).toBe('MaintainX provider is disabled or not configured');
  });
});

describe('MaintainXProvider - _buildWorkOrderDescription', () => {
  let provider;

  beforeEach(() => {
    provider = new MaintainXProvider({
      apiKey: 'test-key',
      enabled: true
    });
  });

  test('includes summary', () => {
    const anomaly = {
      summary: 'Critical issue detected',
      severity: 'high',
      anomalies: ['Issue 1'],
      recommendations: ['Fix 1'],
      confidence: 0.9,
      timestamp: '2026-02-02T10:00:00Z',
      id: 'anom-1'
    };

    const equipment = {
      enterprise: 'Enterprise A',
      site: 'Site1',
      machine: 'Machine1'
    };

    const description = provider._buildWorkOrderDescription(anomaly, equipment);

    expect(description).toContain('## Summary');
    expect(description).toContain('Critical issue detected');
  });

  test('includes equipment details', () => {
    const anomaly = {
      summary: 'Test',
      severity: 'low',
      anomalies: ['Issue'],
      recommendations: ['Fix'],
      confidence: 0.8,
      timestamp: '2026-02-02T10:00:00Z',
      id: 'anom-2'
    };

    const equipment = {
      enterprise: 'Enterprise B',
      site: 'Dallas Line 1',
      area: 'packaging',
      machine: 'Palletizer 1',
      stateName: 'RUNNING'
    };

    const description = provider._buildWorkOrderDescription(anomaly, equipment);

    expect(description).toContain('## Equipment');
    expect(description).toContain('Enterprise: Enterprise B');
    expect(description).toContain('Site: Dallas Line 1');
    expect(description).toContain('Area/Line: packaging');
    expect(description).toContain('Machine: Palletizer 1');
    expect(description).toContain('Current State: RUNNING');
  });

  test('includes anomalies list', () => {
    const anomaly = {
      summary: 'Multiple issues',
      severity: 'medium',
      anomalies: ['Temperature spike', 'Vibration detected', 'Power fluctuation'],
      recommendations: ['Fix 1'],
      confidence: 0.85,
      timestamp: '2026-02-02T10:00:00Z',
      id: 'anom-3'
    };

    const equipment = {
      enterprise: 'Enterprise A',
      site: 'Site1',
      machine: 'Machine1'
    };

    const description = provider._buildWorkOrderDescription(anomaly, equipment);

    expect(description).toContain('## Issues Detected');
    expect(description).toContain('- Temperature spike');
    expect(description).toContain('- Vibration detected');
    expect(description).toContain('- Power fluctuation');
  });

  test('includes recommendations', () => {
    const anomaly = {
      summary: 'Issue',
      severity: 'low',
      anomalies: ['Issue 1'],
      recommendations: ['Check sensors', 'Inspect bearings', 'Review logs'],
      confidence: 0.75,
      timestamp: '2026-02-02T10:00:00Z',
      id: 'anom-4'
    };

    const equipment = {
      enterprise: 'Enterprise C',
      site: 'Site2',
      machine: 'Machine2'
    };

    const description = provider._buildWorkOrderDescription(anomaly, equipment);

    expect(description).toContain('## Recommended Actions');
    expect(description).toContain('- Check sensors');
    expect(description).toContain('- Inspect bearings');
    expect(description).toContain('- Review logs');
  });

  test('formats correctly as multi-line string', () => {
    const anomaly = {
      summary: 'Test anomaly',
      severity: 'medium',
      anomalies: ['Anomaly 1'],
      recommendations: ['Recommendation 1'],
      confidence: 0.88,
      timestamp: '2026-02-02T10:00:00Z',
      id: 'anom-5'
    };

    const equipment = {
      enterprise: 'Enterprise A',
      site: 'Site1',
      machine: 'Machine1',
      stateName: 'IDLE'
    };

    const description = provider._buildWorkOrderDescription(anomaly, equipment);

    // Check it's a multi-line string
    expect(description).toContain('\n');

    // Check major sections exist
    expect(description).toContain('AI-Detected Anomaly - MEDIUM severity');
    expect(description).toContain('## Summary');
    expect(description).toContain('## Equipment');
    expect(description).toContain('## Issues Detected');
    expect(description).toContain('## Recommended Actions');
    expect(description).toContain('## AI Analysis Details');
    expect(description).toContain('Confidence: 88.0%');
    expect(description).toContain('This work order was automatically created by EdgeMind');
  });

  test('handles missing optional equipment fields', () => {
    const anomaly = {
      summary: 'Test',
      severity: 'low',
      anomalies: ['Issue'],
      recommendations: ['Fix'],
      confidence: 0.9,
      timestamp: '2026-02-02T10:00:00Z',
      id: 'anom-6'
    };

    const equipment = {
      enterprise: 'Enterprise A',
      site: 'Site1',
      machine: 'Machine1'
      // Missing area and stateName
    };

    const description = provider._buildWorkOrderDescription(anomaly, equipment);

    expect(description).toContain('Area/Line: N/A');
    expect(description).toContain('Current State: Unknown');
  });
});

describe('MaintainXProvider - getWorkOrderStatus', () => {
  let provider;
  let makeRequestSpy;

  beforeEach(() => {
    provider = new MaintainXProvider({
      apiKey: 'test-key',
      enabled: true
    });
  });

  afterEach(() => {
    if (makeRequestSpy) {
      makeRequestSpy.mockRestore();
    }
  });

  test('retrieves work order status successfully', async () => {
    makeRequestSpy = jest.spyOn(provider, '_makeRequest').mockResolvedValue({
      id: 'WO-123',
      status: 'IN_PROGRESS',
      assignee: { name: 'John Doe' },
      updatedAt: '2026-02-02T11:00:00Z'
    });

    const result = await provider.getWorkOrderStatus('WO-123');

    expect(makeRequestSpy).toHaveBeenCalledWith('GET', '/workorders/WO-123');
    expect(result.id).toBe('WO-123');
    expect(result.status).toBe('IN_PROGRESS');
    expect(result.assignedTo).toBe('John Doe');
    expect(result.updatedAt).toBe('2026-02-02T11:00:00Z');
    expect(result.completedAt).toBeNull();
  });

  test('throws when provider is not enabled', async () => {
    const disabledProvider = new MaintainXProvider({
      enabled: false
    });

    await expect(disabledProvider.getWorkOrderStatus('WO-123'))
      .rejects
      .toThrow('MaintainX provider is not enabled');
  });
});

describe('MaintainXProvider - listRecentWorkOrders', () => {
  let provider;
  let makeRequestSpy;

  beforeEach(() => {
    provider = new MaintainXProvider({
      apiKey: 'test-key',
      enabled: true
    });
  });

  afterEach(() => {
    if (makeRequestSpy) {
      makeRequestSpy.mockRestore();
    }
  });

  test('lists recent work orders successfully', async () => {
    makeRequestSpy = jest.spyOn(provider, '_makeRequest').mockResolvedValue([
      {
        id: 'WO-1',
        number: '001',
        title: 'Work Order 1',
        status: 'OPEN',
        priority: 'HIGH',
        createdAt: '2026-02-01T10:00:00Z',
        assignee: { name: 'Alice' }
      },
      {
        id: 'WO-2',
        number: '002',
        title: 'Work Order 2',
        status: 'IN_PROGRESS',
        priority: 'MEDIUM',
        createdAt: '2026-02-02T09:00:00Z',
        assignee: null
      }
    ]);

    const result = await provider.listRecentWorkOrders(10);

    expect(makeRequestSpy).toHaveBeenCalledWith('GET', '/workorders');
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('WO-1');
    expect(result[0].assignedTo).toBe('Alice');
    expect(result[1].id).toBe('WO-2');
    expect(result[1].assignedTo).toBeNull();
  });

  test('throws when provider is not enabled', async () => {
    const disabledProvider = new MaintainXProvider({
      enabled: false
    });

    await expect(disabledProvider.listRecentWorkOrders(10))
      .rejects
      .toThrow('MaintainX provider is not enabled');
  });

  test('handles API response wrapped in data property', async () => {
    makeRequestSpy = jest.spyOn(provider, '_makeRequest').mockResolvedValue({
      data: [
        { id: 'WO-1', number: '001', status: 'OPEN' }
      ]
    });

    const result = await provider.listRecentWorkOrders(10);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('WO-1');
  });

  test('respects limit parameter', async () => {
    makeRequestSpy = jest.spyOn(provider, '_makeRequest').mockResolvedValue(
      Array(20).fill(null).map((_, i) => ({
        id: `WO-${i}`,
        number: `00${i}`,
        status: 'OPEN'
      }))
    );

    const result = await provider.listRecentWorkOrders(5);

    expect(result).toHaveLength(5);
  });
});

describe('MaintainXProvider - Error Handling and Retry Logic', () => {
  let provider;
  let mockRequest;

  beforeEach(() => {
    provider = new MaintainXProvider({
      apiKey: 'test-key',
      enabled: true,
      retryAttempts: 3,
      retryDelayMs: 100
    });

    mockRequest = {
      write: jest.fn(),
      end: jest.fn(),
      on: jest.fn()
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('retries on 5xx server error', async () => {
    let attemptCount = 0;

    https.request.mockImplementation((url, options, callback) => {
      attemptCount++;

      setImmediate(() => {
        const statusCode = attemptCount < 3 ? 500 : 200;
        const mockResponse = {
          statusCode,
          statusMessage: statusCode === 500 ? 'Internal Server Error' : 'OK',
          on: jest.fn((event, handler) => {
            if (event === 'data') {
              handler(statusCode === 200 ? '{"success":true}' : '{"error":"Server error"}');
            } else if (event === 'end') {
              handler();
            }
          })
        };
        callback(mockResponse);
      });

      return mockRequest;
    });

    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

    const result = await provider._makeRequest('GET', '/workorders');

    expect(result.success).toBe(true);
    expect(attemptCount).toBe(3); // Failed twice, succeeded on 3rd attempt
    expect(consoleWarnSpy).toHaveBeenCalledTimes(2);

    consoleWarnSpy.mockRestore();
  });

  test('retries on 429 rate limit', async () => {
    let attemptCount = 0;

    https.request.mockImplementation((url, options, callback) => {
      attemptCount++;

      setImmediate(() => {
        const statusCode = attemptCount < 2 ? 429 : 200;
        const mockResponse = {
          statusCode,
          statusMessage: statusCode === 429 ? 'Too Many Requests' : 'OK',
          on: jest.fn((event, handler) => {
            if (event === 'data') {
              handler(statusCode === 200 ? '{"success":true}' : '{"error":"Rate limit"}');
            } else if (event === 'end') {
              handler();
            }
          })
        };
        callback(mockResponse);
      });

      return mockRequest;
    });

    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

    const result = await provider._makeRequest('GET', '/workorders');

    expect(result.success).toBe(true);
    expect(attemptCount).toBe(2);

    consoleWarnSpy.mockRestore();
  });

  test('does not retry on 4xx client errors (except 429)', async () => {
    https.request.mockImplementation((url, options, callback) => {
      setImmediate(() => {
        const mockResponse = {
          statusCode: 400,
          statusMessage: 'Bad Request',
          on: jest.fn((event, handler) => {
            if (event === 'data') {
              handler('{"error":"Bad request"}');
            } else if (event === 'end') {
              handler();
            }
          })
        };
        callback(mockResponse);
      });

      return mockRequest;
    });

    await expect(provider._makeRequest('GET', '/workorders'))
      .rejects
      .toThrow('MaintainX API error: 400 Bad Request');

    // Should only be called once (no retries)
    expect(https.request).toHaveBeenCalledTimes(1);
  });

  test('throws after max retry attempts', async () => {
    https.request.mockImplementation((url, options, callback) => {
      setImmediate(() => {
        const mockResponse = {
          statusCode: 500,
          statusMessage: 'Internal Server Error',
          on: jest.fn((event, handler) => {
            if (event === 'data') {
              handler('{"error":"Server error"}');
            } else if (event === 'end') {
              handler();
            }
          })
        };
        callback(mockResponse);
      });

      return mockRequest;
    });

    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

    await expect(provider._makeRequest('GET', '/workorders'))
      .rejects
      .toThrow('MaintainX API error: 500 Internal Server Error');

    // Should retry 3 times (initial + 2 retries)
    expect(https.request).toHaveBeenCalledTimes(3);

    consoleWarnSpy.mockRestore();
  });

  test('handles network errors with retry', async () => {
    let attemptCount = 0;

    https.request.mockImplementation((url, options, callback) => {
      attemptCount++;
      const req = {
        write: jest.fn(),
        end: jest.fn(),
        on: jest.fn((event, handler) => {
          if (event === 'error') {
            if (attemptCount < 3) {
              setImmediate(() => handler(new Error('Network timeout')));
            }
          }
        })
      };

      if (attemptCount === 3) {
        // Succeed on 3rd attempt
        setImmediate(() => {
          const mockResponse = {
            statusCode: 200,
            on: jest.fn((event, handler) => {
              if (event === 'data') {
                handler('{"success":true}');
              } else if (event === 'end') {
                handler();
              }
            })
          };
          callback(mockResponse);
        });
      }

      return req;
    });

    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

    const result = await provider._makeRequest('GET', '/workorders');

    expect(result.success).toBe(true);
    expect(attemptCount).toBe(3);

    consoleWarnSpy.mockRestore();
  });

  test('handles parse errors in response', async () => {
    https.request.mockImplementation((url, options, callback) => {
      setImmediate(() => {
        const mockResponse = {
          statusCode: 200,
          on: jest.fn((event, handler) => {
            if (event === 'data') {
              handler('invalid json{{{');
            } else if (event === 'end') {
              handler();
            }
          })
        };
        callback(mockResponse);
      });

      return mockRequest;
    });

    await expect(provider._makeRequest('GET', '/workorders'))
      .rejects
      .toThrow('Failed to parse MaintainX response');
  });
});
