import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BRIDGE_ACTION_TO_TOOL,
  McpServerClient,
} from '../../../src/remnote-cli/client/mcp-server-client.js';

const require = createRequire(import.meta.url);
const testDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(testDir, '..', '..', '..');
const cliCommandsDir = join(projectRoot, 'src', 'remnote-cli', 'commands');
const packageJson = require('../../../package.json') as { version: string };
const SAME_LINE_SERVER_VERSION = packageJson.version;
const MISMATCH_SERVER_VERSION = packageJson.version.replace(
  /^(\d+)\.(\d+)\.(\d+)$/,
  (_version, major: string, minor: string) => `${major}.${Number(minor) + 1}.0`
);

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  callTool: vi.fn(),
  close: vi.fn(),
  terminateSession: vi.fn(),
  transportUrl: '',
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(function MockClient() {
    this.connect = mocks.connect;
    this.callTool = mocks.callTool;
    this.close = mocks.close;
  }),
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi
    .fn()
    .mockImplementation(function MockStreamableHTTPClientTransport(url: URL) {
      mocks.transportUrl = url.toString();
      this.terminateSession = mocks.terminateSession;
    }),
}));

describe('McpServerClient', () => {
  beforeEach(() => {
    mocks.connect.mockReset().mockResolvedValue(undefined);
    mocks.callTool.mockReset();
    mocks.close.mockReset().mockResolvedValue(undefined);
    mocks.terminateSession.mockReset().mockResolvedValue(undefined);
    mocks.transportUrl = '';
  });

  it('maps bridge actions to MCP tools and returns structured content', async () => {
    mocks.callTool.mockResolvedValue({
      structuredContent: { remId: 'abc123' },
      content: [{ type: 'text', text: '{"remId":"abc123"}' }],
    });

    const client = new McpServerClient('http://127.0.0.1:3001');
    const result = await client.execute('create_note', { title: 'Test' });

    expect(mocks.transportUrl).toBe('http://127.0.0.1:3001/mcp');
    expect(mocks.callTool).toHaveBeenCalledWith({
      name: 'remnote_create_note',
      arguments: { title: 'Test' },
    });
    expect(result).toEqual({ remId: 'abc123' });
  });

  it.each([
    ['list_children', 'remnote_list_children', { parentRemId: 'parent123' }],
    ['move_note', 'remnote_move_note', { remId: 'rem123', newParentRemId: 'parent123' }],
    [
      'set_document_status',
      'remnote_set_document_status',
      { remId: 'rem123', isDocument: true, dryRun: true },
    ],
  ])('maps %s bridge action to %s', async (action, toolName, payload) => {
    mocks.callTool.mockResolvedValue({
      structuredContent: { ok: true },
      content: [{ type: 'text', text: '{"ok":true}' }],
    });

    const client = new McpServerClient('http://127.0.0.1:3001');
    await client.execute(action, payload);

    expect(mocks.callTool).toHaveBeenCalledWith({
      name: toolName,
      arguments: payload,
    });
  });

  it('maps every bridge action used by CLI commands to an MCP tool', async () => {
    const actionPattern = /\.execute\(\s*['"]([^'"]+)['"]/g;
    const actions = new Set<string>();

    for (const file of await readdir(cliCommandsDir)) {
      if (!file.endsWith('.ts')) continue;
      const source = await readFile(join(cliCommandsDir, file), 'utf8');
      for (const match of source.matchAll(actionPattern)) {
        actions.add(match[1]);
      }
    }

    expect(actions.size).toBeGreaterThan(0);
    expect([...actions].filter((action) => !(action in BRIDGE_ACTION_TO_TOOL)).sort()).toEqual([]);
  });

  it('normalizes an already-suffixed MCP URL with a trailing slash', async () => {
    mocks.callTool.mockResolvedValue({
      structuredContent: { connected: true },
      content: [{ type: 'text', text: '{"connected":true}' }],
    });

    const client = new McpServerClient('http://127.0.0.1:3001/mcp/');
    await client.execute('get_status', {});

    expect(mocks.transportUrl).toBe('http://127.0.0.1:3001/mcp');
  });

  it('parses JSON text content when structured content is absent', async () => {
    mocks.callTool.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: `{"connected":true,"serverVersion":"${SAME_LINE_SERVER_VERSION}"}`,
        },
      ],
    });

    const client = new McpServerClient('http://127.0.0.1:3001/mcp');
    await expect(client.execute('get_status', {})).resolves.toEqual({
      connected: true,
      serverVersion: SAME_LINE_SERVER_VERSION,
      cliVersion: packageJson.version,
    });
  });

  it('preserves MCP-native image content for get_media', async () => {
    mocks.callTool.mockResolvedValue({
      structuredContent: { mediaId: 'media_1234', sizeBytes: 8 },
      content: [
        { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
        { type: 'text', text: '{"mediaId":"media_1234","sizeBytes":8}' },
      ],
    });

    const client = new McpServerClient('http://127.0.0.1:3001');
    await expect(client.execute('get_media', { mediaId: 'media_1234' })).resolves.toEqual({
      mediaId: 'media_1234',
      sizeBytes: 8,
      data: 'iVBORw0KGgo=',
      mimeType: 'image/png',
    });
  });

  it('rejects get_media responses without MCP-native image content', async () => {
    mocks.callTool.mockResolvedValue({
      structuredContent: { mediaId: 'media_1234', sizeBytes: 8 },
      content: [{ type: 'text', text: '{"mediaId":"media_1234","sizeBytes":8}' }],
    });

    const client = new McpServerClient('http://127.0.0.1:3001');
    await expect(client.execute('get_media', { mediaId: 'media_1234' })).rejects.toThrow(
      'without MCP-native image content'
    );
  });

  it('adds a status warning when CLI and MCP server versions mismatch', async () => {
    mocks.callTool.mockResolvedValue({
      structuredContent: { connected: true, serverVersion: MISMATCH_SERVER_VERSION },
      content: [
        { type: 'text', text: `{"connected":true,"serverVersion":"${MISMATCH_SERVER_VERSION}"}` },
      ],
    });

    const client = new McpServerClient('http://127.0.0.1:3001/mcp');
    await expect(client.execute('get_status', {})).resolves.toMatchObject({
      connected: true,
      serverVersion: MISMATCH_SERVER_VERSION,
      cliVersion: packageJson.version,
      version_warning: expect.stringContaining(`MCP server v${MISMATCH_SERVER_VERSION}`),
    });
  });

  it('throws MCP tool error text', async () => {
    mocks.callTool.mockResolvedValue({
      isError: true,
      content: [{ type: 'text', text: 'Bridge not connected' }],
    });

    const client = new McpServerClient('http://127.0.0.1:3001/mcp');
    await expect(client.execute('search', { query: 'x' })).rejects.toThrow('Bridge not connected');
  });

  it('wraps connection failures with MCP server context', async () => {
    mocks.connect.mockRejectedValue(new Error('fetch failed'));

    const client = new McpServerClient('http://127.0.0.1:3001/mcp');
    await expect(client.execute('search', { query: 'x' })).rejects.toThrow(
      'Cannot connect to MCP server at http://127.0.0.1:3001/mcp'
    );
  });

  it('rejects unknown bridge actions before connecting', async () => {
    const client = new McpServerClient('http://127.0.0.1:3001/mcp');

    await expect(client.execute('unknown_action', {})).rejects.toThrow(
      'Unknown bridge action: unknown_action'
    );
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('closes the MCP session and client best-effort', async () => {
    mocks.callTool.mockResolvedValue({
      structuredContent: { ok: true },
      content: [{ type: 'text', text: '{"ok":true}' }],
    });

    const client = new McpServerClient('http://127.0.0.1:3001/mcp');
    await client.execute('search', { query: 'x' });
    await client.close();

    expect(mocks.terminateSession).toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalled();
  });
});
