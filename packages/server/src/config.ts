import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { CliOptions } from './cli.js';

export interface ServerConfig {
  wsPort: number;
  wsHost: string;
  httpPort: number;
  httpHost: string;
  logLevel: string;
  logLevelFile?: string;
  logFile?: string;
  requestLog?: string;
  responseLog?: string;
  prettyLogs: boolean;
  mediaRoots: string[];
}

export interface ConfigFileOptions {
  server?: Partial<Omit<CliOptions, 'config'>>;
  daemon?: {
    logFile?: string;
  };
}

export interface ConfigLoadOptions {
  homeDir?: string;
}

export const CONFIG_FILE_NAME = 'config.toml';

/**
 * Merge CLI options with environment variables and apply defaults
 * Precedence: CLI > Environment Variables > Config File > Defaults
 */
export function getConfig(
  cliOptions: CliOptions,
  loadOptions: ConfigLoadOptions = {}
): ServerConfig {
  const homeDir = loadOptions.homeDir ?? homedir();
  const configFile = loadConfigFileOptions(cliOptions.config, loadOptions);
  const configOptions = configFile.server ?? {};

  // Apply verbose flag override
  let logLevel =
    cliOptions.logLevel ?? (configOptions.verbose ? 'debug' : configOptions.logLevel) ?? 'info';
  if (cliOptions.verbose) {
    logLevel = 'debug';
  }

  // Validate CLI port ranges before merging
  if (cliOptions.wsPort !== undefined && (cliOptions.wsPort < 1 || cliOptions.wsPort > 65535)) {
    throw new Error(`Invalid WebSocket port: ${cliOptions.wsPort}. Must be between 1 and 65535.`);
  }
  if (
    cliOptions.httpPort !== undefined &&
    (cliOptions.httpPort < 1 || cliOptions.httpPort > 65535)
  ) {
    throw new Error(`Invalid HTTP port: ${cliOptions.httpPort}. Must be between 1 and 65535.`);
  }

  // Get ports with CLI > env > default precedence
  const wsPort =
    cliOptions.wsPort ??
    parseOptionalPortEnv(process.env.REMNOTE_WS_PORT) ??
    configOptions.wsPort ??
    3002;
  const httpPort =
    cliOptions.httpPort ??
    parseOptionalPortEnv(process.env.REMNOTE_HTTP_PORT) ??
    configOptions.httpPort ??
    3001;

  // Get hosts with CLI > env > default precedence
  // SECURITY: WebSocket ALWAYS binds to localhost, regardless of env var or CLI option
  const wsHost = '127.0.0.1';
  const requestedHttpHost =
    cliOptions.httpHost ?? process.env.REMNOTE_HTTP_HOST ?? configOptions.httpHost ?? '127.0.0.1';
  if (requestedHttpHost !== '127.0.0.1' && requestedHttpHost !== 'localhost') {
    throw new Error(
      `RemNote Agent HTTP must bind to loopback; received ${requestedHttpHost}. Remote access is intentionally disabled.`
    );
  }
  const httpHost = '127.0.0.1';

  // Validate port conflicts
  if (wsPort === httpPort) {
    throw new Error(`WebSocket port and HTTP port cannot be the same (both set to ${wsPort})`);
  }

  const logFileOption = cliOptions.logFile ?? configOptions.logFile;
  const logFile = logFileOption ? resolveTilde(logFileOption, homeDir) : undefined;
  const requestLogOption = cliOptions.requestLog ?? configOptions.requestLog;
  const requestLog = requestLogOption ? resolveTilde(requestLogOption, homeDir) : undefined;
  const responseLogOption = cliOptions.responseLog ?? configOptions.responseLog;
  const responseLog = responseLogOption ? resolveTilde(responseLogOption, homeDir) : undefined;

  // File log level defaults to console log level if not specified
  const logLevelFile =
    cliOptions.logLevelFile ?? configOptions.logLevelFile ?? (logFile ? logLevel : undefined);

  // Pretty logs in development (when using pino-pretty)
  const prettyLogs = process.stdout.isTTY === true;
  const configuredMediaRoots = cliOptions.mediaRoots?.length
    ? cliOptions.mediaRoots
    : process.env.REMNOTE_MEDIA_ROOTS
      ? process.env.REMNOTE_MEDIA_ROOTS.split(delimiter).filter(Boolean)
      : configOptions.mediaRoots;
  const mediaRoots = (
    configuredMediaRoots?.length ? configuredMediaRoots : discoverDefaultMediaRoots(homeDir)
  ).map((entry) => resolveTilde(entry, homeDir));

  return {
    wsPort,
    wsHost,
    httpPort,
    httpHost,
    logLevel,
    logLevelFile,
    logFile,
    requestLog,
    responseLog,
    prettyLogs,
    mediaRoots,
  };
}

