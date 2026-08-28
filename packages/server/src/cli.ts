import { Command } from 'commander';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { handleDaemonCommand, isDaemonCommand } from './daemon.js';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json');

export interface CliOptions {
  config?: string;
  wsPort?: number;
  httpPort?: number;
  httpHost?: string;
  logLevel?: string;
  logLevelFile?: string;
  verbose?: boolean;
  logFile?: string;
  requestLog?: string;
  responseLog?: string;
  mediaRoots?: string[];
}

const validLogLevels = ['debug', 'info', 'warn', 'error'];
const MCPB_PATH_COMMAND = 'mcpb-path';

export function getBundledMcpbPath(): string {
  return fileURLToPath(new URL('../mcpb/remnote-local/remnote-local.mcpb', import.meta.url));
}

/**
 * Handle utility commands that do not start the MCP server.
 */
export async function handleUtilityCommand(argv = process.argv): Promise<boolean> {
  if (argv[2] !== MCPB_PATH_COMMAND) {
    if (isDaemonCommand(argv)) {
      const result = await handleDaemonCommand(argv);
      process.exitCode = result.exitCode;
      return result.handled;
    }

    return false;
  }

  console.log(getBundledMcpbPath());
  return true;
}

/**
 * Parse CLI arguments and return typed options
 */
export function parseCliArgs(): CliOptions {
  const program = new Command();

  program
    .name('remnote-mcp-server')
    .description('MCP server bridge for RemNote knowledge base')
    .version(packageJson.version)
    .addHelpText(
      'after',
      '\nCommands:\n  mcpb-path                 Print the bundled Claude Desktop MCPB extension path\n  daemon <action>           Manage background server lifecycle and macOS launchd persistence'
    )
    .option('--ws-port <number>', 'WebSocket port (default: 3002, env: REMNOTE_WS_PORT)', parsePort)
    .option(
      '--http-port <number>',
      'HTTP MCP port (default: 3001, env: REMNOTE_HTTP_PORT)',
      parsePort
    )
    .option(
      '--http-host <host>',
      'HTTP server bind address (default: 127.0.0.1, env: REMNOTE_HTTP_HOST). Use 0.0.0.0 for Docker/VPS deployments',
      validateHost
    )
    .option('--config <path>', 'TOML config file path (default: ~/.remnote-mcp-server/config.toml)')
    .option(
      '--log-level <level>',
      `Console log level: ${validLogLevels.join(', ')} (default: info)`,
      validateLogLevel
    )
    .option(
      '--log-level-file <level>',
      `File log level (default: same as --log-level)`,
      validateLogLevel
    )
    .option('--verbose', 'Shorthand for --log-level debug')
    .option('--log-file <path>', 'Log to file (default: console only)')
    .option('--request-log <path>', 'Log all WebSocket requests to file (JSON Lines)')
    .option('--response-log <path>', 'Log all WebSocket responses to file (JSON Lines)')
    .option(
      '--media-root <path>',
      'Allowed RemNote managed-media root (repeatable, env: REMNOTE_MEDIA_ROOTS)',
      (value, previous: string[] | undefined) => [...(previous ?? []), value]
    );

  program.parse();

  const parsedOptions = program.opts<CliOptions & { mediaRoot?: string[] }>();
  const { mediaRoot, ...options } = parsedOptions;
  if (mediaRoot?.length) {
    options.mediaRoots = mediaRoot;
  }

  // Validate port conflicts
  if (options.wsPort && options.httpPort && options.wsPort === options.httpPort) {
    console.error('Error: WebSocket port and HTTP port cannot be the same');
    process.exit(1);
  }

  return options;
}

/**
 * Parse and validate port number
 */
function parsePort(value: string): number {
  const port = parseInt(value, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port number: ${value}. Must be between 1 and 65535.`);
  }
  return port;
}

/**
 * Validate log level string
 */
function validateLogLevel(value: string): string {
  if (!validLogLevels.includes(value.toLowerCase())) {
    throw new Error(`Invalid log level: ${value}. Valid levels: ${validLogLevels.join(', ')}`);
  }
  return value.toLowerCase();
}

/**
 * Validate host string
 */
function validateHost(value: string): string {
  // Allow localhost variations and 0.0.0.0
  if (value === 'localhost' || value === '127.0.0.1' || value === '0.0.0.0') {
    return value;
  }

  // Validate IPv4 format
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipv4Pattern.test(value)) {
    throw new Error(
      `Invalid host: ${value}. Must be localhost, 127.0.0.1, 0.0.0.0, or a valid IPv4 address`
    );
  }

  // Validate each octet is 0-255
  const octets = value.split('.').map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) {
    throw new Error(`Invalid host: ${value}. IPv4 octets must be between 0 and 255`);
  }

  return value;
}
