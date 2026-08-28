import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DAEMON_PID_FILE_NAME,
  DAEMON_STATE_FILE_NAME,
  LAUNCHD_LABEL,
  handleDaemonCommand as handleDaemonCommandBase,
  getDefaultDaemonPaths,
  runDaemonCommand as runDaemonCommandBase,
  type DaemonRuntime,
  type DaemonState,
} from '../../src/daemon.js';

describe('daemon commands', () => {
  let stateDir: string;
  let stdout: CapturedStream;
  let stderr: CapturedStream;

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'remnote-daemon-test-'));
    stdout = createCapturedStream();
    stderr = createCapturedStream();
  });

  afterEach(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });

  function runDaemonCommand(
    command: Parameters<typeof runDaemonCommandBase>[0],
    runtime: Parameters<typeof runDaemonCommandBase>[1] = {}
  ): ReturnType<typeof runDaemonCommandBase> {
    return runDaemonCommandBase(command, { homeDir: stateDir, ...runtime });
  }

  function handleDaemonCommand(
    argv: string[],
    runtime: Parameters<typeof handleDaemonCommandBase>[1] = {}
  ): ReturnType<typeof handleDaemonCommandBase> {
    return handleDaemonCommandBase(argv, { homeDir: stateDir, ...runtime });
  }

  it('starts a detached server process and records daemon state', async () => {
    const canBind = vi
      .fn<DaemonRuntime['canBind']>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);
    const unref = vi.fn();
    const spawnProcess = vi.fn().mockReturnValue({ pid: 4242, unref });

    const exitCode = await runDaemonCommand(
      { action: 'start', cliOptions: {}, stateDir, timeoutMs: 50 },
      {
        entrypointPath: '/opt/remnote-mcp-server/dist/index.js',
        execPath: '/usr/local/bin/node',
        canBind,
        isProcessAlive: () => true,
        spawnProcess: spawnProcess as never,
        stdout,
        stderr,
      }
    );

    expect(exitCode).toBe(0);
    expect(spawnProcess).toHaveBeenCalledWith(
      '/usr/local/bin/node',
      [
        resolve('/opt/remnote-mcp-server/dist/index.js'),
        '--http-port',
        '3001',
        '--ws-port',
        '3002',
        '--http-host',
        '127.0.0.1',
        '--log-level',
        'info',
      ],
      expect.objectContaining({
        detached: true,
        windowsHide: true,
      })
    );
    expect(unref).toHaveBeenCalled();
    expect(stdout.text()).toContain('daemon started');

    const paths = getDefaultDaemonPaths(undefined, stateDir);
    await expect(readFile(paths.pidFile, 'utf8')).resolves.toBe('4242\n');
    const state = JSON.parse(await readFile(paths.stateFile, 'utf8')) as DaemonState;
    expect(state).toMatchObject({
      pid: 4242,
      httpPort: 3001,
      wsPort: 3002,
      logFile: join(stateDir, 'remnote-mcp-server.log'),
    });
  });

  it('prints daemon usage without starting the server', async () => {
    const result = await handleDaemonCommand(['node', 'remnote-mcp-server', 'daemon', '--help'], {
      stdout,
      stderr,
    });

    expect(result).toEqual({ exitCode: 0, handled: true });
    expect(stdout.text()).toContain('remnote-mcp-server daemon start');
  });

  it('does not start a second process when the daemon pid is alive', async () => {
    await writeState({
      pid: 1111,
      entrypointPath: '/opt/remnote-mcp-server/dist/index.js',
    });
    const spawnProcess = vi.fn();

    const exitCode = await runDaemonCommand(
      { action: 'start', cliOptions: {}, stateDir },
      {
        isProcessAlive: (pid) => pid === 1111,
        spawnProcess: spawnProcess as never,
        stdout,
        stderr,
      }
    );

    expect(exitCode).toBe(0);
    expect(spawnProcess).not.toHaveBeenCalled();
    expect(stdout.text()).toContain('already running');
  });

  it('cleans stale daemon state before starting a fresh process', async () => {
    await writeState({
      pid: 3333,
      entrypointPath: '/opt/remnote-mcp-server/dist/index.js',
    });
    const canBind = vi
      .fn<DaemonRuntime['canBind']>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);
    const spawnProcess = vi.fn().mockReturnValue({ pid: 4444, unref: vi.fn() });

    const exitCode = await runDaemonCommand(
      { action: 'start', cliOptions: { verbose: true }, stateDir, timeoutMs: 50 },
      {
        entrypointPath: '/opt/remnote-mcp-server/dist/index.js',
        execPath: '/usr/local/bin/node',
        canBind,
        isProcessAlive: (pid) => pid === 4444,
        spawnProcess: spawnProcess as never,
        stdout,
        stderr,
      }
    );

    expect(exitCode).toBe(0);
    const state = JSON.parse(
      await readFile(join(stateDir, DAEMON_STATE_FILE_NAME), 'utf8')
    ) as DaemonState;
    expect(state.pid).toBe(4444);
    expect(spawnProcess).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['--log-level', 'debug']),
      expect.any(Object)
    );
  });

  it('starts with server options from a TOML config file', async () => {
    const configPath = join(stateDir, 'config.toml');
    await writeFile(
      configPath,
      [
        '[server]',
        'httpPort = 4101',
        'wsPort = 4102',
        'httpHost = "localhost"',
        'logLevel = "debug"',
        'requestLog = "/tmp/requests.jsonl"',
        'responseLog = "/tmp/responses.jsonl"',
        '',
      ].join('\n'),
      'utf8'
    );
    const canBind = vi
      .fn<DaemonRuntime['canBind']>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);
    const spawnProcess = vi.fn().mockReturnValue({ pid: 4142, unref: vi.fn() });

    const exitCode = await runDaemonCommand(
      { action: 'start', cliOptions: { config: configPath }, stateDir, timeoutMs: 50 },
      {
        entrypointPath: '/opt/remnote-mcp-server/dist/index.js',
        execPath: '/usr/local/bin/node',
        canBind,
        isProcessAlive: () => true,
        spawnProcess: spawnProcess as never,
        stdout,
        stderr,
      }
    );

    expect(exitCode).toBe(0);
    expect(spawnProcess).toHaveBeenCalledWith(
      '/usr/local/bin/node',
      [
        resolve('/opt/remnote-mcp-server/dist/index.js'),
        '--http-port',
        '4101',
        '--ws-port',
        '4102',
        '--http-host',
        '127.0.0.1',
        '--log-level',
        'debug',
        '--request-log',
        '/tmp/requests.jsonl',
        '--response-log',
        '/tmp/responses.jsonl',
      ],
      expect.any(Object)
    );
  });

  it('fails before spawning when the configured port is occupied', async () => {
    const canBind = vi.fn<DaemonRuntime['canBind']>().mockResolvedValue(false);
    const spawnProcess = vi.fn();

    const exitCode = await runDaemonCommand(
      { action: 'start', cliOptions: {}, stateDir },
      {
        canBind,
        spawnProcess: spawnProcess as never,
        stdout,
        stderr,
      }
    );

    expect(exitCode).toBe(1);
    expect(spawnProcess).not.toHaveBeenCalled();
    expect(stderr.text()).toContain('HTTP port 127.0.0.1:3001 is already occupied');
  });

  it('cleans daemon state and terminates the child when startup readiness times out', async () => {
    const canBind = vi.fn<DaemonRuntime['canBind']>().mockResolvedValue(true);
    const killProcess = vi.fn();
    const spawnProcess = vi.fn().mockReturnValue({ pid: 5555, unref: vi.fn() });

    const exitCode = await runDaemonCommand(
      { action: 'start', cliOptions: {}, stateDir, timeoutMs: 1 },
      {
        entrypointPath: '/opt/remnote-mcp-server/dist/index.js',
        canBind,
        isProcessAlive: () => true,
        killProcess,
        spawnProcess: spawnProcess as never,
        stdout,
        stderr,
      }
    );

    expect(exitCode).toBe(1);
    expect(killProcess).toHaveBeenCalledWith(5555, 'SIGTERM');
    expect(stderr.text()).toContain('Timed out waiting for daemon startup');
    await expect(readFile(join(stateDir, DAEMON_STATE_FILE_NAME), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('stops only the managed daemon process and removes pid state', async () => {
    await writeState({
      pid: 2222,
      entrypointPath: '/opt/remnote-mcp-server/dist/index.js',
    });
    let alive = true;
    const killProcess = vi.fn(() => {
      alive = false;
    });

    const exitCode = await runDaemonCommand(
      { action: 'stop', cliOptions: {}, stateDir, timeoutMs: 50 },
      {
        isProcessAlive: () => alive,
        getProcessCommand: async () => '/usr/local/bin/node /opt/remnote-mcp-server/dist/index.js',
        killProcess,
        stdout,
        stderr,
      }
    );

    expect(exitCode).toBe(0);
    expect(killProcess).toHaveBeenCalledWith(2222, 'SIGTERM');
    expect(stdout.text()).toContain('daemon stopped');

    const paths = getDefaultDaemonPaths(undefined, stateDir);
    await expect(readFile(paths.pidFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(paths.stateFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports stop as successful when no daemon is running', async () => {
    const exitCode = await runDaemonCommand(
      { action: 'stop', cliOptions: {}, stateDir },
      {
        isProcessAlive: () => false,
        stdout,
        stderr,
      }
    );

    expect(exitCode).toBe(0);
    expect(stdout.text()).toContain('daemon is not running');
  });

  it('refuses to stop a pid that does not match the managed command', async () => {
    await writeState({
      pid: 6666,
      entrypointPath: '/opt/remnote-mcp-server/dist/index.js',
    });

    const exitCode = await runDaemonCommand(
      { action: 'stop', cliOptions: {}, stateDir },
      {
        isProcessAlive: () => true,
        getProcessCommand: async () => '/usr/bin/other-process',
        killProcess: vi.fn(),
        stdout,
        stderr,
      }
    );

    expect(exitCode).toBe(1);
    expect(stderr.text()).toContain('Refusing to stop pid 6666');
  });

  it('forces shutdown when graceful stop times out', async () => {
    await writeState({
      pid: 7777,
      entrypointPath: '/opt/remnote-mcp-server/dist/index.js',
    });
    const killProcess = vi.fn();

    const exitCode = await runDaemonCommand(
      { action: 'stop', cliOptions: {}, stateDir, timeoutMs: 1, force: true },
      {
        isProcessAlive: () => true,
        getProcessCommand: async () => '/usr/local/bin/node /opt/remnote-mcp-server/dist/index.js',
        killProcess,
        stdout,
        stderr,
      }
    );

    expect(exitCode).toBe(0);
    expect(killProcess).toHaveBeenCalledWith(7777, 'SIGTERM');
    expect(killProcess).toHaveBeenCalledWith(7777, 'SIGKILL');
  });

  it('reports a timeout when graceful stop does not complete without force', async () => {
    await writeState({
      pid: 7778,
      entrypointPath: '/opt/remnote-mcp-server/dist/index.js',
    });

    const exitCode = await runDaemonCommand(
      { action: 'stop', cliOptions: {}, stateDir, timeoutMs: 1 },
      {
        isProcessAlive: () => true,
        getProcessCommand: async () => '/usr/local/bin/node /opt/remnote-mcp-server/dist/index.js',
        killProcess: vi.fn(),
        stdout,
        stderr,
      }
    );

    expect(exitCode).toBe(1);
    expect(stderr.text()).toContain('Timed out waiting for daemon pid 7778 to stop');
  });

  it('prints status for running and stopped daemon states', async () => {
    await writeState({
      pid: 8888,
      entrypointPath: '/opt/remnote-mcp-server/dist/index.js',
    });

    const runningCode = await runDaemonCommand(
      { action: 'status', cliOptions: {}, stateDir },
      {
        isProcessAlive: () => true,
        canBind: vi.fn().mockResolvedValue(false),
        stdout,
        stderr,
      }
    );

    expect(runningCode).toBe(0);
    expect(stdout.text()).toContain('running pid=8888');

    stdout = createCapturedStream();
    const stoppedCode = await runDaemonCommand(
      { action: 'status', cliOptions: {}, stateDir },
      {
        isProcessAlive: () => false,
        canBind: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
        stdout,
        stderr,
      }
    );

    expect(stoppedCode).toBe(1);
    expect(stdout.text()).toContain('not running (stale pid 8888)');
  });

  it('prints daemon log tails and reports missing logs clearly', async () => {
    await writeFile(join(stateDir, 'remnote-mcp-server.log'), 'one\ntwo\nthree\n', 'utf8');

    const exitCode = await runDaemonCommand(
      { action: 'logs', cliOptions: {}, stateDir, lines: 2 },
      { stdout, stderr }
    );

    expect(exitCode).toBe(0);
    expect(stdout.text()).toBe('two\nthree\n');

    stdout = createCapturedStream();
    stderr = createCapturedStream();
    const missingCode = await runDaemonCommand(
      { action: 'logs', cliOptions: { logFile: join(stateDir, 'missing.log') }, stateDir },
      { stdout, stderr }
    );

    expect(missingCode).toBe(1);
    expect(stderr.text()).toContain('Cannot read daemon log');
  });

  it('parses daemon commands through the utility dispatcher', async () => {
    const result = await handleDaemonCommand(
      ['node', 'remnote-mcp-server', 'daemon', 'status', '--state-dir', stateDir],
      {
        isProcessAlive: () => false,
        canBind: vi.fn().mockResolvedValue(true),
        stdout,
        stderr,
      }
    );

    expect(result).toEqual({ exitCode: 1, handled: true });
    expect(stdout.text()).toContain('not running');
  });

  it('returns concise parse errors for invalid daemon invocations', async () => {
    const result = await handleDaemonCommand(
      ['node', 'remnote-mcp-server', 'daemon', 'start', '--http-port'],
      { stdout, stderr }
    );

    expect(result).toEqual({ exitCode: 1, handled: true });
    expect(stderr.text()).toContain('Missing value for --http-port');
  });

  it('validates daemon command options before execution', async () => {
    const invalidInvocations = [
      {
        argv: ['node', 'remnote-mcp-server', 'daemon', 'start', '--http-port', '0'],
        message: 'Invalid value for --http-port',
      },
      {
        argv: ['node', 'remnote-mcp-server', 'daemon', 'logs', '--lines', '0'],
        message: 'Invalid value for --lines',
      },
      {
        argv: ['node', 'remnote-mcp-server', 'daemon', 'start', '--log-level', 'noisy'],
        message: 'Invalid log level',
      },
      {
        argv: ['node', 'remnote-mcp-server', 'daemon', 'status', '--http-host', 'bad-host'],
        message: 'Invalid host',
      },
      {
        argv: ['node', 'remnote-mcp-server', 'daemon', 'status', '--http-host', '127.0.0.999'],
        message: 'Invalid host',
      },
      {
        argv: ['node', 'remnote-mcp-server', 'daemon', 'nonsense'],
        message: 'Usage: remnote-mcp-server daemon',
      },
      {
        argv: ['node', 'remnote-mcp-server', 'daemon', 'start', '--unknown'],
        message: 'Unknown daemon option',
      },
    ];

    for (const invocation of invalidInvocations) {
      stderr = createCapturedStream();
      const result = await handleDaemonCommand(invocation.argv, { stdout, stderr });
      expect(result).toEqual({ exitCode: 1, handled: true });
      expect(stderr.text()).toContain(invocation.message);
    }
  });

  it('resolves tilde state directories', () => {
    const paths = getDefaultDaemonPaths('/Users/tester', '~/.custom-remnote');
    expect(paths.stateDir).toBe(join('/Users/tester', '.custom-remnote'));
  });

  it('installs a macOS LaunchAgent for login persistence', async () => {
    const execFile = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });

    const exitCode = await runDaemonCommand(
      {
        action: 'install-launchd',
        cliOptions: { httpPort: 4001, wsPort: 4002, logLevel: 'warn' },
        stateDir,
      },
      {
        platform: 'darwin',
        uid: 501,
        homeDir: stateDir,
        entrypointPath: '/opt/remnote-mcp-server/dist/index.js',
        execPath: '/usr/local/bin/node',
        execFile: execFile as never,
        stdout,
        stderr,
      }
    );

    expect(exitCode).toBe(0);
    expect(execFile).toHaveBeenCalledWith('launchctl', [
      'bootstrap',
      'gui/501',
      join(stateDir, 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`),
    ]);
    expect(execFile).toHaveBeenCalledWith('launchctl', [
      'kickstart',
      '-k',
      `gui/501/${LAUNCHD_LABEL}`,
    ]);

    const plist = await readFile(
      join(stateDir, 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`),
      'utf8'
    );
    expect(plist).toContain('<key>KeepAlive</key>');
    expect(plist).toContain('<string>/usr/local/bin/node</string>');
    expect(plist).toContain('<string>4001</string>');
    expect(plist).toContain('<string>4002</string>');
    expect(plist).toContain(join(stateDir, 'remnote-mcp-server.log'));
  });

  it('installs a macOS LaunchAgent with TOML server logging defaults', async () => {
    const configPath = join(stateDir, 'config.toml');
    const daemonLog = join(stateDir, 'daemon-debug.log');
    await writeFile(
      configPath,
      [
        '[server]',
        'logLevel = "debug"',
        'requestLog = "/tmp/requests.jsonl"',
        'responseLog = "/tmp/responses.jsonl"',
        '',
        '[daemon]',
        `logFile = "${daemonLog}"`,
        '',
      ].join('\n'),
      'utf8'
    );
    const execFile = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });

    const exitCode = await runDaemonCommand(
      { action: 'install-launchd', cliOptions: { config: configPath }, stateDir },
      {
        platform: 'darwin',
        uid: 501,
        homeDir: stateDir,
        entrypointPath: '/opt/remnote-mcp-server/dist/index.js',
        execPath: '/usr/local/bin/node',
        execFile: execFile as never,
        stdout,
        stderr,
      }
    );

    expect(exitCode).toBe(0);
    const plist = await readFile(
      join(stateDir, 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`),
      'utf8'
    );
    expect(plist).toContain('<string>--log-level</string>');
    expect(plist).toContain('<string>debug</string>');
    expect(plist).toContain('<string>--request-log</string>');
    expect(plist).toContain('<string>/tmp/requests.jsonl</string>');
    expect(plist).toContain('<string>--response-log</string>');
    expect(plist).toContain('<string>/tmp/responses.jsonl</string>');
    expect(plist).toContain(daemonLog);
  });

  it('uses launchd for status when the macOS LaunchAgent is installed', async () => {
    await writeLaunchAgent();
    const execFile = vi.fn().mockResolvedValue({
      stdout: `service = ${LAUNCHD_LABEL}\n\tpid = 2468\n`,
      stderr: '',
    });

    const exitCode = await runDaemonCommand(
      { action: 'status', cliOptions: {}, stateDir },
      {
        platform: 'darwin',
        uid: 501,
        homeDir: stateDir,
        execFile: execFile as never,
        stdout,
        stderr,
      }
    );

    expect(exitCode).toBe(0);
    expect(stdout.text()).toContain('launchd=installed loaded=true running=true pid=2468');
    expect(execFile).toHaveBeenCalledWith('launchctl', ['print', `gui/501/${LAUNCHD_LABEL}`]);
  });

  it('starts an installed but unloaded macOS LaunchAgent through launchd', async () => {
    await writeLaunchAgent();
    let printCount = 0;
    const execFile = vi.fn().mockImplementation(async (_command: string, args: string[]) => {
      if (args[0] === 'print') {
        printCount += 1;
        if (printCount === 1) {
          throw new Error('not loaded');
        }
        return { stdout: 'pid = 3579\n', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });

    const exitCode = await runDaemonCommand(
      { action: 'start', cliOptions: {}, stateDir },
      {
        platform: 'darwin',
        uid: 501,
        homeDir: stateDir,
        execFile: execFile as never,
        stdout,
        stderr,
      }
    );

    const launchAgentFile = join(stateDir, 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
    expect(exitCode).toBe(0);
    expect(stdout.text()).toContain('launchd service started pid 3579');
    expect(execFile).toHaveBeenCalledWith('launchctl', ['bootstrap', 'gui/501', launchAgentFile]);
    expect(execFile).toHaveBeenCalledWith('launchctl', ['enable', `gui/501/${LAUNCHD_LABEL}`]);
    expect(execFile).toHaveBeenCalledWith('launchctl', ['kickstart', `gui/501/${LAUNCHD_LABEL}`]);
  });

  it('does not restart an already running macOS LaunchAgent on start', async () => {
    await writeLaunchAgent();
    const execFile = vi.fn().mockResolvedValue({ stdout: 'pid = 3579\n', stderr: '' });

    const exitCode = await runDaemonCommand(
      { action: 'start', cliOptions: {}, stateDir },
      {
        platform: 'darwin',
        uid: 501,
        homeDir: stateDir,
        execFile: execFile as never,
        stdout,
        stderr,
      }
    );

    expect(exitCode).toBe(0);
    expect(stdout.text()).toContain('launchd service already running pid 3579');
    expect(execFile).not.toHaveBeenCalledWith('launchctl', ['kickstart', expect.any(String)]);
  });

  it('stops an installed macOS LaunchAgent through launchd', async () => {
    await writeLaunchAgent();
    const execFile = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });

    const exitCode = await runDaemonCommand(
      { action: 'stop', cliOptions: {}, stateDir },
      {
        platform: 'darwin',
        uid: 501,
        homeDir: stateDir,
        execFile: execFile as never,
        stdout,
        stderr,
      }
    );

    expect(exitCode).toBe(0);
    expect(stdout.text()).toContain('launchd service stopped');
    expect(execFile).toHaveBeenCalledWith('launchctl', [
      'bootout',
      'gui/501',
      join(stateDir, 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`),
    ]);
  });

  it('restarts an installed macOS LaunchAgent through launchd', async () => {
    await writeLaunchAgent();
    const execFile = vi.fn().mockImplementation(async (_command: string, args: string[]) => {
      if (args[0] === 'print') {
        throw new Error('not loaded');
      }
      return { stdout: '', stderr: '' };
    });

    const exitCode = await runDaemonCommand(
      { action: 'restart', cliOptions: {}, stateDir },
      {
        platform: 'darwin',
        uid: 501,
        homeDir: stateDir,
        execFile: execFile as never,
        stdout,
        stderr,
      }
    );

    expect(exitCode).toBe(0);
    expect(execFile).toHaveBeenCalledWith('launchctl', [
      'bootout',
      'gui/501',
      join(stateDir, 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`),
    ]);
    expect(execFile).toHaveBeenCalledWith('launchctl', [
      'bootstrap',
      'gui/501',
      join(stateDir, 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`),
    ]);
    expect(execFile).toHaveBeenCalledWith('launchctl', ['kickstart', `gui/501/${LAUNCHD_LABEL}`]);
  });

  it('surfaces launchctl failures during macOS LaunchAgent install', async () => {
    const execFile = vi.fn().mockImplementation(async (_command: string, args: string[]) => {
      if (args[0] === 'bootstrap') {
        throw new Error('bootstrap failed');
      }
      return { stdout: '', stderr: '' };
    });

    const exitCode = await runDaemonCommand(
      { action: 'install-launchd', cliOptions: {}, stateDir },
      {
        platform: 'darwin',
        uid: 501,
        homeDir: stateDir,
        entrypointPath: '/opt/remnote-mcp-server/dist/index.js',
        execPath: '/usr/local/bin/node',
        execFile: execFile as never,
        stdout,
        stderr,
      }
    );

    expect(exitCode).toBe(1);
    expect(stderr.text()).toContain('bootstrap failed');
  });

  it('uninstalls the macOS LaunchAgent', async () => {
    const execFile = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const launchAgentFile = join(stateDir, 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
    await mkdir(join(stateDir, 'Library', 'LaunchAgents'), { recursive: true });
    await writeFile(launchAgentFile, '<plist />', 'utf8');

    const exitCode = await runDaemonCommand(
      { action: 'uninstall-launchd', cliOptions: {}, stateDir },
      {
        platform: 'darwin',
        uid: 501,
        homeDir: stateDir,
        execFile: execFile as never,
        stdout,
        stderr,
      }
    );

    expect(exitCode).toBe(0);
    expect(execFile).toHaveBeenCalledWith('launchctl', ['bootout', 'gui/501', launchAgentFile]);
    await expect(readFile(launchAgentFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects launchd commands on non-macOS platforms', async () => {
    const exitCode = await runDaemonCommand(
      { action: 'install-launchd', cliOptions: {}, stateDir },
      {
        platform: 'linux',
        stdout,
        stderr,
      }
    );

    expect(exitCode).toBe(1);
    expect(stderr.text()).toContain('launchd permanence is only available on macOS');
  });

  async function writeState(overrides: Partial<DaemonState>): Promise<void> {
    const state: DaemonState = {
      pid: 9999,
      startedAt: new Date().toISOString(),
      entrypointPath: '/opt/remnote-mcp-server/dist/index.js',
      logFile: join(stateDir, 'remnote-mcp-server.log'),
      httpPort: 3001,
      httpHost: '127.0.0.1',
      wsPort: 3002,
      wsHost: '127.0.0.1',
      ...overrides,
    };
    await writeFile(join(stateDir, DAEMON_PID_FILE_NAME), `${state.pid}\n`, 'utf8');
    await writeFile(join(stateDir, DAEMON_STATE_FILE_NAME), `${JSON.stringify(state)}\n`, 'utf8');
  }

  async function writeLaunchAgent(): Promise<void> {
    const launchAgentDir = join(stateDir, 'Library', 'LaunchAgents');
    await mkdir(launchAgentDir, { recursive: true });
    await writeFile(join(launchAgentDir, `${LAUNCHD_LABEL}.plist`), '<plist />', 'utf8');
  }
});

interface CapturedStream {
  write: (chunk: string | Uint8Array) => boolean;
  text: () => string;
}

function createCapturedStream(): CapturedStream {
  const chunks: string[] = [];
  return {
    write: (chunk) => {
      chunks.push(String(chunk));
      return true;
    },
    text: () => chunks.join(''),
  };
}
