#!/usr/bin/env node

/**
 * MCP2OSC - Model Context Protocol to OpenSoundControl Bridge
 * 
 * A single-file, zero-dependency MCP server that translates LLM requests
 * into OSC messages for creative applications like MaxMSP and Processing.
 * 
 * Architecture:
 * - MCP Server: Communicates with Claude/LLMs via stdio JSON-RPC
 * - Web Server: Serves dashboard and API endpoints
 * - OSC Manager: Sends/receives OSC messages via UDP
 * - Logger: File-based logging for all activities
 */

import { createServer } from 'http';
import { createSocket } from 'dgram';
import { readFile, writeFile, mkdir, appendFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Dynamic import for WebSocket to handle optional dependency
let WebSocketServer;
try {
  const ws = await import('ws');
  WebSocketServer = ws.WebSocketServer;
} catch (error) {
  console.warn('WebSocket not available - dashboard will use fallback mode');
  WebSocketServer = null;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

// Configuration with environment variable support
const CONFIG = {
  WEB_PORT: parseInt(process.env.WEB_PORT || '3001'),
  OSC_SEND_PORT: parseInt(process.env.OSC_SEND_PORT || '7500'),
  OSC_RECEIVE_PORT: parseInt(process.env.OSC_RECEIVE_PORT || '7501'),
  OSC_HOST: process.env.DEFAULT_OSC_HOST || '127.0.0.1',
  LOG_LEVEL: process.env.MCP2OSC_LOG_LEVEL || 'info',
  ENABLE_OSC_CONFIRMATION: process.env.ENABLE_OSC_CONFIRMATION === 'true',
  AUTO_GENERATE_PATTERNS: process.env.AUTO_GENERATE_PATTERNS !== 'false',
  MAX_RETRY_ATTEMPTS: parseInt(process.env.MAX_RETRY_ATTEMPTS || '3'),
  OSC_TIMEOUT_MS: parseInt(process.env.OSC_TIMEOUT_MS || '1000'),
  IS_MCP_MODE: process.stdin.isTTY === false || process.argv.includes('--mcp')
};

// Global state
const STATE = {
  connections: new Set(),
  oscPatterns: new Map(),
  logs: [],
  stats: {
    mcpMessages: 0,
    oscMessages: 0,
    errors: 0,
    uptime: Date.now()
  }
};

// ==================== LOGGING SYSTEM ====================

class Logger {
  constructor() {
    this.logDir = join(__dirname, 'logs');
    this.logFile = join(this.logDir, 'mcp2osc.log');
    this.init();
  }

  async init() {
    try {
      if (!existsSync(this.logDir)) {
        await mkdir(this.logDir, { recursive: true });
      }
    } catch (error) {
      console.error('Failed to create log directory:', error);
    }
  }

  async log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      message,
      data: data ? JSON.stringify(data) : null
    };

    // Add to in-memory logs (keep last 1000)
    STATE.logs.push(logEntry);
    if (STATE.logs.length > 1000) {
      STATE.logs.shift();
    }

    // Write to file (always safe to do)
    const logLine = `${timestamp} [${level.toUpperCase()}] ${message}${data ? ` ${JSON.stringify(data)}` : ''}\n`;
    
    try {
      await appendFile(this.logFile, logLine);
    } catch (error) {
      // Silently ignore file write errors in MCP mode
    }

    // CRITICAL: In MCP mode, NEVER write to stdout/stderr as it corrupts JSON-RPC
    if (!CONFIG.IS_MCP_MODE) {
      console.log(logLine.trim());
    }

    // Broadcast to WebSocket clients (only if web server is running)
    if (!CONFIG.IS_MCP_MODE) {
      this.broadcast('log', logEntry);
    }
  }

  broadcast(type, data) {
    // Only broadcast if WebSocket connections exist
    if (STATE.connections.size === 0) return;
    
    STATE.connections.forEach(ws => {
      if (ws.readyState === 1) { // WebSocket.OPEN
        try {
          ws.send(JSON.stringify({ type, data }));
        } catch (error) {
          // Remove dead connections
          STATE.connections.delete(ws);
        }
      }
    });
  }

  info(message, data) { return this.log('info', message, data); }
  error(message, data) { return this.log('error', message, data); }
  debug(message, data) { return this.log('debug', message, data); }
  warn(message, data) { return this.log('warn', message, data); }
}

const logger = new Logger();

// ==================== OSC IMPLEMENTATION ====================

