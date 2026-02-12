// lib/cesmii/demo-publisher.js - Demo CESMII Work Order Publisher
'use strict';

const CONFIG = require('../config');
const { wrapAsJsonLd } = require('./publisher');

let mqttClient = null;
let publishInterval = null;
let orderCounter = 0;

const PRODUCTS = [
  { name: 'Premium Widget A', uom: 'units', qtyRange: [500, 2000] },
  { name: 'Industrial Gear B', uom: 'pieces', qtyRange: [100, 500] },
  { name: 'Sensor Module C', uom: 'units', qtyRange: [200, 1000] },
  { name: 'Hydraulic Valve D', uom: 'pieces', qtyRange: [50, 200] },
  { name: 'Circuit Board E', uom: 'units', qtyRange: [1000, 5000] }
];

const INGREDIENTS = [
  { name: 'Aluminum Alloy 6061', uom: 'kg', qtyRange: [10, 100] },
  { name: 'Stainless Steel 304', uom: 'kg', qtyRange: [5, 50] },
  { name: 'Copper Wire', uom: 'meters', qtyRange: [50, 500] },
  { name: 'Polycarbonate Resin', uom: 'kg', qtyRange: [2, 20] },
  { name: 'Silicone Sealant', uom: 'liters', qtyRange: [1, 10] },
  { name: 'Epoxy Adhesive', uom: 'liters', qtyRange: [0.5, 5] },
  { name: 'Ceramic Substrate', uom: 'units', qtyRange: [100, 1000] },
  { name: 'Rubber Gasket', uom: 'units', qtyRange: [50, 200] }
];

const STATUSES = ['New', 'InProgress', 'InProgress', 'InProgress'];

const PROFILE_BASE = 'https://github.com/Concept-Reply-US/EdgeMind/blob/main/lib/cesmii/profiles';

function generateWorkOrder() {
  orderCounter++;
  const product = PRODUCTS[Math.floor(Math.random() * PRODUCTS.length)];
  const numIngredients = 2 + Math.floor(Math.random() * 4);

  const ingredients = [];
  const usedNames = new Set();
  let totalPercent = 0;

  for (let i = 0; i < numIngredients; i++) {
    let ing;
    do {
      ing = INGREDIENTS[Math.floor(Math.random() * INGREDIENTS.length)];
    } while (usedNames.has(ing.name));
    usedNames.add(ing.name);

    const pct = i === numIngredients - 1
      ? Math.round((100 - totalPercent) * 100) / 100
      : Math.round((Math.random() * (60 / numIngredients)) * 100) / 100;
    totalPercent += pct;

    const [min, max] = ing.qtyRange;
    const qty = Math.round((Math.random() * (max - min) + min) * 100) / 100;

    ingredients.push({
      IngredientName: ing.name,
      Quantity: qty,
      UnitOfMeasure: ing.uom,
      LotNumber: `LOT-${Date.now().toString(36).toUpperCase()}-${i}`,
      PercentOfTotal: pct
    });
  }

  const now = new Date();
  const endTime = new Date(now.getTime() + (4 + Math.random() * 8) * 3600000);
  const [pMin, pMax] = product.qtyRange;

  const data = {
    WorkOrderId: `WO-${now.getFullYear()}-${String(orderCounter).padStart(4, '0')}`,
    ProductName: product.name,
    Quantity: Math.round((Math.random() * (pMax - pMin) + pMin) * 100) / 100,
    UnitOfMeasure: product.uom,
    Status: STATUSES[Math.floor(Math.random() * STATUSES.length)],
    Priority: 1 + Math.floor(Math.random() * 5),
    StartTime: now.toISOString(),
    EndTime: endTime.toISOString(),
    Ingredients: ingredients
  };

  return wrapAsJsonLd(data, 'WorkOrderV1', `${PROFILE_BASE}/WorkOrderV1.jsonld`);
}

function startDemoWorkOrders(client, intervalMs = 10000) {
  if (publishInterval) {
    throw new Error('Demo work order publisher already running');
  }

  mqttClient = client;

  // Publish immediately, then at interval
  publishOne();
  publishInterval = setInterval(publishOne, intervalMs);

  console.log(`[CESMII Demo] Started publishing work orders every ${intervalMs / 1000}s`);
  return { status: 'started', intervalMs };
}

function publishOne() {
  if (!mqttClient || !mqttClient.connected) {
    console.warn('[CESMII Demo] MQTT not connected');
    return;
  }

  const workOrder = generateWorkOrder();
  const topic = `Enterprise B/${CONFIG.demo.namespace}/cesmii/WorkOrder`;

  try {
    mqttClient.publish(topic, JSON.stringify(workOrder));
    console.log(`[CESMII Demo] Published ${workOrder.WorkOrderId} → ${topic}`);
  } catch (err) {
    console.error('[CESMII Demo] Publish error:', err.message);
  }
}

function stopDemoWorkOrders() {
  if (publishInterval) {
    clearInterval(publishInterval);
    publishInterval = null;
    console.log('[CESMII Demo] Stopped publishing work orders');
    return { status: 'stopped' };
  }
  return { status: 'not_running' };
}

function getStatus() {
  return {
    running: publishInterval !== null,
    orderCount: orderCounter
  };
}

module.exports = { startDemoWorkOrders, stopDemoWorkOrders, getStatus };
