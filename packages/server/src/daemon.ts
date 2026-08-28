import { spawn, execFile } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { mkdir, open, readFile, rm, stat, writeFile, type FileHandle } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir, platform as osPlatform } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { CliOptions } from './cli.js';
import { getConfig, loadConfigFileOptions, type ServerConfig } from './config.js';

const execFileAsync = promisify(execFile);

export const DEFAULT_DAEMON_DIR_NAME = '.remnote-mcp-server';
export const DAEMON_PID_FILE_NAME = 'remnote-mcp-server.pid';
export const DAEMON_STATE_FILE_NAME = 'daemon.json';
export const DAEMON_LOG_FILE_NAME = 'remnote-mcp-server.log';
export const LAUNCHD_LABEL = 'com.remnote.mcp-server';

const DEFAULT_START_TIMEOUT_MS = 5000;
const DEFAULT_STOP_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 100;

export interface DaemonCommand {
  action: DaemonAction;
  cliOptions: CliOptions;
  stateDir?: string;
  timeoutMs?: number;
  force?: boolean;
  lines?: number;
}

export type DaemonAction =
  'start' | 'stop' | 'restart' | 'status' | 'logs' | 'install-launchd' | 'uninstall-launchd';

export interface DaemonState {
  pid: number;
  startedAt: string;
  entrypointPath: string;
  logFile: string;
  httpPort: number;
  httpHost: string;
  wsPort: number;
  wsHost: string;
}

export interface DaemonPaths {
  stateDir: string;
  pidFile: string;
  stateFile: string;
  logFile: string;
  lockFile: string;
  launchAgentFile: string;
}

export interface DaemonRuntime {
  argv?: string[];
  entrypointPath?: string;
  execPath?: string;
  homeDir?: string;
  platform?: NodeJS.Platform;
  uid?: number;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
  isProcessAlive?: (pid: number) => boolean;
  canBind?: (host: string, port: number) => Promise<boolean>;
  getProcessCommand?: (pid: number) => Promise<string | null>;
  spawnProcess?: typeof spawn;
  execFile?: typeof execFileAsync;
  killProcess?: (pid: number, signal: NodeJS.Signals) => void;
}

export interface DaemonResult {
  exitCode: number;
  handled: true;
}

interface ParsedDaemonOptions {
  action: DaemonAction;
  cliOptions: CliOptions;
  stateDir?: string;
  timeoutMs?: number;
  force?: boolean;
  lines?: number;
}

interface AcquiredLock {
  release: () => Promise<void>;
}

interface LaunchdStatus {
  installed: boolean;
  loaded: boolean;
  running: boolean;
  pid?: number;
}

