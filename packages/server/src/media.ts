import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { z } from 'zod';

export const DEFAULT_MAX_INLINE_BYTES = 5 * 1024 * 1024;
export const HARD_MAX_INLINE_BYTES = 10 * 1024 * 1024;

export const MediaLocatorSchema = z
  .object({
    remId: z.string().min(1),
    mediaId: z.string().min(1),
    kind: z.literal('image'),
    field: z.enum(['text', 'backText']),
    elementIndex: z.number().int().min(0),
    imageIndex: z.number().int().min(0),
    imgId: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    dimensions: z
      .object({ width: z.number().positive(), height: z.number().positive() })
      .strict()
      .optional(),
    mimeType: z.string().min(1).optional(),
    source: z.literal('remnote_managed_local'),
    localToken: z.string().min(1),
  })
  .strict();

export type MediaLocator = z.infer<typeof MediaLocatorSchema>;

export interface ResolvedMedia {
  data: string;
  mimeType: string;
  sizeBytes: number;
  metadata: Omit<MediaLocator, 'localToken'>;
}

function validateLocalToken(token: string): void {
  if (
    !token ||
    basename(token) !== token ||
    token === '.' ||
    token === '..' ||
    token.normalize('NFC') !== token ||
    token.includes('\0')
  ) {
    throw new Error('Media path traversal rejected: local media token must be a basename');
  }
}

export function parseMediaLocator(value: unknown): MediaLocator {
  const parsed = MediaLocatorSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid media locator payload received from bridge: ${parsed.error.message}`);
  }
  validateLocalToken(parsed.data.localToken);
  return parsed.data;
}

function detectImageMime(data: Buffer): string | undefined {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return 'image/png';
  }
  if (data.length >= 3 && data.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) {
    return 'image/jpeg';
  }
  if (data.length >= 6) {
    const signature = data.subarray(0, 6).toString('ascii');
    if (signature === 'GIF87a' || signature === 'GIF89a') return 'image/gif';
  }
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString('ascii') === 'RIFF' &&
    data.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return undefined;
}

function isWithinRoot(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === '' || (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot));
}

export async function resolveManagedImage(
  locatorValue: unknown,
  roots: string[],
  maxInlineBytes = DEFAULT_MAX_INLINE_BYTES
): Promise<ResolvedMedia> {
  if (
    !Number.isInteger(maxInlineBytes) ||
    maxInlineBytes < 1 ||
    maxInlineBytes > HARD_MAX_INLINE_BYTES
  ) {
    throw new Error(`maxInlineBytes must be an integer between 1 and ${HARD_MAX_INLINE_BYTES}`);
  }
  const locator = parseMediaLocator(locatorValue);

  const matches = new Map<string, string>();
  for (const configuredRoot of roots) {
    let root: string;
    try {
      root = await realpath(resolve(configuredRoot));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') continue;
      throw new Error(
        `Media permission/read failure for configured root: ${code ?? String(error)}`,
        {
          cause: error,
        }
      );
    }

    const candidate = resolve(root, locator.localToken);
    if (!isWithinRoot(root, candidate) || dirname(candidate) !== root) {
      throw new Error('Media path traversal rejected: resolved path escaped the configured root');
    }

    try {
      const candidateReal = await realpath(candidate);
      if (!isWithinRoot(root, candidateReal) || dirname(candidateReal) !== root) {
        throw new Error('Media path traversal rejected: resolved file escaped the configured root');
      }
      const fileStat = await stat(candidateReal);
      if (fileStat.isFile()) matches.set(candidateReal, candidateReal);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Media path traversal rejected:')) {
        throw error;
      }
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') continue;
      throw new Error(
        `Media permission/read failure for ${locator.localToken}: ${code ?? String(error)}`,
        {
          cause: error,
        }
      );
    }
  }

  if (matches.size === 0) {
    throw new Error(`Media file missing: ${locator.localToken}`);
  }
  if (matches.size > 1) {
    throw new Error(`Media file ambiguous: ${locator.localToken} matched ${matches.size} roots`);
  }

  const filePath = [...matches.values()][0];
  let data: Buffer;
  let sizeBytes: number;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const initialStat = await handle.stat();
    if (!initialStat.isFile()) {
      throw new Error(`Media file missing: ${locator.localToken}`);
    }
    if (initialStat.size > maxInlineBytes) {
      throw new Error(
        `Media file oversized: ${initialStat.size} bytes exceeds maxInlineBytes ${maxInlineBytes}`
      );
    }

    const buffer = Buffer.alloc(maxInlineBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > maxInlineBytes) {
      throw new Error(
        `Media file oversized: more than ${maxInlineBytes} bytes exceeds maxInlineBytes ${maxInlineBytes}`
      );
    }

    const finalStat = await handle.stat();
    if (
      finalStat.size !== offset ||
      finalStat.size !== initialStat.size ||
      finalStat.mtimeMs !== initialStat.mtimeMs
    ) {
      throw new Error('Media file changed during read; retry the request');
    }
    data = buffer.subarray(0, offset);
    sizeBytes = offset;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.startsWith('Media file oversized:') ||
        error.message.startsWith('Media file missing:') ||
        error.message === 'Media file changed during read; retry the request')
    ) {
      throw error;
    }
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ELOOP') {
      throw new Error('Media path traversal rejected: resolved file became a symlink', {
        cause: error,
      });
    }
    throw new Error(
      `Media permission/read failure for ${locator.localToken}: ${code ?? String(error)}`,
      {
        cause: error,
      }
    );
  } finally {
    await handle?.close();
  }

  const mimeType = detectImageMime(data);
  if (!mimeType) {
    throw new Error('Unsupported MIME: allowed image types are png, jpeg, gif, and webp');
  }

  const { localToken: _localToken, ...metadata } = locator;
  return {
    data: data.toString('base64'),
    mimeType,
    sizeBytes,
    metadata,
  };
}
