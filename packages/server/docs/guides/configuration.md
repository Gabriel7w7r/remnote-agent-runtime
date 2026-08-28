# Configuration Guide

How to configure MCP clients to connect to the RemNote MCP Server.

## Overview

The RemNote MCP Server uses Streamable HTTP transport, which means:

- The server must be started independently before client connections
- Clients connect via HTTP to `http://localhost:3001/mcp` (default)
- Multiple clients can connect simultaneously
- Each client gets its own MCP session
- Stdio-only MCP clients can use the `remnote-mcp-stdio` proxy, which forwards to the same local HTTP endpoint

## Quick Start

**1. Start the server:**

```bash
remnote-mcp-server
```

For an everyday local setup that survives terminal close:

```bash
remnote-mcp-server daemon start
```

On macOS, `remnote-mcp-server daemon install-launchd` makes that service persistent across login. Once installed,
`daemon start`, `daemon stop`, `daemon restart`, and `daemon status` control the launchd service.

**2. Open RemNote and let the bridge auto-connect:**

- Open RemNote with the Automation Bridge plugin enabled
- The bridge now starts automatically on plugin activation and should connect to `ws://127.0.0.1:3002` in the background
- Open the Automation Bridge panel only if you want to confirm status or trigger an immediate manual **Reconnect**

