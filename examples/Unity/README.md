# Unity — MCP2OSC demo

## Setup

1. Create a Unity project (2021 LTS+)
2. Install **[OSC Jack](https://github.com/keijiro/OscJack)** (Package Manager → Add from git URL)
3. Copy `Scripts/Mcp2OscDemoReceiver.cs` into `Assets/`
4. Add component to a GameObject → Play

## Addresses

| Address | Interaction |
|---------|-------------|
| `/mcp2osc/demo/slider` | Updates `slider` (0–1) |
| `/mcp2osc/demo/button` | Toggle bool |
| `/mcp2osc/demo/preset` | Load preset 1–3 |

Listens on **UDP 9500**.