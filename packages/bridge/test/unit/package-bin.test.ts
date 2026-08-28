import packageJson from '../../package.json';
import { describe, expect, it } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

describe('package bin metadata', () => {
  it('exposes the local production server executable', () => {
    expect(packageJson.bin).toEqual({
      'remnote-mcp-bridge': './bin/remnote-mcp-bridge.js',
    });
  });

  it('points the bridge bin metadata at an executable Node wrapper', () => {
    const binPath = packageJson.bin['remnote-mcp-bridge'];
    const stats = statSync(binPath);
    const firstLine = readFileSync(binPath, 'utf8').split(/\r?\n/)[0];

    expect(stats.isFile()).toBe(true);
    if (process.platform !== 'win32') {
      expect(stats.mode & 0o111).not.toBe(0);
    }
    expect(firstLine).toBe('#!/usr/bin/env node');
  });

  it('executes the bridge bin version command', () => {
    const result = spawnSync(process.execPath, ['bin/remnote-mcp-bridge.js', '--version'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe(packageJson.version);
  });

  it('runs quality scripts through local package binaries', () => {
    for (const scriptName of ['lint', 'lint:fix', 'format', 'format:check'] as const) {
      expect(packageJson.scripts[scriptName]).not.toContain('npx ');
    }
    expect(packageJson.scripts.lint).toMatch(/^eslint /);
    expect(packageJson.scripts.format).toMatch(/^prettier /);
  });

  it('runs release validation through the monorepo-aware RemNote SDK wrapper', () => {
    expect(packageJson.scripts.build).not.toContain('npx ');
    expect(packageJson.scripts.build).toMatch(/^pnpm validate && /);
    expect(packageJson.scripts.validate).toBe('node scripts/validate-plugin.mjs');
    expect(readFileSync('scripts/validate-plugin.mjs', 'utf8')).toContain(
      'parseManifest(manifest)'
    );
    expect(packageJson.dependencies['@remnote/plugin-sdk']).toBeDefined();
  });
});
