# Manufacturing Process Flow Dashboard

Real-time visualization dashboard for beverage manufacturing operations with MQTT integration.

## Features

- **Real-time Process Visualization** - Filling, Mixing, Packaging, and Palletizing sections
- **Live KPI Monitoring** - OEE, Availability, Performance, Quality metrics
- **MQTT Integration** - 4853+ industrial topics from ProveIT broker
- **P&ID-Style Diagrams** - Professional animated process flows
- **Work Order Tracking** - Real-time production progress
- **Performance Optimized** - 100ms batched updates for smooth 60fps animations

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Start MQTT Proxy Server

The dashboard requires a WebSocket-to-MQTT proxy server (browsers cannot connect directly to TCP MQTT brokers).

**In Terminal 1:**
```bash
node mqtt-proxy-server.js
```

Leave this running. You should see:
```
🌐 MQTT-to-WebSocket Proxy Server
✓ WebSocket server listening on ws://localhost:8083
```

### 3. Start Dashboard

**In Terminal 2 (new window):**
```bash
npm run dev
```

Open browser to `http://localhost:5173/`

## MQTT Configuration

The app connects to ProveIT virtual factory broker:

- **Broker:** virtualfactory.proveit.services
- **Port:** 1883 (TCP) → proxied to 8083 (WebSocket)
- **Username:** proveitreadonly
- **Password:** proveitreadonlypassword

Configuration is in `/src/app/services/mqttConfig.ts`

## Keyboard Shortcuts

- **M** - Open Topic Mapper (scan and map all MQTT topics)
- **D** - Toggle diagnostic mode
- **ESC** - Close panels

## Project Structure

```
├── src/
│   ├── app/
│   │   ├── App.tsx                    # Main application
│   │   ├── components/                # React components
│   │   │   ├── FillingLineSection.tsx
│   │   │   ├── MixingVatSection.tsx
│   │   │   ├── PackagingLineSection.tsx
│   │   │   ├── PalletizingSection.tsx
│   │   │   └── TopicMapper.tsx        # Auto topic discovery
│   │   ├── hooks/                     # Custom React hooks
│   │   │   ├── useMqtt.ts            # MQTT connection
│   │   │   └── useMqttProcessData.ts # Real-time data
│   │   └── services/                  # MQTT services
│   └── styles/                        # Tailwind CSS
├── mqtt-proxy-server.js               # WebSocket proxy server
├── package.json
└── vite.config.ts
```

## Troubleshooting

### "Disconnected" Status

1. Ensure `mqtt-proxy-server.js` is running in a separate terminal
2. Check that port 8083 is not in use by another application
3. Verify firewall allows localhost connections

### No Data Showing

1. Press **M** to open Topic Mapper
2. Wait for it to scan all MQTT topics (~30 seconds)
3. Topic mappings are automatically applied to dashboard sections

### Module Loading Errors

If you see "error loading dynamically imported module":

1. **Hard refresh browser:** Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
2. **Clear browser cache** and reload
3. **Restart dev server:** Ctrl+C, then `npm run dev`
4. **Try incognito/private mode** to rule out cache issues

### Port 8083 Already in Use

```bash
# Find process using port 8083 (Mac/Linux)
lsof -i :8083

# Kill the process
kill -9 <PID>
```

## Building for Production

```bash
npm run build
```

Output will be in `dist/` folder.

**Note:** The MQTT proxy server must be deployed separately on a server accessible to your users.

## Technology Stack

- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool
- **Tailwind CSS v4** - Styling
- **MQTT.js** - MQTT client
- **Recharts** - Data visualization
- **Lucide React** - Icons

---

**Version:** 2.0.0  
**Last Updated:** February 2026