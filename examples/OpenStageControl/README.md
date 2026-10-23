# Open Stage Control — MCP2OSC demo

[Open Stage Control](https://openstagecontrol.ammd.net/) is a browser-based OSC/MIDI control surface (open source).

## Setup

1. Install Open Stage Control (app or `npm` / binary from the project site)
2. Launch with a session that loads [`mcp2osc-demo.json`](mcp2osc-demo.json)  
   Example:
   ```bash
   open-stage-control --load /ABSOLUTE/PATH/TO/MCP2OSC/examples/OpenStageControl/mcp2osc-demo.json
   ```
   Or: File → Open session → select `mcp2osc-demo.json`
3. Set OSC target host/port so widgets **send to MCP2OSC receive** and/or **receive from MCP2OSC send**:

| Role | Host | Port |
|------|------|------|
| Widgets → MCP2OSC | `127.0.0.1` | **9501** (MCP2OSC `OSC_RECEIVE_PORT`) |
| MCP2OSC → widgets | Open Stage Control listen | **9500** (MCP2OSC `OSC_SEND_PORT`) |

For Claude → MCP2OSC → Open Stage Control (UI mirrors server state), set each widget’s **osc** target to receive on **9500** (or use OSC In / `preArgs` per [OSC docs](https://openstagecontrol.ammd.net/docs/)).

## Widgets in this session

| Widget | Address | Interaction |
|--------|---------|-------------|
| Fader | `/mcp2osc/demo/slider` | float 0–1 |
| Toggle | `/mcp2osc/demo/button` | 0 \| 1 |
| Buttons ×3 | `/mcp2osc/demo/preset` | 1, 2, 3 |

## Claude prompts

- `"Set /mcp2osc/demo/slider to 0.75"`
- `"Turn demo button on"`
- `"Load demo preset 2"`

## Note

If the JSON session format differs slightly across Open Stage Control versions, recreate three widgets with the same addresses — the shared map in [`../shared/osc-map.json`](../shared/osc-map.json) is the source of truth.