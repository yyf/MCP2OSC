# Sonic Pi — MCP2OSC demo

## Setup

1. Install [Sonic Pi](https://sonic-pi.net/)
2. Open `mcp2osc_demo.rb`, paste into a buffer, Run
3. Point MCP2OSC at Sonic Pi’s OSC-in port (**4560**, not 9500):

```json
"env": {
  "OSC_HOST": "127.0.0.1",
  "OSC_SEND_PORT": "4560",
  "OSC_RECEIVE_PORT": "9501"
}
```

Restart Claude Desktop after changing the config. Other examples in this repo expect `9500`; switch back when you leave Sonic Pi.

## Addresses

Sonic Pi prefixes incoming OSC with `/osc…`. Sync with a wildcard:

| Send (MCP2OSC) | Sync in Sonic Pi |
|----------------|------------------|
| `/mcp2osc/demo/slider` | `/osc*/mcp2osc/demo/slider` |
| `/mcp2osc/demo/button` | `/osc*/mcp2osc/demo/button` |
| `/mcp2osc/demo/preset` | `/osc*/mcp2osc/demo/preset` |

| Address | Interaction |
|---------|-------------|
| `/mcp2osc/demo/slider` | float 0–1 → note / cutoff |
| `/mcp2osc/demo/button` | int 0 \| 1 → voice on/off |
| `/mcp2osc/demo/preset` | int 1–3 → load preset |

Preset table: `1→(0.25,0)`, `2→(0.5,1)`, `3→(1.0,1)`.

## Claude prompts

- `"Set /mcp2osc/demo/slider to 0.7 float"`
- `"Toggle /mcp2osc/demo/button to 1"`
- `"Load preset 2 via /mcp2osc/demo/preset"`

## Notes

- Cue log shows paths like `/osc:127.0.0.1:xxxxx/mcp2osc/demo/slider`
- Remote machines: Preferences → IO → allow OSC from other computers; set `OSC_HOST` to this machine’s IP
- `use_osc` only sets where Sonic Pi *sends*; it does not change the receive port (fixed **4560**)
