#!/usr/bin/env node
/**
 * Minimal UDP OSC echo for MCP2OSC demo addresses.
 * Listens on 9500 (MCP2OSC send port). Prints slider / button / preset.
 *
 *   node osc-echo-receiver.js
 */
import dgram from 'dgram';

const PORT = Number(process.env.OSC_LISTEN_PORT || 9500);
const PRESETS = {
  1: { slider: 0.25, button: 0, label: 'soft' },
  2: { slider: 0.5, button: 1, label: 'mid' },
  3: { slider: 1.0, button: 1, label: 'full' },
};

const state = { slider: 0.5, button: 0, preset: 1 };

function readCString(buf, offset) {
  let end = offset;
  while (end < buf.length && buf[end] !== 0) end++;
  const str = buf.slice(offset, end).toString('utf8');
  const padded = end + (4 - (end % 4));
  return { str, next: padded };
}

function parseOsc(buf) {
  if (buf.length < 4) return null;
  if (buf.slice(0, 8).toString() === '#bundle\0') {
    return { address: '#bundle', args: [] };
  }
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
    } else {
      break;
    }
  }
  return { address: addr.str, args };
}

function apply(msg) {
  if (!msg) return;
  const { address, args } = msg;
  if (address === '/mcp2osc/demo/slider') {
    state.slider = Number(args[0] ?? 0);
    console.log(`[slider] ${state.slider.toFixed(3)}`);
  } else if (address === '/mcp2osc/demo/button') {
    state.button = Number(args[0] ?? 0) ? 1 : 0;
    console.log(`[button] ${state.button ? 'ON' : 'OFF'}`);
  } else if (address === '/mcp2osc/demo/preset') {
    const id = Number(args[0] ?? 1);
    const preset = PRESETS[id];
    state.preset = id;
    if (preset) {
      state.slider = preset.slider;
      state.button = preset.button;
      console.log(`[preset] ${id} "${preset.label}" → slider=${preset.slider} button=${preset.button}`);
    } else {
      console.log(`[preset] unknown id ${id}`);
    }
  } else {
    console.log(`[other] ${address}`, args);
  }
}

const sock = dgram.createSocket('udp4');
sock.on('message', (msg) => apply(parseOsc(msg)));
sock.on('listening', () => {
  const a = sock.address();
  console.log(`MCP2OSC demo echo listening udp://${a.address}:${a.port}`);
  console.log('Expect: /mcp2osc/demo/slider | /button | /preset');
});
sock.bind(PORT);
