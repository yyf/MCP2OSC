#!/usr/bin/env node

/**
 * MCP2OSC - Pure MCP Server (Clean Mode)
 * This version outputs ONLY pure JSON-RPC when called by Claude
 */

import { createSocket } from 'dgram';
import { writeFile, appendFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import MCP2OSCDatabase from './database.js';
import { addOSCMessage, getOSCMessages } from './shared-storage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Detect MCP mode - Claude calls via stdin
const IS_MCP_MODE = !process.stdin.isTTY;

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
const oscPatterns = new Map();
const receivedOSCMessages = [];

// MCP Server implementation
class PureMCPServer {
  constructor() {
    this.setupStdin();
    this.initializeOSC();
  }

  setupStdin() {
    if (!IS_MCP_MODE) return;

    // In MCP mode, completely silence all output except JSON responses
    process.stderr.write = () => {};
    
    // Log that we're starting to listen
    this.logActivity('MCP server starting - waiting for stdin data');
    
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (data) => {
      this.logActivity('MCP server received stdin data', { dataLength: data.length });
      
      const lines = data.toString().split('\n').filter(line => line.trim());
      for (const line of lines) {
        try {
          const message = JSON.parse(line);
          this.logActivity('MCP server parsed message', { method: message.method, id: message.id });
          this.handleMessage(message);
        } catch (error) {
          this.logActivity('MCP server JSON parse error', { error: error.message, line });
          // Send error response for malformed JSON
          this.sendError(null, -32700, 'Parse error');
        }
      }
    });

    process.stdin.on('end', () => {
      this.logActivity('MCP server stdin ended');
      process.exit(0);
    });
    
    this.logActivity('MCP server stdin setup complete');
  }

  async initializeOSC() {
    try {
      oscSendSocket = createSocket('udp4');
      
      // Note: OSC receiving is handled by dashboard server to avoid port conflicts
      // This MCP server only sends OSC messages and reads received messages from shared storage
      
      // Initialize database (optional - don't fail if it doesn't work)
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

  async ensureLogsDir() {
    const logsDir = dirname(CONFIG.LOG_FILE);
    if (!existsSync(logsDir)) {
      await mkdir(logsDir, { recursive: true });
    }
  }

  async logActivity(message, data = null) {
    try {
      const timestamp = new Date().toISOString();
      const logLine = `${timestamp} [MCP] ${message}${data ? ` ${JSON.stringify(data)}` : ''}\n`;
      await appendFile(CONFIG.LOG_FILE, logLine);
    } catch (error) {
      // Silently ignore logging errors in MCP mode
    }
  }

  async logSystemEvent(eventType, description, metadata = null) {
    if (database) {
      try {
        await database.logSystemEvent(eventType, description, metadata);
      } catch (error) {
        // Ignore database errors in MCP mode
      }
    }
  }

  async logMCPMessage(direction, method, messageId, content, userQuery = null, responseContent = null, processingTimeMs = null) {
    if (database) {
      try {
        return await database.logMCPMessage(direction, method, messageId, content, userQuery, responseContent, processingTimeMs);
      } catch (error) {
        // Ignore database errors in MCP mode
        return null;
      }
    }
    return null;
  }

  async logOSCMessage(direction, address, args, host, port, mcpMessageId = null) {
    if (database) {
      try {
        return await database.logOSCMessage(direction, address, args, host, port, mcpMessageId);
      } catch (error) {
        // Ignore database errors in MCP mode
        return null;
      }
    }
    return null;
  }

  handleMessage(message) {
    const { method, id, params } = message;
    const startTime = Date.now();

    // Log incoming MCP message
    this.logMCPMessage('inbound', method, id, message);

    // Handle notifications (no id field, no response needed)
    if (!id && id !== 0) {
      this.handleNotification(method, params);
      return;
    }

    // Handle requests (have id field, response needed)
    switch (method) {
      case 'initialize':
        this.handleInitialize(id, params, startTime);
        break;
      case 'tools/list':
        this.handleToolsList(id, startTime);
        break;
      case 'tools/call':
        this.handleToolCall(id, params, startTime);
        break;
      default:
        this.sendError(id, -32601, `Method not found: ${method}`, startTime);
    }
  }

  handleNotification(method, params) {
    // Handle notifications that don't require responses
    switch (method) {
      case 'notifications/initialized':
        this.logActivity('MCP client initialized');
        // No response needed for notifications
        break;
      case 'notifications/cancelled':
        this.logActivity('MCP operation cancelled', params);
        break;
      default:
        // Ignore unknown notifications
        this.logActivity('Unknown notification', { method, params });
    }
  }

  handleInitialize(id, params, startTime) {
    this.logActivity('MCP client connected', { protocol: params.protocolVersion });
    
    this.sendResponse({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: 'mcp2osc',
          version: '1.0.0'
        }
      }
    }, startTime);
  }

  handleToolsList(id, startTime) {
    this.sendResponse({
      jsonrpc: '2.0',
      id,
      result: {
        tools: [
          {
            name: 'send_osc_message',
            description: 'Send an OSC message to a creative application like MaxMSP, Processing, or TouchDesigner',
            inputSchema: {
              type: 'object',
              properties: {
                address: {
                  type: 'string',
                  description: 'OSC address pattern (e.g., /synth/freq, /visual/color)'
                },
                args: {
                  type: 'array',
                  description: 'Arguments to send with the OSC message',
                  items: {
                    oneOf: [
                      { type: 'number' },
                      { type: 'string' },
                      { type: 'boolean' }
                    ]
                  }
                },
                host: {
                  type: 'string',
                  description: 'Target host (default: 127.0.0.1)',
                  default: '127.0.0.1'
                },
                port: {
                  type: 'number',
                  description: 'Target port (default: 7500)',
                  default: 7500
                }
              },
              required: ['address']
            }
          },
          {
            name: 'generate_osc_patterns',
            description: 'Generate OSC address patterns for creative applications based on user intent',
            inputSchema: {
              type: 'object',
              properties: {
                intent: {
                  type: 'string',
                  description: 'Description of what the user wants to control (e.g., "music sequencer", "visual effects", "synthesizer")'
                },
                application: {
                  type: 'string',
                  description: 'Target application (e.g., "MaxMSP", "Processing", "TouchDesigner")',
                  default: 'MaxMSP'
                },
                complexity: {
                  type: 'string',
                  description: 'Pattern complexity level',
                  enum: ['simple', 'moderate', 'complex'],
                  default: 'moderate'
                }
              },
              required: ['intent']
            }
          },
          {
            name: 'get_received_osc_messages',
            description: 'Get OSC messages that have been received from external applications like MaxMSP, Processing, etc.',
            inputSchema: {
              type: 'object',
              properties: {
                limit: {
                  type: 'number',
                  description: 'Maximum number of recent messages to return (default: 10)',
                  default: 10
                },
                since: {
                  type: 'string',
                  description: 'ISO timestamp to get messages since (optional)',
                  format: 'date-time'
                },
                addressFilter: {
                  type: 'string',
                  description: 'Filter messages by address pattern (optional, substring match)'
                }
              }
            }
          }
        ]
      }
    }, startTime);
  }

  async getReceivedOSCMessages(args) {
    const { limit = 10, since = null, addressFilter = null } = args;
    
    // Get messages from shared storage (file-based) instead of local array
    let messages = getOSCMessages(100); // Get more than needed for filtering
    
    // Debug logging with detailed information
    this.logActivity(`Debug: Retrieved ${messages.length} messages from shared storage file`, { 
      requestedLimit: limit, 
      since, 
      addressFilter,
      storageFile: 'absolute path will be shown by shared-storage.js'
    });
    
    if (messages.length > 0) {
      this.logActivity(`Debug: Sample message from storage:`, messages[messages.length - 1]);
    } else {
      this.logActivity(`Debug: No messages in shared storage - checking if file exists`);
      try {
        const fs = await import('fs');
        const path = await import('path');
        const { fileURLToPath } = await import('url');
        
        // Use same path calculation as shared-storage.js
        const currentDir = path.dirname(fileURLToPath(import.meta.url));
        const expectedFile = path.join(currentDir, 'logs', 'osc-messages.json');
        
        const fileExists = fs.existsSync(expectedFile);
        this.logActivity(`Debug: Storage file exists: ${fileExists}`, { expectedFile });
        if (fileExists) {
          const fileContent = fs.readFileSync(expectedFile, 'utf8');
          this.logActivity(`Debug: File content length: ${fileContent.length} characters`);
          const data = JSON.parse(fileContent);
          this.logActivity(`Debug: File contains ${data.length} messages`);
          
          // CRITICAL FIX: If file has messages but getOSCMessages returned empty, use file data directly
          if (data.length > 0 && messages.length === 0) {
            this.logActivity('Debug: FALLBACK - Using direct file data since getOSCMessages() failed');
            messages = data;
          }
          
          // CRITICAL FIX: If file has messages but getOSCMessages returned empty, use file data directly
          if (data.length > 0 && messages.length === 0) {
            this.logActivity(`Debug: FALLBACK - Using direct file data since getOSCMessages() failed`);
            messages = data;
          }
        }
      } catch (error) {
        this.logActivity(`Debug: Error checking file:`, { error: error.message });
      }
    }
    
    // Filter by address if specified
    if (addressFilter) {
      messages = messages.filter(msg => msg.address && msg.address.includes(addressFilter));
      this.logActivity(`Debug: After address filter: ${messages.length} messages`);
    }
    
    // Filter by time if specified
    if (since) {
      const sinceTime = new Date(since);
      messages = messages.filter(msg => new Date(msg.timestamp) > sinceTime);
      this.logActivity(`Debug: After time filter: ${messages.length} messages`);
    }
    
    // Limit results
    messages = messages.slice(-limit);
    this.logActivity(`Debug: Final message count: ${messages.length}`);
    
    if (messages.length === 0) {
      this.logActivity('Debug: No messages found, returning default response');
      return "📭 **No OSC Messages Received**\n\n" +
             "No OSC messages have been received from external applications yet.\n\n" +
             "💡 **To receive OSC messages:**\n" +
             "1. Configure your creative application (MaxMSP, etc.) to send OSC to port 7501\n" +
             "2. Use address patterns like `/frommax/data` or `/feedback/control`\n" +
             "3. Send some test messages and run this tool again\n\n" +
             "🔧 **Example MaxMSP setup:** `udpsend 127.0.0.1 7501`\n\n" +
             "🔍 **Debug Info:** Checked shared storage file but found no messages.";
    }
    
    // Build response with actual messages
    let response = `📨 **Received OSC Messages** (${messages.length} recent)\n\n`;
    
    messages.forEach((msg, index) => {
      const time = new Date(msg.timestamp).toLocaleTimeString();
      response += `**${index + 1}. ${msg.address}**\n`;
      response += `   Time: ${time}\n`;
      response += `   Source: ${msg.source}:${msg.port}\n`;
      if (msg.args && msg.args.length > 0) {
        response += `   Arguments: [${msg.args.join(', ')}]\n`;
      }
      response += '\n';
    });
    
    response += `💡 **These messages were sent from your creative applications to MCP2OSC.**\n`;
    response += `🔄 **You can now use this data to respond with new OSC messages or process the information.**`;
    
    this.logActivity(`Debug: Returning response with ${messages.length} messages`);
    
    return response;
  }

  async handleToolCall(id, params, startTime) {
    const { name, arguments: args } = params;

    // Log every tool call
    this.logActivity(`MCP tool call received: ${name}`, { id, args });

    try {
      let result;
      let userQuery = null;
      
      // Extract user intent from arguments
      if (args.intent) {
        userQuery = `Generate OSC patterns for: ${args.intent}`;
      } else if (args.address) {
        userQuery = `Send OSC message to ${args.address} with args: ${JSON.stringify(args.args || [])}`;
      } else if (name === 'get_received_osc_messages') {
        userQuery = `Get received OSC messages`;
      }
      
      switch (name) {
        case 'send_osc_message':
          this.logActivity('Executing send_osc_message tool');
          result = await this.sendOSCMessage(args);
          break;
        case 'generate_osc_patterns':
          this.logActivity('Executing generate_osc_patterns tool');
          result = await this.generateOSCPatterns(args);
          break;
        case 'get_received_osc_messages':
          this.logActivity('Executing get_received_osc_messages tool - THIS IS THE CRITICAL ONE');
          result = await this.getReceivedOSCMessages(args);
          this.logActivity('get_received_osc_messages tool completed', { resultLength: result.length });
          break;
        default:
          this.logActivity(`Unknown tool: ${name}`);
          throw new Error(`Unknown tool: ${name}`);
      }

      const response = {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: result
            }
          ]
        }
      };

      // Log user query for dashboard display
      if (userQuery) {
        this.logActivity(`User Query: ${userQuery}`, { tool: name, args });
      }

      this.sendResponse(response, startTime);

    } catch (error) {
      this.sendError(id, -32603, error.message, startTime);
    }
  }

  handleIncomingOSC(buffer, rinfo) {
    // DEPRECATED: OSC receiving is now handled by dashboard server
    // This method is kept for compatibility but should not be called
    console.warn('WARNING: MCP server received OSC directly - this should be handled by dashboard server');
    
    try {
      const message = this.parseOSCMessage(buffer);
      if (message) {
        // Store in shared storage as backup
        addOSCMessage(message.address, message.args, rinfo.address, rinfo.port);
        
        // Log the received message
        this.logActivity(`OSC received (backup handler): ${message.address} [${message.args.join(', ')}] from ${rinfo.address}:${rinfo.port}`, {
          address: message.address,
          args: message.args,
          source: rinfo.address,
          port: rinfo.port
        });
      }
    } catch (error) {
      this.logActivity('Error parsing incoming OSC message', { error: error.message });
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

  async sendOSCMessage(args) {
    const { address, args: oscArgs = [], host = CONFIG.OSC_HOST, port = CONFIG.OSC_SEND_PORT } = args;
    const startTime = Date.now();

    if (!address || !address.startsWith('/')) {
      throw new Error('OSC address must start with "/"');
    }

    const message = this.createOSCMessage(address, oscArgs);
    
    return new Promise((resolve, reject) => {
      oscSendSocket.send(message, port, host, async (error) => {
        const deliveryTime = Date.now() - startTime;
        
        if (error) {
          // Log failed OSC message
          await this.logOSCMessage('outbound', address, oscArgs, host, port);
          reject(new Error(`Failed to send OSC message: ${error.message}`));
        } else {
          // Log successful OSC message
          const oscId = await this.logOSCMessage('outbound', address, oscArgs, host, port);
          
          this.logActivity(`OSC message sent: ${address} [${oscArgs.join(', ')}] → ${host}:${port}`, { 
            address, 
            args: oscArgs, 
            host, 
            port, 
            deliveryTime 
          });
          
          // Store pattern for future reference
          oscPatterns.set(address, {
            description: `OSC pattern for ${address}`,
            args: oscArgs.map(arg => typeof arg),
            lastUsed: new Date().toISOString(),
            usageCount: (oscPatterns.get(address)?.usageCount || 0) + 1
          });

          // Save pattern to database if available
          if (database) {
            try {
              await database.saveOSCPattern(
                address, 
                `Auto-generated pattern for ${address}`,
                oscArgs.map(arg => typeof arg),
                'mcp',
                'Generated from MCP tool call'
              );
              await database.updatePatternUsage(address);
            } catch (dbError) {
              // Ignore database errors
            }
          }

          const responseText = `✅ OSC message sent successfully!\n\n` +
            `📡 **Message Details:**\n` +
            `• Address: ${address}\n` +
            `• Arguments: ${JSON.stringify(oscArgs)}\n` +
            `• Destination: ${host}:${port}\n` +
            `• Delivery time: ${deliveryTime}ms\n\n` +
            `🎵 The message has been sent to your creative application.\n` +
            `💡 Check your application's OSC receiver to see the incoming data.`;

          resolve(responseText);
        }
      });
    });
  }

  async generateOSCPatterns(args) {
    const { intent, application = 'MaxMSP', complexity = 'moderate' } = args;

    const patterns = this.generatePatternsForIntent(intent, application, complexity);
    
    // Store generated patterns in memory and database
    for (const pattern of patterns) {
      oscPatterns.set(pattern.address, {
        description: pattern.description,
        args: pattern.expectedArgs,
        generated: true,
        intent,
        lastUsed: null,
        usageCount: 0
      });

      // Save to database if available
      if (database) {
        try {
          await database.saveOSCPattern(
            pattern.address,
            pattern.description,
            pattern.expectedArgs,
            'generated',
            intent
          );
        } catch (dbError) {
          // Ignore database errors
        }
      }
    }

    this.logActivity('Generated OSC patterns', { intent, application, patternCount: patterns.length });

    return this.formatPatternsResponse(patterns, intent, application);
  }

  generatePatternsForIntent(intent, application, complexity) {
    const lowerIntent = intent.toLowerCase();
    let patterns = [];

    // Music/Audio patterns
    if (lowerIntent.includes('music') || lowerIntent.includes('audio') || lowerIntent.includes('synth')) {
      patterns.push(
        { address: '/music/tempo', description: 'Set tempo in BPM', expectedArgs: ['number'] },
        { address: '/music/volume', description: 'Set overall volume (0.0-1.0)', expectedArgs: ['number'] },
        { address: '/synth/freq', description: 'Set synthesizer frequency in Hz', expectedArgs: ['number'] },
        { address: '/synth/amp', description: 'Set synthesizer amplitude (0.0-1.0)', expectedArgs: ['number'] }
      );

      if (complexity !== 'simple') {
        patterns.push(
          { address: '/music/scale', description: 'Set musical scale', expectedArgs: ['string'] },
          { address: '/effects/reverb', description: 'Control reverb amount (0.0-1.0)', expectedArgs: ['number'] },
          { address: '/effects/delay', description: 'Control delay time in ms', expectedArgs: ['number'] }
        );
      }
    }

    // Visual patterns
    if (lowerIntent.includes('visual') || lowerIntent.includes('video') || lowerIntent.includes('color')) {
      patterns.push(
        { address: '/visual/color/r', description: 'Set red color component (0-255)', expectedArgs: ['number'] },
        { address: '/visual/color/g', description: 'Set green color component (0-255)', expectedArgs: ['number'] },
        { address: '/visual/color/b', description: 'Set blue color component (0-255)', expectedArgs: ['number'] },
        { address: '/visual/brightness', description: 'Set brightness (0.0-1.0)', expectedArgs: ['number'] }
      );

      if (complexity !== 'simple') {
        patterns.push(
          { address: '/visual/position/x', description: 'Set X position', expectedArgs: ['number'] },
          { address: '/visual/position/y', description: 'Set Y position', expectedArgs: ['number'] },
          { address: '/visual/size', description: 'Set size/scale', expectedArgs: ['number'] },
          { address: '/visual/rotation', description: 'Set rotation in degrees', expectedArgs: ['number'] }
        );
      }
    }

    // Control patterns
    if (lowerIntent.includes('control') || lowerIntent.includes('parameter')) {
      patterns.push(
        { address: '/control/param1', description: 'Generic parameter 1', expectedArgs: ['number'] },
        { address: '/control/param2', description: 'Generic parameter 2', expectedArgs: ['number'] },
        { address: '/control/trigger', description: 'Trigger event', expectedArgs: ['number'] }
      );
    }

    // Default fallback patterns
    if (patterns.length === 0) {
      patterns = [
        { address: '/control/value', description: 'Generic control value', expectedArgs: ['number'] },
        { address: '/trigger/bang', description: 'Trigger event', expectedArgs: [] },
        { address: '/param/float', description: 'Floating point parameter', expectedArgs: ['number'] },
        { address: '/param/string', description: 'String parameter', expectedArgs: ['string'] }
      ];
    }

    return patterns;
  }

  formatPatternsResponse(patterns, intent, application) {
    let response = `🎵 Generated OSC patterns for: "${intent}" (${application})\n\n`;
    
    patterns.forEach((pattern, index) => {
      response += `${index + 1}. **${pattern.address}**\n`;
      response += `   ${pattern.description}\n`;
      response += `   Expected args: ${pattern.expectedArgs.join(', ') || 'none'}\n\n`;
    });

    response += `💡 **Usage Example:**\n`;
    response += `Use the "send_osc_message" tool with these addresses:\n`;
    response += `• Address: ${patterns[0].address}\n`;
    response += `• Arguments: [${patterns[0].expectedArgs.includes('number') ? '0.5' : patterns[0].expectedArgs.includes('string') ? '"hello"' : ''}]\n\n`;
    
    response += `🔗 **Integration:**\n`;
    response += `These patterns are ready to use with ${application} or any OSC-compatible application listening on port 7500.`;

    return response;
  }

  createOSCMessage(address, args) {
    // Create OSC message buffer
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
        return Buffer.alloc(0); // T/F tags don't have data
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

  sendResponse(response, startTime = null) {
    if (IS_MCP_MODE) {
      // CRITICAL: Only pure JSON output in MCP mode
      const jsonString = JSON.stringify(response);
      process.stdout.write(jsonString + '\n');
      
      // Log outbound response
      const processingTime = startTime ? Date.now() - startTime : null;
      this.logMCPMessage('outbound', 'response', response.id, response, null, JSON.stringify(response.result || response.error), processingTime);
    }
  }

  sendError(id, code, message, startTime = null) {
    const errorResponse = {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message
      }
    };
    this.sendResponse(errorResponse, startTime);
  }
}

// Only run MCP server if in MCP mode
if (IS_MCP_MODE) {
  // Completely suppress all output except JSON responses
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk, encoding, callback) => {
    // Only allow our JSON responses through
    if (typeof chunk === 'string' && chunk.startsWith('{')) {
      return originalWrite.call(process.stdout, chunk, encoding, callback);
    }
    // Suppress everything else
    if (typeof callback === 'function') callback();
    return true;
  };

  // Suppress console output in MCP mode, but allow errors to stderr
  console.log = () => {};
  console.info = () => {};
  console.warn = (msg) => {
    if (!IS_MCP_MODE) process.stderr.write(`WARN: ${msg}\n`);
  };
  // Keep console.error for debugging

  new PureMCPServer();
} else {
  console.log('❌ This is the pure MCP server. Use the main mcp-server.js for standalone mode.');
  process.exit(1);
}