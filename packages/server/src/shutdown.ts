import type { Logger } from './logger.js';

export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5000;

interface StoppableServer {
  stop: () => Promise<void>;
}

export interface ShutdownHandlerOptions {
  logger: Pick<Logger, 'info' | 'warn' | 'error'>;
  httpServer: StoppableServer;
  wsServer: StoppableServer;
  timeoutMs?: number;
  exit?: (code: number) => never | void;
}

export type ShutdownHandler = (signal?: NodeJS.Signals) => Promise<void>;

export function createShutdownHandler({
  logger,
  httpServer,
  wsServer,
  timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  exit = process.exit,
}: ShutdownHandlerOptions): ShutdownHandler {
  let shutdownStarted = false;
  let exitRequested = false;

  const exitOnce = (code: number) => {
    if (exitRequested) {
      return;
    }
    exitRequested = true;
    exit(code);
  };

  return async (signal?: NodeJS.Signals) => {
    if (shutdownStarted) {
      logger.warn({ signal }, 'Shutdown already in progress; forcing exit');
      exitOnce(1);
      return;
    }

    shutdownStarted = true;
    if (signal) {
      logger.info({ signal }, 'Shutting down');
    } else {
      logger.info('Shutting down');
    }

    let timeout: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<'timeout'>((resolve) => {
      timeout = setTimeout(() => resolve('timeout'), timeoutMs);
      timeout.unref();
    });

    const cleanupPromise = (async () => {
      await httpServer.stop();
      await wsServer.stop();
      return 'stopped' as const;
    })();

    cleanupPromise.catch(() => {
      // The main race handles immediate failures; this suppresses late rejections after timeout exit.
    });

    try {
      const result = await Promise.race([cleanupPromise, timeoutPromise]);
      if (timeout) {
        clearTimeout(timeout);
      }

      if (result === 'timeout') {
        logger.error({ timeoutMs }, 'Shutdown timed out; forcing exit');
        exitOnce(1);
        return;
      }

      exitOnce(0);
    } catch (error) {
      if (timeout) {
        clearTimeout(timeout);
      }
      logger.error({ err: error }, 'Shutdown failed; forcing exit');
      exitOnce(1);
    }
  };
}
