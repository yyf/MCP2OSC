#!/usr/bin/env node

/**
 * Cross-platform setup and start script for MCP2OSC
 * Works on Windows, macOS, and Linux
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

class MCP2OSCStarter {
  constructor() {
    this.processes = [];
  }

  async start() {
    console.log('🚀 MCP2OSC Setup and Start Script');
    console.log('=================================');

    try {
      await this.checkNodeVersion();
      await this.setupDirectories();
      await this.installDependencies();
      await this.startServices();
    } catch (error) {
      console.error('❌ Startup failed:', error.message);
      process.exit(1);
    }
  }

  async checkNodeVersion() {
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
    
    if (majorVersion < 18) {
      throw new Error(`Node.js 18.0+ required. Current version: ${nodeVersion}`);
    }
    
    console.log(`✅ Node.js version: ${nodeVersion}`);
  }

  async setupDirectories() {
    // Create logs directory if it doesn't exist
    const logsDir = join(__dirname, 'logs');
    if (!existsSync(logsDir)) {
      console.log('📁 Creating logs directory...');
      await mkdir(logsDir, { recursive: true });
    }
  }

  async installDependencies() {
    console.log('\n📦 Installing dependencies...');
    
    // Install main dependencies
    await this.runCommand('npm', ['install'], '.');
    
    // Install web dashboard dependencies
    const webDashboardPath = join(__dirname, 'web-dashboard');
    if (existsSync(webDashboardPath)) {
      const nodeModulesPath = join(webDashboardPath, 'node_modules');
      if (!existsSync(nodeModulesPath)) {
        console.log('📦 Installing web dashboard dependencies...');
        await this.runCommand('npm', ['install'], webDashboardPath);
      }
    }
  }

  async startServices() {
    console.log('\n🎯 Starting MCP2OSC services...');
    console.log('==============================');
    console.log('');
    console.log('MCP Server: Running in background (for Claude)');
    console.log('Dashboard: http://localhost:3001');
    console.log('Frontend: http://localhost:3002 (development)');
    console.log('');
    console.log('Press Ctrl+C to stop all services');
    console.log('');

    // Start MCP server in standalone mode (for OSC functionality)
    console.log('🔧 Starting MCP server (standalone mode)...');
    const mcpProcess = spawn('node', ['mcp-server.js'], {
      stdio: ['inherit', 'inherit', 'inherit'],
      cwd: __dirname
    });
    
    this.processes.push(mcpProcess);

    // Start dashboard server
    console.log('📊 Starting dashboard server...');
    const dashboardProcess = spawn('node', ['dashboard-server.js'], {
      stdio: ['inherit', 'inherit', 'inherit'],
      cwd: __dirname
    });
    
    this.processes.push(dashboardProcess);

    // Wait a moment for servers to start
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Start frontend (if web dashboard exists)
    const webDashboardPath = join(__dirname, 'web-dashboard');
    if (existsSync(webDashboardPath)) {
      console.log('🎨 Starting frontend development server...');
      const frontendProcess = spawn('npm', ['run', 'dev'], {
        stdio: ['inherit', 'inherit', 'inherit'],
        cwd: webDashboardPath,
        shell: true
      });
      
      this.processes.push(frontendProcess);
    } else {
      console.log('⚠️  Web dashboard not found - running servers only');
    }

    console.log('\n✅ All services started!');
    console.log('💡 Note: Claude Desktop will start a separate MCP server instance when you use it.');

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n🛑 Shutting down MCP2OSC...');
      this.processes.forEach(proc => {
        try {
          proc.kill('SIGINT');
        } catch (error) {
          // Process might already be dead
        }
      });
      process.exit(0);
    });

    // Wait for processes
    await Promise.all(this.processes.map(proc => 
      new Promise(resolve => proc.on('exit', resolve))
    ));
  }

  async runCommand(command, args, cwd) {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, {
        cwd: cwd || __dirname,
        stdio: ['inherit', 'inherit', 'inherit'],
        shell: process.platform === 'win32'
      });

      proc.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command failed with exit code ${code}`));
        }
      });

      proc.on('error', reject);
    });
  }
}

// Import path fix
import { dirname } from 'path';

// Run the starter
const starter = new MCP2OSCStarter();
starter.start();