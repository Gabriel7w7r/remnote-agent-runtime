import { describe, it, expect, vi } from 'vitest';
import { McpServerClient } from '../../../src/remnote-cli/client/mcp-server-client.js';
import { createProgram } from '../../../src/remnote-cli/cli.js';

describe('status command', () => {
  it('uses get_status bridge action', async () => {
    const executeSpy = vi
      .spyOn(McpServerClient.prototype, 'execute')
      .mockResolvedValue({ connected: true, pluginVersion: '0.0.0-test' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const program = createProgram('0.1.0-test');

    await program.parseAsync(['node', 'remnote-cli', 'status'], { from: 'node' });

    expect(executeSpy).toHaveBeenCalledWith('get_status', {});
    executeSpy.mockRestore();
    logSpy.mockRestore();
  });
});
