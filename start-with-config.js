#!/usr/bin/env node

/**
 * MCP2OSC Configuration Aware Startup
 * Reads Claude Desktop config and applies OSC settings
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class ConfigAwareStartup {
  constructor() {
    this.config = {
      OSC_SEND_PORT: '7500',
      OSC_RECEIVE_PORT: '7501', 
      OSC_HOST: '127.0.0.1',
      DASHBOARD_PORT: '3001'
    };
  }

  async start() {
    console.log('🔧 MCP2OSC Configuration Aware Startup');
    console.log('=====================================\n');

    // Try to read Claude Desktop config
    await this.readClaudeDesktopConfig();
    
    // Display configuration
    this.displayConfiguration();
    
    // Start service manager with environment variables
    this.startServiceManager();
  }

  async readClaudeDesktopConfig() {
    try {
      const configPath = this.getClaudeDesktopConfigPath();
      
      if (!fs.existsSync(configPath)) {
        console.log('⚠️  Claude Desktop config not found, using defaults');
        return;
      }

      const configContent = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(configContent);
      
      // Look for mcp2osc server configuration
      const mcp2oscServer = config.mcpServers?.mcp2osc;
      
      if (mcp2oscServer && mcp2oscServer.env) {
        console.log('✅ Found Claude Desktop MCP2OSC configuration');
        
        // Apply environment variables from Claude Desktop config
        if (mcp2oscServer.env.OSC_SEND_PORT) {
          this.config.OSC_SEND_PORT = mcp2oscServer.env.OSC_SEND_PORT;
        }
        if (mcp2oscServer.env.OSC_RECEIVE_PORT) {
          this.config.OSC_RECEIVE_PORT = mcp2oscServer.env.OSC_RECEIVE_PORT;
        }
        if (mcp2oscServer.env.OSC_HOST) {
          this.config.OSC_HOST = mcp2oscServer.env.OSC_HOST;
        }
        if (mcp2oscServer.env.DASHBOARD_PORT) {
          this.config.DASHBOARD_PORT = mcp2oscServer.env.DASHBOARD_PORT;
        }
        
        console.log('📋 Applied configuration from Claude Desktop');
      } else {
        console.log('⚠️  No MCP2OSC environment config found in Claude Desktop, using defaults');
      }
      
    } catch (error) {
      console.log('⚠️  Could not read Claude Desktop config:', error.message);
      console.log('   Using default configuration');
    }
  }

  getClaudeDesktopConfigPath() {
    const platform = os.platform();
    const homeDir = os.homedir();
    
    switch (platform) {
      case 'darwin': // macOS
        return path.join(homeDir, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
      case 'win32': // Windows
        return path.join(process.env.APPDATA || homeDir, 'Claude', 'claude_desktop_config.json');
      default: // Linux
        return path.join(homeDir, '.config', 'Claude', 'claude_desktop_config.json');
    }
  }

  displayConfiguration() {
    console.log('\n🔧 Applied Configuration:');
    console.log(`   OSC_HOST: ${this.config.OSC_HOST}`);
    console.log(`   OSC_SEND_PORT: ${this.config.OSC_SEND_PORT}`);
    console.log(`   OSC_RECEIVE_PORT: ${this.config.OSC_RECEIVE_PORT}`);
    console.log(`   DASHBOARD_PORT: ${this.config.DASHBOARD_PORT}`);
    console.log('');
  }

  startServiceManager() {
    console.log('🚀 Starting Service Manager with applied configuration...\n');
    
    // Set environment variables
    const env = {
      ...process.env,
      OSC_SEND_PORT: this.config.OSC_SEND_PORT,
      OSC_RECEIVE_PORT: this.config.OSC_RECEIVE_PORT,
      OSC_HOST: this.config.OSC_HOST,
      DASHBOARD_PORT: this.config.DASHBOARD_PORT
    };
    
    // Start service manager
    const serviceManager = spawn('node', ['service-manager.js'], {
      cwd: __dirname,
      env: env,
      stdio: 'inherit'
    });
    
    serviceManager.on('exit', (code) => {
      console.log(`\n📋 Service Manager exited with code ${code}`);
      process.exit(code);
    });
    
    serviceManager.on('error', (error) => {
      console.error('❌ Failed to start Service Manager:', error);
      process.exit(1);
    });
    
    // Handle shutdown signals
    process.on('SIGINT', () => {
      console.log('\n🛑 Shutting down...');
      serviceManager.kill('SIGINT');
    });
    
    process.on('SIGTERM', () => {
      console.log('\n🛑 Terminating...');
      serviceManager.kill('SIGTERM');
    });
  }
}

// Start the configuration aware startup
const startup = new ConfigAwareStartup();
startup.start().catch(console.error);