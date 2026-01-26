# WebSocket Protocol Reference

EdgeMind uses WebSocket for real-time bidirectional communication between the server and frontend clients.

## Connection

**URL:** `ws://localhost:3000/ws`

**Production:** `ws://<YOUR_EC2_IP>:3000/ws`

**Protocol:** WebSocket (RFC 6455)

**Message Format:** JSON

**Example Connection (JavaScript):**

```javascript
const ws = new WebSocket('ws://localhost:3000/ws');

ws.onopen = () => {
  console.log('Connected to EdgeMind');
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('Received:', message.type, message.data);
};

ws.onclose = () => {
  console.log('Disconnected');
};
```

---

## Server to Client Messages

### initial_state

Sent immediately upon connection. Contains recent messages, insights, anomalies, and current settings.

**Message:**

```json
{
  "type": "initial_state",
  "data": {
    "recentMessages": [
      {
        "timestamp": "2025-01-13T14:30:00.000Z",
        "topic": "Enterprise A/Dallas Line 1/packaging/packager01/OEE/Performance",
        "payload": "85.2",
        "id": "msg_1736778600000_0.123456"
      }
    ],
    "recentInsights": [
      {
        "timestamp": "2025-01-13T14:29:30.000Z",
        "summary": "OEE trending upward across Enterprise A packaging lines",
        "severity": "low",
        "anomalies": [],
        "recommendations": ["Continue monitoring current trends"]
      }
    ],
    "recentAnomalies": [
      {
        "timestamp": "2025-01-13T14:25:00.000Z",
        "description": "Temperature spike detected in Furnace_01",
        "severity": "high",
        "equipment": "Enterprise A/Dallas Line 1/Furnace_01"
      }
    ],
    "stats": {
      "messageCount": 125430,
      "lastUpdate": "2025-01-13T14:30:00.000Z",
      "influxWrites": 125428,
      "influxWriteErrors": 2
    },
    "insightsEnabled": true,
    "anomalyFilters": [
      "ignore anomalies below 10% deviation"
    ],
    "thresholdSettings": {
      "oeeBaseline": 65,
      "oeeWorldClass": 85,
      "availabilityMin": 90,
      "defectRateWarning": 2,
      "defectRateCritical": 5
    }
  }
}
```

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `recentMessages` | array | Last 20 MQTT messages |
| `recentInsights` | array | Last 5 AI-generated insights |
| `recentAnomalies` | array | Last 10 detected anomalies |
| `stats` | object | Server statistics |
| `insightsEnabled` | boolean | Whether AI analysis is enabled |
| `anomalyFilters` | array | Active anomaly filter rules |
| `thresholdSettings` | object | Current threshold configuration |

---

### mqtt_message

Real-time MQTT data broadcast. Throttled to every 10th message to avoid overwhelming clients.

**Message (Standard JSON/Text):**

```json
{
  "type": "mqtt_message",
  "data": {
    "timestamp": "2025-01-13T14:30:00.000Z",
    "topic": "Enterprise A/Dallas Line 1/packaging/packager01/OEE/Performance",
    "payload": "85.2",
    "id": "msg_1736778600000_0.123456"
  }
}
```

**Message (Sparkplug B Protocol):**

```json
{
  "type": "mqtt_message",
  "data": {
    "timestamp": "2025-01-13T14:30:00.000Z",
    "topic": "spBv1.0/FactoryA/DDATA/Edge01/PLC01",
    "payload": "[Sparkplug B] 12 metrics: temperature=85.2 (Float), pressure=14.7 (Float)...",
    "id": "msg_1736778600000_0.123456",
    "protocol": "sparkplug_b"
  }
}
```

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | string | ISO timestamp when message received |
| `topic` | string | MQTT topic path |
| `payload` | string | Message payload (stringified) |
| `id` | string | Unique message identifier |
| `protocol` | string | Optional: "sparkplug_b" for Sparkplug messages |

---

### trend_insight

AI-generated trend analysis. Broadcast every 30 seconds when insights are enabled.

**Message:**

```json
{
  "type": "trend_insight",
  "data": {
    "timestamp": "2025-01-13T14:30:00.000Z",
    "summary": "Enterprise A showing 5% OEE improvement over last hour. Enterprise B packaging line experiencing intermittent quality issues.",
    "severity": "medium",
    "anomalies": [
      {
        "description": "Quality metric dropped 12% on Enterprise B Site3 packaging",
        "equipment": "Enterprise B/Site3/packaging/packager02",
        "confidence": 0.85,
        "recommendedAction": "Inspect packaging seals and calibrate sensors"
      }
    ],
    "recommendations": [
      "Schedule preventive maintenance on Enterprise B packaging line",
      "Continue monitoring Enterprise A positive trend"
    ],
    "factorsAnalyzed": [
      "OEE performance metrics",
      "Equipment state changes",
      "Temperature readings"
    ],
    "toolCallsUsed": 2
  }
}
```

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | string | ISO timestamp when insight was generated |
| `summary` | string | Human-readable trend summary |
| `severity` | string | Severity level (see table below) |
| `anomalies` | array | Detected anomalies with details |
| `recommendations` | array | Suggested actions |
| `factorsAnalyzed` | array | Data categories analyzed |
| `toolCallsUsed` | number | Count of tool calls Claude made during this analysis cycle (0-3) |

