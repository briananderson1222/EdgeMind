# Sparkplug B Data Flow

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                       MQTT Broker                                   │
│           virtualfactory.proveit.services:1883                      │
│                                                                       │
│  Topics:                                                             │
│    - Enterprise A/Site/Area/Machine/...  (JSON)                     │
│    - spBv1.0/Enterprise B/NDATA/Site3    (Sparkplug B)             │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             │ Subscribe('#')
                             │
                             ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    server.js - MQTT Handler                         │
│                                                                       │
│  mqttClient.on('message', (topic, message) => {                     │
│    ┌─────────────────────────────────────────────────┐             │
│    │  1. Topic Detection                             │             │
│    │     isSparkplugTopic(topic)                     │             │
│    │     ├─ YES: spBv1.0/* → Sparkplug flow         │             │
│    │     └─ NO:  Enterprise/* → JSON flow            │             │
│    └─────────────────────────────────────────────────┘             │
│                                                                       │
│  ┌─── Sparkplug B Flow ──────────────────────────┐                 │
│  │                                                 │                 │
│  │  2. Decode Binary Protobuf                     │                 │
│  │     decodePayload(message)                     │                 │
│  │     ↓                                           │                 │
│  │  3. Extract Metrics                            │                 │
│  │     extractMetrics(topic, decodedPayload)      │                 │
│  │     ↓                                           │                 │
│  │  4. Write to InfluxDB (for each metric)        │                 │
│  │     writeSparkplugMetric(metric)               │                 │
│  │     ├─ Point(measurement)                      │                 │
│  │     ├─ .tag('enterprise', ...)                 │                 │
│  │     ├─ .tag('protocol', 'sparkplug_b')         │                 │
│  │     └─ .floatField('value', ...)               │                 │
│  │     ↓                                           │                 │
│  │  5. Broadcast to WebSocket (throttled)         │                 │
│  │     type: 'mqtt_message'                       │                 │
│  │     payload: "[Sparkplug B] N metrics: ..."    │                 │
│  │     ↓                                           │                 │
│  │  6. Return Early (skip JSON processing)        │                 │
│  │                                                 │                 │
│  └─────────────────────────────────────────────────┘                 │
│                                                                       │
│  ┌─── JSON Flow (standard) ─────────────────────┐                  │
│  │                                                │                  │
│  │  2. Parse as string/number                    │                  │
│  │     payload.toString()                        │                  │
│  │     ↓                                          │                  │
│  │  3. Write to InfluxDB                         │                  │
│  │     parseTopicToInflux(topic, payload)        │                  │
│  │     ↓                                          │                  │
│  │  4. Broadcast to WebSocket                    │                  │
│  │                                                │                  │
│  └────────────────────────────────────────────────┘                  │
└───────────────────────────┬───────────────────────────────────────────┘
                            │
                            ↓
        ┌──────────────────────────────────────────┐
        │         InfluxDB                         │
        │      localhost:8086                      │
        │                                          │
        │  Measurements:                           │
        │    - temperature (protocol=sparkplug_b)  │
        │    - pressure (protocol=sparkplug_b)     │
        │    - OEE (protocol=sparkplug_b)          │
        │    - metric_oee (protocol=json)          │
        │                                          │
        │  Tags:                                   │
        │    - enterprise                          │
        │    - site                                │
        │    - edge_node_id (Sparkplug only)       │
        │    - device_id (Sparkplug only)          │
        │    - protocol (sparkplug_b | json)       │
        └──────────────┬───────────────────────────┘
                       │
                       │ Query API
                       │
                       ↓
        ┌──────────────────────────────────────────┐
        │       API Endpoints                      │
        │                                          │
        │  GET /api/trends                         │
        │  GET /api/oee/v2                         │
        │  GET /api/schema/measurements            │
        │  GET /api/schema/hierarchy               │
        │                                          │
        │  All endpoints query both:               │
        │    - protocol=sparkplug_b                │
        │    - protocol=json                       │
        └──────────────┬───────────────────────────┘
                       │
                       │ HTTP/WebSocket
                       │
                       ↓
        ┌──────────────────────────────────────────┐
        │     Frontend Dashboard                   │
        │      index.html + app.js                 │
        │                                          │
        │  - Live MQTT feed                        │
        │  - Sparkplug messages shown as:          │
        │    "[Sparkplug B] 5 metrics: ..."        │
        │  - OEE calculations (all protocols)      │
        │  - Trend insights (all protocols)        │
        └──────────────────────────────────────────┘
```

## Detailed Sparkplug Message Processing

### Example: Sparkplug B NDATA Message

**Input (MQTT):**
```
Topic: spBv1.0/Enterprise B/NDATA/Site3
Payload: <binary protobuf>
  {
    timestamp: 1640000000000,
    seq: 42,
    metrics: [
      { name: "OEE", floatValue: 85.5, timestamp: 1640000000100 },
      { name: "temperature", floatValue: 72.5, timestamp: 1640000000200 },
      { name: "pressure", intValue: 100, timestamp: 1640000000300 },
      { name: "running", booleanValue: true, timestamp: 1640000000400 }
    ]
  }
```

**Processing Steps:**

1. **Detection:**
   ```javascript
   isSparkplugTopic('spBv1.0/Enterprise B/NDATA/Site3') // true
   ```

2. **Decoding:**
   ```javascript
   const decoded = decodePayload(binaryBuffer);
   // Returns: { timestamp: 1640000000000, seq: 42, metrics: [...] }
   ```

3. **Metric Extraction:**
   ```javascript
   const metrics = extractMetrics(topic, decoded);
   // Returns: [
   //   { name: 'OEE', value: 85.5, valueType: 'float', timestamp: Date(...),
   //     tags: { enterprise: 'Enterprise B', site: 'Site3', ... } },
   //   { name: 'temperature', value: 72.5, ... },
   //   { name: 'pressure', value: 100, valueType: 'int', ... },
   //   { name: 'running', value: true, valueType: 'boolean', ... }
   // ]
   ```

4. **InfluxDB Write (per metric):**
   ```javascript
   // For metric: { name: 'OEE', value: 85.5, valueType: 'float', ... }
   const point = new Point('OEE')
     .tag('enterprise', 'Enterprise B')
     .tag('site', 'Site3')
     .tag('edge_node_id', 'Site3')
     .tag('message_type', 'NDATA')
     .tag('protocol', 'sparkplug_b')
     .floatField('value', 85.5)
     .timestamp(Date(1640000000100));
   
   writeApi.writePoint(point);
   ```

5. **WebSocket Broadcast:**
   ```javascript
   {
     type: 'mqtt_message',
     data: {
       timestamp: '2021-12-20T12:00:00.000Z',
       topic: 'spBv1.0/Enterprise B/NDATA/Site3',
       payload: '[Sparkplug B] 4 metrics: OEE=85.5 (float), temperature=72.5 (float), pressure=100 (int), running=true (boolean)',
       id: 'msg_1640000000_0.123',
       protocol: 'sparkplug_b'
     }
   }
   ```

**Output (InfluxDB):**
```
OEE,enterprise=Enterprise\ B,site=Site3,edge_node_id=Site3,message_type=NDATA,protocol=sparkplug_b value=85.5 1640000000100000000
temperature,enterprise=Enterprise\ B,site=Site3,edge_node_id=Site3,message_type=NDATA,protocol=sparkplug_b value=72.5 1640000000200000000
pressure,enterprise=Enterprise\ B,site=Site3,edge_node_id=Site3,message_type=NDATA,protocol=sparkplug_b value=100i 1640000000300000000
running,enterprise=Enterprise\ B,site=Site3,edge_node_id=Site3,message_type=NDATA,protocol=sparkplug_b value=true 1640000000400000000
```

## Query Examples

### Get all Sparkplug metrics for Enterprise B (last hour):
```flux
from(bucket: "factory")
  |> range(start: -1h)
  |> filter(fn: (r) => r.protocol == "sparkplug_b")
  |> filter(fn: (r) => r.enterprise == "Enterprise B")
```

### Get OEE from both protocols:
```flux
from(bucket: "factory")
  |> range(start: -24h)
  |> filter(fn: (r) => r._measurement == "OEE" or r._measurement == "metric_oee")
  |> filter(fn: (r) => r._field == "value")
```

### Compare Sparkplug vs JSON message counts:
```flux
from(bucket: "factory")
  |> range(start: -1h)
  |> group(columns: ["protocol"])
  |> count()
```

## Error Handling Flow

```
MQTT Message Received
    ↓
Topic Detection
    ↓
Is Sparkplug? → NO → Continue to JSON flow
    ↓ YES
    ↓
Try Decode
    ↓
Success? → NO → Log error, fallback to JSON flow
    ↓ YES
    ↓
Extract Metrics
    ↓
For each metric:
    ↓
    Try Write to InfluxDB
        ↓
        Success? → NO → Increment error counter, log every 100th, continue
            ↓ YES
            ↓
        Increment write counter
    ↓
All metrics processed
    ↓
Broadcast to WebSocket (throttled)
    ↓
Return (skip JSON flow)
```

## Performance Characteristics

### Binary Protobuf vs JSON

**Example: 10 metrics**

| Protocol   | Payload Size | Parse Time | Benefits                    |
|------------|--------------|------------|-----------------------------|
| Sparkplug  | ~200 bytes   | ~0.5ms     | Compact, typed, timestamped |
| JSON       | ~600 bytes   | ~1.2ms     | Human-readable              |

**Savings:** ~66% smaller, ~58% faster parsing

### Throughput

- **Single message:** 1-100+ metrics per Sparkplug message
- **Batch write:** All metrics written to InfluxDB in single operation
- **Network:** Reduced bandwidth usage (especially at high frequency)
- **CPU:** Faster protobuf decode vs JSON.parse

## Summary

The Sparkplug B implementation provides:
- ✅ Automatic protocol detection (zero config)
- ✅ Binary protobuf decoding
- ✅ Rich metric tagging
- ✅ Timestamp preservation
- ✅ Error resilience
- ✅ Backward compatibility
- ✅ Performance gains (size + speed)

Enterprise B data flows seamlessly through the system alongside Enterprise A/C JSON data, with all downstream features (OEE, trends, AI analysis) working across both protocols.
