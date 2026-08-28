# Integration Testing

This is the Level 2 maintainer live integration workflow in the
[Testing Strategy](testing-strategy.md). It is the canonical workflow for updating and running shared integration
coverage for `remnote-mcp-server` and `remnote-cli`.

Use it when a feature changes the shared bridge-consumer surface and should be validated end to end against a live
RemNote instance.

The direct MCP suite, MCPB stdio proxy suite, and bundled CLI suite all live in this repository.

## Safety And Cleanup

Integration tests create new RemNote data, but they do **not** delete, overwrite, or replace existing user data.

Artifacts are easy to find because they are grouped predictably:

- MCP server artifacts use the `[MCP-TEST]` prefix
- CLI artifacts use the `[CLI-TEST]` prefix
- note/tree artifacts live under `RemNote Automation Bridge [temporary integration test data]`
- journal artifacts appear in Today's Note with the same prefixes

RemNote's bridge surface does not expose delete operations, so cleanup stays manual by design.

![MCP server integration test cleanup in anchor note](../images/integration-testing-03-cleanup-anchor-note.jpg)

![MCP server integration test cleanup in journal](../images/integration-testing-04-cleanup-journal.jpg)

## Prerequisites

1. RemNote running with the RemNote Automation Bridge plugin installed
2. MCP server available if using `run-integration-test.sh` directly. For the agent wrapper, port `3001` must be free so
   it can start its own repo-local server.
3. Bridge connected to the WebSocket server

If the bridge is connected correctly, the server logs show the plugin connection and RemNote shows the Automation
Bridge as connected.

![MCP server started and bridge connected](../images/integration-testing-01-server-connected.jpg)

## Running The Suites

### Full Suite

```bash
# Manual — prompts once before creating content, then runs direct MCP, MCPB stdio proxy, and bundled CLI suites
./run-integration-test.sh

# Non-interactive — skips confirmation
./run-integration-test.sh --yes

# Agent-assisted preflight — checks port 3001 without building, starting, or stopping anything
./run-agent-integration-test.sh --preflight-only

# Agent-assisted — requires port 3001 to be free, starts its own server, waits for bridge connection, then runs all suites
./run-agent-integration-test.sh
./run-agent-integration-test.sh --yes
```

`npm run test:integration` delegates to `./run-integration-test.sh`, so it also runs all suites by default.

The agent-assisted wrapper does not control existing MCP server processes. Before an AI agent invokes any live
integration command, it must run `./run-agent-integration-test.sh --preflight-only` outside the Codex sandbox. If
anything is listening on the configured HTTP MCP port (`127.0.0.1:3001` by default), including a macOS launchd-managed
`remnote-mcp-server`, the agent must refuse to run tests and report that the existing server needs to be stopped
manually. The wrapper repeats this same port check during real runs and exits with a clear error if the port is
occupied. During cleanup, the wrapper stops only the repo-local server process it started for the current test run.

AI agents must run the agent-assisted wrapper outside the Codex sandbox. The TypeScript runners use `tsx`, which creates
local IPC pipes under macOS temp directories such as `/var/folders/...`; inside the sandbox this can fail before tests
start with `listen EPERM`.

### Targeted Reruns

```bash
# Direct MCP path only
./run-integration-test.sh --suite mcp
./run-agent-integration-test.sh --suite mcp --yes

# Claude Desktop MCPB stdio proxy path only
./run-integration-test.sh --suite mcpb
./run-agent-integration-test.sh --suite mcpb --yes

# Bundled remnote-cli path only
./run-integration-test.sh --suite cli
./run-agent-integration-test.sh --suite cli --yes

# Fast connection check only (no test data creation)
./run-status-check.sh
```

The MCPB suite launches `mcpb/remnote-local/server/index.js` over stdio and points it at the same live MCP server
endpoint via `REMNOTE_MCP_URL`. It runs the RemNote tool workflows through the Claude Desktop-facing proxy path. The
proxy loads the local bearer token from the runtime auth store and never prints it.

