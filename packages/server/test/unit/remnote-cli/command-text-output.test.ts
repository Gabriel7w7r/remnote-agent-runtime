import { describe, expect, it, vi, type MockInstance } from 'vitest';
import { McpServerClient } from '../../../src/remnote-cli/client/mcp-server-client.js';
import { createProgram } from '../../../src/remnote-cli/cli.js';

async function runTextCommand(
  args: string[],
  result: unknown
): Promise<{ output: string; executeSpy: MockInstance }> {
  const executeSpy = vi.spyOn(McpServerClient.prototype, 'execute').mockResolvedValue(result);
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const program = createProgram('0.1.0-test');

  try {
    await program.parseAsync(['node', 'remnote-cli', '--text', ...args], { from: 'node' });
    const output = String(logSpy.mock.calls.at(-1)?.[0] ?? '');
    return { output, executeSpy };
  } finally {
    logSpy.mockRestore();
    errSpy.mockRestore();
  }
}

describe('command text output', () => {
  const TEST_PLUGIN_VERSION = '1.2.3';
  const TEST_CLI_VERSION = '1.2.3-test';

  it('formats create results with created Rem IDs', async () => {
    const { output, executeSpy } = await runTextCommand(['create', 'Inbox'], {
      remIds: ['rem-1', 'rem-2'],
      titles: ['Inbox', ''],
    });

    expect(output).toContain('Created: Inbox (ID: rem-1)');
    expect(output).toContain('Created: (untitled) (ID: rem-2)');
    executeSpy.mockRestore();
  });

  it('formats empty create results', async () => {
    const { output, executeSpy } = await runTextCommand(['create', 'Inbox'], { remIds: [] });

    expect(output).toBe('No Rems created.');
    executeSpy.mockRestore();
  });

  it('formats update results with and without created Rems', async () => {
    const withRems = await runTextCommand(
      ['insert-children', 'rem-1', '--content', 'Body', '--position', 'last'],
      {
        remIds: ['child-1'],
        titles: ['Child'],
      }
    );
    expect(withRems.output).toBe('Updated/Created: Child (ID: child-1)');
    withRems.executeSpy.mockRestore();

    const withoutRems = await runTextCommand(['update', 'rem-1', '--title', 'Renamed'], {
      remIds: [],
    });
    expect(withoutRems.output).toBe('Updated note rem-1 (no Rems created)');
    withoutRems.executeSpy.mockRestore();
  });

  it('formats split write results with created Rems', async () => {
    const insertResult = await runTextCommand(
      ['insert-children', 'rem-1', '--content', 'Body', '--position', 'first'],
      {
        remIds: ['child-1'],
        titles: ['Child'],
      }
    );
    expect(insertResult.output).toBe('Updated/Created: Child (ID: child-1)');
    insertResult.executeSpy.mockRestore();

    const replaceResult = await runTextCommand(['replace-children', 'rem-1', '--content', 'Body'], {
      remIds: ['child-1'],
      titles: ['Child'],
    });
    expect(replaceResult.output).toBe('Updated/Created: Child (ID: child-1)');
    replaceResult.executeSpy.mockRestore();

    const tagResult = await runTextCommand(['update-tags', 'rem-1', '--add-tag-ids', 'tag-1'], {
      remIds: ['rem-1'],
      titles: [''],
    });
    expect(tagResult.output).toBe('Updated/Created: (untitled) (ID: rem-1)');
    tagResult.executeSpy.mockRestore();
  });

  it('formats document-status results', async () => {
    const { output, executeSpy } = await runTextCommand(
      ['set-document-status', 'rem-1', '--document'],
      {
        remId: 'rem-1',
        title: 'Project Plan',
        oldRemType: 'concept',
        newRemType: 'document',
        newIsDocument: true,
        dryRun: true,
        changed: false,
      }
    );

    expect(output).toBe(
      'Dry-run document status: Project Plan (rem-1) concept -> document; isDocument=true'
    );
    executeSpy.mockRestore();
  });

  it('formats applied document-status results', async () => {
    const updated = await runTextCommand(
      ['set-document-status', 'rem-1', '--document', '--apply'],
      {
        remId: 'rem-1',
        title: 'Project Plan',
        oldRemType: 'text',
        newRemType: 'document',
        newIsDocument: true,
        dryRun: false,
        changed: true,
      }
    );
    expect(updated.output).toBe(
      'Updated document status: Project Plan (rem-1) text -> document; isDocument=true'
    );
    updated.executeSpy.mockRestore();

    const unchanged = await runTextCommand(
      ['set-document-status', 'rem-1', '--document', '--apply'],
      {
        remId: 'rem-1',
        title: 'Project Plan',
        oldRemType: 'document',
        newRemType: 'document',
        newIsDocument: true,
        dryRun: false,
        changed: false,
      }
    );
    expect(unchanged.output).toBe(
      'Document status unchanged: Project Plan (rem-1) document -> document; isDocument=true'
    );
    unchanged.executeSpy.mockRestore();
  });

  it('formats journal results with and without created Rems', async () => {
    const withRems = await runTextCommand(['journal', 'Entry'], {
      remIds: ['journal-1'],
      titles: ['Daily note'],
    });
    expect(withRems.output).toBe('Journal entry added: Daily note (ID: journal-1)');
    withRems.executeSpy.mockRestore();

    const withoutRems = await runTextCommand(['journal', 'Entry'], { remIds: [] });
    expect(withoutRems.output).toBe('No journal entry Rems created.');
    withoutRems.executeSpy.mockRestore();
  });

  it('formats status results with optional metadata', async () => {
    const { output, executeSpy } = await runTextCommand(['status'], {
      connected: true,
      pluginVersion: TEST_PLUGIN_VERSION,
      cliVersion: TEST_CLI_VERSION,
      version_warning: 'minor versions differ',
    });

    expect(output).toContain(`Bridge: Connected (plugin v${TEST_PLUGIN_VERSION})`);
    expect(output).toContain(`CLI: v${TEST_CLI_VERSION}`);
    expect(output).toContain('WARNING: minor versions differ');
    executeSpy.mockRestore();
  });

  it('formats table results with columns and rows', async () => {
    const { output, executeSpy } = await runTextCommand(['read-table', '--title', 'Projects'], {
      tableName: 'Projects',
      tableId: 'table-1',
      columns: [
        { name: 'Status', type: 'text', propertyId: 'status' },
        { name: 'Priority', type: 'number', propertyId: 'priority' },
      ],
      rowsReturned: 1,
      totalRows: 3,
      rows: [{ name: 'Launch', values: { status: 'Active', priority: '1' } }],
    });

    expect(output).toContain('Table: Projects [table-1]');
    expect(output).toContain('Columns: Status (text), Priority (number)');
    expect(output).toContain('Rows: 1/3');
    expect(output).toContain('Name | Status | Priority');
    expect(output).toContain('Launch | Active | 1');
    executeSpy.mockRestore();
  });

  it('formats search results with aliases and parent title without parent ID', async () => {
    const { output, executeSpy } = await runTextCommand(['search', 'plan'], {
      results: [
        {
          remId: 'rem-1',
          title: 'Plan',
          remType: 'concept',
          aliases: ['Strategy', 'Roadmap'],
          parentTitle: 'Workspace',
        },
      ],
    });

    expect(output).toBe('1. [concept] Plan (aka: Strategy, Roadmap) <- Workspace [rem-1]');
    executeSpy.mockRestore();
  });

  it('formats search paging metadata in text output', async () => {
    const { output, executeSpy } = await runTextCommand(['search', 'plan'], {
      results: [
        {
          remId: 'rem-1',
          title: 'Plan',
          remType: 'text',
        },
      ],
      hasMore: true,
      nextCursor: 'search:v1:id:1:hash',
      truncated: true,
      truncationReason: 'cursor_snapshot_limit',
    });

    expect(output).toContain('1. Plan [rem-1]');
    expect(output).toContain('Next cursor: search:v1:id:1:hash');
    expect(output).toContain('Results truncated: cursor_snapshot_limit');
    executeSpy.mockRestore();
  });
});
