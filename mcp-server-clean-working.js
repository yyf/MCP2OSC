#!/usr/bin/env node

// Clean imports - no duplicates
import { createSocket } from 'dgram';
import { writeFile, appendFile, mkdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import MCP2OSCDatabase from './database.js';
import { OSCMessageStore } from './osc-message-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Check if we're running in MCP mode or standalone
const IS_MCP_MODE = process.argv.includes('--mcp') || 
                   process.stdout.isTTY === false ||
                   process.env.NODE_ENV === 'production';

// Configuration
const CONFIG = {
  OSC_SEND_PORT: 7500,
  OSC_RECEIVE_PORT: 7501,
  OSC_HOST: '127.0.0.1',
  LOG_FILE: join(__dirname, 'logs', 'mcp2osc.log'),
  IS_MCP_MODE
};

// Global state
let oscSendSocket = null;
let oscReceiveSocket = null;
let database = null;
let oscMessageStore = null;
const oscPatterns = new Map();

// MCP Server Class
class MCP2OSCServer {
  constructor() {
    this.initializeOSC();
  }

  async initializeOSC() {
    try {
      oscSendSocket = createSocket('udp4');
      
      // Initialize shared OSC message store
      oscMessageStore = new OSCMessageStore();
      
      // Only set up OSC receiver if NOT running in MCP mode for Claude
      // This prevents port conflicts when both dashboard and Claude try to bind the same port
      if (!IS_MCP_MODE) {
        oscReceiveSocket = createSocket('udp4');
        
        // Setup OSC receiver
        oscReceiveSocket.on('message', (buffer, rinfo) => {
          this.handleIncomingOSC(buffer, rinfo);
        });
        
        oscReceiveSocket.on('error', (error) => {
          console.warn('OSC receive socket error:', error.message);
        });
        
        // Bind the receive socket
        oscReceiveSocket.bind(CONFIG.OSC_RECEIVE_PORT, CONFIG.OSC_HOST, () => {
          this.logActivity(`OSC receiver listening on ${CONFIG.OSC_HOST}:${CONFIG.OSC_RECEIVE_PORT}`);
          console.error(`[DEBUG] MCP server OSC receiver bound to ${CONFIG.OSC_HOST}:${CONFIG.OSC_RECEIVE_PORT}`);
        });
        
        oscReceiveSocket.on('listening', () => {
          const address = oscReceiveSocket.address();
          console.error(`[DEBUG] OSC socket listening on ${address.address}:${address.port}`);
        });
      } else {
        // In MCP mode (for Claude), we only send OSC, we don't receive
        // The dashboard subprocess handles OSC reception and stores messages in shared storage
        console.error(`[DEBUG] Running in MCP mode - OSC reception handled by dashboard subprocess`);
      }
      
      // Initialize database (optional)
      try {
        database = new MCP2OSCDatabase();
        await database.initialize();
        await this.logSystemEvent('server_started', 'MCP2OSC server initialized with database');
      } catch (dbError) {
        console.warn('Database initialization failed, continuing without database:', dbError.message);
        database = null;
      }
      
      await this.ensureLogsDir();
    } catch (error) {
      if (IS_MCP_MODE) {
        this.sendError(null, -32603, 'Failed to initialize OSC');
      }
    }
  }

  handleIncomingOSC(buffer, rinfo) {
    // This method is only called when running as subprocess (not in MCP mode)
    try {
      console.error(`[DEBUG] Subprocess received OSC from ${rinfo.address}:${rinfo.port}`);
      
      const message = this.parseOSCMessage(buffer);
      if (message) {
        console.error(`[DEBUG] Parsed OSC message: ${message.address} [${message.args.join(', ')}]`);
        
        const oscMessage = {
          address: message.address,
          args: message.args,
          source: `${rinfo.address}:${rinfo.port}`,
          host: rinfo.address,
          port: rinfo.port
        };
        
        if (oscMessageStore) {
          oscMessageStore.addMessage(oscMessage).then(() => {
            console.error(`[DEBUG] Stored OSC message in shared store`);
          }).catch(error => {
            console.error(`[DEBUG] Failed to store OSC message: ${error.message}`);
            this.logActivity('Failed to store OSC message', { error: error.message });
          });
        } else {
          console.error(`[DEBUG] oscMessageStore is not initialized!`);
        }
        
        this.logActivity(`OSC received: ${message.address} [${message.args.join(', ')}] from ${rinfo.address}:${rinfo.port}`, {
          address: message.address,
          args: message.args,
          source: rinfo.address,
          port: rinfo.port
        });
        
        if (database) {
          this.logOSCMessage('inbound', message.address, message.args, rinfo.address, rinfo.port);
        }
      }
    } catch (error) {
      console.error(`[DEBUG] Error in handleIncomingOSC: ${error.message}`);
      this.logActivity('Error parsing incoming OSC message', { error: error.message });
    }
  }

  parseOSCMessage(buffer) {
    try {
      let offset = 0;
      
      // Read address
      let address = '';
      while (offset < buffer.length && buffer[offset] !== 0) {
        address += String.fromCharCode(buffer[offset]);
        offset++;
      }
      
      // Skip padding
      offset++;
      while (offset % 4 !== 0 && offset < buffer.length) offset++;
      
      if (offset >= buffer.length) {
        return { address, args: [] };
      }
      
      // Read type tag
      let typeTag = '';
      if (buffer[offset] === 44) {
        offset++;
        while (offset < buffer.length && buffer[offset] !== 0) {
          typeTag += String.fromCharCode(buffer[offset]);
          offset++;
        }
      }
      
      offset++;
      while (offset % 4 !== 0 && offset < buffer.length) offset++;
      
      // Parse arguments
      const args = [];
      for (let i = 0; i < typeTag.length; i++) {
        const type = typeTag[i];
        
        switch (type) {
          case 'i':
            if (offset + 4 <= buffer.length) {
              args.push(buffer.readInt32BE(offset));
              offset += 4;
            }
            break;
          case 'f':
            if (offset + 4 <= buffer.length) {
              args.push(buffer.readFloatBE(offset));
              offset += 4;
            }
            break;
          case 's':
            let str = '';
            while (offset < buffer.length && buffer[offset] !== 0) {
              str += String.fromCharCode(buffer[offset]);
              offset++;
            }
            args.push(str);
            offset++;
            while (offset % 4 !== 0 && offset < buffer.length) offset++;
            break;
          case 'T':
            args.push(true);
            break;
          case 'F':
            args.push(false);
            break;
          case 'N':
            args.push(null);
            break;
        }
      }
      
      return { address, args };
    } catch (error) {
      throw new Error(`OSC parsing failed: ${error.message}`);
    }
  }

  async getReceivedOSCMessages(args) {
    const { limit = 10, since = null, addressFilter = null } = args;
    
    try {
      console.error(`[DEBUG] Getting received OSC messages, store exists: ${!!oscMessageStore}`);
      
      const messages = oscMessageStore ? 
        await oscMessageStore.getMessages({ limit, since, addressFilter }) : 
        [];
      
      console.error(`[DEBUG] Found ${messages.length} OSC messages in store`);
      
      if (messages.length === 0) {
        return "📭 **No OSC Messages Received**\n\n" +
               "No OSC messages have been received from external applications yet.\n\n" +
               "💡 **To receive OSC messages:**\n" +
               "1. Configure your creative application (MaxMSP, etc.) to send OSC to port 7501\n" +
               "2. Use address patterns like `/frommax/data` or `/feedback/control`\n" +
               "3. Send some test messages and run this tool again\n\n" +
               "🔧 **Example MaxMSP setup:** `udpsend 127.0.0.1 7501`";
      }
      
      let response = `📨 **Received OSC Messages** (${messages.length} recent)\n\n`;
      
      messages.forEach((msg, index) => {
        const time = new Date(msg.timestamp).toLocaleTimeString();
        response += `**${index + 1}. ${msg.address}**\n`;
        response += `   Time: ${time}\n`;
        response += `   Source: ${msg.source}\n`;
        if (msg.args && msg.args.length > 0) {
          response += `   Arguments: [${msg.args.join(', ')}]\n`;
        }
        response += '\n';
      });
      
      response += `💡 **These messages were sent from your creative applications to MCP2OSC.**\n`;
      response += `🔄 **You can now use this data to respond with new OSC messages or process the information.**`;
      
      return response;
    } catch (error) {
      console.error(`[DEBUG] Error in getReceivedOSCMessages: ${error.message}`);
      this.logActivity('Error getting received OSC messages', { error: error.message });
      return "❌ **Error Reading OSC Messages**\n\n" +
             "There was an error reading received OSC messages. Check the logs for details.";
    }
  }

  async sendOSCMessage(address, args = [], host = CONFIG.OSC_HOST, port = CONFIG.OSC_SEND_PORT) {
    const startTime = Date.now();
    const oscArgs = Array.isArray(args) ? args : [];
    
    const message = this.buildOSCMessage(address, oscArgs);
    
    return new Promise((resolve, reject) => {
      oscSendSocket.send(message, port, host, async (error) => {
        const deliveryTime = Date.now() - startTime;
        
        if (error) {
          await this.logOSCMessage('outbound', address, oscArgs, host, port);
          reject(new Error(`Failed to send OSC message: ${error.message}`));
        } else {
          await this.logOSCMessage('outbound', address, oscArgs, host, port);
          
          this.logActivity(`OSC message sent: ${address} [${oscArgs.join(', ')}] → ${host}:${port}`, { 
            address, 
            args: oscArgs, 
            host, 
            port, 
            deliveryTime 
          });
          
          resolve({
            success: true,
            address,
            args: oscArgs,
            host,
            port,
            deliveryTime
          });
        }
      });
    });
  }

  buildOSCMessage(address, args) {
    // Build OSC address
    let addressBuffer = Buffer.from(address + '\0');
    const addressPadding = 4 - (addressBuffer.length % 4);
    if (addressPadding < 4) {
      addressBuffer = Buffer.concat([addressBuffer, Buffer.alloc(addressPadding)]);
    }

    // Build type tag
    let typeTag = ',';
    const argBuffers = [];
    
    for (const arg of args) {
      if (typeof arg === 'number' && Number.isInteger(arg)) {
        typeTag += 'i';
        const buf = Buffer.alloc(4);
        buf.writeInt32BE(arg, 0);
        argBuffers.push(buf);
      } else if (typeof arg === 'number') {
        typeTag += 'f';
        const buf = Buffer.alloc(4);
        buf.writeFloatBE(arg, 0);
        argBuffers.push(buf);
      } else if (typeof arg === 'string') {
        typeTag += 's';
        let strBuffer = Buffer.from(arg + '\0');
        const strPadding = 4 - (strBuffer.length % 4);
        if (strPadding < 4) {
          strBuffer = Buffer.concat([strBuffer, Buffer.alloc(strPadding)]);
        }
        argBuffers.push(strBuffer);
      } else if (typeof arg === 'boolean') {
        typeTag += arg ? 'T' : 'F';
      }
    }

    // Build type tag buffer
    let typeTagBuffer = Buffer.from(typeTag + '\0');
    const typeTagPadding = 4 - (typeTagBuffer.length % 4);
    if (typeTagPadding < 4) {
      typeTagBuffer = Buffer.concat([typeTagBuffer, Buffer.alloc(typeTagPadding)]);
    }

    return Buffer.concat([addressBuffer, typeTagBuffer, ...argBuffers]);
  }

  // MCP Protocol handling
  handleMCPRequest(input) {
    try {
      const request = JSON.parse(input);
      
      switch (request.method) {
        case 'initialize':
          this.sendResponse(request.id, {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'mcp2osc', version: '1.0.0' }
          });
          break;
          
        case 'tools/list':
          this.sendResponse(request.id, {
            tools: [
              {
                name: 'send_osc_message',
                description: 'Send an OSC message to a creative application',
                inputSchema: {
                  type: 'object',
                  properties: {
                    address: { type: 'string', description: 'OSC address pattern (e.g., /synth/freq)' },
                    args: { type: 'array', description: 'Array of arguments (numbers, strings, booleans)' },
                    host: { type: 'string', description: 'Target host (default: 127.0.0.1)', default: '127.0.0.1' },
                    port: { type: 'number', description: 'Target port (default: 7500)', default: 7500 }
                  },
                  required: ['address']
                }
              },
              {
                name: 'get_received_osc_messages',
                description: 'Get OSC messages that have been received from external applications',
                inputSchema: {
                  type: 'object',
                  properties: {
                    limit: { type: 'number', description: 'Maximum number of recent messages (default: 10)', default: 10 },
                    since: { type: 'string', description: 'ISO timestamp to get messages since (optional)' },
                    addressFilter: { type: 'string', description: 'Filter by address pattern (optional)' }
                  }
                }
              }
            ]
          });
          break;
          
        case 'tools/call':
          this.handleToolCall(request);
          break;
          
        default:
          this.sendError(request.id, -32601, `Unknown method: ${request.method}`);
      }
    } catch (error) {
      this.sendError(null, -32700, 'Parse error');
    }
  }

  async handleToolCall(request) {
    const { name, arguments: args } = request.params;
    
    try {
      let result;
      
      switch (name) {
        case 'send_osc_message':
          result = await this.handleSendOSC(args);
          break;
        case 'get_received_osc_messages':
          result = await this.getReceivedOSCMessages(args);
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
      
      this.sendResponse(request.id, {
        content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }]
      });
    } catch (error) {
      this.sendError(request.id, -32603, error.message);
    }
  }

  async handleSendOSC(args) {
    const { address, args: oscArgs = [], host = CONFIG.OSC_HOST, port = CONFIG.OSC_SEND_PORT } = args;
    
    if (!address) {
      throw new Error('OSC address is required');
    }
    
    const result = await this.sendOSCMessage(address, oscArgs, host, port);
    
    return `🎵 **OSC Message Sent Successfully**\n\n` +
           `**Address:** ${address}\n` +
           `**Arguments:** [${oscArgs.join(', ')}]\n` +
           `**Destination:** ${host}:${port}\n` +
           `**Delivery Time:** ${result.deliveryTime}ms\n\n` +
           `💡 The message has been sent to your creative application.`;
  }

  async logActivity(message, data = null) {
    try {
      const timestamp = new Date().toISOString();
      const logEntry = `${timestamp} [MCP] ${message}`;
      
      if (data) {
        const dataStr = typeof data === 'object' ? JSON.stringify(data) : data;
        console.error(`${logEntry} ${dataStr}`);
      }
      
      await appendFile(CONFIG.LOG_FILE, logEntry + '\n');
    } catch (error) {
      console.error('Failed to write log:', error.message);
    }
  }

  async ensureLogsDir() {
    try {
      const logsDir = join(__dirname, 'logs');
      if (!existsSync(logsDir)) {
        await mkdir(logsDir, { recursive: true });
      }
    } catch (error) {
      console.warn('Failed to create logs directory:', error.message);
    }
  }

  async logSystemEvent(event, message) {
    await this.logActivity(`System event: ${event} - ${message}`);
  }

  async logOSCMessage(direction, address, args, host, port) {
    await this.logActivity(`OSC ${direction}: ${address} [${args.join(', ')}] ${host}:${port}`);
  }

  sendError(id, code, message) {
    const error = { jsonrpc: '2.0', id, error: { code, message } };
    console.log(JSON.stringify(error));
  }

  sendResponse(id, result) {
    const response = { jsonrpc: '2.0', id, result };
    console.log(JSON.stringify(response));
  }
}

// Initialize server
const server = new MCP2OSCServer();

// Handle MCP input if running in MCP mode
if (IS_MCP_MODE) {
  let inputBuffer = '';
  
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    inputBuffer += chunk;
    const lines = inputBuffer.split('\n');
    inputBuffer = lines.pop() || '';
    
    lines.forEach(line => {
      if (line.trim()) {
        server.handleMCPRequest(line.trim());
      }
    });
  });
  
  process.stdin.on('end', () => {
    if (inputBuffer.trim()) {
      server.handleMCPRequest(inputBuffer.trim());
    }
  });
}

// Handle process termination
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));