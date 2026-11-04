-- MCP2OSC demo setup — run once after loading a WAV on track 1.
-- Adds EQ → Dynamics → Delay, shows automation lanes, sets baselines,
-- starts a background watcher that auto-applies Claude's automation queue.

local SCRIPT_DIR = ({reaper.get_action_context()})[2]:match("(.+[\\/])") or ""
dofile(SCRIPT_DIR .. "mcp2osc_lib.lua")

local function jsfx_path(name)
  local r = reaper.GetResourcePath()
  for _, p in ipairs({ r .. "/Effects/MCP2OSC/" .. name, r .. "/Effects/" .. name }) do
    local f = io.open(p, "r")
    if f then f:close(); return p end
  end
  return nil
end

local function add_jsfx(track, filename)
  local path = jsfx_path(filename)
  if not path then
    reaper.ShowMessageBox(
      "Missing JSFX: " .. filename ..
      "\n\nRun: node examples/Reaper/install.mjs",
      "MCP2OSC", 0)
    return -1
  end
  local stem = filename:gsub("%.jsfx$", "")
  local idx = reaper.TrackFX_AddByName(track, "JS: " .. stem, false, -1000)
  if idx < 0 then idx = reaper.TrackFX_AddByName(track, stem, false, -1000) end
  if idx < 0 then idx = reaper.TrackFX_AddByName(track, path, false, -1000) end
  return idx
end

local function fx_named(track, needle)
  local n = reaper.TrackFX_GetCount(track)
  for i = 0, n - 1 do
    local _, name = reaper.TrackFX_GetFXName(track, i, "")
    if name and name:lower():find(needle, 1, true) then return i end
  end
  return -1
end

local function ensure_chain(track)
  local eq = fx_named(track, "mcp2osc eq")
  local dyn = fx_named(track, "mcp2osc dynamics")
  local del = fx_named(track, "mcp2osc delay")
  if eq < 0 then eq = add_jsfx(track, "mcp2osc_eq.jsfx") end
  if dyn < 0 then dyn = add_jsfx(track, "mcp2osc_dynamics.jsfx") end
  if del < 0 then del = add_jsfx(track, "mcp2osc_delay.jsfx") end
  -- refresh indices after adds
  eq = fx_named(track, "mcp2osc eq")
  dyn = fx_named(track, "mcp2osc dynamics")
  del = fx_named(track, "mcp2osc delay")
  return eq, dyn, del
end

-- Baseline polish (normalized 0–1). Visible automation will move these later.
local BASE = {
  -- EQ sliders 1..9
  eq = { 0.16, 1.0, 0.42, 0.32, 0.55, 0.35, 0.35, 0.55, 0.5 },
  -- Dyn sliders 1..7
  dyn = { 0.70, 0.16, 0.10, 0.09, 0.5, 0.13, 1.0 },
  -- Delay sliders 1..4
  delay = { 0.045, 0.20, 0.12, 0.08 },
}

-- Envelopes to show (1-based fx slot relative to chain order, 1-based param)
-- All three plugins, parameters that read clearly on a lane
local SHOW = {
  { fx = 1, param = 5, label = "EQ mid gain" },
  { fx = 1, param = 8, label = "EQ high gain" },
  { fx = 2, param = 1, label = "Dyn threshold" },
  { fx = 2, param = 2, label = "Dyn ratio" },
  { fx = 3, param = 1, label = "Delay time" },
  { fx = 3, param = 3, label = "Delay mix" },
}

reaper.Undo_BeginBlock()
reaper.PreventUIRefresh(1)

local track = reaper.GetTrack(0, 0)
if not track then
  reaper.PreventUIRefresh(-1)
  reaper.ShowMessageBox("Create track 1 and load a WAV first.", "MCP2OSC", 0)
  return
end

reaper.SetOnlyTrackSelected(track)
local eq, dyn, del = ensure_chain(track)
if eq < 0 or dyn < 0 or del < 0 then
  reaper.PreventUIRefresh(-1)
  reaper.ShowMessageBox("Could not add MCP2OSC JSFX. Run install.mjs first.", "MCP2OSC", 0)
  return
end

local function set_params(fx_idx, values)
  for i, v in ipairs(values) do
    reaper.TrackFX_SetParamNormalized(track, fx_idx, i - 1, v)
  end
end
set_params(eq, BASE.eq)
set_params(dyn, BASE.dyn)
set_params(del, BASE.delay)

-- Map SHOW fx 1/2/3 → actual fx indices
local slot = { [1] = eq, [2] = dyn, [3] = del }

local vol = mcp2osc.ensure_vol_env(track)
if vol then mcp2osc.clear_envelope_points(vol) end

for _, s in ipairs(SHOW) do
  local fx_idx = slot[s.fx]
  if fx_idx and fx_idx >= 0 then
    local env = reaper.GetFXEnvelope(track, fx_idx, s.param - 1, true)
    mcp2osc.clear_envelope_points(env)
    mcp2osc.show_envelope(env)
  end
end

-- Tall track so lanes are obvious
reaper.SetMediaTrackInfo_Value(track, "I_HEIGHTOVERRIDE", 280)
reaper.SetMediaTrackInfo_Value(track, "B_HEIGHTLOCK", 1)

-- Clear stale queue
local q = io.open(mcp2osc.queue_path(), "w")
if q then q:close() end

mcp2osc.start_queue_watcher()

reaper.PreventUIRefresh(-1)
reaper.UpdateArrange()
reaper.Undo_EndBlock("MCP2OSC: Setup vocal polish demo", -1)

reaper.ShowMessageBox(
  "Track 1 ready.\n\n" ..
  "• EQ + Dynamics + Delay added\n" ..
  "• Automation lanes visible (EQ / Dyn / Delay + volume)\n" ..
  "• Queue watcher running (Claude’s /auto/apply applies itself)\n\n" ..
  "Keep npm start running, then paste the README Claude prompt.",
  "MCP2OSC", 0)
