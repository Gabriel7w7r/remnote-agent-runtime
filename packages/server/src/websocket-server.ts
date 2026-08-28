import { randomBytes, randomUUID } from 'node:crypto';
import {
  getActionPolicy,
  REMNOTE_AGENT_PROTOCOL_VERSION,
  type BridgeCapability,
  type BridgeMessage,
  type BridgeRequest,
  type BridgeResponse,
  type CapabilityScope,
  type ClientHelloMessage,
  type PairingConfirmMessage,
} from '@remnote-agent/protocol';
import { WebSocketServer as WSServer, WebSocket } from 'ws';
import { AuthStore } from './auth-store.js';
import { checkVersionCompatibility } from './version-compat.js';
import type { Logger } from './logger.js';
import { AuditLog } from './audit-log.js';

export const REQUEST_TIMEOUT_MS = 15_000;
export const MAX_REQUEST_TIMEOUT_MS = 60_000;
export const HELLO_TIMEOUT_MS = 2_000;
const POLICY_VIOLATION = 1008;
const INCOMPATIBLE_BRIDGE_REASON =
  'Wrong or incompatible RemNote Agent Bridge installed. Install the bridge matching this runtime.';
const BRIDGE_REJECTION_LOG_PREFIX = `Rejecting bridge connection: ${INCOMPATIBLE_BRIDGE_REASON}`;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  operationId: string;
  audit: {
    action: string;
    scope: CapabilityScope;
    risk: ReturnType<typeof getActionPolicy> extends infer Policy
      ? Policy extends { risk: infer Risk }
        ? Risk
        : never
      : never;
    payloadHash: string;
    payloadKeys: string[];
    startTime: number;
  };
}

export class WebSocketServer {
  private wss: WSServer | null = null;
  private client: WebSocket | null = null;
  private readonly logger: Logger;
  private readonly requestLogger: Logger | null;
  private readonly responseLogger: Logger | null;
  private readonly serverInstanceId = randomUUID();
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly connectCallbacks: Array<() => void> = [];
  private readonly disconnectCallbacks: Array<() => void> = [];
  private bridgeVersion: string | null = null;
  private bridgeInstallationId: string | null = null;
  private bridgeCapabilities: BridgeCapability[] = [];
  private grantedScopes: CapabilityScope[] = [];
  private clientAccepted = false;
  private clientHello: ClientHelloMessage | null = null;
  private serverNonce: string | null = null;
  private helloTimeout: NodeJS.Timeout | null = null;

  constructor(
    private readonly port: number,
    private readonly host: string,
    logger: Logger,
    private readonly serverVersion = '0.19.0',
    requestLogger?: Logger,
    responseLogger?: Logger,
    private readonly authStore: AuthStore = new AuthStore(),
    private readonly auditLog?: AuditLog
  ) {
    this.logger = logger.child({ context: 'websocket-server' });
    this.requestLogger = requestLogger ?? null;
    this.responseLogger = responseLogger ?? null;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wss = new WSServer({ port: this.port, host: this.host }, () => {
        this.logger.debug({ port: this.port, host: this.host }, 'WebSocket server started');
        resolve();
      });

      this.wss.on('error', (error) => {
        this.logger.error({ error }, 'WebSocket server error');
        reject(error);
      });

      this.wss.on('connection', (ws) => this.handleConnection(ws));
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.client) {
        this.client.close();
        this.clearClientState();
      }

      if (!this.wss) {
        resolve();
        return;
      }

