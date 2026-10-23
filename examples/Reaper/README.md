# REAPER — MCP2OSC demo

## Option A — Control surface pattern file

1. Copy [`mcp2osc.ReaperOSC`](mcp2osc.ReaperOSC) into REAPER’s OSC directory  
   (Preferences → Control/OSC/web → open resource path, or `REAPER/OSC/`)
2. Preferences → Control/OSC/web → Add → **OSC** → Device: `mcp2osc`
3. Mode: **Local port 9500** (listen for MCP2OSC send)

## Option B — JS / Action map

Map the three addresses manually in Preferences → Control/OSC/web:

| Pattern | Action |
|---------|--------|
| `n/mcp2osc/demo/slider` | Track 1 volume (normalized) — or any continuous FX param |
| `b/mcp2osc/demo/button` | Toggle mute / bypass |
| `i/mcp2osc/demo/preset` | Switch to region/marker 1–3 or recall track preset |

Exact REAPER pattern syntax depends on device file; see the included `.ReaperOSC` comments.

## Claude prompts

- `"Set /mcp2osc/demo/slider to 0.4"`
- `"Set /mcp2osc/demo/button to 1"`
- `"Load preset 1 via /mcp2osc/demo/preset"`