export function getDefaultDaemonPaths(homeDir = homedir(), stateDir?: string): DaemonPaths {
  const resolvedStateDir = resolveTilde(
    stateDir ?? join(homeDir, DEFAULT_DAEMON_DIR_NAME),
    homeDir
  );
  return {
    stateDir: resolvedStateDir,
    pidFile: join(resolvedStateDir, DAEMON_PID_FILE_NAME),
    stateFile: join(resolvedStateDir, DAEMON_STATE_FILE_NAME),
    logFile: join(resolvedStateDir, DAEMON_LOG_FILE_NAME),
    lockFile: join(resolvedStateDir, `${DAEMON_PID_FILE_NAME}.lock`),
    launchAgentFile: join(homeDir, 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`),
  };
}

export function isDaemonCommand(argv = process.argv): boolean {
  return argv[2] === 'daemon';
}

export async function handleDaemonCommand(
  argv = process.argv,
  runtime: DaemonRuntime = {}
): Promise<DaemonResult> {
  if (argv[3] === '--help' || argv[3] === '-h') {
    (runtime.stdout ?? process.stdout).write(formatDaemonUsage());
    return { exitCode: 0, handled: true };
  }

  try {
    const parsed = parseDaemonCommand(argv);
    const result = await runDaemonCommand(parsed, runtime);
    return { exitCode: result, handled: true };
  } catch (error) {
    (runtime.stderr ?? process.stderr).write(`${formatError(error)}\n`);
    return { exitCode: 1, handled: true };
  }
}

export function formatDaemonUsage(): string {
  return `Usage:
  remnote-mcp-server daemon start [options]
  remnote-mcp-server daemon stop [--force] [--timeout-ms <ms>]
  remnote-mcp-server daemon restart [options]
  remnote-mcp-server daemon status [options]
  remnote-mcp-server daemon logs [--lines <n>]
  remnote-mcp-server daemon install-launchd [options]
  remnote-mcp-server daemon uninstall-launchd

Daemon options:
  --state-dir <path>       State directory (default: ~/.remnote-mcp-server)
  --log-file <path>        Daemon stdout/stderr log path (default: ~/.remnote-mcp-server/remnote-mcp-server.log)
  --timeout-ms <ms>        Start/stop wait timeout
  --force                 Force stop after graceful shutdown timeout
  --lines, -n <n>          Number of log lines to print

Server options accepted by start/restart/install-launchd:
  --http-port <number> --ws-port <number> --http-host <host>
  --config <path> --log-level <level> --verbose --request-log <path> --response-log <path>
`;
}

export async function runDaemonCommand(
  command: DaemonCommand,
  runtime: DaemonRuntime = {}
): Promise<number> {
  const homeDir = runtime.homeDir ?? homedir();
  const paths = getDefaultDaemonPaths(homeDir, command.stateDir);
  const stdout = runtime.stdout ?? process.stdout;
  const stderr = runtime.stderr ?? process.stderr;
  const isProcessAlive = runtime.isProcessAlive ?? defaultIsProcessAlive;
  const getProcessCommand = runtime.getProcessCommand ?? defaultGetProcessCommand;

  try {
    const useLaunchd = await shouldUseLaunchd(paths, runtime);
    switch (command.action) {
      case 'start':
        if (useLaunchd) {
          return await startLaunchd(paths, runtime);
        }
        return await startDaemon(command, paths, runtime);
      case 'stop':
        if (useLaunchd) {
          return await stopLaunchd(paths, runtime);
        }
        return await stopDaemon(command, paths, {
          isProcessAlive,
          getProcessCommand,
          stdout,
          stderr,
          killProcess: runtime.killProcess ?? process.kill,
        });
      case 'restart': {
        if (useLaunchd) {
          return await restartLaunchd(paths, runtime);
        }
        const stopCode = await stopDaemon({ ...command, action: 'stop' }, paths, {
          isProcessAlive,
          getProcessCommand,
          stdout,
          stderr,
          killProcess: runtime.killProcess ?? process.kill,
        });
        if (stopCode !== 0) {
          return stopCode;
        }
        return await startDaemon({ ...command, action: 'start' }, paths, runtime);
      }
      case 'status':
        if (useLaunchd) {
          return await printLaunchdStatus(paths, runtime);
        }
        return await printDaemonStatus(command, paths, {
          isProcessAlive,
          canBind: runtime.canBind ?? canBind,
          stdout,
        });
      case 'logs':
        return await printDaemonLogs(command, paths, stdout, stderr);
      case 'install-launchd':
        return await installLaunchd(command, paths, runtime);
      case 'uninstall-launchd':
        return await uninstallLaunchd(paths, runtime);
    }
  } catch (error) {
    stderr.write(`${formatError(error)}\n`);
    return 1;
  }
}

function parseDaemonCommand(argv: string[]): ParsedDaemonOptions {
  const [, , daemon, actionArg, ...rawArgs] = argv;
  if (daemon !== 'daemon') {
    throw new Error('Not a daemon command');
  }

  const action = parseDaemonAction(actionArg);
  const cliOptions: CliOptions = {};
  let stateDir: string | undefined;
  let timeoutMs: number | undefined;
  let force = false;
  let lines: number | undefined;

  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    const next = () => {
      const value = rawArgs[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${arg}`);
      }
      i += 1;
      return value;
    };

    switch (arg) {
      case '--http-port':
        cliOptions.httpPort = parsePort(next(), arg);
        break;
      case '--ws-port':
        cliOptions.wsPort = parsePort(next(), arg);
        break;
      case '--http-host':
        cliOptions.httpHost = validateHost(next());
        break;
      case '--config':
        cliOptions.config = next();
        break;
      case '--log-level':
        cliOptions.logLevel = validateLogLevel(next());
        break;
      case '--log-file':
        cliOptions.logFile = next();
        break;
      case '--request-log':
        cliOptions.requestLog = next();
        break;
      case '--response-log':
        cliOptions.responseLog = next();
        break;
      case '--verbose':
        cliOptions.verbose = true;
        break;
      case '--state-dir':
        stateDir = next();
        break;
      case '--timeout-ms':
        timeoutMs = parsePositiveInteger(next(), arg);
        break;
      case '--force':
        force = true;
        break;
      case '--lines':
        lines = parsePositiveInteger(next(), arg);
        break;
      case '-n':
        lines = parsePositiveInteger(next(), arg);
        break;
      default:
        throw new Error(`Unknown daemon option: ${arg}`);
    }
  }

  return { action, cliOptions, stateDir, timeoutMs, force, lines };
}

