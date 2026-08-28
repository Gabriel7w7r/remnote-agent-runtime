import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('link-cli.sh', () => {
  it('exists in the project root', () => {
    const scriptPath = resolve(process.cwd(), 'link-cli.sh');
    expect(existsSync(scriptPath)).toBe(true);
  });

  it('installs, tests, builds, and links the package', () => {
    const scriptPath = resolve(process.cwd(), 'link-cli.sh');
    const content = readFileSync(scriptPath, 'utf-8');

    expect(content).toContain('npm install');
    expect(content).toContain('npm test');
    expect(content).toContain('npm run build');
    expect(content).toContain('npm link');
  });

  it('guards against replacing a non-linked global install', () => {
    const scriptPath = resolve(process.cwd(), 'link-cli.sh');
    const content = readFileSync(scriptPath, 'utf-8');

    expect(content).toContain('npm root -g');
    expect(content).toContain('already installed globally via npm');
    expect(content).toContain('npm uninstall -g');
  });

  it('verifies all package executables after linking', () => {
    const scriptPath = resolve(process.cwd(), 'link-cli.sh');
    const content = readFileSync(scriptPath, 'utf-8');

    expect(content).toContain("Object.keys(require('./package.json').bin).join('\\n')");
    expect(content).toContain('Verifying package executables');
    expect(content).toContain('while IFS= read -r bin_name; do');
    expect(content).toContain('command -v "$bin_name"');
    expect(content).toContain('"$bin_name" --version');
  });
});
