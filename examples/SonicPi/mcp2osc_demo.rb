# MCP2OSC demo — Sonic Pi
# Paste into a buffer and Run.
#
# Sonic Pi receives OSC on UDP **4560** (not 9500).
# Set Claude Desktop OSC_SEND_PORT to "4560" for this demo.
#
# Incoming paths are prefixed /osc… so we sync on /osc*/mcp2osc/demo/…
# Cue log will show e.g. /osc:127.0.0.1:xxxxx/mcp2osc/demo/slider

set :slider, 0.5
set :button, 0
set :preset, 1

# Presets: soft / mid / full
define :load_preset do |n|
  table = {
    1 => [0.25, 0],
    2 => [0.5, 1],
    3 => [1.0, 1]
  }
  s, b = table[n.clamp(1, 3)]
  set :slider, s
  set :button, b
  set :preset, n.clamp(1, 3)
  puts "preset #{get[:preset]} → slider=#{s} button=#{b}"
end

# Continuous param → note / cutoff scale
live_loop :mcp_slider do
  use_real_time
  v = sync "/osc*/mcp2osc/demo/slider"
  set :slider, v[0].to_f
  puts "slider → #{get[:slider]}"
end

# Toggle → gate amp / rest
live_loop :mcp_button do
  use_real_time
  v = sync "/osc*/mcp2osc/demo/button"
  set :button, (v[0].to_i != 0 ? 1 : 0)
  puts "button → #{get[:button]}"
end

# Preset load
live_loop :mcp_preset do
  use_real_time
  v = sync "/osc*/mcp2osc/demo/preset"
  load_preset(v[0].to_i)
end

# Simple voice driven by shared state
live_loop :voice do
  use_real_time
  s = get[:slider]
  b = get[:button]
  if b == 1
    synth :prophet,
      note: :c3 + (s * 24),
      cutoff: 60 + (s * 60),
      sustain: 0.2,
      release: 0.2,
      amp: 0.6
  end
  sleep 0.25
end
