#!/usr/bin/env node
/**
 * MCP2OSC → REAPER automation queue bridge
 *
 * Listens on UDP 9502 for automation OSC and appends JSONL for the
 * Lua action "MCP2OSC: Apply automation queue".
 *
 * Live FX params stay on port 9500 (REAPER OSC device).
 * Automation uses port 9502 so Claude can set `port: 9502` on send_osc_message.
 *
 *   node automation-bridge.js
 *
 * Queue file (override with MCP2OSC_AUTO_QUEUE):
 *   macOS: ~/Library/Application Support/REAPER/mcp2osc_auto_queue.jsonl
 *   Win:   %APPDATA%/REAPER/mcp2osc_auto_queue.jsonl
 *   Linux: ~/.config/REAPER/mcp2osc_auto_queue.jsonl
 */
import dgram from 'dgram';
import fs from 'fs';
import os from 'os';
import path from 'path';

const PORT = Number(process.env.MCP2OSC_AUTO_PORT || 9502);

function defaultQueuePath() {
  if (process.env.MCP2OSC_AUTO_QUEUE) return process.env.MCP2OSC_AUTO_QUEUE;
  // Match reaper.GetResourcePath() .. "/mcp2osc_auto_queue.jsonl"
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library/Application Support/REAPER/mcp2osc_auto_queue.jsonl');
  }
  if (process.platform === 'win32') {
    const appdata = process.env.APPDATA || path.join(home, 'AppData/Roaming');
    return path.join(appdata, 'REAPER/mcp2osc_auto_queue.jsonl');
  }
  // Linux portable installs may differ — set MCP2OSC_AUTO_QUEUE if needed
  return path.join(home, '.config/REAPER/mcp2osc_auto_queue.jsonl');
}

const QUEUE = defaultQueuePath();

function pad4(n) {
  return n + ((4 - (n % 4)) % 4);
}

function readCString(buf, offset) {
  let end = offset;
  while (end < buf.length && buf[end] !== 0) end++;
  const str = buf.slice(offset, end).toString('utf8');
  return { str, next: pad4(end + 1) };
}

function parseOsc(buf) {
  let offset = 0;
  const addr = readCString(buf, offset);
  offset = addr.next;
  if (offset >= buf.length) return { address: addr.str, args: [] };
  const tags = readCString(buf, offset);
  offset = tags.next;
  const typeTags = tags.str.startsWith(',') ? tags.str.slice(1) : '';
  const args = [];
  for (const t of typeTags) {
    if (t === 'i') {
      args.push(buf.readInt32BE(offset));
      offset += 4;
    } else if (t === 'f') {
      args.push(buf.readFloatBE(offset));
      offset += 4;
    } else if (t === 's') {
      const s = readCString(buf, offset);
      args.push(s.str);
      offset = s.next;
    } else if (t === 'd') {
      args.push(buf.readDoubleBE(offset));
      offset += 8;
    } else break;
  }
  return { address: addr.str, args };
}

function append(entry) {
  fs.mkdirSync(path.dirname(QUEUE), { recursive: true });
  fs.appendFileSync(QUEUE, JSON.stringify(entry) + '\n', 'utf8');
  console.log('queued', entry);
}

function dbToApproxNorm(db) {
  // Rough REAPER-like fader curve helper for display; Lua prefers value_db when present
  const v = Math.pow(10, (db - 12) / 20);
  return Math.min(1, Math.max(0, v));
}

const udp = dgram.createSocket('udp4');

udp.on('message', (msg) => {
  const { address, args } = parseOsc(msg);
  const now = Date.now();

  if (address === '/mcp2osc/reaper/auto/volume') {
    const time = Number(args[0] ?? 0);
    const value = Number(args[1] ?? 0.7);
    append({ type: 'volume', track: 1, time, value, t: now });
  } else if (address === '/mcp2osc/reaper/auto/volume_db') {
    const time = Number(args[0] ?? 0);
    const value_db = Number(args[1] ?? 0);
    append({
      type: 'volume',
      track: 1,
      time,
      value_db,
      value: dbToApproxNorm(value_db),
      t: now,
    });
  } else if (address === '/mcp2osc/reaper/auto/fxparam') {
    append({
      type: 'fxparam',
      track: 1,
      fx: Number(args[0] ?? 1),
      param: Number(args[1] ?? 1),
      time: Number(args[2] ?? 0),
      value: Number(args[3] ?? 0.5),
      t: now,
    });
  } else if (address === '/mcp2osc/reaper/auto/clear') {
    const track = Number(args[0] ?? 1);
    // rewrite file keeping other tracks
    if (fs.existsSync(QUEUE)) {
      const keep = fs
        .readFileSync(QUEUE, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .filter((e) => e.track !== track && e.type !== 'apply');
      fs.writeFileSync(QUEUE, keep.map((e) => JSON.stringify(e)).join('\n') + (keep.length ? '\n' : ''));
    }
    console.log('cleared queue for track', track);
  } else if (address === '/mcp2osc/reaper/auto/apply') {
    append({ type: 'apply', t: now });
    console.log('apply flagged — run REAPER action: MCP2OSC: Apply automation queue');
  } else {
    console.log('ignored', address, args);
  }
});

udp.bind(PORT, () => {
  console.log('MCP2OSC REAPER automation bridge');
  console.log(`  UDP ${PORT}`);
  console.log(`  queue → ${QUEUE}`);
});
