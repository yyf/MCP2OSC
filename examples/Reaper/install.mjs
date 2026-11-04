#!/usr/bin/env node
/**
 * Install MCP2OSC REAPER vocal-polish files into the REAPER resource path.
 *
 *   node install.mjs
 *   node install.mjs --dry-run
 *   REAPER_RESOURCE="/path/to/REAPER" node install.mjs
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dryRun = process.argv.includes('--dry-run');

function detectResourcePath() {
  if (process.env.REAPER_RESOURCE) return process.env.REAPER_RESOURCE;
  const home = os.homedir();
  const candidates =
    process.platform === 'darwin'
      ? [path.join(home, 'Library/Application Support/REAPER')]
      : process.platform === 'win32'
        ? [path.join(process.env.APPDATA || path.join(home, 'AppData/Roaming'), 'REAPER')]
        : [
            path.join(home, '.config/REAPER'),
            path.join(home, 'REAPER'),
          ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

function copyFile(src, dest) {
  if (dryRun) {
    console.log(`  would copy  ${path.relative(__dirname, src)}  →  ${dest}`);
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`  copied  ${path.basename(src)}  →  ${dest}`);
}

function copyDirFiles(srcDir, destDir, filter) {
  if (!fs.existsSync(srcDir)) return;
  for (const name of fs.readdirSync(srcDir)) {
    if (filter && !filter(name)) continue;
    copyFile(path.join(srcDir, name), path.join(destDir, name));
  }
}

const resource = detectResourcePath();
console.log(`REAPER resource path: ${resource}${dryRun ? ' (dry-run)' : ''}`);
if (!dryRun && !fs.existsSync(resource)) {
  fs.mkdirSync(resource, { recursive: true });
  console.log('(created — open REAPER once if OSC/Effects folders stay empty)');
}

copyDirFiles(
  path.join(__dirname, 'JSFX'),
  path.join(resource, 'Effects/MCP2OSC'),
  (n) => n.endsWith('.jsfx'),
);

copyDirFiles(
  path.join(__dirname, 'Scripts'),
  path.join(resource, 'Scripts/MCP2OSC'),
  (n) => n.endsWith('.lua'),
);

for (const osc of ['mcp2osc-vocal-polish.ReaperOSC', 'mcp2osc.ReaperOSC']) {
  const src = path.join(__dirname, osc);
  if (fs.existsSync(src)) {
    copyFile(src, path.join(resource, 'OSC', osc));
  }
}

console.log(`
Done. Next (see README):

  1. Preferences → Control/OSC/web → Add → OSC
     Pattern: MCP2OSC Vocal Polish · Local port: 8000
  2. Actions → Show action list → New action → Load ReaScript:
     ${path.join(resource, 'Scripts/MCP2OSC/mcp2osc_setup_vocal_chain.lua')}
  3. npm start
  4. Load a WAV on track 1 → run that action → paste Claude prompt from README
`);
