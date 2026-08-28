import process from 'node:process';
import { URL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const mcpUrl = process.env.MCP_URL;
if (!mcpUrl) {
  process.stderr.write('Status check failed: MCP_URL is not set\n');
  process.exit(1);
}

const transport = new StreamableHTTPClientTransport(new URL(mcpUrl));
const client = new Client({ name: 'run-status-check', version: '1.0.0' });

try {
  await client.connect(transport);
  const result = await client.callTool({ name: 'remnote_status', arguments: {} });

  if (result.isError) {
    const text =
      Array.isArray(result.content) && result.content[0]?.type === 'text'
        ? (result.content[0].text ?? JSON.stringify(result))
        : JSON.stringify(result);
    process.stderr.write(`Status check failed: ${text}\n`);
    process.exit(1);
  }

  const text =
    Array.isArray(result.content) && result.content[0]?.type === 'text'
      ? (result.content[0].text ?? '{}')
      : JSON.stringify(result);

  try {
    const parsed = JSON.parse(text);
    process.stdout.write(`${JSON.stringify(parsed, null, 2)}\n`);
  } catch {
    process.stdout.write(`${text}\n`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Status check failed: ${message}\n`);
  process.exit(1);
} finally {
  try {
    await transport.terminateSession();
  } catch {
    // Ignore cleanup errors
  }
  try {
    await client.close();
  } catch {
    // Ignore cleanup errors
  }
}
