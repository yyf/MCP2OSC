# MCP2OSC
MCP2OSC is a MCP (Model Context Protocol) server for OSC (OpenSoundControl)

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
   Add to your Claude Desktop MCP configuration:
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
            "WEBSOCKET_OSC_PORT": "9500"
            }
         }
      }
   }
   ```

4. **Start the application**
   ```bash
   npm run mcp
   ```

5. **Start the LLM application, i.e. Claude**   

## License

MIT License - see LICENSE file for details