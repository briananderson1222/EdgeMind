/**
 * Topic Classifier - Pattern-based MQTT topic parsing
 * 
 * Replaces positional parsing with explicit pattern matching.
 * Each pattern defines how to extract tags, classify data type,
 * and normalize state values to: running, idle, down, unknown.
 */

const TOPIC_PATTERNS = [
  // Utilities: Electrical Panels EMU data (energy monitoring)
  {
    name: 'utilities_electrical_panel',
    match: /^Utilities\/Electrical Panels\/([^/]+)\/EMUData\/(.+)\/([^/]+)\/(?:value|timestamp)$/,
    type: 'energy',
    extract: (m) => ({
      area: 'Utilities',
      machine: 'Electrical Panels',
      device: m[1],
      phase: m[2],
      metric: m[3]
    })
  },

  // Utilities: Compressors power and energy
  {
    name: 'utilities_compressor',
    match: /^Utilities\/Compressors\/([^/]+)\/(.+)\/([^/]+)\/(?:value|timestamp)$/,
    type: 'energy',
    extract: (m) => ({
      area: 'Utilities',
      machine: 'Compressors',
      device: m[1],
      phase: m[2],
      metric: m[3]
    })
  },

  // Utilities: Environmental sensors
  {
    name: 'utilities_environmental',
    match: /^Utilities\/Environmental\/([^/]+)\/([^/]+)\/(?:value|timestamp)$/,
    type: 'process_variable',
    extract: (m) => ({
      area: 'Utilities',
      machine: 'Environmental',
      device: m[1],
      metric: m[2]
    })
  },

  // Utilities: Air Dryers
  {
    name: 'utilities_air_dryer',
    match: /^Utilities\/Air Dryers\/([^/]+)\/([^/]+)\/Value\/(?:value|timestamp)$/,
    type: 'process_variable',
    extract: (m) => ({
      area: 'Utilities',
      machine: 'Air Dryers',
      device: m[1],
      metric: m[2]
    })
  },

  // Enterprise A: Production equipment state
  {
    name: 'enterprise_a_state',
    match: /^(Enterprise A)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/State\/(StateReason|StateCurrent)$/,
    type: 'equipment_state',
    stateMap: { 'RUN-NRM': 'running' },
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      area: m[3],
      machine: m[4],
      device: m[5],
      field: m[6] === 'StateReason' ? 'state/name' : 'state/code'
    })
  },
  
  // Enterprise B: Processdata state/type - clean categorical values
  {
    name: 'enterprise_b_state_type',
    match: /^(Enterprise B)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/processdata\/state\/type$/,
    type: 'equipment_state',
    stateMap: {
      'Running': 'running',
      'Idle': 'idle',
      'PlannedDowntime': 'down',
      'UnplannedDowntime': 'down',
      'Unknown': 'unknown',
    },
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      area: m[3],
      machine: m[4],
      device: m[5],
      field: 'state/type'
    })
  },
  
  // Enterprise B: state/name - human-readable reason (not for status determination)
  {
    name: 'enterprise_b_state_name',
    match: /^(Enterprise B)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/processdata\/state\/name$/,
    type: 'equipment_state',
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      area: m[3],
      machine: m[4],
      device: m[5],
      field: 'state/name'
    })
  },
  
  // Enterprise B: Other state fields (code, duration) - metadata only
  {
    name: 'enterprise_b_state_other',
    match: /^(Enterprise B)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/processdata\/state\/(code|duration)$/,
    type: 'state_metadata',
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      area: m[3],
      machine: m[4],
      device: m[5],
      field: `state/${m[6]}`
    })
  },
  
  // Enterprise B: Enterprise-level OEE metrics (short path)
  {
    name: 'enterprise_b_oee_short',
    match: /^(Enterprise B)\/Metric\/(oee|availability|performance|quality)$/i,
    type: 'oee',
    extract: (m) => ({
      enterprise: m[1],
      metric: m[2].toLowerCase()
    })
  },

  // Enterprise B: Site-specific OEE metrics (Site/metric/oee)
  {
    name: 'enterprise_b_oee_site',
    match: /^(Enterprise B)\/([^/]+)\/metric\/(oee|availability|performance|quality)$/i,
    type: 'oee',
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      metric: m[3].toLowerCase()
    })
  },

  // Enterprise B: Enterprise-level production inputs (short path)
  {
    name: 'enterprise_b_input_short',
    match: /^(Enterprise B)\/Metric\/input\/(\w+)$/i,
    type: 'production_metric',
    extract: (m) => ({
      enterprise: m[1],
      metric: m[2]
    })
  },

  // Enterprise B: OEE metrics (device-level)
  {
    name: 'enterprise_b_oee',
    match: /^(Enterprise B)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/metric\/(oee|availability|performance|quality)$/,
    type: 'oee',
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      area: m[3],
      machine: m[4],
      device: m[5],
      metric: m[6]
    })
  },

  // Enterprise B: OEE metrics (machine-level, no device)
  {
    name: 'enterprise_b_oee_machine',
    match: /^(Enterprise B)\/([^/]+)\/([^/]+)\/([^/]+)\/metric\/(oee|availability|performance|quality)$/,
    type: 'oee',
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      area: m[3],
      machine: m[4],
      metric: m[5]
    })
  },
  
  // Enterprise B: Production metrics (counts, rates, times)
  {
    name: 'enterprise_b_metric',
    match: /^(Enterprise B)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/metric\/input\/(\w+)$/,
    type: 'production_metric',
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      area: m[3],
      machine: m[4],
      device: m[5],
      metric: m[6]
    })
  },

  // Enterprise B: Production metrics (machine-level, no device)
  {
    name: 'enterprise_b_metric_machine',
    match: /^(Enterprise B)\/([^/]+)\/([^/]+)\/([^/]+)\/metric\/input\/(\w+)$/,
    type: 'production_metric',
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      area: m[3],
      machine: m[4],
      metric: m[5]
    })
  },
  
  // Enterprise B: Process counts
  {
    name: 'enterprise_b_count',
    match: /^(Enterprise B)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/processdata\/count\/(\w+)$/,
    type: 'production_metric',
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      area: m[3],
      machine: m[4],
      device: m[5],
      metric: 'count_' + m[6]
    })
  },
  
  // Enterprise A: OEE metrics (Enterprise A/Dallas/Line 1/OEE/Availability)
  {
    name: 'enterprise_a_oee',
    match: /^(Enterprise A)\/([^/]+)\/([^/]+)\/OEE\/(\w+)$/,
    type: 'oee',
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      area: m[3],
      machine: m[3],
      device: 'OEE',
      metric: m[4].toLowerCase()
    })
  },
  
  // Enterprise A: Production counts
  {
    name: 'enterprise_a_production',
    match: /^(Enterprise A)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/Production_(\w+)$/,
    type: 'production_metric',
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      area: m[3],
      machine: m[4],
      device: m[5],
      metric: m[6].toLowerCase()
    })
  },
  
  // Enterprise C: Batch unit state (aveva path) - only STATE topic
  {
    name: 'enterprise_c_unit_state',
    match: /^(Enterprise C)\/aveva\/([^/]+)\/([^/]+)\/unit\/([^/]+)\/STATE$/i,
    type: 'equipment_state',
    stateMap: { 'running': 'running', 'idle': 'idle' },
    jsonPayload: true,
    extract: (m) => ({
      enterprise: m[1],
      site: 'aveva',
      area: m[2],
      machine: m[3],
      device: m[4],
      field: 'state/name'
    })
  },
  
  // Enterprise C: Simple state topics (Enterprise C/{site}/{tag}_STATE or _STATE_PV)
  {
    name: 'enterprise_c_simple_state',
    match: /^(Enterprise C)\/([^/]+)\/([^_]+)[-_]?(\d*)_STATE(?:_PV)?$/,
    type: 'equipment_state',
    stateMap: { 'running': 'running', 'idle': 'idle' },
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      area: m[2],
      machine: m[3] + (m[4] || ''),
      device: m[3] + (m[4] || ''),
      field: 'state/name'
    })
  },
  
  // Enterprise C: Controller/instrument data
  {
    name: 'enterprise_c_controller',
    match: /^(Enterprise C)\/aveva\/([^/]+)\/([^/]+)\/(controllers|instruments|valves|pumps)\/([^/]+)\/(\w+)$/,
    type: 'process_variable',
    extract: (m) => ({
      enterprise: m[1],
      site: 'aveva',
      area: m[2],
      machine: m[3],
      device: m[5],
      metric: m[6]
    })
  },
  
  // opto22: Alarm topics (match before generic io_point)
  {
    name: 'opto22_alarm',
    match: /^(Enterprise [^/]+)\/opto22\/(.+)\/([^/]+\s+alarm)\/([^/]+)$/i,
    type: 'alarm',
    extract: (m) => ({
      enterprise: m[1],
      site: 'opto22',
      area: m[2].split('/')[0],
      machine: m[3],
      device: m[4]
    })
  },

  // opto22: Energy/Power monitoring (any path with Power, Energy, kWh, Voltage, etc)
  {
    name: 'opto22_energy',
    match: /^(Enterprise [^/]+)\/opto22\/(.+)\/(Power|Energy|Voltage|Current|kWh|True Power|Apparent|Reactive)[^/]*$/i,
    type: 'energy',
    extract: (m) => ({
      enterprise: m[1],
      site: 'opto22',
      area: m[2].split('/')[0],
      equipment: m[2].split('/')[1] || m[2].split('/')[0],
      metric: m[3]
    })
  },

  // opto22: Energy in nested paths (Power and Energy, EMUData, Status)
  {
    name: 'opto22_energy_nested',
    match: /^(Enterprise [^/]+)\/opto22\/(.+)\/(EMUData|Power and Energy|Status)\/(.+)$/,
    type: 'energy',
    extract: (m) => ({
      enterprise: m[1],
      site: 'opto22',
      area: m[2].split('/')[0],
      equipment: m[2].split('/')[1] || m[2].split('/')[0],
      phase: m[4].split('/')[0],
      metric: m[4].split('/').pop()
    })
  },

  // opto22: Sensor readings (pressure, temperature, flow)
  {
    name: 'opto22_sensor',
    match: /^(Enterprise [^/]+)\/opto22\/(.+)\/.*(pressure|temperature|flow|level|humidity).*\/(\w+)$/i,
    type: 'process_variable',
    extract: (m) => ({
      enterprise: m[1],
      site: 'opto22',
      area: m[2].split('/')[0],
      equipment: m[2].split('/')[1] || m[2].split('/')[0],
      metric: m[3],
      device: m[4]
    })
  },

  // abelara: Production counts (counts/infeed, counts/outfeed, counts/waste)
  {
    name: 'abelara_counts',
    match: /^abelara\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/counts\/(\w+)$/,
    type: 'production_metric',
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      area: m[3],
      machine: m[4],
      device: m[5],
      metric: 'count_' + m[6]
    })
  },

  // abelara: Production status
  {
    name: 'abelara_production',
    match: /^abelara\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/production$/,
    type: 'production_metric',
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      area: m[3],
      machine: m[4],
      device: m[5],
      metric: 'production'
    })
  },

  // abelara: Equipment state
  {
    name: 'abelara_state',
    match: /^abelara\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/state$/,
    type: 'equipment_state',
    stateMap: {
      'Running': 'running',
      'Idle': 'idle',
      'Down': 'down',
      'Faulted': 'down',
      'Stopped': 'idle'
    },
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      area: m[3],
      machine: m[4],
      device: m[5],
      metric: 'state'
    })
  },

  // abelara: Telemetry (level, volume, etc)
  {
    name: 'abelara_telemetry',
    match: /^abelara\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/telemetry\/(.+)$/,
    type: 'telemetry',
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      area: m[3],
      machine: m[4],
      device: m[5],
      metric: m[6].replace(/\//g, '_')
    })
  },

  // abelara/MES: Process parameters (level, weight, setpoints)
  {
    name: 'abelara_parameter',
    match: /^(\w+)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)$/,
    type: 'process_variable',
    // Only match if payload looks like abelara JSON (has _model or parameterName)
    payloadMatch: /"(_model|parameterName)"/,
    extract: (m) => ({
      enterprise: m[2],
      site: m[3],
      area: m[4],
      machine: m[5],
      device: m[5]
    })
  },

  // KPI metrics (abelara/MES systems)
  {
    name: 'kpi_metric',
    match: /^(\w+)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/KPIs\/(\w+)$/,
    type: 'production_metric',
    extract: (m) => ({
      enterprise: m[2],
      site: m[3],
      area: m[4],
      machine: m[5] + '/' + m[6],
      device: m[7],
      metric: m[7]
    })
  },

  // Generic: Status values (Level, Temp, Speed, Weight, etc)
  {
    name: 'status_value',
    match: /^(Enterprise [^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/Status\/(\w+)$/,
    type: 'process_variable',
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      area: m[3],
      machine: m[4],
      device: m[5],
      metric: m[6]
    })
  },

  // Generic: Edge/raw sensor data
  {
    name: 'edge_telemetry',
    match: /^(Enterprise [^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/edge\/(\w+)$/,
    type: 'telemetry',
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      area: m[3],
      machine: m[4],
      device: m[5],
      metric: m[6]
    })
  },

  // Enterprise B: Top-level Node/asset identifiers
  {
    name: 'enterprise_b_node_top',
    match: /^(Enterprise B)\/[Nn]ode\/(.+)$/,
    type: 'equipment_metadata',
    extract: (m) => ({
      enterprise: m[1],
      metric: m[2].replace(/\//g, '_')
    })
  },

  // Enterprise B: Area-level Node/asset identifiers
  {
    name: 'enterprise_b_node_area',
    match: /^(Enterprise B)\/([^/]+)\/([^/]+)\/[Nn]ode\/(.+)$/,
    type: 'equipment_metadata',
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      area: m[3],
      metric: m[4].replace(/\//g, '_')
    })
  },

  // Enterprise B: Machine-level Node/asset identifiers
  {
    name: 'enterprise_b_node_machine',
    match: /^(Enterprise B)\/([^/]+)\/([^/]+)\/([^/]+)\/[Nn]ode\/(.+)$/,
    type: 'equipment_metadata',
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      area: m[3],
      machine: m[4],
      metric: m[5].replace(/\//g, '_')
    })
  },

  // Enterprise B: Device-level Node/asset identifiers
  {
    name: 'enterprise_b_node_device',
    match: /^(Enterprise B)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/[Nn]ode\/(.+)$/,
    type: 'equipment_metadata',
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      area: m[3],
      machine: m[4],
      device: m[5],
      metric: m[6].replace(/\//g, '_')
    })
  },

  // Enterprise B: Work order details (machine level)
  {
    name: 'enterprise_b_workorder_machine',
    match: /^(Enterprise B)\/([^/]+)\/([^/]+)\/([^/]+)\/workorder\/(.+)$/,
    type: 'production_metric',
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      area: m[3],
      machine: m[4],
      metric: 'wo_' + m[5].replace(/\//g, '_')
    })
  },

  // Enterprise B: Work order details (device level)
  {
    name: 'enterprise_b_workorder_device',
    match: /^(Enterprise B)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/workorder\/(.+)$/,
    type: 'production_metric',
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      area: m[3],
      machine: m[4],
      device: m[5],
      metric: 'wo_' + m[6].replace(/\//g, '_')
    })
  },

  // Enterprise B: Lot number (any depth)
  {
    name: 'enterprise_b_lotnumber',
    match: /^(Enterprise B)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/lotnumber\/(.+)$/,
    type: 'production_metric',
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      area: m[3],
      machine: m[4],
      device: m[5],
      metric: 'lot_' + m[6].replace(/\//g, '_')
    })
  },

  // Enterprise B: Tank state
  {
    name: 'enterprise_b_tank_state',
    match: /^(Enterprise B)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/state$/,
    type: 'equipment_state',
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      area: m[3],
      machine: m[4],
      device: m[5],
      metric: 'state'
    })
  },

  // Generic: Description/config
  {
    name: 'description',
    match: /^(Enterprise [^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/Description$/,
    type: 'equipment_config',
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      area: m[3],
      machine: m[4],
      device: m[5]
    })
  },

  // Enterprise B: Top-level metadata (with fanOut for virtual_devices)
  {
    name: 'enterprise_b_top_metadata',
    match: /^(Enterprise B)\/metadata$/,
    type: 'equipment_metadata',
    extract: (m) => ({
      enterprise: m[1],
      metric: 'metadata'
    }),
    // Fan out virtual_devices into separate messages per device
    fanOut: (payload, baseTags) => {
      try {
        const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
        if (!data.virtual_devices) return null;
        
        return Object.entries(data.virtual_devices).map(([name, device]) => ({
          topic: device.topic || `${baseTags.enterprise}/${name}`,
          payload: JSON.stringify({
            device_name: name,
            progress_pct: device.progress_pct,
            data_timestamp: device.data_timestamp,
            updated_at: device.updated_at
          }),
          tags: {
            ...baseTags,
            site: name,
            metric: 'device_status'
          },
          type: 'telemetry'
        }));
      } catch { return null; }
    }
  },

  // Enterprise C: Top-level metadata (with fanOut for virtual_devices)
  {
    name: 'enterprise_c_top_metadata',
    match: /^(Enterprise C)\/metadata$/,
    type: 'equipment_metadata',
    extract: (m) => ({
      enterprise: m[1],
      metric: 'metadata'
    }),
    fanOut: (payload, baseTags) => {
      try {
        const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
        if (!data.virtual_devices) return null;
        
        return Object.entries(data.virtual_devices).map(([name, device]) => ({
          topic: device.topic || `${baseTags.enterprise}/${name}`,
          payload: JSON.stringify({
            device_name: name,
            progress_pct: device.progress_pct,
            data_timestamp: device.data_timestamp,
            updated_at: device.updated_at
          }),
          tags: {
            ...baseTags,
            site: name,
            metric: 'device_status'
          },
          type: 'telemetry'
        }));
      } catch { return null; }
    }
  },

  // Enterprise A: Site time/config
  {
    name: 'enterprise_a_site_time',
    match: /^(Enterprise A)\/([^/]+)\/Site\/(LocalTime|UTC|Timezone|CurrentShift)$/,
    type: 'telemetry',
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      metric: m[3]
    })
  },

  // Enterprise A: Line data (BigQuery, ISO7459, etc)
  {
    name: 'enterprise_a_line_data',
    match: /^(Enterprise A)\/([^/]+)\/([^/]+)\/(\w+)$/,
    type: 'telemetry',
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      machine: m[3],
      metric: m[4]
    })
  },

  // Enterprise B: Roeslein OEE (nested path)
  {
    name: 'enterprise_b_roeslein_oee',
    match: /^(Enterprise B)\/roeslein\/OEE\/(.+)$/,
    type: 'oee',
    extract: (m) => ({
      enterprise: m[1],
      metric: 'roeslein_oee',
      device: m[2].replace(/\//g, '_')
    })
  },

  // Generic: Production counts (Production_*, count/*)
  {
    name: 'production_count',
    match: /^(Enterprise [^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/Production\/(\w+)$/,
    type: 'production_metric',
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      area: m[3],
      machine: m[4],
      device: m[5],
      metric: m[6]
    })
  },

  // Enterprise B: Equipment metadata (string values like machine names)
  {
    name: 'enterprise_b_metadata',
    match: /^(Enterprise B)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)$/,
    type: 'equipment_metadata',
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      area: m[3],
      machine: m[4],
      device: m[5]
    })
  },

  // Enterprise A: Site configuration (ProcessFlow, OperatingSchedule)
  {
    name: 'enterprise_a_site_config',
    match: /^(Enterprise A)\/([^/]+)\/Site\/(ProcessFlow|OperatingSchedule)$/,
    type: 'equipment_config',
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      metric: m[3]
    })
  },

  // Enterprise B: Work order metrics
  {
    name: 'enterprise_b_workorder',
    match: /^(Enterprise B)\/([^/]+)\/([^/]+)\/([^/]+)\/workorder\/(\w+)$/,
    type: 'production_metric',
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      area: m[3],
      machine: m[4],
      metric: 'workorder_' + m[5]
    })
  },

  // Enterprise B: Rate metrics (processdata/rate/instant)
  {
    name: 'enterprise_b_rate',
    match: /^(Enterprise B)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/processdata\/rate\/(\w+)$/,
    type: 'production_metric',
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      area: m[3],
      machine: m[4],
      device: m[5],
      metric: 'rate_' + m[6]
    })
  },

  // Enterprise B: Process input metrics (processdata/input/*)
  {
    name: 'enterprise_b_processdata_input',
    match: /^(Enterprise B)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/processdata\/input\/(\w+)$/,
    type: 'production_metric',
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      area: m[3],
      machine: m[4],
      device: m[5],
      metric: m[6]
    })
  },

  // Enterprise B: Area-level metrics (Site/area/metric/input/...)
  {
    name: 'enterprise_b_area_metric',
    match: /^(Enterprise B)\/([^/]+)\/([^/]+)\/metric\/input\/(\w+)$/,
    type: 'production_metric',
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      area: m[3],
      metric: m[4]
    })
  },

  // Enterprise B: Process data (temperature, pressure, etc)
  {
    name: 'enterprise_b_process',
    match: /^(Enterprise B)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/processdata\/process\/(\w+)$/,
    type: 'process_variable',
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      area: m[3],
      machine: m[4],
      device: m[5],
      metric: m[6]
    })
  },

  // Enterprise C: Sensor readings (tff, sum, chrom, sub - short paths)
  {
    name: 'enterprise_c_sensor',
    match: /^(Enterprise C)\/(tff|sum|chrom|sub)\/([A-Z0-9_-]+)$/i,
    type: 'process_variable',
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      device: m[3],
      metric: m[3]
    })
  },

  // Process variables (PV suffix - temperature, weight, pressure, etc)
  {
    name: 'process_variable_pv',
    match: /^(Enterprise [^/]+)\/([^/]+)\/([A-Z]{2,3}-?\d+-?\d*_PV_?\w*)$/,
    type: 'process_variable',
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      area: m[2],
      machine: m[3].split('_')[0],
      device: m[3]
    })
  },

  // opto22: Environmental/utility I/O (not equipment)
  {
    name: 'opto22_io',
    match: /^(Enterprise [^/]+)\/opto22\/(.+)\/([^/]+)\/([^/]+)$/,
    type: 'io_point',
    extract: (m) => ({
      enterprise: m[1],
      site: 'opto22',
      area: m[2].split('/')[0],
      machine: m[3],
      device: m[4]
    })
  },

  // Motion/Position data (robot positions, axis data)
  {
    name: 'motion_position',
    match: /^(Enterprise [^/]+)\/([^/]+)\/([^/]+)\/(.+)\/(robot_position|axis|position|velocity)_?(\w*)$/i,
    type: 'motion',
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      area: m[3],
      machine: m[4].split('/')[0],
      device: m[4].split('/').pop(),
      metric: m[5] + (m[6] ? '_' + m[6] : '')
    })
  },

  // Infrastructure/Gateway health (ignition, edge gateways)
  {
    name: 'infrastructure',
    match: /^(\w+)\/(infrastructure|gateway|edge)\/([^/]+)\/([^/]+)\/(\w+)$/i,
    type: 'infrastructure',
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      area: m[3],
      machine: m[4],
      device: m[5]
    })
  },
  
  // Sparkplug B: Node data (NDATA)
  {
    name: 'sparkplug_ndata',
    match: /^spBv1\.0\/([^/]+)\/NDATA\/([^/]+)$/,
    type: 'sparkplug',
    protocol: 'sparkplug_b',
    extract: (m) => ({
      enterprise: m[1],
      site: m[2],
      messageType: 'NDATA'
    })
  },
  
  // Sparkplug B: Device data (DDATA) - site-level telemetry
  {
    name: 'sparkplug_ddata',
    match: /^spBv1\.0\/([^/]+)\/DDATA\/([^/]+)\/([^/]+)$/,
    type: 'telemetry',
    protocol: 'sparkplug_b',
    extract: (m) => ({
      enterprise: m[2],
      site: m[3],
      edgeNodeId: m[1],
      messageType: 'DDATA'
    })
  },
  
  // Sparkplug B: STATE messages (plain text, not protobuf)
  {
    name: 'sparkplug_state',
    match: /^spBv1\.0\/STATE\/([^/]+)$/,
    type: 'sparkplug_state',
    protocol: 'sparkplug_b',
    extract: (m) => ({
      nodeId: m[1],
      messageType: 'STATE'
    })
  }
];

