# Topic Classifier Debugging Guide

This document describes the process for identifying and fixing unclassified MQTT topics in EdgeMind.

## Prerequisites

- EdgeMind server running locally (`node server.js`)
- InfluxDB running (`docker ps` should show influxdb container)
- WebSocket connection available at `ws://localhost:3000/ws`

## Quick Start

### 1. Check Current Classification Distribution

```bash
cd /Users/anderbs/dev/aws/conference/ProveIt/EdgeMind && node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3000/ws');
let unknowns = new Set();
let total = 0;
let byType = {};
ws.on('message', (data) => {
  const msg = JSON.parse(data);
  if (msg.type === 'mqtt_message') {
    const t = msg.data.type || 'unknown';
    byType[t] = (byType[t] || 0) + 1;
    if (t === 'unknown') unknowns.add(msg.data.topic);
    total++;
    if (total >= 500) {
      console.log('Type distribution:');
      Object.entries(byType).sort((a,b) => b[1]-a[1]).forEach(([k,v]) => {
        console.log('  ' + k + ':', v, '(' + Math.round(v/total*100) + '%)');
      });
      console.log('\nUnknown:', Math.round((byType['unknown']||0)/total*100) + '% (' + unknowns.size + ' unique)');
      if (unknowns.size > 0) Array.from(unknowns).slice(0,5).forEach(t => console.log(' -', t));
      ws.close();
      process.exit(0);
    }
  }
});
setTimeout(() => { ws.close(); process.exit(0); }, 30000);
"
```

### 2. Group Unknown Topics by Pattern

```bash
cd /Users/anderbs/dev/aws/conference/ProveIt/EdgeMind && node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3000/ws');
let unknowns = new Map();
let total = 0;
ws.on('message', (data) => {
  const msg = JSON.parse(data);
  if (msg.type === 'mqtt_message' && msg.data.type === 'unknown') {
    const parts = msg.data.topic.split('/');
    let pattern;
    if (parts.includes('node')) pattern = 'node/*';
    else if (parts.includes('workorder')) pattern = 'workorder/*';
    else if (parts.includes('metric')) pattern = 'metric/*';
    else pattern = parts.slice(-2).join('/');
    unknowns.set(pattern, (unknowns.get(pattern) || 0) + 1);
    total++;
    if (total >= 100) {
      console.log('Unknown patterns:');
      Array.from(unknowns.entries()).sort((a,b) => b[1]-a[1]).slice(0,10).forEach(([k,v]) => {
        console.log('  ' + k + ':', v);
      });
      ws.close();
      process.exit(0);
    }
  }
});
setTimeout(() => { ws.close(); process.exit(0); }, 30000);
"
```

### 3. Test a Specific Topic Against Classifier

```bash
cd /Users/anderbs/dev/aws/conference/ProveIt/EdgeMind && node -e "
const { classifyTopic } = require('./lib/mqtt/topic-classifier');
const topic = 'Enterprise B/Site1/packaging/labelerline01/sealer/metric/oee';
const c = classifyTopic(topic);
console.log(JSON.stringify(c, null, 2));
"
```

### 4. Test Multiple Topics

```bash
cd /Users/anderbs/dev/aws/conference/ProveIt/EdgeMind && node -e "
const { classifyTopic } = require('./lib/mqtt/topic-classifier');
const tests = [
  'Enterprise B/Site1/packaging/labelerline01/sealer/metric/oee',
  'Enterprise A/Dallas/Site/ProcessFlow',
  'abelara/Cappy Hour Inc/Site 1/Packaging/LabelerLine01/Sealer/counts/outfeed'
];
tests.forEach(t => {
  const c = classifyTopic(t);
  console.log(t.split('/').slice(-2).join('/'), '->', c.type, '| metric:', c.tags.metric || 'NONE');
});
"
```

### 5. Query InfluxDB for Topic Patterns

