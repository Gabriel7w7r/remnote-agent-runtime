#!/usr/bin/env node

import process from 'node:process';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { FALLBACK_TOOLS } from './fallback-tools.generated.js';

export { FALLBACK_TOOLS } from './fallback-tools.generated.js';

export const DEFAULT_MCP_URL = 'http://127.0.0.1:3001/mcp';
const require = createRequire(import.meta.url);
const packageJson = require('../package.json');
export const SERVER_INFO = { name: 'remnote-mcp-stdio', version: packageJson.version };

export function normalizeMcpUrl(value) {
  const trimmed = String(value || DEFAULT_MCP_URL)
    .trim()
    .replace(/\/+$/, '');
  if (trimmed.endsWith('/mcp')) {
    return trimmed;
  }
  return `${trimmed}/mcp`;
}

export function loadHttpToken(env = process.env, homeDir = homedir()) {
  if (
    typeof env.REMNOTE_AGENT_HTTP_TOKEN === 'string' &&
    env.REMNOTE_AGENT_HTTP_TOKEN.length >= 32
  ) {
    return env.REMNOTE_AGENT_HTTP_TOKEN;
  }

  const stateDir = env.REMNOTE_AGENT_STATE_DIR || join(homeDir, '.remnote-agent');
  try {
    const state = JSON.parse(readFileSync(join(stateDir, 'auth.json'), 'utf8'));
    return typeof state.httpToken === 'string' && state.httpToken.length >= 32
      ? state.httpToken
      : undefined;
  } catch {
    return undefined;
  }
}

export function createSdkHttpClient(mcpUrl, clientInfo = SERVER_INFO, httpToken = loadHttpToken()) {
  const requestInit = httpToken ? { headers: { Authorization: `Bearer ${httpToken}` } } : undefined;
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit });
  const client = new Client(clientInfo);
  return { client, transport };
}

export class RemNoteLocalProxy {
  constructor(options = {}) {
    this.mcpUrl = normalizeMcpUrl(options.mcpUrl ?? process.env.REMNOTE_MCP_URL);
    this.createClient = options.createClient ?? createSdkHttpClient;
  }

  async listTools() {
    try {
      return await this.withClient((client) => client.listTools());
    } catch {
      return { tools: FALLBACK_TOOLS };
    }
  }

  async callTool(params) {
    try {
      return await this.withClient((client) => client.callTool(params));
    } catch (error) {
      return {
        isError: true,
        content: [{ type: 'text', text: this.formatConnectionError(error) }],
      };
    }
  }

  registerHandlers(server) {
    server.setRequestHandler(ListToolsRequestSchema, async () => this.listTools());
    server.setRequestHandler(CallToolRequestSchema, async (request) =>
      this.callTool({
        name: request.params.name,
        arguments: request.params.arguments ?? {},
      })
    );
  }

  async withClient(operation) {
    const { client, transport } = this.createClient(this.mcpUrl, SERVER_INFO);

    try {
      await client.connect(transport);
      return await operation(client);
    } finally {
      await closeBestEffort(transport, client);
    }
  }

  formatConnectionError(error) {
    const detail = error instanceof Error ? error.message : String(error);
    return [
      `Cannot connect to local RemNote MCP Server at ${this.mcpUrl}.`,
      'Start remnote-mcp-server, open RemNote, and ensure the Automation Bridge plugin is connected.',
      `Details: ${detail}`,
    ].join(' ');
  }
}

export function createStdioServer(options = {}) {
  const server = new Server(SERVER_INFO, { capabilities: { tools: {} } });
  const proxy = new RemNoteLocalProxy(options);
  proxy.registerHandlers(server);
  return server;
}

export async function run() {
  const server = createStdioServer();
  await server.connect(new StdioServerTransport());
}

export function formatUsage() {
  return [
    'remnote-mcp-stdio - stdio MCP proxy for a local RemNote MCP Server',
    '',
    'Usage:',
    '  remnote-mcp-stdio              Run stdio MCP transport for an MCP client',
    '  remnote-mcp-stdio --help, -h   Print this help',
    '  remnote-mcp-stdio --version, -V  Print version',
    '',
    'This command is normally launched by a stdio MCP client.',
    'Start remnote-mcp-server separately first, then let the RemNote Automation Bridge connect to it.',
    `Default target: ${DEFAULT_MCP_URL}`,
    '',
    'Environment:',
    '  REMNOTE_MCP_URL  Override the local MCP endpoint',
    '  REMNOTE_AGENT_HTTP_TOKEN  Override the local bearer token',
    '  REMNOTE_AGENT_STATE_DIR   Override the local authentication state directory',
  ].join('\n');
}

export function handleUtilityCommand(argv = process.argv) {
  if (argv.includes('--version') || argv.includes('-V') || argv.includes('-v')) {
    process.stdout.write(`${SERVER_INFO.version}\n`);
    return true;
  }

  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${formatUsage()}\n`);
    return true;
  }

  return false;
}

export function isInteractiveTerminalInvocation(
  argv = process.argv,
  stdin = process.stdin,
  stdout = process.stdout
) {
  return argv.length <= 2 && Boolean(stdin.isTTY) && Boolean(stdout.isTTY);
}

export function isMainModule(argv = process.argv, moduleUrl = import.meta.url) {
  if (!argv[1]) {
    return false;
  }

  try {
    return realpathSync(argv[1]) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return pathToFileURL(argv[1]).href === moduleUrl;
  }
}

async function closeBestEffort(transport, client) {
  try {
    if (typeof transport.terminateSession === 'function') {
      await transport.terminateSession();
    }
  } catch {
    // Best-effort cleanup: the proxy process can continue serving future calls.
  }

  try {
    await client.close();
  } catch {
    // Best-effort cleanup: failed closes should not mask the original operation result.
  }
}

if (isMainModule()) {
  if (handleUtilityCommand()) {
    process.exit(0);
  }

  if (isInteractiveTerminalInvocation()) {
    process.stderr.write(`${formatUsage()}\n`);
    process.exit(1);
  }

  run().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
