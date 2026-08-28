import { describe, expect, it, vi, afterEach } from 'vitest';
import { createShutdownHandler } from '../../src/shutdown.js';
import { createMockLogger } from '../setup.js';

describe('createShutdownHandler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('exits nonzero when cleanup fails', async () => {
    const logger = createMockLogger();
    const exit = vi.fn();
    const error = new Error('stop failed');
    const httpServer = { stop: vi.fn().mockRejectedValue(error) };
    const wsServer = { stop: vi.fn().mockResolvedValue(undefined) };

    const shutdown = createShutdownHandler({ logger, httpServer, wsServer, exit });

    await shutdown('SIGTERM');

    expect(httpServer.stop).toHaveBeenCalledTimes(1);
    expect(wsServer.stop).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith({ err: error }, 'Shutdown failed; forcing exit');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('forces nonzero exit when cleanup does not finish before the timeout', async () => {
    vi.useFakeTimers();
    const logger = createMockLogger();
    const exit = vi.fn();
    const httpServer = { stop: vi.fn(() => new Promise<void>(() => {})) };
    const wsServer = { stop: vi.fn().mockResolvedValue(undefined) };

    const shutdown = createShutdownHandler({
      logger,
      httpServer,
      wsServer,
      timeoutMs: 25,
      exit,
    });

    const shutdownPromise = shutdown('SIGTERM');
    await vi.advanceTimersByTimeAsync(25);
    await shutdownPromise;

    expect(httpServer.stop).toHaveBeenCalledTimes(1);
    expect(wsServer.stop).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      { timeoutMs: 25 },
      'Shutdown timed out; forcing exit'
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('does not run cleanup twice and makes a second signal force exit', async () => {
    const logger = createMockLogger();
    const exit = vi.fn();
    let finishHttpStop: (() => void) | undefined;
    const httpServer = {
      stop: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishHttpStop = resolve;
          })
      ),
    };
    const wsServer = { stop: vi.fn().mockResolvedValue(undefined) };

    const shutdown = createShutdownHandler({ logger, httpServer, wsServer, exit });

    const firstShutdown = shutdown('SIGTERM');
    await Promise.resolve();
    await shutdown('SIGINT');
    finishHttpStop?.();
    await firstShutdown;

    expect(httpServer.stop).toHaveBeenCalledTimes(1);
    expect(wsServer.stop).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      { signal: 'SIGINT' },
      'Shutdown already in progress; forcing exit'
    );
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });
});
