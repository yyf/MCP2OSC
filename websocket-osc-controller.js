/**
 * WebSocket Real-time OSC Control - Plan 3: Live Parameter Control
 */

let WebSocket, WebSocketServer;
try {
  const ws = await import('ws');
  WebSocket = ws.default;
  WebSocketServer = ws.WebSocketServer;
} catch (error) {
  console.warn('⚠️  WebSocket module not available. Install with: npm install ws');
  // Create mock classes to prevent errors
  WebSocket = class MockWebSocket {};
  WebSocketServer = class MockWebSocketServer {
    constructor() {
      throw new Error('WebSocket server not available. Please install ws package: npm install ws');
    }
  };
}

import { createSocket } from 'dgram';

class OSCWebSocketController {
  constructor(port = 8765) {
    this.wss = new WebSocketServer({ port });
    this.clients = new Map(); // clientId -> websocket
    this.oscSockets = new Map(); // destination -> socket
    this.liveParameters = new Map(); // parameterId -> current value
    this.parameterStreams = new Map(); // parameterId -> stream config
  }

  start() {
    this.wss.on('connection', (ws, req) => {
      const clientId = this.generateClientId();
      this.clients.set(clientId, ws);
      
      console.error(`🔗 WebSocket client connected: ${clientId}`);
      
      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());
          await this.handleWebSocketMessage(clientId, message);
        } catch (error) {
          this.sendError(ws, error.message);
        }
      });
      
      ws.on('close', () => {
        this.clients.delete(clientId);
        console.error(`🔌 WebSocket client disconnected: ${clientId}`);
      });
      
      // Send welcome message
      this.sendMessage(ws, {
        type: 'connected',
        clientId,
        timestamp: Date.now()
      });
    });
    
    console.error(`🌐 WebSocket OSC Controller listening on port ${this.wss.options.port}`);
  }

  async handleWebSocketMessage(clientId, message) {
    switch (message.type) {
      case 'osc_send':
        await this.sendOSCMessage(message.address, message.args, message.destination);
        break;
        
      case 'parameter_control':
        await this.updateLiveParameter(message.parameterId, message.value, message.destination);
        break;
        
      case 'start_parameter_stream':
        this.startParameterStream(message.parameterId, message.config);
        break;
        
      case 'stop_parameter_stream':
        this.stopParameterStream(message.parameterId);
        break;
        
      case 'get_live_parameters':
        this.sendParameterStatus(clientId);
        break;
        
      default:
        throw new Error(`Unknown message type: ${message.type}`);
    }
  }

  // Real-time parameter control
  async updateLiveParameter(parameterId, value, destination = 'default') {
    this.liveParameters.set(parameterId, {
      value,
      lastUpdate: Date.now(),
      destination
    });
    
    // Extract OSC address from parameter ID
    const oscAddress = this.parameterIdToOSCAddress(parameterId);
    await this.sendOSCMessage(oscAddress, [value], destination);
    
    // Broadcast to all clients
    this.broadcastToClients({
      type: 'parameter_update',
      parameterId,
      value,
      timestamp: Date.now()
    });
  }

  // Start continuous parameter streaming
  startParameterStream(parameterId, config) {
    const stream = {
      parameterId,
      oscAddress: config.oscAddress,
      destination: config.destination || 'default',
      updateRate: config.updateRate || 60, // Hz
      valueFunction: config.valueFunction || 'linear',
      range: config.range || [0, 1],
      duration: config.duration || null,
      startTime: Date.now(),
      isActive: true
    };
    
    this.parameterStreams.set(parameterId, stream);
    
    // Start update loop
    const interval = 1000 / stream.updateRate;
    stream.intervalId = setInterval(() => {
      this.updateStreamParameter(stream);
    }, interval);
    
    console.error(`🌊 Started parameter stream: ${parameterId} at ${stream.updateRate}Hz`);
  }

  updateStreamParameter(stream) {
    if (!stream.isActive) return;
    
    const elapsed = Date.now() - stream.startTime;
    
    // Stop if duration reached
    if (stream.duration && elapsed >= stream.duration) {
      this.stopParameterStream(stream.parameterId);
      return;
    }
    
    // Calculate value based on function
    let value;
    const progress = stream.duration ? elapsed / stream.duration : elapsed / 1000;
    
    switch (stream.valueFunction) {
      case 'sine':
        value = stream.range[0] + 
                (stream.range[1] - stream.range[0]) * 
                (Math.sin(progress * Math.PI * 2) + 1) / 2;
        break;
      case 'linear':
        value = stream.range[0] + 
                (stream.range[1] - stream.range[0]) * 
                (progress % 1);
        break;
      case 'random':
        value = stream.range[0] + 
                Math.random() * (stream.range[1] - stream.range[0]);
        break;
      default:
        value = stream.range[0];
    }
    
    // Send OSC message
    this.sendOSCMessage(stream.oscAddress, [value], stream.destination);
    
    // Update live parameter
    this.liveParameters.set(stream.parameterId, {
      value,
      lastUpdate: Date.now(),
      destination: stream.destination,
      isStreaming: true
    });
  }

  stopParameterStream(parameterId) {
    const stream = this.parameterStreams.get(parameterId);
    if (stream) {
      stream.isActive = false;
      if (stream.intervalId) {
        clearInterval(stream.intervalId);
      }
      this.parameterStreams.delete(parameterId);
      console.error(`🛑 Stopped parameter stream: ${parameterId}`);
    }
  }

  // Start real-time flush timer
  startRealTimeMode() {
    this.flushTimer = setInterval(() => {
      this.flushMessageQueue();
    }, this.flushInterval);
  }

  // Missing utility methods
  generateClientId() {
    return 'client_' + Math.random().toString(36).substr(2, 9);
  }

  parameterIdToOSCAddress(parameterId) {
    // Convert parameter ID to OSC address
    // e.g., "synth.freq" -> "/synth/freq"
    return '/' + parameterId.replace(/\./g, '/');
  }

  sendMessage(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  sendError(ws, error) {
    this.sendMessage(ws, {
      type: 'error',
      error: error,
      timestamp: Date.now()
    });
  }

  broadcastToClients(message) {
    this.clients.forEach((ws, clientId) => {
      this.sendMessage(ws, message);
    });
  }

  sendParameterStatus(clientId) {
    const ws = this.clients.get(clientId);
    if (ws) {
      this.sendMessage(ws, {
        type: 'parameter_status',
        liveParameters: Object.fromEntries(this.liveParameters),
        activeStreams: Array.from(this.parameterStreams.keys()),
        timestamp: Date.now()
      });
    }
  }

  async sendOSCMessage(address, args, destination = 'default') {
    // Use configured OSC_SEND_PORT or fallback to 9500
    const oscPort = process.env.OSC_SEND_PORT || '9500';
    const oscHost = process.env.OSC_HOST || '127.0.0.1';
    const destinationKey = destination === 'default' ? `${oscHost}:${oscPort}` : destination;
    
    if (!this.oscSockets.has(destinationKey)) {
      const socket = createSocket('udp4');
      this.oscSockets.set(destinationKey, socket);
    }
    
    const socket = this.oscSockets.get(destinationKey);
    const [host, port] = destinationKey.split(':');
    
    try {
      const message = this.createOSCMessage(address, args);
      
      await new Promise((resolve, reject) => {
        socket.send(message, parseInt(port), host, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      
      console.error(`📤 WebSocket OSC sent: ${address} [${args.join(', ')}] → ${host}:${port}`);
    } catch (error) {
      console.error(`❌ WebSocket OSC send failed: ${error.message}`);
      throw error;
    }
  }

  createOSCMessage(address, args) {
    // Simple OSC message creation (reuse from existing system)
    const addressBuffer = Buffer.from(address + '\0');
    const addressPadded = this.padTo4Bytes(addressBuffer);
    
    const typeTagString = ',' + args.map(arg => {
      if (typeof arg === 'number') {
        return Number.isInteger(arg) ? 'i' : 'f';
      } else if (typeof arg === 'boolean') {
        return arg ? 'T' : 'F';
      } else {
        return 's';
      }
    }).join('');
    
    const typeTagBuffer = this.padTo4Bytes(Buffer.from(typeTagString + '\0'));
    
    const argBuffers = args.map(arg => {
      if (typeof arg === 'number') {
        if (Number.isInteger(arg)) {
          const buffer = Buffer.alloc(4);
          buffer.writeInt32BE(arg, 0);
          return buffer;
        } else {
          const buffer = Buffer.alloc(4);
          buffer.writeFloatBE(arg, 0);
          return buffer;
        }
      } else if (typeof arg === 'boolean') {
        return Buffer.alloc(0);
      } else {
        return this.padTo4Bytes(Buffer.from(String(arg) + '\0'));
      }
    });

    return Buffer.concat([addressPadded, typeTagBuffer, ...argBuffers]);
  }

  padTo4Bytes(buffer) {
    const padding = (4 - (buffer.length % 4)) % 4;
    return Buffer.concat([buffer, Buffer.alloc(padding)]);
  }

  handleSocketError(key, error) {
    console.error(`❌ Socket error for ${key}: ${error.message}`);
    this.oscSockets.delete(key);
  }

  // Cleanup method
  stop() {
    // Stop all parameter streams
    this.parameterStreams.forEach((stream, parameterId) => {
      this.stopParameterStream(parameterId);
    });
    
    // Close all OSC sockets
    this.oscSockets.forEach(socket => {
      socket.close();
    });
    this.oscSockets.clear();
    
    // Close WebSocket server
    this.wss.close();
    
    console.error('🛑 WebSocket OSC Controller stopped');
  }

  // MCP Integration - Add new tool for WebSocket control
  async handleMCPWebSocketControl(args) {
    const { action, parameterId, value, streamConfig } = args;
    
    switch (action) {
      case 'set_parameter':
        await this.updateLiveParameter(parameterId, value);
        return { success: true, parameterId, value };
        
      case 'start_stream':
        this.startParameterStream(parameterId, streamConfig);
        return { success: true, parameterId, streaming: true };
        
      case 'stop_stream':
        this.stopParameterStream(parameterId);
        return { success: true, parameterId, streaming: false };
        
      case 'get_status':
        return {
          success: true,
          liveParameters: Object.fromEntries(this.liveParameters),
          activeStreams: Array.from(this.parameterStreams.keys())
        };
        
      default:
        throw new Error(`Unknown WebSocket control action: ${action}`);
    }
  }
}

export { OSCWebSocketController };
