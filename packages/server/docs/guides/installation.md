# Installation Guide

Complete installation instructions for the RemNote MCP Server.

## Prerequisites

- **Node.js** >= 22.13.0 (Node.js 24 LTS recommended)
- **RemNote app** (desktop or web browser)
- **RemNote Automation Bridge plugin** - Install from [GitHub](https://github.com/robert7/remnote-mcp-bridge) -
  registration in the RemNote marketplace is pending approval
- **An MCP client** - Examples:
  - [Claude Code CLI](https://claude.com/claude-code)
  - [Accomplish](https://github.com/accomplish-ai/accomplish) (formerly Openwork)
  - Local MCP clients that consume stdio servers
  - Claude Desktop / Claude Cowork (local MCPB or [remote access setup](remote-access.md))

## Installation from npm

**Recommended for most users.**

> **Version compatibility (`0.x` semver):** before installing/upgrading, check the [Bridge / Consumer Version Compatibility Guide](https://github.com/robert7/remnote-mcp-bridge/blob/main/docs/guides/bridge-consumer-version-compatibility.md) and pick a `remnote-mcp-server` version compatible with your installed bridge plugin version.

### Install Globally

```bash
npm install -g remnote-mcp-server

# Example pinned install when you need a specific compatible version
npm install -g remnote-mcp-server@0.5.0
```

If you previously installed the legacy standalone CLI package, uninstall it so the `remnote-cli` command resolves to
the executable bundled with `remnote-mcp-server`:

```bash
npm uninstall -g remnote-cli
npm install -g remnote-mcp-server
```

### Verify Installation

```bash
which remnote-mcp-server
# Should output: /path/to/node/bin/remnote-mcp-server

which remnote-cli
# Should output: /path/to/node/bin/remnote-cli

which remnote-mcp-stdio
# Should output: /path/to/node/bin/remnote-mcp-stdio

remnote-mcp-server --version
# Should output: 0.x.x

remnote-cli --version
# Should output: 0.x.x

remnote-mcp-stdio --version
# Should output: 0.x.x
```

### Uninstalling

```bash
npm uninstall -g remnote-mcp-server
```

## Installation from Source

**For contributors and developers.** See [Development Setup Guide](development-setup.md) for detailed instructions.

**Quick start:**

> Prefer a checkout/tag that matches your installed bridge plugin minor version. See the [Bridge / Consumer Version Compatibility Guide](https://github.com/robert7/remnote-mcp-bridge/blob/main/docs/guides/bridge-consumer-version-compatibility.md).

```bash
git clone https://github.com/robert7/remnote-mcp-server.git
cd remnote-mcp-server
./link-cli.sh
# Later, remove the local links for package executables:
./unlink-cli.sh
```

## RemNote Automation Bridge plugin Setup

The server requires the RemNote Automation Bridge plugin to communicate with RemNote.

### Installation

1. Open your RemNote app
2. Follow plugin installation instructions from the [RemNote Bridge
   repository](https://github.com/robert7/remnote-mcp-bridge)

### Plugin Configuration

Once installed, configure the plugin:

1. Verify the WebSocket URL in plugin settings is `ws://127.0.0.1:3002` (default)
2. Open the Automation Bridge panel only if you want to monitor status or use manual reconnect

## Starting the Server

### Basic Usage

```bash
remnote-mcp-server
```

Expected output:
```
RemNote MCP Server v<version> listening { wsPort: 3002, httpPort: 3001 }
```

### Background Daemon

For everyday local use, daemon mode keeps the server running after the launching terminal closes and writes logs to
`~/.remnote-mcp-server/remnote-mcp-server.log`.

```bash
remnote-mcp-server daemon start
remnote-mcp-server daemon status
remnote-mcp-server daemon logs
```

On macOS, install a user LaunchAgent when you want the server to start at login and be restarted by `launchd` if it
exits:

```bash
remnote-mcp-server daemon install-launchd
```

After installing the LaunchAgent, use the same daemon commands for control:

```bash
remnote-mcp-server daemon status
remnote-mcp-server daemon stop
remnote-mcp-server daemon start
```

### With Custom Ports

```bash
remnote-mcp-server --ws-port 4002 --http-port 4001
```

### With Verbose Logging

```bash
remnote-mcp-server --verbose
```

### With File Logging

```bash
remnote-mcp-server --log-file /tmp/remnote-mcp.log --log-level-file debug
```

**Important:** The server must remain running for AI agents to connect. Keep the terminal open when using foreground
mode, or use daemon mode for a detached local server.

For server startup and daemon options, see
[remnote-mcp-server Command Reference](remnote-mcp-server-command-reference.md).
For persistent defaults such as debug logging and request/response JSON Lines logs, see the
[configuration file reference](remnote-mcp-server-command-reference.md#configuration-file).

### Recommended Startup Order

1. Start `remnote-mcp-server` in foreground mode or with `remnote-mcp-server daemon start`
2. Open RemNote
3. Wait for the bridge to connect automatically in the background
4. Open the Automation Bridge panel only if you want to confirm status
5. Only then connect your MCP client to `http://localhost:3001/mcp` or run `remnote-cli status --text`

If RemNote was already open before the server started, the bridge should still connect automatically after background
retry. The panel's **Reconnect** button remains available as a faster manual retry.

For the detailed bridge connection lifecycle, retry phases, and wake-up triggers, see the canonical bridge guide:
[Connection Lifecycle Guide](https://github.com/robert7/remnote-mcp-bridge/blob/main/docs/guides/connection-lifecycle.md).

## Verification

### 1. Check Server is Running

Verify both ports are listening:

```bash
# Check HTTP port (MCP)
lsof -i :3001

# Check WebSocket port (RemNote bridge)
lsof -i :3002
```

You should see the `node` process listening on both ports.

### 2. Check RemNote Plugin Connection

Open RemNote with the RemNote Automation Bridge plugin installed. The bridge should connect automatically in the
background. If you open the Automation Bridge panel in the right sidebar, it should show:

- **Status:** "Connected" (green indicator)
- **Server:** ws://127.0.0.1:3002
- Connection timestamp
- Statistics (requests sent/received)

If it still shows **Disconnected**, click **Reconnect** after confirming the server is already listening on port
`3002`.

### 3. Test MCP Connection

Once you've configured an MCP client (see [Configuration Guide](configuration.md)), test the connection:

**In Claude Code CLI:**
```
Use remnote_status to check the connection
```

Expected response:
```json
⏺ remnote - remnote_status (MCP)
  ⎿ {
       "connected": true,
       "pluginVersion": "0.3.2"
     }
```

### 4. Test RemNote Integration

Try creating a test note:

```
Create a RemNote note titled "MCP Test" with content "Testing the bridge"
```

This should use the `remnote_create_note` tool and create a new note in your RemNote knowledge base. Verify it appears
in RemNote.

You can also test the bundled CLI:

```bash
remnote-cli status --text
remnote-cli search "MCP Test" --text
```

## Common Installation Issues

### Node.js Version Too Old

**Symptom:** Installation fails with compatibility errors

**Solution:**
```bash
node --version
# Ensure >= 22.13.0

# Update Node.js using nvm:
nvm install 24
nvm use 24
```

### Permission Errors (npm install -g)

**Symptom:** `EACCES` errors during global installation

**Solution:**
```bash
# Option 1: Use nvm (recommended)
# See https://github.com/nvm-sh/nvm

# Option 2: Fix npm permissions
# See https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally

# Option 3: Use sudo (not recommended)
sudo npm install -g remnote-mcp-server
```

### Server Command Not Found

**Symptom:** `remnote-mcp-server: command not found`

**Solution:**
```bash
# Verify global npm bin directory is in PATH
npm config get prefix
# Should be in your PATH (check with: echo $PATH)

# If not in PATH, add to ~/.bashrc or ~/.zshrc:
export PATH="$(npm config get prefix)/bin:$PATH"
```

### Port Already in Use

**Symptom:** `EADDRINUSE` error when starting server

**Solution:** See [Troubleshooting Guide](troubleshooting.md#port-already-in-use)

### Plugin Won't Connect

**Symptom:** Server starts but plugin shows "Disconnected"

**Solution:** See [Troubleshooting Guide](troubleshooting.md#plugin-wont-connect)

### MCP Client Configured with `remnote-mcp-server` over `stdio`

**Symptom:** The MCP client starts `remnote-mcp-server` as a child process or times out during initialization

**Solution:** Do not configure `remnote-mcp-server` itself as a stdio server. Use HTTP transport to
`http://localhost:3001/mcp`, or use `remnote-mcp-stdio` for clients that only support stdio. In both cases,
`remnote-mcp-server` must keep running separately and the RemNote bridge must connect to it.
See [Configuration Guide](configuration.md#stdio-mcp-clients).

### Bridge / Server Version Mismatch (0.x)

**Symptom:** Plugin connects, but tool calls fail or behave unexpectedly after upgrading the plugin or server

**Solution:** Check bridge and server versions and install a compatible server version for your bridge plugin version.
See the [Bridge / Consumer Version Compatibility
Guide](https://github.com/robert7/remnote-mcp-bridge/blob/main/docs/guides/bridge-consumer-version-compatibility.md).

## Next Steps

- [Configure your AI client](configuration.md) - Set up CLI, Accomplish, or Claude Desktop / Cowork
- [Learn the MCP tools](tools-reference.md) - Explore available RemNote operations
- [View demos](../demo.md) - See the server in action with different clients

## Need Help?

- [Troubleshooting Guide](troubleshooting.md) - Common issues and solutions
- [GitHub Issues](https://github.com/robert7/remnote-mcp-server/issues) - Report bugs or ask questions