// Data types that represent trackable equipment
const EQUIPMENT_STATE_TYPES = ['equipment_state'];

// Data types used for OEE calculations
const OEE_TYPES = ['oee', 'production_metric'];

/**
 * Classify a topic and extract structured tags
 * @param {string} topic - Full MQTT topic
 * @returns {Object} { pattern, type, tags } or null if no match
 */
function classifyTopic(topic) {
  for (const pattern of TOPIC_PATTERNS) {
    const match = topic.match(pattern.match);
    if (match) {
      return {
        pattern: pattern.name,
        type: pattern.type,
        tags: pattern.extract(match),
        hasFanOut: !!pattern.fanOut
      };
    }
  }
  
  // Fallback: basic positional extraction for unknown patterns
  const parts = topic.split('/');
  return {
    pattern: 'unknown',
    type: 'unknown',
    tags: {
      enterprise: parts[0] || 'unknown',
      site: parts[1] || 'unknown',
      area: parts[2] || 'unknown',
      machine: parts[3] || 'unknown',
      device: parts[4] || 'unknown'
    },
    hasFanOut: false
  };
}

/**
 * Fan out a message into multiple messages if pattern supports it
 * @param {string} topic - MQTT topic
 * @param {string} payload - Raw payload (JSON string or value)
 * @returns {Array|null} Array of expanded messages, or null if no fanOut
 */
