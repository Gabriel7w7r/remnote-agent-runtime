/**
 * Workflow 04: Journal
 *
 * Appends entries to today's daily document with and without timestamps.
 */

import { assertTruthy, assertHasField, assertIsArray, assertContains } from '../assertions.js';
import { assertInlineRefTarget } from '../reference-assertions.js';
import type { WorkflowContext, WorkflowResult, SharedState, StepResult } from '../types.js';

async function assertJournalReadback(
  ctx: WorkflowContext,
  remId: string,
  expectedFragments: string[],
  label: string
): Promise<void> {
  const reread = (await ctx.client.callTool('remnote_read_note', {
    remId,
    depth: 4,
    contentMode: 'markdown',
  })) as Record<string, unknown>;
  const combined = [reread.title, reread.content]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('\n');

  for (const fragment of expectedFragments) {
    assertContains(combined, fragment, `${label} should include ${fragment}`);
  }
}

async function assertJournalInlineRef(
  ctx: WorkflowContext,
  remId: string,
  targetRemId: string,
  label: string
): Promise<void> {
  const reread = await ctx.client.callTool('remnote_read_note', {
    remId,
    depth: 4,
    contentMode: 'structured',
    view: 'full',
  });
  assertInlineRefTarget(reread, targetRemId, label);
}

export async function journalWorkflow(
  ctx: WorkflowContext,
  state: SharedState
): Promise<WorkflowResult> {
  const steps: StepResult[] = [];

  // Step 1: Append with timestamp (default)
  {
    const start = Date.now();
    try {
      const expectedEntry = `[MCP-TEST] Journal entry ${ctx.runId}`;
      const result = (await ctx.client.callTool('remnote_append_journal', {
        content: expectedEntry,
      })) as { remIds: string[] };
      assertHasField(result, 'remIds', 'journal append with timestamp');
      assertIsArray(result.remIds, 'remIds should be an array');
      assertTruthy(result.remIds.length > 0, 'journal append with timestamp should create rems');
      await assertJournalReadback(
        ctx,
        result.remIds[0] as string,
        [expectedEntry],
        'timestamped journal entry'
      );
      steps.push({ label: 'Append with timestamp', passed: true, durationMs: Date.now() - start });
    } catch (e) {
      steps.push({
        label: 'Append with timestamp',
        passed: false,
        durationMs: Date.now() - start,
        error: (e as Error).message,
      });
    }
  }

  // Step 2: Append without timestamp
  {
    const start = Date.now();
    try {
      const expectedEntry = `[MCP-TEST] No-timestamp entry ${ctx.runId}`;
      const targetRemId = state.integrationParentRemId;
      assertTruthy(typeof targetRemId === 'string', 'journal exact reference target remId');
      const result = (await ctx.client.callTool('remnote_append_journal', {
        content: `${expectedEntry} [[id:${targetRemId}]]`,
        timestamp: false,
      })) as { remIds: string[] };
      assertHasField(result, 'remIds', 'journal append without timestamp');
      assertIsArray(result.remIds, 'remIds should be an array');
      assertTruthy(result.remIds.length > 0, 'journal append without timestamp should create rems');
      await assertJournalReadback(
        ctx,
        result.remIds[0] as string,
        [expectedEntry],
        'non-timestamped journal entry'
      );
      await assertJournalInlineRef(
        ctx,
        result.remIds[0] as string,
        targetRemId,
        'append_journal exact reference token readback'
      );
      steps.push({
        label: 'Append without timestamp',
        passed: true,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      steps.push({
        label: 'Append without timestamp',
        passed: false,
        durationMs: Date.now() - start,
        error: (e as Error).message,
      });
    }
  }

  // Step 3: Append with markdown
  {
    const start = Date.now();
    try {
      const expectedEntry = `[MCP-TEST] Markdown entry ${ctx.runId}`;
      const result = (await ctx.client.callTool('remnote_append_journal', {
        content: `${expectedEntry}\n\n## Section\n- Item 1\n- Item 2`,
      })) as { remIds: string[] };
      assertHasField(result, 'remIds', 'journal append with markdown');
      assertIsArray(result.remIds, 'remIds should be an array');
      assertTruthy(result.remIds.length >= 3, 'should create multiple rems for markdown');
      await assertJournalReadback(
        ctx,
        result.remIds[0] as string,
        [expectedEntry, 'Section', 'Item 1'],
        'markdown journal entry'
      );
      steps.push({
        label: 'Append with markdown',
        passed: true,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      steps.push({
        label: 'Append with markdown',
        passed: false,
        durationMs: Date.now() - start,
        error: (e as Error).message,
      });
    }
  }

  return { name: 'Journal', steps, skipped: false };
}
