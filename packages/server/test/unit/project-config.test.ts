import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import vitestConfig from '../../vitest.config.js';

describe('project config', () => {
  it('keeps the supported Node.js policy aligned across package, lockfile, nvm, and CI', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf-8')) as {
      engines: { node: string };
    };
    const packageLock = JSON.parse(readFileSync('package-lock.json', 'utf-8')) as {
      packages: { '': { engines: { node: string } } };
    };
    const nvmVersion = readFileSync('.nvmrc', 'utf-8').trim();
    const ciWorkflow = readFileSync('.github/workflows/ci.yml', 'utf-8');

    expect(packageJson.engines.node).toBe('>=22.13.0');
    expect(packageLock.packages[''].engines.node).toBe(packageJson.engines.node);
    expect(nvmVersion).toBe('24');
    expect(ciWorkflow).toContain(`node_versions: '["22.13.0", "24"]'`);
    expect(ciWorkflow).toContain("coverage_node_version: '24'");
  });

  it('prevents production dist emit when TypeScript reports errors', () => {
    const tsconfig = JSON.parse(readFileSync('tsconfig.json', 'utf-8')) as {
      compilerOptions: { noEmitOnError?: boolean };
    };

    expect(tsconfig.compilerOptions.noEmitOnError).toBe(true);
  });

  it('keeps generated output out of Vitest test discovery', () => {
    const config = vitestConfig as { test?: { exclude?: string[] } };

    expect(config.test?.exclude).toEqual(
      expect.arrayContaining(['test/integration/**', 'node_modules/**', 'dist/**', 'coverage/**'])
    );
  });
});
