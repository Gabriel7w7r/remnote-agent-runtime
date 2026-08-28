# Demo

Visual demonstrations of the RemNote MCP Server with different AI clients.

This page shows short visual demos of simple RemNote MCP workflows: status checks, search, read, synthesis, and
journal writes. For longer multi-step workflows such as knowledge-base discovery, tag design, reviewed tag writes, and
audit loops, see [Advanced Use Cases](advanced-use-cases.md).

## ChatGPT

Web-based integration using ChatGPT Apps with a custom MCP server.

**Setup:** [ChatGPT Configuration Guide](guides/configuration-chatgpt.md)

### 1) MCP status preflight

![ChatGPT MCP Status Check](images/remnote-mcp-server-demo-chatgpt-status-check.jpg)

ChatGPT calls `remnote_status` and reports connection, version alignment, and write/replace policy flags.

### 2) Notes-only synthesis

![ChatGPT Notes Summary](images/remnote-mcp-server-demo-chatgpt-notes-summary.jpg)

ChatGPT summarizes circadian-rhythm notes using MCP-retrieved RemNote content (notes-first synthesis).

### 3) Follow-up contradiction request

![ChatGPT Follow-up Diff Request](images/remnote-mcp-server-demo-chatgpt-followup-diff-request.jpg)

The user asks for a short comparison of notes vs. current internet knowledge, focused on differences/contradictions.

### 4) Notes vs internet diff output

![ChatGPT Notes vs Internet Diff](images/remnote-mcp-server-demo-chatgpt-notes-vs-internet-diff.jpg)

ChatGPT returns a concise mismatch list, preserving note-grounded context while highlighting conflicts.

PS: I first treated the "take melatonin ~7 hours before sleep" claim as a model error/hallucination. In the next
answer, ChatGPT quoted my actual note and context ("Take melatonin 9 hours after wake and 7 before sleep, eg 5 PM" for
delayed phase sleep disorder), so this was still a distortion, but not fully made up.

## Claude Desktop / Cowork

Cloud-based integration through Anthropic's remote connector interface in Claude Desktop or Cowork.

**Setup:** [Claude Desktop / Cowork Configuration Guide](guides/configuration-claude-desktop-cowork.md) | [Remote Access Guide](guides/remote-access.md)

### Connection Status Check

![RemNote MCP Server Status (Claude Cowork)](images/remnote-mcp-server-demo-claude-cowork1.jpg)

Checking RemNote Bridge connection status, displaying plugin version (0.4.1) and available features (search, create,
read, update, journal append).

### Knowledge Base Search

![RemNote Search (Claude Cowork)](images/remnote-mcp-server-demo-claude-cowork2.jpg)

Searching RemNote knowledge base for "blue light & sleep" with AI-generated summary. The RemNote Automation Bridge
plugin panel (right side) shows connection statistics and recent actions.

### Claude Desktop Search View

![RemNote Search (Claude Desktop / Cowork)](images/remnote-mcp-server-demo-claude-desktop-cowork-search.jpg)

Claude Desktop using the same remote connector to search RemNote for "blue light & sleep", returning the matching
notes and their key context directly in chat.

## Claude Desktop / Cowork Local MCPB

Local Claude Desktop or Claude Cowork integration using the bundled **RemNote Local** MCPB extension. This path uses a
local stdio extension and does not require exposing `remnote-mcp-server` over public HTTPS.

**Setup:** [Claude Desktop / Cowork Local MCPB Configuration Guide](guides/configuration-claude-desktop-local-mcpb.md)

![Claude Desktop search using RemNote Local MCPB](images/remnote-claude-desktop-mcpb-search-result.jpg)

The screenshot shows Claude Desktop loading tools from the RemNote Local extension and searching the local RemNote
knowledge base for "AI assisted coding".

## Accomplish

