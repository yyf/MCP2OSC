# TidalCycles — MCP2OSC demo

Tidal’s native control OSC is `/ctrl` on port **6010**, not the shared `/mcp2osc/demo/*` paths. A small bridge keeps Claude on the shared map.

## Setup

1. Install [TidalCycles](https://tidalcycles.org/) + SuperDirt
2. Start SuperDirt / BootTidal as usual
3. In another terminal:

```bash
cd examples/TidalCycles
node mcp2osc_to_tidal_bridge.js
```

4. Evaluate `mcp2osc_demo.tidal` in your Tidal editor
5. Keep Claude on `OSC_SEND_PORT` **9500** (bridge listens there)

## Addresses (via bridge)

| MCP2OSC address | Tidal control | Pattern helper |
|-----------------|---------------|----------------|
| `/mcp2osc/demo/slider` | `/ctrl "slider"` | `cF 1 "slider"` |
| `/mcp2osc/demo/button` | `/ctrl "button"` | `cI` / `cF` `"button"` |
| `/mcp2osc/demo/preset` | `/ctrl "preset"` (+ slider/button) | `cI 0 "preset"` |

Preset table: `1→(0.25,0)`, `2→(0.5,1)`, `3→(1.0,1)`.

## Without the bridge

Set `OSC_SEND_PORT` to `6010` and send Tidal-native messages, e.g. `/ctrl` with string key + float/int value — see [Controller Input](https://tidalcycles.org/docs/configuration/MIDIOSC/osc/).

## Claude prompts

- `"Set /mcp2osc/demo/slider to 0.7 float"`
- `"Toggle /mcp2osc/demo/button to 1"`
- `"Load preset 2 via /mcp2osc/demo/preset"`
