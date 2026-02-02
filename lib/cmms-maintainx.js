// lib/cmms-maintainx.js - MaintainX CMMS Provider Implementation
// Integrates with MaintainX REST API for automated work order creation

const { CMmsProvider } = require('./cmms-interface');
const https = require('https');

/**
 * MaintainX CMMS Provider
 * Implements the CMmsProvider interface for MaintainX.com
 *
 * Configuration:
 * - apiKey: MaintainX API key (required)
 * - baseUrl: MaintainX API base URL (default: https://api.getmaintainx.com/v1)
 * - enabled: Enable/disable integration
 * - defaultPriority: Default work order priority (LOW/MEDIUM/HIGH/URGENT)
 * - retryAttempts: Number of retry attempts on failure (default: 3)
 * - retryDelayMs: Delay between retries in milliseconds (default: 1000)
 *
 * @extends CMmsProvider
 */
class MaintainXProvider extends CMmsProvider {
  constructor(config) {
    super(config);

    this.apiKey = config.apiKey || process.env.MAINTAINX_API_KEY;
    this.baseUrl = config.baseUrl || process.env.MAINTAINX_BASE_URL || 'https://api.getmaintainx.com/v1';
    this.defaultPriority = config.defaultPriority || 'MEDIUM';
    this.retryAttempts = config.retryAttempts ?? 3;
    this.retryDelayMs = config.retryDelayMs ?? 1000;
    this.defaultLocationId = config.defaultLocationId || process.env.MAINTAINX_DEFAULT_LOCATION_ID;
    this.defaultAssigneeId = config.defaultAssigneeId || process.env.MAINTAINX_DEFAULT_ASSIGNEE_ID;

    // Validate configuration
    if (!this.apiKey && this.enabled) {
      console.warn('[MaintainX] API key not configured. Integration disabled.');
      this.enabled = false;
    }
  }