**Severity Levels:**

| Level | Description |
|-------|-------------|
| `low` | Informational, no action required |
| `medium` | Notable trend, monitor closely |
| `high` | Anomaly detected, action recommended |
| `critical` | Immediate attention required |

---

### new_measurement

Broadcast when a previously unseen measurement type is detected.

**Message:**

```json
{
  "type": "new_measurement",
  "data": {
    "measurement": "reactor_pressure_PV",
    "topic": "Enterprise C/Bioprocess1/reactor/reactor01/pressure/PV",
    "firstSeen": "2025-01-13T14:30:00.000Z",
    "sampleValue": "14.7",
    "valueType": "numeric",
    "classification": {
      "category": "pressure",
      "confidence": 0.92,
      "pattern": "process_variable"
    }
  }
}
```

---

### equipment_state

Broadcast when equipment state changes (DOWN, IDLE, RUNNING).

**Message:**

```json
{
  "type": "equipment_state",
  "data": {
    "enterprise": "Enterprise A",
    "site": "Dallas Line 1",
    "machine": "Furnace_01",
    "state": 1,
    "stateName": "DOWN",
    "color": "#ff3366",
    "reason": null,
    "lastUpdate": "2025-01-13T14:30:00.000Z",
    "firstSeen": "2025-01-13T14:25:00.000Z",
    "durationMs": 300000,
    "durationFormatted": "5m 0s"
  }
}
```

**State Codes:**

| Code | Name | Color | Description |
|------|------|-------|-------------|
| 1 | DOWN | #ff3366 | Equipment stopped/faulted |
| 2 | IDLE | #ffaa00 | Equipment standby/waiting |
| 3 | RUNNING | #00ff88 | Equipment operating normally |

---

### cmms_work_order_created

Broadcast when Claude AI creates a maintenance work order in CMMS.

**Message:**

```json
{
  "type": "cmms_work_order_created",
  "data": {
    "workOrder": {
      "workOrderId": "wo_123456",
      "workOrderNumber": "WO-2025-001",
      "status": "OPEN",
      "url": "https://app.getmaintainx.com/work-orders/wo_123456"
    },
    "equipment": {
      "enterprise": "Enterprise A",
      "site": "Site 1",
      "machine": "Furnace_01",
      "stateName": "DOWN"
    },
    "anomaly": {
      "summary": "Critical temperature deviation detected",
      "severity": "high",
      "timestamp": "2025-01-13T10:30:00.000Z"
    }
  }
}
```

---

### anomaly_filter_update

Broadcast to all clients when anomaly filter rules are updated.

**Message:**

```json
{
  "type": "anomaly_filter_update",
  "data": {
    "filters": [
      "ignore anomalies below 10% deviation",
      "only report sustained issues lasting 5+ minutes"
    ]
  }
}
```

---

### settings_updated

Broadcast when threshold settings are changed via REST API.

**Message:**

```json
{
  "type": "settings_updated",
  "data": {
    "oeeBaseline": 70,
    "oeeWorldClass": 88,
    "availabilityMin": 92,
    "defectRateWarning": 1.5,
    "defectRateCritical": 4
  }
}
```

---

### stats_response

Response to `get_stats` request.

**Message:**

```json
{
  "type": "stats_response",
  "data": {
    "messageCount": 125430,
    "lastUpdate": "2025-01-13T14:30:00.000Z",
    "influxWrites": 125428,
    "influxWriteErrors": 2
  }
}
```

---

### claude_response

Response to `ask_claude` request.

**Message:**

```json
{
  "type": "claude_response",
  "data": {
    "question": "What's causing the OEE drop on Enterprise A?",
    "answer": "Based on the last 5 minutes of data, the OEE drop on Enterprise A appears to be caused by increased defect rates on the packaging line. The quality metric dropped from 97% to 89% starting at 14:15. I recommend inspecting the packaging seals and verifying sensor calibration."
  }
}
```

---

### error

Error response for invalid requests.

**Message:**

```json
{
  "type": "error",
  "error": "Invalid request format"
}
```

**Common Errors:**

| Error | Cause |
|-------|-------|
| `Invalid request format` | Request is not a valid object |
| `Invalid or missing request type` | Unknown message type |
| `Missing or invalid question` | ask_claude without question |
| `Question too long (max 1000 characters)` | Question exceeds limit |
| `Missing or invalid filters array` | update_anomaly_filter without array |
| `Too many filters (max 10)` | Filter count exceeds limit |
| `Message too large` | Message exceeds 10KB |
| `Invalid JSON format` | Message is not valid JSON |

