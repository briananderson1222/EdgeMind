// lib/cesmii/detector.js - CESMII SM Profile Payload Detector
'use strict';

function parsePayload(payload) {
  if (Buffer.isBuffer(payload)) return JSON.parse(payload.toString('utf8'));
  if (typeof payload === 'string') return JSON.parse(payload);
  return payload;
}

function isCesmiiPayload(payload) {
  try {
    const parsed = parsePayload(payload);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;
    if (!parsed['@type'] || typeof parsed['@type'] !== 'string') return false;
    const hasContext = parsed['@context'] !== undefined && parsed['@context'] !== null;
    const hasProfileDef = typeof parsed.profileDefinition === 'string';
    return hasContext || hasProfileDef;
  } catch {
    return false;
  }
}

function extractProfileType(payload) {
  try {
    const parsed = parsePayload(payload);
    if (typeof parsed !== 'object' || parsed === null || !parsed['@type']) return null;
    const typeValue = parsed['@type'];
    if (typeValue.includes('/')) return typeValue.split('/').pop();
    if (typeValue.includes(':')) return typeValue.split(':').pop();
    return typeValue;
  } catch {
    return null;
  }
}

module.exports = { isCesmiiPayload, extractProfileType };
