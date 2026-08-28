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
  const { mediaRemId, mediaField, mediaId: expectedMediaId } = fixture;
  let mediaId: string | undefined;

  {
    const start = Date.now();
    try {
      const read = await ctx.client.callTool('remnote_read_note', {
        remId: mediaRemId,
        contentMode: 'none',
        includeMediaMetadata: true,
      });
      const media = Array.isArray(read.media) ? (read.media as Array<Record<string, unknown>>) : [];
      const selected = media.find(
        (item) =>
          item.field === mediaField &&
          item.source === 'remnote_managed_local' &&
          item.mediaId === expectedMediaId
      );
      assertTruthy(selected, `managed ${mediaField} image metadata`);
      assertTruthy(selected?.mediaId, 'mediaId');
      mediaId = selected!.mediaId as string;
      steps.push({
        label: 'Read ordered managed-image metadata',
        passed: true,
        durationMs: Date.now() - start,
      });
    } catch (error) {
      steps.push({
        label: 'Read ordered managed-image metadata',
        passed: false,
        durationMs: Date.now() - start,
        error: (error as Error).message,
      });
    }
  }

  if (mediaId) {
    const start = Date.now();
    try {
      const result = await ctx.client.callToolRaw('remnote_get_media', {
        remId: mediaRemId,
        field: mediaField,
        mediaId,
      });
      const image = result.content?.find((item) => item.type === 'image');
      assertTruthy(image?.data, 'MCP-native image data');
      assertTruthy(image?.mimeType?.startsWith('image/'), 'MCP-native image MIME');
      assertEqual(result.structuredContent?.mediaId, mediaId, 'returned mediaId');
      const decoded = Buffer.from(image!.data!, 'base64');
      assertEqual(decoded.length, result.structuredContent?.sizeBytes, 'decoded image size');
      steps.push({
        label: 'Retrieve MCP-native managed image with matching metadata',
        passed: true,
        durationMs: Date.now() - start,
      });
    } catch (error) {
      steps.push({
        label: 'Retrieve MCP-native managed image with matching metadata',
        passed: false,
        durationMs: Date.now() - start,
        error: (error as Error).message,
      });
    }

    const staleStart = Date.now();
    try {
      const errorText = await ctx.client.callToolExpectError('remnote_get_media', {
        remId: mediaRemId,
        field: mediaField,
        mediaId: `${mediaId}-stale`,
      });
      assertTruthy(errorText.includes('Stale or missing media ID'), 'stale media rejection');
      steps.push({
        label: 'Reject stale media ID',
        passed: true,
        durationMs: Date.now() - staleStart,
      });
    } catch (error) {
      steps.push({
        label: 'Reject stale media ID',
        passed: false,
        durationMs: Date.now() - staleStart,
        error: (error as Error).message,
      });
    }
  }

  return { name: 'Managed Media', steps, skipped: false };
}
