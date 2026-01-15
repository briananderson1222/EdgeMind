# CMMS Integration Documentation

## Overview

The EdgeMind OPE Insights system now includes automated integration with Computerized Maintenance Management Systems (CMMS). When Claude AI detects high-severity anomalies during trend analysis, the system can automatically create maintenance work orders in your CMMS platform.

## Architecture

The integration uses a pluggable provider architecture:

```
┌─────────────────────┐
│  Claude AI Analysis │
│  (High Severity)    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  CMMS Interface     │  ← Generic contract (lib/cmms-interface.js)
│  (Abstract)         │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  MaintainX Provider │  ← Specific implementation (lib/cmms-maintainx.js)
└─────────────────────┘
```

This design allows easy integration with additional CMMS platforms in the future (Fiix, Limble, UpKeep, etc.).

## Current Implementation: MaintainX

### Features

- Automatic work order creation when Claude detects high-severity anomalies
- Detailed work order descriptions with:
  - Equipment context (enterprise, site, machine)
  - AI-detected anomalies and recommendations
  - Confidence scores and timestamps
- Priority mapping (low/medium/high → LOW/MEDIUM/URGENT)
- Retry logic with exponential backoff
- REST API endpoints for work order management

### Configuration

Add to your `.env` file:

```bash
# Enable CMMS integration
CMMS_ENABLED=true
CMMS_PROVIDER=maintainx

# MaintainX API credentials
MAINTAINX_API_KEY=your_api_key_here
MAINTAINX_BASE_URL=https://api.getmaintainx.com/v1

# Optional: Pre-configure work order defaults
MAINTAINX_DEFAULT_LOCATION_ID=location_123
MAINTAINX_DEFAULT_ASSIGNEE_ID=user_456
```

### Getting Started with MaintainX

1. **Obtain API Key:**
   - Log into your MaintainX account
   - Navigate to Settings > API
   - Generate a new API key
   - Copy the key to `MAINTAINX_API_KEY` in `.env`

2. **Find Location/Assignee IDs (optional):**
   - Use MaintainX API to list locations: `GET /locations`
   - Use MaintainX API to list users: `GET /users`
   - Add these to `.env` to pre-populate work orders

3. **Enable Integration:**
   - Set `CMMS_ENABLED=true` in `.env`
   - Restart the server
   - Monitor logs for: `✅ CMMS provider initialized: MaintainXProvider`

## How It Works

### Automatic Work Order Creation

1. **Trend Analysis Loop** runs every 30 seconds
2. **Claude AI** analyzes factory data and identifies anomalies
3. **Severity Check:** If severity is `high` and anomalies exist:
   - Extract affected equipment from trends and state cache
   - Prioritize equipment in DOWN or IDLE state
   - Create up to 5 work orders per analysis cycle
4. **Work Order Content:**
   - Title: `{Enterprise} - {Site} - {Machine}: {Summary}`
   - Description: Formatted markdown with anomaly details
   - Priority: Mapped from severity (high → URGENT)
   - Custom fields: Source, confidence, equipment identifiers

### Equipment Prioritization

Work orders are created for equipment in this priority order:
1. **DOWN** state (highest priority)
2. **IDLE** state
3. **RUNNING** state
4. **UNKNOWN** state

This ensures critical equipment failures get immediate attention.

### WebSocket Notifications