      this.wss.close(() => {
        this.logger.debug('WebSocket server stopped');
        this.wss = null;
        resolve();
      });
    });
  }

  async sendRequest(
    action: string,
    payload: Record<string, unknown>,
    timeoutMs = REQUEST_TIMEOUT_MS
  ): Promise<unknown> {
    if (!this.isConnected()) {
      throw new Error(
        'RemNote Agent Bridge is not authenticated. Open RemNote, enable the bridge, and complete pairing.'
      );
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_REQUEST_TIMEOUT_MS) {
      throw new Error(
        `Request timeout must be an integer between 1 and ${MAX_REQUEST_TIMEOUT_MS}ms`
      );
    }

    const policy = getActionPolicy(action);
    if (!policy) {
      throw new Error(`Unknown or unclassified bridge action: ${action}`);
    }
    if (!this.grantedScopes.includes(policy.scope)) {
      throw new Error(`Bridge action ${action} requires the ${policy.scope} scope`);
    }
    const capability = this.bridgeCapabilities.find((candidate) => candidate.id === action);
    if (!capability?.available) {
      throw new Error(
        capability?.reason ?? `Connected bridge does not advertise the ${action} capability`
      );
    }

    const id = randomUUID();
    const operationId = randomUUID();
    const request: BridgeRequest = {
      id,
      operationId,
      action,
      scope: policy.scope,
      payload,
    };
    const startTime = Date.now();
    const fingerprint = this.auditLog?.payloadFingerprint(payload);
    const audit = {
      action,
      scope: policy.scope,
      risk: policy.risk,
      payloadHash: fingerprint?.payloadHash ?? '',
      payloadKeys: fingerprint?.payloadKeys ?? [],
      startTime,
    };

    this.logger.debug({ id, operationId, action, scope: policy.scope }, 'Sending bridge request');
    this.requestLogger?.info({
      type: 'request',
      id,
      operationId,
      action,
      scope: policy.scope,
      payload,
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        this.appendAudit(id, operationId, audit, 'timeout', `Request timeout: ${action}`);
        reject(new Error(`Request timeout: ${action}`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        operationId,
        audit,
        resolve: (result) => {
          this.responseLogger?.info({
            type: 'response',
            id,
            operationId,
            duration_ms: Date.now() - startTime,
            error: null,
          });
          this.appendAudit(id, operationId, audit, 'success');
          resolve(result);
        },
        reject: (error) => {
          this.responseLogger?.info({
            type: 'response',
            id,
            operationId,
            duration_ms: Date.now() - startTime,
            error: error.message,
          });
          this.appendAudit(id, operationId, audit, 'error', error.message);
          reject(error);
        },
        timeout,
      });

      try {
        this.client!.send(JSON.stringify(request));
      } catch (error) {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        this.appendAudit(
          id,
          operationId,
          audit,
          'transport_error',
          error instanceof Error ? error.message : String(error)
        );
        reject(error);
      }
    });
  }

  isConnected(): boolean {
    return this.client?.readyState === WebSocket.OPEN && this.clientAccepted;
  }

  getBridgeVersion(): string | null {
    return this.bridgeVersion;
  }

  getServerVersion(): string {
    return this.serverVersion;
  }

  getCapabilities(): readonly BridgeCapability[] {
    return this.bridgeCapabilities;
  }

  getGrantedScopes(): readonly CapabilityScope[] {
    return this.grantedScopes;
  }

  getSecurityStatus(): Record<string, unknown> {
    return {
      protocolVersion: REMNOTE_AGENT_PROTOCOL_VERSION,
      authenticated: this.clientAccepted,
      installationId: this.bridgeInstallationId,
      grantedScopes: this.grantedScopes,
      capabilities: this.bridgeCapabilities,
      ...this.authStore.getPairingStatus(),
    };
  }

  getAuditEntries(limit = 100) {
    return this.auditLog?.readRecent(limit) ?? [];
  }

  resetPairing(): void {
    this.authStore.resetPairing();
    if (this.client?.readyState === WebSocket.OPEN) {
      this.client.close(POLICY_VIOLATION, 'Pairing reset');
    }
    this.clearClientState();
  }

  onClientConnect(callback: () => void): void {
    this.connectCallbacks.push(callback);
  }

  onClientDisconnect(callback: () => void): void {
    this.disconnectCallbacks.push(callback);
  }

  private handleConnection(ws: WebSocket): void {
    if (this.client?.readyState === WebSocket.OPEN) {
      this.logger.warn('Rejecting connection: client already connected');
      ws.close(POLICY_VIOLATION, 'Only one bridge client is allowed');
      return;
    }

    this.client = ws;
    this.clientAccepted = false;
    this.clientHello = null;
    this.serverNonce = randomBytes(24).toString('base64url');
    this.logger.info('WebSocket bridge client connected; authentication pending');
    this.helloTimeout = setTimeout(() => {
      if (this.client === ws && !this.clientHello && ws.readyState === WebSocket.OPEN) {
        this.rejectBridge('Bridge hello timeout', INCOMPATIBLE_BRIDGE_REASON);
      }
    }, HELLO_TIMEOUT_MS);

    const paired = this.authStore.getPairedBridge();
    ws.send(
      JSON.stringify({
        type: 'companion_info',
        kind: 'mcp-server',
        version: this.serverVersion,
      })
    );
    ws.send(
      JSON.stringify({
        type: 'server_challenge',
        protocolVersion: REMNOTE_AGENT_PROTOCOL_VERSION,
        serverVersion: this.serverVersion,
        serverInstanceId: this.serverInstanceId,
        nonce: this.serverNonce,
        pairingRequired: !paired,
        pairedInstallationId: paired?.installationId,
      })
    );

    ws.on('message', (data) => this.handleMessage(ws, data.toString()));
    ws.on('close', () => this.handleClose(ws));
    ws.on('error', (error) => this.logger.error({ error }, 'WebSocket client error'));
  }

  private handleMessage(ws: WebSocket, data: string): void {
    if (ws !== this.client) {
      return;
    }

    try {
      const message = JSON.parse(data) as BridgeMessage;
      this.logger.debug(
        { type: 'type' in message ? message.type : 'response' },
        'Received message'
      );

      if ('type' in message && message.type === 'client_hello') {
        this.handleClientHello(message);
        return;
      }
      if ('type' in message && message.type === 'pairing_confirm') {
        this.handlePairingConfirm(message);
        return;
      }
      if ('type' in message && message.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }
      if ('type' in message && message.type === 'pong') {
        return;
      }
      if ('id' in message) {
        this.handleResponse(message as BridgeResponse);
        return;
      }

      if (!this.clientAccepted) {
        this.rejectBridge('Message received before authentication', INCOMPATIBLE_BRIDGE_REASON);
      }
    } catch (error) {
      this.logger.error({ error }, 'Error parsing bridge message');
      if (!this.clientAccepted) {
        this.rejectBridge('Invalid JSON before authentication', INCOMPATIBLE_BRIDGE_REASON);
      }
    }
  }

  private handleClientHello(message: ClientHelloMessage): void {
    if (
      message.protocolVersion !== REMNOTE_AGENT_PROTOCOL_VERSION ||
      typeof message.bridgeVersion !== 'string' ||
      typeof message.sdkVersion !== 'string' ||
      typeof message.installationId !== 'string' ||
      typeof message.clientNonce !== 'string' ||
      !Array.isArray(message.capabilities)
    ) {
      this.rejectBridge('Malformed protocol-v2 client hello', INCOMPATIBLE_BRIDGE_REASON);
      return;
    }

    const warning = checkVersionCompatibility(this.serverVersion, message.bridgeVersion);
    if (warning) {
      this.rejectBridge(warning, INCOMPATIBLE_BRIDGE_REASON);
      return;
    }

    this.clientHello = message;
    this.bridgeVersion = message.bridgeVersion;
    this.bridgeInstallationId = message.installationId;
    this.bridgeCapabilities = message.capabilities;
    this.clearHelloTimeout();

    const paired = this.authStore.getPairedBridge();
    if (!paired) {
      const challenge = this.authStore.ensurePairingChallenge(message.installationId);
      this.send({ type: 'pairing_required', pairingId: challenge.pairingId });
      this.logger.info({ installationId: message.installationId }, 'Bridge pairing required');
      return;
    }

    if (!message.proof || !this.serverNonce) {
      this.rejectAuthentication('Bridge reconnect proof is missing', false);
      return;
    }
    const accepted = this.authStore.verifyBridgeProof({
      serverInstanceId: this.serverInstanceId,
      serverNonce: this.serverNonce,
      clientNonce: message.clientNonce,
      installationId: message.installationId,
      bridgeVersion: message.bridgeVersion,
      protocolVersion: message.protocolVersion,
      proof: message.proof,
    });
    if (!accepted) {
      this.rejectAuthentication('Bridge reconnect proof is invalid', true);
      return;
    }

    this.acceptBridge(paired.scopes);
  }

  private handlePairingConfirm(message: PairingConfirmMessage): void {
    const hello = this.clientHello;
    if (
      !hello ||
      hello.installationId !== message.installationId ||
      hello.bridgeVersion !== message.bridgeVersion
    ) {
      this.rejectAuthentication('Pairing confirmation does not match the connected bridge', false);
      return;
    }

    try {
      const pairing = this.authStore.completePairing(message);
      this.send({
        type: 'pairing_complete',
        secret: pairing.secret,
        grantedScopes: pairing.grantedScopes,
      });
      this.acceptBridge(pairing.grantedScopes);
      this.logger.info({ installationId: message.installationId }, 'Bridge pairing completed');
    } catch (error) {
      this.send({
        type: 'auth_rejected',
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private acceptBridge(scopes: CapabilityScope[]): void {
    this.grantedScopes = [...scopes];
    this.clientAccepted = true;
    this.send({
      type: 'auth_accepted',
      grantedScopes: this.grantedScopes,
      serverVersion: this.serverVersion,
      protocolVersion: REMNOTE_AGENT_PROTOCOL_VERSION,
    });
    this.logger.info(
      {
        bridgeVersion: this.bridgeVersion,
        installationId: this.bridgeInstallationId,
        scopes: this.grantedScopes,
      },
      'RemNote Agent Bridge authenticated'
    );
    this.connectCallbacks.forEach((callback) => callback());
  }

  private handleResponse(response: BridgeResponse): void {
    if (!this.clientAccepted) {
      this.rejectBridge(
        'Bridge response received before authentication',
        INCOMPATIBLE_BRIDGE_REASON
      );
      return;
    }
    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      this.logger.warn({ id: response.id }, 'Unknown bridge request ID');
      return;
    }
    clearTimeout(pending.timeout);
    this.pendingRequests.delete(response.id);

    if (response.operationId !== pending.operationId) {
      pending.reject(new Error('Bridge response operation identity mismatch'));
      return;
    }
    if (response.error) {
      pending.reject(new Error(`${response.error.code}: ${response.error.message}`));
    } else {
      pending.resolve(response.result);
    }
  }

  private handleClose(ws: WebSocket): void {
    if (this.client !== ws) {
      return;
    }
    const wasAccepted = this.clientAccepted;
    this.logger.info('WebSocket bridge client disconnected');
    this.clearClientState();
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Bridge connection lost'));
    }
    this.pendingRequests.clear();
    if (wasAccepted) {
      this.disconnectCallbacks.forEach((callback) => callback());
    }
  }

  private clearClientState(): void {
    this.client = null;
    this.bridgeVersion = null;
    this.bridgeInstallationId = null;
    this.bridgeCapabilities = [];
    this.grantedScopes = [];
    this.clientAccepted = false;
    this.clientHello = null;
    this.serverNonce = null;
    this.clearHelloTimeout();
  }

  private rejectAuthentication(reason: string, resetPairing: boolean): void {
    this.send({ type: 'auth_rejected', reason, resetPairing });
    this.rejectBridge(reason, 'Authentication failed');
  }

  private rejectBridge(detail: string, closeReason: string): void {
    this.logger.warn({ detail }, BRIDGE_REJECTION_LOG_PREFIX);
    this.clearHelloTimeout();
    if (this.client?.readyState === WebSocket.OPEN) {
      this.client.close(POLICY_VIOLATION, closeReason.slice(0, 123));
    }
  }

  private send(message: BridgeMessage): void {
    if (this.client?.readyState === WebSocket.OPEN) {
      this.client.send(JSON.stringify(message));
    }
  }

  private clearHelloTimeout(): void {
    if (this.helloTimeout) {
      clearTimeout(this.helloTimeout);
      this.helloTimeout = null;
    }
  }

  private appendAudit(
    requestId: string,
    operationId: string,
    audit: PendingRequest['audit'],
    outcome: 'success' | 'error' | 'timeout' | 'transport_error',
    error?: string
  ): void {
    try {
      this.auditLog?.append({
        timestamp: new Date().toISOString(),
        requestId,
        operationId,
        action: audit.action,
        scope: audit.scope,
        risk: audit.risk,
        payloadHash: audit.payloadHash,
        payloadKeys: audit.payloadKeys,
        durationMs: Date.now() - audit.startTime,
        outcome,
        error,
      });
    } catch (auditError) {
      this.logger.error({ error: auditError, operationId }, 'Failed to append audit entry');
    }
  }
}