For the detailed bridge connection lifecycle, retry phases, and wake-up triggers, see the canonical bridge guide:
[Connection Lifecycle Guide](https://github.com/robert7/remnote-mcp-bridge/blob/main/docs/guides/connection-lifecycle.md).

The server accepts only bridge plugins that identify themselves with a compatible `0.x` package version during the
WebSocket handshake. During pre-stable releases, the bridge and server must use the same minor version line, for
example server `0.14.x` with bridge `0.14.x`.

**3. Configure your AI client:**

Choose your AI client and follow its configuration guide:

- **[Claude Code CLI](configuration-claude-code-CLI.md)** - Anthropic's command-line interface tool that integrates with
  their Claude AI models *(for a zero-config alternative in Claude Code and other coding harnesses, see
  [Use RemNote from Any Coding Harness](../demo.md#use-remnote-from-any-coding-harness))*
- **[Codex TUI / Codex.app](configuration-codex.md)** - OpenAI coding agent setup with Streamable HTTP MCP, stdio
  proxy, or the `remnote-cli` skill path
- **[Accomplish](configuration-accomplish.md)** - open source AI desktop agent that automates file management, document
  creation, and browser tasks
- **[Claude Desktop / Cowork Local MCPB](configuration-claude-desktop-local-mcpb.md)** - Local desktop extension setup
  without public HTTPS
- **[Claude Desktop / Cowork Remote Connector](configuration-claude-desktop-cowork.md)** - Anthropic remote connector
  setup when local MCPB is not applicable
- **[Generic stdio MCP clients](#stdio-mcp-clients)** - Use `remnote-mcp-stdio` when the client cannot consume
  Streamable HTTP directly

## Other MCP Clients

Any MCP client that supports Streamable HTTP transport can connect to the RemNote MCP Server directly. Local clients
that only support stdio can use `remnote-mcp-stdio` as a proxy to the same server.

### Streamable HTTP Clients

**Server URL:** `http://localhost:3001/mcp`

**Transport type:** HTTP with SSE (Server-Sent Events)

**MCP protocol versions:** supports current MCP SDK protocol negotiation, including `2025-11-25`, `2025-06-18`,
`2025-03-26`, and earlier `2024-*` versions supported by the SDK.

Seeing Claude Desktop send `protocolVersion: "2025-11-25"` during `initialize` is expected. That value is an MCP
protocol version, not the `remnote-mcp-server` or bridge plugin package version.

### Connection Flow

1. Client sends POST request to `/mcp` with `initialize` method
2. Server responds with session ID in `mcp-session-id` header
3. Client includes session ID in subsequent requests
4. Server uses SSE for notifications and streaming responses

For technical details, see the [MCP
Specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#http-with-sse).

### Stdio MCP Clients

Use `remnote-mcp-stdio` for local MCP clients that can spawn stdio MCP servers but cannot connect to Streamable HTTP
directly.

Prerequisite: before any stdio client can use RemNote, `remnote-mcp-server` must already be running and the RemNote
Automation Bridge must be connected to it. For local desktop use, `remnote-mcp-server daemon start` is usually the
least fussy way to keep that server available.

```text
stdio client -> remnote-mcp-stdio -> remnote-mcp-server :3001 -> RemNote bridge :3002 -> RemNote
```

Important runtime model:

- `remnote-mcp-stdio` is a stdio-to-HTTP proxy, not the main server.
- `remnote-mcp-server` must already be running, or started separately.
- The RemNote Automation Bridge always connects to `remnote-mcp-server` over WebSocket. The server does not connect
  outward to the bridge, and `remnote-mcp-stdio` does not talk to the bridge directly.
- Multiple stdio clients may each spawn their own `remnote-mcp-stdio` process while sharing the same
  `remnote-mcp-server` instance.

Generic client configuration:

```json
{
  "mcpServers": {
    "remnote": {
      "command": "remnote-mcp-stdio",
      "env": {
        "REMNOTE_MCP_URL": "http://127.0.0.1:3001/mcp"
      }
    }
  }
}
```

If the HTTP server uses the default endpoint, `REMNOTE_MCP_URL` can be omitted. Set it when you start
`remnote-mcp-server` with a custom HTTP port.

For a concrete stdio client setup, see
[Codex Configuration: Stdio MCP Proxy](configuration-codex.md#option-2-stdio-mcp-proxy).

For manual checks, `remnote-mcp-stdio --help` prints usage and `remnote-mcp-stdio -V` prints the installed version.
Running `remnote-mcp-stdio` directly in a terminal prints the same usage text instead of silently waiting for MCP
messages.

Manual smoke checks:

```bash
remnote-mcp-stdio -V
remnote-mcp-stdio --help
remnote-mcp-stdio
echo $?

# if you cloned and installed this repo, you can also run the MCPB integration test suite
./run-agent-integration-test.sh --suite mcpb --yes
```

Expected behavior:

- `-V` prints the installed package version.
- `--help` prints usage text.
- Direct terminal invocation prints usage and exits with status `1`.
- The MCPB integration suite verifies real stdio MCP tool calls through the running local server and connected bridge.

## Environment Variables

You can customize server ports and host binding via environment variables.

### Available Variables

- `REMNOTE_HTTP_PORT` - HTTP MCP server port (default: 3001)
- `REMNOTE_HTTP_HOST` - HTTP server bind address (default: 127.0.0.1)
- `REMNOTE_WS_PORT` - WebSocket server port (default: 3002)
- `REMNOTE_MEDIA_ROOTS` - Allowed RemNote media roots, separated by the platform path delimiter. When unset, the
  server discovers existing `~/remnote/remnote-*/files` directories.

### Using Custom Ports

**Start server with custom ports:**

```bash
export REMNOTE_HTTP_PORT=3003
export REMNOTE_WS_PORT=3004
remnote-mcp-server
```

**Or use CLI flags:**

```bash
remnote-mcp-server --http-port 3003 --ws-port 3004
```

**Update client configuration:**

After changing ports, update your MCP client configuration to use the new HTTP port:

```json
{
  "type": "http",
  "url": "http://localhost:3003/mcp"
}
```

**Update RemNote plugin:**

If you changed the WebSocket port, update the plugin settings in RemNote:

- WebSocket URL: `ws://127.0.0.1:3004` (or your custom port)

## RemNote Plugin Configuration

The RemNote Automation Bridge plugin must be configured to match the server's WebSocket port.

### Plugin Settings

**Location:** RemNote app → Plugin control panel

**Settings:**

- **WebSocket URL:** `ws://127.0.0.1:3002` (default, or your custom port)

On current bridge builds, the plugin starts its WebSocket connection attempts automatically on plugin activation. The
Automation Bridge sidebar panel is optional and exists for status, logs, and manual reconnect.

For the detailed bridge retry and wake-up behavior, see the canonical bridge guide:
[Connection Lifecycle Guide](https://github.com/robert7/remnote-mcp-bridge/blob/main/docs/guides/connection-lifecycle.md).

### Verifying Plugin Connection

The plugin control panel should show:

- **Status:** "Connected" (green indicator)
- **Server:** ws://127.0.0.1:3002
- Connection timestamp
- Statistics (requests sent/received)

Recommended order:

1. Start `remnote-mcp-server`
2. Open RemNote
3. Wait for the bridge to connect in the background, or open the Automation Bridge panel if you want to confirm status
4. Then connect your MCP client to `http://localhost:3001/mcp`

If the status shows "Disconnected," see the [Troubleshooting Guide](troubleshooting.md#plugin-wont-connect).

## Common Configuration Mistakes

### Wrong Stdio Command

Do not configure stdio MCP clients to spawn `remnote-mcp-server` itself. That command starts the long-running HTTP and
WebSocket server; it does not speak MCP over stdio.

❌ **Incorrect:**
```json
{
  "type": "stdio",
  "command": "remnote-mcp-server"
}
```

✅ **Correct for HTTP-capable clients:**
```json
{
  "type": "http",
  "url": "http://localhost:3001/mcp"
}
```

✅ **Correct for stdio-only clients:**
```json
{
  "type": "stdio",
  "command": "remnote-mcp-stdio"
}
```

### Missing /mcp Path

❌ **Incorrect:**
```json
{
  "type": "http",
  "url": "http://localhost:3001"
}
```

✅ **Correct:**
```json
{
  "type": "http",
  "url": "http://localhost:3001/mcp"
}
```

### Server Not Running

**Symptom:** Client shows connection error or timeout

**Solution:** Verify the server is running:

```bash
lsof -i :3001
# Should show node process listening
```

If not running, start the server:

```bash
remnote-mcp-server
```

Or use daemon mode:

```bash
remnote-mcp-server daemon start
remnote-mcp-server daemon status
```

Then wait for the RemNote bridge to connect automatically before retrying the MCP client, or use the panel's
**Reconnect** button if you want an immediate retry.

### Wrong Port in Configuration

**Symptom:** Client can't connect even though server is running

**Solution:** Verify the port in your configuration matches the server's HTTP port:

```bash
# Check what port the server is using
lsof -i :3001

# Verify your configuration (example for Claude Code)
cat ~/.claude.json | grep -A 5 remnote
```

### Deprecated Configuration File

**Old location (deprecated):**

- `~/.claude/.mcp.json` (no longer used)
- `enabledMcpjsonServers` setting (deprecated)

**Current location:**

- `~/.claude.json` with `mcpServers` under project paths (Claude Code)
- `~/.config/opencode/opencode.json` (Accomplish)

If you have old configuration, migrate to the new format.

## Multi-Client Setup

Multiple MCP clients can connect to the same RemNote MCP Server simultaneously.

### How It Works

- One server process runs on ports 3001 (HTTP) and 3002 (WebSocket)
- Each client gets its own MCP session
- All sessions share the same WebSocket bridge to RemNote
- Concurrent requests are handled via UUID-based correlation

### Example: Claude Code CLI + Accomplish

**Terminal 1: Start server**
```bash
remnote-mcp-server
```

**Terminal 2: Claude Code**
```bash
claude
prompt: Search my RemNote for "AI"
```

**Accomplish window:**
```
Task: Create a RemNote note about today's meeting
```

Both clients can operate simultaneously without conflicts.

### Limitations

The WebSocket bridge enforces a **single RemNote plugin connection**. This means:

- Multiple AI clients can connect to the server
- But only one RemNote app instance can be connected at a time

This is a RemNote plugin limitation, not an MCP server limitation.

## Configuration Precedence

When using CLI flags, environment variables, the TOML config file, and default values:

**Precedence (highest to lowest):**

1. CLI flags (`--http-port 3003`)
2. Environment variables (`REMNOTE_HTTP_PORT=3003`)
3. `~/.remnote-mcp-server/config.toml`
4. Default values (3001 for HTTP, 3002 for WebSocket)

**Example:**

```bash
# Environment variable sets port to 3003
export REMNOTE_HTTP_PORT=3003

# CLI flag overrides to 3005
remnote-mcp-server --http-port 3005

# Server uses 3005 (CLI flag wins)
```

For persistent local defaults, including debug request/response logs for daemon or launchd startup, see
[remnote-mcp-server Command Reference](remnote-mcp-server-command-reference.md#configuration-file).

## Next Steps

- **AI Client Guides:**
  - [Claude Code Configuration](configuration-claude-code-CLI.md)
  - [Codex Configuration](configuration-codex.md)
  - [Accomplish Configuration](configuration-accomplish.md)
  - [Claude Desktop / Cowork Configuration](configuration-claude-desktop-cowork.md)
- **Server Configuration:**
  - [remnote-mcp-server Command Reference](remnote-mcp-server-command-reference.md) - Server executable flags and daemon commands
  - [Remote Access Setup](remote-access.md) - Expose server for cloud-based clients
- **Usage:**
  - [Tools Reference](tools-reference.md) - Available MCP tools
  - [Troubleshooting](troubleshooting.md) - Common configuration issues

## Need Help?

- [Troubleshooting Guide](troubleshooting.md) - Common issues and solutions
- [GitHub Issues](https://github.com/robert7/remnote-mcp-server/issues) - Report problems or ask questions
