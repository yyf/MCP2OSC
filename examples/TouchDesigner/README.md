# TouchDesigner — MCP2OSC demo

## Existing networks

- `OSCtest.toe` / `OSCtest.9.toe` — original test networks
- `Backup/` — intermediate saves
- `AddressMap.json` — shared demo addresses for a fresh build

## Shared demo map (build from scratch)

1. Add **OSC In** CHOP — Active on, Protocol UDP, Port **9500**
2. Optional: **OSC In** DAT for message logging
3. Wire channels / parse addresses:

| Address | Wire to |
|---------|---------|
| `/mcp2osc/demo/slider` | Math / Level / Color (float 0–1) |
| `/mcp2osc/demo/button` | Switch / visibility / bypass (0 \| 1) |
| `/mcp2osc/demo/preset` | Select CHOPs or Script DAT for presets 1–3 |

### OSC In CHOP tips

- Leave **Address Scope** empty to receive all, or scope `/mcp2osc/demo/*`
- Channel names often become path-like; use **Select** / **Rename** CHOP to map to `slider`, `button`, `preset`
- For presets, a **Script CHOP** or **DAT Execute** can apply:

Preset table: `1→(0.25,0)`, `2→(0.5,1)`, `3→(1.0,1)`.

### Minimal Script DAT (optional)

On OSC In DAT callback / DAT Execute when `preset` changes:

```python
presets = {1: (0.25, 0), 2: (0.5, 1), 3: (1.0, 1)}
# read preset int → write slider/button constants or CHOP values
```

## Claude prompts

- `"Set /mcp2osc/demo/slider to 0.7 float"`
- `"Toggle /mcp2osc/demo/button to 1"`
- `"Load preset 2 via /mcp2osc/demo/preset"`

Listens on **UDP 9500** (`OSC_HOST` `127.0.0.1` when TD and Claude are on the same machine).
