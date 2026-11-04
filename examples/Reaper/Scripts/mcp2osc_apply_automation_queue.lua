-- MCP2OSC: Apply automation queue (manual fallback)
-- Usually unnecessary — setup starts an auto-watcher. Use if you need a one-shot apply.

local SCRIPT_DIR = ({reaper.get_action_context()})[2]:match("(.+[\\/])") or ""
dofile(SCRIPT_DIR .. "mcp2osc_lib.lua")

reaper.Undo_BeginBlock()
local n = mcp2osc.apply_queue(false)
reaper.Undo_EndBlock(string.format("MCP2OSC: Apply automation (%d)", n), -1)