---

## Client to Server Messages

### get_stats

Request current server statistics.

**Request:**

```json
{
  "type": "get_stats"
}
```

**Response:** `stats_response` message (see above)

**Example:**

```javascript
ws.send(JSON.stringify({ type: 'get_stats' }));
```

---

### ask_claude

Send a question to Claude AI with factory context.

**Request:**

```json
{
  "type": "ask_claude",
  "question": "What's causing the OEE drop on Enterprise A?"
}
```

**Validation:**
- `question` is required
- Maximum 1000 characters

**Response:** `claude_response` message (see above)

**Example:**

```javascript
ws.send(JSON.stringify({
  type: 'ask_claude',
  question: 'What anomalies have you detected in the last hour?'
}));
```

---

### update_anomaly_filter

Update the list of anomaly filter rules. Broadcasts to all connected clients.

**Request:**

```json
{
  "type": "update_anomaly_filter",
  "filters": [
    "ignore anomalies below 10% deviation",
    "only report sustained issues lasting 5+ minutes"
  ]
}
```

**Validation:**
- `filters` must be an array
- Maximum 10 filters
- Each filter maximum 200 characters

**Response:** `anomaly_filter_update` broadcast to all clients

**Example (add filter):**

```javascript
// Get current filters from state
const currentFilters = state.anomalyFilters || [];

// Add new filter
const newFilters = [...currentFilters, 'ignore temperature spikes during startup'];

// Send update
ws.send(JSON.stringify({
  type: 'update_anomaly_filter',
  filters: newFilters
}));
```

**Example (remove filter):**

```javascript
// Remove filter at index 1
const newFilters = state.anomalyFilters.filter((_, i) => i !== 1);

ws.send(JSON.stringify({
  type: 'update_anomaly_filter',
  filters: newFilters
}));
```

---

## Valid Message Types

The server whitelists these client message types:

```javascript
const VALID_WS_MESSAGE_TYPES = [
  'get_stats',
  'ask_claude',
  'update_anomaly_filter'
];
```

Any other message type returns an error.

---

## Security Constraints

| Constraint | Limit |
|------------|-------|
| Maximum message size | 10,000 bytes |
| Maximum question length | 1,000 characters |
| Maximum filter count | 10 |
| Maximum filter length | 200 characters |

---

## Connection Lifecycle

1. **Connect:** Client establishes WebSocket connection to `/ws`
2. **Initial State:** Server immediately sends `initial_state` message
3. **Heartbeat:** No explicit heartbeat; connection monitored by WebSocket protocol
4. **Broadcasts:** Server sends `mqtt_message`, `trend_insight`, etc. as events occur
5. **Requests:** Client sends `get_stats`, `ask_claude`, etc. as needed
6. **Disconnect:** Client closes connection or server shuts down

**Reconnection Strategy (Client):**

```javascript
function connect() {
  const ws = new WebSocket('ws://localhost:3000/ws');

  ws.onclose = () => {
    console.log('Connection lost, reconnecting in 5s...');
    setTimeout(connect, 5000);
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    ws.close();
  };
}

connect();
```

---

## Message Flow Diagrams

### Initial Connection

```
Client                          Server
   |                               |
   |-------- Connect WS ---------->|
   |                               |
   |<------ initial_state ---------|
   |                               |
   |<------ mqtt_message ----------| (every 10th MQTT message)
   |<------ mqtt_message ----------|
   |                               |
   |<------ trend_insight ---------| (every 30 seconds)
   |                               |
```

### Ask Claude

```
Client                          Server                         Claude AI
   |                               |                               |
   |------- ask_claude ----------->|                               |
   |                               |-------- Query InfluxDB ------>|
   |                               |<------- Trend Data -----------|
   |                               |                               |
   |                               |-------- Analyze ------------->|
   |                               |<------- Response -------------|
   |                               |                               |
   |<------ claude_response -------|                               |
   |                               |                               |
```

### Anomaly Filter Update

```
Client A                        Server                         Client B
   |                               |                               |
   |-- update_anomaly_filter ----->|                               |
   |                               |--- Validate & Store           |
   |                               |                               |
   |<-- anomaly_filter_update -----|                               |
   |                               |---- anomaly_filter_update --->|
   |                               |                               |
```

### CMMS Work Order Creation

```
Server                         Claude AI                       CMMS API
   |                               |                               |
   |-------- Trend Analysis ------>|                               |
   |<------- High Severity --------|                               |
   |                               |                               |
   |-------- Create Work Order -------------------------->|
   |<------- Work Order ID --------------------------------|
   |                               |                               |
   |                               |                               |

Server                         Client A                        Client B
   |                               |                               |
   |-- cmms_work_order_created --->|                               |
   |-- cmms_work_order_created --------------------------->|
   |                               |                               |
```
