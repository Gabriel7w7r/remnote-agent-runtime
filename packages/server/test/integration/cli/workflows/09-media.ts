import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertEqual, assertTruthy } from '../assertions.js';
import type { SharedState, StepResult, WorkflowContext, WorkflowResult } from '../types.js';

export async function mediaWorkflow(
  ctx: WorkflowContext,
  state: SharedState
): Promise<WorkflowResult> {
  const fixture = state.fixtures?.media;
  if (!fixture) {
    return {
      name: 'Managed Media',
      steps: [
        {
          label: 'Skipped — managed-media fixture unavailable',
          passed: false,
          durationMs: 0,
          error:
            state.fixtureIssues?.find((issue) => issue.fixture === 'media')?.error ??
            'Managed-media integration fixture was not initialized',
        },
      ],
      skipped: true,
    };
  }

  const steps: StepResult[] = [];
  const { mediaRemId, mediaField, mediaId } = fixture;
  const tempDir = await mkdtemp(join(tmpdir(), 'remnote-cli-media-integration-'));
  try {
    const readStart = Date.now();
    const read = (await ctx.cli.runExpectSuccess([
      'read',
      mediaRemId,
      '--content-mode',
      'none',
      '--include-media-metadata',
    ])) as Record<string, unknown>;
    const media = Array.isArray(read.media) ? (read.media as Array<Record<string, unknown>>) : [];
    const selected = media.find(
      (item) =>
        item.field === mediaField &&
        item.source === 'remnote_managed_local' &&
        item.mediaId === mediaId
    );
    assertTruthy(selected?.mediaId, 'CLI read mediaId');
    steps.push({
      label: 'CLI read exposes managed-image metadata',
      passed: true,
      durationMs: Date.now() - readStart,
    });

    const outputPath = join(tempDir, 'retrieved-image');
    const getStart = Date.now();
    const result = (await ctx.cli.runExpectSuccess([
      'get-media',
      mediaRemId,
      '--field',
      mediaField,
      '--media-id',
      selected!.mediaId as string,
      '--output',
      outputPath,
    ])) as Record<string, unknown>;
    const bytes = await readFile(outputPath);
    assertTruthy(bytes.length > 0, 'saved image bytes');
    assertEqual(bytes.length, result.sizeBytes, 'saved image size');
    assertEqual(result.outputPath, outputPath, 'reported output path');
    steps.push({
      label: 'CLI get-media saves exact image bytes',
      passed: true,
      durationMs: Date.now() - getStart,
    });
  } catch (error) {
    steps.push({
      label: 'CLI managed-media workflow',
      passed: false,
      durationMs: 0,
      error: (error as Error).message,
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  return { name: 'Managed Media', steps, skipped: false };
}
