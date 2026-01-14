# CMMS Integration and Anomaly Filter

This document covers two interconnected features: automated work order creation via CMMS integration, and the user-defined anomaly filter rules that customize Claude's analysis behavior.

---

## Overview

EdgeMind integrates with Computerized Maintenance Management Systems (CMMS) to automatically create maintenance work orders when Claude AI detects high-severity anomalies. The anomaly filter feature allows operators to customize what Claude flags as anomalous, reducing noise and focusing attention on relevant issues.

**Key Capabilities:**

- Automatic work order creation for high-severity anomalies
- Pluggable CMMS provider architecture (MaintainX implemented)
- Real-time WebSocket notifications of work order creation
- User-defined filter rules that modify Claude's anomaly detection behavior
- Filter rules synchronized across all connected dashboard clients

---

## Architecture

### CMMS Integration Flow

```
┌─────────────────────────────────────────────────────────────┐
│                   Agentic Analysis Loop (30s)               │
│                                                             │
│  InfluxDB Query → Claude Analysis → Anomaly Detection       │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           │ severity === 'high' && anomalies.length > 0
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              processAnomaliesForWorkOrders()                │
│                                                             │
│  1. Extract affected equipment from state cache             │
│  2. Prioritize by state (DOWN > IDLE > RUNNING)            │
│  3. Limit to 5 work orders per cycle                        │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   CMMS Provider Interface                   │
│                  (lib/cmms-interface.js)                    │
│                                                             │
│  abstract class CMmsProvider {                              │
│    createWorkOrder(anomaly, equipment)                      │
│    getWorkOrderStatus(workOrderId)                          │
│    listRecentWorkOrders(limit)                              │
│    healthCheck()                                            │
│  }                                                          │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              MaintainX Provider Implementation              │
│                (lib/cmms-maintainx.js)                      │
│                                                             │
│  - REST API integration with retry logic                    │
│  - Exponential backoff on failure                           │
│  - Severity → Priority mapping                              │
│  - Detailed work order descriptions                         │
└──────────────────────────┬──────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
     MaintainX API              WebSocket Broadcast
     (Work Order Created)       (cmms_work_order_created)
```

### Anomaly Filter Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    Dashboard UI                              │
│                                                             │
│  [Add filter rule: "ignore OEE drops below 5%"] [Submit]    │
│                                                             │
│  Active Filters:                                            │
│  [x] ignore anomalies for Enterprise C                      │
│  [x] focus on temperature metrics only                      │
└──────────────────────────┬──────────────────────────────────┘
                           │ WebSocket: update_anomaly_filter
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Server (server.js)                       │
│                                                             │
│  factoryState.anomalyFilters = [ ... validated rules ... ]  │
│                                                             │
│  Broadcast to all clients: anomaly_filter_update            │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              buildTrendAnalysisPrompt()                     │
│                                                             │
│  ## User-Defined Anomaly Filter Rules                       │
│  1. ignore anomalies for Enterprise C                       │
│  2. focus on temperature metrics only                       │
│                                                             │
│  These rules should modify your anomaly detection           │
│  behavior accordingly.                                      │
└─────────────────────────────────────────────────────────────┘
```

---

## Configuration

### Environment Variables

```bash
# Enable CMMS integration
CMMS_ENABLED=true
CMMS_PROVIDER=maintainx

# MaintainX credentials
MAINTAINX_API_KEY=your_api_key_here
MAINTAINX_BASE_URL=https://api.getmaintainx.com/v1

# Optional: Default work order assignment
MAINTAINX_DEFAULT_LOCATION_ID=location_123
MAINTAINX_DEFAULT_ASSIGNEE_ID=user_456
```

### MaintainX Setup

1. Log into MaintainX and navigate to Settings > API
2. Generate a new API key with work order permissions
3. Copy the key to `MAINTAINX_API_KEY` in your `.env` file
4. Set `CMMS_ENABLED=true`
5. Restart the server

Verify the connection:

```bash
curl http://localhost:3000/api/cmms/health
```

Expected output:

```json
{
  "enabled": true,
  "healthy": true,
  "message": "MaintainX connection OK",
  "provider": "MaintainX"
}
```

---

## API Endpoints

### CMMS Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/cmms/work-orders` | GET | List recent work orders (limit: 1-50) |
| `/api/cmms/work-orders/:id` | GET | Get specific work order status |
| `/api/cmms/health` | GET | Check CMMS provider connectivity |

