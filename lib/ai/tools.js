// lib/ai/tools.js - Bedrock Tool Definitions and Handlers for Investigative Insights

const { queryApi } = require('../influx/client');
const { calculateOEEv2 } = require('../oee');
const { equipmentStateCache } = require('../state');
const CONFIG = require('../config');
const { sanitizeInfluxIdentifier } = require('../validation');
const { getEquipmentMetadata, resolveEquipmentId } = require('../equipment');

/**
 * Parse JSON-encoded MQTT values to extract the actual value field
 * @param {string|number} rawValue - Raw value from InfluxDB
 * @returns {string|number|null} Parsed value
 */
function parseJsonValue(rawValue) {
  if (typeof rawValue !== 'string') return rawValue;

  // Try to parse as JSON and extract value field
  try {
    const parsed = JSON.parse(rawValue);
    if (parsed && typeof parsed === 'object' && 'value' in parsed) {
      // Handle <nil> as null
      if (parsed.value === '<nil>') return null;
      return parsed.value;
    }
    return rawValue;
  } catch {
    return rawValue;
  }
}

/**
 * Query timeout for InfluxDB operations (8 seconds)
 * Prevents hanging queries from consuming the entire 30s analysis budget
 */
const QUERY_TIMEOUT_MS = 8000;

/**
 * Valid enterprise names for validation
 * SECURITY: Whitelist prevents Flux injection attacks
 */
const VALID_ENTERPRISES = ['Enterprise A', 'Enterprise B', 'Enterprise C'];

/**
 * Tool definitions for Bedrock tool_use API.
 * These tools enable Claude to query factory data during trend analysis.
 */
const TOOL_DEFINITIONS = [
  {
    name: 'get_oee_breakdown',
    description: 'Get detailed OEE breakdown (Availability, Performance, Quality components) for a specific enterprise. Use this when you need to understand WHY an OEE score is low - it shows which component (A, P, or Q) is the bottleneck.',
    input_schema: {
      type: 'object',
      properties: {
        enterprise: {
          type: 'string',
          description: 'Enterprise name: "Enterprise A", "Enterprise B", or "Enterprise C"',
          enum: ['Enterprise A', 'Enterprise B', 'Enterprise C']
        },
        site: {
          type: 'string',
          description: 'Optional site filter (e.g., "Dallas Line 1", "Site3"). Leave empty to aggregate all sites.'
        }
      },
      required: ['enterprise']
    }
  },
  {
    name: 'get_equipment_states',
    description: 'Get current equipment states (DOWN, IDLE, RUNNING) for all equipment in an enterprise. Use this to identify which specific machines are DOWN or IDLE and contributing to availability problems.',
    input_schema: {
      type: 'object',
      properties: {
        enterprise: {
          type: 'string',
          description: 'Enterprise name: "Enterprise A", "Enterprise B", or "Enterprise C"',
          enum: ['Enterprise A', 'Enterprise B', 'Enterprise C']
        }
      },
      required: ['enterprise']
    }
  },
  {
    name: 'get_downtime_analysis',
    description: 'Analyze downtime and quality metrics for an enterprise over the last 24 hours. Returns timedownunplanned, timeidle, and countdefect aggregated data to understand root causes of low availability or quality scores.',
    input_schema: {
      type: 'object',
      properties: {
        enterprise: {
          type: 'string',
          description: 'Enterprise name: "Enterprise A", "Enterprise B", or "Enterprise C"',
          enum: ['Enterprise A', 'Enterprise B', 'Enterprise C']
        }
      },
      required: ['enterprise']
    }
  },
  {
    name: 'get_batch_status',
    description: 'Get ISA-88 batch status for Enterprise C bioprocessing equipment. Returns current batch IDs, phases, process states, and recipe execution status for CHR01 (chromatography), SUB250 (bioreactor), SUM500 (mixer), and TFF300 (filtration). Use this instead of OEE tools when analyzing Enterprise C.',
    input_schema: {
      type: 'object',
      properties: {
        equipment_type: {
          type: 'string',
          description: 'Optional filter by equipment type: "bioreactor", "chromatography", "filtration", "mixer", or omit for all equipment',
          enum: ['bioreactor', 'chromatography', 'filtration', 'mixer']
        }
      }
    }
  }
];

/**
 * Validates enterprise parameter against whitelist
 * @param {string} enterprise - Enterprise name to validate
 * @returns {{ valid: boolean, error?: string }} Validation result
 */
