import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('build-mcpb script', () => {
  it('creates a MCPB zip archive with the extension payload', async () => {
    await execFileAsync('node', ['scripts/build-mcpb.mjs']);

    const archive = await readFile('mcpb/remnote-local/remnote-local.mcpb');

    expect(archive.subarray(0, 4).toString('hex')).toBe('504b0304');
    expect(archive.includes(Buffer.from('manifest.json'))).toBe(true);
    expect(archive.includes(Buffer.from('server/index.js'))).toBe(true);
    expect(
      archive.includes(Buffer.from('node_modules/@modelcontextprotocol/sdk/package.json'))
    ).toBe(true);
  }, 15000);
});
