// lib/ai/tools.js - Bedrock Tool Definitions and Handlers for Investigative Insights

const { queryApi } = require('../influx/client');
const { calculateOEEv2 } = require('../oee');
const { equipmentStateCache } = require('../state');
const CONFIG = require('../config');
const { sanitizeInfluxIdentifier } = require('../validation');

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
          r._measurement =~ /timedownunplanned/i or
          r._measurement =~ /timeidle/i or
          r._measurement =~ /countdefect/i or
          r._measurement =~ /downtime/i or
          r._measurement =~ /idle/i or
          r._measurement =~ /defect/i
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
  validateEnterpriseInput,
  VALID_ENTERPRISES,
  QUERY_TIMEOUT_MS
};
