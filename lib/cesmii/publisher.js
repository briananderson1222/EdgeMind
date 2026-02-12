// lib/cesmii/publisher.js - CESMII SM Profile Publisher
'use strict';

const { randomUUID } = require('crypto');
const CONFIG = require('../config');
const { factoryState } = require('../state');

let mqttClient = null;

function init({ mqttClient: client }) {
  mqttClient = client;
  console.log('[CESMII Publisher] Initialized');
}

function wrapAsJsonLd(data, profileType, profileUrl) {
  return {
    ...data,
    '@context': {
      '@vocab': 'https://cesmii.org/smprofile/',
      'profile': 'https://cesmii.org/smprofile/profile',
      'opc': 'http://opcfoundation.org/UA/'
    },
    '@type': profileType,
    'profileDefinition': profileUrl
  };
}

function publish(payload, topic, label) {
  if (!mqttClient || !mqttClient.connected) {
    console.warn('[CESMII Publisher] Cannot publish - MQTT not connected');
    return false;
  }
  try {
    mqttClient.publish(topic, JSON.stringify(payload));
    factoryState.cesmiiStats.profilesPublished++;
    factoryState.cesmiiStats.lastPublishAt = new Date().toISOString();
    console.log(`[CESMII Publisher] ${label} → ${topic}`);
    return true;
  } catch (err) {
    console.error(`[CESMII Publisher] ${label} publish error:`, err.message);
    return false;
  }
}

const PROFILE_BASE = 'https://github.com/Concept-Reply-US/EdgeMind/blob/main/lib/cesmii/profiles';

function publishOEEReport(oeeData, enterprise, site) {
  const payload = wrapAsJsonLd({
    ReportId: randomUUID(),
    Enterprise: enterprise,
    Site: site || 'ALL',
    OEE: parseFloat(oeeData.oee) || 0,
    Availability: parseFloat(oeeData.availability) || 0,
    Performance: parseFloat(oeeData.performance) || 0,
    Quality: parseFloat(oeeData.quality) || 0,
    CalculationTier: oeeData.tier || 'unknown',
    Confidence: typeof oeeData.confidence === 'number' ? oeeData.confidence : 0.5,
    CalculatedAt: new Date().toISOString()
  }, 'OEEReportV1', `${PROFILE_BASE}/OEEReportV1.jsonld`);

  return publish(payload, `${CONFIG.cesmii.publishTopicPrefix}/oee/${enterprise}/${site || 'ALL'}`, 'OEEReportV1');
}

function publishFactoryInsight(insight, enterprise) {
  const summary = insight.summary || insight.text || insight.analysis || 'EdgeMind AI insight';
  const payload = wrapAsJsonLd({
    InsightId: randomUUID(),
    Enterprise: enterprise || 'ALL',
    Summary: String(summary).substring(0, 2000),
    Severity: insight.severity || 'info',
    Category: insight.category || insight.type || 'trend',
    GeneratedAt: new Date().toISOString(),
    Confidence: typeof insight.confidence === 'number' ? insight.confidence : 0.7
  }, 'FactoryInsightV1', `${PROFILE_BASE}/FactoryInsightV1.jsonld`);

  return publish(payload, `${CONFIG.cesmii.publishTopicPrefix}/insights/${enterprise || 'ALL'}`, 'FactoryInsightV1');
}

module.exports = { init, publishOEEReport, publishFactoryInsight, wrapAsJsonLd };
