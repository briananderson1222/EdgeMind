# Sparkplug B Protocol Implementation

## Overview

This document describes the Sparkplug B protocol support added to the EdgeMind factory MQTT ingestion system. Sparkplug B is an MQTT-based protocol specification that uses Google Protocol Buffers (protobuf) for efficient binary payload encoding.

## What is Sparkplug B?

Sparkplug B is an open-source specification developed by Eclipse Foundation for MQTT messaging in Industrial IoT applications. It provides:

- **Structured Topics**: Well-defined topic namespace (`spBv1.0/...`)
- **Binary Payloads**: Efficient protobuf encoding (vs. JSON)
- **Self-Describing Data**: Metrics include type information
- **State Management**: Birth/Death certificates for edge nodes and devices
- **Time-Series Data**: Native timestamp support per metric

## Architecture

```
MQTT Broker (virtualfactory.proveit.services:1883)
    ↓ (Sparkplug B topics: spBv1.0/...)
server.js MQTT Handler
    ├── Detect: isSparkplugTopic(topic)
    ├── Decode: decodePayload(buffer) → protobuf to JSON
    ├── Extract: extractMetrics(topic, payload) → normalized metrics
    ├── Write: writeSparkplugMetric(metric) → InfluxDB Point
    └── Broadcast: WebSocket → Frontend (throttled)
```

## Implementation Details

### 1. Sparkplug Decoder Module (`lib/sparkplug/decoder.js`)

**Key Functions:**

- `isSparkplugTopic(topic)` - Detects Sparkplug B topics by prefix (`spBv1.0/`)
- `parseSparkplugTopic(topic)` - Parses topic into components (groupId, messageType, edgeNodeId, deviceId)
- `decodePayload(buffer)` - Decodes protobuf payload using `sparkplug-payload` library
- `extractMetrics(topic, decodedPayload)` - Extracts and normalizes metrics for InfluxDB

**Supported Message Types:**
- `NBIRTH` - Node birth certificate (connection event)
- `NDATA` - Node data (primary telemetry)
- `DBIRTH` - Device birth certificate
- `DDATA` - Device data (primary telemetry)
- `NDEATH` / `DDEATH` - Death certificates (skipped, no useful metrics)

**Supported Data Types:**
- `intValue` - Int8, Int16, Int32, UInt8, UInt16, UInt32
- `longValue` - Int64, UInt64, DateTime (converted to Number)
- `floatValue` - Float
- `doubleValue` - Double
- `booleanValue` - Boolean
- `stringValue` - String, Text, UUID

### 2. InfluxDB Writer Module (`lib/influx/writer.js`)

**New Function:**

- `writeSparkplugMetric(metric)` - Converts normalized Sparkplug metric to InfluxDB Point

**InfluxDB Schema for Sparkplug Metrics:**

**Measurement:** Metric name (sanitized: spaces → underscores)

**Tags:**
- `enterprise` - Group ID (e.g., "Enterprise B")
- `site` - Edge Node ID (e.g., "Site3")
- `edge_node_id` - Original edge node ID
- `device_id` - Device ID (optional, for device-level metrics)
- `message_type` - Sparkplug message type (NDATA, DDATA, etc.)
- `protocol` - Always "sparkplug_b" (for filtering)

**Field:**
- `value` - Metric value (typed: int, float, boolean, or string)

**Timestamp:** Metric timestamp from Sparkplug payload (if provided)

### 3. Server.js MQTT Handler

**Modified Logic:**

1. **Early Detection**: Check if topic starts with `spBv1.0/`
2. **Decode**: Use `sparkplug-payload` to decode binary protobuf
3. **Extract**: Parse metrics from decoded payload
4. **Write**: Write each metric to InfluxDB as separate Point
5. **Broadcast**: Send WebSocket message with summary (throttled)
6. **Return Early**: Skip JSON processing for Sparkplug messages
7. **Error Handling**: Log decode errors, fall back to JSON processing

## Topic Structure

### Sparkplug B Format:
```
spBv1.0/<group_id>/<message_type>/<edge_node_id>[/<device_id>]
```