function parseDaemonAction(value?: string): DaemonAction {
  switch (value) {
    case 'start':
    case 'stop':
    case 'restart':
    case 'status':
    case 'logs':
    case 'install-launchd':
    case 'uninstall-launchd':
      return value;
    default:
      throw new Error(
        'Usage: remnote-mcp-server daemon <start|stop|restart|status|logs|install-launchd|uninstall-launchd>'
      );
  }
}

async function startDaemon(
  command: DaemonCommand,
  paths: DaemonPaths,
  runtime: DaemonRuntime
): Promise<number> {
  await mkdir(paths.stateDir, { recursive: true });
  const lock = await acquireLock(paths.lockFile);

  try {
    const isProcessAlive = runtime.isProcessAlive ?? defaultIsProcessAlive;
    const existingState = await readDaemonState(paths);
    if (existingState && isProcessAlive(existingState.pid)) {
      (runtime.stdout ?? process.stdout).write(
        `remnote-mcp-server daemon already running (pid ${existingState.pid})\n`
      );
      return 0;
    }

    await cleanupStaleState(paths);

    const config = getConfig(
      {
        ...command.cliOptions,
        logFile: undefined,
        logLevelFile: undefined,
      },
      { homeDir: runtime.homeDir }
    );
    const logFile = getDaemonLogFile(command, paths, runtime);

    const bindCheck = runtime.canBind ?? canBind;
    await assertPortAvailable(config.httpHost, config.httpPort, 'HTTP', bindCheck);
    await assertPortAvailable(config.wsHost, config.wsPort, 'WebSocket', bindCheck);

    await mkdir(dirname(logFile), { recursive: true });
    const logHandle = await open(logFile, 'a');
    const entrypointPath = resolveEntrypointPath(runtime);
    const childArgs = [entrypointPath, ...serverArgsFromConfig(config)];
    const child = (runtime.spawnProcess ?? spawn)(runtime.execPath ?? process.execPath, childArgs, {
      detached: true,
      stdio: ['ignore', logHandle.fd, logHandle.fd],
      env: process.env,
      windowsHide: true,
    });
    if (!child.pid) {
      throw new Error('Failed to start daemon process: child pid was not assigned');
    }

    child.unref();
    await logHandle.close();

    const state: DaemonState = {
      pid: child.pid,
      startedAt: new Date().toISOString(),
      entrypointPath,
      logFile,
      httpPort: config.httpPort,
      httpHost: config.httpHost,
      wsPort: config.wsPort,
      wsHost: config.wsHost,
    };

    await writeDaemonState(paths, state);
    try {
      await waitForProcessOrPort(state, command.timeoutMs ?? DEFAULT_START_TIMEOUT_MS, runtime);
    } catch (error) {
      try {
        (runtime.killProcess ?? process.kill)(state.pid, 'SIGTERM');
      } catch {
        // Startup failure cleanup is best-effort; preserve the original error.
      }
      await cleanupStaleState(paths);
      throw error;
    }

    (runtime.stdout ?? process.stdout).write(
      `remnote-mcp-server daemon started (pid ${state.pid}, log ${state.logFile})\n`
    );
    return 0;
  } finally {
    await lock.release();
  }
}

