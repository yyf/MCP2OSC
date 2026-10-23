# QLab — MCP2OSC demo

[QLab](https://qlab.app/) is primarily controlled **by** OSC. Map the shared demo interactions onto cue actions.

## Connection

MCP2OSC → QLab: host `127.0.0.1`, port **53000** (QLab default) **or** set QLab’s OSC receive port to **9500** for a drop-in demo.

For a pure MCP2OSC-default demo, in QLab → Settings → Network:

- Listen for OSC on **9500**

## Map demo interactions → cues

Create three cues (or a cart) and note their cue numbers:

| Demo interaction | Address | Suggested QLab action |
|------------------|---------|------------------------|
| Slider | `/mcp2osc/demo/slider` | Network/Script cue that sets a level, **or** use native `/cue/{n}/volumeLevel {db}` from Claude with few-shot |
| Button toggle | `/mcp2osc/demo/button` | Cue that starts/stops; or map `1`→`/go`, `0`→`/panic` via a Script cue / companion |
| Preset 1–3 | `/mcp2osc/demo/preset` | Load / go cue list positions 1–3 |

### Minimal native QLab prompts (no custom map)

If you keep QLab’s default dictionary, ask Claude (few-shot):

- Button-like: `"Send OSC /go to QLab at 127.0.0.1:53000"`
- Preset-like: `"Send /cue/2/start"` / `"/cue/3/start"`
- Slider-like: `"Send /cue/1/volumeLevel -6.0"`

### Workspace checklist

1. New workspace with cues **1**, **2**, **3** (audio or memo cues)
2. Enable OSC inbound
3. Test with shared Node echo first, then point MCP2OSC `OSC_SEND_PORT` at QLab

See [`cue-map.json`](cue-map.json).