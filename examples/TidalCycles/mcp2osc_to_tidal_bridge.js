#!/usr/bin/env node
/**
 * MCP2OSC → TidalCycles control bridge
 *
 * Listens for shared demo addresses on UDP 9500 and forwards
 * Tidal's native /ctrl messages to 127.0.0.1:6010.
 *
 *   node mcp2osc_to_tidal_bridge.js
 *
 * Then in Tidal: evaluate mcp2osc_demo.tidal (needs SuperDirt + BootTidal).
 */
import dgram from 'dgram';

const LISTEN = Number(process.env.OSC_LISTEN_PORT || 9500);
const TIDAL_HOST = process.env.TIDAL_HOST || '127.0.0.1';
const TIDAL_PORT = Number(process.env.TIDAL_CTRL_PORT || 6010);

const PRESETS = {
  1: { slider: 0.25, button: 0 },
  2: { slider: 0.5, button: 1 },
  3: { slider: 1.0, button: 1 },
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

/** Build OSC message: address + typetag + args (string|number). */
function buildOsc(address, types, args) {
  let size = pad4(address.length + 1) + pad4(types.length + 2);
  for (let i = 0; i < args.length; i++) {
    const t = types[i];
    if (t === 's') size += pad4(String(args[i]).length + 1);
    else size += 4;
  }
  const buf = Buffer.alloc(size);
  let o = 0;
  o = writeString(buf, o, address);
  o = writeString(buf, o, `,${types}`);
  for (let i = 0; i < args.length; i++) {
    const t = types[i];
    if (t === 's') o = writeString(buf, o, String(args[i]));
    else if (t === 'f') {
      buf.writeFloatBE(Number(args[i]), o);
      o += 4;
    } else if (t === 'i') {
      buf.writeInt32BE(Number(args[i]) | 0, o);
      o += 4;
    }
  }
  return buf.subarray(0, o);
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
    } else break;
  }
  return { address: addr.str, args };
}

const udp = dgram.createSocket('udp4');
const out = dgram.createSocket('udp4');

function sendCtrl(key, value, asFloat = true) {
  const types = asFloat ? 'sf' : 'si';
  const msg = buildOsc('/ctrl', types, [key, value]);
  out.send(msg, TIDAL_PORT, TIDAL_HOST);
  console.log(`/ctrl ${key} = ${value}`);
}

udp.on('message', (msg) => {
  const parsed = parseOsc(msg);
  if (!parsed) return;
  const { address, args } = parsed;
  if (!args.length) return;

  if (address === '/mcp2osc/demo/slider') {
    sendCtrl('slider', Number(args[0]), true);
  } else if (address === '/mcp2osc/demo/button') {
    sendCtrl('button', Number(args[0]) !== 0 ? 1 : 0, false);
  } else if (address === '/mcp2osc/demo/preset') {
    const n = Math.max(1, Math.min(3, Number(args[0]) | 0));
    sendCtrl('preset', n, false);
    const p = PRESETS[n];
    sendCtrl('slider', p.slider, true);
    sendCtrl('button', p.button, false);
  }
});

udp.bind(LISTEN, () => {
  console.log(`MCP2OSC → Tidal bridge`);
  console.log(`  listen UDP ${LISTEN}  →  ${TIDAL_HOST}:${TIDAL_PORT} /ctrl`);
});
