# RemNote Agent Runtime

RemNote Agent Runtime is the local, open-source bridge between RemNote and agent clients such as Codex. It combines a RemNote front-end plugin, a loopback MCP server, and a shared typed protocol.

The runtime is independent and is not affiliated with, endorsed by, or maintained by RemNote. It builds on the MIT-licensed `remnote-mcp-bridge` and `remnote-mcp-server` projects by Robert Spiegel; attribution is preserved in package licenses and notices.

## What it controls

The runtime exposes stable, semantic operations instead of screen coordinates. Its current tool surface covers:

- note and document search, reads, creation, updates, hierarchy, tags, properties, tables, journals, and media
- the active editor, selection, caret, markdown insertion, clipboard actions, undo/redo, and focused Rem deletion
- panes, open Rems, URLs, Daily Documents, reader highlights, Rem formatting, and knowledge-base metadata
- review-queue inspection and actions, plus card and scheduling metadata supported by the RemNote SDK
- privacy-preserving audit inspection for autonomous multi-step runs

The SDK coverage lock inventories all public methods in the pinned RemNote plugin SDK and prevents upgrades from silently adding unreviewed automation surface. Features that RemNote does not expose through its plugin SDK still require inspected UI automation.

## Security model

- HTTP and WebSocket services bind to loopback only.
- The MCP endpoint requires a random local bearer token.
- The RemNote bridge requires one-time code pairing and authenticates reconnects.
- Tokens are stored under the current user's profile and are never included in normal logs.
- Capability scopes are enforced inside the RemNote plugin before SDK calls execute.
- Autonomous operations are written to a local JSONL audit log using metadata and payload hashes rather than note contents.
- Runtime release archives are reproducible and accompanied by SHA-256 checksums.

Remote exposure is intentionally unsupported in `0.20.0`. Do not tunnel ports `3001`, `3002`, or `8080` to another machine.

## Workspace

- `packages/protocol`: shared protocol, capability, and risk definitions.
- `packages/server`: MCP server, stdio proxy, daemon, and packaging.
- `packages/bridge`: RemNote front-end plugin and SDK adapter.

## Develop and release

Node.js 22.13 or newer and pnpm are required.

```bash
pnpm install
pnpm quality
pnpm build
```

Build reproducible runtime and RemNote bridge archives with:

```bash
pnpm build:release
```

The archives, checksums, and release manifest are written to `artifacts/`. See `SECURITY.md` before changing authentication, host binding, pairing, or capability enforcement.
