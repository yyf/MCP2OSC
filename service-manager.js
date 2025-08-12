#!/usr/bin/env node

/**
 * Unified Service Manager for MCP2OSC
 * Manages all services with proper coordination and logging
 */

import { spawn } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { writeFile, readFile, appendFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createSocket } from 'dgram';

const __dirname = dirname(fileURLToPath(import.meta.url));

class ServiceManager {
  constructor() {
    this.services = new Map();
    this.config = {
      OSC_SEND_PORT: parseInt(process.env.OSC_SEND_PORT || '9500'),
      OSC_RECEIVE_PORT: parseInt(process.env.OSC_RECEIVE_PORT || '9501'),
      OSC_HOST: process.env.OSC_HOST || '127.0.0.1',
      DASHBOARD_PORT: parseInt(process.env.DASHBOARD_PORT || '3001'),
      MCP_MODE: process.env.MCP_MODE || 'standalone',
      // New logging configuration
      MAX_OSC_MESSAGES: parseInt(process.env.MAX_OSC_MESSAGES || '1000'),
      OSC_LOG_ROTATION: process.env.OSC_LOG_ROTATION === 'true' || process.env.OSC_LOG_ROTATION === 'daily',
      LOG_DIR: join(__dirname, 'logs'),
      PATTERNS_FILE: join(__dirname, 'extracted-osc-patterns.json')
    };
    this.isShuttingDown = false;
    
    // Log the configuration being used
    console.log('🔧 Service Manager Configuration:');
    console.log(`   OSC_HOST: ${this.config.OSC_HOST}`);
    console.log(`   OSC_SEND_PORT: ${this.config.OSC_SEND_PORT}`);
    console.log(`   OSC_RECEIVE_PORT: ${this.config.OSC_RECEIVE_PORT}`);
    console.log(`   DASHBOARD_PORT: ${this.config.DASHBOARD_PORT}`);
    console.log(`   MAX_OSC_MESSAGES: ${this.config.MAX_OSC_MESSAGES}`);
    console.log(`   OSC_LOG_ROTATION: ${this.config.OSC_LOG_ROTATION ? 'Daily' : 'Single file'}`);
    console.log('');
  }

  async start() {
    console.log('🚀 MCP2OSC Service Manager Starting...');
    console.log('=====================================');
    
    // Show environment source
    const envSource = process.env.OSC_SEND_PORT !== '7500' || process.env.OSC_RECEIVE_PORT !== '7501' ? 
      'environment variables' : 'default values';
    console.log(`📋 Using ${envSource} for OSC configuration`);

    try {
      await this.initializeEnvironment();
      await this.checkPorts();
      await this.initializeLogging();
      await this.startServices();
      this.setupGracefulShutdown();
      
      console.log('\n✅ All services running successfully!');
      this.printServiceStatus();
      
    } catch (error) {
      console.error('❌ Service manager failed:', error.message);
      await this.shutdown();
      process.exit(1);
    }
  }

