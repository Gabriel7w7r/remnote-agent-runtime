import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

describe('package executables', () => {
  it('publishes the server, CLI, and stdio proxy bins', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf-8')) as {
      bin: Record<string, string>;
    };
    const packageLock = JSON.parse(readFileSync('package-lock.json', 'utf-8')) as {
      packages: { '': { bin: Record<string, string> } };
    };

    expect(packageJson.bin).toMatchObject({
      'remnote-mcp-server': 'dist/index.js',
      'remnote-cli': 'dist/remnote-cli/index.js',
      'remnote-mcp-stdio': 'mcpb/remnote-local/server/index.js',
    });
    expect(packageLock.packages[''].bin).toEqual(packageJson.bin);
    expect(existsSync(packageJson.bin['remnote-mcp-stdio'])).toBe(true);
  });

  it('keeps the release build script on the required artifact pipeline', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf-8')) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.build).toBe(
      'tsc && node scripts/chmod-bins.mjs && node scripts/generate-mcpb-tools.mjs && node scripts/build-mcpb.mjs'
    );
  });

  it('keeps advertised MCPB Markdown formatting active', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf-8')) as {
      scripts: Record<string, string>;
    };
    const prettierIgnore = readFileSync('.prettierignore', 'utf-8');

    expect(packageJson.scripts.format).toContain('"mcpb/**/*.md"');
    expect(packageJson.scripts['format:check']).toContain('"mcpb/**/*.md"');
    expect(prettierIgnore).toContain('*.md');
    expect(prettierIgnore).toContain('!mcpb/**/*.md');
    expect(existsSync('mcpb/remnote-local/README.md')).toBe(true);
  });

  it('starts the built server entrypoint', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf-8')) as {
      main: string;
      bin: Record<string, string>;
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.start).toBe('node dist/index.js');
    expect(packageJson.scripts.start).toBe(`node ${packageJson.main}`);
    expect(packageJson.bin['remnote-mcp-server']).toBe(packageJson.main);
  });
});
