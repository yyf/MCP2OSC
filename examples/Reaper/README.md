# REAPER — MCP2OSC vocal polish

Load a WAV on track 1. The setup script builds the FX chain and shows automation lanes; Claude draws the curves.

## Once on this machine

```bash
cd examples/Reaper
node install.mjs
```

Then in REAPER:

1. **Preferences → Control/OSC/web → Add → OSC**  
   Pattern config: `MCP2OSC Vocal Polish` · Local listen port: `8000`
2. **Actions → Show action list → New action → Load ReaScript…**  
   Open `Scripts/MCP2OSC/mcp2osc_setup_vocal_chain.lua`  
   (`mcp2osc_lib.lua` is loaded automatically — don’t add it as an action)

## Every demo

```bash
npm start          # leave running
```

1. REAPER: put your WAV on **track 1**
2. Actions: run **`mcp2osc_setup_vocal_chain`**  
   (adds EQ → Dynamics → Delay, shows lanes, starts auto-apply watcher)
3. Paste this into Claude:

```
Send these MCP2OSC automation messages to port 9502 (send_osc_message with port 9502).
Do them in order, then send /mcp2osc/reaper/auto/apply.

fxparam args are: fx_slot (i), param (i), time_sec (f), value_norm 0–1 (f)
  FX1 EQ:     param 5 = mid gain,  param 8 = high gain
  FX2 Dyn:    param 1 = threshold, param 2 = ratio
  FX3 Delay:  param 1 = time,      param 3 = mix

Volume rides:
  /mcp2osc/reaper/auto/volume_db   0 0
  /mcp2osc/reaper/auto/volume_db   8 -4
  /mcp2osc/reaper/auto/volume_db  16 0
  /mcp2osc/reaper/auto/volume_db  28 3
  /mcp2osc/reaper/auto/volume_db  40 0
  /mcp2osc/reaper/auto/volume_db  55 -2
  /mcp2osc/reaper/auto/volume_db  60 0

EQ mid gain (fx 1, param 5) — presence swell then cut:
  /mcp2osc/reaper/auto/fxparam  1 5  0 0.50
  /mcp2osc/reaper/auto/fxparam  1 5 10 0.75
  /mcp2osc/reaper/auto/fxparam  1 5 25 0.40
  /mcp2osc/reaper/auto/fxparam  1 5 40 0.70
  /mcp2osc/reaper/auto/fxparam  1 5 60 0.50

EQ high gain (fx 1, param 8) — air in/out:
  /mcp2osc/reaper/auto/fxparam  1 8  0 0.50
  /mcp2osc/reaper/auto/fxparam  1 8 15 0.80
  /mcp2osc/reaper/auto/fxparam  1 8 35 0.35
  /mcp2osc/reaper/auto/fxparam  1 8 60 0.55

Dyn threshold (fx 2, param 1) — tighter then looser:
  /mcp2osc/reaper/auto/fxparam  2 1  0 0.75
  /mcp2osc/reaper/auto/fxparam  2 1 12 0.55
  /mcp2osc/reaper/auto/fxparam  2 1 30 0.80
  /mcp2osc/reaper/auto/fxparam  2 1 50 0.60
  /mcp2osc/reaper/auto/fxparam  2 1 60 0.70

Dyn ratio (fx 2, param 2) — gentle ↔ heavy:
  /mcp2osc/reaper/auto/fxparam  2 2  0 0.10
  /mcp2osc/reaper/auto/fxparam  2 2 20 0.35
  /mcp2osc/reaper/auto/fxparam  2 2 40 0.12
  /mcp2osc/reaper/auto/fxparam  2 2 60 0.20

Delay time (fx 3, param 1) — slap stretches:
  /mcp2osc/reaper/auto/fxparam  3 1  0 0.04
  /mcp2osc/reaper/auto/fxparam  3 1 18 0.12
  /mcp2osc/reaper/auto/fxparam  3 1 35 0.06
  /mcp2osc/reaper/auto/fxparam  3 1 60 0.05

Delay mix (fx 3, param 3) — dry → wet → dry:
  /mcp2osc/reaper/auto/fxparam  3 3  0 0.05
  /mcp2osc/reaper/auto/fxparam  3 3 15 0.35
  /mcp2osc/reaper/auto/fxparam  3 3 30 0.55
  /mcp2osc/reaper/auto/fxparam  3 3 45 0.20
  /mcp2osc/reaper/auto/fxparam  3 3 60 0.08

Finally:
  /mcp2osc/reaper/auto/apply
```

Watch track 1: volume + EQ + Dynamics + Delay lanes should fill in with obvious curves. Press play.

---

Details / norm math: [`osc-map-vocal-polish.json`](osc-map-vocal-polish.json)