  /**
   * Makes an HTTP request to MaintainX API with retry logic.
   *
   * @param {string} method - HTTP method
   * @param {string} path - API path (relative to baseUrl)
   * @param {Object} body - Request body (optional)
   * @param {number} attempt - Current retry attempt (internal)
   * @returns {Promise<Object>} API response
   * @throws {Error} If request fails after all retries
   * @private
   */
  async _makeRequest(method, path, body = null, attempt = 1) {
    // Ensure proper URL join: new URL('/path', 'host/v1') drops /v1, so normalize
    const base = this.baseUrl.endsWith('/') ? this.baseUrl : this.baseUrl + '/';
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    const url = new URL(cleanPath, base);

    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'EdgeMind-OPE-Insights/1.0'
      }
    };

    return new Promise((resolve, reject) => {
      const req = https.request(url, options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          // Handle successful responses (2xx)
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const parsed = data ? JSON.parse(data) : {};
              resolve(parsed);
            } catch (parseError) {
              reject(new Error(`Failed to parse MaintainX response: ${parseError.message}`));
            }
            return;
          }

          // Handle client/server errors with retry logic
          const error = new Error(`MaintainX API error: ${res.statusCode} ${res.statusMessage}`);
          error.statusCode = res.statusCode;
          error.response = data;

          // Retry on 5xx errors or rate limiting (429)
          const shouldRetry = (res.statusCode >= 500 || res.statusCode === 429) && attempt < this.retryAttempts;

          if (shouldRetry) {
            console.warn(`[MaintainX] Request failed (attempt ${attempt}/${this.retryAttempts}), retrying in ${this.retryDelayMs}ms...`);
            setTimeout(() => {
              this._makeRequest(method, path, body, attempt + 1)
                .then(resolve)
                .catch(reject);
            }, this.retryDelayMs * attempt); // Exponential backoff
          } else {
            reject(error);
          }
        });
      });

      req.on('error', (error) => {
        // Network errors - retry
        if (attempt < this.retryAttempts) {
          console.warn(`[MaintainX] Network error (attempt ${attempt}/${this.retryAttempts}), retrying...`);
          setTimeout(() => {
            this._makeRequest(method, path, body, attempt + 1)
              .then(resolve)
              .catch(reject);
          }, this.retryDelayMs * attempt);
        } else {
          reject(new Error(`MaintainX network error: ${error.message}`));
        }
      });

      // Write body if present
      if (body) {
        req.write(JSON.stringify(body));
      }

      req.end();
    });
  }

  /**
   * Maps anomaly severity to MaintainX priority levels.
   *
   * @param {string} severity - Claude severity: 'low' | 'medium' | 'high'
   * @returns {string} MaintainX priority: 'LOW' | 'MEDIUM' | 'HIGH'
   * @private
   */
  _mapSeverityToPriority(severity) {
    const severityMap = {
      'low': 'LOW',
      'medium': 'MEDIUM',
      'high': 'HIGH'
    };
    return severityMap[severity] || this.defaultPriority;
  }

  /**
   * Creates a work order in MaintainX from anomaly data.
   *
   * @param {Object} anomaly - Anomaly from Claude analysis
   * @param {Object} equipment - Equipment context
   * @returns {Promise<Object>} Work order result
   */
  async createWorkOrder(anomaly, equipment) {
    if (!this.isEnabled()) {
      throw new Error('MaintainX provider is not enabled');
    }

    try {
      // Build work order title
      const title = `${equipment.enterprise} - ${equipment.site} - ${equipment.machine}: ${anomaly.summary}`;

      // Build detailed description
      const description = this._buildWorkOrderDescription(anomaly, equipment);

      // Map severity to priority
      const priority = this._mapSeverityToPriority(anomaly.severity);

      // Build MaintainX work order payload
      // Only include fields that MaintainX API accepts: title, description, priority
      const payload = {
        title: title.substring(0, 200), // Truncate if too long
        description,
        priority
      };

      // Make API request
      const response = await this._makeRequest('POST', '/workorders', payload);

      console.log(`[MaintainX] Work order created: ${response.id || response.workOrderId} for ${equipment.enterprise}/${equipment.machine}`);

      // Return standardized result
      return {
        workOrderId: response.id || response.workOrderId || response.number,
        workOrderNumber: response.number || response.workOrderNumber || response.id,
        status: response.status || 'OPEN',
        url: response.url || `${this.baseUrl.replace('/v1', '')}/work-orders/${response.id}`,
        createdAt: response.createdAt || new Date().toISOString(),
        provider: 'MaintainX'
      };

    } catch (error) {
      console.error('[MaintainX] Failed to create work order:', error.message);
      throw new Error(`MaintainX work order creation failed: ${error.message}`);
    }
  }

  /**
   * Builds a detailed work order description from anomaly and equipment data.
   *
   * @param {Object} anomaly - Anomaly data
   * @param {Object} equipment - Equipment context
   * @returns {string} Formatted description
   * @private
   */
  _buildWorkOrderDescription(anomaly, equipment) {
    const lines = [
      `AI-Detected Anomaly - ${anomaly.severity.toUpperCase()} severity`,
      '',
      '## Summary',
      anomaly.summary,
      '',
      '## Equipment',
      `- Enterprise: ${equipment.enterprise}`,
      `- Site: ${equipment.site}`,
      `- Area/Line: ${equipment.area || 'N/A'}`,
      `- Machine: ${equipment.machine}`,
      `- Current State: ${equipment.stateName || 'Unknown'}`,
      '',
      '## Issues Detected',
      ...anomaly.anomalies.map(a => `- ${a}`),
      '',
      '## Recommended Actions',
      ...anomaly.recommendations.map(r => `- ${r}`),
      '',
      '## AI Analysis Details',
      `- Confidence: ${(anomaly.confidence * 100).toFixed(1)}%`,
      `- Detected At: ${new Date(anomaly.timestamp).toLocaleString()}`,
      `- Analysis ID: ${anomaly.id}`,
      '',
      '---',
      '_This work order was automatically created by EdgeMind OPE Insights AI monitoring system._'
    ];

    return lines.join('\n');
  }

  /**
   * Retrieves work order status from MaintainX.
   *
   * @param {string} workOrderId - MaintainX work order ID
   * @returns {Promise<Object>} Work order status
   */
  async getWorkOrderStatus(workOrderId) {
    if (!this.isEnabled()) {
      throw new Error('MaintainX provider is not enabled');
    }

    try {
      const response = await this._makeRequest('GET', `/workorders/${workOrderId}`);

      return {
        id: response.id,
        status: response.status,
        assignedTo: response.assignee?.name || null,
        updatedAt: response.updatedAt || response.lastModified,
        completedAt: response.completedAt || null
      };

    } catch (error) {
      console.error(`[MaintainX] Failed to get work order status for ${workOrderId}:`, error.message);
      throw new Error(`Failed to retrieve work order status: ${error.message}`);
    }
  }

  /**
   * Lists recent work orders created by this integration.
   *
   * @param {number} limit - Maximum number to return
   * @returns {Promise<Array<Object>>} Work order list
   */
  async listRecentWorkOrders(limit = 10) {
    if (!this.isEnabled()) {
      throw new Error('MaintainX provider is not enabled');
    }

    try {
      // MaintainX uses cursor-based pagination; only 'cursor' is documented
      const response = await this._makeRequest('GET', '/workorders');

      // Response format varies by API - adjust as needed
      const workOrders = Array.isArray(response) ? response : (response.data || response.workOrders || []);

      return workOrders.slice(0, limit).map(wo => ({
        id: wo.id,
        number: wo.number || wo.workOrderNumber,
        title: wo.title || wo.description?.substring(0, 100),
        status: wo.status,
        priority: wo.priority,
        createdAt: wo.createdAt,
        assignedTo: wo.assignee?.name || null
      }));

    } catch (error) {
      console.error('[MaintainX] Failed to list work orders:', error.message);
      throw new Error(`Failed to list work orders: ${error.message}`);
    }
  }

  /**
   * Tests connectivity to MaintainX API.
   *
   * @returns {Promise<Object>} Health check result
   */
  async healthCheck() {
    if (!this.isEnabled()) {
      return {
        healthy: false,
        message: 'MaintainX provider is disabled or not configured'
      };
    }

    try {
      // Attempt to query work orders (or use a dedicated health endpoint if available)
      await this._makeRequest('GET', '/workorders?limit=1');

      return {
        healthy: true,
        message: 'MaintainX connection OK',
        provider: 'MaintainX',
        baseUrl: this.baseUrl
      };

    } catch (error) {
      return {
        healthy: false,
        message: `MaintainX connection failed: ${error.message}`,
        provider: 'MaintainX'
      };
    }
  }
}

module.exports = MaintainXProvider;
