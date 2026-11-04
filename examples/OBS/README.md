# OBS Studio — MCP2OSC demo

OBS has no built-in OSC I/O. Use a bridge that speaks OSC on one side and **obs-websocket** (bundled since OBS 28) on the other.

## Recommended path: OSC for OBS

1. Install [OBS Studio](https://obsproject.com/) 28+
2. Enable **WebSocket Server**: Tools → WebSocket Server Settings → Enable
3. Install / run **[OSC for OBS](https://github.com/jshea2/OSC-for-OBS)** (maps OSC → obs-websocket)
4. Point OSC for OBS **OSC IN** at `127.0.0.1:**9500**` (or keep its default `3333` and set Claude `OSC_SEND_PORT` to match)
5. Create three demo scenes / sources (names below), then send the shared demo addresses

## Address → OBS mapping

| OSC address | Type | Suggested OBS action |
|-------------|------|----------------------|
| `/mcp2osc/demo/slider` | float 0–1 | Source volume, e.g. `/Desktop_Audio/volume` **or** filter opacity — see bridge docs for exact path form |
| `/mcp2osc/demo/button` | int 0 \| 1 | Mute / unmute a source, or show / hide an item |
| `/mcp2osc/demo/preset` | int 1–3 | Switch scene index / recall Scene Soft, Mid, Full |

### Preset scenes (create in OBS)

| Preset | Scene name | Look |
|--------|------------|------|
| 1 | `Mcp2Osc_Soft` | low opacity / muted FX |
| 2 | `Mcp2Osc_Mid` | mid look |
| 3 | `Mcp2Osc_Full` | full look |

Map `/mcp2osc/demo/preset` → scene switch (OSC for OBS scene commands, or OBSC `/avatar/parameters/OBSSceneSwitchSelector` with index 0–2).

## Alternative bridges

- [OBSC](https://github.com/benaclejames/OBSC) — native OBS plugin (Windows), VRChat-style OSC addresses
- [ObSC](https://github.com/CarloCattano/ObSC) — Python + obs-websocket listener

Keep Claude sending the shared `/mcp2osc/demo/*` map on **9500**; translate inside the bridge if the tool expects different paths.

## Files

- [`AddressMap.json`](AddressMap.json)

## Claude prompts

- `"Set /mcp2osc/demo/slider to 0.4"`
- `"Toggle /mcp2osc/demo/button to 1"`
- `"Load preset 3 via /mcp2osc/demo/preset"`

Smoke-test UDP first with [`../shared/osc-echo-receiver.js`](../shared/osc-echo-receiver.js) if the bridge does not log incoming packets.
