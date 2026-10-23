# VVVV — MCP2OSC demo

Setup for **vvvv gamma** (VL.IO.OSC ships with the app). Same shared demo addresses as the rest of this repo.

## Setup (gamma)

1. Install [vvvv gamma](https://visualprogramming.net/)
2. New patch → add **OSCServer**
   - Local IP: `0.0.0.0` or `127.0.0.1`
   - Port: **9500**
   - Confirm traffic on **Data Preview**
3. Add three **OSCReceiver** nodes (or use **Learn** while Claude sends a test message):

| Address | Type | Wire to |
|---------|------|---------|
| `/mcp2osc/demo/slider` | Float32 | Transform scale / color / FX amount |
| `/mcp2osc/demo/button` | Integer32 | Switch / Enable / visibility |
| `/mcp2osc/demo/preset` | Integer32 | Select / Switch for states 1–3 |

4. Keep Claude Desktop on `OSC_SEND_PORT` **9500**

### Preset behavior

On preset receive, apply:

- `1` → slider `0.25`, button `0` (soft)
- `2` → slider `0.5`, button `1` (mid)
- `3` → slider `1.0`, button `1` (full)

Use a small **If** / **Select** / process node, or set Constant values from the preset int.

## vvvv beta (legacy)

Use girlpower **IO → Networking → OSC** examples: **UDP Server** / OSC decode on port **9500**, then route the three addresses above. Prefer gamma for new work.

## Files

- [`AddressMap.json`](AddressMap.json)

No `.vl` / `.v4p` binary is shipped; build from this kit inside vvvv.

## Claude prompts

- `"Set /mcp2osc/demo/slider to 0.7 float"`
- `"Toggle /mcp2osc/demo/button to 1"`
- `"Load preset 2 via /mcp2osc/demo/preset"`