class OSCManager {
  constructor() {
    this.sendSocket = createSocket('udp4');
    this.receiveSocket = createSocket('udp4');
    this.pendingMessages = new Map();
    this.setupReceiver();
  }

  setupReceiver() {
    this.receiveSocket.on('message', (buffer, rinfo) => {
      try {
        const message = this.parseOSCMessage(buffer);
        logger.info('OSC message received', { message, from: rinfo });
        
        // Handle acknowledgments
        if (message.address === '/ack' && message.args[0]) {
          const originalAddress = message.args[0];
          if (this.pendingMessages.has(originalAddress)) {
            clearTimeout(this.pendingMessages.get(originalAddress));
            this.pendingMessages.delete(originalAddress);
            logger.debug('OSC message confirmed', { address: originalAddress });
          }
        }
      } catch (error) {
        logger.error('Failed to parse received OSC message', { error: error.message });
      }
    });

    this.receiveSocket.on('error', (error) => {
      logger.error('OSC receive socket error', { error: error.message });
    });

    this.receiveSocket.bind(CONFIG.OSC_RECEIVE_PORT, () => {
      logger.info('OSC receiver started', { port: CONFIG.OSC_RECEIVE_PORT });
    });
  }

  async sendOSC(address, args = []) {
    try {
      const buffer = this.createOSCMessage(address, args);
      
      await new Promise((resolve, reject) => {
        this.sendSocket.send(buffer, CONFIG.OSC_SEND_PORT, CONFIG.OSC_HOST, (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });

      STATE.stats.oscMessages++;
      logger.info('OSC message sent', { address, args, host: CONFIG.OSC_HOST, port: CONFIG.OSC_SEND_PORT });

      // Set up confirmation timeout if enabled
      if (CONFIG.ENABLE_OSC_CONFIRMATION) {
        const timeout = setTimeout(() => {
          logger.warn('OSC message not confirmed', { address });
          this.pendingMessages.delete(address);
        }, CONFIG.OSC_TIMEOUT_MS);
        
        this.pendingMessages.set(address, timeout);
      }

      return { success: true, address, args };
    } catch (error) {
      STATE.stats.errors++;
      logger.error('Failed to send OSC message', { address, args, error: error.message });
      throw error;
    }
  }

  createOSCMessage(address, args) {
    // Simple OSC message format implementation
    const addressBuffer = Buffer.from(address + '\0');
    const addressPadded = this.padTo4Bytes(addressBuffer);
    
    const typeTagString = ',' + args.map(arg => {
      if (typeof arg === 'number') {
        return Number.isInteger(arg) ? 'i' : 'f';
      } else if (typeof arg === 'string') {
        return 's';
      } else {
        return 's'; // default to string
      }
    }).join('');
    
    const typeTagBuffer = this.padTo4Bytes(Buffer.from(typeTagString + '\0'));
    
    const argBuffers = args.map(arg => {
      if (typeof arg === 'number') {
        if (Number.isInteger(arg)) {
          // 32-bit integer
          const buffer = Buffer.alloc(4);
          buffer.writeInt32BE(arg, 0);
          return buffer;
        } else {
          // 32-bit float
          const buffer = Buffer.alloc(4);
          buffer.writeFloatBE(arg, 0);
          return buffer;
        }
      } else {
        // String
        return this.padTo4Bytes(Buffer.from(String(arg) + '\0'));
      }
    });

    return Buffer.concat([addressPadded, typeTagBuffer, ...argBuffers]);
  }

  parseOSCMessage(buffer) {
    let offset = 0;
    
    // Read address
    const addressEnd = buffer.indexOf(0, offset);
    const address = buffer.subarray(offset, addressEnd).toString();
    offset = this.roundUpTo4(addressEnd + 1);
    
    // Read type tag string
    const typeTagEnd = buffer.indexOf(0, offset);
    const typeTag = buffer.subarray(offset + 1, typeTagEnd).toString(); // Skip the comma
    offset = this.roundUpTo4(typeTagEnd + 1);
    
    // Read arguments
    const args = [];
    for (const type of typeTag) {
      switch (type) {
        case 'i':
          args.push(buffer.readInt32BE(offset));
          offset += 4;
          break;
        case 'f':
          args.push(buffer.readFloatBE(offset));
          offset += 4;
          break;
        case 's':
          const stringEnd = buffer.indexOf(0, offset);
          args.push(buffer.subarray(offset, stringEnd).toString());
          offset = this.roundUpTo4(stringEnd + 1);
          break;
      }
    }
    
    return { address, args };
  }

  padTo4Bytes(buffer) {
    const padding = (4 - (buffer.length % 4)) % 4;
    return Buffer.concat([buffer, Buffer.alloc(padding)]);
  }

  roundUpTo4(n) {
    return (n + 3) & ~3;
  }
}

// ==================== MCP SERVER ====================

class MCPServer {
  constructor() {
    this.requestId = 0;
    this.setupStdio();
  }

  setupStdio() {
    if (CONFIG.IS_MCP_MODE) {
      process.stdin.setEncoding('utf8');
      
      process.stdin.on('data', (data) => {
        const lines = data.toString().split('\n').filter(line => line.trim());
        for (const line of lines) {
          try {
            const message = JSON.parse(line);
            this.handleMessage(message);
          } catch (error) {
            logger.error('Failed to parse MCP message', { line, error: error.message });
          }
        }
      });

      process.stdin.on('end', () => {
        logger.info('MCP client disconnected');
        process.exit(0);
      });
    }
  }

  async handleMessage(message) {
    try {
      STATE.stats.mcpMessages++;
      logger.info('MCP message received', { message });

      if (message.method === 'initialize') {
        await this.handleInitialize(message);
      } else if (message.method === 'tools/list') {
        await this.handleToolsList(message);
      } else if (message.method === 'tools/call') {
        await this.handleToolCall(message);
      } else {
        logger.warn('Unknown MCP method', { method: message.method });
      }
    } catch (error) {
      STATE.stats.errors++;
      logger.error('Error handling MCP message', { message, error: error.message });
      
      this.sendResponse({
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32603,
          message: 'Internal error',
          data: error.message
        }
      });
    }
  }

  async handleInitialize(message) {
    const response = {
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
          logging: {},
          prompts: {}
        },
        serverInfo: {
          name: 'mcp2osc',
          version: '1.0.0'
        }
      }
    };

