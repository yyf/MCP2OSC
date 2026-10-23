# TouchDesigner — MCP2OSC

## Existing

- `OSCtest.toe` / `OSCtest.9.toe` — original test networks
- `Backup/` — intermediate saves

## Shared demo map

1. Add **OSC In** CHOP (or DAT), port **9500**
2. Scope / select channels, or use OSC In DAT + Script:

| Address | Wire to |
|---------|---------|
| `/mcp2osc/demo/slider` | Constant / Math → Level / Color |
| `/mcp2osc/demo/button` | Switch / visibility |
| `/mcp2osc/demo/preset` | Select CHOPs for presets 1–3 |

Preset table: `1→(0.25,0)`, `2→(0.5,1)`, `3→(1.0,1)`.