function validateEnterpriseInput(enterprise) {
  if (!enterprise || typeof enterprise !== 'string') {
    return { valid: false, error: 'Enterprise parameter is required and must be a string' };
  }
  if (!VALID_ENTERPRISES.includes(enterprise)) {
    return {
      valid: false,
      error: `Invalid enterprise: ${enterprise}. Must be one of: ${VALID_ENTERPRISES.join(', ')}`
    };
  }
  return { valid: true };
}

/**
 * Tool handler: Get OEE breakdown with A×P×Q components
 * @param {Object} input - Tool input parameters
 * @param {string} input.enterprise - Enterprise name
 * @param {string} [input.site] - Optional site filter
 * @returns {Promise<Object>} OEE breakdown data
 */
async function handleGetOEEBreakdown(input) {
  try {
    const { enterprise, site } = input;

    // SECURITY: Validate enterprise against whitelist
    const validation = validateEnterpriseInput(enterprise);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error,
        data: null
      };
    }

    const result = await calculateOEEv2(enterprise, site || null);

    return {
      success: true,
      data: {
        enterprise: result.enterprise,
        site: result.site,
        oee: result.oee,
        components: result.components,
        calculation: result.calculation,
        quality: result.quality,
        timestamp: result.timestamp
      }
    };
  } catch (error) {
    console.error('Tool error (get_oee_breakdown):', error.message);
    return {
      success: false,
      error: error.message,
      data: null
    };
  }
}

/**
 * Tool handler: Get equipment states from cache
 * @param {Object} input - Tool input parameters
 * @param {string} input.enterprise - Enterprise name
 * @returns {Promise<Object>} Equipment state data
 */
async function handleGetEquipmentStates(input) {
  try {
    const { enterprise } = input;

    // SECURITY: Validate enterprise against whitelist
    const validation = validateEnterpriseInput(enterprise);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error,
        data: null
      };
    }

    // Filter equipment state cache by enterprise
    const equipmentStates = [];

    for (const [key, stateData] of equipmentStateCache.states.entries()) {
      if (stateData.enterprise === enterprise) {
        // Check if state is still fresh (not stale)
        const age = Date.now() - stateData.timestamp;
        const isFresh = age < equipmentStateCache.CACHE_TTL_MS;

        equipmentStates.push({
          machine: stateData.machine,
          site: stateData.site,
          area: stateData.area,
          state: stateData.stateName,
          stateCode: stateData.stateCode,
          timestamp: stateData.timestamp,
          age_seconds: Math.floor(age / 1000),
          is_fresh: isFresh
        });
      }
    }

    // Sort by priority: DOWN > IDLE > RUNNING
    const priorityMap = { 'DOWN': 3, 'IDLE': 2, 'RUNNING': 1 };
    equipmentStates.sort((a, b) => (priorityMap[b.state] || 0) - (priorityMap[a.state] || 0));

    // Summarize by state
    const summary = {
      DOWN: equipmentStates.filter(e => e.state === 'DOWN').length,
      IDLE: equipmentStates.filter(e => e.state === 'IDLE').length,
      RUNNING: equipmentStates.filter(e => e.state === 'RUNNING').length,
      total: equipmentStates.length
    };

    return {
      success: true,
      data: {
        enterprise,
        summary,
        equipment: equipmentStates,
        cache_ttl_seconds: equipmentStateCache.CACHE_TTL_MS / 1000
      }
    };
  } catch (error) {
    console.error('Tool error (get_equipment_states):', error.message);
    return {
      success: false,
      error: error.message,
      data: null
    };
  }
}

/**
 * Tool handler: Get batch status for Enterprise C ISA-88 equipment
 * @param {Object} input - Tool input parameters
 * @param {string} [input.equipment_type] - Optional equipment type filter
 * @returns {Promise<Object>} Batch status data
 */