async function stopDaemon(
  command: DaemonCommand,
  paths: DaemonPaths,
  runtime: Required<
    Pick<
      DaemonRuntime,
      'isProcessAlive' | 'getProcessCommand' | 'stdout' | 'stderr' | 'killProcess'
    >
  >
): Promise<number> {
  const state = await readDaemonState(paths);
  if (!state || !runtime.isProcessAlive(state.pid)) {
    await cleanupStaleState(paths);
    runtime.stdout.write('remnote-mcp-server daemon is not running\n');
    return 0;
  }

  await assertManagedProcess(state, runtime.getProcessCommand);
  runtime.killProcess(state.pid, 'SIGTERM');
  const stopped = await waitUntilStopped(
    state.pid,
    command.timeoutMs ?? DEFAULT_STOP_TIMEOUT_MS,
    runtime.isProcessAlive
  );

  if (!stopped && command.force) {
    runtime.killProcess(state.pid, 'SIGKILL');
    await waitUntilStopped(
      state.pid,
      command.timeoutMs ?? DEFAULT_STOP_TIMEOUT_MS,
      runtime.isProcessAlive
    );
  } else if (!stopped) {
    runtime.stderr.write(
      `Timed out waiting for daemon pid ${state.pid} to stop; retry with --force\n`
    );
    return 1;
  }

  await cleanupStaleState(paths);
  runtime.stdout.write(`remnote-mcp-server daemon stopped (pid ${state.pid})\n`);
  return 0;
}

async function printDaemonStatus(
  command: DaemonCommand,
  paths: DaemonPaths,
  runtime: Required<Pick<DaemonRuntime, 'isProcessAlive' | 'canBind' | 'stdout'>>
): Promise<number> {
  const state = await readDaemonState(paths);
  const config = getConfig(command.cliOptions);
  const httpOccupied = !(await runtime.canBind(config.httpHost, config.httpPort));
  const wsOccupied = !(await runtime.canBind(config.wsHost, config.wsPort));
  const launchdInstalled = await fileExists(paths.launchAgentFile);

  if (state && runtime.isProcessAlive(state.pid)) {
    runtime.stdout.write(
      [
        `running pid=${state.pid}`,
        `http=${state.httpHost}:${state.httpPort}`,
        `ws=${state.wsHost}:${state.wsPort}`,
        `log=${state.logFile}`,
        `launchd=${launchdInstalled ? 'installed' : 'not-installed'}`,
      ].join(' ') + '\n'
    );
    return 0;
  }

  if (state) {
    runtime.stdout.write(`not running (stale pid ${state.pid})\n`);
    return 1;
  }

  runtime.stdout.write(
    [
      'not running',
      `http_port=${httpOccupied ? 'occupied' : 'free'}`,
      `ws_port=${wsOccupied ? 'occupied' : 'free'}`,
      `launchd=${launchdInstalled ? 'installed' : 'not-installed'}`,
    ].join(' ') + '\n'
  );
  return 1;
}

async function printDaemonLogs(
  command: DaemonCommand,
  paths: DaemonPaths,
  stdout: Pick<NodeJS.WriteStream, 'write'>,
  stderr: Pick<NodeJS.WriteStream, 'write'>
): Promise<number> {
  const state = await readDaemonState(paths);
  const logFile = resolveTilde(command.cliOptions.logFile ?? state?.logFile ?? paths.logFile);

  try {
    const contents = await readFile(logFile, 'utf8');
    const lines = contents.trimEnd().split('\n');
    const selected = lines.slice(-(command.lines ?? 80)).join('\n');
    if (selected) {
      stdout.write(`${selected}\n`);
    }
    return 0;
  } catch (error) {
    stderr.write(`Cannot read daemon log at ${logFile}: ${formatError(error)}\n`);
    return 1;
  }
}