```bash
curl -s --max-time 10 "http://localhost:8086/api/v2/query?org=proveit" \
  -H "Authorization: Token jSbYgL2PWs4GTeH146UaEaTsVuHC8JQN" \
  -H "Content-Type: application/vnd.flux" \
  -d 'from(bucket: "factory") |> range(start: -5m) |> filter(fn: (r) => r.enterprise == "Enterprise B") |> keep(columns: ["full_topic"]) |> distinct() |> limit(n: 20)'
```

## Adding New Patterns

### Pattern Structure

Patterns are defined in `lib/mqtt/topic-classifier.js`:

```javascript
{
  name: 'pattern_name',           // Unique identifier
  match: /^regex_pattern$/,       // Regex to match topic
  type: 'classification_type',    // One of: oee, production_metric, equipment_state, 
                                  // state_metadata, equipment_metadata, equipment_config,
                                  // process_variable, energy, alarm, telemetry, 
                                  // sparkplug, io_point, motion, infrastructure
  extract: (m) => ({              // Function to extract ISA-95 tags from regex groups
    enterprise: m[1],
    site: m[2],
    area: m[3],
    machine: m[4],
    device: m[5],
    metric: m[6]
  })
}
```

### ISA-95 Hierarchy Tags

- `enterprise` - Top-level organization (Enterprise A, Enterprise B, etc.)
- `site` - Physical location (Dallas, Site1, etc.)
- `area` - Production area (packaging, fillerproduction, etc.)
- `machine` - Machine/line (labelerline01, fillingline01, etc.)
- `device` - Specific device (sealer, filler, labeler, etc.)
- `metric` - Measurement name (oee, countoutfeed, temperature, etc.)

### Type to Filter Mapping

Types map to UI filter tabs in `app.js`:

| Backend Type | UI Filter |
|--------------|-----------|
| oee, production_metric | Production |
| equipment_state, state_metadata, equipment_metadata, equipment_config | Equipment |
| process_variable, motion | Process |
| energy | Energy |
| alarm | Alarms |
| telemetry, sparkplug, sparkplug_state, io_point | Telemetry |
| infrastructure, unknown | Other |

## Workflow for New Topics

1. **Identify** - Run distribution check, note unknown percentage
2. **Group** - Run pattern grouping to find common unknown patterns
3. **Analyze** - Pick a sample topic, count segments, identify structure
4. **Add Pattern** - Add regex pattern to `topic-classifier.js`
5. **Test** - Run classifier test on sample topics
6. **Verify Syntax** - `node --check lib/mqtt/topic-classifier.js`
7. **Restart Server** - `pkill -f "node server.js" && node server.js &`
8. **Validate** - Re-run distribution check, confirm unknown % decreased

## Common Pattern Examples

### Enterprise B OEE (device level, 7 segments)
```javascript
match: /^(Enterprise B)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/metric\/(oee|availability|performance|quality)$/
// Enterprise B/Site1/packaging/labelerline01/sealer/metric/oee
```

### Enterprise B OEE (machine level, 6 segments)
```javascript
match: /^(Enterprise B)\/([^/]+)\/([^/]+)\/([^/]+)\/metric\/(oee|availability|performance|quality)$/
// Enterprise B/Site1/liquidprocessing/tankstorage01/metric/oee
```

### Abelara counts (8 segments)
```javascript
match: /^abelara\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/counts\/(\w+)$/
// abelara/Cappy Hour Inc/Site 1/Packaging/LabelerLine01/Sealer/counts/outfeed
```

### Variable depth with .+ (catches remaining path)
```javascript
match: /^(Enterprise B)\/([^/]+)\/([^/]+)\/([^/]+)\/[Nn]ode\/(.+)$/
// Enterprise B/Site1/packaging/labelerline01/node/assetidentifier/displayname
// m[5] = "assetidentifier/displayname"
```

## Troubleshooting

### Pattern not matching?
- Check segment count: `topic.split('/').length`
- Check case sensitivity (use `/i` flag or `[Nn]ode` for mixed case)
- Ensure pattern is placed before more generic patterns (order matters!)

### Server not picking up changes?
```bash
pkill -f "node server.js"
node server.js &
```

### Syntax error in classifier?
```bash
node --check lib/mqtt/topic-classifier.js
```
