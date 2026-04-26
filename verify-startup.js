#!/usr/bin/env node

/**
 * Post-install checks: required files and npm dependencies load correctly.
 */

import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const requiredFiles = [
  'mcp-server.js',
  'service-manager.js',
  'enhanced-dashboard-server.js',
  'extracted-osc-patterns.json',
  'package.json',
];

let failed = false;

function fail(msg) {
  console.error(`   ❌ ${msg}`);
  failed = true;
}

function ok(msg) {
  console.log(`   ✅ ${msg}`);
}

console.log('MCP2OSC verify-startup\n');

for (const f of requiredFiles) {
  const p = join(__dirname, f);
  if (!existsSync(p)) {
    fail(`Missing required file: ${f}`);
  } else {
    ok(`${f} present`);
  }
}

const minNode = 18;
const major = parseInt(process.versions.node.split('.')[0], 10);
if (Number.isFinite(major) && major >= minNode) {
  ok(`Node.js ${process.version} (>= ${minNode})`);
} else {
  fail(`Node.js ${process.version} — need >= ${minNode}`);
}

const imports = [
  ['@modelcontextprotocol/sdk', '@modelcontextprotocol/sdk/server/index.js'],
  ['express', 'express'],
  ['ws', 'ws'],
];

for (const [label, spec] of imports) {
  try {
    await import(spec);
    ok(`${label} loads`);
  } catch (e) {
    fail(`${label} failed to import: ${e.message}`);
  }
}

console.log('');
if (failed) {
  console.error('Verification failed. Run npm install in the project root and try again.\n');
  process.exit(1);
}

console.log('All checks passed.\n');
