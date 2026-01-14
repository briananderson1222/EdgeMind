/**
 * @module domain-context
 * @description Domain-specific knowledge and measurement classification for factory intelligence.
 * Provides enterprise context, equipment specifications, and automatic measurement categorization.
 */

// =============================================================================
// MEASUREMENT CLASSIFICATION
// =============================================================================

/**
 * Classification categories for measurements based on naming patterns and value characteristics.
 * Used to automatically categorize measurements for better organization and querying.
 *
 * @constant {Object.<string, string[]>}
 */
const MEASUREMENT_CLASSIFICATIONS = {
  oee_metric: ['oee', 'OEE_Performance', 'OEE_Availability', 'OEE_Quality', 'availability', 'performance', 'quality'],
  sensor_reading: ['speed', 'temperature', 'pressure', 'humidity', 'voltage', 'current', 'flow', 'level', 'weight'],
  state_status: ['state', 'status', 'running', 'stopped', 'fault', 'alarm', 'mode', 'ready'],
  counter: ['count', 'total', 'produced', 'rejected', 'scrap', 'waste', 'good'],
  timing: ['time', 'duration', 'cycle', 'downtime', 'uptime', 'runtime'],
  description: [] // Fallback for string values
};

// =============================================================================
// ENTERPRISE DOMAIN CONTEXT
// =============================================================================

/**
 * Domain-specific context for each enterprise.
 * Provides industry knowledge, equipment specifications, and safety ranges for AI-powered insights.
 *
 * @constant {Object.<string, Object>}
 */
const ENTERPRISE_DOMAIN_CONTEXT = {
  'Enterprise A': {
    industry: 'Glass Manufacturing',
    domain: 'glass',
    equipment: {
      'Furnace': { type: 'glass-furnace', normalTemp: [2650, 2750], unit: '°F' },
      'ISMachine': { type: 'forming-machine', cycleTime: [8, 12], unit: 'sec' },
      'Lehr': { type: 'annealing-oven', tempGradient: [1050, 400] }
    },
    criticalMetrics: ['temperature', 'gob_weight', 'defect_count'],
    concerns: ['thermal_shock', 'crown_temperature', 'refractory_wear'],
    safeRanges: {
      'furnace_temp': { min: 2600, max: 2800, unit: '°F', critical: true },
      'crown_temp': { min: 2400, max: 2600, unit: '°F' }
    },
    wasteMetrics: ['OEE_Waste', 'Production_DefectCHK', 'Production_DefectDIM', 'Production_DefectSED', 'Production_RejectCount'],
    wasteThresholds: { warning: 10, critical: 25, unit: 'defects/hr' }
  },
  'Enterprise B': {
    industry: 'Beverage Bottling',
    domain: 'beverage',
    equipment: {
      'Filler': { type: 'bottle-filler', normalSpeed: [400, 600], unit: 'BPM' },
      'Labeler': { type: 'labeling-machine', accuracy: 99.5 },
      'Palletizer': { type: 'palletizing-robot', cycleTime: [10, 15] }
    },
    criticalMetrics: ['countinfeed', 'countoutfeed', 'countdefect', 'oee'],
    concerns: ['line_efficiency', 'changeover_time', 'reject_rate'],
    rawCounterFields: ['countinfeed', 'countoutfeed', 'countdefect'],
    safeRanges: {
      'reject_rate': { max: 2, unit: '%', warning: 1.5 },
      'filler_speed': { min: 350, max: 650, unit: 'BPM' }
    },
    wasteMetrics: ['count_defect', 'input_countdefect', 'workorder_quantitydefect'],
    wasteThresholds: { warning: 50, critical: 100, unit: 'defects/hr' }
  },
  'Enterprise C': {
    industry: 'Bioprocessing / Pharma',
    domain: 'pharma',
    batchControl: 'ISA-88',
    equipment: {
      'SUM': { type: 'single-use-mixer', phase: 'preparation' },
      'SUB': { type: 'single-use-bioreactor', phase: 'cultivation' },
      'CHROM': { type: 'chromatography', phase: 'purification' },
      'TFF': { type: 'tangential-flow-filtration', phase: 'filtration' }
    },
    criticalMetrics: ['PV_percent', 'phase', 'batch_id'],
    concerns: ['contamination', 'batch_deviation', 'sterility'],
    safeRanges: {
      'pH': { min: 6.8, max: 7.4, critical: true },
      'dissolved_oxygen': { min: 30, max: 70, unit: '%' }
    },
    wasteMetrics: ['chrom_CHR01_WASTE_PV'],
    wasteThresholds: { warning: 5, critical: 15, unit: 'L' }
  }
};

