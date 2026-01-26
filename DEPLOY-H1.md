# H1 Deployment Guide: Investigative Insights via Bedrock tool_use

## Quick Deploy to EC2

```bash
# Set SSH variables
SSH_KEY=~/.ssh/edgemind-demo.pem
EC2_HOST=ec2-user@174.129.90.76

# 1. Copy new tools module to EC2
scp -i $SSH_KEY lib/ai/tools.js $EC2_HOST:~/app/lib/ai/
ssh -i $SSH_KEY $EC2_HOST "sudo docker cp ~/app/lib/ai/tools.js edgemind-backend:/app/lib/ai/"

# 2. Copy modified AI module to EC2
scp -i $SSH_KEY lib/ai/index.js $EC2_HOST:~/app/lib/ai/
ssh -i $SSH_KEY $EC2_HOST "sudo docker cp ~/app/lib/ai/index.js edgemind-backend:/app/lib/ai/"

# 3. Restart container to apply changes
ssh -i $SSH_KEY $EC2_HOST "sudo docker restart edgemind-backend"

# 4. Verify health (wait 5s for startup)
ssh -i $SSH_KEY $EC2_HOST "sleep 5 && curl -s http://localhost:3000/health | jq"

# 5. Watch logs for tool usage (Ctrl+C to exit)
ssh -i $SSH_KEY $EC2_HOST "sudo docker logs -f edgemind-backend | grep -E '🔧|✅|Tool'"
```

## What to Look For

### Console Logs
```
🔧 Claude requested 2 tool calls
🔧 Executing tool: get_oee_breakdown with input: {"enterprise":"Enterprise B"}
✅ Tool get_oee_breakdown executed: success=true
🔧 Executing tool: get_equipment_states with input: {"enterprise":"Enterprise B"}
✅ Tool get_equipment_states executed: success=true
✨ Trend Analysis: Enterprise B availability is 72% due to Filler line downtime
```

### WebSocket Messages (Frontend)
Look for insights with `toolCallsUsed` field:
```json
{
  "type": "trend_insight",
  "data": {
    "summary": "Enterprise B availability is 72% due to 4.2 hours unplanned downtime",
    "toolCallsUsed": 2,
    "anomalies": [
      {
        "description": "Enterprise B Filler line DOWN",
        "reasoning": "get_equipment_states showed Filler line in DOWN state...",
        "severity": "high"
      }
    ]
  }
}
```

## Rollback Plan

If issues occur, rollback to previous version:

```bash
# Restore previous AI module (assumes git is clean)
git checkout HEAD~1 lib/ai/index.js
scp -i $SSH_KEY lib/ai/index.js $EC2_HOST:~/app/lib/ai/
ssh -i $SSH_KEY $EC2_HOST "sudo docker cp ~/app/lib/ai/index.js edgemind-backend:/app/lib/ai/ && sudo docker restart edgemind-backend"
```

## Verification Tests

### 1. Health Check
```bash
ssh -i $SSH_KEY $EC2_HOST "curl -s http://localhost:3000/health"
# Expected: {"status": "healthy", "mqtt": "connected", "influxdb": "connected"}
```

### 2. OEE API (Tool Backend)
```bash
ssh -i $SSH_KEY $EC2_HOST "curl -s 'http://localhost:3000/api/oee/v2?enterprise=Enterprise%20B' | jq"
# Expected: { "oee": 72.x, "components": { "availability": 68.x, ... } }
```

### 3. Equipment States (Tool Backend)
```bash
ssh -i $SSH_KEY $EC2_HOST "curl -s http://localhost:3000/api/factory/status | jq '.enterprises[] | select(.name==\"Enterprise B\")'"
# Expected: { "name": "Enterprise B", "oee": 72.x, "sites": [...] }
```

## Troubleshooting

### Issue: Tool calls timeout
**Symptom**: Logs show "Tool call limit reached" or "Exceeded maximum tool calls"
**Fix**: Tools may be slow. Check InfluxDB connection and query performance.

### Issue: Tools return success=false
**Symptom**: `✅ Tool X executed: success=false` in logs
**Cause**: InfluxDB query error or missing data
**Fix**: Check InfluxDB health and data availability for the enterprise

### Issue: Claude doesn't use tools
**Symptom**: No `🔧 Claude requested N tool calls` in logs
**Cause**: Prompt may not be triggering tool use, or metrics look healthy
**Fix**: Expected behavior if all metrics are within thresholds. Tools are only used for anomalies.

### Issue: Container won't start after deployment
**Symptom**: Health check fails
**Cause**: Syntax error or module import issue
**Fix**: Check container logs for Node.js errors:
```bash
ssh -i $SSH_KEY $EC2_HOST "sudo docker logs edgemind-backend --tail=50"
```

## Success Metrics

- ✅ Container restarts successfully
- ✅ Health endpoint returns "healthy"
- ✅ Console logs show "🤖 Starting Agentic Trend Analysis Loop"
- ✅ Within 30s, first trend analysis runs
- ✅ Tool calls appear in logs when anomalies detected
- ✅ Frontend receives insights with investigative details

## Files Changed

- **lib/ai/tools.js** - NEW: Tool definitions and handlers
- **lib/ai/index.js** - MODIFIED: Added tool_use loop to analyzeTreesWithClaude()

## Documentation

- **Implementation notes**: `docs/H1-implementation-notes.md`
- **Decision record**: `.quint/decisions/DRR-2026-01-26-implement-investigative-insights-via-bedrock-tool-use-api.md`