The CLI suite uses the same MCP server endpoint as MCP clients. It does not start or require a separate CLI server.
The agent-assisted wrapper is the only approved live-test entrypoint for AI agents; `run-integration-test.sh` and
`npm run test:integration*` are manual/human entrypoints. The agent wrapper times out with a clear message when the
RemNote bridge never connects.
Agent-assisted flow still has one manual gate: the agent should ask the human collaborator to start the bridge first,
and must ask for a bridge restart before reruns if bridge code changed since the current RemNote bridge session
started.

Successful runs print a workflow summary and remind you how to clean up the created artifacts.

![MCP server integration test run summary](../images/integration-testing-02-run-summary.jpg)

## Configuration

| Variable          | Default                 | Purpose                                          |
| ----------------- | ----------------------- | ------------------------------------------------ |
| `REMNOTE_MCP_URL` | `http://127.0.0.1:3001` | MCP server base URL                              |
| `MCP_TEST_DELAY`  | `2000`                  | Delay (ms) after creating notes before searching |

The CLI suite uses the same variables.

## Where To Add New Coverage

If a pull request changes shared external behavior, update both integration surfaces where the feature can be exercised.

- Combined shell entrypoint: [`run-integration-test.sh`](../../run-integration-test.sh)
- Agent-safe shell entrypoint: [`run-agent-integration-test.sh`](../../run-agent-integration-test.sh)
- MCP and MCPB runner: [`test/integration/run-integration.ts`](../../test/integration/run-integration.ts)
- MCP server workflows: [`test/integration/workflows/`](../../test/integration/workflows/)
- CLI runner: [`test/integration/cli/run-integration.ts`](../../test/integration/cli/run-integration.ts)
- CLI workflows: [`test/integration/cli/workflows/`](../../test/integration/cli/workflows/)

The usual rule is simple: if users can reach the new behavior through both MCP tools and `remnote-cli`, both
integration suites should gain coverage.

## What The Suites Test

The direct MCP and MCPB stdio proxy suites follow the same RemNote tool workflow shape:

1. **Status Check** — Verifies the live consumer path is connected to the bridge. If this fails, all subsequent workflows are
   skipped.
2. **Create & Search** — Creates notes and exact-ID tag Rems, waits for RemNote indexing, then
   validates search and tag-search behavior across the supported content modes.
3. **Read & Update** — Reads the created notes, validates dry-run-first writes such as move/document-status updates,
   mutates title/content/tags by exact Rem ID, and re-reads to verify persistence.
4. **Journal** — Appends entries to today's daily document with and without timestamps.
5. **Error Cases** — Sends invalid inputs (nonexistent IDs, missing required fields) and verifies the server handles
   them gracefully.
6. **Read Table** — Reads the standalone Advanced Table fixture by its conventional title and derived Rem ID, then
   validates its numeric column, predefined rows, pagination, filtering, and not-found behavior.
7. **Set Property** — Uses the property-bearing tag fixture to set and verify an `automation-level` value on the run's
   created note.
8. **Managed Media** — Reads image metadata, retrieves MCP-native bytes, rejects a stale ID, and verifies CLI file
   output through the conventionally named managed-media fixture.

The direct MCP suite also verifies required bearer authentication and rejects missing or incorrect tokens.

## Cleanup After A Run

Test content uses `[MCP-TEST]` or `[CLI-TEST]` prefixes plus unique run IDs (ISO timestamps), and note/tree artifacts
are grouped under the shared root-level anchor note `RemNote Automation Bridge [temporary integration test data]`.

To clean up:

- search RemNote for `[MCP-TEST]` and delete the matching note/tree artifacts
- search RemNote for `[CLI-TEST]` and delete the matching CLI-created artifacts
- open Today's Note and remove the matching journal entries

RemNote's bridge plugin does not support deleting notes, so test artifacts persist and must be cleaned up manually.
The shared anchor note is reused across runs. If more than one exact anchor-title match exists, the integration setup
fails early and prints the duplicate `remId`s so you can clean them up first.

