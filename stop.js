#!/usr/bin/env node

/**
 * Stop MCP2OSC Script
 * Finds and stops any running MCP2OSC processes
 */

import { execSync } from 'child_process';

function stopMCP2OSC() {
  console.log('🛑 Stopping MCP2OSC processes...');
  
  try {
    // Find processes using ports 3001 and 3002
    let pids = [];
    
    [3001, 3002].forEach(port => {
      try {
        const lsofResult = execSync(`lsof -ti :${port}`, { encoding: 'utf8' });
        const portPids = lsofResult.trim().split('\n').filter(pid => pid);
        pids.push(...portPids);
        console.log(`📋 Found ${portPids.length} process(es) using port ${port}`);
      } catch (error) {
        // No processes using this port
      }
    });

    // Also find node processes running MCP2OSC scripts
    try {
      const psResult = execSync('ps aux | grep -E "(mcp-server|dashboard-server|start\\.js)" | grep -v grep', { encoding: 'utf8' });
      const lines = psResult.trim().split('\n').filter(line => line);
      
      for (const line of lines) {
        const parts = line.split(/\s+/);
        if (parts.length > 1) {
          pids.push(parts[1]); // PID is the second column
        }
      }
    } catch (error) {
      // No MCP2OSC processes found
    }

    // Remove duplicates
    pids = [...new Set(pids)].filter(pid => pid && pid !== '');

    if (pids.length === 0) {
      console.log('✅ No MCP2OSC processes found running');
      return;
    }

    console.log(`📋 Found ${pids.length} process(es) to stop: ${pids.join(', ')}`);

    // Kill processes gracefully first, then forcefully if needed
    for (const pid of pids) {
      try {
        execSync(`kill -TERM ${pid}`);
        console.log(`✅ Gracefully stopped process ${pid}`);
        
        // Wait a moment for graceful shutdown
        setTimeout(() => {
          try {
            // Check if process still exists
            execSync(`kill -0 ${pid}`, { stdio: 'ignore' });
            // If we get here, process is still running - force kill
            execSync(`kill -9 ${pid}`);
            console.log(`⚡ Force stopped process ${pid}`);
          } catch (error) {
            // Process already stopped
          }
        }, 1000);
        
      } catch (error) {
        console.log(`⚠️  Could not stop process ${pid}: ${error.message}`);
      }
    }

    console.log('\n🎯 MCP2OSC cleanup complete');
    console.log('💡 You can now restart with: npm start');

  } catch (error) {
    console.error('❌ Error stopping processes:', error.message);
    console.log('\n💡 Manual cleanup:');
    console.log('1. Find processes: lsof -i :3001 && lsof -i :3002');
    console.log('2. Kill them: kill -9 <PID>');
  }
}

stopMCP2OSC();