async function handleGetBatchStatus(input) {
  try {
    const { equipment_type } = input;

    // Dynamically discover equipment from hierarchy cache
    const equipmentMetadata = await getEquipmentMetadata('Enterprise C');
    const knownEquipment = Object.keys(equipmentMetadata);

    // Query InfluxDB for latest batch equipment states (same query as /api/batch/status)
    const fluxQuery = `
      from(bucket: "${CONFIG.influxdb.bucket}")
        |> range(start: -15m)
        |> filter(fn: (r) => r._field == "value")
        |> filter(fn: (r) => r.enterprise == "Enterprise C")
        |> filter(fn: (r) =>
          r._measurement =~ /STATE/ or
          r._measurement =~ /PHASE/ or
          r._measurement =~ /BATCH_ID/ or
          r._measurement =~ /RECIPE/ or
          r._measurement =~ /STATUS/ or
          r._measurement =~ /FORMULA/
        )
        |> last()
    `;

    // Collect measurement data by equipment
    const equipmentData = new Map();

    await Promise.race([
      new Promise((resolve) => {
        queryApi.queryRows(fluxQuery, {
          next(row, tableMeta) {
            const o = tableMeta.toObject(row);
            if (!o._measurement || !o._value) return;

            // Resolve equipment ID from measurement name using aliases
            const equipmentId = resolveEquipmentId(o._measurement, knownEquipment);
            if (!equipmentId || !equipmentMetadata[equipmentId]) return;

            // Apply equipment type filter if specified
            if (equipment_type && equipmentMetadata[equipmentId].type !== equipment_type) {
              return;
            }

            // Initialize equipment entry if needed
            if (!equipmentData.has(equipmentId)) {
              equipmentData.set(equipmentId, {
                id: equipmentId,
                site: o.site || 'Unknown',
                measurements: {},
                lastUpdate: o._time
              });
            }

            const equipment = equipmentData.get(equipmentId);

            // Categorize measurement by type
            const measurement = o._measurement.toLowerCase();
            const parsedValue = parseJsonValue(o._value);

            if (measurement.includes('state') || measurement.includes('status')) {
              equipment.measurements.state = parsedValue;
              equipment.lastUpdate = o._time;
            } else if (measurement.includes('phase')) {
              equipment.measurements.phase = parsedValue;
            } else if (measurement.includes('batch_id')) {
              equipment.measurements.batchId = parsedValue;
            } else if (measurement.includes('recipe') || measurement.includes('formula')) {
              equipment.measurements.recipe = parsedValue;
            }
          },
          error(error) {
            console.error('Batch status query error:', error);
            resolve();
          },
          complete() {
            resolve();
          }
        });
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('InfluxDB query timeout')), QUERY_TIMEOUT_MS)
      )
    ]);

    // Build response with equipment status
    const equipment = [];
    const summary = { running: 0, idle: 0, complete: 0, fault: 0, total: 0 };

    for (const [id, data] of equipmentData.entries()) {
      const metadata = equipmentMetadata[id];
      // Use state if available, fall back to phase (TFF300 has no STATE, only PHASE)
      const state = data.measurements.state || data.measurements.phase || 'Unknown';

      // Normalize state for summary
      const stateLower = state.toString().toLowerCase();
      let summaryKey = 'idle';
      if (stateLower.includes('run')) summaryKey = 'running';
      else if (stateLower.includes('complete') || stateLower.includes('done')) summaryKey = 'complete';
      else if (stateLower.includes('fault') || stateLower.includes('error') || stateLower.includes('alarm')) summaryKey = 'fault';

      summary[summaryKey]++;
      summary.total++;

      equipment.push({
        id,
        name: metadata.name,
        type: metadata.type,
        site: data.site,
        state,
        phase: data.measurements.phase || null,
        batchId: data.measurements.batchId || null,
        recipe: data.measurements.recipe || null,
        lastUpdate: data.lastUpdate
      });
    }

    // Sort by equipment ID for consistency
    equipment.sort((a, b) => a.id.localeCompare(b.id));

    return {
      success: true,
      data: {
        enterprise: 'Enterprise C',
        filter: equipment_type || 'all',
        equipment,
        summary,
        analysis_hint: 'Enterprise C uses ISA-88 batch control. Focus on phase progression, batch IDs, and equipment states rather than OEE metrics.'
      }
    };
  } catch (error) {
    console.error('Tool error (get_batch_status):', error.message);
    return {
      success: false,
      error: error.message,
      data: null
    };
  }
}

/**
 * Tool handler: Get downtime and quality analysis from InfluxDB
 * @param {Object} input - Tool input parameters
 * @param {string} input.enterprise - Enterprise name
 * @returns {Promise<Object>} Downtime analysis data
 */