## Design Rationale

The integration tests are deliberately separate from the unit test suite. They require external infrastructure (running
server + connected plugin), create real content, and take seconds rather than milliseconds. They run via `tsx` with
custom lightweight assertions rather than Vitest to stay independent from the mocked unit-test environment.

Tag coverage:

- The shared live suites assert readable `tags` on plain `remnote_search` and `remnote_read_note` for notes created with
  exact tag Rem IDs.
- They also verify exact-ID tag add/remove flows through both `remnote_search_by_tag` and direct `remnote_read_note`
  readback.

## Persistent Integration Fixtures

The bridge cannot create table/property schemas or upload managed image files, so each development knowledge base needs
three persistent fixtures. Their exact titles are the configuration: no Rem IDs, test environment variables, or
separate JSON test config are required.

### Setup

The fixtures may share a parent note for convenient maintenance, but the parent title and location are not part of the
contract. Keep exactly one Rem with each required fixture title.

![Persistent integration fixtures with an optional Advanced Table wrapper](../images/integration-testing-05-persistent-fixtures-overview.jpg)

1. Create a tag named `Automation Bridge Test Tag`.
2. Add a text-compatible property named `automation-level` to that tag. The property-write tests use this tag as their
   schema and verify the value through its generated table view.

![Automation Bridge Test Tag with automation-level property](../images/integration-testing-06-test-tag-property.jpg)

3. Create the property-bearing table/tag named `Automation Bridge Advanced Table`.
4. Add a numeric property named `Salary` and at least two named rows with finite numeric `Salary` values. Empty or
   unrelated extra rows are allowed; the tests ignore them while validating the numeric schema, row values, filtering,
   limits, and offsets.

You may optionally create a document named `Automation Bridge Test Advanced Table` to organize or display the table.
That document is only a wrapper: the tests resolve the actual `Automation Bridge Advanced Table` property-bearing Rem
by normalized exact title and never use the wrapper's Rem ID.

![Optional wrapper displaying the required Automation Bridge Advanced Table](../images/integration-testing-07-advanced-table-fixture.jpg)

5. Create a flashcard whose front is the exact plain-text title `Automation Bridge Test Media`.
6. Drag or upload a local PNG, JPEG, GIF, or WebP file into the back of that card. Keep the front text-only so exact-title
   search remains stable, and avoid remote URLs or web-image embeds because they are not RemNote-managed local media.

Before creating temporary test content, every live runner resolves these titles independently and derives the
tag/table/property/media IDs and media field. Missing, duplicated, or malformed fixtures are listed together; only
their dependent workflows are skipped, so unrelated coverage still runs.

### Behavior

The direct MCP and CLI integration suites:

- read `Automation Bridge Advanced Table` by normalized exact title and derived Rem ID, require at least two named rows
  with finite numeric `Salary` values while tolerating unrelated/empty rows, and validate filtering and pagination
- read the exact fixture tag title as a table and derive its Rem ID and `automation-level` property ID
- set a unique text value on the run's created test note through `remnote_set_property` / `remnote-cli set-property`
- read the fixture tag/table again and verify the note row contains the kept value
- search for the exact media fixture title, select its first ordered managed-local image, and verify retrieval through
  MCP, MCPB, and CLI paths

When `--suite all` is used, direct MCP, MCPB, and CLI all run even if an earlier transport fails or skips a fixture-
dependent workflow. The wrapper returns nonzero after all transports finish when any suite is failed or incomplete.

The value is intentionally not cleared, so the resulting test note remains inspectable until the `[MCP-TEST]` or
`[CLI-TEST]` artifact is deleted.

Managed-media roots are independent server runtime configuration. Existing `~/remnote/remnote-*/files` roots are
discovered automatically; custom layouts belong in `[server].mediaRoots` in `~/.remnote-mcp-server/config.toml`.
