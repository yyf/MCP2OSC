#!/usr/bin/env node
/**
 * Single process: param router (9500→REAPER:8000) + automation queue (9502).
 *
 *   node hub.js
 *   npm start   (from examples/Reaper)
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = path.dirname(fileURLToPath(import.meta.url));

function run(file) {
  const child = spawn(process.execPath, [path.join(dir, file)], {
    stdio: 'inherit',
  });
  child.on('exit', (code) => {
    console.error(`${file} exited (${code})`);
    process.exit(code ?? 1);
  });
  return child;
}

console.log('MCP2OSC REAPER hub — param router + automation bridge');
const a = run('param-router.js');
const b = run('automation-bridge.js');

function shutdown() {
  a.kill();
  b.kill();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
