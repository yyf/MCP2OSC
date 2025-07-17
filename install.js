#!/usr/bin/env node

/**
 * Installation and setup script for MCP2OSC
 * Installs dependencies and sets up the system
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { mkdir } from 'fs/promises';

console.log('📦 MCP2OSC Installation Setup');
console.log('=============================\n');

async function install() {
    try {
        // Step 1: Install dependencies
        console.log('1. Installing dependencies...');
        await runCommand('npm', ['install']);
        
        // Step 1.5: Install pattern extraction dependencies
        console.log('1.5. Installing pattern extraction dependencies...');
        const patternDeps = ['express', 'multer', 'pdf-parse', 'mammoth', 'xlsx'];
        await runCommand('npm', ['install', ...patternDeps]);
        
        // Step 1.6: Verify critical dependencies are working
        console.log('1.6. Verifying pattern extraction dependencies...');
        try {
            await import('pdf-parse');
            console.log('   ✅ pdf-parse working correctly');
        } catch (error) {
            console.log('   ⚠️ pdf-parse verification failed, trying alternative install...');
            await runCommand('npm', ['install', 'pdf-parse', '--force']);
        }
        
        console.log('   ✅ Pattern extraction dependencies installed');

        // Step 2: Create directories
        console.log('\n2. Creating directories...');
        const dirs = ['logs', 'uploads'];
        for (const dir of dirs) {
            if (!existsSync(dir)) {
                await mkdir(dir, { recursive: true });
                console.log(`   ✅ Created ${dir}/`);
            } else {
                console.log(`   ✅ ${dir}/ already exists`);
            }
        }

        // Step 3: Run verification
        console.log('\n3. Running verification...');
        await runCommand('node', ['verify-startup.js']);

        console.log('\n✅ Installation complete!');
        console.log('\n🚀 Quick start:');
        console.log('npm start');
        console.log('\n📖 Usage:');
        console.log('1. Visit http://localhost:3001/upload');
        console.log('2. Upload user manual files (PDF, Word, TXT, Excel)');
        console.log('3. Ask Claude: "Get extracted patterns summary"');
        console.log('4. Ask Claude: "Search extracted patterns for volume control"');

    } catch (error) {
        console.error('❌ Installation failed:', error.message);
        process.exit(1);
    }
}

function runCommand(command, args) {
    return new Promise((resolve, reject) => {
        const proc = spawn(command, args, {
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

install();