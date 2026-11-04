# Nuendo — MCP2OSC demo

Nuendo’s built-in OSC path is aimed at **object-based / ADM** productions (external renderer + position tracking), not a generic mixer control surface. This kit maps the shared MCP2OSC demo addresses onto that workflow.

## Setup (Nuendo 13+)

1. Open Nuendo → **ADM Authoring**
2. Set renderer to **OSC (external)**
3. Open **External OSC Renderer Setup** — set host `127.0.0.1` and the renderer listen port your external engine uses
4. Map object buses / object IDs for the demo (at least one object)
5. Optionally open **OSC Object Position Tracking** if you will drive XYZ from OSC

MCP2OSC still sends on **9500** by default. Either:

- Point Nuendo / your external renderer at **9500**, or
- Run a tiny rewrite bridge so Claude keeps `OSC_SEND_PORT=9500` while Nuendo listens on its ADM-OSC port

## Shared demo → ADM-OSC mapping

| OSC address | Type | Suggested Nuendo / renderer use |
|-------------|------|----------------------------------|
| `/mcp2osc/demo/slider` | float 0–1 | Object size / gain / distance scale (or one axis of position) |
| `/mcp2osc/demo/button` | int 0 \| 1 | Object enable / mute / bypass in the external renderer |
| `/mcp2osc/demo/preset` | int 1–3 | Recall three object layouts (soft / mid / full) |

### Preset layouts (match shared map)

| Preset | Slider | Button | Layout idea |
|--------|--------|--------|-------------|
| 1 | 0.25 | 0 | Soft — near-center, object muted/off |
| 2 | 0.5 | 1 | Mid — moderate spread, object on |
| 3 | 1.0 | 1 | Full — wide / loud, object on |

Exact ADM-OSC address strings depend on your external renderer (IA / Spat / custom). Keep the **MCP2OSC side** on `/mcp2osc/demo/*` and translate in the renderer or a 1:1 OSC rewrite.

## Files

- [`AddressMap.json`](AddressMap.json) — documentation + suggested rewrite targets

No `.npr` project binary is shipped; follow this kit inside Nuendo.

## Claude prompts

- `"Send /mcp2osc/demo/slider 0.6 float"`
- `"Toggle /mcp2osc/demo/button to 1"`
- `"Load preset 2 via /mcp2osc/demo/preset"`

Verify packets with [`../shared/osc-echo-receiver.js`](../shared/osc-echo-receiver.js) before wiring the external renderer.
