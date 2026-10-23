<CsoundSynthesizer>
; MCP2OSC demo — Csound
; Receives: /mcp2osc/demo/slider (f) /button (i) /preset (i 1-3)
; Listen: UDP 9500
;
;   csound mcp2osc_demo.csd
;
<CsOptions>
-odac -d
</CsOptions>
<CsInstruments>
sr     = 44100
ksmps  = 32
nchnls = 2
0dbfs  = 1

gihandle OSCinit 9500

instr 1
  kslider init 0.5
  kbutton init 0
  kpreset init 1

nxtslider:
  kok OSClisten gihandle, "/mcp2osc/demo/slider", "f", kslider
  if kok == 1 then
    printk2 kslider
    kgoto nxtslider
  endif

nxtbutton:
  kok OSClisten gihandle, "/mcp2osc/demo/button", "i", kbutton
  if kok == 1 then
    if kbutton != 0 then
      kbutton = 1
    else
      kbutton = 0
    endif
    printk2 kbutton
    kgoto nxtbutton
  endif

nxtpreset:
  kok OSClisten gihandle, "/mcp2osc/demo/preset", "i", kpreset
  if kok == 1 then
    if kpreset < 1 then
      kpreset = 1
    elseif kpreset > 3 then
      kpreset = 3
    endif
    if kpreset == 1 then
      kslider = 0.25
      kbutton = 0
    elseif kpreset == 2 then
      kslider = 0.5
      kbutton = 1
    else
      kslider = 1.0
      kbutton = 1
    endif
    printks "preset %d → slider %.2f button %d\\n", 0, kpreset, kslider, kbutton
    kgoto nxtpreset
  endif

  kamp = 0.25 * kbutton * (0.2 + 0.8 * kslider)
  kcps = cpsmidinn(48 + kslider * 24)
  a1   oscili kamp, kcps
  aenv linenr a1, 0.01, 0.05, 0.01
  outs aenv, aenv
endin
</CsInstruments>
<CsScore>
i1 0 3600
e
</CsScore>
</CsoundSynthesizer>
