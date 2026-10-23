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
| [SonicPi](SonicPi/) | Buffer demo (OSC in on **4560**) |
| [ChucK](ChucK/) | `OscIn` receiver (`mcp2osc_demo.ck`) |
| [Csound](Csound/) | `.csd` with `OSCinit` / `OSClisten` |
| [TidalCycles](TidalCycles/) | Bridge 9500 → Tidal `/ctrl` :6010 |
| [ThreeJS](ThreeJS/) | UDP→WS bridge + Three.js page |
| [TouchDesigner](TouchDesigner/) | Existing `.toe` + demo address map |
| [TouchOSC](TouchOSC/) | Layout spec (3 controls) |
| [OpenStageControl](OpenStageControl/) | Browser OSC session (`mcp2osc-demo.json`) |
| [QLab](QLab/) | OSC cue map for slider / button / preset |
| [Unreal](Unreal/) | Address map + Blueprint setup |
| [Unity](Unity/) | C# receiver (`OSC Jack`) |
| [Godot](Godot/) | GDScript + GodOSC address map |
| [openFrameworks](openFrameworks/) | Minimal `ofApp` receiver |
| [Processing](Processing/) | Minimal sketch |
| [ESP32](ESP32/) | CNMAT OSC sketch (ESP32 / Teensy notes) |
| [RaspberryPi](RaspberryPi/) | `python-osc` receiver (+ GPIO hook) |
| [Reaper](Reaper/) | `.ReaperOSC` surface map |
| [Ableton](Ableton/) | Max for Live / OSC notes |
| [Notch](Notch/) | OSC In setup |
| [MadMapper](MadMapper/) | OSC control notes |
| [VVVV](VVVV/) | gamma OSCServer / OSCReceiver kit |
| [shared](shared/) | Address map + Node smoke-test receiver |

**LAN note:** ESP32 and remote Pi need Claude `OSC_HOST` set to the device IP (not `127.0.0.1`).

**Sonic Pi note:** receive port is **4560** — set `OSC_SEND_PORT` to `4560` for that demo (other apps use `9500`).

**TidalCycles / Three.js:** run the folder’s bridge so Claude can keep using the shared `/mcp2osc/demo/*` map on **9500**.

## Quick smoke test (no creative app)

```bash
cd examples/shared
node osc-echo-receiver.js
```

Then in Claude: *"Send /mcp2osc/demo/slider 0.5"* and confirm the Node process prints the message.