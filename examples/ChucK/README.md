# ChucK — MCP2OSC demo

## Setup

1. Install [ChucK](https://chuck.stanford.edu/) (or `brew install chuck`)
2. From this folder:

```bash
chuck mcp2osc_demo.ck
```

3. Keep Claude Desktop on the shared ports (`OSC_SEND_PORT` **9500**)

## Addresses

| Address | Interaction |
|---------|-------------|
| `/mcp2osc/demo/slider` | float 0–1 → pitch / filter / amp scale |
| `/mcp2osc/demo/button` | int 0 \| 1 → voice on/off |
| `/mcp2osc/demo/preset` | int 1–3 → load preset |

Preset table: `1→(0.25,0)`, `2→(0.5,1)`, `3→(1.0,1)`.

Listens on **UDP 9500**.

## Claude prompts

- `"Set /mcp2osc/demo/slider to 0.7 float"`
- `"Toggle /mcp2osc/demo/button to 1"`
- `"Load preset 2 via /mcp2osc/demo/preset"`