async function installLaunchd(
  command: DaemonCommand,
  paths: DaemonPaths,
  runtime: DaemonRuntime
): Promise<number> {
  const currentPlatform = runtime.platform ?? osPlatform();
  if (currentPlatform !== 'darwin') {
    throw new Error('launchd permanence is only available on macOS');
  }

  const config = getConfig(
    { ...command.cliOptions, logFile: undefined, logLevelFile: undefined },
    { homeDir: runtime.homeDir }
  );
  const logFile = getDaemonLogFile(command, paths, runtime);
  await mkdir(paths.stateDir, { recursive: true });
  await mkdir(dirname(paths.launchAgentFile), { recursive: true });
  await mkdir(dirname(logFile), { recursive: true });

  const entrypointPath = resolveEntrypointPath(runtime);
  const plist = renderLaunchdPlist({
    label: LAUNCHD_LABEL,
    execPath: runtime.execPath ?? process.execPath,
    entrypointPath,
    args: serverArgsFromConfig(config),
    logFile,
    workingDirectory: dirname(entrypointPath),
  });

  await writeFile(paths.launchAgentFile, plist, 'utf8');
  const exec = runtime.execFile ?? execFileAsync;
  const domain = getLaunchdDomain(runtime);

  await execLaunchctl(exec, ['bootout', domain, paths.launchAgentFile], true);
  await execLaunchctl(exec, ['bootstrap', domain, paths.launchAgentFile], false);
  await execLaunchctl(exec, ['enable', getLaunchdServiceTarget(runtime)], false);
  await execLaunchctl(exec, ['kickstart', '-k', getLaunchdServiceTarget(runtime)], false);

  (runtime.stdout ?? process.stdout).write(
    `Installed launchd agent ${LAUNCHD_LABEL} (${paths.launchAgentFile})\n`
  );
  return 0;
}

async function uninstallLaunchd(paths: DaemonPaths, runtime: DaemonRuntime): Promise<number> {
  const currentPlatform = runtime.platform ?? osPlatform();
  if (currentPlatform !== 'darwin') {
    throw new Error('launchd permanence is only available on macOS');
  }

  const exec = runtime.execFile ?? execFileAsync;
  const domain = getLaunchdDomain(runtime);
  await execLaunchctl(exec, ['bootout', domain, paths.launchAgentFile], true);
  await rm(paths.launchAgentFile, { force: true });
  (runtime.stdout ?? process.stdout).write(`Uninstalled launchd agent ${LAUNCHD_LABEL}\n`);
  return 0;
}

async function shouldUseLaunchd(paths: DaemonPaths, runtime: DaemonRuntime): Promise<boolean> {
  return (
    (runtime.platform ?? osPlatform()) === 'darwin' && (await fileExists(paths.launchAgentFile))
  );
}

async function startLaunchd(paths: DaemonPaths, runtime: DaemonRuntime): Promise<number> {
  const exec = runtime.execFile ?? execFileAsync;
  const status = await getLaunchdStatus(paths, runtime);
  if (status.running) {
    const pidText = status.pid ? ` pid ${status.pid}` : '';
    (runtime.stdout ?? process.stdout).write(`launchd service already running${pidText}\n`);
    return 0;
  }

  if (!status.loaded) {
    await execLaunchctl(
      exec,
      ['bootstrap', getLaunchdDomain(runtime), paths.launchAgentFile],
      false
    );
  }

  await execLaunchctl(exec, ['enable', getLaunchdServiceTarget(runtime)], false);
  await execLaunchctl(exec, ['kickstart', getLaunchdServiceTarget(runtime)], false);
  const updatedStatus = await getLaunchdStatus(paths, runtime);
  const pidText = updatedStatus.pid ? ` pid ${updatedStatus.pid}` : '';
  (runtime.stdout ?? process.stdout).write(`launchd service started${pidText}\n`);
  return 0;
}

async function stopLaunchd(paths: DaemonPaths, runtime: DaemonRuntime): Promise<number> {
  await execLaunchctl(
    runtime.execFile ?? execFileAsync,
    ['bootout', getLaunchdDomain(runtime), paths.launchAgentFile],
    true
  );
  (runtime.stdout ?? process.stdout).write(`launchd service stopped (${LAUNCHD_LABEL})\n`);
  return 0;
}

async function restartLaunchd(paths: DaemonPaths, runtime: DaemonRuntime): Promise<number> {
  await stopLaunchd(paths, runtime);
  return await startLaunchd(paths, runtime);
}

async function printLaunchdStatus(paths: DaemonPaths, runtime: DaemonRuntime): Promise<number> {
  const status = await getLaunchdStatus(paths, runtime);
  const parts = [
    'launchd=installed',
    `loaded=${status.loaded ? 'true' : 'false'}`,
    `running=${status.running ? 'true' : 'false'}`,
  ];

  if (status.pid) {
    parts.push(`pid=${status.pid}`);
  }

  parts.push(`plist=${paths.launchAgentFile}`);
  parts.push(`log=${paths.logFile}`);
  (runtime.stdout ?? process.stdout).write(`${parts.join(' ')}\n`);
  return status.running ? 0 : 1;
}

