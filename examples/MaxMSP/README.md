# MaxMSP — MCP2OSC

## Files

- `OSCdemo.maxpat` — **slider / button / preset** demo (UDP **9500**)
- `OSCtest.maxpat` — original test (routes `/audio/player/...`)

| Address | UI in OSCdemo |
|---------|----------------|
| `/mcp2osc/demo/slider` | `flonum` |
| `/mcp2osc/demo/button` | `toggle` |
| `/mcp2osc/demo/preset` | `sel 1 2 3` → packs that set slider+button |

Open `OSCdemo.maxpat`, then in Claude: *"Set /mcp2osc/demo/slider to 0.7"* / *"Load preset 2"*.