**List Work Orders:**

```bash
curl "http://localhost:3000/api/cmms/work-orders?limit=5"
```

Response:

```json
{
  "provider": "MaintainXProvider",
  "workOrders": [
    {
      "id": "wo_abc123",
      "number": "WO-2025-001",
      "title": "Enterprise A - Dallas Line 1 - Furnace: Temperature spike detected",
      "status": "OPEN",
      "priority": "URGENT",
      "createdAt": "2025-01-14T10:30:00Z",
      "assignedTo": null
    }
  ],
  "count": 1,
  "timestamp": "2025-01-14T10:35:00Z"
}
```

**Get Work Order Status:**

```bash
curl "http://localhost:3000/api/cmms/work-orders/wo_abc123"
```

---

## WebSocket Messages

### Anomaly Filter Messages

**Client to Server: Update Filters**

```json
{
  "type": "update_anomaly_filter",
  "filters": [
    "ignore anomalies below 10% deviation",
    "focus on Enterprise A only"
  ]
}
```

**Server to All Clients: Filter Update Broadcast**

```json
{
  "type": "anomaly_filter_update",
  "data": {
    "filters": [
      "ignore anomalies below 10% deviation",
      "focus on Enterprise A only"
    ]
  }
}
```

### Work Order Creation Notification

```json
{
  "type": "cmms_work_order_created",
  "data": {
    "workOrder": {
      "workOrderId": "wo_abc123",
      "workOrderNumber": "WO-2025-001",
      "status": "OPEN",
      "url": "https://app.getmaintainx.com/work-orders/wo_abc123"
    },
    "equipment": {
      "enterprise": "Enterprise A",
      "site": "Dallas Line 1",
      "machine": "Furnace_01",
      "area": "forming",
      "stateName": "DOWN"
    },
    "anomaly": {
      "summary": "Critical temperature deviation detected",
      "severity": "high",
      "timestamp": "2025-01-14T10:30:00Z"
    }
  }
}
```

---

## UI Components

### Anomaly Filter Panel

Located in the AI Agent insights section of the dashboard. Allows operators to add natural language rules that modify Claude's anomaly detection behavior.

**Input Field:**
- Maximum 200 characters per rule
- Maximum 10 rules total
- Rules synchronized across all connected clients

**Example Filter Rules:**

```
ignore anomalies below 10% deviation
focus only on temperature and pressure metrics
suppress alerts for Enterprise C during maintenance window
flag any OEE drop greater than 5% as high priority
ignore idle state anomalies for Palletizer machines
```

**How Filters Work:**

Filter rules are injected into Claude's analysis prompt. Claude interprets these natural language instructions and adjusts its anomaly detection accordingly. This is not keyword filtering - it's AI-interpreted guidance.

### Active Filters Display

Active filters appear as removable chips below the input field:

```
[ignore anomalies below 10% deviation ×] [focus on temperature metrics ×]
```

Click the × to remove a filter. Changes propagate to all connected clients immediately.

---

## Work Order Creation Logic

### Trigger Conditions

Work orders are created when ALL of the following are true:

1. `CMMS_ENABLED=true` and provider is initialized
2. Claude analysis returns `severity: "high"`
3. At least one anomaly is present in `insight.anomalies[]`
4. Affected equipment can be identified from state cache

### Equipment Prioritization

When multiple machines are affected, work orders are created in priority order:

| State | Priority | Reason |
|-------|----------|--------|
| DOWN | Highest | Machine is not producing - immediate attention needed |
| IDLE | High | Machine should be running but isn't |
| RUNNING | Medium | Performance degradation detected |
| UNKNOWN | Lowest | State unclear, may be communication issue |

### Rate Limiting

- Maximum 5 work orders per analysis cycle (30 seconds)
- Deduplication by equipment (one work order per machine per cycle)

### Work Order Content

**Title Format:**
```
{Enterprise} - {Site} - {Machine}: {Summary}
```

**Description Includes:**
- Severity level
- Equipment context (enterprise, site, area, machine, current state)
- List of detected issues
- AI-recommended actions
- Confidence score and detection timestamp
- Source attribution (EdgeMind-AI)

---

## Adding New CMMS Providers

The pluggable architecture supports additional CMMS platforms.

### 1. Create Provider Implementation

