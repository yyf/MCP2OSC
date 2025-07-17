#!/usr/bin/env node

/**
 * Enhanced Dashboard Server - OSC Monitoring & Pattern Management
 * Displays system status and manages OSC patterns from Claude
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createSocket } from 'dgram';
import { createServer } from 'http';
import { addOSCMessage, getOSCMessages } from './shared-storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const CONFIG = {
    WEB_PORT: parseInt(process.env.WEB_PORT || '3001'),
    OSC_SEND_PORT: parseInt(process.env.OSC_SEND_PORT || '7500'),
    OSC_RECEIVE_PORT: parseInt(process.env.OSC_RECEIVE_PORT || '7502'), // Different port to avoid conflict
    OSC_HOST: process.env.DEFAULT_OSC_HOST || '127.0.0.1',
    LOG_FILE: path.join(__dirname, 'logs', 'mcp2osc.log')
};

// Global state for dashboard features
const STATE = {
    logs: [],
    stats: {
        mcpMessages: 0,
        oscMessages: 0,
        errors: 0,
        uptime: Date.now()
    },
    oscMessages: [],
    lastOSCReceivedTime: null
};

class EnhancedDashboardServer {
    constructor() {
        this.app = express();
        this.app.use(express.json());
        this.app.use(express.static(path.join(__dirname, 'public')));
        
        // Initialize patterns file first
        this.initializePatternsFileIfNeeded();
        
        this.setupRoutes();
        this.setupOSCReceiver();
        this.loadLogs();
        this.setupLogWatcher();
    }

    initializePatternsFileIfNeeded() {
        try {
            const patternsFile = path.join(__dirname, 'extracted-osc-patterns.json');
            
            if (!fs.existsSync(patternsFile)) {
                console.log('📁 Creating initial patterns file...');
                this.initializePatternsFile(patternsFile);
            } else {
                // Verify file is valid JSON
                const fileContent = fs.readFileSync(patternsFile, 'utf8').trim();
                if (!fileContent) {
                    console.log('📁 Patterns file is empty, reinitializing...');
                    this.initializePatternsFile(patternsFile);
                } else {
                    try {
                        JSON.parse(fileContent);
                        console.log('✅ Patterns file is valid');
                    } catch (parseError) {
                        console.log('📁 Patterns file has invalid JSON, reinitializing...');
                        this.initializePatternsFile(patternsFile);
                    }
                }
            }
        } catch (error) {
            console.error('Failed to initialize patterns file:', error.message);
        }
    }

    setupRoutes() {
        // Claude pattern upload endpoint (patterns extracted by Claude)
        this.app.post('/api/patterns/upload', express.json(), async (req, res) => {
            try {
                const { patterns, applicationName = 'Unknown Application', source = 'Claude Upload' } = req.body;
                
                if (!patterns || !Array.isArray(patterns) || patterns.length === 0) {
                    return res.status(400).json({ 
                        success: false,
                        error: 'No patterns provided. Expected array of OSC patterns.' 
                    });
                }
                
                console.log(`📁 Processing ${patterns.length} patterns from Claude for ${applicationName}`);
                
                // Validate patterns
                const validationResults = this.validateOSCPatterns(patterns);
                
                // Store valid patterns
                const validPatterns = patterns.filter((_, index) => validationResults.results[index].valid);
                
                if (validPatterns.length > 0) {
                    this.storePatterns(validPatterns, applicationName, source);
                    console.log(`✅ Stored ${validPatterns.length} valid patterns`);
                }
                
                res.json({
                    success: true,
                    message: `Processed ${patterns.length} patterns, stored ${validPatterns.length} valid patterns`,
                    totalSubmitted: patterns.length,
                    validPatterns: validPatterns.length,
                    invalidPatterns: patterns.length - validPatterns.length,
                    validation: validationResults,
                    applicationName
                });
                
            } catch (error) {
                console.error('Pattern upload error:', error);
                res.status(500).json({ 
                    success: false,
                    error: `Pattern upload failed: ${error.message}` 
                });
            }
        });

        // Get extracted patterns summary
        this.app.get('/api/patterns/summary', (req, res) => {
            try {
                const patterns = this.loadExtractedPatterns();
                const summary = this.generatePatternsSummary(patterns);
                res.json(summary);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Search patterns
        this.app.get('/api/patterns/search', (req, res) => {
            try {
                const { query, application, category, limit = 10 } = req.query;
                
                if (!query) {
                    return res.status(400).json({ error: 'Search query is required' });
                }

                const results = this.searchPatterns(query, application, category, parseInt(limit));
                res.json(results);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Original dashboard API routes
        this.app.get('/api/status', (req, res) => {
            res.json({
                uptime: Date.now() - STATE.stats.uptime,
                stats: STATE.stats,
                config: {
                    oscHost: CONFIG.OSC_HOST,
                    oscSendPort: CONFIG.OSC_SEND_PORT,
                    oscReceivePort: CONFIG.OSC_RECEIVE_PORT
                },
                databaseConnected: false
            });
        });

        this.app.get('/api/logs', (req, res) => {
            res.json(STATE.logs.slice(-100));
        });

        this.app.get('/api/osc-messages', (req, res) => {
            try {
                const oscLogFile = path.join(__dirname, 'logs', 'osc-messages.json');
                if (fs.existsSync(oscLogFile)) {
                    const content = fs.readFileSync(oscLogFile, 'utf8').trim();
                    if (content) {
                        const messages = JSON.parse(content);
                        const limit = parseInt(req.query.limit) || 50;
                        
                        res.json({
                            success: true,
                            messages: messages.slice(-limit),
                            total: messages.length,
                            timestamp: new Date().toISOString()
                        });
                    } else {
                        res.json({
                            success: false,
                            messages: [],
                            total: 0,
                            error: 'OSC messages file is empty',
                            timestamp: new Date().toISOString()
                        });
                    }
                } else {
                    res.json({
                        success: false,
                        messages: [],
                        total: 0,
                        error: 'OSC messages file not found - start MCP server to generate messages',
                        timestamp: new Date().toISOString()
                    });
                }
            } catch (error) {
                console.error('Error reading OSC messages:', error);
                res.json({
                    success: false,
                    messages: [],
                    total: 0,
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
            }
        });

        this.app.post('/api/test-osc', async (req, res) => {
            try {
                const { address, args } = req.body;
                await this.sendTestOSC(address, args);
                res.json({ success: true, message: 'OSC message sent' });
            } catch (error) {
                res.status(400).json({ error: error.message });
            }
        });

        // Enhanced logging and monitoring endpoints
        this.app.get('/api/logs/system', async (req, res) => {
            try {
                const logFile = path.join(__dirname, 'logs', 'mcp2osc.log');
                const logs = await fs.promises.readFile(logFile, 'utf8');
                const lines = logs.split('\n').filter(line => line.trim());
                const limit = parseInt(req.query.limit) || 100;
                
                res.json({
                    success: true,
                    logs: lines.slice(-limit),
                    total: lines.length,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                res.json({
                    success: false,
                    error: 'No system logs found',
                    logs: [],
                    timestamp: new Date().toISOString()
                });
            }
        });

        this.app.get('/api/logs/osc-messages', async (req, res) => {
            try {
                const messagesFile = path.join(__dirname, 'logs', 'osc-messages.json');
                const content = await fs.promises.readFile(messagesFile, 'utf8');
                const messages = JSON.parse(content);
                const limit = parseInt(req.query.limit) || 50;
                
                res.json({
                    success: true,
                    messages: messages.slice(-limit),
                    total: messages.length,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                res.json({
                    success: false,
                    error: 'No OSC messages found',
                    messages: [],
                    timestamp: new Date().toISOString()
                });
            }
        });

        this.app.get('/api/logs/activity-feed', async (req, res) => {
            try {
                const systemLogFile = path.join(__dirname, 'logs', 'mcp2osc.log');
                const oscLogFile = path.join(__dirname, 'logs', 'osc-messages.json');
                
                let activities = [];
                
                // Add system logs
                try {
                    const systemLogs = await fs.readFile(systemLogFile, 'utf8');
                    const systemLines = systemLogs.split('\n')
                        .filter(line => line.trim())
                        .slice(-50)
                        .map(line => ({
                            timestamp: line.substring(0, 24),
                            type: 'system',
                            message: line.substring(25),
                            source: 'MCP Server',
                            priority: line.includes('ERROR') ? 'high' : line.includes('WARN') ? 'medium' : 'low'
                        }));
                    activities.push(...systemLines);
                } catch (error) {
                    console.log('System log file not found');
                }
                
                // Add OSC messages
                try {
                    const oscContent = await fs.readFile(oscLogFile, 'utf8');
                    const oscMessages = JSON.parse(oscContent);
                    const oscActivities = oscMessages.slice(-50).map(msg => ({
                        timestamp: msg.timestamp,
                        type: 'osc',
                        message: `${msg.address} [${(msg.args || []).join(', ')}]`,
                        source: msg.source ? `${msg.source.address}:${msg.source.port}` : 'Unknown',
                        priority: 'low'
                    }));
                    activities.push(...oscActivities);
                } catch (error) {
                    console.log('OSC log file not found');
                }
                
                // Sort by timestamp and limit
                activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                const limit = parseInt(req.query.limit) || 100;
                
                res.json({
                    success: true,
                    activities: activities.slice(0, limit),
                    total: activities.length,
                    timestamp: new Date().toISOString()
                });
                
            } catch (error) {
                res.json({
                    success: false,
                    error: error.message,
                    activities: [],
                    timestamp: new Date().toISOString()
                });
            }
        });

        this.app.get('/api/system/health', async (req, res) => {
            try {
                const health = {
                    status: 'healthy',
                    timestamp: new Date().toISOString(),
                    uptime: process.uptime(),
                    memory: process.memoryUsage(),
                    components: {
                        mcpServer: { status: 'unknown', lastCheck: new Date().toISOString() },
                        oscCommunication: { status: 'unknown', lastCheck: new Date().toISOString() },
                        patternDatabase: { status: 'unknown', lastCheck: new Date().toISOString() },
                        logging: { status: 'unknown', lastCheck: new Date().toISOString() }
                    }
                };

                // Check pattern database
                try {
                    const patternsFile = path.join(__dirname, 'extracted-osc-patterns.json');
                    await fs.access(patternsFile);
                    health.components.patternDatabase.status = 'healthy';
                } catch (error) {
                    health.components.patternDatabase.status = 'error';
                }

                // Check logging
                try {
                    const logsDir = path.join(__dirname, 'logs');
                    await fs.access(logsDir);
                    health.components.logging.status = 'healthy';
                } catch (error) {
                    health.components.logging.status = 'error';
                }

                // Overall status
                const componentStatuses = Object.values(health.components).map(c => c.status);
                if (componentStatuses.includes('error')) {
                    health.status = 'degraded';
                } else if (componentStatuses.includes('unknown')) {
                    health.status = 'unknown';
                }

                res.json(health);
            } catch (error) {
                res.json({
                    status: 'error',
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
            }
        });

        // Default route
        this.app.get('/', (req, res) => {
            res.send(this.generateDashboardHTML());
        });
    }

    validateOSCPatterns(patterns) {
        const results = [];
        const issues = [];
        
        patterns.forEach((pattern, index) => {
            const validation = this.validateSingleOSCPattern(pattern, index);
            results.push(validation);
            if (!validation.valid) {
                issues.push(validation);
            }
        });
        
        return {
            totalPatterns: patterns.length,
            validPatterns: results.filter(r => r.valid).length,
            invalidPatterns: results.filter(r => !r.valid).length,
            results,
            issues
        };
    }

    validateSingleOSCPattern(pattern, index) {
        const result = {
            index,
            pattern,
            valid: true,
            issues: []
        };
        
        // Check if pattern is a string or object with address
        const address = typeof pattern === 'string' ? pattern : pattern.address;
        
        if (!address) {
            result.valid = false;
            result.issues.push('Missing OSC address');
            return result;
        }
        
        // Must start with /
        if (!address.startsWith('/')) {
            result.valid = false;
            result.issues.push('OSC address must start with "/"');
        }
        
        // Check for valid characters
        const validOSCRegex = /^\/[a-zA-Z0-9_\-\/\*\?\[\]]*$/;
        if (!validOSCRegex.test(address)) {
            result.valid = false;
            result.issues.push('Contains invalid characters for OSC address');
        }
        
        // Check length
        if (address.length < 2) {
            result.valid = false;
            result.issues.push('OSC address too short');
        }
        
        if (address.length > 200) {
            result.valid = false;
            result.issues.push('OSC address too long');
        }
        
        // Check for common PDF artifacts
        const pdfArtifacts = ['Type', 'Font', 'Length', 'Filter', 'Producer', 'Root', 'Info'];
        if (pdfArtifacts.some(artifact => address.includes(artifact))) {
            result.valid = false;
            result.issues.push('Appears to be PDF metadata, not OSC address');
        }
        
        return result;
    }

    storePatterns(patterns, applicationName, source) {
        try {
            const patternsFile = path.join(__dirname, 'extracted-osc-patterns.json');
            
            // Create pattern objects with metadata
            const patternObjects = patterns.map(pattern => ({
                address: typeof pattern === 'string' ? pattern : pattern.address,
                description: typeof pattern === 'object' ? pattern.description : `OSC pattern for ${applicationName}`,
                source: source,
                application: applicationName,
                category: this.categorizePattern(typeof pattern === 'string' ? pattern : pattern.address),
                extractedAt: new Date().toISOString(),
                expectedArgs: typeof pattern === 'object' ? pattern.expectedArgs || [] : []
            }));
            
            // Load existing patterns
            let existingData = { patterns: [], metadata: {} };
            if (fs.existsSync(patternsFile)) {
                existingData = JSON.parse(fs.readFileSync(patternsFile, 'utf8'));
            }
            
            // Add new patterns (avoid duplicates)
            const existingAddresses = new Set(existingData.patterns.map(p => p.address));
            const newPatterns = patternObjects.filter(p => !existingAddresses.has(p.address));
            
            existingData.patterns.push(...newPatterns);
            
            // Update metadata
            existingData.metadata = {
                extractedAt: new Date().toISOString(),
                totalPatterns: existingData.patterns.length,
                applications: [...new Set(existingData.patterns.map(p => p.application))],
                categories: [...new Set(existingData.patterns.map(p => p.category))],
                lastUpdate: new Date().toISOString()
            };
            
            // Save to file
            fs.writeFileSync(patternsFile, JSON.stringify(existingData, null, 2));
            
            console.log(`✅ Stored ${newPatterns.length} new patterns (${patternObjects.length - newPatterns.length} duplicates skipped)`);
            
        } catch (error) {
            console.error('Error storing patterns:', error);
            throw error;
        }
    }

    categorizePattern(address) {
        const categories = {
            'audio': ['audio', 'sound', 'synth', 'osc', 'freq', 'amp', 'volume', 'gain'],
            'midi': ['midi', 'note', 'velocity', 'pitch', 'bend', 'mod'],
            'control': ['control', 'param', 'knob', 'slider', 'button'],
            'effects': ['reverb', 'delay', 'chorus', 'filter', 'eq', 'compressor'],
            'transport': ['play', 'stop', 'record', 'pause', 'tempo', 'bpm'],
            'mix': ['mix', 'send', 'return', 'aux', 'master', 'channel', 'track'],
            'video': ['video', 'visual', 'color', 'brightness', 'contrast']
        };
        
        const addressLower = address.toLowerCase();
        
        for (const [category, keywords] of Object.entries(categories)) {
            if (keywords.some(keyword => addressLower.includes(keyword))) {
                return category;
            }
        }
        
        return 'general';
    }

    generatePatternsSummary(patterns) {
        const summary = {
            total: patterns.length,
            applications: {},
            categories: {},
            sources: {}
        };

        patterns.forEach(pattern => {
            // Group by application
            if (!summary.applications[pattern.application]) {
                summary.applications[pattern.application] = 0;
            }
            summary.applications[pattern.application]++;

            // Group by category
            if (!summary.categories[pattern.category]) {
                summary.categories[pattern.category] = 0;
            }
            summary.categories[pattern.category]++;

            // Group by source
            if (!summary.sources[pattern.source]) {
                summary.sources[pattern.source] = 0;
            }
            summary.sources[pattern.source]++;
        });

        return summary;
    }

    searchPatterns(query, application, category, limit) {
        let patterns = this.loadExtractedPatterns();

        // Filter by application
        if (application) {
            patterns = patterns.filter(p => 
                p.application.toLowerCase().includes(application.toLowerCase())
            );
        }

        // Filter by category
        if (category) {
            patterns = patterns.filter(p => p.category === category);
        }

        // Search in address and description
        const queryLower = query.toLowerCase();
        const searchResults = patterns.filter(pattern => 
            pattern.address.toLowerCase().includes(queryLower) ||
            pattern.description.toLowerCase().includes(queryLower)
        );

        // Limit results
        return searchResults.slice(0, limit);
    }

    generateDashboardHTML() {
        return `
<!DOCTYPE html>
<html>
<head>
    <title>MCP2OSC Dashboard</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; }
        .card { background: white; padding: 20px; margin: 20px 0; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
        .btn { background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; text-decoration: none; display: inline-block; }
        .btn:hover { background: #0056b3; }
        .feature { margin: 10px 0; }
        .feature-title { font-weight: bold; color: #333; }
        .feature-desc { color: #666; font-size: 14px; }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin: 20px 0; }
        .stat-card { background: #f8f9fa; padding: 15px; border-radius: 6px; text-align: center; }
        .stat-value { font-size: 24px; font-weight: bold; color: #007bff; }
        .stat-label { font-size: 12px; color: #666; margin-top: 5px; }
        .logs-container { background: #2a2a2a; color: #fff; padding: 15px; border-radius: 6px; height: 300px; overflow-y: auto; font-family: monospace; font-size: 12px; }
        .log-entry { margin-bottom: 5px; }
        .log-timestamp { color: #888; }
        .log-level { font-weight: bold; }
        .log-level.INFO { color: #4CAF50; }
        .log-level.WARN { color: #FF9800; }
        .log-level.ERROR { color: #F44336; }
        .osc-messages { background: #f8f9fa; padding: 15px; border-radius: 6px; height: 250px; overflow-y: auto; }
        .osc-message { padding: 8px; margin-bottom: 5px; background: white; border-radius: 3px; font-family: monospace; font-size: 11px; }
        .test-section { background: #e9ecef; padding: 15px; border-radius: 6px; margin-top: 15px; }
        .form-group { margin-bottom: 10px; }
        label { display: block; margin-bottom: 3px; font-weight: bold; font-size: 12px; }
        input { width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 3px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎵 MCP2OSC Dashboard</h1>
        
        <!-- System Statistics -->
        <div class="card">
            <h3>📊 System Status</h3>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value" id="uptime">--</div>
                    <div class="stat-label">Uptime</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value" id="mcp-messages">0</div>
                    <div class="stat-label">MCP Messages</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value" id="osc-messages">0</div>
                    <div class="stat-label">OSC Messages</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value" id="errors">0</div>
                    <div class="stat-label">Errors</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value" id="patterns-count">0</div>
                    <div class="stat-label">Stored Patterns</div>
                </div>
            </div>
        </div>
        
        <div class="grid">
            <div class="card">
                <h3>🤖 Claude Integration</h3>
                <p>Claude can manage OSC patterns and send messages:</p>
                <ul>
                    <li><code>"Add OSC pattern /audio/volume for volume control"</code></li>
                    <li><code>"Get all stored OSC patterns"</code></li>
                    <li><code>"Send OSC message to /audio/volume with value 0.8"</code></li>
                </ul>
            </div>
            
            <div class="card">
                <h3>� Pattern Management</h3>
                <div class="feature">
                    <div class="feature-title">Claude Pattern Storage</div>
                    <div class="feature-desc">Claude can add new OSC patterns to the system</div>
                </div>
                <div class="feature">
                    <div class="feature-title">Pattern Retrieval</div>
                    <div class="feature-desc">Claude can search and retrieve stored patterns</div>
                </div>
                <div class="feature">
                    <div class="feature-title">Smart Messaging</div>
                    <div class="feature-desc">Use stored patterns for accurate OSC messaging</div>
                </div>
            </div>
            
            <div class="card">
                <h3>🎛️ OSC Communication</h3>
                <div class="feature">
                    <div class="feature-title">Real-time Monitoring</div>
                    <div class="feature-desc">View all OSC messages sent and received</div>
                </div>
                <div class="feature">
                    <div class="feature-title">Message Testing</div>
                    <div class="feature-desc">Send test OSC messages directly from dashboard</div>
                </div>
                <div class="feature">
                    <div class="feature-title">Pattern Integration</div>
                    <div class="feature-desc">Use stored patterns for reliable communication</div>
                </div>
            </div>
        </div>
        
        <div class="grid">
            <!-- System Logs -->
            <div class="card">
                <h3>� System Logs</h3>
                <div class="logs-container" id="logs-container">
                    <div>Loading logs...</div>
                </div>
            </div>
            
            <!-- OSC Messages -->
            <div class="card">
                <h3>📡 OSC Messages</h3>
                <div class="osc-messages" id="osc-messages-container">
                    <div>Loading OSC messages...</div>
                </div>
                
                <!-- Test OSC -->
                <div class="test-section">
                    <h4>🧪 Test OSC Message</h4>
                    <div class="form-group">
                        <label for="osc-address">OSC Address:</label>
                        <input type="text" id="osc-address" placeholder="/test/frequency" value="/test/frequency">
                    </div>
                    <div class="form-group">
                        <label for="osc-args">Arguments (JSON array):</label>
                        <input type="text" id="osc-args" placeholder='[440, 0.5]' value="[440, 0.5]">
                    </div>
                    <button onclick="sendTestOSC()" class="btn">Send OSC Message</button>
                </div>
            </div>
        </div>
        
        <div class="card">
            <h3>📊 OSC Patterns Status</h3>
            <div id="patterns-status">Loading...</div>
        </div>
    </div>

    <script>
        // Auto-refresh data
        async function loadStatus() {
            try {
                // Load system status
                const statusResponse = await fetch('/api/status');
                const status = await statusResponse.json();
                updateStats(status);
                
                // Load pattern summary
                const patternsResponse = await fetch('/api/patterns/summary');
                const patterns = await patternsResponse.json();
                updatePatternsStatus(patterns);
                
                // Load logs
                const logsResponse = await fetch('/api/logs');
                const logs = await logsResponse.json();
                updateLogs(logs);
                
                // Load OSC messages
                const oscResponse = await fetch('/api/osc-messages');
                const oscData = await oscResponse.json();
                updateOSCMessages(oscData);
                
            } catch (error) {
                console.error('Failed to load status:', error);
            }
        }
        
        function updateStats(status) {
            document.getElementById('uptime').textContent = formatDuration(status.uptime);
            document.getElementById('mcp-messages').textContent = status.stats.mcpMessages;
            document.getElementById('osc-messages').textContent = status.stats.oscMessages;
            document.getElementById('errors').textContent = status.stats.errors;
        }
        
        function updatePatternsStatus(patterns) {
            document.getElementById('patterns-count').textContent = patterns.total;
            
            let html = '<div class="grid">';
            html += '<div><strong>Total Patterns:</strong> ' + patterns.total + '</div>';
            html += '<div><strong>Applications:</strong> ' + Object.keys(patterns.applications).length + '</div>';
            html += '<div><strong>Categories:</strong> ' + Object.keys(patterns.categories).length + '</div>';
            html += '</div>';
            
            if (patterns.total > 0) {
                html += '<h4>📱 Applications:</h4>';
                Object.entries(patterns.applications).forEach(([app, count]) => {
                    html += '<div>' + app + ': ' + count + ' patterns</div>';
                });
            } else {
                html += '<p>No patterns stored yet. Ask Claude to add OSC patterns to get started.</p>';
            }
            
            document.getElementById('patterns-status').innerHTML = html;
        }
        
        function updateLogs(logs) {
            const container = document.getElementById('logs-container');
            container.innerHTML = '';
            logs.slice(-20).forEach(log => {
                const entry = document.createElement('div');
                entry.className = 'log-entry';
                const timestamp = new Date(log.timestamp).toLocaleTimeString();
                entry.innerHTML = '<span class="log-timestamp">' + timestamp + '</span> <span class="log-level ' + log.level + '">' + log.level + '</span> ' + log.message;
                container.appendChild(entry);
            });
            container.scrollTop = container.scrollHeight;
        }
        
        function updateOSCMessages(response) {
            const container = document.getElementById('osc-messages-container');
            container.innerHTML = '';
            
            if (response.success && response.messages && response.messages.length > 0) {
                response.messages.slice(-10).forEach(msg => {
                    const entry = document.createElement('div');
                    entry.className = 'osc-message';
                    const timestamp = new Date(msg.timestamp).toLocaleTimeString();
                    
                    // Handle direction display with colors
                    const direction = msg.direction ? '[' + msg.direction.toUpperCase() + ']' : '';
                    const directionColor = msg.direction === 'outbound' ? 'color: #007bff;' : 
                                         msg.direction === 'inbound' ? 'color: #28a745;' : '';
                    
                    // Handle source display
                    const source = msg.source ? 
                        (typeof msg.source === 'object' ? msg.source.address + ':' + msg.source.port : msg.source) : 
                        'unknown';
                    
                    entry.innerHTML = '<strong>' + msg.address + '</strong> <span style="' + directionColor + '">' + direction + '</span> [' + (msg.args || []).join(', ') + ']<br>Source: ' + source + ' at ' + timestamp;
                    container.appendChild(entry);
                });
            } else {
                const entry = document.createElement('div');
                entry.className = 'osc-message';
                entry.innerHTML = response.error || 'No OSC messages available. Send OSC messages via Claude or MaxMSP to see them here.';
                entry.style.fontStyle = 'italic';
                entry.style.color = '#666';
                container.appendChild(entry);
            }
            
            container.scrollTop = container.scrollHeight;
        }
        
        function formatDuration(ms) {
            const seconds = Math.floor(ms / 1000);
            const minutes = Math.floor(seconds / 60);
            const hours = Math.floor(minutes / 60);
            
            if (hours > 0) return hours + 'h ' + (minutes % 60) + 'm';
            if (minutes > 0) return minutes + 'm ' + (seconds % 60) + 's';
            return seconds + 's';
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
                    loadStatus(); // Refresh to show new message
                } else {
                    alert('Error: ' + result.error);
                }
            } catch (error) {
                alert('Error: ' + error.message);
            }
        }
        
        // Initial load and auto-refresh
        loadStatus();
        setInterval(loadStatus, 5000); // Refresh every 5 seconds
    </script>
</body>
</html>
        `;
    }

    loadExtractedPatterns() {
        try {
            const patternsFile = path.join(__dirname, 'extracted-osc-patterns.json');
            
            if (fs.existsSync(patternsFile)) {
                const fileContent = fs.readFileSync(patternsFile, 'utf8').trim();
                
                // Handle empty file
                if (!fileContent) {
                    console.log('Patterns file is empty, initializing...');
                    this.initializePatternsFile(patternsFile);
                    return [];
                }
                
                const data = JSON.parse(fileContent);
                return data.patterns || [];
            } else {
                console.log('Patterns file does not exist, creating...');
                this.initializePatternsFile(patternsFile);
                return [];
            }
        } catch (error) {
            console.warn('Error loading patterns from file:', error.message);
            console.log('Attempting to recover patterns file...');
            
            // Attempt to recover by reinitializing the file
            try {
                const patternsFile = path.join(__dirname, 'extracted-osc-patterns.json');
                this.initializePatternsFile(patternsFile);
            } catch (recoveryError) {
                console.error('Failed to recover patterns file:', recoveryError.message);
            }
        }
        
        return [];
    }

    initializePatternsFile(patternsFile) {
        const initialData = {
            patterns: [],
            metadata: {
                extractedAt: new Date().toISOString(),
                totalPatterns: 0,
                applications: [],
                categories: [],
                lastUpdate: new Date().toISOString()
            }
        };
        
        // Ensure directory exists
        const dir = path.dirname(patternsFile);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        fs.writeFileSync(patternsFile, JSON.stringify(initialData, null, 2));
        console.log('✅ Initialized empty patterns file');
    }

    async loadLogs() {
        try {
            if (fs.existsSync(CONFIG.LOG_FILE)) {
                const logContent = await fs.promises.readFile(CONFIG.LOG_FILE, 'utf8');
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

                // Update statistics from logs (only if we haven't done this recently)
                if (!this.lastStatsUpdate || Date.now() - this.lastStatsUpdate > 30000) {
                    const mcpMessages = lines.filter(line => 
                        line.includes('[MCP]') || 
                        line.includes('MCP tool call') || 
                        line.includes('User Query:')
                    ).length;
                    
                    const oscSentMessages = lines.filter(line => 
                        line.includes('Test OSC message sent') || 
                        line.includes('OSC message sent')
                    ).length;
                    
                    const oscReceivedMessages = lines.filter(line => 
                        line.includes('OSC received:')
                    ).length;
                    
                    const errors = lines.filter(line => 
                        line.includes('[ERROR]') || 
                        line.includes('Failed') || 
                        line.includes('Error')
                    ).length;

                    STATE.stats.mcpMessages = mcpMessages;
                    STATE.stats.oscMessages = oscSentMessages + oscReceivedMessages;
                    STATE.stats.errors = errors;
                    this.lastStatsUpdate = Date.now();

                    // Only log stats update occasionally
                    if (!this.lastStatsLog || Date.now() - this.lastStatsLog > 60000) {
                        console.log(`📊 Stats updated: ${mcpMessages} MCP, ${STATE.stats.oscMessages} OSC, ${errors} errors`);
                        this.lastStatsLog = Date.now();
                    }
                }
            }
        } catch (error) {
            console.error('Failed to load logs:', error.message);
            STATE.stats.errors++;
        }
    }

    async logActivity(message, data = null) {
        try {
            const timestamp = new Date().toISOString();
            const logLine = `${timestamp} [DASHBOARD] ${message}${data ? ` ${JSON.stringify(data)}` : ''}\n`;
            await fs.promises.appendFile(CONFIG.LOG_FILE, logLine);
            
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
            
            // Update statistics based on message content
            if (message.includes('Test OSC message sent')) {
                STATE.stats.oscMessages++;
            } else if (message.includes('OSC received:')) {
                STATE.stats.oscMessages++;
            } else if (message.includes('patterns extracted')) {
                // This is a successful pattern extraction
            }
        } catch (error) {
            console.warn('Failed to log activity:', error.message);
            STATE.stats.errors++;
        }
    }

    setupLogWatcher() {
        // Watch for new log entries with rate limiting
        let lastLogSize = 0;
        
        setInterval(async () => {
            try {
                if (fs.existsSync(CONFIG.LOG_FILE)) {
                    const stats = await fs.promises.stat(CONFIG.LOG_FILE);
                    
                    // Only reload if file size changed significantly (more than 1KB)
                    if (Math.abs(stats.size - lastLogSize) > 1024) {
                        lastLogSize = stats.size;
                        await this.loadLogs();
                    }
                }
            } catch (error) {
                // Ignore errors in log watching
            }
        }, 10000); // Check every 10 seconds instead of 2 seconds

        // Initial size check
        if (fs.existsSync(CONFIG.LOG_FILE)) {
            fs.promises.stat(CONFIG.LOG_FILE).then(stats => {
                lastLogSize = stats.size;
            }).catch(() => {});
        }
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
                        console.log(`📥 OSC received: ${message.address} [${message.args.join(', ')}] from ${rinfo.address}:${rinfo.port}`);
                        
                        // Also store in local STATE for dashboard display
                        this.storeOscMessage(message.address, message.args, rinfo.address, rinfo.port);
                        
                        // Log to file (consistent with MCP server logging)
                        this.logActivity(`OSC received: ${message.address} [${message.args.join(', ')}] from ${rinfo.address}:${rinfo.port}`, {
                            address: message.address,
                            args: message.args,
                            source: rinfo.address,
                            port: rinfo.port
                        });
                        
                        STATE.stats.oscMessages++;
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

    storeOscMessage(address, args, source, port) {
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
            this.logActivity(`Test OSC message sent: ${address} [${(args || []).join(', ')}] → ${CONFIG.OSC_HOST}:${CONFIG.OSC_SEND_PORT}`, {
                address,
                args: args || [],
                host: CONFIG.OSC_HOST,
                port: CONFIG.OSC_SEND_PORT
            });

            // Also store as outbound message in shared storage
            addOSCMessage(address, args || [], CONFIG.OSC_HOST, CONFIG.OSC_SEND_PORT, 'outbound');
            
            STATE.stats.oscMessages++;
            
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

    start(port = 3001) {
        this.app.listen(port, () => {
            console.log(`🌐 Enhanced Dashboard Server running on http://localhost:${port}`);
            console.log(` OSC receiver listening on ${CONFIG.OSC_HOST}:${CONFIG.OSC_RECEIVE_PORT}`);
            console.log(`📡 OSC output: ${CONFIG.OSC_HOST}:${CONFIG.OSC_SEND_PORT}`);
            console.log(`🤖 Claude can add patterns via MCP tools`);
        });
    }
}

// If this file is run directly, start the server
if (import.meta.url === `file://${process.argv[1]}`) {
    const server = new EnhancedDashboardServer();
    server.start(3001);
}