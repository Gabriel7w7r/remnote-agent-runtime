import { Command } from 'commander';
import { createCommandClient } from '../client/command-client.js';
import { formatResult, formatError, type OutputFormat } from '../output/formatter.js';
import { EXIT } from '../config.js';

function formatTags(tags: unknown): string {
  if (!Array.isArray(tags)) return '';
  return tags
    .map((tag) => {
      if (
        tag &&
        typeof tag === 'object' &&
        typeof (tag as Record<string, unknown>).name === 'string' &&
        typeof (tag as Record<string, unknown>).tagRemId === 'string'
      ) {
        const { name, tagRemId } = tag as { name: string; tagRemId: string };
        return `${name} [${tagRemId}]`;
      }
      return typeof tag === 'string' ? tag : '';
    })
    .filter(Boolean)
    .join(', ');
}

export function registerReadCommand(program: Command): void {
  program
    .command('read <rem-id>')
    .description('Read a note by its Rem ID')
    .option('-d, --depth <n>', 'Depth of child hierarchy to render (default: 5)', '5')
    .option(
      '--content-mode <mode>',
      'Content rendering mode: "markdown" (default), "none", or "structured"'
    )
    .option('--view <view>', 'Output detail level: compact, standard, or full')
    .option('--ancestor-depth <n>', 'Number of parent Rems to include, direct parent first')
    .option('--child-limit <n>', 'Maximum children per level (default: 100)')
    .option('--max-content-length <n>', 'Maximum content character length (default: 100000)')
    .option('--include-media-metadata', 'Include ordered root image metadata for get-media')
    .action(async (remId: string, opts) => {
      const globalOpts = program.opts();
      const format: OutputFormat = globalOpts.text ? 'text' : 'json';
      const client = createCommandClient(program);

      try {
        const payload: Record<string, unknown> = {
          remId,
          depth: parseInt(opts.depth, 10),
        };
        if (opts.contentMode) payload.contentMode = opts.contentMode;
        if (opts.view) payload.view = opts.view;
        if (opts.ancestorDepth) payload.ancestorDepth = parseInt(opts.ancestorDepth, 10);
        if (opts.childLimit) payload.childLimit = parseInt(opts.childLimit, 10);
        if (opts.maxContentLength) payload.maxContentLength = parseInt(opts.maxContentLength, 10);
        if (opts.includeMediaMetadata) payload.includeMediaMetadata = true;

        const result = await client.execute('read_note', payload);
        console.log(
          formatResult(result, format, (data) => {
            const r = data as Record<string, unknown>;
            const lines: string[] = [];
            if (r.headline) {
              lines.push(`Title: ${r.headline}`);
            } else if (r.title) {
              lines.push(`Title: ${r.title}`);
            }
            if (r.remId) lines.push(`ID: ${r.remId}`);
            if (r.remType) lines.push(`Type: ${r.remType}`);
            if (typeof r.parentTitle === 'string' && r.parentTitle.length > 0) {
              const parentIdSuffix = typeof r.parentRemId === 'string' ? ` [${r.parentRemId}]` : '';
              lines.push(`Parent: ${r.parentTitle}${parentIdSuffix}`);
            }
            if (Array.isArray(r.ancestors) && r.ancestors.length > 0) {
              lines.push(
                `Ancestors: ${r.ancestors
                  .map((ancestor) =>
                    ancestor && typeof ancestor === 'object'
                      ? (ancestor as Record<string, unknown>).title
                      : ''
                  )
                  .filter(Boolean)
                  .join(' <- ')}`
              );
            }
            if (r.aliases && Array.isArray(r.aliases) && r.aliases.length > 0) {
              lines.push(`Aliases: ${(r.aliases as string[]).join(', ')}`);
            }
            const formattedTags = formatTags(r.tags);
            if (formattedTags) {
              lines.push(`Tags: ${formattedTags}`);
            }
            if (r.cardDirection) lines.push(`Card: ${r.cardDirection}`);
            if (Array.isArray(r.media) && r.media.length > 0) {
              lines.push(`Media: ${r.media.length}`);
              for (const item of r.media) {
                if (!item || typeof item !== 'object') continue;
                const media = item as Record<string, unknown>;
                lines.push(
                  `  - ${String(media.kind)} ${String(media.field)} ${String(media.mediaId)}${
                    typeof media.mimeType === 'string' ? ` (${media.mimeType})` : ''
                  }`
                );
              }
            }
            if (r.contentProperties) {
              const cp = r.contentProperties as Record<string, unknown>;
              lines.push(
                `Children: ${cp.childrenRendered}/${cp.childrenTotal}${cp.contentTruncated ? ' (truncated)' : ''}`
              );
            }
            if (r.content && typeof r.content === 'string' && r.content.length > 0) {
              lines.push('');
              lines.push(r.content as string);
            }
            return lines.join('\n');
          })
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(formatError(message, format));
        process.exit(EXIT.ERROR);
      } finally {
        await client.close();
      }
    });
}
