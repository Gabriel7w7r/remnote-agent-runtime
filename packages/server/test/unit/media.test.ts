import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HARD_MAX_INLINE_BYTES, resolveManagedImage, type MediaLocator } from '../../src/media.js';

const PNG = Buffer.from('89504e470d0a1a0a00000000', 'hex');
const SUPPORTED_IMAGE_CASES = [
  { mimeType: 'image/jpeg', data: Buffer.from('ffd8ff', 'hex') },
  { mimeType: 'image/gif', data: Buffer.from('GIF87a', 'ascii') },
  { mimeType: 'image/gif', data: Buffer.from('GIF89a', 'ascii') },
  { mimeType: 'image/webp', data: Buffer.from('RIFF0000WEBP', 'ascii') },
];

describe('managed image resolution', () => {
  let tempDir: string;
  let rootA: string;
  let rootB: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'remnote-media-test-'));
    rootA = join(tempDir, 'a');
    rootB = join(tempDir, 'b');
    await mkdir(rootA);
    await mkdir(rootB);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function locator(localToken = 'image.png'): MediaLocator {
    return {
      remId: 'rem-1',
      mediaId: 'media_1234',
      kind: 'image',
      field: 'text',
      elementIndex: 0,
      imageIndex: 0,
      source: 'remnote_managed_local',
      localToken,
    };
  }

  it('resolves one exact filename inside an allowed root', async () => {
    await writeFile(join(rootA, 'image.png'), PNG);

    const result = await resolveManagedImage(locator(), [rootA, rootB]);

    expect(result.mimeType).toBe('image/png');
    expect(Buffer.from(result.data, 'base64')).toEqual(PNG);
    expect(result.metadata).not.toHaveProperty('localToken');
  });

  it.each(SUPPORTED_IMAGE_CASES)(
    'detects $mimeType from file bytes',
    async ({ mimeType, data }) => {
      await writeFile(join(rootA, 'image.png'), data);

      const result = await resolveManagedImage(locator(), [join(tempDir, 'missing'), rootA]);

      expect(result.mimeType).toBe(mimeType);
      expect(Buffer.from(result.data, 'base64')).toEqual(data);
    }
  );

  it('rejects traversal tokens', async () => {
    await expect(resolveManagedImage(locator('../image.png'), [rootA])).rejects.toThrow(
      'Media path traversal rejected'
    );
  });

  it.skipIf(process.platform === 'win32')('rejects symlinks escaping the root', async () => {
    const outside = join(tempDir, 'outside.png');
    await writeFile(outside, PNG);
    await symlink(outside, join(rootA, 'image.png'));
    await expect(resolveManagedImage(locator(), [rootA])).rejects.toThrow(
      'Media path traversal rejected'
    );
  });

  it('reports missing and ambiguous exact filename matches distinctly', async () => {
    await expect(resolveManagedImage(locator(), [rootA, rootB])).rejects.toThrow(
      'Media file missing'
    );

    await writeFile(join(rootA, 'image.png'), PNG);
    await writeFile(join(rootB, 'image.png'), PNG);
    await expect(resolveManagedImage(locator(), [rootA, rootB])).rejects.toThrow(
      'Media file ambiguous'
    );
  });

  it('enforces the image MIME allowlist from file bytes', async () => {
    await writeFile(join(rootA, 'image.png'), Buffer.from('<svg></svg>'));

    await expect(resolveManagedImage(locator(), [rootA])).rejects.toThrow('Unsupported MIME');
  });

  it('enforces requested and hard inline size limits', async () => {
    await writeFile(join(rootA, 'image.png'), Buffer.concat([PNG, Buffer.alloc(32)]));

    await expect(resolveManagedImage(locator(), [rootA], 8)).rejects.toThrow(
      'Media file oversized'
    );
    await expect(
      resolveManagedImage(locator(), [rootA], HARD_MAX_INLINE_BYTES + 1)
    ).rejects.toThrow('maxInlineBytes must be an integer');
  });

  it.each([0, 1.5])('rejects invalid inline size limit %s', async (maxInlineBytes) => {
    await expect(resolveManagedImage(locator(), [rootA], maxInlineBytes)).rejects.toThrow(
      'maxInlineBytes must be an integer'
    );
  });

  it.each([
    null,
    {},
    { localToken: 7, kind: 'image', source: 'remnote_managed_local' },
    { ...locator(), unexpected: true },
  ])('rejects malformed bridge locator payloads without TypeErrors', async (value) => {
    await expect(resolveManagedImage(value, [rootA])).rejects.toThrow(
      'Invalid media locator payload received from bridge'
    );
  });

  it('accepts decoded basename tokens containing spaces', async () => {
    await writeFile(join(rootA, 'Screenshot 2026.png'), PNG);

    const result = await resolveManagedImage(locator('Screenshot 2026.png'), [rootA]);

    expect(result.sizeBytes).toBe(PNG.length);
  });
});
