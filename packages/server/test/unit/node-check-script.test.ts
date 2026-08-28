import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function runNodeCheck(version: string, includeNvmrc = true, shell = 'bash') {
  const tempRoot = mkdtempSync(join(tmpdir(), 'remnote-node-check-'));
  const binDir = join(tempRoot, 'bin');
  mkdirSync(binDir);

  copyFileSync(resolve('node-check.sh'), join(tempRoot, 'node-check.sh'));
  if (includeNvmrc) {
    copyFileSync(resolve('.nvmrc'), join(tempRoot, '.nvmrc'));
  }

  writeFileSync(
    join(binDir, 'node'),
    `#!/usr/bin/env bash
if [[ "$1" == "-p" ]]; then
  echo "${version}"
  exit 0
fi
echo "v${version}"
`
  );
  writeFileSync(join(binDir, 'npm'), '#!/usr/bin/env bash\nexit 0\n');
  chmodSync(join(binDir, 'node'), 0o755);
  chmodSync(join(binDir, 'npm'), 0o755);

  try {
    const result = spawnSync(shell, ['-c', 'source ./node-check.sh && echo ready'], {
      cwd: tempRoot,
      encoding: 'utf-8',
      env: {
        PATH: `${binDir}:/bin:/usr/bin`,
        HOME: tempRoot,
      },
    });

    return { result, tempRoot };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

describe.skipIf(process.platform === 'win32')('node-check.sh', () => {
  const zshAvailable = spawnSync('zsh', ['--version']).status === 0;

  it.each(['22.13.0', '22.14.0', '24.0.0', '22.13.0\r'])(
    'accepts supported Node.js version %s',
    (version) => {
      const { result } = runNodeCheck(version);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('ready');
    }
  );

  it.each(['20.19.0', '22.12.0'])('rejects unsupported Node.js version %s', (version) => {
    const { result } = runNodeCheck(version);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`Node.js >= 22.13.0 is required; found ${version}.`);
    expect(result.stderr).toContain('nvm install 24');
  });

  it.each(['22.13.0-rc.1', 'not-a-version'])(
    'rejects malformed Node.js version %s without a shell error',
    (version) => {
      const { result } = runNodeCheck(version);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(`Node.js >= 22.13.0 is required; found ${version}.`);
      expect(result.stderr).not.toContain('arithmetic syntax error');
    }
  );

  it('reports a missing project Node version file without leaking a cat error', () => {
    const { result } = runNodeCheck('20.19.0', false);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Project Node version file is missing or unreadable:');
    expect(result.stderr).not.toContain('cat:');
  });

  it('removes its temporary test directory', () => {
    const { tempRoot } = runNodeCheck('24.0.0');

    expect(existsSync(tempRoot)).toBe(false);
  });

  it.skipIf(!zshAvailable)('can be sourced from zsh', () => {
    const { result } = runNodeCheck('24.0.0', true, 'zsh');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('ready');
  });
});
