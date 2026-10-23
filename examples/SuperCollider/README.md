# SuperCollider — MCP2OSC

## Existing

- `OSCtest.scd` — basic send/receive test

## Shared demo map

```supercollider
(
~slider = 0.5;
~button = 0;
~preset = 1;
~presets = (
  1: (slider: 0.25, button: 0),
  2: (slider: 0.5, button: 1),
  3: (slider: 1.0, button: 1)
);

OSCdef(\mcpSlider, { |msg|
  ~slider = msg[1];
  ("slider:" + ~slider).postln;
}, '/mcp2osc/demo/slider');

OSCdef(\mcpButton, { |msg|
  ~button = msg[1].asInteger;
  ("button:" + ~button).postln;
}, '/mcp2osc/demo/button');

OSCdef(\mcpPreset, { |msg|
  ~preset = msg[1].asInteger;
  var p = ~presets[~preset];
  if(p.notNil) {
    ~slider = p.slider;
    ~button = p.button;
    ("preset" + ~preset + p).postln;
  };
}, '/mcp2osc/demo/preset');
)
```

Bind OSCdefs to the port matching MCP2OSC send (**9500**), e.g. via `NetAddr` / server options as in `OSCtest.scd`.