    this.sendResponse(response);
    logger.info('MCP server initialized');
  }

  async handleToolsList(message) {
    const tools = [
      {
        name: 'send_osc_message',
        description: 'Send an OSC message to the creative application',
        inputSchema: {
          type: 'object',
          properties: {
            address: {
              type: 'string',
              description: 'OSC address pattern (e.g., /synth/freq)'
            },
            args: {
              type: 'array',
              description: 'Array of arguments (numbers and strings)',
              items: {
                oneOf: [
                  { type: 'number' },
                  { type: 'string' }
                ]
              }
            }
          },
          required: ['address']
        }
      },
      {
        name: 'generate_osc_patterns',
        description: 'Generate OSC address patterns based on user intent',
        inputSchema: {
          type: 'object',
          properties: {
            intent: {
              type: 'string',
              description: 'Description of what the user wants to control'
            },
            application: {
              type: 'string',
              description: 'Target creative application (MaxMSP, Processing, etc.)',
              default: 'MaxMSP'
            }
          },
          required: ['intent']
        }
      },
      {
        name: 'get_system_status',
        description: 'Get the current status and health of the MCP2OSC system',
        inputSchema: {
          type: 'object',
          properties: {},
          required: []
        }
      }
    ];

    this.sendResponse({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        tools
      }
    });
  }

  async handleToolCall(message) {
    const { name, arguments: args } = message.params;

    try {
      let result;

      switch (name) {
        case 'send_osc_message':
          result = await this.handleSendOSC(args);
          break;
        case 'generate_osc_patterns':
          result = await this.handleGeneratePatterns(args);
          break;
        case 'get_system_status':
          result = await this.handleGetStatus(args);
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      this.sendResponse({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          content: [
            {
              type: 'text',
              text: result
            }
          ]
        }
      });

    } catch (error) {
      logger.error('Tool call failed', { name, args, error: error.message });
      this.sendResponse({
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32603,
          message: 'Tool execution failed',
          data: error.message
        }
      });
    }
  }

  async handleSendOSC(args) {
    const { address, args: oscArgs = [] } = args;
    
    if (!address || !address.startsWith('/')) {
      throw new Error('Invalid OSC address. Must start with "/"');
    }

    const result = await oscManager.sendOSC(address, oscArgs);
    return `OSC message sent successfully: ${address} with args [${oscArgs.join(', ')}]`;
  }

  async handleGeneratePatterns(args) {
    const { intent, application = 'MaxMSP' } = args;
    
    // Simple pattern generation based on common use cases
    const patterns = this.generatePatternsFromIntent(intent, application);
    
    // Store patterns for later use
    patterns.forEach(pattern => {
      STATE.oscPatterns.set(pattern.address, pattern);
    });

    logger.info('Generated OSC patterns', { intent, application, patterns });

    const patternDescriptions = patterns.map(p => 
      `${p.address} - ${p.description} (${p.args.join(', ')})`
    ).join('\n');

    return `Generated OSC patterns for "${intent}" in ${application}:\n\n${patternDescriptions}\n\nThese patterns have been saved and can be used with send_osc_message.`;
  }

  generatePatternsFromIntent(intent, application) {
    const lowercaseIntent = intent.toLowerCase();
    const patterns = [];

    // Music/Audio patterns
    if (lowercaseIntent.includes('music') || lowercaseIntent.includes('audio') || lowercaseIntent.includes('sound')) {
      patterns.push(
        { address: '/music/tempo', description: 'Set tempo in BPM', args: ['number'] },
        { address: '/music/volume', description: 'Set master volume (0.0-1.0)', args: ['number'] },
        { address: '/music/play', description: 'Start/stop playback', args: ['number'] },
        { address: '/music/key', description: 'Set musical key', args: ['string'] }
      );
    }

    // Synthesis patterns
    if (lowercaseIntent.includes('synth') || lowercaseIntent.includes('frequency') || lowercaseIntent.includes('oscillator')) {
      patterns.push(
        { address: '/synth/freq', description: 'Set frequency in Hz', args: ['number'] },
        { address: '/synth/amp', description: 'Set amplitude (0.0-1.0)', args: ['number'] },
        { address: '/synth/wave', description: 'Set waveform type', args: ['string'] },
        { address: '/synth/filter/cutoff', description: 'Set filter cutoff frequency', args: ['number'] }
      );
    }

    // Visual patterns
    if (lowercaseIntent.includes('visual') || lowercaseIntent.includes('color') || lowercaseIntent.includes('animation')) {
      patterns.push(
        { address: '/visual/color/r', description: 'Set red component (0-255)', args: ['number'] },
        { address: '/visual/color/g', description: 'Set green component (0-255)', args: ['number'] },
        { address: '/visual/color/b', description: 'Set blue component (0-255)', args: ['number'] },
        { address: '/visual/brightness', description: 'Set brightness (0.0-1.0)', args: ['number'] },
        { address: '/visual/speed', description: 'Set animation speed', args: ['number'] }
      );
    }

    // Effect patterns
    if (lowercaseIntent.includes('effect') || lowercaseIntent.includes('reverb') || lowercaseIntent.includes('delay')) {
      patterns.push(
        { address: '/effects/reverb/size', description: 'Set reverb room size', args: ['number'] },
        { address: '/effects/delay/time', description: 'Set delay time in ms', args: ['number'] },
        { address: '/effects/distortion/gain', description: 'Set distortion amount', args: ['number'] }
      );
    }

    // Default patterns if nothing specific matched
    if (patterns.length === 0) {
      patterns.push(
        { address: '/control/param1', description: 'Generic parameter 1', args: ['number'] },
        { address: '/control/param2', description: 'Generic parameter 2', args: ['number'] },
        { address: '/control/trigger', description: 'Trigger action', args: ['number'] }
      );
    }

    return patterns;
  }

  async handleGetStatus(args) {
    const status = {
      uptime: Date.now() - STATE.stats.uptime,
      mcpMessages: STATE.stats.mcpMessages,
      oscMessages: STATE.stats.oscMessages,
      errors: STATE.stats.errors,
      oscPatternsCount: STATE.oscPatterns.size,
      webConnections: STATE.connections.size,
      oscHost: CONFIG.OSC_HOST,
      oscSendPort: CONFIG.OSC_SEND_PORT,
      oscReceivePort: CONFIG.OSC_RECEIVE_PORT
    };

    return `MCP2OSC System Status:
Uptime: ${Math.floor(status.uptime / 1000)} seconds
MCP Messages: ${status.mcpMessages}
OSC Messages: ${status.oscMessages}
Errors: ${status.errors}
OSC Patterns: ${status.oscPatternsCount}
Web Connections: ${status.webConnections}
OSC Target: ${status.oscHost}:${status.oscSendPort}
OSC Listen: ${status.oscReceivePort}`;
  }

  sendResponse(response) {
    if (CONFIG.IS_MCP_MODE) {
      process.stdout.write(JSON.stringify(response) + '\n');
    }
    logger.debug('MCP response sent', { response });
  }
}