function fanOutMessage(topic, payload) {
  for (const pattern of TOPIC_PATTERNS) {
    const match = topic.match(pattern.match);
    if (match && pattern.fanOut) {
      const baseTags = pattern.extract(match);
      return pattern.fanOut(payload, baseTags);
    }
  }
  return null;
}

/**
 * Check if topic represents trackable equipment state
 * @param {string} topic 
 * @returns {Object|null} Equipment info if trackable, null otherwise
 */
function getEquipmentState(topic) {
  const classified = classifyTopic(topic);
  if (!EQUIPMENT_STATE_TYPES.includes(classified.type)) return null;
  
  const { tags } = classified;
  // Include machine (line) in key when present to avoid collisions
  const key = tags.machine 
    ? `${tags.enterprise}/${tags.site}/${tags.machine}/${tags.device}`
    : `${tags.enterprise}/${tags.site}/${tags.device}`;
  return { key, field: tags.field, tags };
}

/**
 * Check if topic is OEE-related data
 * @param {string} topic 
 * @returns {Object|null} OEE info if relevant, null otherwise
 */
function getOEEData(topic) {
  const classified = classifyTopic(topic);
  if (!OEE_TYPES.includes(classified.type)) return null;
  
  const { tags, type } = classified;
  return {
    key: `${tags.enterprise}/${tags.site}/${tags.device}`,
    metric: tags.metric,
    type,
    tags
  };
}

