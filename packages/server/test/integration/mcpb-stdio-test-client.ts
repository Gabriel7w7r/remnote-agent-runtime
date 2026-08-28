/**
 * MCP integration test client that reaches RemNote through the MCPB stdio proxy.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  ToolError,
  type IntegrationTestClient,
  type IntegrationToolResult,
} from './mcp-test-client.js';

export class McpbStdioTestClient implements IntegrationTestClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;

  async connect(baseUrl: string): Promise<void> {
    const mcpUrl = baseUrl.endsWith('/mcp') ? baseUrl : `${baseUrl}/mcp`;
    this.transport = new StdioClientTransport({
      command: 'node',
      args: ['mcpb/remnote-local/server/index.js'],
      cwd: process.cwd(),
      env: {
        ...stringEnv(process.env),
        REMNOTE_MCP_URL: mcpUrl,
      },
      stderr: 'pipe',
    });
    this.client = new Client({ name: 'mcpb-stdio-integration-test', version: '1.0.0' });
    await this.client.connect(this.transport);
  }

  async callTool(
    name: string,
    args: Record<string, unknown> = {}
  ): Promise<Record<string, unknown>> {
    if (!this.client) {
      throw new Error('McpbStdioTestClient: not connected. Call connect() first.');
    }

    const result = await this.callToolRaw(name, args);
    if (result.isError) {
      const text = this.extractText(result);
      throw new ToolError(`Tool "${name}" returned error: ${text}`, text);
    }

    return this.parseResult(result);
  }

  async callToolRaw(
    name: string,
    args: Record<string, unknown> = {}
  ): Promise<IntegrationToolResult> {
    if (!this.client) {
      throw new Error('McpbStdioTestClient: not connected. Call connect() first.');
    }
    return (await this.client.callTool({ name, arguments: args })) as IntegrationToolResult;
  }

  async callToolExpectError(name: string, args: Record<string, unknown> = {}): Promise<string> {
    if (!this.client) {
      throw new Error('McpbStdioTestClient: not connected. Call connect() first.');
    }

    const result = await this.client.callTool({ name, arguments: args });
    if (result.isError) {
      return this.extractText(result);
    }

    const text = this.extractText(result);
    try {
      const parsed = JSON.parse(text) as { error?: unknown };
      if (parsed.error) {
        return String(parsed.error);
      }
    } catch {
      // Not JSON; return raw text.
    }

    return text;
  }

  async close(): Promise<void> {
    try {
      if (this.transport) {
        await this.transport.close();
      }
    } catch {
      // Ignore cleanup errors.
    }
    try {
      if (this.client) {
        await this.client.close();
      }
    } catch {
      // Ignore cleanup errors.
    }
    this.transport = null;
    this.client = null;
  }

  private extractText(result: IntegrationToolResult): string {
    const text = result.content?.find((item) => item.type === 'text' && item.text)?.text;
    if (text) return text;
    return JSON.stringify(result);
  }

  private parseResult(result: IntegrationToolResult): Record<string, unknown> {
    if (
      result.structuredContent &&
      typeof result.structuredContent === 'object' &&
      !Array.isArray(result.structuredContent)
    ) {
      return result.structuredContent;
    }

    const text = this.extractText(result);
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { _raw: text };
    }
  }
}

function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
}
