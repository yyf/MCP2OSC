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

// Conditional WebSocket import
let OSCWebSocketController = null;
try {
  const wsModule = await import('./websocket-osc-controller.js');
  OSCWebSocketController = wsModule.OSCWebSocketController;
} catch (error) {
  console.error('⚠️  WebSocket controller not available:', error.message);
  console.error('💡 Install ws package: npm install ws');
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Set process title to avoid MaxMSP conflicts
process.title = 'mcp2osc-server';

// Configuration with MaxMSP compatibility
const CONFIG = {
  OSC_SEND_PORT: parseInt(process.env.OSC_SEND_PORT || '9500'),
  OSC_RECEIVE_PORT: parseInt(process.env.OSC_RECEIVE_PORT || '9501'),
  OSC_HOST: process.env.OSC_HOST || process.env.DEFAULT_OSC_HOST || '127.0.0.1',
  PATTERNS_FILE: path.join(__dirname, 'extracted-osc-patterns.json'),
  LOG_FILE: path.join(__dirname, 'logs', 'mcp2osc.log'),
  OSC_MESSAGES_FILE: path.join(__dirname, 'logs', 'osc-messages.json'),
  // Enhanced logging configuration
  MAX_OSC_MESSAGES: parseInt(process.env.MAX_OSC_MESSAGES || '1000'),
  OSC_LOG_ROTATION: process.env.OSC_LOG_ROTATION === 'true' || process.env.OSC_LOG_ROTATION === 'daily',
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
    this.webSocketController = null; // WebSocket real-time controller
    
    this.setupToolHandlers();
    console.error('🚀 MaxMSP-Compatible MCP Server initialized');
    console.error(`🔧 OSC Configuration: ${CONFIG.OSC_HOST}:${CONFIG.OSC_SEND_PORT} (send) / ${CONFIG.OSC_HOST}:${CONFIG.OSC_RECEIVE_PORT} (receive)`);
    console.error(`📊 OSC Logging: Max ${CONFIG.MAX_OSC_MESSAGES} messages, Rotation: ${CONFIG.OSC_LOG_ROTATION ? 'Daily' : 'Single file'}`);
  }

  // Add utility method for date-based file naming
  getOSCLogFileName() {
    if (CONFIG.OSC_LOG_ROTATION) {
      const today = new Date();
      const dateStr = today.getFullYear() + '-' + 
                      String(today.getMonth() + 1).padStart(2, '0') + '-' + 
                      String(today.getDate()).padStart(2, '0');
      return path.join(__dirname, 'logs', `osc-messages-${dateStr}.json`);
    }
    return CONFIG.OSC_MESSAGES_FILE;
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
          // Check if this is an OSC bundle or single message
          if (this.isOSCBundle(msg)) {
            await this.handleOSCBundle(msg, rinfo);
          } else {
            await this.handleOSCMessage(msg, rinfo);
          }
          
        } catch (error) {
          console.error('Error processing OSC data:', error.message);
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

  // OSC Bundle Detection and Handling
  isOSCBundle(buffer) {
    // OSC bundles start with "#bundle" (8 bytes)
    const bundleHeader = Buffer.from('#bundle\0');
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(bundleHeader);
  }

  async handleOSCBundle(buffer, rinfo) {
    try {
      console.error(`📦 OSC Bundle received from ${rinfo.address}:${rinfo.port}`);
      
      // Parse bundle header
      let offset = 8; // Skip "#bundle" header
      
      // Read timetag (8 bytes)
      if (offset + 8 > buffer.length) {
        throw new Error('Invalid bundle: insufficient data for timetag');
      }
      
      const timetag = this.parseOSCTimetag(buffer.subarray(offset, offset + 8));
      offset += 8;
      
      console.error(`📦 Bundle timetag: ${timetag.toISOString()}`);
      
      // Parse bundle elements
      const elements = [];
      let elementCount = 0;
      
      while (offset < buffer.length && elementCount < 100) { // Safety limit
        // Read element size (4 bytes)
        if (offset + 4 > buffer.length) {
          break; // End of bundle
        }
        
        const elementSize = buffer.readUInt32BE(offset);
        offset += 4;
        
        if (elementSize === 0 || offset + elementSize > buffer.length) {
          console.warn(`Invalid element size ${elementSize} at offset ${offset}`);
          break;
        }
        
        // Extract element data
        const elementData = buffer.subarray(offset, offset + elementSize);
        offset += elementSize;
        
        // Process element (could be message or nested bundle)
        if (this.isOSCBundle(elementData)) {
          // Nested bundle - recursively handle
          await this.handleOSCBundle(elementData, rinfo);
        } else {
          // OSC message
          await this.handleOSCMessage(elementData, rinfo);
        }
        
        elements.push({
          type: this.isOSCBundle(elementData) ? 'bundle' : 'message',
          size: elementSize
        });
        
        elementCount++;
      }
      
      // Log bundle information
      const bundleInfo = {
        timestamp: new Date().toISOString(),
        address: '#bundle',
        args: {
          bundleTimetag: timetag.toISOString(),
          elementCount: elements.length,
          elements: elements
        },
        source: { address: rinfo.address, port: rinfo.port },
        direction: 'inbound',
        type: 'bundle'
      };
      
      await this.atomicWriteOSCMessage(bundleInfo);
      
      console.error(`📦 Processed OSC bundle with ${elements.length} elements`);
      
    } catch (error) {
      console.error('Error processing OSC bundle:', error.message);
      
      // Log error for debugging
      const errorInfo = {
        timestamp: new Date().toISOString(),
        address: '#bundle_error',
        args: { error: error.message },
        source: { address: rinfo.address, port: rinfo.port },
        direction: 'error',
        type: 'bundle_error'
      };
      
      await this.atomicWriteOSCMessage(errorInfo);
    }
  }

  async handleOSCMessage(buffer, rinfo) {
    try {
      const address = this.parseOSCAddress(buffer);
      const args = this.parseOSCArgs(buffer);
      
      console.error(`📥 OSC received: ${address} [${args.join(', ')}] from ${rinfo.address}:${rinfo.port}`);
      
      // Store inbound message with direction
      const inboundMessage = {
        timestamp: new Date().toISOString(),
        address,
        args,
        source: { address: rinfo.address, port: rinfo.port },
        direction: 'inbound',
        raw: buffer.toString('hex'),
        type: 'message'
      };
      
      await this.atomicWriteOSCMessage(inboundMessage);
      
    } catch (error) {
      console.error('Error processing OSC message:', error.message);
    }
  }

  parseOSCTimetag(buffer) {
    // OSC timetag is 8 bytes: 4 bytes seconds since 1900, 4 bytes fractional seconds
    const seconds = buffer.readUInt32BE(0);
    const fraction = buffer.readUInt32BE(4);
    
    // Convert from NTP epoch (1900) to Unix epoch (1970)
    const SECONDS_FROM_1900_TO_1970 = 2208988800;
    const unixSeconds = seconds - SECONDS_FROM_1900_TO_1970;
    
    // Convert fraction to milliseconds
    const milliseconds = Math.round((fraction / 0xFFFFFFFF) * 1000);
    
    // Create JavaScript Date
    return new Date(unixSeconds * 1000 + milliseconds);
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
    const fileName = this.getOSCLogFileName();
    
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
      
      // Keep only last N messages (configurable)
      if (messages.length > CONFIG.MAX_OSC_MESSAGES) {
        messages = messages.slice(-CONFIG.MAX_OSC_MESSAGES);
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
                port: { type: 'number', default: 9500, description: 'Target port' }
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
          },
          {
            name: 'websocket_osc_control',
            description: 'Real-time OSC parameter control via WebSocket. Enables live parameter streaming and real-time control.',
            inputSchema: {
              type: 'object',
              properties: {
                action: {
                  type: 'string',
                  enum: ['set_parameter', 'start_stream', 'stop_stream', 'get_status'],
                  description: 'WebSocket control action to perform'
                },
                parameterId: {
                  type: 'string',
                  description: 'Parameter identifier (e.g., "synth.freq", "filter.cutoff")'
                },
                value: {
                  type: 'number',
                  description: 'Parameter value (for set_parameter action)'
                },
                streamConfig: {
                  type: 'object',
                  description: 'Stream configuration (for start_stream action)',
                  properties: {
                    oscAddress: { type: 'string', description: 'OSC address to stream to' },
                    destination: { type: 'string', description: 'Destination host:port', default: 'default' },
                    updateRate: { type: 'number', description: 'Updates per second (Hz)', default: 60 },
                    valueFunction: { 
                      type: 'string', 
                      enum: ['sine', 'linear', 'random'],
                      description: 'Value generation function',
                      default: 'linear'
                    },
                    range: {
                      type: 'array',
                      items: { type: 'number' },
                      minItems: 2,
                      maxItems: 2,
                      description: 'Value range [min, max]',
                      default: [0, 1]
                    },
                    duration: { type: 'number', description: 'Stream duration in milliseconds (null for infinite)' }
                  }
                }
              },
              required: ['action']
            }
          },
          {
            name: 'batch_send_osc',
            description: 'Send multiple OSC messages in a single batch to a specified application or device for efficient real-time control.',
            inputSchema: {
              type: 'object',
              properties: {
                target: {
                  type: 'string',
                  description: 'IP address or hostname of the OSC receiver',
                  pattern: '^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$|^[a-zA-Z0-9.-]+$',
                  default: '127.0.0.1'
                },
                port: {
                  type: 'integer',
                  description: 'Port number of the OSC receiver',
                  minimum: 1,
                  maximum: 65535
                },
                messages: {
                  type: 'array',
                  description: 'Array of OSC messages to send in batch',
                  minItems: 1,
                  maxItems: 100,
                  items: {
                    type: 'object',
                    properties: {
                      address: {
                        type: 'string',
                        description: 'OSC address pattern for the message',
                        pattern: '^/[a-zA-Z0-9_\\-/\\*\\?\\[\\]]*$'
                      },
                      type_tags: {
                        type: 'string',
                        description: 'OSC type tag string (e.g., "ifs" for integer, float, string)',
                        pattern: '^[ifsbtTFNI]*$',
                        default: ''
                      },
                      values: {
                        type: 'array',
                        description: 'Values corresponding to the type tags',
                        default: []
                      }
                    },
                    required: ['address'],
                    additionalProperties: false
                  }
                },
                transport_protocol: {
                  type: 'string',
                  enum: ['UDP', 'TCP'],
                  description: 'Transport protocol for OSC messages',
                  default: 'UDP'
                },
                send_mode: {
                  type: 'string',
                  enum: ['atomic', 'queued', 'bundle'],
                  description: 'Batch sending mode - atomic sends all at once, queued sends with minimal delay, bundle sends as OSC bundle',
                  default: 'atomic'
                },
                timetag: {
                  type: 'number',
                  description: 'Bundle timetag in milliseconds since Unix epoch (for bundle mode only)',
                  minimum: 0
                }
              },
              required: ['target', 'port', 'messages'],
              additionalProperties: false
            }
          },
          {
            name: 'send_osc_bundle',
            description: 'Send multiple OSC messages as a single OSC bundle with precise timing.',
            inputSchema: {
              type: 'object',
              properties: {
                target: {
                  type: 'string',
                  description: 'IP address or hostname of the OSC receiver',
                  default: '127.0.0.1'
                },
                port: {
                  type: 'integer',
                  description: 'Port number of the OSC receiver',
                  minimum: 1,
                  maximum: 65535
                },
                messages: {
                  type: 'array',
                  description: 'Array of OSC messages to include in the bundle',
                  minItems: 1,
                  maxItems: 50,
                  items: {
                    type: 'object',
                    properties: {
                      address: {
                        type: 'string',
                        description: 'OSC address pattern',
                        pattern: '^/[a-zA-Z0-9_\\-/\\*\\?\\[\\]]*$'
                      },
                      args: {
                        type: 'array',
                        description: 'Arguments for the OSC message',
                        default: []
                      }
                    },
                    required: ['address']
                  }
                },
                timetag: {
                  type: 'number',
                  description: 'Bundle execution time in milliseconds since Unix epoch (0 for immediate)',
                  default: 0
                }
              },
              required: ['target', 'port', 'messages']
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
          case 'websocket_osc_control':
            return await this.handleWebSocketControl(args);
          case 'batch_send_osc':
            return await this.handleBatchSendOSC(args);
          case 'send_osc_bundle':
            return await this.handleSendOSCBundle(request.params.arguments);
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
      const fileName = this.getOSCLogFileName();
      const content = await fs.readFile(fileName, 'utf8');
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
      
      const totalCount = messages.length;
      const currentFile = path.basename(fileName);
      
      return {
        content: [{
          type: 'text',
          text: `📥 OSC Messages (${totalCount}):\nFile: ${currentFile}\nMax messages per file: ${CONFIG.MAX_OSC_MESSAGES}\nRotation: ${CONFIG.OSC_LOG_ROTATION ? 'Daily' : 'Single file'}\n\n${result || 'No messages found matching criteria'}`
        }]
      };
      
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `📥 No OSC messages available yet. Send some messages to see them here!\nConfig: Max ${CONFIG.MAX_OSC_MESSAGES} messages per file, Rotation: ${CONFIG.OSC_LOG_ROTATION ? 'Daily' : 'Single file'}`
        }]
      };
    }
  }

  async handleBatchSendOSC(args) {
    const { target, port, messages, transport_protocol = 'UDP', send_mode = 'atomic' } = args;
    
    try {
      // Validate target and port
      if (!target || !port) {
        throw new Error('Target and port are required for batch OSC sending');
      }
      
      if (port < 1 || port > 65535) {
        throw new Error('Port must be between 1 and 65535');
      }
      
      if (!Array.isArray(messages) || messages.length === 0) {
        throw new Error('Messages array is required and cannot be empty');
      }
      
      if (messages.length > 100) {
        throw new Error('Maximum 100 messages allowed per batch');
      }
      
      // Validate and process each message
      const processedMessages = [];
      
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        
        if (!msg.address || !msg.address.startsWith('/')) {
          throw new Error(`Message ${i + 1}: OSC address is required and must start with '/'`);
        }
        
        // Validate type tags if provided
        if (msg.type_tags && !/^[ifsbtTFNI]*$/.test(msg.type_tags)) {
          throw new Error(`Message ${i + 1}: Invalid type tags '${msg.type_tags}'. Use: i(int), f(float), s(string), b(blob), t(time), T(true), F(false), N(null), I(impulse)`);
        }
        
        const values = msg.values || [];
        const typeTags = msg.type_tags || '';
        
        // Auto-generate type tags if not provided
        let finalTypeTags = typeTags;
        if (!finalTypeTags && values.length > 0) {
          finalTypeTags = values.map(value => {
            if (typeof value === 'number') {
              return Number.isInteger(value) ? 'i' : 'f';
            } else if (typeof value === 'string') {
              return 's';
            } else if (typeof value === 'boolean') {
              return value ? 'T' : 'F';
            } else {
              return 's'; // Default to string
            }
          }).join('');
        }
        
        // Validate type tags match values
        if (finalTypeTags.length !== values.length) {
          throw new Error(`Message ${i + 1}: Type tags length (${finalTypeTags.length}) must match values length (${values.length})`);
        }
        
        processedMessages.push({
          address: msg.address,
          typeTags: finalTypeTags,
          values: values,
          originalIndex: i + 1
        });
      }
      
      // Send messages based on mode
      const results = [];
      let successCount = 0;
      let errorCount = 0;
      
      if (send_mode === 'bundle') {
        // Send as OSC bundle
        try {
          const bundleMessages = processedMessages.map(msg => ({
            address: msg.address,
            args: msg.values
          }));
          
          const bundleBuffer = this.createOSCBundle(bundleMessages, args.timetag || 0);
          const socket = createSocket({ 
            type: 'udp4', 
            reuseAddr: CONFIG.SOCKET_REUSE 
          });
          
          try {
            await new Promise((resolve, reject) => {
              socket.send(bundleBuffer, port, target, (error) => {
                if (error) reject(error);
                else resolve();
              });
            });
            
            successCount = processedMessages.length;
            results.push({
              success: true,
              bundleSize: processedMessages.length,
              message: 'Bundle sent successfully'
            });
            
          } finally {
            socket.close();
          }
          
        } catch (error) {
          errorCount = processedMessages.length;
          results.push({
            success: false,
            error: error.message,
            bundleSize: processedMessages.length
          });
        }
        
      } else if (send_mode === 'atomic') {
        // Send all messages at once
        const sendPromises = processedMessages.map(async (msg, index) => {
          try {
            const oscMessage = this.createOSCMessage(msg.address, msg.values, msg.typeTags);
            await this.sendOSCMessageToTarget(oscMessage, target, port, transport_protocol);
            
            results.push({
              index: msg.originalIndex,
              address: msg.address,
              status: 'success',
              timestamp: Date.now()
            });
            
            successCount++;
            
            return {
              address: msg.address,
              values: msg.values,
              status: 'sent'
            };
          } catch (error) {
            errorCount++;
            results.push({
              index: msg.originalIndex,
              address: msg.address,
              status: 'error',
              error: error.message,
              timestamp: Date.now()
            });
            
            throw error;
          }
        });
        
        try {
          await Promise.all(sendPromises);
        } catch (error) {
          // Some messages may have failed, but continue with results
        }
        
      } else if (send_mode === 'queued') {
        // Send messages sequentially with minimal delay
        for (const msg of processedMessages) {
          try {
            const oscMessage = this.createOSCMessage(msg.address, msg.values, msg.typeTags);
            await this.sendOSCMessageToTarget(oscMessage, target, port, transport_protocol);
            
            results.push({
              index: msg.originalIndex,
              address: msg.address,
              status: 'success',
              timestamp: Date.now()
            });
            
            successCount++;
            
            // Small delay between messages in queued mode
            await new Promise(resolve => setTimeout(resolve, 1));
            
          } catch (error) {
            errorCount++;
            results.push({
              index: msg.originalIndex,
              address: msg.address,
              status: 'error',
              error: error.message,
              timestamp: Date.now()
            });
          }
        }
      }
      
      // Log the batch operation
      await this.atomicWriteOSCMessage({
        timestamp: new Date().toISOString(),
        address: 'batch_send',
        args: {
          target,
          port,
          messageCount: messages.length,
          transport: transport_protocol,
          mode: send_mode,
          success: successCount,
          errors: errorCount
        },
        direction: 'outbound',
        source: { address: target, port }
      });
      
      const summary = {
        totalMessages: messages.length,
        successful: successCount,
        failed: errorCount,
        target: `${target}:${port}`,
        transport: transport_protocol,
        sendMode: send_mode,
        timestamp: new Date().toISOString()
      };
      
      return {
        content: [{
          type: 'text',
          text: `✅ Batch OSC Send Complete\n\n📊 Summary:\n- Target: ${target}:${port}\n- Transport: ${transport_protocol}\n- Mode: ${send_mode}\n- Total Messages: ${messages.length}\n- Successful: ${successCount}\n- Failed: ${errorCount}\n\n${errorCount === 0 ? '🎯 All messages sent successfully!' : `⚠️ ${errorCount} message(s) failed to send`}\n\n📋 Detailed Results:\n${JSON.stringify(results, null, 2)}`
        }]
      };
      
    } catch (error) {
      await this.atomicWriteOSCMessage({
        timestamp: new Date().toISOString(),
        address: 'batch_send_error',
        args: {
          target,
          port,
          error: error.message,
          messageCount: messages?.length || 0
        },
        direction: 'error',
        source: { address: target, port }
      });
      
      return {
        content: [{
          type: 'text',
          text: `❌ Batch OSC Send Failed: ${error.message}\n\nTarget: ${target}:${port}\nMessages: ${messages?.length || 0}\nTransport: ${transport_protocol}\nMode: ${send_mode}\n\nPlease check your target address, port, and message format.`
        }]
      };
    }
  }

  async handleSendOSCBundle(args) {
    const { target = CONFIG.OSC_HOST, port = CONFIG.OSC_SEND_PORT, messages, timetag = 0 } = args;
    
    try {
      // Validate target and port
      if (!target || !port) {
        throw new Error('Target and port are required');
      }
      
      if (port < 1 || port > 65535) {
        throw new Error('Port must be between 1 and 65535');
      }
      
      if (!Array.isArray(messages) || messages.length === 0) {
        throw new Error('Messages array is required and must not be empty');
      }
      
      if (messages.length > 50) {
        throw new Error('Bundle cannot contain more than 50 messages');
      }
      
      // Validate each message
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (!msg.address || !msg.address.startsWith('/')) {
          throw new Error(`Message ${i + 1}: OSC address must start with "/"`);
        }
      }
      
      // Create OSC bundle
      const bundleBuffer = this.createOSCBundle(messages, timetag);
      
      // Send bundle
      const socket = createSocket({ 
        type: 'udp4', 
        reuseAddr: CONFIG.SOCKET_REUSE 
      });
      
      try {
        await new Promise((resolve, reject) => {
          socket.send(bundleBuffer, port, target, (error) => {
            if (error) reject(error);
            else resolve();
          });
        });
        
        console.error(`📦 OSC Bundle sent: ${messages.length} messages → ${target}:${port}`);
        
        // Log outbound bundle
        const bundleMessage = {
          timestamp: new Date().toISOString(),
          address: '#bundle',
          args: {
            messageCount: messages.length,
            timetag: timetag || 'immediate',
            messages: messages.map(m => ({ address: m.address, argCount: (m.args || []).length }))
          },
          source: { address: target, port },
          direction: 'outbound',
          type: 'bundle'
        };
        
        await this.atomicWriteOSCMessage(bundleMessage);
        
        return {
          content: [{
            type: 'text',
            text: `✅ OSC Bundle sent successfully!\n\nTarget: ${target}:${port}\nMessages: ${messages.length}\nTimetag: ${timetag || 'immediate'}\n\n📦 Bundle contents:\n${messages.map((m, i) => `${i + 1}. ${m.address} [${(m.args || []).join(', ')}]`).join('\n')}\n\n📊 Bundle logged with direction tracking for dashboard display.`
          }]
        };
        
      } finally {
        socket.close();
      }
      
    } catch (error) {
      console.error(`❌ OSC Bundle send failed: ${error.message}`);
      
      // Log error
      await this.atomicWriteOSCMessage({
        timestamp: new Date().toISOString(),
        address: '#bundle_error',
        args: { error: error.message, target, port, messageCount: messages?.length || 0 },
        direction: 'error',
        type: 'bundle_error'
      });
      
      return {
        content: [{
          type: 'text',
          text: `❌ OSC Bundle send failed: ${error.message}\n\nTarget: ${target}:${port}\nMessages: ${messages?.length || 0}\n\nPlease check your target address, port, and message format.`
        }]
      };
    }
  }

  createOSCMessage(address, values = [], typeTags = '') {
    // Create OSC message with proper padding
    const addressBuffer = Buffer.from(address + '\0');
    const addressPadded = this.padTo4Bytes(addressBuffer);
    
    // Create type tag string
    const typeTagString = ',' + (typeTags || values.map(value => {
      if (typeof value === 'number') {
        return Number.isInteger(value) ? 'i' : 'f';
      } else if (typeof value === 'boolean') {
        return value ? 'T' : 'F';
      } else {
        return 's';
      }
    }).join(''));
    
    const typeTagBuffer = this.padTo4Bytes(Buffer.from(typeTagString + '\0'));
    
    // Create argument buffers
    const argBuffers = values.map((value, index) => {
      const expectedType = typeTags[index] || (typeof value === 'number' ? (Number.isInteger(value) ? 'i' : 'f') : 's');
      
      switch (expectedType) {
        case 'i':
          const intBuffer = Buffer.alloc(4);
          intBuffer.writeInt32BE(parseInt(value), 0);
          return intBuffer;
          
        case 'f':
          const floatBuffer = Buffer.alloc(4);
          floatBuffer.writeFloatBE(parseFloat(value), 0);
          return floatBuffer;
          
        case 's':
          return this.padTo4Bytes(Buffer.from(String(value) + '\0'));
          
        case 'T':
        case 'F':
        case 'N':
        case 'I':
          return Buffer.alloc(0); // No data for these types
          
        default:
          return this.padTo4Bytes(Buffer.from(String(value) + '\0'));
      }
    });

    return Buffer.concat([addressPadded, typeTagBuffer, ...argBuffers]);
  }

  padTo4Bytes(buffer) {
    const padding = (4 - (buffer.length % 4)) % 4;
    return Buffer.concat([buffer, Buffer.alloc(padding)]);
  }

  createOSCBundle(messages, timetag = 0) {
    // Create bundle header: #bundle\0 (8 bytes)
    const bundleHeader = Buffer.from('#bundle\0');
    
    // Create timetag (8 bytes)
    const timetagBuffer = this.createOSCTimetag(timetag);
    
    // Create message elements
    const messageBuffers = [];
    
    for (const message of messages) {
      // Create OSC message
      const oscMessage = this.createOSCMessage(message.address, message.args || []);
      
      // Create size prefix (4 bytes, big-endian)
      const sizeBuffer = Buffer.alloc(4);
      sizeBuffer.writeUInt32BE(oscMessage.length, 0);
      
      // Add size + message
      messageBuffers.push(sizeBuffer);
      messageBuffers.push(oscMessage);
    }
    
    // Combine all parts
    return Buffer.concat([bundleHeader, timetagBuffer, ...messageBuffers]);
  }

  createOSCTimetag(timestamp) {
    // Create 8-byte OSC timetag
    const buffer = Buffer.alloc(8);
    
    if (timestamp === 0) {
      // Immediate execution: special timetag of 1
      buffer.writeUInt32BE(0, 0);
      buffer.writeUInt32BE(1, 4);
    } else {
      // Convert Unix timestamp (ms) to NTP timestamp
      const unixSeconds = Math.floor(timestamp / 1000);
      const unixFraction = (timestamp % 1000) / 1000;
      
      // Convert to NTP epoch (1900-based)
      const SECONDS_FROM_1900_TO_1970 = 2208988800;
      const ntpSeconds = unixSeconds + SECONDS_FROM_1900_TO_1970;
      const ntpFraction = Math.round(unixFraction * 0xFFFFFFFF);
      
      buffer.writeUInt32BE(ntpSeconds, 0);
      buffer.writeUInt32BE(ntpFraction, 4);
    }
    
    return buffer;
  }

  async handleWebSocketControl(args) {
    // Check if WebSocket controller is available
    if (!OSCWebSocketController) {
      return {
        content: [{
          type: 'text',
          text: `❌ WebSocket OSC Control not available\n\nThe 'ws' package is not installed. Please install it:\n\n  npm install ws\n\nThen restart the MCP server to enable WebSocket real-time control features.`
        }]
      };
    }

    // Initialize WebSocket controller if not already done
    if (!this.webSocketController) {
      await this.initializeWebSocketController();
    }

    try {
      const result = await this.webSocketController.handleMCPWebSocketControl(args);
      
      return {
        content: [{
          type: 'text',
          text: `✅ WebSocket OSC Control: ${args.action}\n\n${JSON.stringify(result, null, 2)}\n\n🌐 WebSocket server available on ws://localhost:${process.env.WEBSOCKET_PORT || '8765'}\n📊 Connect via dashboard or custom WebSocket client for real-time control.`
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `❌ WebSocket OSC Control failed: ${error.message}\n\nAction: ${args.action}\nPlease check WebSocket server status and parameters.`
        }]
      };
    }
  }

  async initializeWebSocketController() {
    try {
      if (!OSCWebSocketController) {
        throw new Error('WebSocket controller not available. Install ws package: npm install ws');
      }
      
      // Use WEBSOCKET_PORT environment variable or default to 8765
      const webSocketPort = parseInt(process.env.WEBSOCKET_PORT || '8765');
      this.webSocketController = new OSCWebSocketController(webSocketPort);
      this.webSocketController.start();
      
      console.error(`🌐 WebSocket OSC Controller started on port ${webSocketPort}`);
      console.error(`📱 Connect via: ws://localhost:${webSocketPort}`);
      
    } catch (error) {
      console.error('❌ Failed to start WebSocket controller:', error.message);
      throw error;
    }
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

  // Enhanced pattern loading with validation and cleanup
  async loadPatterns() {
    try {
      const content = await fs.readFile(CONFIG.PATTERNS_FILE, 'utf8');
      const data = JSON.parse(content);
      
      // Validate and clean patterns
      if (data.patterns && Array.isArray(data.patterns)) {
        // Filter out incomplete/malformed patterns
        const validPatterns = data.patterns.filter(pattern => {
          return pattern && 
                 typeof pattern === 'object' && 
                 pattern.address && 
                 typeof pattern.address === 'string' &&
                 pattern.address.startsWith('/') &&
                 pattern.application &&
                 pattern.category &&
                 pattern.description;
        });
        
        // Update metadata to match actual count
        data.patterns = validPatterns;
        data.metadata = {
          ...data.metadata,
          totalPatterns: validPatterns.length,
          lastUpdate: new Date().toISOString(),
          lastValidation: new Date().toISOString()
        };
        
        // Save cleaned data back to file if changes were made
        const originalCount = data.metadata.totalPatterns || 0;
        if (validPatterns.length !== originalCount) {
          console.error(`🔧 Fixed pattern count discrepancy: ${validPatterns.length} valid patterns (was ${originalCount})`);
          await this.savePatterns(data);
        }
        
        return data;
      }
      
      return {
        patterns: [],
        metadata: {
          extractedAt: new Date().toISOString(),
          totalPatterns: 0,
          applications: [],
          categories: [],
          lastUpdate: new Date().toISOString(),
          version: "1.0.0"
        }
      };
    } catch (error) {
      console.error('Error loading patterns:', error.message);
      return {
        patterns: [],
        metadata: {
          extractedAt: new Date().toISOString(),
          totalPatterns: 0,
          applications: [],
          categories: [],
          lastUpdate: new Date().toISOString(),
          version: "1.0.0",
          error: error.message
        }
      };
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
    
    if (this.webSocketController) {
      this.webSocketController.stop();
    }
    
    // Wait for any pending file writes
    await Promise.all(this.fileWriteQueue.values());
  }

  async logOSCMessage(address, args, direction = 'outbound', source = null) {
    const message = {
      timestamp: new Date().toISOString(),
      address,
      args: typeof args === 'object' && !Array.isArray(args) ? args : [args],
      direction,
      source: source || { address: CONFIG.OSC_HOST, port: CONFIG.OSC_SEND_PORT }
    };
    
    await this.atomicWriteOSCMessage(message);
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