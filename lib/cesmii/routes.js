// lib/cesmii/routes.js - CESMII REST API Routes
'use strict';

const express = require('express');
const router = express.Router();
const CONFIG = require('../config');
const { factoryState } = require('../state');
const { validateEnterprise, validateSite } = require('../validation');
const { sanitizeWorkOrderForBroadcast } = require('./handler');

// CRITICAL: Add body parser middleware for POST requests
router.use(express.json());

router.get('/work-orders', (req, res) => {
  try {
    let workOrders = [...factoryState.cesmiiWorkOrders];

    // Filter by enterprise if specified
    const enterprise = req.query.enterprise;
    if (enterprise) {
      const validated = validateEnterprise(enterprise);
      if (validated && validated !== 'ALL') {
        workOrders = workOrders.filter(wo => wo.enterprise === validated);
      }
    }

    // Limit results (clamp to prevent negative values)
    const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 50, 100));

    // Return newest first
    workOrders.reverse();
    workOrders = workOrders.slice(0, limit);

    // Sanitize all work orders before returning
    const sanitizedWorkOrders = workOrders.map(sanitizeWorkOrderForBroadcast);

    res.json({
      workOrders: sanitizedWorkOrders,
      total: factoryState.cesmiiWorkOrders.length,
      limit
    });
  } catch (error) {
    console.error('[CESMII] Route error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/profiles', (req, res) => {
  try {
    const { getLoadedProfileTypes } = require('./validator');
    const loadedTypes = getLoadedProfileTypes();

    const profiles = loadedTypes.map(({ typeName, profile }) => ({
      type: typeName,
      name: profile.profile?.name || typeName,
      version: profile.profile?.version || '1.0.0',
      description: profile.profile?.description || '',
      attributeCount: profile.profile?.attributes?.length || 0,
      profileDefinition: profile.profileDefinition || null
    }));

    res.json({ profiles });
  } catch (error) {
    console.error('[CESMII] Route error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/stats', (req, res) => {
  res.json(factoryState.cesmiiStats);
});

let publisher = null;
let demoPublisher = null;
let mqttClientRef = null;

function setPublisher(pub) {
  publisher = pub;
}

function setDemoPublisher(demoPub, client) {
  demoPublisher = demoPub;
  mqttClientRef = client;
}

router.post('/publish/oee', (req, res) => {
  if (!publisher) {
    return res.status(503).json({ error: 'Publisher not initialized' });
  }

  const { enterprise, site, oeeData } = req.body || {};
  if (!enterprise || !oeeData) {
    return res.status(400).json({ error: 'enterprise and oeeData are required' });
  }

  const validatedEnterprise = validateEnterprise(enterprise);
  if (!validatedEnterprise) {
    return res.status(400).json({ error: 'Invalid enterprise' });
  }

  const validatedSite = site ? validateSite(site) : null;
  const success = publisher.publishOEEReport(oeeData, validatedEnterprise, validatedSite);
  res.json({ published: success, profileType: 'OEEReportV1' });
});

router.post('/publish/insight', (req, res) => {
  if (!publisher) {
    return res.status(503).json({ error: 'Publisher not initialized' });
  }

  const { enterprise, insight } = req.body || {};
  if (!insight) {
    return res.status(400).json({ error: 'insight is required' });
  }

  const validatedEnterprise = enterprise ? validateEnterprise(enterprise) : 'ALL';
  const success = publisher.publishFactoryInsight(insight, validatedEnterprise || 'ALL');
  res.json({ published: success, profileType: 'FactoryInsightV1' });
});

router.post('/demo/start', (req, res) => {
  if (!demoPublisher || !mqttClientRef) {
    return res.status(503).json({ error: 'Demo publisher not available' });
  }

  try {
    const result = demoPublisher.startDemoWorkOrders(mqttClientRef);
    res.json(result);
  } catch (error) {
    res.status(409).json({ error: error.message });
  }
});

router.post('/demo/stop', (req, res) => {
  if (!demoPublisher) {
    return res.status(503).json({ error: 'Demo publisher not available' });
  }

  const result = demoPublisher.stopDemoWorkOrders();
  res.json(result);
});

router.get('/demo/status', (req, res) => {
  if (!demoPublisher) {
    return res.json({ running: false, orderCount: 0 });
  }

  res.json(demoPublisher.getStatus());
});

module.exports = { router, setPublisher, setDemoPublisher };
