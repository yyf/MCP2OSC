# MadMapper — MCP2OSC demo

## Setup

1. Open MadMapper → Preferences → **OSC**
2. Enable OSC input, port **9500**
3. For each parameter you want to drive: right‑click → **Ctrl** → **Learn OSC** (or assign address manually)

## Assign three controls

| MadMapper target | OSC address | Notes |
|------------------|-------------|-------|
| Surface / FX float (opacity, scale, …) | `/mcp2osc/demo/slider` | Continuous 0–1 |
| Bypass / visibility / boolean FX | `/mcp2osc/demo/button` | 0 / 1 |
| Quartet / preset recall | `/mcp2osc/demo/preset` | Send 1, 2, or 3 — map via “Osculator-style” or three separate learns if needed |

### Preset tip

MadMapper presets are often recalled by name or index. Either:

- Learn `/mcp2osc/demo/preset` to a **Preset** control if supported, or
- Use three filters / value routers so `1`→Preset A, `2`→B, `3`→C

See [`AddressMap.json`](AddressMap.json).