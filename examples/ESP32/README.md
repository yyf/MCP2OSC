# ESP32 / Teensy — MCP2OSC demo

Minimal UDP OSC receiver for microcontrollers: slider → PWM, button → LED, preset → pose.

## Setup (ESP32)

1. Install [Arduino IDE](https://www.arduino.cc/) or PlatformIO with **ESP32** board support
2. Install library **OSC** by CNMAT (Library Manager → search `OSC`)
3. Open `Mcp2OscDemo/Mcp2OscDemo.ino`
4. Set `WIFI_SSID` / `WIFI_PASS`, flash, open Serial Monitor @ 115200
5. Note the printed IP — set Claude Desktop `OSC_HOST` to that IP (MCP2OSC default `127.0.0.1` will not reach the board)

## Addresses

| Address | Interaction | Hardware |
|---------|-------------|---------|
| `/mcp2osc/demo/slider` | float 0–1 | PWM on `PIN_PWM` (default GPIO 25) |
| `/mcp2osc/demo/button` | int 0 \| 1 | LED on `PIN_LED` (default GPIO 2) |
| `/mcp2osc/demo/preset` | int 1–3 | Loads preset table below |

Preset table: `1→(0.25,0)`, `2→(0.5,1)`, `3→(1.0,1)`.

Listens on **UDP 9500**.

## Teensy

Same addresses and CNMAT **OSC** library. Replace WiFi with Ethernet (Teensy 4.1 + NativeEthernet / QNEthernet) or use a WiFi shield:

1. Swap `#include <WiFi.h>` / `WiFiUDP` for your Ethernet UDP class
2. Call `Udp.begin(9500)` after link is up
3. Keep the three `msg.dispatch(...)` handlers unchanged
4. Map `PIN_LED` / `PIN_PWM` to your board (e.g. Teensy LED pin 13)

USB-SLIP OSC is possible but not covered here — UDP keeps the same path as Max / TD / Pi.

## Claude config

```json
"env": {
  "OSC_HOST": "192.168.1.42",
  "OSC_SEND_PORT": "9500",
  "OSC_RECEIVE_PORT": "9501"
}
```

## Claude prompts

- `"Set /mcp2osc/demo/slider to 0.7 float"`
- `"Toggle /mcp2osc/demo/button to 1"`
- `"Load preset 2 via /mcp2osc/demo/preset"`

## Safety

This sketch drives GPIO only. For motors / robots, add enable gates, current limits, and never put the LLM on an ungated actuator path.
