"""
MCP2OSC demo — Blender Text Editor script

Receives: /mcp2osc/demo/slider (f) /button (i) /preset (i 1-3)
Listen: UDP 9500

Open in Blender → Scripting → Run Script.
Uses only the Python stdlib (no pip install).
"""

from __future__ import annotations

import socket
import struct
import threading
from typing import Any

import bpy

LISTEN_HOST = "0.0.0.0"
LISTEN_PORT = 9500
TIMER_INTERVAL = 0.05

PRESETS = {
    1: (0.25, 0),
    2: (0.5, 1),
    3: (1.0, 1),
}

state: dict[str, Any] = {"slider": 0.5, "button": 0, "preset": 1, "status": "waiting…"}
_pending: list[tuple[str, tuple[Any, ...]]] = []
_lock = threading.Lock()
_sock: socket.socket | None = None
_thread: threading.Thread | None = None
RUNNING = True


def _pad4(n: int) -> int:
    return (4 - (n % 4)) % 4


def _parse_osc(data: bytes) -> tuple[str, list[Any]] | None:
    """Minimal OSC packet parser for address + typetag + int/float/string args."""
    if len(data) < 4:
        return None
    try:
        end = data.index(b"\x00")
    except ValueError:
        return None
    address = data[:end].decode("utf-8", errors="replace")
    i = end + 1 + _pad4(end + 1)
    if i >= len(data) or data[i : i + 1] != b",":
        return address, []
    try:
        tag_end = data.index(b"\x00", i)
    except ValueError:
        return None
    tags = data[i + 1 : tag_end].decode("ascii", errors="replace")
    i = tag_end + 1 + _pad4(tag_end + 1)
    args: list[Any] = []
    for tag in tags:
        if tag == "i":
            if i + 4 > len(data):
                break
            args.append(struct.unpack(">i", data[i : i + 4])[0])
            i += 4
        elif tag == "f":
            if i + 4 > len(data):
                break
            args.append(struct.unpack(">f", data[i : i + 4])[0])
            i += 4
        elif tag == "s":
            try:
                s_end = data.index(b"\x00", i)
            except ValueError:
                break
            args.append(data[i:s_end].decode("utf-8", errors="replace"))
            i = s_end + 1 + _pad4(s_end + 1)
        elif tag == "T":
            args.append(True)
        elif tag == "F":
            args.append(False)
        else:
            break
    return address, args


def _apply_to_scene() -> None:
    obj = bpy.data.objects.get("Cube")
    if obj is None and bpy.context.object is not None:
        obj = bpy.context.object
    if obj is None:
        return

    t = float(state["slider"])
    scale = 0.25 + t * 1.75
    obj.scale = (scale, scale, scale)
    obj.hide_viewport = state["button"] == 0
    obj.hide_render = state["button"] == 0


def _handle(address: str, args: tuple[Any, ...]) -> None:
    if address == "/mcp2osc/demo/slider" and args:
        state["slider"] = float(args[0])
        state["status"] = f"slider → {state['slider']:.3f}"
    elif address == "/mcp2osc/demo/button" and args:
        state["button"] = 1 if int(args[0]) != 0 else 0
        state["status"] = f"button → {state['button']}"
    elif address == "/mcp2osc/demo/preset" and args:
        preset = max(1, min(3, int(args[0])))
        state["preset"] = preset
        state["slider"], state["button"] = PRESETS[preset]
        state["status"] = f"preset {preset} loaded"
    else:
        return
    _apply_to_scene()
    print(f"MCP2OSC · Blender: {state['status']}")


def _recv_loop() -> None:
    global _sock
    assert _sock is not None
    while RUNNING:
        try:
            data, _addr = _sock.recvfrom(65535)
        except OSError:
            break
        parsed = _parse_osc(data)
        if not parsed:
            continue
        address, args = parsed
        with _lock:
            _pending.append((address, tuple(args)))


def _timer() -> float | None:
    if not RUNNING:
        return None
    with _lock:
        batch = list(_pending)
        _pending.clear()
    for address, args in batch:
        _handle(address, args)
    return TIMER_INTERVAL


def start() -> None:
    global _sock, _thread, RUNNING
    stop()
    RUNNING = True
    _sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    _sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    _sock.bind((LISTEN_HOST, LISTEN_PORT))
    _sock.settimeout(0.5)
    _thread = threading.Thread(target=_recv_loop, daemon=True)
    _thread.start()
    if not bpy.app.timers.is_registered(_timer):
        bpy.app.timers.register(_timer, first_interval=TIMER_INTERVAL)
    _apply_to_scene()
    print(f"MCP2OSC · Blender demo — UDP {LISTEN_HOST}:{LISTEN_PORT}")
    print("waiting for /mcp2osc/demo/{slider,button,preset} …")


def stop() -> None:
    global _sock, _thread, RUNNING
    RUNNING = False
    if bpy.app.timers.is_registered(_timer):
        bpy.app.timers.unregister(_timer)
    if _sock is not None:
        try:
            _sock.close()
        except OSError:
            pass
        _sock = None
    _thread = None


start()
