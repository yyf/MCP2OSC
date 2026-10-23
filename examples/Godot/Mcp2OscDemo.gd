extends Node
## MCP2OSC demo for Godot 4 + GodOSC (or compatible OSC server node)
## Listens on UDP 9500 for /mcp2osc/demo/{slider,button,preset}

@export var listen_port: int = 9500

var slider: float = 0.5
var button: int = 0
var preset: int = 1
var status: String = "waiting…"

const PRESETS := {
	1: {"slider": 0.25, "button": 0, "label": "soft"},
	2: {"slider": 0.5, "button": 1, "label": "mid"},
	3: {"slider": 1.0, "button": 1, "label": "full"},
}

## If using GodOSC: add OSCServer child named "OSCServer" and connect its signal,
## or call handle_osc(address, args) from that node's message callback.
func _ready() -> void:
	print("MCP2OSC Godot demo — wire OSCServer (port %d) to handle_osc()" % listen_port)


func handle_osc(address: String, args: Array) -> void:
	match address:
		"/mcp2osc/demo/slider":
			if args.size() > 0:
				slider = float(args[0])
				status = "slider → %.3f" % slider
				print("[slider] ", slider)
		"/mcp2osc/demo/button":
			if args.size() > 0:
				button = 1 if int(args[0]) != 0 else 0
				status = "button → %s" % ("ON" if button else "OFF")
				print("[button] ", button)
		"/mcp2osc/demo/preset":
			if args.size() > 0:
				preset = clampi(int(args[0]), 1, 3)
				var p: Dictionary = PRESETS[preset]
				slider = float(p["slider"])
				button = int(p["button"])
				status = "preset %d \"%s\" loaded" % [preset, p["label"]]
				print("[preset] ", preset, " ", p)


func _draw() -> void:
	## Attach to Node2D/Control with _draw, or replace with UI nodes.
	pass


func get_state() -> Dictionary:
	return {
		"slider": slider,
		"button": button,
		"preset": preset,
		"status": status,
	}
