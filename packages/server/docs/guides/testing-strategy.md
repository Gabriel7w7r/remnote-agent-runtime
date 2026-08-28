# Testing Strategy

The RemNote bridge/server stack uses three separate testing levels. They answer different questions and should stay
separate so routine development checks, maintainer release checks, and end-user setup validation can evolve without
turning into one oversized test path.

## Level 1: Local Quality And Unit Tests

Level 1 runs on every code change. It validates isolated server behavior, schemas, tool registration, formatting, and
coverage without requiring a live RemNote app or bridge plugin.

Primary command:

```bash
./code-quality.sh
```

Use Level 1 before committing or handing off any code/docs change in this repository.

## Level 2: Maintainer Live Integration Suite

Level 2 validates the shared bridge-consumer contract against a real RemNote instance. It is intended for maintainers
before merging to `main`, cutting a release, or changing the external tool/CLI surface.

This suite creates real test artifacts under the shared anchor note:

```text
RemNote Automation Bridge [temporary integration test data]
```

It resolves the persistent fixtures `Automation Bridge Advanced Table`, `Automation Bridge Test Tag`, and
`Automation Bridge Test Media` by exact title; their setup contract is documented in the integration guide.

Canonical guide:

- [Integration Testing](integration-testing.md)

Primary agent-safe command:

```bash
./run-agent-integration-test.sh --preflight-only
./run-agent-integration-test.sh --yes
```

Human/manual entrypoint:

```bash
./run-integration-test.sh
```

## Level 3: End-User Agent Validation Prompts

Level 3 validates a user's installed server, bridge plugin, RemNote database, and chosen AI agent together. It is a
copy-paste prompt, not a code runner. The goal is to confirm that the user's actual agent can discover and use the
RemNote MCP tools end to end after installation or deployment.

Level 3 should be:

- agent-agnostic: usable in Codex, OpenClaw, Claude Desktop/Cowork, Claude Code, ChatGPT, and similar MCP clients
- zero-config: no user-provided Rem IDs for the default smoke test
- conservative: avoid destructive operations unless the installed bridge explicitly enables them
- easy to clean up: reuse the same temporary integration-test anchor and `[MCP-AGENT-TEST]` prefix

Current prompt:

- [MCP Tool Smoke Test](../agent-validation-prompts/mcp-tool-smoke-test.md)

Level 3 is intentionally lighter than Level 2. It should exercise the normal MCP tool surface through the agent, but it
does not replace the maintainer integration suite's deeper assertions, transport coverage, error cases, or release
gates.

## When To Use Each Level

| Level | Who runs it | When | Main question |
|---|---|---|---|
| Level 1 | Contributors and agents | Every code/docs change | Does the repository still pass local quality and unit checks? |
| Level 2 | Maintainers and release agents | Before merge/release or external contract changes | Does the bridge/server/CLI contract work against live RemNote? |
| Level 3 | End users and support/debugging agents | After install/deploy or when validating a client setup | Can this AI agent use the installed RemNote MCP tools end to end? |
