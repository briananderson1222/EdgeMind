// lib/cmms-interface.js - Generic CMMS Provider Interface
// This abstract base class defines the contract that all CMMS integrations must implement.

/**
 * Base CMMS provider interface that all implementations must extend.
 * Provides a pluggable architecture for integrating with different
 * Computerized Maintenance Management Systems (CMMS).
 *
 * @abstract
 */
class CMmsProvider {
  /**
   * Creates a new CMMS provider instance.
   * @param {Object} config - Provider-specific configuration
   */
  constructor(config) {
    if (this.constructor === CMmsProvider) {
      throw new Error('CMmsProvider is abstract and cannot be instantiated directly');
    }
    this.config = config || {};
    this.enabled = config.enabled ?? false;
  }

  /**
   * Creates a maintenance work order in the CMMS system.
   *
   * @param {Object} anomaly - Anomaly data from Claude analysis
   * @param {string} anomaly.summary - Brief description of the issue
   * @param {string} anomaly.severity - Severity level: 'low' | 'medium' | 'high'
   * @param {string[]} anomaly.anomalies - List of specific concerns
   * @param {string[]} anomaly.recommendations - Suggested actions
   * @param {number} anomaly.confidence - Claude's confidence (0-1)
   * @param {string} anomaly.timestamp - ISO timestamp
   *
   * @param {Object} equipment - Equipment context data
   * @param {string} equipment.enterprise - Enterprise name
   * @param {string} equipment.site - Site name
   * @param {string} equipment.machine - Machine identifier
   * @param {string} equipment.stateName - Current state (RUNNING/IDLE/DOWN)
   * @param {string} equipment.area - Area/line identifier
   *
   * @returns {Promise<Object>} Work order result
   * @returns {string} result.workOrderId - CMMS work order ID
   * @returns {string} result.workOrderNumber - Human-readable work order number
   * @returns {string} result.status - Work order status
   * @returns {string} result.url - Direct URL to work order (if available)
   *
   * @abstract
   * @throws {Error} If not implemented by subclass
   */
  async createWorkOrder(_anomaly, _equipment) {
    throw new Error('createWorkOrder() must be implemented by subclass');
  }

  /**
   * Retrieves the current status of a work order.
   *
   * @param {string} workOrderId - The CMMS work order ID
   * @returns {Promise<Object>} Work order status
   * @returns {string} result.id - Work order ID
   * @returns {string} result.status - Current status
   * @returns {string} result.assignedTo - Assigned technician (if any)
   * @returns {string} result.updatedAt - Last update timestamp
   *
   * @abstract
   * @throws {Error} If not implemented by subclass
   */
  async getWorkOrderStatus(_workOrderId) {
    throw new Error('getWorkOrderStatus() must be implemented by subclass');
  }

  /**
   * Lists recent work orders created by this integration.
   *
   * @param {number} limit - Maximum number of work orders to return
   * @returns {Promise<Array<Object>>} Array of work order summaries
   * @returns {string} result[].id - Work order ID
   * @returns {string} result[].number - Work order number
   * @returns {string} result[].title - Work order title
   * @returns {string} result[].status - Current status
   * @returns {string} result[].createdAt - Creation timestamp
   *
   * @abstract
   * @throws {Error} If not implemented by subclass
   */
  async listRecentWorkOrders(_limit = 10) {
    throw new Error('listRecentWorkOrders() must be implemented by subclass');
  }

  /**
   * Tests connectivity and authentication with the CMMS system.
   *
   * @returns {Promise<Object>} Health check result
   * @returns {boolean} result.healthy - True if connection is working
   * @returns {string} result.message - Status message
   *
   * @abstract
   * @throws {Error} If not implemented by subclass
   */
  async healthCheck() {
    throw new Error('healthCheck() must be implemented by subclass');
  }

  /**
   * Returns whether this provider is enabled and configured.
   * @returns {boolean} True if enabled
   */
  isEnabled() {
    return this.enabled === true;
  }

  /**
   * Returns the provider name for logging and identification.
   * @returns {string} Provider name
   */
  getProviderName() {
    return this.constructor.name;
  }
}

/**
 * Factory function to create CMMS provider instances.
 * Add new providers to the registry as they are implemented.
 *
 * @param {string} providerName - Name of the provider to instantiate
 * @param {Object} config - Provider configuration
 * @returns {CMmsProvider} Configured provider instance
 * @throws {Error} If provider is unknown
 */
function createCmmsProvider(providerName, config) {
  const providers = {
    'maintainx': () => {
      const MaintainXProvider = require('./cmms-maintainx');
      return new MaintainXProvider(config);
    },
    // Add future providers here:
    // 'fiix': () => require('./cmms-fiix'),
    // 'mpulse': () => require('./cmms-mpulse'),
    // 'limble': () => require('./cmms-limble'),
  };

  const providerLower = providerName.toLowerCase();
  const factory = providers[providerLower];

  if (!factory) {
    throw new Error(`Unknown CMMS provider: ${providerName}. Available: ${Object.keys(providers).join(', ')}`);
  }

  return factory();
}

module.exports = {
  CMmsProvider,
  createCmmsProvider
};
