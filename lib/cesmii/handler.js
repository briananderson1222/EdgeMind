// lib/cesmii/handler.js - CESMII SM Profile Message Handler
'use strict';

const { randomUUID } = require('crypto');
const { extractProfileType } = require('./detector');
const { validatePayload, getProfileForType, loadAllProfiles } = require('./validator');
const { factoryState } = require('../state');
const CONFIG = require('../config');
const { Point } = require('@influxdata/influxdb-client');
const { normalizeTag, ENTERPRISE_ALIASES, SITE_ALIASES } = require('../influx/writer');

// Will be set during init
let writeApi = null;
let broadcastFn = null;

// Throttle profile type warnings (only log once per type)
const warnedProfileTypes = new Set();

function init({ writeApi: wa, broadcast }) {
  writeApi = wa;
  broadcastFn = broadcast;

  // Load all SM profiles from disk
  const count = loadAllProfiles(CONFIG.cesmii.profilesDir);
  console.debug(`[CESMII] Loaded ${count} SM Profiles`);
}

function handleCesmiiMessage(topic, parsed, { isInjected = false } = {}) {
  // Extract profile type
  const profileType = extractProfileType(parsed);
  if (!profileType) {
    return false;
  }

  // Skip ignored profile types entirely (no processing, no logging, no InfluxDB write)
  if (CONFIG.cesmii.ignoredProfileTypes.includes(profileType)) {
    return false;
  }

  const timestamp = new Date().toISOString();
  factoryState.cesmiiStats.workOrdersReceived++;

  // Validate against profile schema
  const profile = getProfileForType(profileType);
  let validationResult = { valid: true, errors: [], warnings: [] };
  let validationStatus = 'unvalidated';

  if (profile) {
    validationResult = validatePayload(parsed, profile);
    validationStatus = validationResult.valid ? 'valid' : 'invalid';

    if (validationResult.valid) {
      factoryState.cesmiiStats.workOrdersValidated++;
    } else {
      factoryState.cesmiiStats.workOrdersFailed++;
      console.warn(`[CESMII] Validation failed for ${profileType}:`, validationResult.errors);

      // In strict mode, reject invalid payloads
      if (CONFIG.cesmii.validationStrict) {
        return true; // Handled but rejected
      }
    }
  } else {
    validationStatus = 'no_profile';
    // Only warn once per profile type
    if (!warnedProfileTypes.has(profileType)) {
      console.warn(`[CESMII] No profile loaded for type: ${profileType}`);
      warnedProfileTypes.add(profileType);
    }
  }

  // Extract enterprise/site from topic
  const topicParts = topic.split('/');
  const enterprise = topicParts[0] || 'unknown';
  const site = topicParts[1] || 'unknown';

  // Build work order record
  const workOrder = {
    id: `cesmii_${randomUUID()}`,
    profileType,
    topic,
    enterprise,
    site,
    timestamp,
    validationStatus,
    validationErrors: validationResult.errors,
    validationWarnings: validationResult.warnings,
    payload: parsed,
    isInjected
  };

  // Store in state (capped at maxWorkOrders)
  factoryState.cesmiiWorkOrders.push(workOrder);
  if (factoryState.cesmiiWorkOrders.length > CONFIG.cesmii.maxWorkOrders) {
    factoryState.cesmiiWorkOrders.shift();
  }
  factoryState.cesmiiStats.lastWorkOrderAt = timestamp;

  // Write to InfluxDB
  if (writeApi) {
    try {
      const point = writeCesmiiToInflux(workOrder);
      writeApi.writePoint(point);
      factoryState.stats.influxWrites++;
    } catch (err) {
      console.error(`[CESMII] InfluxDB write error:`, err.message);
    }
  }

  // Broadcast via WebSocket (sanitized - no raw payload)
  if (broadcastFn) {
    broadcastFn({
      type: 'cesmii_work_order',
      data: sanitizeWorkOrderForBroadcast(workOrder)
    });
  }

  console.debug(`[CESMII] ${profileType} from ${enterprise}/${site} [${validationStatus}]`);
  return true;
}

function sanitizeWorkOrderForBroadcast(workOrder) {
  const p = workOrder.payload || {};
  const payload = {};

  // Only include known display fields as safe primitives
  if (p.WorkOrderId) payload.WorkOrderId = String(p.WorkOrderId);
  if (p.ProductName) payload.ProductName = String(p.ProductName);
  if (typeof p.Quantity === 'number') payload.Quantity = p.Quantity;
  if (p.UnitOfMeasure) payload.UnitOfMeasure = String(p.UnitOfMeasure);
  if (p.Status) payload.Status = String(p.Status);
  if (p.Priority != null) payload.Priority = typeof p.Priority === 'number' ? p.Priority : String(p.Priority);

  // Sanitize nested ingredients array
  if (Array.isArray(p.Ingredients)) {
    payload.Ingredients = p.Ingredients.map(ing => {
      const safe = {};
      if (ing.IngredientName) safe.IngredientName = String(ing.IngredientName);
      if (typeof ing.Quantity === 'number') safe.Quantity = ing.Quantity;
      if (ing.UnitOfMeasure) safe.UnitOfMeasure = String(ing.UnitOfMeasure);
      return safe;
    });
  }

  return {
    id: workOrder.id,
    profileType: workOrder.profileType,
    topic: workOrder.topic,
    enterprise: workOrder.enterprise,
    site: workOrder.site,
    timestamp: workOrder.timestamp,
    validationStatus: workOrder.validationStatus,
    validationErrors: workOrder.validationErrors,
    validationWarnings: workOrder.validationWarnings,
    isInjected: workOrder.isInjected,
    payload
  };
}

function writeCesmiiToInflux(workOrder) {
  const point = new Point('cesmii_work_order')
    .tag('enterprise', normalizeTag(workOrder.enterprise, ENTERPRISE_ALIASES))
    .tag('site', normalizeTag(workOrder.site, SITE_ALIASES))
    .tag('profile_type', workOrder.profileType)
    .tag('validation_status', workOrder.validationStatus);

  // Add fields from payload
  const p = workOrder.payload;
  if (p.WorkOrderId) point.stringField('work_order_id', String(p.WorkOrderId));
  if (p.ProductName) point.stringField('product_name', String(p.ProductName));
  if (typeof p.Quantity === 'number') point.floatField('quantity', p.Quantity);
  if (p.Status) point.stringField('status', String(p.Status));

  // Store summary of payload (not truncated JSON string)
  const summary = {};
  if (p.WorkOrderId) summary.WorkOrderId = String(p.WorkOrderId);
  if (p.ProductName) summary.ProductName = String(p.ProductName);
  if (typeof p.Quantity === 'number') summary.Quantity = p.Quantity;
  if (p.Status) summary.Status = String(p.Status);
  point.stringField('raw_payload', JSON.stringify(summary));

  return point;
}

module.exports = { init, handleCesmiiMessage, sanitizeWorkOrderForBroadcast };
