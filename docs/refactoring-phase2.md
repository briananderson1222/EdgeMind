# Phase 2 Refactoring: Schema Discovery Module

## Overview

Extracted the schema discovery functionality from `server.js` into a dedicated module in `lib/schema/`.

## Changes Made

### New Module: `lib/schema/index.js`

**Extracted Functions:**
- `refreshSchemaCache()` - Queries InfluxDB for measurement metadata (counts, types, sample values, enterprise/site distribution)
- `refreshHierarchyCache()` - Queries InfluxDB for hierarchical topic structure (Enterprise → Site → Area → Machine → Measurements)
- `classifyMeasurementDetailed()` - Internal helper function for classifying measurements based on name patterns and value types

**Dependencies:**
- `queryApi` from `../influx/client`
- `schemaCache` from `../state`
- `CONFIG` from `../config`
- `sanitizeInfluxIdentifier` from `../validation`
- `MEASUREMENT_CLASSIFICATIONS` from `../domain-context`

**Internal State:**
- `schemaRefreshInProgress` - Lock variable to prevent concurrent refresh operations

### Updated: `server.js`

**Added Import:**
```javascript
const { refreshSchemaCache, refreshHierarchyCache } = require('./lib/schema');
```

**Removed:**
- Function definition: `classifyMeasurementDetailed()`
- Function definition: `refreshSchemaCache()`
- Function definition: `refreshHierarchyCache()`
- Variable: `schemaRefreshInProgress`
- Entire "SCHEMA DISCOVERY" section (~324 lines)

**Preserved:**
- All 7 function calls to `refreshSchemaCache()` remain unchanged
- All 2 function calls to `refreshHierarchyCache()` remain unchanged

## Function Call Sites (Preserved)

### `refreshSchemaCache()` called at:
1. Line 103 - Startup initialization
2. Line 381 - MQTT message processing (new measurements)
3. Line 1209 - GET `/api/schema/measurements` endpoint
4. Line 1778 - POST `/api/schema/refresh` endpoint (manual refresh)
5. Line 1854 - GET `/api/schema/hierarchy` endpoint

### `refreshHierarchyCache()` called at:
1. Line 1251 - GET `/api/schema/hierarchy` endpoint
2. Line 1773 - POST `/api/schema/refresh` endpoint (manual refresh)

## Testing

- Both files pass syntax validation (`node -c`)
- All function calls remain intact
- No changes to function signatures or behavior

## Benefits

1. Separation of Concerns: Schema discovery logic is isolated from main server logic
2. Maintainability: Easier to locate and modify schema-related code
3. Reusability: Schema functions can be imported by other modules if needed
4. Testability: Schema module can be unit tested independently
5. Code Reduction: Removed ~360 lines from server.js

## Next Steps

Continue Phase 2 refactoring with additional modules:
- OEE calculation module
- Claude integration module
- WebSocket handlers module
- API route handlers module
