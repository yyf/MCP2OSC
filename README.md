# MCP2OSC
MCP2OSC is a MCP (Model Context Protocol) server for OSC (OpenSoundControl)

![mcp2osc](https://github.com/user-attachments/assets/1c90133c-404b-4269-9515-7e4acba28453)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd MCP2OSC
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure your LLM application**
   Add to your Claude Desktop MCP configuration file, usually under "~/Library/Application\ Support/Claude" on macOS:
   ```json
   {
      "mcpServers": {
         "mcp2osc": {
            "command": "node",
            "args": ["/Users/.../MCP2OSC/mcp-server-maxmsp-compatible.js"],
            "cwd": "/Users/.../MCP2OSC",
            "env": {
            "OSC_HOST": "127.0.0.1",
            "OSC_SEND_PORT": "9500",
            "OSC_RECEIVE_PORT": "9501", 
            "WEBSOCKET_PORT": "8765",
            "WEBSOCKET_OSC_PORT": "9500",
            "MAX_OSC_MESSAGES": "2000",
            "OSC_LOG_ROTATION": "true"
            }
         }
      }
   }
   ```

4. **Start the LLM application, i.e. Claude desktop application**   
- Claude desktop application can be downloaded here: https://claude.ai/download
- Restart Claude if you make any change to the claude config json file 
- Open the example maxmsp patch and try the example prompts in Claude

5. **Start the server application (optional, needed for web dashboard)**
   ```bash
   npm run mcp
   ```

6. **Example prompts**   
- "What MCP tools are available"
- "Ping MaxMSP at port 9500 then check if there is any response"
- "Check received OSC messages"

## Configuration Options

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OSC_HOST` | `127.0.0.1` | OSC host address |
| `OSC_SEND_PORT` | `9500` | Port for sending OSC messages |
| `OSC_RECEIVE_PORT` | `9501` | Port for receiving OSC messages |
| `WEBSOCKET_PORT` | `8765` | WebSocket server port |
| `MAX_OSC_MESSAGES` | `1000` | Maximum OSC messages per log file |
| `OSC_LOG_ROTATION` | `false` | Enable daily log file rotation |

### OSC Message Logging

- **Single File Mode** (`OSC_LOG_ROTATION=false`): All messages stored in `logs/osc-messages.json`
- **Daily Rotation Mode** (`OSC_LOG_ROTATION=true`): Messages stored in daily files like `logs/osc-messages-2025-08-12.json`

**New Configuration Options:**
- `MAX_OSC_MESSAGES`: Number of OSC messages to keep in each log file (default: 1000)
- `OSC_LOG_ROTATION`: Enable daily log file rotation with date-based naming (default: false)
  - When enabled, creates files like `osc-messages-2025-08-12.json`
  - When disabled, uses single file `osc-messages.json`

**Start with custom configuration:**
```bash
MAX_OSC_MESSAGES=5000 OSC_LOG_ROTATION=true npm run mcp
```

## License
MIT License - see LICENSE file for details