async function getLaunchdStatus(
  paths: DaemonPaths,
  runtime: DaemonRuntime
): Promise<LaunchdStatus> {
  if (!(await fileExists(paths.launchAgentFile))) {
    return { installed: false, loaded: false, running: false };
  }

  try {
    const { stdout } = await (runtime.execFile ?? execFileAsync)('launchctl', [
      'print',
      getLaunchdServiceTarget(runtime),
    ]);
    const pid = parseLaunchdPid(stdout);
    return {
      installed: true,
      loaded: true,
      running: pid !== undefined,
      pid,
    };
  } catch {
    return { installed: true, loaded: false, running: false };
  }
}

function renderLaunchdPlist({
  label,
  execPath,
  entrypointPath,
  args,
  logFile,
  workingDirectory,
}: {
  label: string;
  execPath: string;
  entrypointPath: string;
  args: string[];
  logFile: string;
  workingDirectory: string;
}): string {
  const programArguments = [execPath, entrypointPath, ...args]
    .map((arg) => `    <string>${escapeXml(arg)}</string>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(label)}</string>
  <key>ProgramArguments</key>
  <array>
${programArguments}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>${escapeXml(workingDirectory)}</string>
  <key>StandardOutPath</key>
  <string>${escapeXml(logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(logFile)}</string>
</dict>
</plist>
`;
}

function serverArgsFromConfig(config: ServerConfig): string[] {
  const args = [
    '--http-port',
    String(config.httpPort),
    '--ws-port',
    String(config.wsPort),
    '--http-host',
    config.httpHost,
    '--log-level',
    config.logLevel,
  ];

  if (config.requestLog) {
    args.push('--request-log', config.requestLog);
  }
  if (config.responseLog) {
    args.push('--response-log', config.responseLog);
  }

  return args;
}

function getDaemonLogFile(
  command: DaemonCommand,
  paths: DaemonPaths,
  runtime: DaemonRuntime
): string {
  const configFile = loadConfigFileOptions(command.cliOptions.config, { homeDir: runtime.homeDir });
  return resolveTilde(
    command.cliOptions.logFile ?? configFile.daemon?.logFile ?? paths.logFile,
    runtime.homeDir
  );
}

async function acquireLock(lockFile: string): Promise<AcquiredLock> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(lockFile, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_RDWR);
    await handle.writeFile(String(process.pid));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('Another remnote-mcp-server daemon command is already running', {
        cause: error,
      });
    }
    throw error;
  }

  return {
    release: async () => {
      await handle?.close();
      await rm(lockFile, { force: true });
    },
  };
}

async function readDaemonState(paths: DaemonPaths): Promise<DaemonState | null> {
  try {
    const raw = await readFile(paths.stateFile, 'utf8');
    const parsed = JSON.parse(raw) as Partial<DaemonState>;
    if (typeof parsed.pid === 'number' && parsed.pid > 0) {
      return parsed as DaemonState;
    }
  } catch {
    // Fall back to the plain pid file for compatibility with manual cleanup.
  }

  try {
    const rawPid = (await readFile(paths.pidFile, 'utf8')).trim();
    const pid = Number(rawPid);
    if (Number.isInteger(pid) && pid > 0) {
      return {
        pid,
        startedAt: '',
        entrypointPath: '',
        logFile: paths.logFile,
        httpPort: 3001,
        httpHost: '127.0.0.1',
        wsPort: 3002,
        wsHost: '127.0.0.1',
      };
    }
  } catch {
    return null;
  }

  return null;
}

