# Ableton Live — MCP2OSC demo

Ableton has no first-class OSC I/O in Live alone. Use **Max for Live** or a bridge.

## Recommended path: Max for Live

1. Ableton Live Suite (or Standard + Max for Live)
2. Create a Max for Live device that:
   - `udpreceive 9500` → `OSC-route` / `route`
   - Routes `/mcp2osc/demo/slider` → live.dial / dial (0–1)
   - Routes `/mcp2osc/demo/button` → live.toggle
   - Routes `/mcp2osc/demo/preset` → `select` → three `live.remote~` or message packs that set dial+toggle

## Minimal Max-for-Live routing (paste into M4L)

```
udpreceive 9500
|
OSC-route /mcp2osc/demo/slider /mcp2osc/demo/button /mcp2osc/demo/preset
|                |                    |
unpack f         unpack i             unpack i
|                |                    |
live.dial        live.toggle          sel 1 2 3
                                      | | |
                                   (load preset packs)
```

Preset packs (example):

| Preset | Dial | Toggle |
|--------|------|--------|
| 1 | 0.25 | 0 |
| 2 | 0.5 | 1 |
| 3 | 1.0 | 1 |

## Alternative

- Use [`../shared/osc-echo-receiver.js`](../shared/osc-echo-receiver.js) to verify Claude→UDP
- Drive Ableton via **MIDI** from another OSC→MIDI bridge if needed

See [`device-map.json`](device-map.json).