When work orders are created, clients receive a `cmms_work_order_created` event:

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
      "timestamp": "2025-01-13T10:30:00Z"
    }
  }
}
```

## REST API Endpoints

### List Recent Work Orders
```
GET /api/cmms/work-orders?limit=10
```

**Response:**
```json
{
  "provider": "MaintainXProvider",
  "workOrders": [
    {
      "id": "wo_123456",
      "number": "WO-2025-001",
      "title": "Enterprise A - Site 1 - Furnace: Temperature anomaly",
      "status": "OPEN",
      "priority": "URGENT",
      "createdAt": "2025-01-13T10:30:00Z",
      "assignedTo": "John Doe"
    }
  ],
  "count": 1,
  "timestamp": "2025-01-13T10:35:00Z"
}
```

### Get Work Order Status
```
GET /api/cmms/work-orders/:id
```

**Response:**
```json
{
  "provider": "MaintainXProvider",
  "workOrder": {
    "id": "wo_123456",
    "status": "IN_PROGRESS",
    "assignedTo": "John Doe",
    "updatedAt": "2025-01-13T11:00:00Z",
    "completedAt": null
  },
  "timestamp": "2025-01-13T11:05:00Z"
}
```

### Health Check
```
GET /api/cmms/health
```

**Response:**
```json
{
  "enabled": true,
  "healthy": true,
  "message": "MaintainX connection OK",
  "provider": "MaintainX",
  "baseUrl": "https://api.getmaintainx.com/v1",
  "timestamp": "2025-01-13T10:00:00Z"
}
```

## Adding New CMMS Providers

To integrate a new CMMS platform:

1. **Create Provider Class** in `lib/cmms-{provider}.js`:
   ```javascript
   const { CMmsProvider } = require('./cmms-interface');

   class YourCmmsProvider extends CMmsProvider {
     async createWorkOrder(anomaly, equipment) {
       // Implementation
     }

     async getWorkOrderStatus(workOrderId) {
       // Implementation
     }

     async listRecentWorkOrders(limit) {
       // Implementation
     }

     async healthCheck() {
       // Implementation
     }
   }

   module.exports = YourCmmsProvider;
   ```

2. **Register Provider** in `lib/cmms-interface.js`:
   ```javascript
   const providers = {
     'maintainx': () => require('./cmms-maintainx'),
     'yourcmms': () => require('./cmms-yourcmms'), // Add here
   };
   ```

3. **Update Config** in `server.js`:
   ```javascript
   cmms: {
     yourcmms: {
       apiKey: process.env.YOURCMMS_API_KEY,
       // Provider-specific config
     }
   }
   ```

4. **Update `.env.template`** with new provider variables

## Demo Story

**"Agent that creates work orders when it sees faults"**

1. Factory equipment begins showing anomalous behavior
2. Claude AI detects the pattern during trend analysis
3. Severity is classified as HIGH
4. System identifies affected equipment: "Enterprise A - Site 1 - Furnace_01"
5. Work order automatically created in MaintainX:
   - Title: "Enterprise A - Site 1 - Furnace_01: Critical temperature deviation"
   - Priority: URGENT
   - Description: Full AI analysis with recommendations
6. Maintenance team receives notification in MaintainX
7. Technician responds and resolves the issue
8. Dashboard shows work order status in real-time

## Troubleshooting

### CMMS Integration Not Working

1. **Check Logs:**
   ```bash
   tail -f logs/server.log | grep -i cmms
   ```

2. **Verify Configuration:**
   ```bash
   curl http://localhost:3000/api/cmms/health
   ```

3. **Test Manually:**
   ```javascript
   // In Node.js console
   const { createCmmsProvider } = require('./lib/cmms-interface');
   const provider = createCmmsProvider('maintainx', {
     enabled: true,
     apiKey: 'your_key_here'
   });
   await provider.healthCheck();
   ```

### Work Orders Not Being Created

- Ensure `CMMS_ENABLED=true` in `.env`
- Check that Claude is detecting high-severity anomalies
- Verify equipment state data is available
- Review server logs for error messages

### MaintainX API Errors

- Verify API key is valid and has correct permissions
- Check API rate limits
- Ensure base URL is correct
- Review MaintainX API documentation for field requirements

## Future Enhancements

Potential improvements for future iterations:

- [ ] Manual work order creation via UI
- [ ] Work order status updates via WebSocket
- [ ] Bulk work order operations
- [ ] Custom field mapping configuration
- [ ] Work order templates per enterprise
- [ ] Integration with more CMMS platforms (Fiix, Limble, UpKeep)
- [ ] Work order analytics and reporting
- [ ] Automated work order closure on anomaly resolution

## Support

For questions or issues:
- MaintainX API Docs: https://docs.getmaintainx.com/api
- EdgeMind Support: Contact your EdgeMind representative
