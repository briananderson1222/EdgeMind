# Live Demo Guide

This guide helps presenters demonstrate EdgeMind at the ProveIt! 2026 Conference booth. Follow these talking points and techniques to deliver an effective demo.

## Before the Demo

### Pre-Flight Checklist

1. Verify the dashboard is loading: https://edge-mind.concept-reply-sandbox.com
2. Confirm the "LIVE" badge is green (MQTT connected)
3. Check that data is streaming in the MQTT panel
4. Verify Claude insights are appearing (bottom panel)
5. Have the browser developer console open (F12) for manual triggers if needed

### Backup Plan

If the live system is down:
- Use `factory-command-center.html` as a static mockup
- Explain that the architecture is identical, just not connected to live data

## The Demo Flow (5 Minutes)

### Opening (30 seconds)

> "This is EdgeMind, our Factory Intelligence Command Center. Right now, we're connected LIVE to three virtual factories that ProveIt! Conference is providing - glass manufacturing, beverage bottling, and bioprocessing."

Point to the LIVE badge in the header to establish credibility.

### The Data Stream (1 minute)

> "Every one of these lines is a real MQTT message coming from factory sensors."

Scroll through the MQTT panel and call out specific examples:
- Temperature readings from furnaces
- OEE metrics from production lines
- Equipment states and counters
- AGV positions (if visible)

> "This is streaming at thousands of messages per minute. We're throttling the display to every 10th message so you can actually see it."

### AI Analysis (2 minutes)

> "Here's where it gets interesting. Claude AI is watching this data stream and analyzing patterns every 30 seconds."

Point to the insights panel and highlight any recent insights:

> "See this insight? Claude noticed [describe the actual insight shown]. That's not a hard-coded rule - the AI is understanding trends and making connections."

If an anomaly is shown:
> "This anomaly here - Claude detected something outside normal parameters and flagged it immediately. In production, this could trigger an alert or a work order."

### Enterprise Context (1 minute)

> "The system understands the difference between these three enterprises. Enterprise A is glass manufacturing where furnace temperatures of 2700 F are normal. Enterprise B is beverage bottling where we care about bottles per minute and reject rates. Enterprise C is bioprocessing where pH levels and batch phases are critical."

Click between enterprises to show different data if the UI supports it.

### Close (30 seconds)

> "The entire stack - MQTT ingestion, time-series storage, AI analysis, real-time streaming - runs on about 50 cents a day in API costs. This is production-ready architecture you could scale to an entire manufacturing fleet."

## What to Highlight

### Dashboard Elements

| Element | What to Say |
|---------|-------------|
| LIVE badge | "Real-time connection to the MQTT broker" |
| MQTT stream | "Raw sensor data from the factory floor" |
| Metrics cards | "Aggregated KPIs updated in real-time" |
| OEE display | "Overall Equipment Effectiveness by enterprise" |
| Insights panel | "Claude's analysis of trends and anomalies" |
| Alerts section | "Issues that need attention, prioritized by severity" |

### Technical Depth (for Engineers)

- **InfluxDB**: "Time-series database optimized for industrial data. 5-minute rolling windows with 1-minute aggregates."
- **WebSocket**: "Throttled to every 10th message. In production, you'd tune this based on network capacity."
- **Claude Integration**: "We send trend data, not raw values. Claude analyzes patterns, not noise."

### Business Value (for Executives)

- **Cost**: "Under $5 for the entire conference week"
- **Speed**: "Insights every 30 seconds, not next-day reports"
- **Scalability**: "Same architecture works for 3 factories or 300"
- **No Lock-in**: "Standard protocols - MQTT, InfluxDB, REST APIs"

## Triggering AI Insights Manually

If you need to force a Claude analysis during the demo:

1. Open browser developer console (F12)
2. Go to the Console tab
3. Type: `window.askClaudeQuestion("What anomalies do you see in the current data?")`
4. Press Enter
5. Watch the insights panel for the response

Alternative questions to ask:
- "What is the current OEE status across all enterprises?"
- "Are there any concerning trends in Enterprise A?"
- "Summarize the factory status in one sentence."

## Common Questions and Answers

### Q: Is this real data or simulated?

> "The data is from ProveIt!'s virtual factory simulation, but the architecture and processing are identical to what you'd use in production. Real MQTT, real database, real AI analysis."

### Q: How does it handle scale?

> "MQTT handles millions of messages per day easily. InfluxDB is designed for exactly this workload. For very large deployments, you'd add Kafka as a buffer layer, but the pattern stays the same."

### Q: What about latency?

> "MQTT message to dashboard is under 100 milliseconds. The AI analysis runs every 30 seconds, but that's configurable. In production, you'd tune this based on how quickly you need to react."

### Q: How much does the AI cost?

> "About 50 cents per day at this analysis frequency. The model we use (Claude Haiku) is optimized for speed and cost. For deeper analysis, you could upgrade to a larger model."

### Q: Can it integrate with our existing systems?

> "MQTT is a universal protocol - most PLCs and SCADA systems can publish to it. InfluxDB has connectors for everything. The AI layer is just API calls. Integration is straightforward."

### Q: What about security?

> "This demo uses read-only credentials. In production, you'd add authentication, TLS encryption, and network segmentation. The architecture supports all of that."

### Q: Does it work offline?

> "The dashboard needs connectivity to the backend, but the backend can buffer data during connectivity issues. InfluxDB handles backfill gracefully."

## Troubleshooting During Demo

### Dashboard shows "Disconnected"

1. Check ECS service is running (CloudWatch logs or AWS console)
2. Verify https://edge-mind.concept-reply-sandbox.com/health returns OK
3. Hard refresh the browser (Ctrl+Shift+R)

### No MQTT data streaming

1. Check health endpoint: `curl https://edge-mind.concept-reply-sandbox.com/health`
2. Verify MQTT connection status in response
3. May need to restart the container

### Claude insights not appearing

1. Check that AWS credentials are configured on the server (Bedrock access)
2. Look at server logs for API errors
3. Manually trigger an insight via console

### Dashboard is slow

1. Too much historical data - refresh the page
2. Network congestion - switch to mobile hotspot
3. Browser overloaded - close other tabs

## After the Demo

### Capture Feedback

Note any questions you couldn't answer for follow-up.

### Collect Contacts

EdgeMind makes a strong impression. Have a way to capture interested contacts.

### Document Issues

If anything went wrong during the demo, document it for the team to fix.

## Related Pages

- [[ProveIt-2026-Overview]] - Conference context and system overview
- [[Factory-Enterprises-Explained]] - Deep dive into each enterprise
- [[Quick-Start]] - Setup instructions for local development
