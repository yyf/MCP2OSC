#!/usr/bin/env node

/**
 * MaxMSP-Compatible MCP Server
 * Prevents conflicts with MaxMSP's Node for Max process manager
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createSocket } from 'dgram';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Set process title to avoid MaxMSP conflicts
process.title = 'mcp2osc-server';

// Configuration with MaxMSP compatibility
const CONFIG = {
  OSC_SEND_PORT: parseInt(process.env.OSC_SEND_PORT || '7500'),
  OSC_RECEIVE_PORT: parseInt(process.env.OSC_RECEIVE_PORT || '7501'),
  OSC_HOST: process.env.OSC_HOST || process.env.DEFAULT_OSC_HOST || '127.0.0.1',
  PATTERNS_FILE: path.join(__dirname, 'extracted-osc-patterns.json'),
  LOG_FILE: path.join(__dirname, 'logs', 'mcp2osc.log'),
  OSC_MESSAGES_FILE: path.join(__dirname, 'logs', 'osc-messages.json'),
  // MaxMSP compatibility settings
  SOCKET_REUSE: true,
  GRACEFUL_MAXMSP: true,
  ATOMIC_WRITES: true
};

class MaxMSPCompatibleMCPServer {
  constructor() {
    this.server = new Server(
      {
        name: 'mcp2osc-maxmsp-compatible',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.oscSendSocket = null;
    this.oscReceiveSocket = null;
    this.isShuttingDown = false;
    this.fileWriteQueue = new Map(); // Prevent concurrent file writes
    
    this.setupToolHandlers();
    console.error('🚀 MaxMSP-Compatible MCP Server initialized');
    console.error(`🔧 OSC Configuration: ${CONFIG.OSC_HOST}:${CONFIG.OSC_SEND_PORT} (send) / ${CONFIG.OSC_HOST}:${CONFIG.OSC_RECEIVE_PORT} (receive)`);
  }

  async setupOSCReceiver() {
    try {
      // Create socket with MaxMSP compatibility options
      this.oscReceiveSocket = createSocket({ 
        type: 'udp4',
        reuseAddr: CONFIG.SOCKET_REUSE 
      });
      
      this.oscReceiveSocket.on('message', async (msg, rinfo) => {
        try {
          const message = {
            timestamp: new Date().toISOString(),
            address: this.parseOSCAddress(msg),
            args: this.parseOSCArgs(msg),
            source: {
              address: rinfo.address,
              port: rinfo.port
            },
            direction: 'inbound',
            raw: msg.toString('hex')
          };
          
          console.error(`📥 OSC received: ${message.address} [${message.args.join(', ')}] from ${rinfo.address}:${rinfo.port}`);
          
          // Use atomic write to prevent corruption
          await this.atomicWriteOSCMessage(message);
          
        } catch (error) {
          console.error(`Error processing OSC message: ${error.message}`);
        }
      });
      
      this.oscReceiveSocket.on('error', (error) => {
        if (!this.isShuttingDown) {
          console.error(`OSC receive socket error: ${error.message}`);
        }
      });
      
      // Bind with error handling for MaxMSP compatibility
      await new Promise((resolve, reject) => {
        this.oscReceiveSocket.bind(CONFIG.OSC_RECEIVE_PORT, CONFIG.OSC_HOST, (error) => {
          if (error) {
            console.error(`Failed to bind OSC receiver: ${error.message}`);
            // Don't reject - continue without receiver to avoid blocking MCP
            resolve();
          } else {
            console.error(`📡 OSC receiver listening on ${CONFIG.OSC_HOST}:${CONFIG.OSC_RECEIVE_PORT}`);
            resolve();
          }
        });
      });
      
    } catch (error) {
      console.error('❌ Failed to setup OSC receiver:', error.message);
      // Continue without receiver - don't block MCP functionality
    }
  }

  parseOSCAddress(buffer) {
    try {
      const nullIndex = buffer.indexOf(0);
      return nullIndex > 0 ? buffer.slice(0, nullIndex).toString('utf8') : '/unknown';
    } catch (error) {
      return '/parse-error';
    }
  }

  parseOSCArgs(buffer) {
    try {
      // Proper OSC argument parsing
      let offset = 0;
      
      // Skip address (null-terminated string)
      while (offset < buffer.length && buffer[offset] !== 0) {
        offset++;
      }
      offset++; // Skip null terminator
      while (offset % 4 !== 0 && offset < buffer.length) offset++; // Skip padding
      
      if (offset >= buffer.length) return [];
      
      // Read type tag string if it exists
      let typeTag = '';
      if (buffer[offset] === 44) { // ',' character starts type tag
        offset++; // Skip comma
        while (offset < buffer.length && buffer[offset] !== 0) {
          typeTag += String.fromCharCode(buffer[offset]);
          offset++;
        }
        offset++; // Skip null terminator
        while (offset % 4 !== 0 && offset < buffer.length) offset++; // Skip padding
      }
      
      // Parse arguments based on type tags
      const args = [];
      for (let i = 0; i < typeTag.length; i++) {
        const type = typeTag[i];
        
        if (offset + 4 > buffer.length) break;
        
        switch (type) {
          case 'i': // 32-bit integer
            args.push(buffer.readInt32BE(offset));
            offset += 4;
            break;
          case 'f': // 32-bit float
            args.push(buffer.readFloatBE(offset));
            offset += 4;
            break;
          case 's': // String
            let str = '';
            while (offset < buffer.length && buffer[offset] !== 0) {
              str += String.fromCharCode(buffer[offset]);
              offset++;
            }
            args.push(str);
            offset++; // Skip null terminator
            while (offset % 4 !== 0 && offset < buffer.length) offset++; // Skip padding
            break;
          case 'T': // True
            args.push(true);
            break;
          case 'F': // False
            args.push(false);
            break;
          case 'N': // Null
            args.push(null);
            break;
          default:
            // Skip unknown type
            offset += 4;
        }
      }
      
      return args;
    } catch (error) {
      console.error('OSC parsing error:', error.message);
      return [];
    }
  }

  async atomicWriteOSCMessage(message) {
    const fileName = CONFIG.OSC_MESSAGES_FILE;
    
    // Prevent concurrent writes to same file
    if (this.fileWriteQueue.has(fileName)) {
      await this.fileWriteQueue.get(fileName);
    }
    
    const writePromise = this._performAtomicWrite(fileName, message);
    this.fileWriteQueue.set(fileName, writePromise);
    
    try {
      await writePromise;
    } finally {
      this.fileWriteQueue.delete(fileName);
    }
  }

  async _performAtomicWrite(fileName, newMessage) {
    try {
      // Ensure directory exists
      await fs.mkdir(path.dirname(fileName), { recursive: true });
      
      // Read existing messages
      let messages = [];
      try {
        const content = await fs.readFile(fileName, 'utf8');
        messages = JSON.parse(content);
      } catch (error) {
        // File doesn't exist or is empty
      }
      
      // Add new message
      messages.push(newMessage);
      
      // Keep only last 1000 messages
      if (messages.length > 1000) {
        messages = messages.slice(-1000);
      }
      
      // Atomic write: temp file + rename
      const tempFile = fileName + '.tmp';
      await fs.writeFile(tempFile, JSON.stringify(messages, null, 2));
      await fs.rename(tempFile, fileName);
      
    } catch (error) {
      console.error(`Failed atomic write to ${fileName}:`, error.message);
    }
  }

  setupToolHandlers() {
    // Register tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      console.error('📋 Claude requesting MaxMSP-compatible tool list...');
      
      return {
        tools: [
          {
            name: 'send_osc_message',
            description: 'Send OSC messages to MaxMSP and other creative applications. Automatically logs with direction tracking for dashboard display.',
            inputSchema: {
              type: 'object',
              properties: {
                address: { type: 'string', description: 'OSC address (must start with /)' },
                args: { type: 'array', default: [], description: 'Arguments to send' },
                host: { type: 'string', default: '127.0.0.1', description: 'Target host' },
                port: { type: 'number', default: 7500, description: 'Target port' }
              },
              required: ['address']
            }
          },
          {
            name: 'get_received_osc_messages',
            description: 'Get OSC messages received from MaxMSP and other applications with direction filtering.',
            inputSchema: {
              type: 'object',
              properties: {
                addressPattern: { type: 'string', description: 'Filter by address pattern' },
                limit: { type: 'number', default: 50 }
              }
            }
          },
          {
            name: 'save_osc_pattern',
            description: 'Save OSC address patterns with metadata for creative applications like MaxMSP, TouchDesigner, or Processing',
            inputSchema: {
              type: 'object',
              properties: {
                address: { 
                  type: 'string', 
                  description: 'OSC address pattern (must start with /)',
                  pattern: '^/[a-zA-Z0-9_\\-/\\*\\?\\[\\]]*$'
                },
                application: { 
                  type: 'string', 
                  description: 'Target creative application (e.g., MaxMSP, TouchDesigner, Processing)',
                  minLength: 1
                },
                category: { 
                  type: 'string', 
                  description: 'Pattern category for organization',
                  enum: ['audio', 'video', 'control', 'effects', 'general']
                },
                description: { 
                  type: 'string', 
                  description: 'Purpose and usage description of the pattern',
                  minLength: 5
                },
                parameters: {
                  type: 'array',
                  description: 'Parameter definitions for the OSC pattern',
                  default: [],
                  items: {
                    type: 'object',
                    properties: {
                      name: { 
                        type: 'string', 
                        description: 'Parameter name' 
                      },
                      type: { 
                        type: 'string', 
                        description: 'Parameter data type',
                        enum: ['integer', 'float', 'string', 'boolean', 'blob']
                      },
                      range: {
                        type: 'object',
                        description: 'Value range for numeric parameters',
                        properties: {
                          min: { type: 'number' },
                          max: { type: 'number' }
                        }
                      },
                      default: { 
                        description: 'Default value for the parameter' 
                      },
                      unit: { 
                        type: 'string', 
                        description: 'Unit of measurement (Hz, dB, %, etc.)' 
                      }
                    },
                    required: ['name', 'type']
                  }
                },
                tags: {
                  type: 'array',
                  description: 'Keywords for pattern discovery and categorization',
                  default: [],
                  items: { 
                    type: 'string',
                    minLength: 1 
                  }
                },
                enabled: {
                  type: 'boolean',
                  description: 'Whether this pattern is active/enabled',
                  default: true
                }
              },
              required: ['address', 'application', 'category', 'description']
            }
          },
          {
            name: 'get_osc_patterns',
            description: 'Retrieve stored OSC patterns with filtering',
            inputSchema: {
              type: 'object',
              properties: {
                application: { type: 'string' },
                category: { type: 'string' },
                search: { type: 'string' },
                limit: { type: 'number', default: 50 }
              }
            }
          },
          {
            name: 'get_patterns_summary',
            description: 'Get overview of stored OSC patterns',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          },
          {
            name: 'delete_osc_pattern',
            description: 'Remove a saved OSC address pattern from storage by specifying its exact address pattern',
            inputSchema: {
              type: 'object',
              properties: {
                address: { 
                  type: 'string', 
                  description: 'OSC address pattern to delete (must start with /)',
                  pattern: '^/.*'
                }
              },
              required: ['address']
            }
          }
        ]
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params;
        console.error(`🔧 Tool called: ${name}`, args);

        switch (name) {
          case 'send_osc_message':
            return await this.handleSendOSC(args);
          case 'get_received_osc_messages':
            return await this.handleGetReceivedMessages(args);
          case 'save_osc_pattern':
            return await this.handleSavePattern(args);
          case 'get_osc_patterns':
            return await this.handleGetPatterns(args);
          case 'get_patterns_summary':
            return await this.handleGetSummary(args);
          case 'delete_osc_pattern':
            return await this.handleDeletePattern(args);
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        console.error(`❌ Tool error: ${error.message}`);
        throw new McpError(ErrorCode.InternalError, error.message);
      }
    });
  }

  async handleSendOSC(args) {
    const { address, args: oscArgs = [], host = CONFIG.OSC_HOST, port = CONFIG.OSC_SEND_PORT } = args;
    
    if (!address.startsWith('/')) {
      throw new Error('OSC address must start with "/"');
    }

    // Create socket with reuse option for MaxMSP compatibility
    const socket = createSocket({ 
      type: 'udp4', 
      reuseAddr: CONFIG.SOCKET_REUSE 
    });
    
    try {
      const message = this.createOSCMessage(address, oscArgs);
      
      await new Promise((resolve, reject) => {
        socket.send(message, port, host, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });

      console.error(`📤 OSC sent: ${address} [${oscArgs.join(', ')}] → ${host}:${port}`);

      // Log outbound message with direction
      const outboundMessage = {
        timestamp: new Date().toISOString(),
        address,
        args: oscArgs,
        source: { address: host, port },
        direction: 'outbound',
        raw: message.toString('hex')
      };
      
      await this.atomicWriteOSCMessage(outboundMessage);

      return {
        content: [{
          type: 'text',
          text: `✅ OSC message sent to MaxMSP!\n\nAddress: ${address}\nArguments: [${oscArgs.join(', ')}]\nDestination: ${host}:${port}\n\n📊 Message logged with direction tracking for dashboard display.`
        }]
      };

    } finally {
      socket.close();
    }
  }

  async handleGetReceivedMessages(args) {
    const { addressPattern, limit = 50 } = args;
    
    try {
      const content = await fs.readFile(CONFIG.OSC_MESSAGES_FILE, 'utf8');
      let messages = JSON.parse(content);
      
      if (addressPattern) {
        const pattern = new RegExp(addressPattern.replace(/\*/g, '.*'));
        messages = messages.filter(msg => pattern.test(msg.address));
      }
      
      messages = messages.slice(-limit);
      
      const result = messages.map(msg => {
        const direction = msg.direction ? `[${msg.direction.toUpperCase()}]` : '';
        const source = msg.source ? 
          (typeof msg.source === 'object' ? `${msg.source.address}:${msg.source.port}` : msg.source) : 
          'unknown';
        return `${msg.timestamp}: ${msg.address} ${direction} [${msg.args.join(', ')}] from ${source}`;
      }).join('\n');
      
      return {
        content: [{
          type: 'text',
          text: `📥 OSC Messages (${messages.length}):\n\n${result || 'No messages found matching criteria'}`
        }]
      };
      
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `📥 No OSC messages available yet. Send some messages to see them here!`
        }]
      };
    }
  }

  createOSCMessage(address, args) {
    // Simple OSC message creation
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

  // Comprehensive pattern management methods with atomic writes
  async handleSavePattern(args) {
    const { 
      address, 
      application, 
      category, 
      description, 
      parameters = [], 
      tags = [], 
      enabled = true 
    } = args;
    
    // Validate required fields
    if (!address || !address.startsWith('/')) {
      throw new Error('OSC address must start with "/" and cannot be empty');
    }
    
    if (!application || application.trim().length === 0) {
      throw new Error('Application name is required');
    }
    
    if (!['audio', 'video', 'control', 'effects', 'general'].includes(category)) {
      throw new Error('Category must be one of: audio, video, control, effects, general');
    }
    
    if (!description || description.trim().length < 5) {
      throw new Error('Description must be at least 5 characters long');
    }
    
    // Validate parameters schema
    if (parameters && Array.isArray(parameters)) {
      for (const param of parameters) {
        if (!param.name || !param.type) {
          throw new Error('Each parameter must have a name and type');
        }
        if (!['integer', 'float', 'string', 'boolean', 'blob'].includes(param.type)) {
          throw new Error('Parameter type must be one of: integer, float, string, boolean, blob');
        }
      }
    }
    
    // Validate tags
    if (tags && Array.isArray(tags)) {
      for (const tag of tags) {
        if (typeof tag !== 'string' || tag.trim().length === 0) {
          throw new Error('All tags must be non-empty strings');
        }
      }
    }
    
    const data = await this.loadPatterns();
    
    // Check for existing pattern with same address
    const existingIndex = data.patterns.findIndex(p => p.address === address);
    
    const patternObject = {
      address,
      application: application.trim(),
      category,
      description: description.trim(),
      parameters: parameters || [],
      tags: tags || [],
      enabled: enabled !== false, // Default to true
      createdAt: existingIndex >= 0 ? data.patterns[existingIndex].createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: existingIndex >= 0 ? (data.patterns[existingIndex].version || 1) + 1 : 1
    };
    
    if (existingIndex >= 0) {
      // Update existing pattern
      data.patterns[existingIndex] = patternObject;
      await this.savePatterns(data);
      
      return {
        content: [{
          type: 'text',
          text: `✅ Updated OSC pattern: ${address}\n\nApplication: ${application}\nCategory: ${category}\nDescription: ${description}\nParameters: ${parameters.length}\nTags: ${tags.length}\nEnabled: ${enabled}\nVersion: ${patternObject.version}`
        }]
      };
    } else {
      // Add new pattern
      data.patterns.push(patternObject);
      await this.savePatterns(data);
      
      return {
        content: [{
          type: 'text',
          text: `✅ Saved new OSC pattern: ${address}\n\nApplication: ${application}\nCategory: ${category}\nDescription: ${description}\nParameters: ${parameters.length}\nTags: ${tags.length}\nEnabled: ${enabled}\nTotal patterns: ${data.patterns.length}`
        }]
      };
    }
  }

  async handleGetPatterns(args) {
    const { application, category, search, limit = 50 } = args;
    
    const data = await this.loadPatterns();
    let patterns = data.patterns || [];
    
    if (application) {
      patterns = patterns.filter(p => p.application.toLowerCase().includes(application.toLowerCase()));
    }
    if (category) {
      patterns = patterns.filter(p => p.category === category);
    }
    if (search) {
      patterns = patterns.filter(p => 
        p.address.toLowerCase().includes(search.toLowerCase()) ||
        p.description.toLowerCase().includes(search.toLowerCase())
      );
    }
    
    patterns = patterns.slice(0, limit);
    
    const result = patterns.map((p, i) => 
      `${i + 1}. ${p.address}\n   App: ${p.application}\n   Category: ${p.category}\n   Description: ${p.description}`
    ).join('\n\n');
    
    return {
      content: [{
        type: 'text',
        text: `Found ${patterns.length} OSC patterns:\n\n${result || 'No patterns found matching criteria'}`
      }]
    };
  }

  async handleGetSummary() {
    const data = await this.loadPatterns();
    
    const summary = {
      totalPatterns: data.patterns.length,
      applications: {},
      categories: {}
    };
    
    data.patterns.forEach(p => {
      summary.applications[p.application] = (summary.applications[p.application] || 0) + 1;
      summary.categories[p.category] = (summary.categories[p.category] || 0) + 1;
    });
    
    return {
      content: [{
        type: 'text',
        text: `📊 OSC Pattern Database Summary\n\nTotal: ${summary.totalPatterns}\n\nApplications:\n${Object.entries(summary.applications).map(([app, count]) => `• ${app}: ${count}`).join('\n')}\n\nCategories:\n${Object.entries(summary.categories).map(([cat, count]) => `• ${cat}: ${count}`).join('\n')}`
      }]
    };
  }

  async handleDeletePattern(args) {
    const { address } = args;
    
    // Validate address format
    if (!address || !address.startsWith('/')) {
      throw new Error('OSC address must start with "/" and cannot be empty');
    }
    
    const data = await this.loadPatterns();
    const initialCount = data.patterns.length;
    
    // Find and remove patterns with matching address
    const filteredPatterns = data.patterns.filter(pattern => pattern.address !== address);
    const deletedCount = initialCount - filteredPatterns.length;
    
    if (deletedCount === 0) {
      return {
        content: [{
          type: 'text',
          text: `❌ Pattern not found: ${address}\n\nNo OSC pattern with address "${address}" exists in storage.`
        }]
      };
    }
    
    // Update patterns data
    data.patterns = filteredPatterns;
    
    // Update metadata
    data.metadata = {
      ...data.metadata,
      totalPatterns: filteredPatterns.length,
      lastUpdate: new Date().toISOString(),
      lastDeleted: {
        address,
        deletedAt: new Date().toISOString(),
        deletedCount
      }
    };
    
    // Save updated data
    await this.savePatterns(data);
    
    return {
      content: [{
        type: 'text',
        text: `✅ Successfully deleted OSC pattern: ${address}\n\n${deletedCount} pattern${deletedCount > 1 ? 's' : ''} removed from storage.\nRemaining patterns: ${filteredPatterns.length}`
      }]
    };
  }

  async loadPatterns() {
    try {
      const content = await fs.readFile(CONFIG.PATTERNS_FILE, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      return { patterns: [], metadata: {} };
    }
  }

  async savePatterns(data) {
    // Use atomic write for patterns too
    const tempFile = CONFIG.PATTERNS_FILE + '.tmp';
    await fs.mkdir(path.dirname(CONFIG.PATTERNS_FILE), { recursive: true });
    await fs.writeFile(tempFile, JSON.stringify(data, null, 2));
    await fs.rename(tempFile, CONFIG.PATTERNS_FILE);
  }

  async start() {
    try {
      // Set up OSC receiver (non-blocking)
      await this.setupOSCReceiver();
      
      // Start MCP server
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      
      console.error('✅ MaxMSP-Compatible MCP Server started');
      console.error(`📡 OSC receiving on port ${CONFIG.OSC_RECEIVE_PORT}`);
      console.error(`📤 OSC sending to ${CONFIG.OSC_HOST}:${CONFIG.OSC_SEND_PORT}`);
      console.error('🎵 MaxMSP integration ready!');
      
    } catch (error) {
      console.error('❌ Failed to start server:', error);
      throw error;
    }
  }

  async cleanup() {
    this.isShuttingDown = true;
    
    if (this.oscReceiveSocket) {
      this.oscReceiveSocket.close();
    }
    
    // Wait for any pending file writes
    await Promise.all(this.fileWriteQueue.values());
  }
}

// Start server
const server = new MaxMSPCompatibleMCPServer();

process.on('SIGINT', async () => {
  console.error('🛑 Shutting down MaxMSP-compatible server...');
  await server.cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.error('🛑 Terminating MaxMSP-compatible server...');
  await server.cleanup();
  process.exit(0);
});

server.start().catch(error => {
  console.error('❌ Server failed to start:', error);
  process.exit(1);
});