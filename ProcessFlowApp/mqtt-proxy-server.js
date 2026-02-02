/**
 * MQTT WebSocket Transparent Proxy Server
 * 
 * This is a simple TCP-to-WebSocket bridge that forwards raw MQTT packets
 * with proper WebSocket subprotocol support for MQTT.js compatibility.
 * 
 * SETUP:
 * 1. Install Node.js (https://nodejs.org/)
 * 2. Create a new directory: mkdir mqtt-proxy && cd mqtt-proxy
 * 3. Initialize npm: npm init -y
 * 4. Install dependencies: npm install ws express cors
 * 5. Copy this file to: mqtt-proxy-server.js
 * 6. Run: node mqtt-proxy-server.js
 */

const net = require('net');
const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');

// Configuration
const MQTT_BROKER_HOST = 'virtualfactory.proveit.services';
const MQTT_BROKER_PORT = 1883;
const WEBSOCKET_PORT = 8083;
const HTTP_PORT = 3001;
const DEBUG_PACKETS = false; // Disable for performance - only log important events

// Stats tracking
const stats = {
  totalConnections: 0,
  activeConnections: 0,
  totalBytesUp: 0,
  totalBytesDown: 0,
  startTime: Date.now()
};

// MQTT packet type names for debugging
const MQTT_PACKET_TYPES = {
  1: 'CONNECT',
  2: 'CONNACK',
  3: 'PUBLISH',
  4: 'PUBACK',
  5: 'PUBREC',
  6: 'PUBREL',
  7: 'PUBCOMP',
  8: 'SUBSCRIBE',
  9: 'SUBACK',
  10: 'UNSUBSCRIBE',
  11: 'UNSUBACK',
  12: 'PINGREQ',
  13: 'PINGRESP',
  14: 'DISCONNECT'
};

function parseMqttPacketType(buffer) {
  if (buffer.length === 0) return 'EMPTY';
  const byte1 = buffer[0];
  const packetType = (byte1 >> 4) & 0x0F;
  const flags = byte1 & 0x0F;
  const typeName = MQTT_PACKET_TYPES[packetType] || 'UNKNOWN';
  
  // Parse remaining length to get actual packet size
  let multiplier = 1;
  let value = 0;
  let offset = 1;
  let encodedByte;
  
  do {
    if (offset >= buffer.length) break;
    encodedByte = buffer[offset++];
    value += (encodedByte & 127) * multiplier;
    multiplier *= 128;
  } while ((encodedByte & 128) !== 0);
  
  const packetLength = offset + value;
  
  return `${typeName} (type=${packetType}, flags=0x${flags.toString(16)}, len=${packetLength})`;
}

// Create Express app
const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({
    status: 'running',
    stats: {
      ...stats,
      uptime: Math.floor((Date.now() - stats.startTime) / 1000)
    }
  });
});

app.listen(HTTP_PORT, () => {
  console.log(`📊 HTTP API: http://localhost:${HTTP_PORT}/health`);
});

