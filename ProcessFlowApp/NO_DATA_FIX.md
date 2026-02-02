# No Data Showing - Troubleshooting Guide ✅

## Current Situation

You're seeing:
- ✅ Proxy server connects to broker
- ✅ Data is flowing (6.3MB received!)
- ❌ But dashboard shows no data
- ❌ WebSocket closes with code 1001

## What I Fixed

### 1. **Re-enabled Auto-Reconnect**
Changed `reconnectPeriod: 0` → `reconnectPeriod: 5000`

This was preventing the connection from staying alive!

### 2. **Added Data Flow Diagnostic**
New diagnostic panel shows real-time data flow

### 3. **Improved Logging**
Strategic logging to see connection status

## How to Test

### Step 1: Restart Everything

**Terminal 1: Stop and restart proxy**
```bash
# Ctrl+C to stop, then:
node mqtt-proxy-server.js
```

**Terminal 2: Stop and restart dashboard**
```bash
# Ctrl+C to stop, then:
npm run dev
```

### Step 2: Open Dashboard with Diagnostic

1. Open browser: `http://localhost:5173/`
2. **Look for diagnostic panel** in bottom-right corner
3. It will show:
   - Connection status
   - Message count (should increment quickly!)
   - Recent topics received

### Step 3: Check Browser Console

Open DevTools (F12) and look for:

```
✅ MQTT CONNECTED SUCCESSFULLY!
📨 MQTT Subscribed to topic: Enterprise B/Site1/#
📥 [fillingLine] Data flowing: Enterprise B/Site1/...
🔌 [fillingLine] Connection status: connected
```

### Step 4: Verify Data Flow

The **Data Flow Diagnostic** panel should show:
- ✅ Status: **CONNECTED** (green)
- ✅ Messages Received: **Increasing rapidly** (10-100+/sec)
- ✅ Recent topics: **List of MQTT topics**

## If No Data Shows

### Problem 1: Connection Not Staying Open

**Symptoms:**
- WebSocket closes immediately (Code: 1001)
- Diagnostic shows 0 messages
- Console shows "MQTT Connection closed"

**Fix:**
```bash
# Hard refresh browser
Ctrl+Shift+R (Windows)
Cmd+Shift+R (Mac)
```

### Problem 2: Not Subscribed to Topics

**Symptoms:**
- Connected but no messages
- Diagnostic shows 0 messages
- Console shows no subscribe logs

**Fix:**
1. Press **M** key to open Topic Mapper
2. Wait 30 seconds for scan to complete
3. Mapper will auto-apply subscriptions
4. Close mapper and return to dashboard

### Problem 3: LocalStorage Cache Issue

**Symptoms:**
- Shows "Loading..." forever
- No subscription happening
- Console shows "Enterprise B/Site1/#"

**Fix:**
```javascript
// Open browser console (F12) and run:
localStorage.clear();
location.reload();
```

Then press **M** to run mapper again.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| **X** | Toggle Data Flow Diagnostic |
| **M** | Open Topic Mapper |
| **D** | Toggle Discovery Mode |
| **ESC** | Close panels |

## Expected Console Output

When working correctly, you should see:

```
🔌 MQTT Connection Attempt Started
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ MQTT CONNECTED SUCCESSFULLY!
📨 MQTT Subscribed to topic: Enterprise B/Site1/#
🔌 [fillingLine] Connection status: connected
✅ [fillingLine] MQTT connected - starting data flow
📥 [fillingLine] Data flowing: Enterprise B/Site1/filling...
📥 [fillingLine] Data flowing: Enterprise B/Site1/mixing...
```

## Expected Proxy Output

Your proxy should show:

```
🔗 [2] New connection from ::ffff:127.0.0.1
   Active: 1
✅ [2] Upstream connected
📤 [2] ↑ 86B - CONNECT (buffered)
📥 [2] ↓ 4B - CONNACK
📤 [2] ↑ 32B - SUBSCRIBE
📥 [2] ↓ 5B - SUBACK
📥 [2] ↓ 100B - PUBLISH  (should see many of these!)
📥 [2] ↓ 100B - PUBLISH
📥 [2] ↓ 100B - PUBLISH
```

The key is seeing **PUBLISH** messages flowing continuously!

## Diagnostic Panel Interpretation

### ✅ Healthy Dashboard
```
Status: CONNECTED (green)
Messages Received: 1,247 (and rising!)
Last Topic: Enterprise B/Site1/filling/Line1/oee
Last Value: 0.856
Recent Topics: (20+ different topics)
```

### ❌ Not Working
```
Status: DISCONNECTED (red)
Messages Received: 0
Last Topic: Waiting...
Last Value: Waiting...
Recent Topics: (empty)
```

## Still Not Working?

### Last Resort: Clean Slate

```bash
# 1. Stop everything (Ctrl+C in both terminals)

# 2. Clear browser data
# Open DevTools (F12) → Application → Clear Storage → Clear site data

# 3. Restart proxy
node mqtt-proxy-server.js

# 4. Restart dashboard  
npm run dev

# 5. Open in incognito/private mode
# Chrome: Ctrl+Shift+N
# Firefox: Ctrl+Shift+P
```

## Technical Details

### Why Code 1001?

`WebSocket close code 1001` = "going away" means:
- Client closed the connection
- Usually during page reload or navigation
- Should reconnect automatically with `reconnectPeriod: 5000`

### What Changed?

**Before:**
```typescript
reconnectPeriod: 0  // ❌ Never reconnect
```

**After:**
```typescript
reconnectPeriod: 5000  // ✅ Reconnect every 5 seconds
```

This ensures the connection stays alive!

---

## Quick Test Commands

Open browser console and paste:

```javascript
// Check MQTT connection
console.log('MQTT Connected:', window.localStorage.getItem('mqttTopicCategories'));

// Test subscription
const testSub = () => {
  const mqtt = require('mqtt');
  const client = mqtt.connect('ws://localhost:8083');
  client.on('connect', () => console.log('✅ Connected'));
  client.on('message', (t, p) => console.log('📥', t, p.toString()));
  client.subscribe('Enterprise B/Site1/#');
};
testSub();
```

If this works, the issue is in React state management, not MQTT!