export function loadConfigFileOptions(
  configPath?: string,
  loadOptions: ConfigLoadOptions = {}
): ConfigFileOptions {
  const homeDir = loadOptions.homeDir ?? homedir();
  const resolvedPath = resolveTilde(
    configPath ?? join('~', '.remnote-agent', CONFIG_FILE_NAME),
    homeDir
  );
  const explicitPath = configPath !== undefined;

  if (!existsSync(resolvedPath)) {
    if (explicitPath) {
      throw new Error(`Config file not found: ${resolvedPath}`);
    }
    return {};
  }

  return parseConfigToml(readFileSync(resolvedPath, 'utf8'), resolvedPath);
}

export function parseConfigToml(source: string, filePath = CONFIG_FILE_NAME): ConfigFileOptions {
  const config: ConfigFileOptions = {};
  let section: 'server' | 'daemon' | undefined;

  source.split(/\r?\n/).forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = stripTomlComment(rawLine).trim();
    if (!line) {
      return;
    }

    const sectionMatch = line.match(/^\[([A-Za-z0-9_-]+)\]$/);
    if (sectionMatch) {
      const parsedSection = sectionMatch[1];
      if (parsedSection !== 'server' && parsedSection !== 'daemon') {
        throw new Error(`${filePath}:${lineNumber}: Unknown config section [${parsedSection}]`);
      }
      section = parsedSection;
      config[section] ??= {};
      return;
    }

    if (!section) {
      throw new Error(
        `${filePath}:${lineNumber}: Config values must be under [server] or [daemon]`
      );
    }

    const keyValueMatch = line.match(/^([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (!keyValueMatch) {
      throw new Error(`${filePath}:${lineNumber}: Invalid TOML assignment`);
    }

    const [, key, rawValue] = keyValueMatch;
    const value = parseTomlValue(rawValue.trim(), filePath, lineNumber);
    assignConfigValue(config, section, key, value, filePath, lineNumber);
  });

  return config;
}

function assignConfigValue(
  config: ConfigFileOptions,
  section: 'server' | 'daemon',
  key: string,
  value: string | number | boolean,
  filePath: string,
  lineNumber: number
): void {
  if (section === 'daemon') {
    if (key !== 'logFile') {
      throw new Error(`${filePath}:${lineNumber}: Unknown daemon config key "${key}"`);
    }
    config.daemon ??= {};
    config.daemon.logFile = expectString(value, filePath, lineNumber, key);
    return;
  }

  config.server ??= {};
  switch (key) {
    case 'wsPort':
      config.server.wsPort = expectPort(value, filePath, lineNumber, key);
      return;
    case 'httpPort':
      config.server.httpPort = expectPort(value, filePath, lineNumber, key);
      return;
    case 'httpHost':
      config.server.httpHost = validateHost(
        expectString(value, filePath, lineNumber, key),
        filePath,
        lineNumber
      );
      return;
    case 'logLevel':
      config.server.logLevel = validateLogLevel(
        expectString(value, filePath, lineNumber, key),
        filePath,
        lineNumber
      );
      return;
    case 'logLevelFile':
      config.server.logLevelFile = validateLogLevel(
        expectString(value, filePath, lineNumber, key),
        filePath,
        lineNumber
      );
      return;
    case 'verbose':
      config.server.verbose = expectBoolean(value, filePath, lineNumber, key);
      return;
    case 'logFile':
      config.server.logFile = expectString(value, filePath, lineNumber, key);
      return;
    case 'requestLog':
      config.server.requestLog = expectString(value, filePath, lineNumber, key);
      return;
    case 'responseLog':
      config.server.responseLog = expectString(value, filePath, lineNumber, key);
      return;
    case 'mediaRoots':
      config.server.mediaRoots = expectString(value, filePath, lineNumber, key)
        .split(delimiter)
        .filter(Boolean);
      return;
    default:
      throw new Error(`${filePath}:${lineNumber}: Unknown server config key "${key}"`);
  }
}

export function discoverDefaultMediaRoots(homeDir = homedir()): string[] {
  const remnoteRoot = join(homeDir, 'remnote');
  try {
    return readdirSync(remnoteRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('remnote-'))
      .map((entry) => join(remnoteRoot, entry.name, 'files'))
      .filter((entry) => existsSync(entry));
  } catch {
    return [];
  }
}

function parseOptionalPortEnv(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return parseInt(value, 10);
}

function parseTomlValue(
  value: string,
  filePath: string,
  lineNumber: number
): string | number | boolean {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  if (/^-?\d+$/.test(value)) {
    return Number(value);
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  throw new Error(`${filePath}:${lineNumber}: Unsupported TOML value`);
}

function stripTomlComment(line: string): string {
  let inString = false;
  let escaped = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (char === '#' && !inString) {
      return line.slice(0, i);
    }
  }
  return line;
}

function expectString(
  value: string | number | boolean,
  filePath: string,
  lineNumber: number,
  key: string
): string {
  if (typeof value !== 'string') {
    throw new Error(`${filePath}:${lineNumber}: Config key "${key}" must be a string`);
  }
  return value;
}

function expectBoolean(
  value: string | number | boolean,
  filePath: string,
  lineNumber: number,
  key: string
): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${filePath}:${lineNumber}: Config key "${key}" must be a boolean`);
  }
  return value;
}

function expectPort(
  value: string | number | boolean,
  filePath: string,
  lineNumber: number,
  key: string
): number {
  if (typeof value !== 'number') {
    throw new Error(`${filePath}:${lineNumber}: Config key "${key}" must be a number`);
  }
  if (value < 1 || value > 65535) {
    throw new Error(`${filePath}:${lineNumber}: Config key "${key}" must be between 1 and 65535`);
  }
  return value;
}

function validateLogLevel(value: string, filePath: string, lineNumber: number): string {
  const normalized = value.toLowerCase();
  if (!['debug', 'info', 'warn', 'error'].includes(normalized)) {
    throw new Error(`${filePath}:${lineNumber}: Invalid log level "${value}"`);
  }
  return normalized;
}

function validateHost(value: string, filePath: string, lineNumber: number): string {
  if (value === 'localhost' || value === '127.0.0.1' || value === '0.0.0.0') {
    return value;
  }

  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipv4Pattern.test(value)) {
    throw new Error(`${filePath}:${lineNumber}: Invalid HTTP host "${value}"`);
  }

  const octets = value.split('.').map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) {
    throw new Error(`${filePath}:${lineNumber}: Invalid HTTP host "${value}"`);
  }
  return value;
}

function resolveTilde(pathValue: string, homeDir: string): string {
  if (pathValue === '~') {
    return homeDir;
  }
  if (pathValue.startsWith('~/')) {
    return join(homeDir, pathValue.slice(2));
  }
  return pathValue;
}
