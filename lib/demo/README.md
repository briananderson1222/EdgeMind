# Demo Scenario Engine - API Reference

## Overview

The Demo Scenario Engine enables conference presenters to inject simulated MQTT data for demonstration purposes. All demo data is published to the `concept-reply/` namespace to avoid polluting the real conference data feed.

## Architecture

```
Demo Control Panel (Frontend)
    ↓ HTTP API
Demo Engine (lib/demo/engine.js)
    ↓ MQTT Publish (concept-reply/ namespace)
Server MQTT Handler (server.js)
    ↓ Strips namespace, tags as source="demo-injected"
InfluxDB (tagged for easy deletion)
    ↓ WebSocket
Dashboard (renders with visual indicator)
```

## Modules

### `/lib/demo/profiles.js`
Defines anomaly type profiles with normal ranges and severity multipliers.

Available anomaly types:
- `vibration` - mm/s, normal: 1.5-3.0
- `temperature` - °C, normal: 30-45
- `pressure` - bar, normal: 2.0-3.5
- `torque` - Nm, normal: 10-25
- `efficiency` - %, normal: 85-95

Each profile includes:
- `unit` - Measurement unit
- `normalRange` - [min, max] for normal operation
- `severity` - Peak values for { mild, moderate, severe }
- `publishIntervalMs` - Publish frequency (default: 5000ms)
- `noise` - Random noise amplitude

### `/lib/demo/scenarios.js`
Six pre-configured demo scenarios for conference presentations:

1. **Filler Vibration Anomaly** (4 min) - Bearing degradation detection
2. **Mixing Vat Temperature Drift** (4 min) - Cooling jacket failure
3. **Capper Torque Degradation** (4 min) - Clutch wear prediction
4. **Line Cascade Prevention** (5 min) - Multi-equipment collaboration
5. **Quality Root Cause Analysis** (3 min) - Cross-line defect correlation
6. **Natural Language Interface** (3 min) - UI-only, no data injection

### `/lib/demo/engine.js`
Core execution engine with two main components:

#### ScenarioRunner
- Executes pre-configured scenarios
- Single scenario at a time
- Multi-step with timed delays
- Auto-cleanup after completion

#### InjectionManager
- Ad-hoc anomaly injections
- Up to 3 concurrent injections
- Equipment-based targeting
- Severity-based value generation

## API Endpoints

### Scenario Management

#### `POST /api/demo/scenario/launch`
Start a pre-configured demo scenario.

**Request:**
```json
{
  "scenarioId": "filler-vibration"
}
```

**Response:**
```json
{
  "success": true,
  "status": {
    "active": true,
    "scenario": {
      "id": "filler-vibration",
      "name": "Filler Vibration Anomaly",
      "description": "Real-time detection of bearing degradation on high-speed rotary filler",
      "equipment": "Filler (Asset 23)"
    },
    "timing": {
      "startTime": 1738156800000,
      "elapsedMs": 0,
      "remainingMs": 240000,
      "durationMs": 240000,
      "progress": 0
    },
    "steps": []
  },
  "message": "Scenario \"Filler Vibration Anomaly\" started"
}
```

**Error Cases:**
- `400` - Scenario already running
- `400` - Unknown scenario ID
- `400` - MQTT client not connected

---

#### `POST /api/demo/scenario/stop`
Stop the currently running scenario.

**Request:** Empty body

**Response:**
```json
{
  "success": true,
  "message": "Scenario stopped"
}
```

---

#### `GET /api/demo/scenario/status`
Get current scenario status.

**Response (active):**
```json
{
  "active": true,
  "scenario": {
    "id": "filler-vibration",
    "name": "Filler Vibration Anomaly",
    "description": "Real-time detection of bearing degradation on high-speed rotary filler",
    "equipment": "Filler (Asset 23)"
  },
  "timing": {
    "startTime": 1738156800000,
    "elapsedMs": 45000,
    "remainingMs": 195000,
    "durationMs": 240000,
    "progress": 18.75
  },
  "steps": [
    {
      "topic": "concept-reply/Enterprise B/Site1/fillerproduction/fillingline01/filler/processdata/vibration/level",
      "generator": "ramp",
      "publishCount": 9,
      "elapsedMs": 45000
    }
  ]
}
```

