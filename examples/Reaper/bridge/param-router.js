#!/usr/bin/env node
/**
 * MCP2OSC friendly addresses → REAPER OSC fxparam values
 *
 * Listens UDP 9500 (MCP2OSC default). Forwards to REAPER OSC on 8000.
 * Keep automation-bridge.js on 9502 for envelope edits.
 *
 *   node param-router.js
 *
 * REAPER: Control/OSC/web → OSC device, Local listen port **8000**,
 *         pattern config: mcp2osc-vocal-polish.ReaperOSC (or Default).
 */
import dgram from 'dgram';

const LISTEN = Number(process.env.OSC_LISTEN_PORT || 9500);
const REAPER_HOST = process.env.REAPER_OSC_HOST || '127.0.0.1';
const REAPER_PORT = Number(process.env.REAPER_OSC_PORT || 8000);

/** Friendly path → { track, fx, param } (1-based, matches JSFX slider order) */
const MAP = {
  '/mcp2osc/reaper/eq/hpf_freq': { track: 1, fx: 1, param: 1 },
  '/mcp2osc/reaper/eq/hpf_enable': { track: 1, fx: 1, param: 2 },
  '/mcp2osc/reaper/eq/low_gain': { track: 1, fx: 1, param: 3 },
  '/mcp2osc/reaper/eq/low_freq': { track: 1, fx: 1, param: 4 },
  '/mcp2osc/reaper/eq/mid_gain': { track: 1, fx: 1, param: 5 },
  '/mcp2osc/reaper/eq/mid_freq': { track: 1, fx: 1, param: 6 },
  '/mcp2osc/reaper/eq/mid_q': { track: 1, fx: 1, param: 7 },
  '/mcp2osc/reaper/eq/high_gain': { track: 1, fx: 1, param: 8 },
  '/mcp2osc/reaper/eq/output': { track: 1, fx: 1, param: 9 },
  '/mcp2osc/reaper/dyn/threshold': { track: 1, fx: 2, param: 1 },
  '/mcp2osc/reaper/dyn/ratio': { track: 1, fx: 2, param: 2 },
  '/mcp2osc/reaper/dyn/attack': { track: 1, fx: 2, param: 3 },
  '/mcp2osc/reaper/dyn/release': { track: 1, fx: 2, param: 4 },
  '/mcp2osc/reaper/dyn/knee': { track: 1, fx: 2, param: 5 },
  '/mcp2osc/reaper/dyn/makeup': { track: 1, fx: 2, param: 6 },
  '/mcp2osc/reaper/dyn/mix': { track: 1, fx: 2, param: 7 },
  '/mcp2osc/reaper/delay/time': { track: 1, fx: 3, param: 1 },
  '/mcp2osc/reaper/delay/feedback': { track: 1, fx: 3, param: 2 },
  '/mcp2osc/reaper/delay/mix': { track: 1, fx: 3, param: 3 },
  '/mcp2osc/reaper/delay/hp': { track: 1, fx: 3, param: 4 },
};

function pad4(n) {
  return n + ((4 - (n % 4)) % 4);
}

function writeString(buf, offset, str) {
  buf.write(str, offset);
  offset += str.length;
  buf.writeUInt8(0, offset++);
  while (offset % 4 !== 0) buf.writeUInt8(0, offset++);
  return offset;
}

function readCString(buf, offset) {
  let end = offset;
  while (end < buf.length && buf[end] !== 0) end++;
  return { str: buf.slice(offset, end).toString('utf8'), next: pad4(end + 1) };
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
    } else break;
  }
  return { address: addr.str, args };
}

function buildFloatMsg(address, value) {
  const size = pad4(address.length + 1) + pad4(2) + 4; // ",f"
  const buf = Buffer.alloc(size);
  let o = 0;
  o = writeString(buf, o, address);
  o = writeString(buf, o, ',f');
  buf.writeFloatBE(value, o);
  return buf.subarray(0, o + 4);
}

const out = dgram.createSocket('udp4');
const udp = dgram.createSocket('udp4');

function forward(address, value) {
  const msg = buildFloatMsg(address, value);
  out.send(msg, REAPER_PORT, REAPER_HOST);
  console.log(`→ ${address} ${value.toFixed(4)}`);
}

udp.on('message', (msg) => {
  const { address, args } = parseOsc(msg);
  if (!args.length) return;
  const v = Number(args[0]);

  if (address === '/mcp2osc/reaper/track/volume') {
    forward('/track/1/volume', v);
    return;
  }
  if (address === '/mcp2osc/reaper/track/volume/db') {
    // REAPER also accepts f/track/1/volume/db — send as float db pattern
    const m = buildFloatMsg('/track/1/volume/db', v);
    out.send(m, REAPER_PORT, REAPER_HOST);
    console.log(`→ /track/1/volume/db ${v}`);
    return;
  }

  const target = MAP[address];
  if (target) {
    const dest = `/track/${target.track}/fx/${target.fx}/fxparam/${target.param}/value`;
    forward(dest, Math.min(1, Math.max(0, v)));
    return;
  }

  // pass-through already-REAPER addresses
  if (address.startsWith('/track/')) {
    forward(address, v);
  } else {
    console.log('unmapped', address, args);
  }
});

udp.bind(LISTEN, () => {
  console.log('MCP2OSC → REAPER param router');
  console.log(`  listen UDP ${LISTEN}  →  ${REAPER_HOST}:${REAPER_PORT}`);
});
