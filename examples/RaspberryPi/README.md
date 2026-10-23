# Raspberry Pi — MCP2OSC demo

Python UDP OSC receiver for a Pi (or any Linux host): prints slider / button / preset; optional GPIO hook in the script.

## Setup

1. Raspberry Pi OS (or any Python 3.9+)
2. Install deps:

```bash
cd examples/RaspberryPi
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

3. Run:

```bash
python3 mcp2osc_demo.py
# optional: python3 mcp2osc_demo.py --port 9500 --host 0.0.0.0
```

4. If MCP2OSC runs on another machine, set Claude Desktop `OSC_HOST` to the Pi’s LAN IP. If both run on the Pi, `127.0.0.1` is fine.

## Addresses

| Address | Interaction |
|---------|-------------|
| `/mcp2osc/demo/slider` | float 0–1 |
| `/mcp2osc/demo/button` | int 0 \| 1 toggle |
| `/mcp2osc/demo/preset` | int 1–3 load preset |

Preset table: `1→(0.25,0)`, `2→(0.5,1)`, `3→(1.0,1)`.

Listens on **UDP 9500**.

## GPIO / robots

`apply_outputs()` in `mcp2osc_demo.py` is the extension point — wire `gpiozero`, serial to an MCU, or a ROS 2 publisher. Keep enable / e-stop outside the LLM path.

## Claude prompts

- `"Set /mcp2osc/demo/slider to 0.6"`
- `"Toggle /mcp2osc/demo/button to 1"`
- `"Load preset 3 via /mcp2osc/demo/preset"`