async function handleGetDowntimeAnalysis(input) {
  try {
    const { enterprise } = input;

    // SECURITY: Validate enterprise against whitelist
    const validation = validateEnterpriseInput(enterprise);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error,
        data: null
      };
    }

    // SECURITY: Sanitize enterprise identifier for Flux query
    const safeEnterprise = sanitizeInfluxIdentifier(enterprise);

    // Query timedownunplanned, timeidle, and countdefect metrics
    const fluxQuery = `
      from(bucket: "${CONFIG.influxdb.bucket}")
        |> range(start: -24h)
        |> filter(fn: (r) => r._field == "value")
        |> filter(fn: (r) => r.enterprise == "${safeEnterprise}")
        |> filter(fn: (r) =>
          r._measurement =~ /timedownunplanned/ or
          r._measurement =~ /timeidle/ or
          r._measurement =~ /countdefect/ or
          r._measurement =~ /downtime/ or
          r._measurement =~ /idle/ or
          r._measurement =~ /defect/
        )
        |> filter(fn: (r) => r._value >= 0)
        |> group(columns: ["_measurement", "site", "area"])
        |> sum()
        |> yield(name: "downtime_analysis")
    `;

    const results = [];

    // PERFORMANCE: Add timeout to prevent hanging queries
    await Promise.race([
      new Promise((resolve, reject) => {
        queryApi.queryRows(fluxQuery, {
          next(row, tableMeta) {
            const o = tableMeta.toObject(row);
            results.push({
              measurement: o._measurement,
              site: o.site || 'Unknown',
              area: o.area || 'Unknown',
              total: o._value,
              unit: o._measurement.includes('time') ? 'seconds' : 'count'
            });
          },
          error(error) {
            console.error('InfluxDB downtime query error:', error.message);
            reject(error);
          },
          complete() {
            resolve();
          }
        });
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('InfluxDB query timeout')), QUERY_TIMEOUT_MS)
      )
    ]);

    // Aggregate by metric type
    const summary = {
      timedownunplanned_seconds: 0,
      timeidle_seconds: 0,
      countdefect_total: 0
    };

    results.forEach(r => {
      if (r.measurement.toLowerCase().includes('timedownunplanned') || r.measurement.toLowerCase().includes('downtime')) {
        summary.timedownunplanned_seconds += r.total;
      } else if (r.measurement.toLowerCase().includes('timeidle') || r.measurement.toLowerCase().includes('idle')) {
        summary.timeidle_seconds += r.total;
      } else if (r.measurement.toLowerCase().includes('countdefect') || r.measurement.toLowerCase().includes('defect')) {
        summary.countdefect_total += r.total;
      }
    });

    // Convert seconds to hours for readability
    summary.timedownunplanned_hours = parseFloat((summary.timedownunplanned_seconds / 3600).toFixed(2));
    summary.timeidle_hours = parseFloat((summary.timeidle_seconds / 3600).toFixed(2));

    return {
      success: true,
      data: {
        enterprise,
        period: '24h',
        summary,
        details: results.slice(0, 20) // Limit to top 20 entries
      }
    };
  } catch (error) {
    console.error('Tool error (get_downtime_analysis):', error.message);

    // Log timeout warnings for monitoring
    if (error.message.includes('timeout')) {
      console.warn(`⚠️ InfluxDB query timeout (${QUERY_TIMEOUT_MS}ms) for enterprise: ${input.enterprise}`);
    }

    return {
      success: false,
      error: error.message,
      data: null
    };
  }
}

/**
 * Execute a tool by name with input parameters
 * @param {string} toolName - Name of the tool to execute
 * @param {Object} input - Tool input parameters
 * @returns {Promise<Object>} Tool execution result
 */
async function executeTool(toolName, input) {
  console.log(`🔧 Executing tool: ${toolName} with input:`, JSON.stringify(input));

  switch (toolName) {
    case 'get_oee_breakdown':
      return await handleGetOEEBreakdown(input);
    case 'get_equipment_states':
      return await handleGetEquipmentStates(input);
    case 'get_downtime_analysis':
      return await handleGetDowntimeAnalysis(input);
    case 'get_batch_status':
      return await handleGetBatchStatus(input);
    default:
      return {
        success: false,
        error: `Unknown tool: ${toolName}`,
        data: null
      };
  }
}

module.exports = {
  TOOL_DEFINITIONS,
  executeTool,
  handleGetOEEBreakdown,
  handleGetEquipmentStates,
  handleGetDowntimeAnalysis,
  handleGetBatchStatus,
  validateEnterpriseInput,
  VALID_ENTERPRISES,
  QUERY_TIMEOUT_MS
};
