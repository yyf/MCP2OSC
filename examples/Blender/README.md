# Blender — MCP2OSC demo

## Setup (script, no add-on)

1. Install [Blender](https://www.blender.org/) 4.2+
2. Open a new file → switch to **Scripting** workspace
3. Open `mcp2osc_demo.py` → **Run Script**
4. Check the System Console / Info for `listening on UDP …:9500`

The script uses only the Python stdlib (no `python-osc` install). It drives:

| Address | Interaction |
|---------|-------------|
| `/mcp2osc/demo/slider` | Default cube scale (uniform 0.25–2.0 from 0–1) |
| `/mcp2osc/demo/button` | Default cube visible when ON |
| `/mcp2osc/demo/preset` | Load preset 1–3 (sets slider + button) |

Listens on **UDP 9500**. Stop with **Alt+P** in the Text Editor or re-run after editing `RUNNING = False`.

## Alternative: OSC add-ons

If you prefer a UI mapper instead of the script:

- [NodeOSC](https://github.com/maybites/Blender.NodeOSC) — map addresses to data paths
- [OSC Controller for Blender](https://superhivemarket.com/products/osc-controller) — shape keys / bones / properties

Keep the three `/mcp2osc/demo/*` addresses identical and set the listen port to **9500**.

## Files

- [`mcp2osc_demo.py`](mcp2osc_demo.py) — Text Editor receiver
- [`AddressMap.json`](AddressMap.json)

## Claude prompts

- `"Set /mcp2osc/demo/slider to 0.7"`
- `"Toggle /mcp2osc/demo/button to 1"`
- `"Load preset 2 via /mcp2osc/demo/preset"`
