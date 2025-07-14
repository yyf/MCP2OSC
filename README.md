# MCP2OSC
A bridge application that translates Model Context Protocol (MCP) message to Open Sound Control (OSC) message

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

3. **Start the application**
   ```bash
   npm start
   ```

4. **Configure your LLM application**
   Add to your Claude Desktop MCP configuration:
   ```json
   {
     "mcpServers": {
       "mcp2osc": {
         "command": "/opt/homebrew/bin/node",
         "args": ["/Users/yyf/Code/Prototypes/2025-4/MCP2OSC/mcp-server-clean.js"]
       }
     }
   }
   ```

5. **Open the dashboard**
   Visit `http://localhost:3001` to monitor and configure the system

### Debug Mode

Enable detailed logging:
```bash
MCP2OSC_LOG_LEVEL=debug npm start
```

View real-time logs:
```bash
tail -f logs/mcp2osc.log
```

## License

MIT License - see LICENSE file for details