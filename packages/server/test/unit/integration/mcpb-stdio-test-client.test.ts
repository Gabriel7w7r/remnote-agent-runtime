import { beforeEach, describe, expect, it, vi } from 'vitest';
import { McpbStdioTestClient } from '../../../test/integration/mcpb-stdio-test-client.js';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  callTool: vi.fn(),
  closeClient: vi.fn(),
  closeTransport: vi.fn(),
  transportParams: null as Record<string, unknown> | null,
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(function MockClient() {
    this.connect = mocks.connect;
    this.callTool = mocks.callTool;
    this.close = mocks.closeClient;
  }),
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn().mockImplementation(function MockStdioClientTransport(params) {
    mocks.transportParams = params;
    this.close = mocks.closeTransport;
  }),
}));

describe('McpbStdioTestClient', () => {
  beforeEach(() => {
    mocks.connect.mockReset().mockResolvedValue(undefined);
    mocks.callTool.mockReset();
    mocks.closeClient.mockReset().mockResolvedValue(undefined);
    mocks.closeTransport.mockReset().mockResolvedValue(undefined);
    mocks.transportParams = null;
  });

  it('starts the MCPB stdio proxy with REMNOTE_MCP_URL', async () => {
    const client = new McpbStdioTestClient();

    await client.connect('http://127.0.0.1:4555');

    expect(mocks.transportParams).toMatchObject({
      command: 'node',
      args: ['mcpb/remnote-local/server/index.js'],
      cwd: process.cwd(),
      stderr: 'pipe',
      env: expect.objectContaining({
        REMNOTE_MCP_URL: 'http://127.0.0.1:4555/mcp',
      }),
    });
  });

  it('returns structured content from proxied tool calls', async () => {
    mocks.callTool.mockResolvedValue({
      structuredContent: { connected: true },
      content: [{ type: 'text', text: '{"connected":true}' }],
    });
    const client = new McpbStdioTestClient();
    await client.connect('http://127.0.0.1:4555/mcp');

    await expect(client.callTool('remnote_status')).resolves.toEqual({ connected: true });
    expect(mocks.callTool).toHaveBeenCalledWith({
      name: 'remnote_status',
      arguments: {},
    });
  });

  it('throws ToolError when proxied tool calls return MCP errors', async () => {
    mocks.callTool.mockResolvedValue({
      isError: true,
      content: [{ type: 'text', text: 'Bridge not connected' }],
    });
    const client = new McpbStdioTestClient();
    await client.connect('http://127.0.0.1:4555/mcp');

    await expect(client.callTool('remnote_status')).rejects.toThrow('Bridge not connected');
  });
});
