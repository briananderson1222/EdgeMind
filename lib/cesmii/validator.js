// lib/cesmii/validator.js - CESMII SM Profile Validator
'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Loaded profiles cache.
 * Maps profile type name (e.g., 'WorkOrderV1') to parsed profile definition.
 * @type {Map<string, Object>}
 */
const loadedProfiles = new Map();

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function intRange(min, max) {
  return (v) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isDateTime = (v) =>
  (typeof v === 'number' && Number.isFinite(v)) ||
  (typeof v === 'string' && !isNaN(new Date(v).getTime()));

const OPC_UA_VALIDATORS = {
  Boolean: (v) => typeof v === 'boolean' || v === 1 || v === 0,
  Int16:   intRange(-32768, 32767),
  Int32:   intRange(-2147483648, 2147483647),
  Int64:   intRange(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
  UInt16:  intRange(0, 65535),
  UInt32:  intRange(0, 4294967295),
  UInt64:  intRange(0, Number.MAX_SAFE_INTEGER),
  Float:   isFiniteNum,
  Double:  isFiniteNum,
  String:  (v) => typeof v === 'string',
  DateTime: isDateTime,
  UtcTime:  isDateTime,
  Guid:    (v) => typeof v === 'string' && GUID_RE.test(v),
};

function validateOpcUaType(value, opcUaType) {
  // Strip 'opc:' prefix if present
  const typeName = opcUaType.replace(/^opc:/, '');

  // Handle array types (e.g., 'FeedIngredientV1[]')
  if (typeName.endsWith('[]')) {
    // For arrays, we just check that value is an array
    // Nested profile validation happens in validatePayload
    return Array.isArray(value);
  }

  // Check if it's a known OPC UA type
  const validator = OPC_UA_VALIDATORS[typeName];
  if (validator) {
    return validator(value);
  }

  // Unknown type - assume it's a nested profile type
  // Nested profile validation happens in validatePayload
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function loadProfile(profilePath) {
  try {
    const content = fs.readFileSync(profilePath, 'utf8');
    const profile = JSON.parse(content);

    // Validate profile structure
    if (!profile['@type']) {
      console.error(`Profile missing @type: ${profilePath}`);
      return null;
    }

    if (!profile.profile || !profile.profile.attributes || !Array.isArray(profile.profile.attributes)) {
      console.error(`Profile missing profile.attributes array: ${profilePath}`);
      return null;
    }

    // Cache the loaded profile
    const typeName = profile['@type'];
    loadedProfiles.set(typeName, profile);

    return profile;
  } catch (err) {
    console.error(`Failed to load profile ${profilePath}:`, err.message);
    return null;
  }
}

function getProfileForType(typeName) {
  return loadedProfiles.get(typeName) || null;
}

/**
 * Validate a payload against a loaded profile.
 *
 * @param {Object} payload - Parsed CESMII payload to validate
 * @param {Object} profile - Loaded profile definition
 * @param {number} _depth - Internal recursion depth counter
 * @returns {Object} Validation result { valid: boolean, errors: string[], warnings: string[] }
 */
function validatePayload(payload, profile, _depth = 0) {
  const result = {
    valid: true,
    errors: [],
    warnings: []
  };

  // Defensive check
  if (!payload || typeof payload !== 'object') {
    result.valid = false;
    result.errors.push('Payload is not an object');
    return result;
  }

  if (!profile || !profile.profile || !profile.profile.attributes) {
    result.valid = false;
    result.errors.push('Invalid profile definition');
    return result;
  }

  // Guard against recursive/circular profiles
  if (_depth > 10) {
    result.valid = false;
    result.errors.push('Maximum nesting depth exceeded');
    return result;
  }

  const attributes = profile.profile.attributes;

  // Validate each attribute
  for (const attr of attributes) {
    const { attributeName, dataType, description } = attr;

    // Check if attribute exists in payload
    if (!(attributeName in payload)) {
      result.valid = false;
      result.errors.push(`Missing required field: ${attributeName}`);
      continue;
    }

    const value = payload[attributeName];

    // Strip 'opc:' prefix for type checking
    const typeName = dataType.replace(/^opc:/, '');

    // Handle array of nested profiles (e.g., 'FeedIngredientV1[]')
    if (typeName.endsWith('[]')) {
      const nestedTypeName = typeName.slice(0, -2); // Remove '[]'

      if (!Array.isArray(value)) {
        result.valid = false;
        result.errors.push(`Field ${attributeName} must be an array`);
        continue;
      }

      // Validate each array element
      const nestedProfile = getProfileForType(nestedTypeName);
      if (!nestedProfile) {
        result.warnings.push(`Nested profile ${nestedTypeName} not loaded, skipping validation`);
        continue;
      }

      for (let i = 0; i < value.length; i++) {
        const nestedResult = validatePayload(value[i], nestedProfile, _depth + 1);
        if (!nestedResult.valid) {
          result.valid = false;
          nestedResult.errors.forEach(err => {
            result.errors.push(`${attributeName}[${i}]: ${err}`);
          });
        }
        nestedResult.warnings.forEach(warn => {
          result.warnings.push(`${attributeName}[${i}]: ${warn}`);
        });
      }

      continue;
    }

    // Handle nested profile (non-array)
    if (!OPC_UA_VALIDATORS[typeName]) {
      // Unknown type - assume it's a nested profile
      const nestedProfile = getProfileForType(typeName);
      if (!nestedProfile) {
        result.warnings.push(`Nested profile ${typeName} not loaded, skipping validation for ${attributeName}`);
        continue;
      }

      const nestedResult = validatePayload(value, nestedProfile, _depth + 1);
      if (!nestedResult.valid) {
        result.valid = false;
        nestedResult.errors.forEach(err => {
          result.errors.push(`${attributeName}: ${err}`);
        });
      }
      nestedResult.warnings.forEach(warn => {
        result.warnings.push(`${attributeName}: ${warn}`);
      });

      continue;
    }

    // Validate OPC UA type
    if (!validateOpcUaType(value, dataType)) {
      result.valid = false;
      result.errors.push(`Field ${attributeName} has invalid type. Expected ${dataType}, got ${typeof value}`);
    }
  }

  return result;
}

function loadAllProfiles(profilesDir) {
  let loadedCount = 0;

  try {
    const files = fs.readdirSync(profilesDir);

    for (const file of files) {
      if (file.endsWith('.jsonld')) {
        const profilePath = path.join(profilesDir, file);
        const profile = loadProfile(profilePath);
        if (profile) {
          loadedCount++;
        }
      }
    }
  } catch (err) {
    console.error(`Failed to read profiles directory ${profilesDir}:`, err.message);
  }

  return loadedCount;
}

function getLoadedProfileTypes() {
  return Array.from(loadedProfiles.entries()).map(([typeName, profile]) => ({
    typeName,
    profile
  }));
}

function clearProfileCache() {
  loadedProfiles.clear();
}

module.exports = {
  loadProfile,
  loadAllProfiles,
  getProfileForType,
  getLoadedProfileTypes,
  validatePayload,
  validateOpcUaType,
  clearProfileCache
};