// ==================== WEB SERVER ====================

class WebServer {
  constructor() {
    this.server = createServer(this.handleRequest.bind(this));
    
    // Only set up WebSocket if available
    if (WebSocketServer) {
      this.wss = new WebSocketServer({ server: this.server });
      this.setupWebSocket();
    } else {
      this.wss = null;
      logger.warn('WebSocket not available - real-time updates disabled');
    }
  }

  setupWebSocket() {
    if (!this.wss) return;
    
    this.wss.on('connection', (ws) => {
      STATE.connections.add(ws);
      logger.info('WebSocket client connected', { total: STATE.connections.size });

      ws.on('close', () => {
        STATE.connections.delete(ws);
        logger.info('WebSocket client disconnected', { total: STATE.connections.size });
      });

      // Send initial state
      ws.send(JSON.stringify({
        type: 'initial_state',
        data: {
          logs: STATE.logs.slice(-100), // Last 100 logs
          stats: STATE.stats,
          patterns: Array.from(STATE.oscPatterns.entries()).map(([address, pattern]) => ({
            address,
            ...pattern
          }))
        }
      }));
    });
  }

  async handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    
    try {
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      // API Routes
      if (url.pathname.startsWith('/api/')) {
        await this.handleAPI(req, res, url);
        return;
      }

      // Serve static files or SPA
      await this.serveStatic(req, res, url);

    } catch (error) {
      logger.error('Web request error', { url: url.pathname, error: error.message });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }

