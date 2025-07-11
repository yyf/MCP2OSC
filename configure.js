#!/usr/bin/env node

/**
 * MCP2OSC Configuration Helper
 * Generates the correct Claude Desktop configuration with absolute paths
 */

import { execSync } from 'child_process';
import { writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function generateConfig() {
  console.log('🔧 MCP2OSC Configuration Helper');
  console.log('===============================');
  console.log('This will generate the correct Claude Desktop configuration.\n');

  try {
    // Get absolute path to the project
    const projectPath = __dirname;
    const mcpServerPath = join(projectPath, 'mcp-server.js');

    // Find Node.js path
    let nodePath;
    try {
      nodePath = execSync('which node', { encoding: 'utf8' }).trim();
    } catch (error) {
      // Fallback to common paths
      const commonPaths = [
        '/opt/homebrew/bin/node',
        '/usr/local/bin/node',
        '/usr/bin/node'
      ];
      
      nodePath = commonPaths.find(path => existsSync(path));
      if (!nodePath) {
        throw new Error('Could not find Node.js installation');
      }
    }

    console.log(`✅ Project path: ${projectPath}`);
    console.log(`✅ Node.js path: ${nodePath}`);
    console.log(`✅ MCP server: ${mcpServerPath}`);

    // Verify MCP server exists
    if (!existsSync(mcpServerPath)) {
      throw new Error(`MCP server not found at: ${mcpServerPath}`);
    }

    // Generate configuration
    const config = {
      mcpServers: {
        mcp2osc: {
          command: nodePath,
          args: [join(projectPath, 'mcp-server-clean.js')]
        }
      }
    };

    // Find Claude Desktop config path
    const configPaths = [
      join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'), // macOS
      join(homedir(), 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'), // Windows
      join(homedir(), '.config', 'Claude', 'claude_desktop_config.json') // Linux
    ];

    let claudeConfigPath = configPaths.find(path => existsSync(dirname(path)));
    if (!claudeConfigPath) {
      claudeConfigPath = configPaths[0]; // Default to macOS path
    }

    console.log(`\n📝 Configuration to add to Claude Desktop:`);
    console.log(`   File: ${claudeConfigPath}`);
    console.log('\n' + JSON.stringify(config, null, 2));

    // Try to update Claude config automatically
    try {
      let existingConfig = {};
      
      if (existsSync(claudeConfigPath)) {
        const existingContent = await readFile(claudeConfigPath, 'utf8');
        existingConfig = JSON.parse(existingContent);
      }

      // Merge configurations
      const mergedConfig = {
        ...existingConfig,
        mcpServers: {
          ...existingConfig.mcpServers,
          ...config.mcpServers
        }
      };

      await writeFile(claudeConfigPath, JSON.stringify(mergedConfig, null, 2));
      console.log('\n✅ Claude Desktop configuration updated automatically!');
      
    } catch (error) {
      console.log('\n⚠️  Could not update Claude configuration automatically.');
      console.log('Please manually add the configuration above to your Claude Desktop config file.');
    }

    console.log('\n🎯 Next steps:');
    console.log('1. Restart Claude Desktop completely');
    console.log('2. Start MCP2OSC: npm start');
    console.log('3. Look for MCP2OSC tools in Claude interface');
    console.log('4. Test with: "Generate OSC patterns for music control"');

    // Generate a test configuration file
    const testConfigPath = join(__dirname, 'claude_config_example.json');
    await writeFile(testConfigPath, JSON.stringify(config, null, 2));
    console.log(`\n📄 Example configuration saved to: ${testConfigPath}`);

  } catch (error) {
    console.error('❌ Configuration generation failed:', error.message);
    console.log('\n💡 Manual configuration:');
    console.log('1. Find your Node.js path: which node');
    console.log('2. Use absolute path to mcp-server.js');
    console.log('3. Remove any "cwd" field from configuration');
    process.exit(1);
  }
}

generateConfig();