// =============================================================================
// CLASSIFICATION FUNCTIONS
// =============================================================================

/**
 * Automatically classifies a measurement based on its name using pattern matching.
 * Returns the category key and a confidence indicator.
 *
 * @param {string} measurementName - The measurement name to classify
 * @returns {Object} Classification result with category and confidence
 * @returns {string} return.category - The classification category key
 * @returns {boolean} return.confident - Whether the classification is confident (exact match)
 *
 * @example
 * classifyMeasurement('machine_oee') // { category: 'oee_metric', confident: true }
 * classifyMeasurement('sensor_temp') // { category: 'sensor_reading', confident: true }
 * classifyMeasurement('unknown') // { category: 'description', confident: false }
 */
function classifyMeasurement(measurementName) {
  if (!measurementName || typeof measurementName !== 'string') {
    return { category: 'description', confident: false };
  }

  const lowerName = measurementName.toLowerCase();

  // Check each classification category for pattern matches
  for (const [category, patterns] of Object.entries(MEASUREMENT_CLASSIFICATIONS)) {
    // Skip description category (fallback)
    if (category === 'description') continue;

    // Check if measurement name contains any of the patterns
    for (const pattern of patterns) {
      if (lowerName.includes(pattern.toLowerCase())) {
        return { category, confident: true };
      }
    }
  }

  // Default to description category for unclassified measurements
  return { category: 'description', confident: false };
}

/**
 * Gets enterprise domain context by enterprise name.
 *
 * @param {string} enterpriseName - The enterprise name (e.g., 'Enterprise A')
 * @returns {Object|null} Enterprise domain context or null if not found
 *
 * @example
 * getEnterpriseContext('Enterprise A') // { industry: 'Glass Manufacturing', ... }
 */
function getEnterpriseContext(enterpriseName) {
  return ENTERPRISE_DOMAIN_CONTEXT[enterpriseName] || null;
}

/**
 * Gets all available enterprise names.
 *
 * @returns {string[]} Array of enterprise names
 *
 * @example
 * getEnterpriseNames() // ['Enterprise A', 'Enterprise B', 'Enterprise C']
 */
function getEnterpriseNames() {
  return Object.keys(ENTERPRISE_DOMAIN_CONTEXT);
}

/**
 * Checks if a measurement is a waste metric for a given enterprise.
 *
 * @param {string} measurementName - The measurement name
 * @param {string} enterpriseName - The enterprise name
 * @returns {boolean} True if the measurement is a waste metric
 *
 * @example
 * isWasteMetric('OEE_Waste', 'Enterprise A') // true
 * isWasteMetric('temperature', 'Enterprise A') // false
 */
function isWasteMetric(measurementName, enterpriseName) {
  const context = getEnterpriseContext(enterpriseName);
  if (!context || !context.wasteMetrics) {
    return false;
  }

  const lowerName = measurementName.toLowerCase();
  return context.wasteMetrics.some(metric => lowerName.includes(metric.toLowerCase()));
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  MEASUREMENT_CLASSIFICATIONS,
  ENTERPRISE_DOMAIN_CONTEXT,
  classifyMeasurement,
  getEnterpriseContext,
  getEnterpriseNames,
  isWasteMetric
};
