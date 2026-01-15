# Anomaly Filtering Feature

## Overview

This feature adds a simplified anomaly filtering text input that modifies Claude's analysis prompt in real-time. Users can add custom filter rules that Claude will apply when analyzing factory data and identifying anomalies.

## Implementation Details

### Frontend Changes (`index.html`)

**New UI Components:**
- Text input field with placeholder: "Add filter rule (e.g., 'ignore anomalies below 10% deviation')"
- Submit button to apply filters
- Active filter chips displayed as dismissable tags
- Enter key support for quick submission

**New CSS Styles:**
- `.anomaly-filter-control` - Container with magenta accent theme
- `.filter-input` - Styled input field with cyan/magenta border
- `.filter-submit-btn` - Magenta-themed submit button
- `.filter-chip` - Animated chip/tag component for active filters
- `.filter-chip-remove` - Close button with hover effects

**New JavaScript Functions:**
- `addAnomalyFilter()` - Adds filter rule and sends to backend
- `removeAnomalyFilter(index)` - Removes filter and updates backend
- `renderActiveFilters()` - Renders filter chips in UI
- WebSocket message handler for `anomaly_filter_update`

**State Management:**
- Added `anomalyFilters` array to state object
- Syncs filters across all connected clients via WebSocket

### Backend Changes (`server.js`)

**Server State:**
- Added `anomalyFilters` array to `factoryState` object

**WebSocket Handler:**
- Added `update_anomaly_filter` to `VALID_WS_MESSAGE_TYPES` whitelist
- Validates filter array (max 10 filters, 200 chars each)
- Broadcasts filter updates to all connected clients

**Claude Analysis Integration:**
- Modified `analyzeTreesWithClaude()` function
- Appends user-defined filter rules to Claude's prompt when active
- Instructs Claude to modify anomaly detection behavior accordingly

**Security Features:**
- Input validation (string length, array size limits)
- Whitelisted message type
- Sanitization of user input

## Usage Examples

### Example Filter Rules

Users can enter natural language filter rules such as:

1. **Threshold-based filtering:**
   - "Ignore anomalies below 10% deviation"
   - "Only flag critical anomalies above 25% threshold"
   - "Suppress minor fluctuations under 5%"

2. **Time-based filtering:**
   - "Ignore anomalies during startup periods"
   - "Only report sustained anomalies lasting 5+ minutes"
   - "Skip first 10 minutes of shift changes"

3. **Equipment-specific filtering:**
   - "Ignore temperature spikes in Furnace during glass transitions"
   - "Suppress idle state warnings for maintenance equipment"
   - "Focus on Enterprise A glass manufacturing issues only"

4. **Context-aware filtering:**
   - "Ignore OEE drops during scheduled maintenance windows"
   - "Suppress defect count anomalies during product changeovers"
   - "Only report anomalies that impact production output"

### How It Works

1. **User adds filter:**
   - Types rule in input field
   - Presses Enter or clicks "Add Filter"
   - Filter appears as a chip/tag below the input

2. **Filter propagation:**
   - Frontend sends `update_anomaly_filter` WebSocket message
   - Backend validates and stores filters
   - Backend broadcasts to all connected clients
   - All clients update their filter display

3. **Claude analysis:**
   - Backend runs trend analysis every 30 seconds
   - Builds prompt with current factory data
   - If filters exist, appends "User-Defined Anomaly Filter Rules" section
   - Claude applies rules when identifying anomalies
   - Results returned with filtered anomalies

### API Message Format

**Client → Server:**
```json
{
  "type": "update_anomaly_filter",
  "filters": [
    "ignore anomalies below 10% deviation",
    "only report sustained issues"
  ]
}
```

**Server → All Clients:**
```json
{
  "type": "anomaly_filter_update",
  "data": {
    "filters": [
      "ignore anomalies below 10% deviation",
      "only report sustained issues"
    ]
  }
}
```

**Claude Prompt (generated):**
```
You are an AI factory monitoring agent...

## User-Defined Anomaly Filter Rules

Additionally, apply these user-defined rules when identifying anomalies:
1. ignore anomalies below 10% deviation
2. only report sustained issues

These rules should modify your anomaly detection behavior accordingly.

## Your Task
...
```

## Design Decisions

1. **Natural Language Input:**
   - Users can express rules in plain English
   - Claude interprets and applies rules contextually
   - No complex rule syntax or DSL required

2. **Real-time Synchronization:**
   - Filters sync across all connected clients
   - Enables team collaboration on filter rules
   - Server maintains single source of truth

3. **Cyberpunk Theme Integration:**
   - Magenta accent color for filter controls
   - Matches existing cyan/magenta theme
   - Animated chip entry for visual feedback

4. **Security Considerations:**
   - Input length limits (200 chars per filter)
   - Maximum 10 filters allowed
   - Type validation and sanitization
   - Whitelisted WebSocket message types

## Testing

To test the feature:

1. Start the server: `node server.js`
2. Open browser to `http://localhost:3000`
3. Locate "AI Agent Panel" (Edge Minder section)
4. Add a filter rule (e.g., "ignore anomalies below 15%")
5. Watch for Claude's next analysis (30-second interval)
6. Verify anomalies are filtered according to the rule
7. Open a second browser tab to verify filter sync

## Future Enhancements

Potential improvements:

1. **Filter Templates:**
   - Pre-defined common filters as quick-add buttons
   - Industry-specific filter presets

2. **Filter Persistence:**
   - Save filters to database
   - Per-user or per-enterprise filter preferences

3. **Filter Analytics:**
   - Track which filters are most effective
   - Show impact metrics (anomalies filtered/retained)

4. **Advanced Filter Syntax:**
   - Support for AND/OR logic
   - Time-based scheduling (e.g., "only during business hours")
   - Equipment/enterprise targeting

5. **Filter History:**
   - Undo/redo filter changes
   - View filter change audit log

## File Changes Summary

**Modified Files:**
- `/Users/stefanbekker/Projects/edgemind-ope-insights/index.html` - Frontend UI, CSS, and JavaScript
- `/Users/stefanbekker/Projects/edgemind-ope-insights/server.js` - Backend WebSocket handler and Claude integration

**Lines Changed:**
- Frontend: ~150 lines added (HTML structure, CSS styles, JavaScript functions)
- Backend: ~50 lines added (state management, WebSocket handler, prompt modification)

**No Breaking Changes:**
- Feature is additive only
- Existing functionality unchanged
- Backward compatible with clients that don't use filters
