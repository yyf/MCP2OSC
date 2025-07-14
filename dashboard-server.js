#!/usr/bin/env node

/**
 * MCP2OSC Dashboard Server
 * Standalone web dashboard that connects to MCP2OSC logs
 */

import { createServer } from 'http';
import { readFile, writeFile, appendFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createSocket } from 'dgram';
import { spawn } from 'child_process';
import { addOSCMessage, getOSCMessages } from './shared-storage.js';

// Dynamic import for WebSocket to handle optional dependency
let WebSocketServer;
try {
  const ws = await import('ws');
  WebSocketServer = ws.WebSocketServer;
} catch (error) {
  console.warn('⚠️  WebSocket not available - real-time updates disabled');
  WebSocketServer = null;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

// Configuration
const CONFIG = {
  WEB_PORT: parseInt(process.env.WEB_PORT || '3001'),
  OSC_SEND_PORT: parseInt(process.env.OSC_SEND_PORT || '7500'),
  OSC_RECEIVE_PORT: parseInt(process.env.OSC_RECEIVE_PORT || '7501'),
  OSC_HOST: process.env.DEFAULT_OSC_HOST || '127.0.0.1',
  LOG_FILE: join(__dirname, 'logs', 'mcp2osc.log')
};

// Global state
const STATE = {
  logs: [],
  connections: new Set(),
  stats: {
    mcpMessages: 0,
    oscMessages: 0,
    errors: 0,
    uptime: Date.now()
  },
  oscMessages: [],
  lastOSCReceivedTime: null,
  database: null
};

// Add oscMessages initialization if missing
if (!STATE.oscMessages) {
  STATE.oscMessages = [];
}

class DashboardServer {
  constructor() {
    this.server = createServer(this.handleRequest.bind(this));
    this.mcpProcess = null;
    
    if (WebSocketServer) {
      this.wss = new WebSocketServer({ server: this.server });
      this.setupWebSocket();
    } else {
      this.wss = null;
    }

    this.startMCPServer();
    this.loadLogs();        this.setupLogWatcher();
        this.setupOSCReceiver();
  }

  startMCPServer() {
    console.log('🔧 Starting clean MCP server for Claude...');
    
    this.mcpProcess = spawn('node', ['mcp-server.js'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: __dirname,
      env: { ...process.env, NODE_ENV: 'production' }
    });

    this.mcpProcess.stdout.on('data', (data) => {
      // Ignore MCP server stdout to prevent JSON pollution
    });

    this.mcpProcess.stderr.on('data', (data) => {
      const errorMsg = data.toString().trim();
      if (errorMsg && !errorMsg.includes('initialization')) {
        console.warn('MCP Server:', errorMsg);
      }
    });

    this.mcpProcess.on('exit', (code) => {
      if (code !== 0) {
        console.warn(`⚠️  MCP server exited with code ${code}`);
      }
    });
  }

  async syncWithFileLogs() {
    // Keep file-based logs in sync for the log widget
    try {
      if (existsSync(CONFIG.LOG_FILE)) {
        const logContent = await readFile(CONFIG.LOG_FILE, 'utf8');
        const lines = logContent.split('\n').filter(line => line.trim());
        
        const recentLines = lines.slice(-100);
        
        // Parse log entries
        const newLogs = recentLines.map(line => {
          try {
            const match = line.match(/^(\S+) \[(\w+)\] (.+)$/);
            if (match) {
              return {
                timestamp: match[1],
                level: match[2],
                message: match[3],
                data: null
              };
            }
          } catch (error) {
            // Ignore malformed log lines
          }
          return null;
        }).filter(Boolean);

        // Update stats based on log content
        const mcpCount = lines.filter(line => line.includes('MCP') || line.includes('User Query:')).length;
        const oscSentCount = lines.filter(line => line.includes('OSC message sent:')).length;
        const oscReceivedCount = lines.filter(line => line.includes('OSC received:')).length;
        
        STATE.stats.mcpMessages = mcpCount;
        STATE.stats.oscMessages = oscSentCount + oscReceivedCount;

        // Check if we have new logs
        if (newLogs.length !== STATE.logs.length || 
            (newLogs.length > 0 && STATE.logs.length > 0 && 
             newLogs[newLogs.length - 1].message !== STATE.logs[STATE.logs.length - 1].message)) {
          
          STATE.logs = newLogs;
          
          this.broadcast('logs_updated', { 
            logs: STATE.logs.slice(-20),
            count: STATE.logs.length 
          });
          
          this.broadcast('stats_updated', STATE.stats);
          
          // Check for new OSC received messages and broadcast them
          const newOSCReceived = newLogs.filter(log => 
            log.message.includes('OSC received:') && 
            new Date(log.timestamp) > (STATE.lastOSCReceivedTime || new Date(0))
          );
          
          if (newOSCReceived.length > 0) {
            STATE.lastOSCReceivedTime = new Date(newOSCReceived[newOSCReceived.length - 1].timestamp);
            
            newOSCReceived.forEach(log => {
              // Parse OSC received message for detailed info
              const match = log.message.match(/OSC received: (\/[^\s]+) \[([^\]]*)\] from ([^:]+):(\d+)/);
              if (match) {
                this.broadcast('osc_received', {
                  address: match[1],
                  args: match[2] ? match[2].split(',').map(arg => arg.trim()) : [],
                  host: match[3],
                  port: parseInt(match[4]),
                  timestamp: log.timestamp
                });
              }
            });
          }
        }
      }
    } catch (error) {
      console.warn('Failed to sync with file logs:', error.message);
    }
  }

  extractMethodFromLog(message) {
    // Extract method from MCP log messages
    const methodMatch = message.match(/method['":\s]+(\w+)/i);
    return methodMatch ? methodMatch[1] : 'unknown';
  }

  extractUserQueryFromLog(message) {
    // Extract user query from log messages
    // Look for patterns like "user_query": "..." or similar
    const queryMatch = message.match(/user[_\s]query['":\s]+([^"']+)/i);
    if (queryMatch) return queryMatch[1];
    
    // Also check for tool call content
    const toolMatch = message.match(/tools?\/call.*intent['":\s]+([^"']+)/i);
    if (toolMatch) return toolMatch[1];
    
    // Default extraction from message content
    if (message.includes('inbound') && message.length > 50) {
      return message.substring(0, 100) + '...';
    }
    
    return null;
  }

  extractOSCAddressFromLog(message) {
    // Extract OSC address from log messages
    const addressMatch = message.match(/\/[\w\/]+/);
    return addressMatch ? addressMatch[0] : '/unknown';
  }

  extractOSCArgsFromLog(message) {
    // Extract OSC arguments from log messages
    const argsMatch = message.match(/\[([^\]]+)\]/);
    if (argsMatch) {
      try {
        return argsMatch[1].split(',').map(arg => arg.trim().replace(/['"]/g, ''));
      } catch (error) {
        return [];
      }
    }
    return [];
  }

  parseOSCFromMessage(message) {
    // Parse OSC message sent log: "OSC message sent: /address [args] → host:port"
    const pattern = /OSC message sent: (\/[\w\/]+) \[([^\]]*)\] → ([^:]+):(\d+)/;
    const match = message.match(pattern);
    
    if (match) {
      return {
        address: match[1],
        args: match[2] ? match[2].split(',').map(arg => arg.trim()) : [],
        host: match[3],
        port: parseInt(match[4])
      };
    }
    
    return {
      address: '/unknown',
      args: [],
      host: '127.0.0.1',
      port: 7500
    };
  }

  setupDataRefresh() {
    // Refresh data from file logs every 3 seconds
    setInterval(() => {
      this.syncWithFileLogs();
    }, 3000);
  }

  setupWebSocket() {
    if (!this.wss) return;
    
    this.wss.on('connection', (ws, req) => {
      const clientId = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
      ws.clientId = clientId;
      
      STATE.connections.add(ws);
      console.log(`📱 Dashboard client connected [${clientId}] (${STATE.connections.size} total)`);

      // Setup heartbeat to detect disconnections
      ws.isAlive = true;
      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          this.handleWebSocketMessage(ws, data);
        } catch (error) {
          console.warn('Invalid WebSocket message:', message.toString());
        }
      });

      ws.on('close', (code, reason) => {
        STATE.connections.delete(ws);
        console.log(`📱 Dashboard client disconnected [${clientId}] (${STATE.connections.size} total) - Code: ${code}`);
      });

      ws.on('error', (error) => {
        console.warn(`📱 WebSocket error [${clientId}]:`, error.message);
        STATE.connections.delete(ws);
      });

      // Send initial state
      this.sendToClient(ws, {
        type: 'initial_state',
        data: {
          logs: STATE.logs.slice(-100),
          stats: STATE.stats
        }
      });
    });

    // Setup heartbeat interval to clean up dead connections
    const heartbeatInterval = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (!ws.isAlive) {
          console.log(`💔 Removing dead connection [${ws.clientId}]`);
          STATE.connections.delete(ws);
          return ws.terminate();
        }
        
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000); // Check every 30 seconds

    this.wss.on('close', () => {
      clearInterval(heartbeatInterval);
    });
  }

  handleWebSocketMessage(ws, data) {
    // Handle incoming WebSocket messages from dashboard
    switch (data.type) {
      case 'ping':
        this.sendToClient(ws, { type: 'pong', timestamp: Date.now() });
        break;
      case 'get_logs':
        this.sendToClient(ws, {
          type: 'logs',
          data: STATE.logs.slice(-(data.count || 100))
        });
        break;
      case 'request_refresh':
        // Force immediate data refresh
        this.syncWithFileLogs();
        break;
      case 'get_mcp_messages':
        this.sendToClient(ws, {
          type: 'mcp_messages',
          data: STATE.mcpMessages.slice(-(data.count || 50))
        });
        break;
      case 'get_osc_messages':
        this.sendToClient(ws, {
          type: 'osc_messages', 
          data: (STATE.oscMessages || []).slice(-(data.count || 50))
        });
        break;
      default:
        console.warn('Unknown WebSocket message type:', data.type);
    }
  }

  sendToClient(ws, message) {
    if (ws.readyState === 1) { // WebSocket.OPEN
      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        console.warn('Failed to send to client:', error.message);
        STATE.connections.delete(ws);
      }
    }
  }

  async loadLogs() {
    try {
      if (existsSync(CONFIG.LOG_FILE)) {
        const logContent = await readFile(CONFIG.LOG_FILE, 'utf8');
        const lines = logContent.split('\n').filter(line => line.trim());
        
        STATE.logs = lines.slice(-1000).map(line => {
          try {
            const match = line.match(/^(\S+) \[(\w+)\] (.+)$/);
            if (match) {
              return {
                timestamp: match[1],
                level: match[2],
                message: match[3],
                data: null
              };
            }
          } catch (error) {
            // Ignore malformed log lines
          }
          return null;
        }).filter(Boolean);

        console.log(`📋 Loaded ${STATE.logs.length} log entries`);
      }
    } catch (error) {
      console.error('Failed to load logs:', error.message);
    }
  }

  async logActivity(message, data = null) {
    try {
      const timestamp = new Date().toISOString();
      const logLine = `${timestamp} [DASHBOARD] ${message}${data ? ` ${JSON.stringify(data)}` : ''}\n`;
      await appendFile(CONFIG.LOG_FILE, logLine);
      
      // Also add to in-memory logs for immediate dashboard display
      const logEntry = {
        timestamp,
        level: 'INFO',
        message,
        data
      };
      
      STATE.logs.push(logEntry);
      if (STATE.logs.length > 1000) {
        STATE.logs.shift();
      }
      
      // Broadcast to connected clients
      this.broadcast('log', logEntry);
    } catch (error) {
      console.warn('Failed to log activity:', error.message);
    }
  }

  setupLogWatcher() {
    // Watch for new log entries (simple polling)
    setInterval(async () => {
      try {
        if (existsSync(CONFIG.LOG_FILE)) {
          const stats = await stat(CONFIG.LOG_FILE);
          if (stats.mtime > this.lastLogCheck) {
            this.lastLogCheck = stats.mtime;
            await this.loadLogs();
            this.broadcast('logs_updated', { count: STATE.logs.length });
          }
        }
      } catch (error) {
        // Ignore errors
      }
    }, 1000);

    this.lastLogCheck = new Date();
  }

  broadcast(type, data) {
    if (STATE.connections.size === 0) return;
    
    const message = { type, data };
    const deadConnections = [];
    
    STATE.connections.forEach(ws => {
      if (ws.readyState === 1) { // WebSocket.OPEN
        try {
          ws.send(JSON.stringify(message));
        } catch (error) {
          console.warn(`Failed to broadcast to [${ws.clientId}]:`, error.message);
          deadConnections.push(ws);
        }
      } else {
        deadConnections.push(ws);
      }
    });
    
    // Clean up dead connections
    deadConnections.forEach(ws => {
      STATE.connections.delete(ws);
    });
  }

  broadcast(type, data) {
    if (STATE.connections.size === 0) return;
    
    STATE.connections.forEach(ws => {
      if (ws.readyState === 1) { // WebSocket.OPEN
        try {
          ws.send(JSON.stringify({ type, data }));
        } catch (error) {
          STATE.connections.delete(ws);
        }
      }
    });
  }

  async handleRequest(req, res) {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      
      // Set CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // API routes
      if (url.pathname.startsWith('/api/')) {
        await this.handleApiRequest(req, res, url);
        return;
      }

      // Static files
      await this.handleStaticRequest(req, res, url);
    } catch (error) {
      console.error('Request error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }

  async handleApiRequest(req, res, url) {
    const path = url.pathname.replace('/api', '');
    
    switch (path) {
      case '/status':
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          uptime: Date.now() - STATE.stats.uptime,
          stats: STATE.stats,
          config: {
            oscHost: CONFIG.OSC_HOST,
            oscSendPort: CONFIG.OSC_SEND_PORT,
            oscReceivePort: CONFIG.OSC_RECEIVE_PORT
          },
          databaseConnected: STATE.database !== null
        }));
        break;

      case '/logs':
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(STATE.logs.slice(-100)));
        break;

      case '/mcp-messages':
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(STATE.mcpMessages.slice(-100)));
        break;

      case '/osc-messages':
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify((STATE.oscMessages || []).slice(-100)));
        break;

      case '/patterns':
        if (req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(Array.from(STATE.oscPatterns.entries()).map(([address, pattern]) => ({
            address,
            ...pattern
          }))));
        } else if (req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', () => {
            try {
              const patterns = JSON.parse(body);
              // Update patterns
              patterns.forEach(pattern => {
                STATE.oscPatterns.set(pattern.address, {
                  description: pattern.description,
                  args: pattern.args
                });
              });
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true }));
            } catch (error) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
          });
        }
        break;

      case '/test-osc':
        if (req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', async () => {
            try {
              const { address, args } = JSON.parse(body);
              await this.sendTestOSC(address, args);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, message: 'OSC message sent' }));
            } catch (error) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: error.message }));
            }
          });
        }
        break;

      default:
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'API endpoint not found' }));
    }
  }

  async sendTestOSC(address, args) {
    if (!address.startsWith('/')) {
      throw new Error('OSC address must start with "/"');
    }

    const socket = createSocket('udp4');
    
    try {
      const message = this.createOSCMessage(address, args || []);
      
      await new Promise((resolve, reject) => {
        socket.send(message, CONFIG.OSC_SEND_PORT, CONFIG.OSC_HOST, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });

      // Log the test message
      const logEntry = {
        timestamp: new Date().toISOString(),
        level: 'INFO',
        message: 'Test OSC message sent',
        data: JSON.stringify({ address, args })
      };
      
      STATE.logs.push(logEntry);
      if (STATE.logs.length > 1000) {
        STATE.logs.shift();
      }

      this.broadcast('log', logEntry);
      
    } finally {
      socket.close();
    }
  }

  createOSCMessage(address, args) {
    // Simple OSC message creation
    const addressBuffer = Buffer.from(address + '\0');
    const addressPadded = this.padTo4Bytes(addressBuffer);
    
    const typeTagString = ',' + args.map(arg => {
      if (typeof arg === 'number') {
        return Number.isInteger(arg) ? 'i' : 'f';
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

  async handleStaticRequest(req, res, url) {
    // Simple dashboard HTML
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MCP2OSC Dashboard</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 0; padding: 20px; background: #1a1a1a; color: #fff; }
        .header { border-bottom: 1px solid #333; padding-bottom: 20px; margin-bottom: 20px; }
        .status { display: flex; gap: 20px; margin-bottom: 20px; }
        .stat { background: #2a2a2a; padding: 15px; border-radius: 8px; }
        .logs { background: #2a2a2a; padding: 20px; border-radius: 8px; height: 400px; overflow-y: auto; font-family: monaco, monospace; font-size: 12px; }
        .log-entry { margin-bottom: 5px; }
        .log-timestamp { color: #888; }
        .log-level { font-weight: bold; }
        .log-level.INFO { color: #4CAF50; }
        .log-level.WARN { color: #FF9800; }
        .log-level.ERROR { color: #F44336; }
        .test-section { background: #2a2a2a; padding: 20px; border-radius: 8px; margin-top: 20px; }
        .form-group { margin-bottom: 15px; }
        label { display: block; margin-bottom: 5px; font-weight: bold; }
        input, textarea { width: 100%; padding: 8px; border: 1px solid #555; background: #1a1a1a; color: #fff; border-radius: 4px; }
        button { background: #007AFF; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; }
        button:hover { background: #0056CC; }
        .connected { color: #4CAF50; }
        .disconnected { color: #F44336; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🎵 MCP2OSC Dashboard</h1>
        <p>Status: <span id="connection-status" class="disconnected">Connecting...</span></p>
    </div>

    <div class="status">
        <div class="stat">
            <strong>Uptime</strong><br>
            <span id="uptime">--</span>
        </div>
        <div class="stat">
            <strong>MCP Messages</strong><br>
            <span id="mcp-messages">0</span>
        </div>
        <div class="stat">
            <strong>OSC Messages</strong><br>
            <span id="osc-messages">0</span>
        </div>
        <div class="stat">
            <strong>Errors</strong><br>
            <span id="errors">0</span>
        </div>
    </div>

    <div class="logs" id="logs-container">
        <div>Loading logs...</div>
    </div>

    <div class="test-section">
        <h3>🧪 Test OSC Message</h3>
        <div class="form-group">
            <label for="osc-address">OSC Address:</label>
            <input type="text" id="osc-address" placeholder="/test/message" value="/test/frequency">
        </div>
        <div class="form-group">
            <label for="osc-args">Arguments (JSON array):</label>
            <input type="text" id="osc-args" placeholder='[440, 0.5, "hello"]' value="[440, 0.5]">
        </div>
        <button onclick="sendTestOSC()">Send OSC Message</button>
    </div>

    <script>
        let ws = null;
        let reconnectInterval = null;

        function connectWebSocket() {
            try {
                ws = new WebSocket('ws://localhost:${CONFIG.WEB_PORT}');
                
                ws.onopen = () => {
                    document.getElementById('connection-status').textContent = 'Connected';
                    document.getElementById('connection-status').className = 'connected';
                    if (reconnectInterval) {
                        clearInterval(reconnectInterval);
                        reconnectInterval = null;
                    }
                };

                ws.onmessage = (event) => {
                    const message = JSON.parse(event.data);
                    handleWebSocketMessage(message);
                };

                ws.onclose = () => {
                    document.getElementById('connection-status').textContent = 'Disconnected';
                    document.getElementById('connection-status').className = 'disconnected';
                    
                    if (!reconnectInterval) {
                        reconnectInterval = setInterval(() => {
                            connectWebSocket();
                        }, 2000);
                    }
                };

                ws.onerror = () => {
                    document.getElementById('connection-status').textContent = 'Error';
                    document.getElementById('connection-status').className = 'disconnected';
                };
            } catch (error) {
                console.error('WebSocket connection failed:', error);
            }
        }

        function handleWebSocketMessage(message) {
            switch (message.type) {
                case 'initial_state':
                    updateLogs(message.data.logs || []);
                    updateStats(message.data.stats || {});
                    console.log('Initial state loaded:', message.data);
                    break;
                case 'logs_updated':
                    updateLogs(message.data.logs || []);
                    break;
                case 'log':
                    addLogEntry(message.data);
                    break;
                case 'stats_updated':
                case 'stats':
                    updateStats(message.data || {});
                    break;
                case 'osc_received':
                    console.log('OSC message received from external app:', message.data);
                    // Add special handling for received OSC messages
                    addLogEntry({
                        timestamp: new Date().toISOString(),
                        level: 'INFO',
                        message: \`OSC received: \${message.data.address} [\${message.data.args.join(', ')}] from \${message.data.host}:\${message.data.port}\`
                    });
                    // When OSC message is received, also store it
                    storeOscMessage(message.data.address, message.data.args, message.data.host, message.data.port);
                    break;
                default:
                    console.log('Unknown message type:', message.type, message.data);
            }
        }

        function requestDataRefresh() {
            // Request fresh data from server
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'request_refresh' }));
            }
        }

        function updateLogs(logs) {
            const container = document.getElementById('logs-container');
            container.innerHTML = '';
            logs.forEach(addLogEntry);
        }

        function addLogEntry(log) {
            const container = document.getElementById('logs-container');
            const entry = document.createElement('div');
            entry.className = 'log-entry';
            
            const timestamp = new Date(log.timestamp).toLocaleTimeString();
            entry.innerHTML = \`<span class="log-timestamp">\${timestamp}</span> <span class="log-level \${log.level}">\${log.level}</span> \${log.message}\`;
            
            container.appendChild(entry);
            container.scrollTop = container.scrollHeight;
        }

        function updateStats(stats) {
            if (!stats) return;
            
            const elements = {
                'uptime': formatDuration(Date.now() - stats.uptime),
                'mcp-messages': stats.mcpMessages || 0,
                'osc-messages': stats.oscMessages || 0,
                'errors': stats.errors || 0
            };
            
            Object.entries(elements).forEach(([id, value]) => {
                const element = document.getElementById(id);
                if (element) {
                    element.textContent = value;
                }
            });
            
            // Add visual indicator for new messages
            if (stats.mcpMessages > (window.lastMCPCount || 0)) {
                flashElement('mcp-messages');
                window.lastMCPCount = stats.mcpMessages;
            }
            
            if (stats.oscMessages > (window.lastOSCCount || 0)) {
                flashElement('osc-messages');
                window.lastOSCCount = stats.oscMessages;
            }
        }

        function flashElement(elementId) {
            const element = document.getElementById(elementId);
            if (element) {
                element.style.backgroundColor = '#4CAF50';
                element.style.transition = 'background-color 0.3s';
                setTimeout(() => {
                    element.style.backgroundColor = '';
                }, 300);
            }
        }

        function formatDuration(ms) {
            const seconds = Math.floor(ms / 1000);
            const minutes = Math.floor(seconds / 60);
            const hours = Math.floor(minutes / 60);
            
            if (hours > 0) return \`\${hours}h \${minutes % 60}m\`;
            if (minutes > 0) return \`\${minutes}m \${seconds % 60}s\`;
            return \`\${seconds}s\`;
        }

        async function sendTestOSC() {
            const address = document.getElementById('osc-address').value;
            const argsText = document.getElementById('osc-args').value;
            
            try {
                const args = argsText ? JSON.parse(argsText) : [];
                
                const response = await fetch('/api/test-osc', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ address, args })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    alert('OSC message sent successfully!');
                } else {
                    alert('Error: ' + result.error);
                }
            } catch (error) {
                alert('Error: ' + error.message);
            }
        }

        // Initialize
        connectWebSocket();
        
        // Update status periodically and force refresh if needed
        setInterval(async () => {
            try {
                // Fetch latest stats from API
                const response = await fetch('/api/status');
                const status = await response.json();
                updateStats(status.stats);
                
                // Also request fresh data via WebSocket if connected
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'request_refresh' }));
                }
            } catch (error) {
                console.warn('Failed to fetch status:', error);
            }
        }, 4000); // Every 4 seconds

        // Also add a manual refresh button functionality
        window.forceRefresh = function() {
            location.reload();
        };
        
        // Add refresh indicator
        function showRefreshIndicator() {
            const indicator = document.createElement('div');
            indicator.style.cssText = 'position: fixed; top: 10px; right: 10px; background: #4CAF50; color: white; padding: 5px 10px; border-radius: 3px; font-size: 12px; z-index: 1000;';
            indicator.textContent = 'Data refreshed';
            document.body.appendChild(indicator);
            setTimeout(() => indicator.remove(), 2000);
        }
    </script>
</body>
</html>
      `);
      return;
    }

    // 404 for other requests
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }

  listen() {
    this.server.listen(CONFIG.WEB_PORT, () => {
      console.log(`🚀 MCP2OSC Dashboard running at http://localhost:${CONFIG.WEB_PORT}`);
      console.log(`📡 OSC output: ${CONFIG.OSC_HOST}:${CONFIG.OSC_SEND_PORT}`);
      console.log(`📥 OSC input: ${CONFIG.OSC_RECEIVE_PORT}`);
      console.log(`📋 Logs: ${CONFIG.LOG_FILE}`);
    });
  }

  setupOSCReceiver() {
    // Setup OSC receiver to store messages for the dashboard
    try {
      const oscReceiveSocket = createSocket('udp4');
      
      oscReceiveSocket.on('message', (buffer, rinfo) => {
        try {
          const message = this.parseOSCMessage(buffer);
          if (message) {
            // Store the OSC message in shared storage for MCP server access
            const storedMessage = addOSCMessage(message.address, message.args, rinfo.address, rinfo.port);
            console.log(`[SHARED STORAGE] Stored message:`, storedMessage);
            console.log(`[SHARED STORAGE] File path: ./logs/osc-messages.json`);
            
            // Also store in local STATE for dashboard display
            storeOscMessage(message.address, message.args, rinfo.address, rinfo.port);
            
            // Log to file (consistent with MCP server logging)
            this.logActivity(`OSC received: ${message.address} [${message.args.join(', ')}] from ${rinfo.address}:${rinfo.port}`, {
              address: message.address,
              args: message.args,
              source: rinfo.address,
              port: rinfo.port
            });
            
            STATE.stats.oscReceived++;
            
            // Broadcast to connected clients
            this.broadcast('osc_received', {
              address: message.address,
              args: message.args,
              host: rinfo.address,
              port: rinfo.port,
              timestamp: new Date().toISOString()
            });
          }
        } catch (error) {
          console.warn('Error parsing OSC message:', error.message);
        }
      });
      
      oscReceiveSocket.on('error', (error) => {
        console.warn('OSC receive socket error:', error.message);
      });
      
      // Bind to receive OSC messages
      oscReceiveSocket.bind(CONFIG.OSC_RECEIVE_PORT, CONFIG.OSC_HOST, () => {
        console.log(`📥 OSC receiver listening on ${CONFIG.OSC_HOST}:${CONFIG.OSC_RECEIVE_PORT}`);
      });
      
      this.oscReceiveSocket = oscReceiveSocket;
      
    } catch (error) {
      console.warn('Failed to setup OSC receiver:', error.message);
    }
  }

  parseOSCMessage(buffer) {
    try {
      // Simple OSC message parser
      let offset = 0;
      
      // Read address (null-terminated string)
      let address = '';
      while (offset < buffer.length && buffer[offset] !== 0) {
        address += String.fromCharCode(buffer[offset]);
        offset++;
      }
      
      // Skip null terminator and padding
      offset++;
      while (offset % 4 !== 0 && offset < buffer.length) offset++;
      
      if (offset >= buffer.length) {
        return { address, args: [] };
      }
      
      // Read type tag string
      let typeTag = '';
      if (buffer[offset] === 44) { // ',' character
        offset++;
        while (offset < buffer.length && buffer[offset] !== 0) {
          typeTag += String.fromCharCode(buffer[offset]);
          offset++;
        }
      }
      
      // Skip null terminator and padding
      offset++;
      while (offset % 4 !== 0 && offset < buffer.length) offset++;
      
      // Parse arguments based on type tags
      const args = [];
      for (let i = 0; i < typeTag.length; i++) {
        const type = typeTag[i];
        
        switch (type) {
          case 'i': // 32-bit integer
            if (offset + 4 <= buffer.length) {
              args.push(buffer.readInt32BE(offset));
              offset += 4;
            }
            break;
          case 'f': // 32-bit float
            if (offset + 4 <= buffer.length) {
              args.push(buffer.readFloatBE(offset));
              offset += 4;
            }
            break;
          case 's': // string
            let str = '';
            while (offset < buffer.length && buffer[offset] !== 0) {
              str += String.fromCharCode(buffer[offset]);
              offset++;
            }
            args.push(str);
            offset++;
            while (offset % 4 !== 0 && offset < buffer.length) offset++;
            break;
          case 'T': // true
            args.push(true);
            break;
          case 'F': // false
            args.push(false);
            break;
          case 'N': // null
            args.push(null);
            break;
        }
      }
      
      return { address, args };
    } catch (error) {
      throw new Error(`OSC parsing failed: ${error.message}`);
    }
  }
}

// Function to store OSC messages when received
function storeOscMessage(address, args, source, port) {
  if (!STATE.oscMessages) {
    STATE.oscMessages = [];
  }
  
  const message = {
    address,
    args,
    source,
    port,
    timestamp: new Date().toISOString()
  };
  
  STATE.oscMessages.push(message);
  
  // Keep only last 1000 messages to prevent memory issues
  if (STATE.oscMessages.length > 1000) {
    STATE.oscMessages = STATE.oscMessages.slice(-1000);
  }
  
  console.log(`OSC message stored: ${address} ${JSON.stringify(args)} from ${source}:${port}`);
}

// Start the dashboard server
const dashboard = new DashboardServer();
dashboard.listen();

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down MCP2OSC...');
  
  if (dashboard.mcpProcess) {
    dashboard.mcpProcess.kill();
  }
  
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down dashboard server...');
  process.exit(0);
});

console.log('🔧 Clean MCP server started for Claude Desktop');