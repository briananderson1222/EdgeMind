# Phase 5: Agentic AI Module Extraction

**Date:** 2026-01-14
**Status:** ✅ Complete

## Overview

Extracted the Agentic AI functionality from `server.js` into a dedicated module at `lib/ai/index.js`. This phase focuses on isolating Claude AI integration, trend analysis, and CMMS work order automation.

## Changes

### New Module: `lib/ai/index.js` (477 lines)

**Extracted Functions:**
1. `init({ broadcast, cmms, bedrockClient })` - Initialize with runtime dependencies
2. `queryTrends()` - Flux query for 5-minute trend data
3. `summarizeTrends(trends)` - Summarize trends for Claude
4. `buildDomainContext(trends)` - Build enterprise domain context
5. `analyzeTreesWithClaude(trends)` - Send trends to Claude for analysis
6. `extractAffectedEquipment(trends, insight)` - Extract equipment for work orders
7. `processAnomaliesForWorkOrders(insight, trends)` - Create CMMS work orders
8. `runTrendAnalysis()` - Main analysis orchestrator
9. `startAgenticLoop()` - Start the interval-based loop
10. `askClaudeWithContext(question)` - Interactive Claude questions

**Dependencies:**
- AWS Bedrock SDK (`@aws-sdk/client-bedrock-runtime`)
- InfluxDB client (`../influx/client`)
- Configuration (`../config`)
- Domain context (`../domain-context`)
- State management (`../state`)

**Runtime Dependencies (injected via `init`):**
- `broadcastFn` - WebSocket broadcast function
- `cmmsProviderInstance` - CMMS provider instance
- `bedrockClientInstance` - AWS Bedrock client

### Updated: `server.js`

**Lines removed:** ~368 (all Agentic AI functions)
**New lines:** 8 (import + init call)
**Net reduction:** ~360 lines

**Changes:**
1. Added import: `const aiModule = require('./lib/ai')`
2. Initialize AI module in MQTT connect handler:
   ```javascript
   aiModule.init({
     broadcast: broadcastToClients,
     cmms: cmmsProvider,
     bedrockClient
   });
   ```
3. Call `aiModule.startAgenticLoop()` instead of local function
4. Updated WebSocket handler to use `aiModule.askClaudeWithContext()`
5. Updated `/api/trends` endpoint to use `aiModule.queryTrends()`
6. Updated `/api/agent/context` endpoint to use `aiModule.queryTrends()`

## Architecture

### Dependency Injection Pattern

The AI module uses a clean dependency injection pattern to avoid tight coupling:

```javascript
// Runtime dependencies are set via init()
let broadcastFn = null;
let cmmsProviderInstance = null;
let bedrockClientInstance = null;

function init({ broadcast, cmms, bedrockClient }) {
  broadcastFn = broadcast;
  cmmsProviderInstance = cmms;
  bedrockClientInstance = bedrockClient;
}
```

This allows:
- Pure module exports
- Testability (can inject mocks)
- Clear separation of concerns
- No circular dependencies

### Module Flow

```
server.js
  ↓ (calls init with runtime deps)
lib/ai/index.js
  ├── queryTrends() → InfluxDB
  ├── analyzeTreesWithClaude() → AWS Bedrock
  ├── runTrendAnalysis() → orchestrates analysis
  ├── processAnomaliesForWorkOrders() → CMMS
  └── broadcastFn() → WebSocket clients
```

## Benefits

1. **Separation of Concerns**: AI logic isolated from server orchestration
2. **Testability**: Can test AI module independently with mocked dependencies
3. **Maintainability**: All Claude/Bedrock code in one place
4. **Reusability**: AI module can be used by other services
5. **Reduced Complexity**: server.js is ~360 lines smaller

## Testing

✅ Server starts without errors
✅ All imports resolve correctly
✅ AI module initialization succeeds
✅ No duplicate function definitions

## Next Steps (Phase 6+)

Potential future extractions:
- WebSocket handling (`lib/websocket/`)
- API routes (`lib/routes/`)
- Equipment state tracking (`lib/equipment/`)
- Schema discovery (already in `lib/schema/`)

## Files Modified

- `server.js` - Removed AI functions, added AI module integration
- `lib/ai/index.js` - **NEW** - Complete Agentic AI module

## Lines of Code

- Before: `server.js` ~1,640 lines
- After: `server.js` 1,275 lines | `lib/ai/index.js` 477 lines
- Net change: -360 lines in server.js (22% reduction)