async function writeDaemonState(paths: DaemonPaths, state: DaemonState): Promise<void> {
  await writeFile(paths.pidFile, `${state.pid}\n`, 'utf8');
  await writeFile(paths.stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function cleanupStaleState(paths: DaemonPaths): Promise<void> {
  await rm(paths.pidFile, { force: true });
  await rm(paths.stateFile, { force: true });
}

async function waitForProcessOrPort(
  state: DaemonState,
  timeoutMs: number,
  runtime: DaemonRuntime
): Promise<void> {
  const isProcessAlive = runtime.isProcessAlive ?? defaultIsProcessAlive;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isProcessAlive(state.pid)) {
      throw new Error(
        `Daemon process ${state.pid} exited during startup; inspect ${state.logFile}`
      );
    }

    const bindCheck = runtime.canBind ?? canBind;
    const httpOccupied = !(await bindCheck(state.httpHost, state.httpPort));
    const wsOccupied = !(await bindCheck(state.wsHost, state.wsPort));
    if (httpOccupied && wsOccupied) {
      return;
    }

    await delay(POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for daemon startup; inspect ${state.logFile}`);
}

async function waitUntilStopped(
  pid: number,
  timeoutMs: number,
  isProcessAlive: (pid: number) => boolean
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isProcessAlive(pid)) {
      return true;
    }
    await delay(POLL_INTERVAL_MS);
  }

  return !isProcessAlive(pid);
}

async function assertManagedProcess(
  state: DaemonState,
  getProcessCommand: (pid: number) => Promise<string | null>
): Promise<void> {
  const command = await getProcessCommand(state.pid);
  if (!command || !state.entrypointPath) {
    return;
  }

  if (command.includes(state.entrypointPath) || command.includes(basename(state.entrypointPath))) {
    return;
  }

  throw new Error(
    `Refusing to stop pid ${state.pid}; it does not look like the managed remnote-mcp-server process`
  );
}

async function assertPortAvailable(
  host: string,
  port: number,
  label: string,
  bindCheck: (host: string, port: number) => Promise<boolean>
): Promise<void> {
  if (!(await bindCheck(host, port))) {
    throw new Error(`${label} port ${host}:${port} is already occupied`);
  }
}

async function canBind(host: string, port: number): Promise<boolean> {
  return new Promise((resolveBind) => {
    const server = createServer();
    server.once('error', () => resolveBind(false));
    server.listen(port, host, () => {
      server.close(() => resolveBind(true));
    });
  });
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function defaultGetProcessCommand(pid: number): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'command=']);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function execLaunchctl(
  exec: typeof execFileAsync,
  args: string[],
  ignoreFailure: boolean
): Promise<void> {
  try {
    await exec('launchctl', args);
  } catch (error) {
    if (!ignoreFailure) {
      throw error;
    }
  }
}

function getLaunchdDomain(runtime: DaemonRuntime): string {
  return `gui/${runtime.uid ?? process.getuid?.() ?? 501}`;
}

function getLaunchdServiceTarget(runtime: DaemonRuntime): string {
  return `${getLaunchdDomain(runtime)}/${LAUNCHD_LABEL}`;
}

function parseLaunchdPid(output: string): number | undefined {
  const match = output.match(/\bpid\s*=\s*(\d+)/);
  if (!match) {
    return undefined;
  }

  const pid = Number(match[1]);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function resolveEntrypointPath(runtime: DaemonRuntime): string {
  return resolve(runtime.entrypointPath ?? runtime.argv?.[1] ?? process.argv[1]);
}

function resolveTilde(path: string, homeDir = homedir()): string {
  if (path === '~') {
    return homeDir;
  }
  if (path.startsWith('~/')) {
    return join(homeDir, path.slice(2));
  }
  return resolve(path);
}

function parsePort(value: string, flag: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid value for ${flag}: ${value}. Must be between 1 and 65535.`);
  }
  return port;
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid value for ${flag}: ${value}. Must be a positive integer.`);
  }
  return parsed;
}

function validateLogLevel(value: string): string {
  const normalized = value.toLowerCase();
  if (!['debug', 'info', 'warn', 'error'].includes(normalized)) {
    throw new Error(`Invalid log level: ${value}`);
  }
  return normalized;
}

function validateHost(value: string): string {
  if (value === 'localhost' || value === '127.0.0.1' || value === '0.0.0.0') {
    return value;
  }

  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipv4Pattern.test(value)) {
    throw new Error(`Invalid host: ${value}`);
  }

  const octets = value.split('.').map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) {
    throw new Error(`Invalid host: ${value}`);
  }

  return value;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