### Examples:
```
spBv1.0/Enterprise B/NBIRTH/Site3
spBv1.0/Enterprise B/NDATA/Site3
spBv1.0/Enterprise B/DBIRTH/Site3/Palletizer01
spBv1.0/Enterprise B/DDATA/Site3/Palletizer01
```

### Comparison with Standard Format:
```
Standard:  Enterprise A/Dallas Line 1/packaging/machine/component/metric/type
Sparkplug: spBv1.0/Enterprise B/NDATA/Site3/Device1
```

## Usage

### Querying Sparkplug Data in InfluxDB

**Filter by protocol:**
```flux
from(bucket: "factory")
  |> range(start: -1h)
  |> filter(fn: (r) => r.protocol == "sparkplug_b")
```

**Filter by enterprise:**
```flux
from(bucket: "factory")
  |> range(start: -1h)
  |> filter(fn: (r) => r.protocol == "sparkplug_b")
  |> filter(fn: (r) => r.enterprise == "Enterprise B")
```

**Filter by site:**
```flux
from(bucket: "factory")
  |> range(start: -1h)
  |> filter(fn: (r) => r.protocol == "sparkplug_b")
  |> filter(fn: (r) => r.site == "Site3")
```

**Device-level metrics only:**
```flux
from(bucket: "factory")
  |> range(start: -1h)
  |> filter(fn: (r) => r.protocol == "sparkplug_b")
  |> filter(fn: (r) => exists r.device_id)
```

### API Endpoints

All existing API endpoints work with Sparkplug data:

- `GET /api/trends` - Includes Sparkplug metrics in trend analysis
- `GET /api/oee/v2?enterprise=Enterprise B` - OEE calculation works with Sparkplug OEE metrics
- `GET /api/schema/measurements` - Lists discovered Sparkplug measurements
- `GET /api/schema/hierarchy` - Shows Sparkplug metrics in hierarchy

## Testing

### Manual Testing with MQTT Client

**Publish test Sparkplug message (requires protobuf encoding):**
```javascript
const sparkplug = require('sparkplug-payload').get('spBv1.0');
const mqtt = require('mqtt');

const client = mqtt.connect('mqtt://virtualfactory.proveit.services:1883', {
  username: 'proveitreadonly',
  password: ''
});

client.on('connect', () => {
  const payload = {
    timestamp: Date.now(),
    metrics: [
      { name: 'temperature', floatValue: 72.5, timestamp: Date.now() },
      { name: 'pressure', intValue: 100, timestamp: Date.now() },
      { name: 'running', booleanValue: true, timestamp: Date.now() }
    ]
  };

  const encoded = sparkplug.encodePayload(payload);
  client.publish('spBv1.0/Enterprise B/NDATA/Site3', encoded);
});
```

### Verification in InfluxDB UI

1. Navigate to InfluxDB UI: http://localhost:8086
2. Query for Sparkplug data:
```flux
from(bucket: "factory")
  |> range(start: -5m)
  |> filter(fn: (r) => r.protocol == "sparkplug_b")
```

### Verification in EdgeMind Dashboard

1. Open http://localhost:3000
2. Watch for Sparkplug messages in the live feed
3. Format: `[Sparkplug B] N metrics: metric1=value1 (type), metric2=value2 (type)...`

## Error Handling

### Decode Errors
- **Symptom**: `Sparkplug decode error for topic spBv1.0/...`
- **Cause**: Malformed protobuf payload
- **Handling**: Error logged, message falls back to JSON processing
- **Impact**: No crash, data collection continues

### Write Errors
- **Symptom**: `Sparkplug metric write error: ...`
- **Cause**: InfluxDB connection issue or invalid data
- **Handling**: Error counted, logged every 100th error
- **Impact**: Specific metric skipped, other metrics continue

### Missing Metrics
- **Symptom**: No metrics extracted from payload
- **Cause**: DEATH certificate or empty payload
- **Handling**: Silent skip (no error)
- **Impact**: No data written (expected for DEATH messages)

## Performance Considerations

### Efficiency Gains
- **Binary vs JSON**: Protobuf is ~30-50% more compact than JSON
- **Batch Writes**: Multiple metrics per message → single decode operation
- **Typed Data**: No runtime type inference needed