// Create WebSocket server with MQTT subprotocol support
const wss = new WebSocket.Server({ 
  port: WEBSOCKET_PORT,
  clientTracking: true,
  perMessageDeflate: false, // Must be disabled for MQTT
  handleProtocols: (protocols, request) => {
    // Support MQTT WebSocket subprotocols
    if (protocols.has('mqtt')) return 'mqtt';
    if (protocols.has('mqttv3.1')) return 'mqttv3.1';
    return false; // Accept connection even without subprotocol
  }
});

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🚀 MQTT WebSocket Proxy Server');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`📡 WebSocket: ws://localhost:${WEBSOCKET_PORT}`);
console.log(`🔗 Upstream: ${MQTT_BROKER_HOST}:${MQTT_BROKER_PORT}`);
console.log(`🔍 Debug: ${DEBUG_PACKETS ? 'ON' : 'OFF'}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Handle WebSocket connections
wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  const connectionId = ++stats.totalConnections;
  stats.activeConnections++;
  
  console.log(`\n🔗 [${connectionId}] New connection from ${clientIp}`);
  console.log(`   Protocol: ${ws.protocol || 'none'}`);
  console.log(`   Active: ${stats.activeConnections}`);
  
  // Create TCP connection to MQTT broker
  const tcpClient = new net.Socket();
  tcpClient.setNoDelay(true);
  tcpClient.setKeepAlive(true, 60000);
  
  let tcpConnected = false;
  let bytesUp = 0;
  let bytesDown = 0;
  let wsOpen = true;
  
  // Buffer for messages received before TCP is ready
  const messageBuffer = [];
  
  // Connect to upstream broker
  console.log(`⏳ [${connectionId}] Connecting to upstream...`);
  tcpClient.connect(MQTT_BROKER_PORT, MQTT_BROKER_HOST, () => {
    tcpConnected = true;
    console.log(`✅ [${connectionId}] Upstream connected`);
    
    // Send any buffered messages now that we're connected
    if (messageBuffer.length > 0) {
      console.log(`📦 [${connectionId}] Sending ${messageBuffer.length} buffered messages`);
      messageBuffer.forEach(buffer => {
        const packetInfo = parseMqttPacketType(buffer);
        console.log(`📤 [${connectionId}] ↑ ${buffer.length}B - ${packetInfo} (buffered)`);
        if (DEBUG_PACKETS && buffer.length <= 64) {
          console.log(`   Hex: ${buffer.toString('hex')}`);
        }
        tcpClient.write(buffer);
        bytesUp += buffer.length;
        stats.totalBytesUp += buffer.length;
      });
      messageBuffer.length = 0; // Clear buffer
    }
  });
  
  // Browser -> MQTT Broker
  ws.on('message', (data) => {
    try {
      // Handle different data types
      let buffer;
      if (Buffer.isBuffer(data)) {
        buffer = data;
      } else if (ArrayBuffer.isView(data)) {
        buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      } else if (data instanceof ArrayBuffer) {
        buffer = Buffer.from(data);
      } else if (Array.isArray(data)) {
        // Handle array of buffers
        buffer = Buffer.concat(data.map(d => Buffer.isBuffer(d) ? d : Buffer.from(d)));
      } else {
        buffer = Buffer.from(data);
      }
      
      // If TCP not ready, buffer the message
      if (!tcpConnected || !tcpClient.writable) {
        if (DEBUG_PACKETS) {
          const packetInfo = parseMqttPacketType(buffer);
          console.log(`📦 [${connectionId}] ↑ ${buffer.length}B - ${packetInfo} (buffering...)`);
        }
        messageBuffer.push(buffer);
        return;
      }
      
      // TCP is ready, send immediately (no logging for performance)
      if (DEBUG_PACKETS) {
        const packetInfo = parseMqttPacketType(buffer);
        console.log(`📤 [${connectionId}] ↑ ${buffer.length}B - ${packetInfo}`);
        if (buffer.length <= 64) {
          console.log(`   Hex: ${buffer.toString('hex')}`);
        }
      }
      
      tcpClient.write(buffer);
      bytesUp += buffer.length;
      stats.totalBytesUp += buffer.length;
      
    } catch (error) {
      console.error(`❌ [${connectionId}] Error processing browser message:`, error.message);
    }
  });
  
  // MQTT Broker -> Browser
  tcpClient.on('data', (data) => {
    if (!wsOpen || ws.readyState !== WebSocket.OPEN) {
      if (DEBUG_PACKETS) {
        console.warn(`⚠️ [${connectionId}] Dropped ${data.length}B - WebSocket not open`);
      }
      return;
    }
    
    try {
      // Only log in debug mode for performance
      if (DEBUG_PACKETS) {
        const packetInfo = parseMqttPacketType(data);
        console.log(`📥 [${connectionId}] ↓ ${data.length}B - ${packetInfo}`);
        if (data.length <= 64) {
          console.log(`   Hex: ${data.toString('hex')}`);
        }
      }
      
      // Send as binary WebSocket frame
      ws.send(data, { 
        binary: true,
        compress: false,
        fin: true
      });
      
      bytesDown += data.length;
      stats.totalBytesDown += data.length;
      
    } catch (error) {
      console.error(`❌ [${connectionId}] Error forwarding to browser:`, error.message);
    }
  });
  
  // TCP error handling
  tcpClient.on('error', (error) => {
    console.error(`❌ [${connectionId}] TCP error: ${error.message}`);
    if (wsOpen && ws.readyState === WebSocket.OPEN) {
      ws.close(1011, `TCP error: ${error.message}`);
    }
  });
  
  tcpClient.on('close', (hadError) => {
    tcpConnected = false;
    console.log(`🔌 [${connectionId}] TCP closed ${hadError ? '(error)' : '(clean)'}`);
    if (wsOpen && ws.readyState === WebSocket.OPEN) {
      ws.close(1000);
    }
  });
  
  tcpClient.on('timeout', () => {
    console.log(`⏱️ [${connectionId}] TCP timeout`);
    tcpClient.destroy();
  });
  
  tcpClient.setTimeout(120000);
  
  // WebSocket error handling
  ws.on('error', (error) => {
    console.error(`❌ [${connectionId}] WebSocket error: ${error.message}`);
    wsOpen = false;
    if (tcpConnected) {
      tcpClient.destroy();
    }
  });
  
  ws.on('close', (code, reason) => {
    wsOpen = false;
    stats.activeConnections--;
    console.log(`🔌 [${connectionId}] WebSocket closed`);
    console.log(`   Code: ${code}, Reason: ${reason || 'none'}`);
    console.log(`   Traffic: ↑${bytesUp}B ↓${bytesDown}B`);
    console.log(`   Active: ${stats.activeConnections}`);
    
    if (tcpConnected) {
      tcpClient.destroy();
    }
  });
});

wss.on('error', (error) => {
  console.error('❌ WebSocket server error:', error.message);
});

// Graceful shutdown
function shutdown() {
  console.log('\n👋 Shutting down...');
  console.log(`📊 Stats: ${stats.totalConnections} total, ↑${stats.totalBytesUp}B ↓${stats.totalBytesDown}B`);
  
  wss.close(() => {
    console.log('✅ Closed');
    process.exit(0);
  });
  
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception:', error);
});
process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled rejection:', error);
});