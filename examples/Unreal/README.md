# Unreal Engine — MCP2OSC demo

## Setup (UE5)

1. Enable **OSC** plugin: Edit → Plugins → search “OSC” → enable → restart
2. Create a Blueprint Actor `BP_Mcp2OscDemo`
3. Add component **OSC Server** (or use `OSC Server` object in Level Blueprint)
4. Set **Receive IP** `0.0.0.0`, **Port** `9500`
5. Bind **On Osc Message Received** (or address-specific binds)

## Wire three handlers

| OSC address | Blueprint action |
|-------------|------------------|
| `/mcp2osc/demo/slider` | Set float variable `Slider` (0–1); drive Material Parameter / Light intensity |
| `/mcp2osc/demo/button` | Set bool `Button`; toggle a Light or Visibility |
| `/mcp2osc/demo/preset` | Switch on int 1–3; apply `PresetSoft` / `PresetMid` / `PresetFull` (set Slider + Button) |

Preset values (match shared map):

| Preset | Slider | Button |
|--------|--------|--------|
| 1 | 0.25 | 0 |
| 2 | 0.5 | 1 |
| 3 | 1.0 | 1 |

## Files

- [`AddressMap.json`](AddressMap.json) — copy into project `Content/` for documentation
- No `.uproject` binary is shipped; this folder is a setup kit

## Claude prompts

- `"Send /mcp2osc/demo/slider 0.6 to Unreal on 9500"`
- `"Toggle demo button on"`
- `"Load demo preset 2"`