**Response (inactive):**
```json
{
  "active": false,
  "scenario": null
}
```

---

#### `GET /api/demo/scenarios`
List all available demo scenarios.

**Response:**
```json
{
  "scenarios": [
    {
      "id": "filler-vibration",
      "name": "Filler Vibration Anomaly",
      "description": "Real-time detection of bearing degradation on high-speed rotary filler",
      "equipment": "Filler (Asset 23)",
      "durationMs": 240000,
      "durationMinutes": "4.0",
      "stepCount": 2
    }
  ],
  "count": 6
}
```

---

### Ad-hoc Injection Management

#### `POST /api/demo/inject`
Start an ad-hoc anomaly injection.

**Request:**
```json
{
  "equipment": "filler",
  "anomalyType": "vibration",
  "severity": "moderate",
  "durationMs": 180000
}
```

**Valid equipment:** `filler`, `vat01`, `caploader`, `washer`
**Valid anomalyTypes:** `vibration`, `temperature`, `pressure`, `torque`, `efficiency`
**Valid severities:** `mild`, `moderate`, `severe`
**Duration:** 1ms - 600000ms (10 minutes max)

**Response:**
```json
{
  "success": true,
  "injection": {
    "injectionId": "inj_1",
    "equipment": "filler",
    "anomalyType": "vibration",
    "severity": "moderate",
    "topic": "concept-reply/Enterprise B/Site1/fillerproduction/fillingline01/filler/processdata/vibration/level",
    "durationMs": 180000,
    "startTime": 1738156800000
  },
  "message": "Injection started: filler - vibration (moderate)"
}
```

**Error Cases:**
- `400` - Max concurrent injections reached (3)
- `400` - Invalid equipment/anomalyType/severity
- `400` - Duration out of range
- `400` - MQTT client not connected

---

#### `POST /api/demo/inject/stop`
Stop a specific injection.

**Request:**
```json
{
  "injectionId": "inj_1"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Injection inj_1 stopped"
}
```

---

#### `GET /api/demo/inject/status`
Get status of all active injections.

**Response:**
```json
{
  "active": [
    {
      "id": "inj_1",
      "equipment": "filler",
      "anomalyType": "vibration",
      "severity": "moderate",
      "topic": "concept-reply/Enterprise B/Site1/fillerproduction/fillingline01/filler/processdata/vibration/level",
      "publishCount": 12,
      "timing": {
        "startTime": 1738156800000,
        "elapsedMs": 60000,
        "remainingMs": 120000,
        "durationMs": 180000,
        "progress": 33.33
      }
    }
  ],
  "count": 1,
  "maxConcurrent": 3
}
```

---

### Utility Endpoints

#### `POST /api/demo/reset`
Reset demo data and/or stop active scenarios.

**Request:**
```json
{
  "type": "injected-data"
}
```

**Valid types:**
- `injected-data` - Stop injections + delete InfluxDB data with source="demo-injected"
- `all-scenarios` - Stop running scenarios
- `full` - Stop everything + delete all demo data

**Response:**
```json
{
  "success": true,
  "type": "injected-data",
  "results": {
    "scenariosStopped": false,
    "injectionsStopped": true,
    "dataDeleted": true
  },
  "message": "Reset completed: injected-data"
}
```

---

#### `GET /api/demo/profiles`
List all available anomaly profiles.

**Response:**
```json
{
  "profiles": [
    {
      "type": "vibration",
      "unit": "mm/s",
      "normalRange": [1.5, 3.0],
      "severities": ["mild", "moderate", "severe"]
    }
  ],
  "count": 5
}
```

---

## MQTT Topic Namespace

All demo data MUST use the `concept-reply/` namespace prefix:

**Example:**
```
concept-reply/Enterprise B/Site1/fillerproduction/fillingline01/filler/processdata/vibration/level
```

When the server receives this message:
1. Strips the `concept-reply/` prefix
2. Sets `isInjected = true`
3. Processes as normal topic: `Enterprise B/Site1/...`
4. Tags InfluxDB point with `source="demo-injected"`
5. Broadcasts to WebSocket with `isInjected` flag