  async initializeEnvironment() {
    console.log('🔧 Initializing environment...');
    
    // Create directories
    if (!existsSync(this.config.LOG_DIR)) {
      mkdirSync(this.config.LOG_DIR, { recursive: true });
      console.log('📁 Created logs directory');
    }

    // Initialize patterns file
    if (!existsSync(this.config.PATTERNS_FILE)) {
      const initialData = {
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
      
      await writeFile(this.config.PATTERNS_FILE, JSON.stringify(initialData, null, 2));
      console.log('📝 Initialized patterns file');
    }

    // Initialize log files
    const logFiles = [
      join(this.config.LOG_DIR, 'mcp2osc.log'),
      join(this.config.LOG_DIR, 'osc-messages.json'),
      join(this.config.LOG_DIR, 'command-queue.json')
    ];

    for (const logFile of logFiles) {
      if (!existsSync(logFile)) {
        if (logFile.endsWith('.json')) {
          await writeFile(logFile, JSON.stringify([], null, 2));
        } else {
          await writeFile(logFile, `${new Date().toISOString()} [SYSTEM] Log file initialized\n`);
        }
        console.log(`📄 Initialized ${logFile.split('/').pop()}`);
      }
    }

    console.log('✅ Environment initialized');
  }

  async checkPorts() {
    console.log('🔍 Checking port availability...');
    
    const portsToCheck = [
      { port: this.config.OSC_SEND_PORT, name: 'OSC Send' },
      { port: this.config.OSC_RECEIVE_PORT, name: 'OSC Receive' },
      { port: this.config.DASHBOARD_PORT, name: 'Dashboard' }
    ];

    for (const { port, name } of portsToCheck) {
      if (await this.isPortInUse(port)) {
        console.log(`⚠️  Port ${port} (${name}) is in use - checking for MaxMSP...`);
        
        const isMaxMSP = await this.checkIfMaxMSPOnPort(port);
        if (isMaxMSP) {
          console.log(`🎵 MaxMSP detected on port ${port} - allowing shared use`);
          console.log(`✅ Port ${port} (${name}) - MaxMSP compatible mode`);
          continue; // Don't kill MaxMSP, allow shared use
        }
        
        console.log(`🛑 Non-MaxMSP process on port ${port} - attempting to free it`);
        await this.killProcessOnPort(port);
        
        // Wait and check again
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        if (await this.isPortInUse(port)) {
          const stillMaxMSP = await this.checkIfMaxMSPOnPort(port);
          if (stillMaxMSP) {
            console.log(`✅ Port ${port} (${name}) - MaxMSP compatible mode`);
          } else {
            console.warn(`⚠️  Port ${port} (${name}) still in use - may cause conflicts`);
          }
        } else {
          console.log(`✅ Port ${port} (${name}) freed successfully`);
        }
      } else {
        console.log(`✅ Port ${port} (${name}) available`);
      }
    }
    
    // Add delay to let MaxMSP stabilize if it was detected
    console.log('⏱️  Allowing MaxMSP to stabilize...');
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  async checkIfMaxMSPOnPort(port) {
    try {
      const { execSync } = await import('child_process');
      
      if (process.platform === 'win32') {
        // Windows
        const result = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
        const lines = result.split('\n').filter(line => line.includes(':' + port));
        
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && !isNaN(pid)) {
            try {
              const processInfo = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV`, { encoding: 'utf8' });
              if (processInfo.toLowerCase().includes('max.exe') || 
                  processInfo.toLowerCase().includes('maxmsp') ||
                  processInfo.toLowerCase().includes('cycling74')) {
                return true;
              }
            } catch (error) {
              // Continue checking other processes
            }
          }
        }
      } else {
        // Unix/macOS
        const result = execSync(`lsof -ti :${port}`, { encoding: 'utf8' });
        const pids = result.trim().split('\n').filter(pid => pid);
        
        for (const pid of pids) {
          try {
            const processInfo = execSync(`ps -p ${pid} -o comm=`, { encoding: 'utf8' });
            if (processInfo.toLowerCase().includes('max') || 
                processInfo.toLowerCase().includes('maxmsp') ||
                processInfo.toLowerCase().includes('cycling74')) {
              return true;
            }
          } catch (error) {
            // Continue checking other processes
          }
        }
      }
      
      return false;
    } catch (error) {
      return false;
    }
  }

  async isPortInUse(port) {
    return new Promise((resolve) => {
      const socket = createSocket('udp4');
      
      socket.on('error', () => {
        resolve(true); // Port in use
      });
      
      socket.bind(port, () => {
        socket.close();
        resolve(false); // Port available
      });
    });
  }

  async killProcessOnPort(port) {
    try {
      const { execSync } = await import('child_process');
      
      if (process.platform === 'win32') {
        // Windows
        const result = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
        const lines = result.split('\n').filter(line => line.includes(':' + port));
        
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && !isNaN(pid)) {
            // Check if process is MaxMSP before killing
            try {
              const processInfo = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV`, { encoding: 'utf8' });
              if (processInfo.toLowerCase().includes('max.exe') || 
                  processInfo.toLowerCase().includes('maxmsp') ||
                  processInfo.toLowerCase().includes('cycling74')) {
                console.log(`🎵 Detected MaxMSP process (PID: ${pid}) - preserving`);
                continue; // Don't kill MaxMSP
              }
            } catch (error) {
              // If we can't check process info, kill it anyway
            }
            execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
          }
        }
      } else {
        // Unix/macOS
        const result = execSync(`lsof -ti :${port}`, { encoding: 'utf8' });
        const pids = result.trim().split('\n').filter(pid => pid);
        
        for (const pid of pids) {
          // Check if process is MaxMSP before killing
          try {
            const processInfo = execSync(`ps -p ${pid} -o comm=`, { encoding: 'utf8' });
            if (processInfo.toLowerCase().includes('max') || 
                processInfo.toLowerCase().includes('maxmsp') ||
                processInfo.toLowerCase().includes('cycling74')) {
              console.log(`🎵 Detected MaxMSP process (PID: ${pid}) - preserving`);
              continue; // Don't kill MaxMSP
            }
          } catch (error) {
            // If we can't check process info, kill it anyway
          }
          execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
        }
      }
    } catch (error) {
      // Ignore errors - process might not exist
    }
  }

  async initializeLogging() {
    console.log('📝 Setting up logging...');
    
    // Create initial log entry
    const timestamp = new Date().toISOString();
    const logEntry = `${timestamp} [SERVICE_MANAGER] MCP2OSC Service Manager started\n`;
    
    await appendFile(join(this.config.LOG_DIR, 'mcp2osc.log'), logEntry);
    
    // Create sample OSC message for testing
    const sampleOSCMessage = {
      timestamp: new Date().toISOString(),
      address: '/system/startup',
      args: ['service_manager', 'initialized'],
      source: { address: '127.0.0.1', port: 7500 },
      raw: '2f73797374656d2f737461727475700000'
    };
    
    const oscLogFile = join(this.config.LOG_DIR, 'osc-messages.json');
    let oscMessages = [];
    
    try {
      const content = await readFile(oscLogFile, 'utf8');
      oscMessages = JSON.parse(content);
    } catch (error) {
      // File doesn't exist or is empty
    }
    
    oscMessages.push(sampleOSCMessage);
    await writeFile(oscLogFile, JSON.stringify(oscMessages, null, 2));
    
    console.log('✅ Logging initialized');
  }

  async startServices() {
    console.log('🎯 Starting services...');
    
    // Start MCP server first (in standalone mode for OSC functionality)
    if (this.config.MCP_MODE === 'standalone') {
      await this.startMCPServer();
    }
    
    // Wait for MCP server to initialize
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Start dashboard
    await this.startDashboard();
    
    // Wait for dashboard to start
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  async startMCPServer() {
    console.log('🔧 Starting MaxMSP-compatible MCP server...');
    
    const mcpProcess = spawn('node', ['mcp-server-maxmsp-compatible.js'], {
      cwd: __dirname,
      env: { 
        ...process.env, 
        STANDALONE: 'true',
        OSC_SEND_PORT: this.config.OSC_SEND_PORT.toString(),
        OSC_RECEIVE_PORT: this.config.OSC_RECEIVE_PORT.toString(),
        OSC_HOST: this.config.OSC_HOST
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    mcpProcess.stdout.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        console.log(`[MCP] ${output}`);
        this.logActivity(`MCP: ${output}`);
      }
    });

    mcpProcess.stderr.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        console.log(`[MCP] ${output}`);
        this.logActivity(`MCP: ${output}`);
      }
    });

    mcpProcess.on('exit', (code) => {
      if (!this.isShuttingDown) {
        console.error(`❌ MCP server exited with code ${code}`);
        this.logActivity(`MCP server exited with code ${code}`);
      }
    });

    this.services.set('mcp', mcpProcess);
    console.log('✅ MaxMSP-compatible MCP server started');
    
    // Wait for MCP server to be ready
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  async startDashboard() {
    console.log('📊 Starting dashboard server...');
    
    const dashboardProcess = spawn('node', ['enhanced-dashboard-server.js'], {
      cwd: __dirname,
      env: { 
        ...process.env,
        WEB_PORT: this.config.DASHBOARD_PORT.toString(),
        OSC_SEND_PORT: this.config.OSC_SEND_PORT.toString(),
        OSC_RECEIVE_PORT: (this.config.OSC_RECEIVE_PORT + 10).toString(), // Avoid conflict with MCP server
        OSC_HOST: this.config.OSC_HOST
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    dashboardProcess.stdout.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        console.log(`[DASHBOARD] ${output}`);
        this.logActivity(`Dashboard: ${output}`);
      }
    });

    dashboardProcess.stderr.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        console.log(`[DASHBOARD] ${output}`);
        this.logActivity(`Dashboard: ${output}`);
      }
    });

    dashboardProcess.on('exit', (code) => {
      if (!this.isShuttingDown) {
        console.error(`❌ Dashboard server exited with code ${code}`);
        this.logActivity(`Dashboard server exited with code ${code}`);
      }
    });

    this.services.set('dashboard', dashboardProcess);
    console.log('✅ Dashboard server started');
  }

  async logActivity(message) {
    try {
      const timestamp = new Date().toISOString();
      const logEntry = `${timestamp} [SERVICE_MANAGER] ${message}\n`;
      await appendFile(join(this.config.LOG_DIR, 'mcp2osc.log'), logEntry);
    } catch (error) {
      console.warn('Failed to log activity:', error.message);
    }
  }

  printServiceStatus() {
    console.log('\n📋 Service Status:');
    console.log('==================');
    console.log(`🔧 MCP Server: ${this.services.has('mcp') ? '✅ Running' : '❌ Stopped'} (Standalone mode)`);
    console.log(`📊 Dashboard: ${this.services.has('dashboard') ? '✅ Running' : '❌ Stopped'} (http://localhost:${this.config.DASHBOARD_PORT})`);
    console.log(`📡 OSC Send Port: ${this.config.OSC_SEND_PORT}`);
    console.log(`📥 OSC Receive Port: ${this.config.OSC_RECEIVE_PORT}`);
    console.log(`📁 Logs Directory: ${this.config.LOG_DIR}`);
    console.log(`📝 Patterns File: ${this.config.PATTERNS_FILE}`);
    console.log('\n🎯 Usage:');
    console.log('- Open dashboard: http://localhost:' + this.config.DASHBOARD_PORT);
    console.log('- Configure Claude Desktop to use: node mcp-server.js (for MCP mode)');
    console.log('- Send OSC messages to port ' + this.config.OSC_SEND_PORT);
    console.log('- Receive OSC messages on port ' + this.config.OSC_RECEIVE_PORT);
    console.log('\nPress Ctrl+C to stop all services');
  }

  setupGracefulShutdown() {
    const signals = ['SIGINT', 'SIGTERM'];
    
    signals.forEach(signal => {
      process.on(signal, async () => {
        console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
        await this.shutdown();
        process.exit(0);
      });
    });
  }

  async shutdown() {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    
    console.log('🛑 Shutting down services...');
    
    const shutdownPromises = [];
    
    for (const [name, process] of this.services) {
      shutdownPromises.push(
        new Promise((resolve) => {
          console.log(`🛑 Stopping ${name}...`);
          
          process.on('exit', () => {
            console.log(`✅ ${name} stopped`);
            resolve();
          });
          
          // Try graceful shutdown first
          process.kill('SIGINT');
          
          // Force kill after 5 seconds
          setTimeout(() => {
            try {
              process.kill('SIGKILL');
            } catch (error) {
              // Process might already be dead
            }
            resolve();
          }, 5000);
        })
      );
    }
    
    await Promise.all(shutdownPromises);
    await this.logActivity('Service Manager shutdown completed');
    console.log('✅ All services stopped');
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const manager = new ServiceManager();
  manager.start().catch(console.error);
}

export { ServiceManager };