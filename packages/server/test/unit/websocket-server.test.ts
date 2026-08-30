/**
 * WebSocketServer unit tests
 * Tests for the WebSocket bridge server implementation
 *
 * Note: These tests use real WebSocketServer instances on OS-assigned available ports
 * to avoid complex mocking issues while still providing good test coverage
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  HELLO_TIMEOUT_MS,
  MAX_REQUEST_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  WebSocketServer,
} from '../../src/websocket-server.js';
import { WebSocket } from 'ws';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ACTION_POLICIES } from '@remnote-agent/protocol';
import { AuthStore } from '../../src/auth-store.js';
import { getAvailablePort, wait } from '../helpers/test-server.js';
import { createMockLogger } from '../setup.js';

const TEST_WS_HOST = '127.0.0.1';
const TEST_SERVER_VERSION = '0.5.1';
const TEST_BRIDGE_VERSION = '0.5.0';
const INCOMPATIBLE_BRIDGE_REASON =
  'Wrong or incompatible RemNote Agent Bridge installed. Install the bridge matching this runtime.';
const BRIDGE_REJECTION_LOG_PREFIX = `Rejecting bridge connection: ${INCOMPATIBLE_BRIDGE_REASON}`;
const START_RETRIES = 5;
const RETRY_DELAY_MS = 20;

type MockLogger = ReturnType<typeof createMockLogger>;

function isAddrInUseError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'EADDRINUSE'
  );
}

async function createStartedServer({
  mockLogger,
  requestLogger,
  responseLogger,
}: {
  mockLogger: MockLogger;
  requestLogger?: MockLogger;
  responseLogger?: MockLogger;
}): Promise<{ wsServer: WebSocketServer; port: number }> {
  let lastError: unknown;

  for (let attempt = 0; attempt < START_RETRIES; attempt++) {
    const port = await getAvailablePort();
    const wsServer = new WebSocketServer(
      port,
      TEST_WS_HOST,
      mockLogger,
      TEST_SERVER_VERSION,
      requestLogger,
      responseLogger,
      new AuthStore(mkdtempSync(join(tmpdir(), 'remnote-agent-ws-test-')))
    );

    try {
      await wsServer.start();
      return { wsServer, port };
    } catch (error) {
      await wsServer.stop();

      if (!isAddrInUseError(error)) {
        throw error;
      }

      lastError = error;
      await wait(RETRY_DELAY_MS);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Failed to start WebSocket test server');
}

async function openWebSocket(port: number): Promise<WebSocket> {
  const client = new WebSocket(`ws://localhost:${port}`);
  await new Promise<void>((resolve, reject) => {
    client.once('open', () => resolve());
    client.once('error', reject);
  });
  return client;
}

async function connectAcceptedClient(
  wsServer: WebSocketServer,
  port: number,
  bridgeVersion = TEST_BRIDGE_VERSION
): Promise<WebSocket> {
  const connectPromise = new Promise<void>((resolve) => {
    wsServer.onClientConnect(() => resolve());
  });
  const client = new WebSocket(`ws://localhost:${port}`);
  const messages: Record<string, unknown>[] = [];
  const waiters = new Map<string, Array<(message: Record<string, unknown>) => void>>();
  client.on('message', (data) => {
    const message = JSON.parse(data.toString()) as Record<string, unknown>;
    messages.push(message);
    const callbacks = waiters.get(String(message.type)) ?? [];
    callbacks.splice(0).forEach((callback) => callback(message));
  });
  const waitForType = async (type: string): Promise<Record<string, unknown>> => {
    const existing = messages.find((message) => message.type === type);
    if (existing) return existing;
    return new Promise((resolve) => {
      const callbacks = waiters.get(type) ?? [];
      callbacks.push(resolve);
      waiters.set(type, callbacks);
    });
  };
  await new Promise<void>((resolve, reject) => {
    client.once('open', resolve);
    client.once('error', reject);
  });
  await waitForType('server_challenge');
  const capabilities = Object.entries(ACTION_POLICIES).map(([id, policy]) => ({
    id,
    scope: policy.scope,
    risk: policy.risk,
    available: true,
  }));
  client.send(
    JSON.stringify({
      type: 'client_hello',
      protocolVersion: 2,
      bridgeVersion,
      sdkVersion: '0.0.46',
      installationId: 'test-installation',
      clientNonce: 'test-client-nonce',
      capabilities,
    })
  );
  const pairingRequired = await waitForType('pairing_required');
  const pairingStatus = wsServer.getSecurityStatus();
  client.send(
    JSON.stringify({
      type: 'pairing_confirm',
      pairingId: pairingRequired.pairingId,
      pairingCode: pairingStatus.pairingCode,
      installationId: 'test-installation',
      bridgeVersion,
      sdkVersion: '0.0.46',
      capabilities,
    })
  );
  await connectPromise;
  return client;
}

describe('WebSocketServer - Lifecycle', () => {
  let wsServer: WebSocketServer;
  let port: number;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(async () => {
    port = await getAvailablePort();
    mockLogger = createMockLogger();
    wsServer = new WebSocketServer(port, TEST_WS_HOST, mockLogger, TEST_SERVER_VERSION);
  });

  afterEach(async () => {
    await wsServer.stop();
  });

  it('should start server successfully', async () => {
    await expect(wsServer.start()).resolves.toBeUndefined();
  });

  it('should stop server successfully', async () => {
    await wsServer.start();
    await expect(wsServer.stop()).resolves.toBeUndefined();
  });

  it('should handle stop when server not started', async () => {
    await expect(wsServer.stop()).resolves.toBeUndefined();
  });

  it('should handle multiple stop calls', async () => {
    await wsServer.start();
    await wsServer.stop();
    await expect(wsServer.stop()).resolves.toBeUndefined();
  });

  it('should not be connected initially', () => {
    expect(wsServer.isConnected()).toBe(false);
  });

  it('should reject when port is already in use', async () => {
    await wsServer.start();

    const duplicateServer = new WebSocketServer(
      port,
      TEST_WS_HOST,
      createMockLogger(),
      TEST_SERVER_VERSION
    );
    await expect(duplicateServer.start()).rejects.toThrow();
    await duplicateServer.stop();
  });
});

describe('WebSocketServer - Connection State', () => {
  let wsServer: WebSocketServer;
  let port: number;
  let client: WebSocket;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(async () => {
    mockLogger = createMockLogger();
    const started = await createStartedServer({ mockLogger });
    wsServer = started.wsServer;
    port = started.port;
  });

  afterEach(async () => {
    if (client && client.readyState === WebSocket.OPEN) {
      client.close();
    }
    await wsServer.stop();
  });

  it('should report connected after client connects', async () => {
    client = await connectAcceptedClient(wsServer, port);

    expect(wsServer.isConnected()).toBe(true);
  });

  it('should report disconnected after client closes', async () => {
    const disconnectPromise = new Promise<void>((resolve) => {
      wsServer.onClientDisconnect(() => resolve());
    });

    client = await connectAcceptedClient(wsServer, port);

    client.close();
    await disconnectPromise;

    expect(wsServer.isConnected()).toBe(false);
  });

  it('should throw when sending request without connection', async () => {
    await expect(wsServer.sendRequest('search', {})).rejects.toThrow('not authenticated');
  });

  it('should trigger onClientConnect callback', async () => {
    let callbackTriggered = false;
    wsServer.onClientConnect(() => {
      callbackTriggered = true;
    });

    client = await connectAcceptedClient(wsServer, port);

    expect(callbackTriggered).toBe(true);
  });

  it('should trigger onClientDisconnect callback', async () => {
    let callbackTriggered = false;
    wsServer.onClientDisconnect(() => {
      callbackTriggered = true;
    });

    client = await connectAcceptedClient(wsServer, port);

    client.close();
    await wait(100);

    expect(callbackTriggered).toBe(true);
  });
});

describe('WebSocketServer - Single Client Model', () => {
  let wsServer: WebSocketServer;
  let port: number;
  let client1: WebSocket;
  let client2: WebSocket;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(async () => {
    mockLogger = createMockLogger();
    const started = await createStartedServer({ mockLogger });
    wsServer = started.wsServer;
    port = started.port;
  });

  afterEach(async () => {
    if (client1 && client1.readyState === WebSocket.OPEN) {
      client1.close();
    }
    if (client2 && client2.readyState === WebSocket.OPEN) {
      client2.close();
    }
    await wsServer.stop();
  });

  it('should accept first client connection', async () => {
    client1 = await connectAcceptedClient(wsServer, port);

    expect(wsServer.isConnected()).toBe(true);
  });

  it('should reject second client with code 1008', async () => {
    client1 = await connectAcceptedClient(wsServer, port);

    const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
      client2 = new WebSocket(`ws://localhost:${port}`);
      client2.on('close', (code, reason) => {
        resolve({ code, reason: reason.toString() });
      });
    });

    const result = await closePromise;
    expect(result.code).toBe(1008);
    expect(result.reason).toBe('Only one bridge client is allowed');
  });

  it('should allow new connection after first client disconnects', async () => {
    client1 = await connectAcceptedClient(wsServer, port);

    client1.close();
    await wait(100);
    wsServer.resetPairing();

    client2 = await connectAcceptedClient(wsServer, port);

    expect(wsServer.isConnected()).toBe(true);
  });
});

describe('WebSocketServer - Request/Response', () => {
  let wsServer: WebSocketServer;
  let port: number;
  let client: WebSocket;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(async () => {
    mockLogger = createMockLogger();
    const started = await createStartedServer({ mockLogger });
    wsServer = started.wsServer;
    port = started.port;

    client = await connectAcceptedClient(wsServer, port);
  });

  afterEach(async () => {
    if (client && client.readyState === WebSocket.OPEN) {
      client.close();
    }
    await wsServer.stop();
  });

  it('should send request with correct format', async () => {
    const messagePromise = new Promise<string>((resolve) => {
      client.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.id && message.action) {
          resolve(JSON.stringify(message));
        }
      });
    });

    const requestPromise = wsServer.sendRequest('search', { foo: 'bar' });

    const message = await messagePromise;
    const parsed = JSON.parse(message);

    expect(parsed).toHaveProperty('id');
    expect(parsed.action).toBe('search');
    expect(parsed.scope).toBe('read');
    expect(parsed.operationId).toEqual(expect.any(String));
    expect(parsed.payload).toEqual({ foo: 'bar' });

    // Clean up - respond to request
    client.send(JSON.stringify({ id: parsed.id, operationId: parsed.operationId, result: 'ok' }));
    await requestPromise;
  });

  it('should resolve with response result', async () => {
    let requestId: string;

    client.on('message', (data) => {
      const request = JSON.parse(data.toString());
      if (!request.id || !request.action) {
        return;
      }
      requestId = request.id;
      client.send(
        JSON.stringify({
          id: requestId,
          operationId: request.operationId,
          result: { data: 'test result' },
        })
      );
    });

    const result = await wsServer.sendRequest('search', {});
    expect(result).toEqual({ data: 'test result' });
  });

  it('should reject with response error', async () => {
    client.on('message', (data) => {
      const request = JSON.parse(data.toString());
      if (!request.id || !request.action) {
        return;
      }
      client.send(
        JSON.stringify({
          id: request.id,
          operationId: request.operationId,
          error: { code: 'TEST_ERROR', message: 'Test error message', retryable: false },
        })
      );
    });

    await expect(wsServer.sendRequest('search', {})).rejects.toThrow('Test error message');
  });

  it('should handle multiple concurrent requests', async () => {
    const receivedRequests: { id: string; action: string }[] = [];

    client.on('message', (data) => {
      const request = JSON.parse(data.toString());
      if (!request.id || !request.action) {
        return;
      }
      receivedRequests.push({ id: request.id, action: request.action });

      // Respond immediately
      client.send(
        JSON.stringify({
          id: request.id,
          operationId: request.operationId,
          result: `result-${request.action}`,
        })
      );
    });

    const [result1, result2, result3] = await Promise.all([
      wsServer.sendRequest('search', {}),
      wsServer.sendRequest('read_note', {}),
      wsServer.sendRequest('list_children', {}),
    ]);

    expect(result1).toBe('result-search');
    expect(result2).toBe('result-read_note');
    expect(result3).toBe('result-list_children');
    expect(receivedRequests).toHaveLength(3);
  });

  it('should timeout request after 15 seconds', async () => {
    // Don't respond to request - let it timeout
    client.on('message', (data) => {
      const request = JSON.parse(data.toString());
      if (!request.id || !request.action) {
        return;
      }
      // Intentionally do nothing
    });

    vi.useFakeTimers();
    try {
      const requestPromise = wsServer.sendRequest('search', {});
      const expectation = expect(requestPromise).rejects.toThrow('Request timeout');

      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });

  it('should honor a per-call request timeout', async () => {
    client.on('message', (data) => {
      const request = JSON.parse(data.toString());
      if (!request.id || !request.action) {
        return;
      }
    });

    vi.useFakeTimers();
    try {
      const requestPromise = wsServer.sendRequest('search', {}, 2500);
      const expectation = expect(requestPromise).rejects.toThrow('Request timeout');

      await vi.advanceTimersByTimeAsync(2499);
      await vi.advanceTimersByTimeAsync(1);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });

  it('should reject invalid per-call request timeout values', async () => {
    await expect(wsServer.sendRequest('search', {}, MAX_REQUEST_TIMEOUT_MS + 1)).rejects.toThrow(
      'Request timeout must be an integer'
    );
  });

  it('should reject pending requests on disconnect', async () => {
    // Set up error handlers before making requests
    const request1 = wsServer.sendRequest('search', {}).catch((e) => e);
    const request2 = wsServer.sendRequest('read_note', {}).catch((e) => e);

    await wait(100);

    // Close connection without responding
    client.close();
    await wait(100);

    const result1 = await request1;
    const result2 = await request2;

    expect(result1).toBeInstanceOf(Error);
    expect(result1.message).toContain('connection lost');
    expect(result2).toBeInstanceOf(Error);
    expect(result2.message).toContain('connection lost');
  });
});

describe('WebSocketServer - Heartbeat Protocol', () => {
  let wsServer: WebSocketServer;
  let port: number;
  let client: WebSocket;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(async () => {
    mockLogger = createMockLogger();
    const started = await createStartedServer({ mockLogger });
    wsServer = started.wsServer;
    port = started.port;

    client = await connectAcceptedClient(wsServer, port);
  });

  afterEach(async () => {
    if (client && client.readyState === WebSocket.OPEN) {
      client.close();
    }
    await wsServer.stop();
  });

  it('should respond to ping with pong', async () => {
    const pongPromise = new Promise<void>((resolve) => {
      client.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'pong') {
          resolve();
        }
      });
    });

    client.send(JSON.stringify({ type: 'ping' }));

    await expect(pongPromise).resolves.toBeUndefined();
  });

  it('should handle pong messages without error', async () => {
    // Send pong (shouldn't cause errors)
    client.send(JSON.stringify({ type: 'pong' }));
    await wait(100);

    // Connection should still be alive
    expect(wsServer.isConnected()).toBe(true);
  });
});

describe('WebSocketServer - Secure Handshake', () => {
  let wsServer: WebSocketServer;
  let port: number;
  let client: WebSocket;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(async () => {
    mockLogger = createMockLogger();
    const started = await createStartedServer({ mockLogger });
    wsServer = started.wsServer;
    port = started.port;
  });

  afterEach(async () => {
    if (client && client.readyState === WebSocket.OPEN) {
      client.close();
    }
    await wsServer.stop();
  });

  it('pairs once, stores bridge identity, and grants every configured scope', async () => {
    client = await connectAcceptedClient(wsServer, port);

    expect(wsServer.getBridgeVersion()).toBe('0.5.0');
    expect(wsServer.isConnected()).toBe(true);
    expect(wsServer.getSecurityStatus()).toMatchObject({
      paired: true,
      authenticated: true,
      pairedInstallationId: 'test-installation',
    });
    expect(wsServer.getGrantedScopes()).toContain('destructive');
  });

  it('should reject incompatible version mismatch', async () => {
    mockLogger.warn = vi.fn();
    client = await openWebSocket(port);

    const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
      client.on('close', (code, reason) => {
        resolve({ code, reason: reason.toString() });
      });
    });

    client.send(
      JSON.stringify({
        type: 'client_hello',
        protocolVersion: 2,
        bridgeVersion: '0.6.0',
        sdkVersion: '0.0.46',
        installationId: 'test-installation',
        clientNonce: 'nonce',
        capabilities: [],
      })
    );
    const result = await closePromise;

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ detail: expect.stringContaining('Version mismatch') }),
      BRIDGE_REJECTION_LOG_PREFIX
    );
    expect(result).toEqual({ code: 1008, reason: INCOMPATIBLE_BRIDGE_REASON });
    expect(wsServer.isConnected()).toBe(false);
  });

  it('rejects a malformed protocol-v2 hello', async () => {
    client = await openWebSocket(port);
    const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
      client.on('close', (code, reason) => {
        resolve({ code, reason: reason.toString() });
      });
    });

    client.send(JSON.stringify({ type: 'client_hello', protocolVersion: 2 }));
    const result = await closePromise;

    expect(result).toEqual({ code: 1008, reason: INCOMPATIBLE_BRIDGE_REASON });
    expect(wsServer.isConnected()).toBe(false);
  });

  it(
    'should reject connections that never send hello',
    async () => {
      client = await openWebSocket(port);
      const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
        client.on('close', (code, reason) => {
          resolve({ code, reason: reason.toString() });
        });
      });

      const result = await closePromise;

      expect(mockLogger.warn).toHaveBeenCalledWith(
        { detail: 'Bridge hello timeout' },
        BRIDGE_REJECTION_LOG_PREFIX
      );
      expect(result).toEqual({ code: 1008, reason: INCOMPATIBLE_BRIDGE_REASON });
      expect(wsServer.isConnected()).toBe(false);
    },
    HELLO_TIMEOUT_MS + 1000
  );

  it('rejects requests before authentication is accepted', async () => {
    client = await openWebSocket(port);
    await expect(wsServer.sendRequest('search', {})).rejects.toThrow('not authenticated');
  });

  it('should clear bridge version on disconnect', async () => {
    client = await connectAcceptedClient(wsServer, port);
    expect(wsServer.getBridgeVersion()).toBe('0.5.0');

    client.close();
    await wait(100);
    expect(wsServer.getBridgeVersion()).toBeNull();
  });

  it('should expose server version', () => {
    expect(wsServer.getServerVersion()).toBe('0.5.1');
  });

  it('should announce MCP server identity on connect', async () => {
    const messagePromise = new Promise<string>((resolve, reject) => {
      const nextClient = new WebSocket(`ws://localhost:${port}`);
      nextClient.once('message', (data) => resolve(data.toString()));
      nextClient.once('error', reject);
      client = nextClient;
    });

    const initialMessage = await messagePromise;
    expect(JSON.parse(initialMessage)).toEqual({
      type: 'companion_info',
      kind: 'mcp-server',
      version: '0.5.1',
    });
  });
});

describe('WebSocketServer - Error Handling', () => {
  let wsServer: WebSocketServer;
  let port: number;
  let client: WebSocket;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(async () => {
    mockLogger = createMockLogger();
    const started = await createStartedServer({ mockLogger });
    wsServer = started.wsServer;
    port = started.port;
  });

  afterEach(async () => {
    if (client && client.readyState === WebSocket.OPEN) {
      client.close();
    }
    await wsServer.stop();
  });

  it('should handle malformed JSON gracefully', async () => {
    client = await connectAcceptedClient(wsServer, port);

    // Send invalid JSON
    client.send('not valid json');
    await wait(100);

    // Connection should still work
    expect(wsServer.isConnected()).toBe(true);
  });

  it('should handle unknown message types', async () => {
    client = await connectAcceptedClient(wsServer, port);

    // Send unknown message type
    client.send(JSON.stringify({ unknown: 'field' }));
    await wait(100);

    // Connection should still work
    expect(wsServer.isConnected()).toBe(true);
  });

  it('should handle response for unknown request ID', async () => {
    client = await connectAcceptedClient(wsServer, port);

    // Send response for non-existent request
    client.send(JSON.stringify({ id: 'nonexistent-id', result: 'data' }));
    await wait(100);

    // Connection should still work
    expect(wsServer.isConnected()).toBe(true);
  });
});

describe('WebSocketServer - Logging', () => {
  let wsServer: WebSocketServer;
  let port: number;
  let client: WebSocket;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(async () => {
    mockLogger = createMockLogger();
    const started = await createStartedServer({ mockLogger });
    wsServer = started.wsServer;
    port = started.port;
  });

  afterEach(async () => {
    if (client && client.readyState === WebSocket.OPEN) {
      client.close();
    }
    await wsServer.stop();
  });

  it('should create child logger with context', () => {
    expect(mockLogger.child).toHaveBeenCalledWith({ context: 'websocket-server' });
  });

  it('should log server start', () => {
    expect(mockLogger.debug).toHaveBeenCalledWith(
      { port, host: '127.0.0.1' },
      'WebSocket server started'
    );
  });

  it('should log server stop', async () => {
    mockLogger.debug = vi.fn(); // Reset
    await wsServer.stop();
    expect(mockLogger.debug).toHaveBeenCalledWith('WebSocket server stopped');
  });

  it('should log client connection', async () => {
    mockLogger.info = vi.fn(); // Reset
    client = new WebSocket(`ws://localhost:${port}`);
    await wait(100);
    expect(mockLogger.info).toHaveBeenCalledWith(
      'WebSocket bridge client connected; authentication pending'
    );
  });

  it('should log client disconnection', async () => {
    client = await connectAcceptedClient(wsServer, port);
    mockLogger.info = vi.fn(); // Reset
    client.close();
    await wait(100);
    expect(mockLogger.info).toHaveBeenCalledWith('WebSocket bridge client disconnected');
  });

  it('should log when rejecting multiple connections', async () => {
    client = await connectAcceptedClient(wsServer, port);
    mockLogger.warn = vi.fn(); // Reset

    const client2 = new WebSocket(`ws://localhost:${port}`);
    await wait(100);

    expect(mockLogger.warn).toHaveBeenCalledWith('Rejecting connection: client already connected');
    client2.close();
  });

  it('should log sent requests', async () => {
    client = await connectAcceptedClient(wsServer, port);
    mockLogger.debug = vi.fn(); // Reset

    client.on('message', (data) => {
      const request = JSON.parse(data.toString());
      client.send(
        JSON.stringify({ id: request.id, operationId: request.operationId, result: 'ok' })
      );
    });

    await wsServer.sendRequest('search', { query: 'PRIVATE_REQUEST_SENTINEL' });

    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'search' }),
      'Sending bridge request'
    );
  });

  it('should log received messages', async () => {
    client = await connectAcceptedClient(wsServer, port);
    mockLogger.debug = vi.fn(); // Reset

    client.on('message', (data) => {
      const request = JSON.parse(data.toString());
      client.send(
        JSON.stringify({ id: request.id, operationId: request.operationId, result: 'ok' })
      );
    });

    await wsServer.sendRequest('search', {});

    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'response' }),
      'Received message'
    );
  });

  it('should log warning for unknown request ID', async () => {
    client = await connectAcceptedClient(wsServer, port);
    mockLogger.warn = vi.fn(); // Reset

    client.send(JSON.stringify({ id: 'unknown-id', result: 'data' }));
    await wait(100);

    expect(mockLogger.warn).toHaveBeenCalledWith({ id: 'unknown-id' }, 'Unknown bridge request ID');
  });

  it('should log errors', async () => {
    client = await connectAcceptedClient(wsServer, port);
    mockLogger.error = vi.fn(); // Reset

    client.send('invalid json');
    await wait(100);

    expect(mockLogger.error).toHaveBeenCalled();
  });
});

describe('WebSocketServer - Request/Response Logging', () => {
  let wsServer: WebSocketServer;
  let port: number;
  let client: WebSocket;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let mockRequestLogger: ReturnType<typeof createMockLogger>;
  let mockResponseLogger: ReturnType<typeof createMockLogger>;

  beforeEach(async () => {
    mockLogger = createMockLogger();
    mockRequestLogger = createMockLogger();
    mockResponseLogger = createMockLogger();
    const started = await createStartedServer({
      mockLogger,
      requestLogger: mockRequestLogger,
      responseLogger: mockResponseLogger,
    });
    wsServer = started.wsServer;
    port = started.port;
  });

  afterEach(async () => {
    if (client && client.readyState === WebSocket.OPEN) {
      client.close();
    }
    await wsServer.stop();
  });

  it('should log requests when request logger is provided', async () => {
    client = await connectAcceptedClient(wsServer, port);

    client.on('message', (data) => {
      const request = JSON.parse(data.toString());
      client.send(
        JSON.stringify({ id: request.id, operationId: request.operationId, result: 'ok' })
      );
    });

    await wsServer.sendRequest('search', { query: 'PRIVATE_REQUEST_SENTINEL' });

    expect(mockRequestLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'request',
        action: 'search',
        argumentCount: 1,
      })
    );
    expect(JSON.stringify(mockRequestLogger.info.mock.calls)).not.toContain(
      'PRIVATE_REQUEST_SENTINEL'
    );
  });

  it('should log responses when response logger is provided', async () => {
    client = await connectAcceptedClient(wsServer, port);

    client.on('message', (data) => {
      const request = JSON.parse(data.toString());
      client.send(
        JSON.stringify({ id: request.id, operationId: request.operationId, result: 'ok' })
      );
    });

    await wsServer.sendRequest('search', {});

    expect(mockResponseLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'response',
        duration_ms: expect.any(Number),
        error: null,
      })
    );
  });

  it('should log error responses', async () => {
    client = await connectAcceptedClient(wsServer, port);

    client.on('message', (data) => {
      const request = JSON.parse(data.toString());
      client.send(
        JSON.stringify({
          id: request.id,
          operationId: request.operationId,
          error: { code: 'TEST_ERROR', message: 'PRIVATE_ERROR_SENTINEL', retryable: false },
        })
      );
    });

    await expect(wsServer.sendRequest('search', {})).rejects.toThrow('PRIVATE_ERROR_SENTINEL');

    expect(mockResponseLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'response',
        error: 'BRIDGE_REQUEST_FAILED',
      })
    );
    expect(JSON.stringify(mockResponseLogger.info.mock.calls)).not.toContain(
      'PRIVATE_ERROR_SENTINEL'
    );
  });
});