  async handleAPI(req, res, url) {
    res.setHeader('Content-Type', 'application/json');

    switch (url.pathname) {
      case '/api/status':
        res.writeHead(200);
        res.end(JSON.stringify({
          uptime: Date.now() - STATE.stats.uptime,
          stats: STATE.stats,
          config: {
            oscHost: CONFIG.OSC_HOST,
            oscSendPort: CONFIG.OSC_SEND_PORT,
            oscReceivePort: CONFIG.OSC_RECEIVE_PORT
          }
        }));
        break;

      case '/api/logs':
        res.writeHead(200);
        res.end(JSON.stringify(STATE.logs.slice(-100)));
        break;

      case '/api/patterns':
        if (req.method === 'GET') {
          res.writeHead(200);
          res.end(JSON.stringify(Array.from(STATE.oscPatterns.entries()).map(([address, pattern]) => ({
            address,
            ...pattern
          }))));
        } else if (req.method === 'POST') {
          const body = await this.readBody(req);
          const patterns = JSON.parse(body);
          
          // Update patterns
          STATE.oscPatterns.clear();
          patterns.forEach(pattern => {
            STATE.oscPatterns.set(pattern.address, pattern);
          });

          res.writeHead(200);
          res.end(JSON.stringify({ success: true }));
        }
        break;

      case '/api/test-osc':
        if (req.method === 'POST') {
          const body = await this.readBody(req);
          const { address, args } = JSON.parse(body);
          
          try {
            await oscManager.sendOSC(address, args || []);
            res.writeHead(200);
            res.end(JSON.stringify({ success: true, message: 'OSC message sent' }));
          } catch (error) {
            res.writeHead(400);
            res.end(JSON.stringify({ success: false, error: error.message }));
          }
        }
        break;

      default:
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
    }
  }

  async serveStatic(req, res, url) {
    // Try to serve from web-dashboard/dist first
    const webDistPath = join(__dirname, 'web-dashboard', 'dist');
    const indexPath = join(webDistPath, 'index.html');

    try {
      if (url.pathname === '/' || url.pathname === '/index.html') {
        if (existsSync(indexPath)) {
          const content = await readFile(indexPath);
          res.setHeader('Content-Type', 'text/html');
          res.writeHead(200);
          res.end(content);
          return;
        }
      }

      // Try to serve specific file from dist
      const filePath = join(webDistPath, url.pathname.slice(1));
      if (existsSync(filePath)) {
        const stats = await stat(filePath);
        if (stats.isFile()) {
          const content = await readFile(filePath);
          const ext = filePath.split('.').pop();
          const contentType = this.getContentType(ext);
          res.setHeader('Content-Type', contentType);
          res.writeHead(200);
          res.end(content);
          return;
        }
      }
    } catch (error) {
      logger.debug('Failed to serve from dist', { path: url.pathname, error: error.message });
    }

    // Fallback: serve minimal HTML dashboard
    res.setHeader('Content-Type', 'text/html');
    res.writeHead(200);
    res.end(this.getMinimalDashboard());
  }

