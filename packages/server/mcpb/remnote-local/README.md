# RemNote Local MCPB

Claude Desktop extension that exposes a local `remnote-mcp-server` to Claude Desktop and eligible Claude Cowork
desktop sessions without a public HTTPS tunnel.

## Usage

1. Install and start `remnote-mcp-server`.
2. Open RemNote with the Automation Bridge plugin enabled and connected.
3. Install this extension's `.mcpb` file in Claude Desktop.
4. Keep the default MCP URL unless your server uses a custom port:

```text
http://127.0.0.1:3001/mcp
```

This extension does not start or supervise `remnote-mcp-server`. It is a stdio proxy that forwards Claude Desktop and
eligible Claude Cowork tool calls to the local Streamable HTTP endpoint.

## Installed Package Path

When installed from npm, print the bundled `.mcpb` path with:

```bash
remnote-mcp-server mcpb-path
```
