/**
 * @module lib/validation
 * @description Validation and utility functions for input sanitization and formatting.
 * This module provides security-focused validation for user inputs, particularly
 * for InfluxDB identifiers, as well as utility functions for data formatting.
 */

/**
 * Valid enterprise names for API input validation.
 * SECURITY: Whitelist approach prevents injection attacks.
 * @constant {string[]}
 */
const VALID_ENTERPRISES = ['ALL', 'Enterprise A', 'Enterprise B', 'Enterprise C'];

/**
 * Valid WebSocket message types (client to server).
 * SECURITY: Whitelist approach prevents processing of unknown message types.
 * @constant {string[]}
 */
const VALID_WS_MESSAGE_TYPES = ['get_stats', 'update_anomaly_filter'];

/**
 * Maximum length for user-provided strings.
 * SECURITY: Prevents DoS via oversized inputs.
 * @constant {number}
 */
const MAX_INPUT_LENGTH = 1000;

/**
 * Sanitizes InfluxDB identifiers to prevent Flux query injection.
 * Removes potentially dangerous characters like quotes and backslashes.
 * @param {string} identifier - The identifier to sanitize
 * @returns {string} Sanitized identifier
 */
function sanitizeInfluxIdentifier(identifier) {
  if (typeof identifier !== 'string') return '';
  return identifier.replace(/["\\]/g, '');
}

/**
 * Formats a duration in milliseconds into a human-readable string.
 * @param {number} durationMs - Duration in milliseconds
 * @returns {string} Formatted duration (e.g., "2h 15m", "45s")
 */
function formatDuration(durationMs) {
  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Validates and sanitizes enterprise parameter.
 * @param {string} enterprise - The enterprise parameter from request
 * @returns {string|null} Validated enterprise or null if invalid
 */
function validateEnterprise(enterprise) {
  if (!enterprise || typeof enterprise !== 'string') return 'ALL';
  if (enterprise.length > MAX_INPUT_LENGTH) return null;

  // Check against whitelist
  if (VALID_ENTERPRISES.includes(enterprise)) {
    return enterprise;
  }

  // For dynamic enterprises discovered at runtime, sanitize the input
  const sanitized = sanitizeInfluxIdentifier(enterprise);
  if (sanitized.length > 0 && sanitized.length <= 100) {
    return sanitized;
  }

  return null;
}

/**
 * Validates and sanitizes site parameter.
 * @param {string} site - The site parameter from request
 * @returns {string|null} Validated site or null
 */
function validateSite(site) {
  if (!site || typeof site !== 'string') return null;
  if (site.length > MAX_INPUT_LENGTH) return null;

  const sanitized = sanitizeInfluxIdentifier(site);
  if (sanitized.length > 0 && sanitized.length <= 100) {
    return sanitized;
  }

  return null;
}

/**
 * Extracts the measurement name from an MQTT topic.
 * Uses the same logic as parseTopicToInflux to ensure consistency.
 * @param {string} topic - The MQTT topic
 * @returns {string|null} The measurement name or null if unable to extract
 */
function extractMeasurementFromTopic(topic) {
  const parts = topic.split('/');
  if (parts.length >= 2) {
    return parts.slice(-2).join('_').replace(/[^a-zA-Z0-9_]/g, '_');
  }
  return null;
}

module.exports = {
  // Constants
  VALID_ENTERPRISES,
  VALID_WS_MESSAGE_TYPES,
  MAX_INPUT_LENGTH,

  // Functions
  sanitizeInfluxIdentifier,
  formatDuration,
  validateEnterprise,
  validateSite,
  extractMeasurementFromTopic
};
