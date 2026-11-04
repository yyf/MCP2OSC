-- Shared helpers for MCP2OSC REAPER demo (dofile'd by other scripts)

mcp2osc = mcp2osc or {}

function mcp2osc.queue_path()
  local env = os.getenv("MCP2OSC_AUTO_QUEUE")
  if env and #env > 0 then return env end
  return reaper.GetResourcePath() .. "/mcp2osc_auto_queue.jsonl"
end

function mcp2osc.parse_json_obj(line)
  local obj = {}
  for key, num in line:gmatch('"(%w+)"%s*:%s*(-?%d+%.?%d*)') do
    obj[key] = tonumber(num)
  end
  for key, str in line:gmatch('"(%w+)"%s*:%s*"(.-)"') do
    obj[key] = str
  end
  return obj
end

function mcp2osc.db_to_vol(db)
  return 10 ^ (db / 20)
end

function mcp2osc.show_envelope(env)
  if not env then return end
  local ok, chunk = reaper.GetEnvelopeStateChunk(env, "", false)
  if not ok or not chunk or chunk == "" then return end
  if chunk:find("VIS %d+") then
    chunk = chunk:gsub("VIS %d+", "VIS 1", 1)
  else
    chunk = chunk:gsub("<ENV", "<ENV\nVIS 1", 1)
  end
  if chunk:find("ARM %d+") then
    chunk = chunk:gsub("ARM %d+", "ARM 1", 1)
  end
  reaper.SetEnvelopeStateChunk(env, chunk, false)
end

function mcp2osc.ensure_vol_env(track)
  local env = reaper.GetTrackEnvelopeByName(track, "Volume")
  if not env then
    reaper.SetTrackSelected(track, true)
    -- Toggle volume envelope visible (creates if needed)
    reaper.Main_OnCommand(40406, 0)
    env = reaper.GetTrackEnvelopeByName(track, "Volume")
  end
  mcp2osc.show_envelope(env)
  return env
end

function mcp2osc.ensure_fx_env(track, fx_1based, param_1based)
  local env = reaper.GetFXEnvelope(track, fx_1based - 1, param_1based - 1, true)
  mcp2osc.show_envelope(env)
  return env
end

function mcp2osc.clear_envelope_points(env)
  if not env then return end
  local n = reaper.CountEnvelopePoints(env)
  for i = n - 1, 0, -1 do
    reaper.DeleteEnvelopePointEx(env, -1, i)
  end
  reaper.Envelope_SortPoints(env)
end

--- Apply queue file. Returns applied count. Clears consumed lines.
--- silent: no message box
function mcp2osc.apply_queue(silent)
  local path = mcp2osc.queue_path()
  local f = io.open(path, "r")
  if not f then
    if not silent then
      reaper.ShowMessageBox("Queue not found:\n" .. path, "MCP2OSC", 0)
    end
    return 0
  end
  local lines = {}
  for line in f:lines() do
    if line ~= "" then lines[#lines + 1] = line end
  end
  f:close()
  if #lines == 0 then return 0 end

  -- Wait for explicit apply marker so we don't race Claude's writes
  local has_apply = false
  for _, line in ipairs(lines) do
    local e = mcp2osc.parse_json_obj(line)
    if e.type == "apply" then has_apply = true; break end
  end
  if not has_apply then return 0 end

  reaper.PreventUIRefresh(1)
  local applied = 0
  local touched = {}

  for _, line in ipairs(lines) do
    local e = mcp2osc.parse_json_obj(line)
    if e.type == "volume" then
      local tr = reaper.GetTrack(0, (e.track or 1) - 1)
      if tr then
        local env = mcp2osc.ensure_vol_env(tr)
        if env then
          local amp = e.value_db ~= nil and mcp2osc.db_to_vol(e.value_db) or (e.value or 1)
          reaper.InsertEnvelopePoint(env, e.time or 0, amp, 0, 0, false, true)
          touched[tostring(env)] = env
          applied = applied + 1
        end
      end
    elseif e.type == "fxparam" then
      local tr = reaper.GetTrack(0, (e.track or 1) - 1)
      if tr then
        local env = mcp2osc.ensure_fx_env(tr, e.fx or 1, e.param or 1)
        if env then
          reaper.InsertEnvelopePoint(env, e.time or 0, e.value or 0.5, 0, 0, false, true)
          touched[tostring(env)] = env
          applied = applied + 1
        end
      end
    end
  end

  for _, env in pairs(touched) do
    reaper.Envelope_SortPoints(env)
  end

  local out = io.open(path, "w")
  if out then out:close() end

  reaper.PreventUIRefresh(-1)
  reaper.UpdateArrange()
  if not silent and applied > 0 then
    reaper.ShowMessageBox(string.format("Inserted %d automation point(s).", applied), "MCP2OSC", 0)
  end
  return applied
end

function mcp2osc.start_queue_watcher()
  if mcp2osc._watching then return end
  mcp2osc._watching = true
  local function tick()
    mcp2osc.apply_queue(true)
    reaper.defer(tick)
  end
  reaper.defer(tick)
end