Create `lib/cmms-{provider}.js`:

```javascript
const { CMmsProvider } = require('./cmms-interface');

class YourCmmsProvider extends CMmsProvider {
  constructor(config) {
    super(config);
    this.apiKey = config.apiKey;
    // Provider-specific initialization
  }

  async createWorkOrder(anomaly, equipment) {
    // Call your CMMS API
    // Return: { workOrderId, workOrderNumber, status, url }
  }

  async getWorkOrderStatus(workOrderId) {
    // Return: { id, status, assignedTo, updatedAt }
  }

  async listRecentWorkOrders(limit = 10) {
    // Return: [{ id, number, title, status, priority, createdAt }]
  }

  async healthCheck() {
    // Return: { healthy: boolean, message: string }
  }
}

module.exports = YourCmmsProvider;
```

### 2. Register Provider

In `lib/cmms-interface.js`, add to the providers registry:

```javascript
const providers = {
  'maintainx': () => {
    const MaintainXProvider = require('./cmms-maintainx');
    return new MaintainXProvider(config);
  },
  'yourcmms': () => {
    const YourCmmsProvider = require('./cmms-yourcmms');
    return new YourCmmsProvider(config);
  }
};
```

### 3. Add Configuration

In `server.js`, add provider config:

```javascript
cmms: {
  enabled: process.env.CMMS_ENABLED === 'true',
  provider: process.env.CMMS_PROVIDER || 'maintainx',
  maintainx: { /* existing config */ },
  yourcmms: {
    apiKey: process.env.YOURCMMS_API_KEY,
    baseUrl: process.env.YOURCMMS_BASE_URL
  }
}
```

---

## Troubleshooting

### CMMS Integration Not Creating Work Orders

**Issue:** High-severity anomalies detected but no work orders created.

**Checks:**

1. Verify CMMS is enabled:
```bash
curl http://localhost:3000/api/cmms/health
```

2. Check server logs for CMMS errors:
```bash
grep -i "cmms\|maintainx\|work order" server.log
```

3. Confirm Claude is detecting high-severity anomalies:
   - Look for `severity: "high"` in trend insights
   - Check that `anomalies` array is not empty

4. Verify equipment state data exists:
   - The system needs equipment state information to create work orders
   - Check `factoryState.equipmentStates` is populated

**Solution:** Ensure all conditions are met. The most common issue is missing equipment state data or the provider not being enabled.

---

### Anomaly Filters Not Working

**Issue:** Filter rules added but Claude still reports filtered anomalies.

**Checks:**

1. Verify filters are synced to server:
   - Open browser console
   - Check for `anomaly_filter_update` WebSocket messages

2. Confirm filter appears in Claude's prompt:
   - Check server logs for "Anomaly filters updated"
   - Look for filter rules in trend analysis debug output

**Solution:** Filters are natural language guidance for Claude, not keyword blocking. Rephrase the filter to be more specific:

```
# Too vague:
"ignore low priority"

# More specific:
"do not flag anomalies where the deviation is less than 10% from normal values"
```

---

### MaintainX API Errors

**Issue:** `MaintainX API error: 401 Unauthorized`

**Cause:** Invalid or expired API key.

**Fix:**
1. Regenerate API key in MaintainX settings
2. Update `MAINTAINX_API_KEY` in `.env`
3. Restart the server

---

**Issue:** `MaintainX API error: 429 Too Many Requests`

**Cause:** Rate limit exceeded.

**Fix:** The provider has built-in retry logic with exponential backoff. If persistent:
1. Reduce analysis frequency (increase `TREND_ANALYSIS_INTERVAL`)
2. Contact MaintainX to increase rate limits

---

## Security Considerations

### Input Validation

- Filter rules are validated for type (string) and length (max 200 chars)
- Maximum 10 filter rules enforced server-side
- Work order IDs validated against pattern `/^[a-zA-Z0-9_-]+$/`
- WebSocket message types whitelisted

### API Key Protection

- API keys stored in environment variables, not code
- Keys never logged or exposed in API responses
- Use read-only API keys where possible

---

## Related Documentation

- [Architecture Overview](./architecture-diagram.md) - System architecture
- [Quality Metrics and Waste Alerts](./quality-metrics-waste-alerts.md) - Quality monitoring
- [CMMS_INTEGRATION.md](../CMMS_INTEGRATION.md) - Detailed CMMS setup guide
