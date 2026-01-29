/**
 * @module equipment
 * @description Dynamic equipment discovery and classification for batch operations
 */

const { schemaCache } = require('../state');
const { refreshHierarchyCache } = require('../schema');

/**
 * Equipment type patterns for name inference
 */
const EQUIPMENT_PATTERNS = {
  'SUB': { type: 'bioreactor', template: 'Single-Use Bioreactor {size}L' },
  'SUM': { type: 'mixer', template: 'Single-Use Mixer {size}L' },
  'CHR': { type: 'chromatography', template: 'Chromatography Unit {number}' },
  'TFF': { type: 'filtration', template: 'Tangential Flow Filtration {number}' },
};

/**
 * Map alternate measurement patterns to canonical equipment IDs
 */
const EQUIPMENT_ALIASES = {
  'UNIT_250': 'SUB250',
  'UNIT_500': 'SUM500',
};

/**
 * Infer equipment type from area name or machine ID patterns
 * @param {string} area - Area name
 * @param {string} machineId - Machine ID
 * @returns {string} Equipment type
 */
function inferEquipmentType(area, machineId) {
  // First try area name mapping
  const areaTypeMap = {
    'bioreactor': 'bioreactor',
    'chromatography': 'chromatography',
    'filtration': 'filtration',
    'tff': 'filtration',
    'mixer': 'mixer',
  };

  if (area && areaTypeMap[area.toLowerCase()]) {
    return areaTypeMap[area.toLowerCase()];
  }

  // Fall back to machine ID pattern matching
  for (const [prefix, config] of Object.entries(EQUIPMENT_PATTERNS)) {
    if (machineId.toUpperCase().startsWith(prefix)) {
      return config.type;
    }
  }

  return 'unknown';
}

/**
 * Generate human-readable equipment name from machine ID and type
 * @param {string} machineId - Machine ID
 * @param {string} type - Equipment type
 * @returns {string} Human-readable name
 */
function generateEquipmentName(machineId, type) {
  // Try to extract size/number from ID (e.g., SUB250 -> 250, CHR01 -> 01)
  const match = machineId.match(/([A-Z]+)(\d+)/i);
  if (match) {
    const [, prefix, number] = match;
    const pattern = EQUIPMENT_PATTERNS[prefix.toUpperCase()];
    if (pattern) {
      return pattern.template
        .replace('{size}', number)
        .replace('{number}', number);
    }
  }

  // Fallback: capitalize type + machine ID
  const typeCapitalized = type.charAt(0).toUpperCase() + type.slice(1);
  return `${typeCapitalized} Unit ${machineId}`;
}

/**
 * Resolve equipment ID from measurement name, handling aliases
 * @param {string} measurementName - Measurement name
 * @param {Array<string>} knownEquipment - Array of known equipment IDs
 * @returns {string|null} Resolved equipment ID or null
 */
function resolveEquipmentId(measurementName, knownEquipment) {
  const upperMeasurement = measurementName.toUpperCase();

  // Check for direct match with known equipment
  for (const equipId of knownEquipment) {
    if (upperMeasurement.includes(equipId.toUpperCase())) {
      return equipId;
    }
  }

  // Check aliases
  for (const [alias, canonical] of Object.entries(EQUIPMENT_ALIASES)) {
    if (upperMeasurement.includes(alias)) {
      return canonical;
    }
  }

  return null;
}

/**
 * Discover all equipment for an enterprise from hierarchy cache
 * @param {string} enterprise - Enterprise name (e.g., 'Enterprise C')
 * @returns {Promise<Array>} Array of equipment objects with id, name, type, site, area
 */
async function discoverEquipment(enterprise) {
  // Ensure hierarchy cache is fresh
  if (!schemaCache.hierarchy || Object.keys(schemaCache.hierarchy).length === 0) {
    await refreshHierarchyCache();
  }

  const enterpriseData = schemaCache.hierarchy[enterprise];
  if (!enterpriseData || !enterpriseData.sites) {
    return [];
  }

  const equipment = [];

  for (const [siteName, site] of Object.entries(enterpriseData.sites)) {
    if (!site.areas) continue;

    for (const [areaName, area] of Object.entries(site.areas)) {
      if (!area.machines) continue;

      for (const [machineId, machine] of Object.entries(area.machines)) {
        const type = inferEquipmentType(areaName, machineId);
        const name = generateEquipmentName(machineId, type);

        equipment.push({
          id: machineId,
          name,
          type,
          site: siteName,
          area: areaName,
          measurements: machine.measurements || [],
          totalCount: machine.totalCount || 0
        });
      }
    }
  }

  // Sort by equipment ID for consistency
  equipment.sort((a, b) => a.id.localeCompare(b.id));

  return equipment;
}

/**
 * Get equipment metadata map for batch status queries
 * @param {string} enterprise - Enterprise name
 * @returns {Promise<Object>} Map of equipment ID to metadata
 */
async function getEquipmentMetadata(enterprise) {
  const equipment = await discoverEquipment(enterprise);
  const metadata = {};

  for (const equip of equipment) {
    metadata[equip.id] = {
      name: equip.name,
      type: equip.type,
      site: equip.site,
      area: equip.area
    };
  }

  return metadata;
}

module.exports = {
  EQUIPMENT_PATTERNS,
  EQUIPMENT_ALIASES,
  inferEquipmentType,
  generateEquipmentName,
  resolveEquipmentId,
  discoverEquipment,
  getEquipmentMetadata
};
