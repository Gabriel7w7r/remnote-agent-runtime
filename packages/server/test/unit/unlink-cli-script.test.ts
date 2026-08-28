import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('unlink-cli.sh', () => {
  it('exists in the project root', () => {
    const scriptPath = resolve(process.cwd(), 'unlink-cli.sh');
    expect(existsSync(scriptPath)).toBe(true);
  });

  it('removes the global npm link when present', () => {
    const scriptPath = resolve(process.cwd(), 'unlink-cli.sh');
    const content = readFileSync(scriptPath, 'utf-8');

    expect(content).toContain('npm root -g');
    expect(content).toContain('[[ -L "$global_package_path" ]]');
    expect(content).toContain('npm unlink -g "$package_name"');
  });

  it('leaves non-linked installs untouched', () => {
    const scriptPath = resolve(process.cwd(), 'unlink-cli.sh');
    const content = readFileSync(scriptPath, 'utf-8');

    expect(content).toContain('No global npm link present for ${package_name}.');
    expect(content).not.toContain('npm uninstall -g');
  });

  it('checks every package executable after unlinking', () => {
    const scriptPath = resolve(process.cwd(), 'unlink-cli.sh');
    const content = readFileSync(scriptPath, 'utf-8');

    expect(content).toContain("Object.keys(require('./package.json').bin).join('\\n')");
    expect(content).toContain('while IFS= read -r bin_name; do');
    expect(content).toContain('command -v "$bin_name" >/dev/null 2>&1');
    expect(content).toContain('${bin_name} is still on PATH:');
  });
});