  getContentType(ext) {
    const types = {
      'html': 'text/html',
      'css': 'text/css',
      'js': 'application/javascript',
      'json': 'application/json',
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'gif': 'image/gif',
      'svg': 'image/svg+xml'
    };
    return types[ext] || 'text/plain';
  }

  getMinimalDashboard() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MCP2OSC Dashboard</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; }
        .card { background: white; padding: 20px; margin: 20px 0; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .status { display: flex; gap: 20px; flex-wrap: wrap; }
        .stat { padding: 10px; background: #e8f4f8; border-radius: 4px; text-align: center; min-width: 120px; }
        .logs { max-height: 400px; overflow-y: auto; background: #f8f8f8; padding: 10px; border-radius: 4px; font-family: monospace; font-size: 12px; }
        .test-form { display: flex; gap: 10px; align-items: end; flex-wrap: wrap; }
        .test-form input, .test-form button { padding: 8px; border: 1px solid #ddd; border-radius: 4px; }
        .test-form button { background: #007cba; color: white; cursor: pointer; }
        .test-form button:hover { background: #005a87; }
        h1 { color: #333; }
        h2 { color: #666; margin-top: 30px; }
        .log-entry { margin: 2px 0; }
        .log-error { color: #d32f2f; }
        .log-warn { color: #f57c00; }
        .log-info { color: #1976d2; }
        .log-debug { color: #757575; }
    </style>
</head>
<body>
    <div class="container">
        <h1>MCP2OSC Dashboard</h1>
        
        <div class="card">
            <h2>System Status</h2>
            <div class="status" id="status">
                <div class="stat">
                    <div><strong>Uptime</strong></div>
                    <div id="uptime">Loading...</div>
                </div>
                <div class="stat">
                    <div><strong>MCP Messages</strong></div>
                    <div id="mcpMessages">0</div>
                </div>
                <div class="stat">
                    <div><strong>OSC Messages</strong></div>
                    <div id="oscMessages">0</div>
                </div>
                <div class="stat">
                    <div><strong>Errors</strong></div>
                    <div id="errors">0</div>
                </div>
                <div class="stat">
                    <div><strong>WebSocket</strong></div>
                    <div id="wsStatus">Disconnected</div>
                </div>
            </div>
        </div>

        <div class="card">
            <h2>Test OSC</h2>
            <div class="test-form">
                <div>
                    <label>Address:</label><br>
                    <input type="text" id="testAddress" placeholder="/test/message" value="/test/message">
                </div>
                <div>
                    <label>Arguments (JSON array):</label><br>
                    <input type="text" id="testArgs" placeholder='[440, 0.5, "hello"]' value='[440, 0.5]'>
                </div>
                <button onclick="sendTestOSC()">Send OSC</button>
            </div>
            <div id="testResult"></div>
        </div>

        <div class="card">
            <h2>Live Logs</h2>
            <div class="logs" id="logs">Connecting to log stream...</div>
        </div>
    </div>

    <script>
        let ws;
        let reconnectInterval;

        function connectWebSocket() {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            ws = new WebSocket(protocol + '//' + window.location.host);
            
            ws.onopen = function() {
                document.getElementById('wsStatus').textContent = 'Connected';
                document.getElementById('wsStatus').style.color = 'green';
                if (reconnectInterval) {
                    clearInterval(reconnectInterval);
                    reconnectInterval = null;
                }
            };
            
            ws.onmessage = function(event) {
                const message = JSON.parse(event.data);
                handleWebSocketMessage(message);
            };
            
            ws.onclose = function() {
                document.getElementById('wsStatus').textContent = 'Disconnected';
                document.getElementById('wsStatus').style.color = 'red';
                if (!reconnectInterval) {
                    reconnectInterval = setInterval(connectWebSocket, 5000);
                }
            };
            
            ws.onerror = function(error) {
                console.error('WebSocket error:', error);
            };
        }

        function handleWebSocketMessage(message) {
            switch (message.type) {
                case 'initial_state':
                    updateStatus(message.data.stats);
                    updateLogs(message.data.logs);
                    break;
                case 'log':
                    addLogEntry(message.data);
                    break;
                case 'stats':
                    updateStatus(message.data);
                    break;
            }
        }

        function updateStatus(stats) {
            if (stats) {
                document.getElementById('mcpMessages').textContent = stats.mcpMessages || 0;
                document.getElementById('oscMessages').textContent = stats.oscMessages || 0;
                document.getElementById('errors').textContent = stats.errors || 0;
                
                const uptime = Math.floor((Date.now() - stats.uptime) / 1000);
                document.getElementById('uptime').textContent = uptime + 's';
            }
        }

        function updateLogs(logs) {
            const logsContainer = document.getElementById('logs');
            logsContainer.innerHTML = '';
            logs.forEach(addLogEntry);
        }

        function addLogEntry(logEntry) {
            const logsContainer = document.getElementById('logs');
            const entry = document.createElement('div');
            entry.className = 'log-entry log-' + logEntry.level.toLowerCase();
            
            const timestamp = new Date(logEntry.timestamp).toLocaleTimeString();
            entry.textContent = timestamp + ' [' + logEntry.level + '] ' + logEntry.message;
            if (logEntry.data) {
                entry.textContent += ' ' + logEntry.data;
            }
            
            logsContainer.appendChild(entry);
            logsContainer.scrollTop = logsContainer.scrollHeight;
            
            // Keep only last 100 entries
            while (logsContainer.children.length > 100) {
                logsContainer.removeChild(logsContainer.firstChild);
            }
        }

        async function sendTestOSC() {
            const address = document.getElementById('testAddress').value;
            const argsText = document.getElementById('testArgs').value;
            const resultDiv = document.getElementById('testResult');
            
            try {
                const args = argsText ? JSON.parse(argsText) : [];
                
                const response = await fetch('/api/test-osc', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ address, args })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    resultDiv.innerHTML = '<div style="color: green; margin-top: 10px;">✓ ' + result.message + '</div>';
                } else {
                    resultDiv.innerHTML = '<div style="color: red; margin-top: 10px;">✗ ' + result.error + '</div>';
                }
            } catch (error) {
                resultDiv.innerHTML = '<div style="color: red; margin-top: 10px;">✗ ' + error.message + '</div>';
            }
        }

        // Start everything
        connectWebSocket();
        
        // Update status every 5 seconds
        setInterval(async function() {
            try {
                const response = await fetch('/api/status');
                const data = await response.json();
                updateStatus(data.stats);
            } catch (error) {
                console.error('Failed to fetch status:', error);
            }
        }, 5000);
    </script>
</body>
</html>`;
  }

  async readBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  }

  listen() {
    this.server.listen(CONFIG.WEB_PORT, () => {
      logger.info('Web server started', { port: CONFIG.WEB_PORT, url: `http://localhost:${CONFIG.WEB_PORT}` });
    });
  }
}

// ==================== MAIN APPLICATION ====================

// Global instances
let oscManager;
let mcpServer;
let webServer;

async function main() {
  try {
    // In MCP mode, suppress all console output except pure JSON responses
    if (CONFIG.IS_MCP_MODE) {
      // Redirect console methods to prevent stdout pollution
      console.log = () => {};
      console.info = () => {};
      console.warn = () => {};
      console.error = () => {};
    }

    logger.info('Starting MCP2OSC server', { config: CONFIG });

    // Initialize components
    oscManager = new OSCManager();
    mcpServer = new MCPServer();
    
    // In MCP mode, NEVER start web server (it causes port conflicts)
    if (!CONFIG.IS_MCP_MODE) {
      webServer = new WebServer();
      webServer.listen();
      logger.info('MCP2OSC server ready', { 
        mode: 'Standalone',
        webPort: CONFIG.WEB_PORT,
        oscPorts: `${CONFIG.OSC_SEND_PORT}/${CONFIG.OSC_RECEIVE_PORT}`
      });
    } else {
      logger.info('MCP2OSC server ready', { 
        mode: 'MCP',
        oscPorts: `${CONFIG.OSC_SEND_PORT}/${CONFIG.OSC_RECEIVE_PORT}`
      });
    }

    // Graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Shutting down MCP2OSC server');
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Shutting down MCP2OSC server');
      process.exit(0);
    });

  } catch (error) {
    logger.error('Failed to start MCP2OSC server', { error: error.message });
    process.exit(1);
  }
}

// Run the application
main();