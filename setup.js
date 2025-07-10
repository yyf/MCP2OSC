#!/usr/bin/env node

/**
 * MCP2OSC Setup Script
 * Installs all dependencies and prepares the project for use
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function setup() {
  console.log('🔧 MCP2OSC Setup');
  console.log('================');
  console.log('This will install all dependencies and prepare MCP2OSC for use.\n');

  try {
    // Check Node.js version
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
    
    if (majorVersion < 18) {
      throw new Error(`Node.js 18.0+ required. Current version: ${nodeVersion}`);
    }
    
    console.log(`✅ Node.js version: ${nodeVersion}`);

    // Create directories
    const logsDir = join(__dirname, 'logs');
    if (!existsSync(logsDir)) {
      console.log('📁 Creating logs directory...');
      await mkdir(logsDir, { recursive: true });
    }

    // Install main dependencies
    console.log('\n📦 Installing main dependencies...');
    await runCommand('npm', ['install']);

    // Install web dashboard dependencies
    const webDashboardPath = join(__dirname, 'web-dashboard');
    if (existsSync(webDashboardPath)) {
      console.log('📦 Installing web dashboard dependencies...');
      await runCommand('npm', ['install'], webDashboardPath);
    }

    console.log('\n🎉 Setup complete!');
    console.log('\nNext steps:');
    console.log('1. Start MCP2OSC: npm start');
    console.log('2. Configure Claude Desktop (see README.md)');
    console.log('3. Open your creative application');
    console.log('4. Start creating!\n');

  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
  }
}

async function runCommand(command, args, cwd = __dirname) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd,
      stdio: ['inherit', 'inherit', 'inherit'],
      shell: process.platform === 'win32'
    });

    proc.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command "${command} ${args.join(' ')}" failed with exit code ${code}`));
      }
    });

    proc.on('error', reject);
  });
}

setup();