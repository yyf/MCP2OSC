# Notch — MCP2OSC demo

## Setup

1. Open Notch Builder
2. Add **OSC In** node (or project OSC settings)
3. Listen on port **9500**
4. Create three exposed properties / modifiers:

| Property | OSC address | Type |
|----------|-------------|------|
| Slider | `/mcp2osc/demo/slider` | float 0–1 → e.g. opacity / transform |
| Button | `/mcp2osc/demo/button` | int → enable Effect / Layer |
| Preset | `/mcp2osc/demo/preset` | int 1–3 → switch Null/Modifier states |

## Preset behavior

Use a **Numeric Value** or **Javascript** / logic nodes:

- `1` → soft look (slider 0.25, FX off)
- `2` → mid (0.5, FX on)
- `3` → full (1.0, FX on)

## Files

- [`AddressMap.json`](AddressMap.json)

No `.dfxd` binary is shipped; follow this kit inside Notch Builder.