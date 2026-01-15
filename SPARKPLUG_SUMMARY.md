# Sparkplug B Implementation Summary

## What Was Implemented

Added complete Sparkplug B protocol support to the EdgeMind factory MQTT ingestion system, enabling Enterprise B (and future Sparkplug-based enterprises) to have their data properly captured and stored in InfluxDB.

## Files Created

1. **lib/sparkplug/decoder.js** (190 lines)
   - `isSparkplugTopic()` - Detect Sparkplug B topics
   - `parseSparkplugTopic()` - Parse topic into components
   - `decodePayload()` - Decode protobuf using sparkplug-payload
   - `extractMetrics()` - Extract and normalize metrics

## Files Modified

1. **server.js**
   - Added Sparkplug decoder imports
   - Added early Sparkplug detection in MQTT handler
   - Decode → Extract → Write → Broadcast flow
   - Error handling with graceful fallback

2. **lib/influx/writer.js**
   - Added `writeSparkplugMetric()` function
   - Converts normalized metrics to InfluxDB Points
   - Supports all Sparkplug data types (int, long, float, double, boolean, string)

3. **lib/influx/client.js**
   - Export `writeSparkplugMetric` for use in server.js

4. **package.json**
   - Added `sparkplug-payload` dependency (v1.0.3)

## Documentation Created

1. **docs/SPARKPLUG_B_IMPLEMENTATION.md** - Comprehensive documentation covering:
   - Architecture overview
   - Implementation details
   - Usage examples
   - API queries
   - Error handling
   - Troubleshooting
   - Future enhancements

## How It Works

1. **Detection**: Server detects Sparkplug topics by `spBv1.0/` prefix
2. **Decode**: Binary protobuf payload decoded to JSON structure
3. **Extract**: Metrics normalized with enterprise/site tags
4. **Write**: Each metric written to InfluxDB with protocol tag
5. **Broadcast**: Summary sent to WebSocket clients (throttled)

## Key Features

✅ Full Sparkplug B protocol support (NBIRTH, NDATA, DBIRTH, DDATA)
✅ Binary protobuf decoding with `sparkplug-payload` library
✅ Multi-datatype support (int, long, float, double, boolean, string)
✅ Timestamp preservation from Sparkplug metrics
✅ Rich InfluxDB tagging (enterprise, site, edge_node_id, device_id, protocol)
✅ WebSocket broadcasting to frontend
✅ Error handling with graceful degradation
✅ Backward compatibility (JSON messages still work)
✅ Zero configuration required (auto-detection)

## Testing

```bash
# Verify syntax
node -c server.js
node -c lib/sparkplug/decoder.js
node -c lib/influx/writer.js

# Test decoder
node -e "
const { isSparkplugTopic, parseSparkplugTopic } = require('./lib/sparkplug/decoder');
console.log(isSparkplugTopic('spBv1.0/Enterprise B/NDATA/Site3')); // true
console.log(parseSparkplugTopic('spBv1.0/Enterprise B/NDATA/Site3'));
"

# Start server
npm start
```

## Querying Sparkplug Data

```flux
# All Sparkplug metrics (last hour)
from(bucket: "factory")
  |> range(start: -1h)
  |> filter(fn: (r) => r.protocol == "sparkplug_b")

# Enterprise B only
from(bucket: "factory")
  |> range(start: -1h)
  |> filter(fn: (r) => r.protocol == "sparkplug_b")
  |> filter(fn: (r) => r.enterprise == "Enterprise B")

# Site3 only
from(bucket: "factory")
  |> range(start: -1h)
  |> filter(fn: (r) => r.protocol == "sparkplug_b")
  |> filter(fn: (r) => r.site == "Site3")
```

## Production Deployment

Since lib/ is NOT bind-mounted in the EC2 Docker container, you must:

```bash
# Deploy lib/sparkplug/ to EC2
scp -i ~/.ssh/edgemind-demo.pem -r lib/sparkplug ec2-user@174.129.90.76:~/app/lib/

# Deploy modified lib/influx/writer.js
scp -i ~/.ssh/edgemind-demo.pem lib/influx/writer.js ec2-user@174.129.90.76:~/app/lib/influx/

# Deploy modified lib/influx/client.js
scp -i ~/.ssh/edgemind-demo.pem lib/influx/client.js ec2-user@174.129.90.76:~/app/lib/influx/

# Deploy modified server.js (bind-mounted, auto-reloads)
scp -i ~/.ssh/edgemind-demo.pem server.js ec2-user@174.129.90.76:~/app/

# Copy lib/ into container and restart
ssh -i ~/.ssh/edgemind-demo.pem ec2-user@174.129.90.76 "sudo docker cp ~/app/lib edgemind-backend:/app/ && sudo docker restart edgemind-backend"

# Verify health
ssh -i ~/.ssh/edgemind-demo.pem ec2-user@174.129.90.76 "sleep 5 && curl -s http://localhost:3000/health"
```

## Next Steps

- Monitor server logs for Sparkplug messages
- Query InfluxDB to verify data capture
- Check dashboard for Enterprise B metrics
- Optionally: Add Sparkplug-specific UI visualizations

## References

- Sparkplug B Spec: https://sparkplug.eclipse.org/
- Implementation docs: `docs/SPARKPLUG_B_IMPLEMENTATION.md`
- Eclipse Tahu: https://github.com/eclipse/tahu
