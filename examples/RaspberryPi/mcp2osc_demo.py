#!/usr/bin/env python3
"""
MCP2OSC demo — Raspberry Pi (python-osc)

Receives: /mcp2osc/demo/slider (f) /button (i) /preset (i 1-3)
Listen: UDP 9500

  pip install -r requirements.txt
  python3 mcp2osc_demo.py

Point Claude Desktop OSC_HOST at this Pi's LAN IP when MCP2OSC
runs on another machine (use 127.0.0.1 only if both are on the Pi).
"""

from __future__ import annotations

import argparse
import threading
from typing import Any

from pythonosc import dispatcher, osc_server

PRESETS = {
    1: (0.25, 0),
    2: (0.5, 1),
    3: (1.0, 1),
}

state = {"slider": 0.5, "button": 0, "preset": 1}


def apply_outputs() -> None:
    """Hook for GPIO / serial / ROS — default is print-only."""
    print(
        f"  → slider={state['slider']:.3f}  "
        f"button={'ON' if state['button'] else 'OFF'}  "
        f"preset={state['preset']}",
        flush=True,
    )
    # Optional GPIO (uncomment on a real Pi with RPi.GPIO or gpiozero):
    # from gpiozero import LED, PWMLED
    # led.value = state["button"]
    # pwm.value = state["slider"]


def on_slider(address: str, *args: Any) -> None:
    if not args:
        return
    state["slider"] = float(args[0])
    print(f"{address} → {state['slider']:.3f}")
    apply_outputs()


def on_button(address: str, *args: Any) -> None:
    if not args:
        return
    state["button"] = 1 if int(args[0]) != 0 else 0
    print(f"{address} → {state['button']}")
    apply_outputs()


def on_preset(address: str, *args: Any) -> None:
    if not args:
        return
    preset = max(1, min(3, int(args[0])))
    state["preset"] = preset
    state["slider"], state["button"] = PRESETS[preset]
    print(f"{address} → preset {preset} loaded")
    apply_outputs()


def main() -> None:
    parser = argparse.ArgumentParser(description="MCP2OSC Raspberry Pi OSC demo")
    parser.add_argument("--host", default="0.0.0.0", help="bind address")
    parser.add_argument("--port", type=int, default=9500, help="UDP listen port")
    args = parser.parse_args()

    disp = dispatcher.Dispatcher()
    disp.map("/mcp2osc/demo/slider", on_slider)
    disp.map("/mcp2osc/demo/button", on_button)
    disp.map("/mcp2osc/demo/preset", on_preset)

    server = osc_server.ThreadingOSCUDPServer((args.host, args.port), disp)
    print(f"MCP2OSC · Raspberry Pi demo — UDP {args.host}:{args.port}")
    print("waiting for /mcp2osc/demo/{{slider,button,preset}} …")
    apply_outputs()

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        thread.join()
    except KeyboardInterrupt:
        print("\nbye")
        server.shutdown()


if __name__ == "__main__":
    main()
