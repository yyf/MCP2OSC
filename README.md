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

## License
MIT License - see LICENSE file for details