/**
 * Get InfluxDB tags for a topic
 * @param {string} topic 
 * @returns {Object} Tags for InfluxDB point
 */
function getInfluxTags(topic) {
  const { tags, type } = classifyTopic(topic);
  return {
    ...tags,
    data_type: type,
    full_topic: topic
  };
}

/**
 * Check if topic is Sparkplug B protocol
 * @param {string} topic 
 * @returns {Object|null} Sparkplug info if match, null otherwise
 */
function getSparkplugInfo(topic) {
  const classified = classifyTopic(topic);
  if (!classified.type.startsWith('sparkplug')) return null;
  
  return {
    isState: classified.type === 'sparkplug_state',
    tags: classified.tags
  };
}

/**
 * Extract value from payload - handles JSON with nested value field
 * Also checks quality field for bad data
 * @param {string} payload - Raw MQTT payload
 * @returns {{ value: string, quality: string|null }} Extracted value and quality
 */
function extractPayloadValue(payload) {
  if (payload.startsWith('{')) {
    try {
      const json = JSON.parse(payload);
      let value = json.value !== undefined ? json.value : payload;
      // Handle abelara nested value object: { value: { Name: 'Running', ... } }
      if (typeof value === 'object' && value !== null && value.Name) {
        value = value.Name;
      }
      const quality = json.quality || null;
      return { value, quality };
    } catch (e) { /* not valid JSON */ }
  }
  return { value: payload, quality: null };
}