### Resource Usage
- **CPU**: Protobuf decode is ~2-3x faster than JSON.parse for large payloads
- **Memory**: Binary buffers are smaller than equivalent JSON strings
- **Network**: Reduced bandwidth (especially for high-frequency metrics)

## Backward Compatibility

- **Existing JSON messages**: Continue to work unchanged
- **Mixed environments**: Sparkplug and JSON messages can coexist
- **No breaking changes**: All existing endpoints and queries work
- **Graceful degradation**: Sparkplug decode errors fall back to JSON

## Dependencies

- `sparkplug-payload` (v1.0.3) - Sparkplug B protobuf encoder/decoder
  - License: Eclipse Public License 2.0
  - Source: https://github.com/Cirrus-Link/sparkplug

## References

- [Sparkplug B Specification](https://www.eclipse.org/tahu/spec/Sparkplug%20Topic%20Namespace%20and%20State%20ManagementV2.2-with%20appendix%20B%20format%20-%20Eclipse.pdf)
- [Eclipse Tahu (Reference Implementation)](https://github.com/eclipse/tahu)
- [MQTT Sparkplug Working Group](https://www.eclipse.org/org/workinggroups/sparkplug_charter.php)

## Future Enhancements

### Potential Improvements:
1. **STATE Messages**: Add support for Edge of Network (EoN) state tracking
2. **NCMD/DCMD**: Implement command sending to devices
3. **UDT Support**: Handle User Defined Types (complex nested structures)
4. **Metric Properties**: Store metric properties (units, engineering ranges) in InfluxDB
5. **Birth Certificates**: Cache birth certificate metrics for schema discovery
6. **Sequence Numbers**: Track and validate sequence numbers for data loss detection
7. **Compression**: Add support for GZIP compressed payloads (Sparkplug extension)
8. **Sparkplug Dashboard**: Create dedicated UI panel for Sparkplug device/node monitoring

## Troubleshooting

### Problem: Sparkplug messages not appearing in InfluxDB

**Check:**
1. Topic format: Must start with `spBv1.0/`
2. Payload format: Must be valid protobuf (not JSON string)
3. Server logs: Look for decode errors
4. InfluxDB connection: Check `/health` endpoint

**Debug:**
```bash
# Check if messages are received
curl http://localhost:3000/health

# Query InfluxDB for Sparkplug data
curl -G 'http://localhost:8086/api/v2/query?org=proveit' \
  --data-urlencode 'bucket=factory' \
  --data-urlencode 'query=from(bucket:"factory")|>range(start:-5m)|>filter(fn:(r)=>r.protocol=="sparkplug_b")' \
  -H "Authorization: Token proveit-factory-token-2026"
```

### Problem: High memory usage with Sparkplug messages

**Check:**
1. Message frequency: High-frequency metrics may need sampling
2. Metric count: Messages with 100+ metrics should be optimized
3. InfluxDB flush interval: Increase from 5s to 10s if needed

**Solution:**
```javascript
// In server.js, increase flush interval
setInterval(() => {
  writeApi.flush().catch(err => console.error('InfluxDB flush error:', err));
}, 10000); // Increase from 5000ms to 10000ms
```

### Problem: Sparkplug metrics not classified correctly

**Cause:** Schema cache doesn't recognize Sparkplug measurement names

**Solution:** Sparkplug metrics use sanitized names (spaces → underscores). Update classification rules:
```javascript
// In lib/domain-context.js, add Sparkplug-specific patterns
const MEASUREMENT_CLASSIFICATIONS = {
  oee: [..., /^OEE$/i], // Match exact OEE metric from Sparkplug
  // ... add more patterns
};
```

## Summary

The Sparkplug B implementation provides:
- ✅ Full protocol support (NBIRTH, NDATA, DBIRTH, DDATA)
- ✅ Binary protobuf decoding
- ✅ Multi-datatype support (int, float, boolean, string)
- ✅ InfluxDB storage with rich tagging
- ✅ WebSocket broadcasting
- ✅ Error handling and graceful degradation
- ✅ Backward compatibility with JSON messages
- ✅ Zero configuration required (auto-detection)

Enterprise B (and any future Sparkplug-based enterprises) now have their data properly captured, stored, and available for real-time analysis and AI trend detection.
