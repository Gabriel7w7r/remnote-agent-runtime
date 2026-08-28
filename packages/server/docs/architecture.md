# Architecture and Design Rationale

This document captures the design decisions and architectural rationale behind the RemNote MCP Server. For
implementation details, code patterns, and development workflows, see AGENTS.md and README.md.

## Performance Considerations

The multi-layer architecture was designed with several performance constraints:

**HTTP MCP Layer:**

- **Multiple concurrent sessions:** Supports multiple AI agents connecting simultaneously via Streamable HTTP (SSE)
- **Per-session MCP Server instances:** Each MCP session gets its own Server instance, sharing the WebSocket bridge
- **Stateful sessions:** Session state maintained in-memory via Map-based transport tracking
- **DNS rebinding protection:** Uses SDK's `createMcpExpressApp()` to prevent DNS rebinding attacks

**WebSocket Bridge Layer:**

- **Single client connection model:** Prevents resource contention and simplifies state management. Only one RemNote
  plugin connection is allowed at a time, with additional connection attempts rejected with WebSocket close code 1008.
- **15-second request timeout:** Prevents indefinite hanging of pending promises. Each request sent to the RemNote plugin
  must complete within 15 seconds, after which the promise is rejected. This ensures the MCP server remains responsive
  even if the RemNote plugin becomes unresponsive.
- **UUID-based request correlation:** Enables efficient request/response matching with multiple in-flight requests. Each
  request gets a unique UUID that the RemNote plugin echoes back in its response, allowing the server to match responses
  to pending promises without requiring sequential processing.
- **Event-driven architecture:** Non-blocking I/O throughout. The WebSocket server handles messages asynchronously, and
  all tool invocations return promises that resolve when the RemNote plugin responds.

## Security Model

The server enforces a local-only, authenticated security boundary:

- **Loopback enforcement:** Startup rejects non-loopback HTTP or WebSocket host configuration. Both services bind to
  `127.0.0.1`, and the HTTP layer retains DNS rebinding protection.
- **HTTP bearer authentication:** Every MCP HTTP request must provide the random token stored by the local `AuthStore`.
  The stdio and MCPB proxies load that token locally and do not print it.
- **Bridge pairing and reconnect proof:** A new RemNote bridge must complete a one-time six-digit pairing exchange.
  Reconnects prove possession of the stored secret with a nonce-bound HMAC rather than resending the secret.
- **Capability enforcement:** Each action declares required scopes and risk metadata. The bridge checks those scopes
  before invoking the RemNote SDK, so the server cannot bypass the user's local grant.
- **Privacy-preserving audit:** Autonomous operations record timestamps, action names, risk, result metadata, and
  payload hashes in local JSONL. Note contents and credentials are excluded.
- **Input validation:** Zod schemas validate tool parameters before requests reach RemNote and produce actionable
  client errors for malformed data.
- **Artifact integrity:** Release archives are built reproducibly and distributed with SHA-256 checksums. The Codex
  bootstrap verifies the runtime archive before extraction.

## Error Handling Strategy

Error handling is implemented at three layers, each with specific responsibilities:

### WebSocket Layer (`websocket-server.ts`)

- **No client connected:** Returns descriptive error "RemNote plugin not connected. Please ensure the plugin is
  installed and running."
- **Request timeout (15s):** Rejects the pending promise with a timeout error
- **Connection lost mid-request:** All pending requests are immediately rejected with "Connection lost" error
- **Malformed messages:** Logged to stderr, response discarded or request rejected

Design rationale: Fail fast with clear error messages. When the connection is lost, immediately clean up all pending
requests rather than leaving them hanging indefinitely.

### MCP Tool Layer (`tools/index.ts`)

- **Validation errors (Zod):** Returns MCP error response with detailed validation messages showing which parameters
  failed and why
- **Bridge errors:** Passes through error messages from the RemNote plugin without modification
- **Unknown tools:** Returns error "Unknown tool: {name}"

Design rationale: Distinguish between client-side validation errors (fixable by the MCP client) and server-side errors
(issues with RemNote plugin or RemNote itself). Zod validation errors include detailed schema information to help
diagnose parameter issues.

### Request Correlation

- **Unknown response ID:** Warning logged to stderr, response discarded (orphaned response)
- **Duplicate response:** Warning logged to stderr, second response ignored

Design rationale: Defensive programming against protocol violations. Log warnings for debugging but don't crash the
server if the RemNote plugin sends unexpected response IDs.

## Future Enhancements

Potential architectural improvements for consideration:

- **Session persistence:** Optional session resumability across server restarts (currently all sessions lost on restart)
- **Rate limiting:** Protect against rapid-fire requests that could overwhelm RemNote
- **Metrics and monitoring:** Expose server metrics (request counts, latencies, error rates) for observability
- **Batch operations:** Support bundling multiple RemNote operations into a single request/response
- **Streaming responses:** For large result sets, stream data back incrementally rather than buffering entire response
- **Transactional plans:** Add reviewed, resumable multi-step plans with compensating actions where the RemNote SDK can
  support them safely
- **Event subscriptions:** Surface additional SDK events when they provide stable, privacy-preserving agent signals