/**
 * Normalize a state value to standard status using pattern-specific mapping
 * @param {string} topic - MQTT topic (to find the right state map)
 * @param {string} rawValue - Raw state value from payload
 * @param {string|null} quality - Data quality indicator (Good/Bad/Uncertain)
 * @returns {{ status: string, reason: string }} Normalized status and original reason
 */
function normalizeState(topic, rawValue, quality = null) {
  // Bad quality = unknown status (only explicit 'Bad', not 'Uncertain')
  if (quality === 'Bad') {
    return { status: 'unknown', reason: `${rawValue} (quality: Bad)` };
  }
  
  // Empty/nil values = unknown
  const value = String(rawValue || '').trim();
  if (!value || value === '<nil>' || value === 'null' || value === 'undefined') {
    return { status: 'unknown', reason: '' };
  }
  
  // Find the pattern's inline stateMap (case-insensitive lookup)
  const classified = classifyTopic(topic);
  const pattern = TOPIC_PATTERNS.find(p => p.name === classified.pattern);
  const stateMap = pattern?.stateMap;
  
  if (stateMap) {
    const key = Object.keys(stateMap).find(k => k.toLowerCase() === value.toLowerCase());
    if (key) {
      return { status: stateMap[key], reason: value };
    }
  }
  
  // No mapping found = unknown
  return { status: 'unknown', reason: value };
}

module.exports = {
  classifyTopic,
  fanOutMessage,
  getEquipmentState,
  getOEEData,
  getInfluxTags,
  getSparkplugInfo,
  extractPayloadValue,
  normalizeState,
  TOPIC_PATTERNS,
  EQUIPMENT_STATE_TYPES,
  OEE_TYPES
};

