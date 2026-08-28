#!/usr/bin/env node
import { createRequire } from 'module';
import { WebSocketServer } from './websocket-server.js';
import { HttpMcpServer } from './http-server.js';
import { handleUtilityCommand, parseCliArgs } from './cli.js';
import { getConfig } from './config.js';
import { createLogger, ensureLogDirectory, createRequestResponseLogger } from './logger.js';
import { createShutdownHandler } from './shutdown.js';
import { AuthStore } from './auth-store.js';
import { AuditLog } from './audit-log.js';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json');

async function main() {
  // Parse CLI arguments and merge with environment variables
  const cliOptions = parseCliArgs();
  const config = getConfig(cliOptions);
  const authStore = new AuthStore();
  const auditLog = new AuditLog(authStore.stateDir);

  // Ensure log directories exist
  if (config.logFile) {
    await ensureLogDirectory(config.logFile);
  }
  if (config.requestLog) {
    await ensureLogDirectory(config.requestLog);
  }
  if (config.responseLog) {
    await ensureLogDirectory(config.responseLog);
  }

  // Create logger
  const logger = createLogger({
    consoleLevel: config.logLevel,
    fileLevel: config.logLevelFile,
    filePath: config.logFile,
    pretty: config.prettyLogs,
  });

  // Create request/response loggers if configured
  const requestLogger = config.requestLog
    ? createRequestResponseLogger(config.requestLog)
    : undefined;
  const responseLogger = config.responseLog
    ? createRequestResponseLogger(config.responseLog)
    : undefined;

  // Initialize WebSocket server for RemNote plugin
  const wsServer = new WebSocketServer(
    config.wsPort,
    config.wsHost,
    logger,
    packageJson.version,
    requestLogger,
    responseLogger,
    authStore,
    auditLog
  );

  // Log connection status
  wsServer.onClientConnect(() => {
    logger.info('RemNote plugin connected');
  });

  wsServer.onClientDisconnect(() => {
    logger.info('RemNote plugin disconnected');
  });

  // Start WebSocket server
  await wsServer.start();

  // Initialize HTTP MCP server
  const httpServer = new HttpMcpServer(
    config.httpPort,
    config.httpHost,
    wsServer,
    {
      name: 'remnote-agent',
      version: packageJson.version,
    },
    logger,
    config.mediaRoots,
    authStore
  );

  await httpServer.start();

  // Log startup message
  logger.info(
    {
      wsPort: config.wsPort,
      wsHost: config.wsHost,
      httpPort: config.httpPort,
      httpHost: config.httpHost,
      authFile: authStore.authFile,
    },
    `RemNote Agent Runtime v${packageJson.version} listening`
  );

  const shutdown = createShutdownHandler({ logger, httpServer, wsServer });

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function run() {
  if (await handleUtilityCommand()) {
    return;
  }

  await main();
}

run().catch((error) => {
  // Pre-logger error handling
  console.error('[MCP Server] Fatal error:', error);
  process.exit(1);
});
