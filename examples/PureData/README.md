# Pure Data — MCP2OSC

## Existing

- `OSCtest.pd` — `netreceive` / `oscparse` on port 9500

## Shared demo map

Extend the patch to route:

| Address | Object tip |
|---------|------------|
| `/mcp2osc/demo/slider` | `float` / `hsl` 0–1 |
| `/mcp2osc/demo/button` | `tgl` |
| `/mcp2osc/demo/preset` | `select 1 2 3` → load message boxes |

Listen: **UDP 9500**.