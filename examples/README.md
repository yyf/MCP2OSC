# MCP2OSC Examples

Minimal receivers / controllers that speak a **shared demo address map** with MCP2OSC.

## Ports (match Claude Desktop env)

| Direction | Host | Port |
|-----------|------|------|
| MCP2OSC → app (send) | `127.0.0.1` | **9500** |
| App → MCP2OSC (reply) | `127.0.0.1` | **9501** |

## Shared demo addresses

See [`shared/osc-map.json`](shared/osc-map.json).

| Address | Type | Range | Interaction |
|---------|------|-------|-------------|
| `/mcp2osc/demo/slider` | float | 0–1 | Knob / slider |
| `/mcp2osc/demo/button` | int | 0 \| 1 | Toggle |
| `/mcp2osc/demo/preset` | int | 1–3 | Load preset |

### Example Claude prompts

- `"Set /mcp2osc/demo/slider to 0.7 float"`
- `"Toggle /mcp2osc/demo/button to 1"`
- `"Load preset 2 via /mcp2osc/demo/preset"`
- `"Send a batch: slider 0.2, button 1, preset 1"`

## Applications

| Folder | Status |
|--------|--------|
| [MaxMSP](MaxMSP/) | Existing patch + demo README |
| [PureData](PureData/) | Existing patch + demo README |
| [SuperCollider](SuperCollider/) | Existing script + demo README |
| [TouchDesigner](TouchDesigner/) | Existing `.toe` + demo README |
| [TouchOSC](TouchOSC/) | Layout spec (3 controls) |
| [OpenStageControl](OpenStageControl/) | Browser OSC session (`mcp2osc-demo.json`) |
| [QLab](QLab/) | OSC cue map for slider / button / preset |
| [Unreal](Unreal/) | Address map + Blueprint setup |
| [Unity](Unity/) | C# receiver (`OSC Jack`) |
| [Godot](Godot/) | GDScript + GodOSC address map |
| [openFrameworks](openFrameworks/) | Minimal `ofApp` receiver |
| [Processing](Processing/) | Minimal sketch |
| [Reaper](Reaper/) | `.ReaperOSC` surface map |
| [Ableton](Ableton/) | Max for Live / OSC notes |
| [Notch](Notch/) | OSC In setup |
| [MadMapper](MadMapper/) | OSC control notes |
| [shared](shared/) | Address map + Node smoke-test receiver |

## Quick smoke test (no creative app)

```bash
cd examples/shared
node osc-echo-receiver.js
```

Then in Claude: *"Send /mcp2osc/demo/slider 0.5"* and confirm the Node process prints the message.