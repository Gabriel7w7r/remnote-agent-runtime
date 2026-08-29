# Security Policy

## Supported version

Security fixes are provided for the latest released version of RemNote Agent Runtime.

## Security boundary

RemNote Agent Runtime is local-only. It rejects non-loopback HTTP and WebSocket host configuration, requires bearer authentication for MCP HTTP requests, and requires one-time pairing plus HMAC proof for the RemNote bridge. The bridge independently enforces declared capability scopes before invoking RemNote SDK methods.

Do not expose ports `3001`, `3002`, or `8080` through a tunnel, reverse proxy, LAN binding, port forward, or public relay. A future remote mode would require a separately reviewed authenticated gateway and is not part of version `0.20.0`.

## Secrets and logs

- Never commit or paste the generated HTTP token, bridge pairing secret, or `REMNOTE_MCP_TOKEN` into issues or prompts.
- Local audit entries contain operation metadata and payload hashes, not note text.
- Debug logs may still reveal identifiers or error context. Review them before sharing.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for the repository when available. Otherwise, contact the repository owner privately before disclosing a security issue publicly. Include the affected version, reproduction steps, expected impact, and any proposed mitigation.
