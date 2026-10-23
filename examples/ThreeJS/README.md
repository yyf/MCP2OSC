# Three.js — MCP2OSC demo

Browsers cannot bind UDP, so a small Node bridge forwards OSC **9500** → WebSocket **8081**. The page drives a Three.js mesh from the shared demo addresses.

## Setup

```bash
cd examples/ThreeJS
npm install
npm run bridge
```

Open `index.html` in a browser (file:// works for this demo, or `npx serve .`).

Keep Claude Desktop on `OSC_SEND_PORT` **9500**.

## Addresses

| Address | Interaction |
|---------|-------------|
| `/mcp2osc/demo/slider` | float 0–1 → scale / hue / spin |
| `/mcp2osc/demo/button` | int 0 \| 1 → emissive on/off |
| `/mcp2osc/demo/preset` | int 1–3 → load preset |

Preset table: `1→(0.25,0)`, `2→(0.5,1)`, `3→(1.0,1)`.

## Claude prompts

- `"Set /mcp2osc/demo/slider to 0.7 float"`
- `"Toggle /mcp2osc/demo/button to 1"`
- `"Load preset 2 via /mcp2osc/demo/preset"`

## Ports

| Path | Port |
|------|------|
| MCP2OSC → bridge (UDP) | 9500 |
| Bridge → browser (WS) | 8081 |
