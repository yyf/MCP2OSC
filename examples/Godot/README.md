# Godot — MCP2OSC demo

## Setup

1. Install [Godot](https://godotengine.org/) 4.x
2. Create a new project (or use this folder as the project root)
3. Enable / install **[GodOSC](https://github.com/Nervalys/GodOSC)** (or Asset Library: search “GodOSC”)
4. Attach `Mcp2OscDemo.gd` to a `Node` (or use the included scene notes below)
5. Run — listens on **UDP 9500**

## Addresses

| Address | Interaction |
|---------|-------------|
| `/mcp2osc/demo/slider` | float 0–1 |
| `/mcp2osc/demo/button` | int 0 \| 1 toggle |
| `/mcp2osc/demo/preset` | int 1–3 load preset |

## Scene checklist

1. Root `Node2D` or `Control`
2. Child `OSCServer` (GodOSC) — port `9500`
3. Script `Mcp2OscDemo.gd` on root; connect OSC message signal to `_on_osc_message` **or** poll in `_process` depending on GodOSC version
4. Optional `Label` / `ProgressBar` for UI feedback

If your GodOSC API differs slightly, keep the three addresses identical and adapt the receive callback — see comments in the script.

## Claude prompts

- `"Set /mcp2osc/demo/slider to 0.6"`
- `"Toggle /mcp2osc/demo/button to 1"`
- `"Load preset 3 via /mcp2osc/demo/preset"`
