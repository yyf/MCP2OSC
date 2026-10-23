# TouchOSC — MCP2OSC demo

Create three controls in [TouchOSC](https://hexler.net/touchosc/) (Mk1 or Mk2) that send to MCP2OSC **or** receive from Claude via MCP2OSC.

## Connection

| Setting | Value |
|---------|-------|
| Host | `127.0.0.1` |
| Send port (TouchOSC → MCP2OSC) | `9501` |
| Receive port (MCP2OSC → TouchOSC) | `9500` |
| Protocol | UDP |

When using Claude → MCP2OSC → TouchOSC, MCP2OSC **sends to 9500** — set TouchOSC **Receive** to `9500`.

## Controls to build

| Control | Type | OSC address | Values |
|---------|------|-------------|--------|
| Slider / fader | Fader | `/mcp2osc/demo/slider` | float 0–1 |
| Button | Toggle / button | `/mcp2osc/demo/button` | int 0 \| 1 |
| Preset | Radio / buttons ×3 | `/mcp2osc/demo/preset` | int 1, 2, 3 |

### Preset tips

- Three buttons with fixed values `1`, `2`, `3` on the same address `/mcp2osc/demo/preset`, **or**
- One encoder that sends integers 1–3

See [`controls.json`](controls.json) for a machine-readable layout checklist.

## Claude prompts

- `"Set TouchOSC slider /mcp2osc/demo/slider to 0.8"`
- `"Turn demo button on"`
- `"Load demo preset 3"`
