# Processing — MCP2OSC demo

## Setup

1. Install [Processing](https://processing.org/) 4.x
2. Install library **oscP5** (Sketch → Import Library → Add Library)
3. Open `Mcp2OscDemo/Mcp2OscDemo.pde` and run

## Addresses

| Address | Interaction |
|---------|-------------|
| `/mcp2osc/demo/slider` | Fills the bar (0–1) |
| `/mcp2osc/demo/button` | Background green when ON |
| `/mcp2osc/demo/preset` | Loads preset 1–3 (sets slider + button) |

Listens on **UDP 9500**.