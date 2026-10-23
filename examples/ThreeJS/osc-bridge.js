#!/usr/bin/env node
/**
 * UDP OSC (9500) → WebSocket bridge for the browser Three.js demo.
 *
 *   npm install
 *   npm run bridge
 *   open index.html  (or: npx serve .)
 */
import OSC from 'osc-js';

const UDP_PORT = Number(process.env.OSC_LISTEN_PORT || 9500);
const WS_PORT = Number(process.env.WS_PORT || 8081);

const osc = new OSC({
  plugin: new OSC.BridgePlugin({
    udpServer: { host: '0.0.0.0', port: UDP_PORT },
    udpClient: { host: '127.0.0.1', port: 9501 },
    wsServer: { host: '0.0.0.0', port: WS_PORT },
  }),
});

osc.on('open', () => {
  console.log(`MCP2OSC · Three.js OSC bridge`);
  console.log(`  UDP  ${UDP_PORT}  →  ws://127.0.0.1:${WS_PORT}`);
});

osc.on('error', (err) => {
  console.error('bridge error:', err);
});

osc.open();