Task-based interface using [Accomplish (formerly Openwork)](https://github.com/accomplish-ai/accomplish) with [OpenAI's
GPT 5.2 model](https://openai.com/).

**Setup:** [Accomplish Configuration Guide](guides/configuration-accomplish.md)

![RemNote Search via Accomplish (GPT 5.2)](images/remnote-mcp-server-demo-accomplish-with-gpt52.jpg)

The screenshot shows Accomplish querying RemNote about "diffusion of innovations" through the local MCP server. The
interface displays multiple MCP tool calls (`remnote_search` and `remnote_read_note`) with an AI-synthesized summary
of findings from the knowledge base.

## Claude Code CLI 

Local CLI-based integration showing search and connection logs.

**Setup:** [Claude Code CLI Configuration Guide](guides/configuration-claude-code-CLI.md)

![RemNote MCP Server Demo (Claude Code CLI)](images/remnote-mcp-server-demo-claude-code-CLI.jpg)

The screenshot shows Claude Code CLI searching RemNote for "AI assisted coding" through the terminal, with RemNote Bridge
connection logs visible in the background.

## Codex

Codex TUI and Codex.app can use the local RemNote MCP server through Streamable HTTP, through the `remnote-mcp-stdio`
proxy, or through `remnote-cli` with the bundled [RemNote skill](../skills/remnote/SKILL.md).

**Setup:** [Codex Configuration Guide](guides/configuration-codex.md)

![RemNote MCP search from Codex TUI](images/remnote-codex-tui-mcp-search.jpg)

The screenshot shows Codex TUI using the native MCP tools to load the RemNote playbook and search RemNote for "AI
assisted coding", then summarizing the top matches from the knowledge base.

## remnote-cli

Local command-line and coding-harness workflows using the `remnote-cli` executable bundled with this package.

### Use RemNote from Any Coding Harness

Any local coding harness that can run shell commands can use `remnote-cli`. The only server component is
`remnote-mcp-server`, which is shared with MCP clients.

Before you start:

1. Install `remnote-mcp-server` globally.
2. Start the MCP server: `remnote-mcp-server`.
3. Open RemNote and wait for the bridge to connect.
4. Verify: `remnote-cli status --text`.

Example prompt:

```text
read https://github.com/robert7/remnote-mcp-server/blob/main/skills/remnote/SKILL.md

check remnote status using remnote CLI
search remnote for "AI assisted coding"
```

#### Claude Code

![remnote-cli from Claude Code](images/remnote-cli-coding-harness-claude-code.jpg)

Claude Code fetches [SKILL.md](../skills/remnote/SKILL.md), verifies MCP-server-backed bridge status, then searches RemNote.

#### GitHub Copilot CLI

![remnote-cli from GitHub Copilot CLI](images/remnote-cli-coding-harness-copilot-cli.jpg)

The same prompt works in GitHub Copilot CLI and other local harnesses that can read URLs and run shell commands.

### Example of OpenClaw Chat Workflow with `remnote-cli`

![remnote-cli with OpenClaw](images/remnote-cli-openclaw-1.jpg)

This screenshot shows [OpenClaw](https://github.com/openclaw/openclaw) driving `remnote-cli` from a WhatsApp chat: it
checks bridge connectivity, searches for "blue light", returns matching note IDs, and then attempts a `read`-based
summary.

#### OpenClaw YouTube Summary Saved to RemNote Journal

![OpenClaw creating a YouTube summary and saving it to RemNote journal](images/remnote-cli-demo-journal-summary.jpg)

This screenshot shows OpenClaw creating a YouTube video summary and storing it as a RemNote journal entry.

Command:

```bash
remnote-cli journal --content-file summarize-output-n1e9-med.md --no-timestamp
```

### CLI Status and Search

![remnote-cli demo](images/remnote-cli-demo-1.jpg)

A typical local flow is:

1. Start `remnote-mcp-server`.
2. Run `remnote-cli status --text`.
3. Run `remnote-cli search "AI"`.

What this demonstrates:

- The CLI is a short-lived MCP client.
- JSON-first output is useful for automation and agent workflows.
- `status` and `status --text` are quick diagnostics when search/create calls fail.