This allows:
- Easy deletion of demo data (filter by `source` tag)
- Visual indicators in frontend (demo data badge)
- Separation from real conference data

## Value Generators

### Ramp Generator
Linear interpolation from start to end value over duration.

```javascript
{
  generator: 'ramp',
  params: {
    startValue: 2.1,
    endValue: 8.4,
    durationMs: 180000,
    intervalMs: 5000,
    noise: 0.2
  }
}
```

Progress = elapsed / durationMs
Value = startValue + (endValue - startValue) × progress + noise

### Spike Generator
Sharp spike to peak, then gradual decay.

```javascript
{
  generator: 'spike',
  params: {
    startValue: 2.0,
    endValue: 12.0,  // peak
    durationMs: 60000,
    intervalMs: 5000,
    noise: 0.3
  }
}
```

First 10% of duration: rapid rise to peak
Remaining 90%: gradual decay back to start

### Constant Generator
Constant value with noise.

```javascript
{
  generator: 'constant',
  params: {
    value: 5.0,
    intervalMs: 5000,
    noise: 0.2
  }
}
```

## Usage Example

### Running a Full Scenario

```bash
# 1. List available scenarios
curl http://localhost:3000/api/demo/scenarios

# 2. Launch a scenario
curl -X POST http://localhost:3000/api/demo/scenario/launch \
  -H "Content-Type: application/json" \
  -d '{"scenarioId": "filler-vibration"}'

# 3. Check status
curl http://localhost:3000/api/demo/scenario/status

# 4. Stop scenario (or let it auto-complete)
curl -X POST http://localhost:3000/api/demo/scenario/stop
```

### Ad-hoc Anomaly Injection

```bash
# 1. Start injection
curl -X POST http://localhost:3000/api/demo/inject \
  -H "Content-Type: application/json" \
  -d '{
    "equipment": "filler",
    "anomalyType": "vibration",
    "severity": "severe",
    "durationMs": 120000
  }'

# Response: {"success": true, "injection": {"injectionId": "inj_1", ...}}

# 2. Check status
curl http://localhost:3000/api/demo/inject/status

# 3. Stop injection
curl -X POST http://localhost:3000/api/demo/inject/stop \
  -H "Content-Type: application/json" \
  -d '{"injectionId": "inj_1"}'
```

### Reset Demo Data

```bash
# Delete all demo-injected data from InfluxDB
curl -X POST http://localhost:3000/api/demo/reset \
  -H "Content-Type: application/json" \
  -d '{"type": "injected-data"}'
```

## Implementation Notes

### Timer Management
All timers (setTimeout, setInterval) are tracked in arrays and properly cleaned up on stop to prevent memory leaks.

### Concurrency Limits
- **Scenarios:** Only 1 scenario at a time (rejection if attempt to launch while active)
- **Injections:** Up to 3 concurrent injections (configurable via CONFIG.demo.maxConcurrentInjections)

### Auto-Cleanup
- Scenarios auto-stop after `durationMs`
- Injections auto-stop after `durationMs`
- Timers are cleared on stop

### Error Handling
- MQTT publish errors are logged but don't stop the scenario
- Invalid parameters return 400 with descriptive messages
- Server errors return 500

### Logging
Every MQTT publish is logged to console for debugging:
```
[DEMO ENGINE] Published: concept-reply/Enterprise B/.../vibration/level = 3.42
[DEMO ENGINE] Injected: concept-reply/Enterprise B/.../temperature = 52.18 °C
```

## Data Cleanup

Demo data can be deleted from InfluxDB using the `source="demo-injected"` tag predicate:

```flux
// Manual deletion via InfluxDB API
POST http://localhost:8086/api/v2/delete
{
  "org": "proveit",
  "bucket": "factory",
  "start": "2026-01-28T00:00:00Z",
  "stop": "2026-01-30T00:00:00Z",
  "predicate": "source=\"demo-injected\""
}
```

Or use the reset endpoint:
```bash
curl -X POST http://localhost:3000/api/demo/reset \
  -H "Content-Type: application/json" \
  -d '{"type": "injected-data"}'
```
