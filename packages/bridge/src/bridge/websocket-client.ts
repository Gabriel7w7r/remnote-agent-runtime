import {
  ACTION_POLICIES,
  canonicalAuthMessage,
  getActionPolicy,
  REMNOTE_AGENT_PROTOCOL_VERSION,
  type AuthAcceptedMessage,
  type AuthRejectedMessage,
  type BridgeCapability,
  type BridgeRequest as ProtocolBridgeRequest,
  type BridgeResponse as ProtocolBridgeResponse,
  type CapabilityScope,
  type CompanionInfoMessage,
  type PairingCompleteMessage,
  type PairingRequiredMessage,
  type ServerChallengeMessage,
} from '@remnote-agent/protocol';
import {
  formatBridgeCompatibilityDisconnect,
  isBridgeCompatibilityDisconnect,
} from './compatibility-message';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';
export type RetryPhase = 'idle' | 'burst' | 'standby';
export type CompanionKind = 'cli' | 'mcp-server';
export type AuthStatus =
  'disconnected' | 'authenticating' | 'pairing-required' | 'authenticated' | 'rejected';
export type BridgeRequest = ProtocolBridgeRequest;
export type BridgeResponse = ProtocolBridgeResponse;

export interface ReconnectMetadata {
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  nextRetryAt?: number;
  lastRetryDelayMs?: number;
  lastDisconnectReason?: string;
}

export interface CompanionInfo {
  kind: CompanionKind;
  version: string;
}

export interface AuthSnapshot {
  status: AuthStatus;
  pairingRequired: boolean;
  authenticated: boolean;
  grantedScopes: CapabilityScope[];
  rejectionReason?: string;
}

export interface WebSocketClientConfig {
  url: string;
  pluginVersion: string;
  sdkVersion?: string;
  installationId?: string;
  pairingSecret?: string;
  capabilities?: BridgeCapability[];
  maxReconnectAttempts?: number;
  initialReconnectDelay?: number;
  maxReconnectDelay?: number;
  standbyReconnectDelay?: number;
  onStatusChange?: (status: ConnectionStatus) => void;
  onRetryPhaseChange?: (phase: RetryPhase) => void;
  onCompanionInfoChange?: (info: CompanionInfo | undefined) => void;
  onAuthChange?: (snapshot: AuthSnapshot) => void;
  onPairingSecretChange?: (secret: string | undefined) => void | Promise<void>;
  onLog?: (message: string, level: 'info' | 'warn' | 'error') => void;
}

export const BRIDGE_ACTION_TIMEOUT_MS = 10_000;

class BridgeActionTimeoutError extends Error {
  constructor() {
    super(`Bridge action timed out after ${BRIDGE_ACTION_TIMEOUT_MS}ms`);
    this.name = 'BridgeActionTimeoutError';
  }
}

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private messageHandler: ((request: BridgeRequest) => Promise<unknown>) | null = null;
  private status: ConnectionStatus = 'disconnected';
  private authStatus: AuthStatus = 'disconnected';
  private retryPhase: RetryPhase = 'idle';
  private isShuttingDown = false;
  private nextRetryAt?: number;
  private lastRetryDelayMs?: number;
  private lastDisconnectReason?: string;
  private companionInfo?: CompanionInfo;
  private pairingId?: string;
  private grantedScopes: CapabilityScope[] = [];
  private rejectionReason?: string;
  private readonly responseCache = new Map<string, BridgeResponse>();

  private readonly config: Required<
    Pick<
      WebSocketClientConfig,
      | 'url'
      | 'pluginVersion'
      | 'sdkVersion'
      | 'installationId'
      | 'capabilities'
      | 'maxReconnectAttempts'
      | 'initialReconnectDelay'
      | 'maxReconnectDelay'
      | 'standbyReconnectDelay'
    >
  > &
    Omit<
      WebSocketClientConfig,
      | 'url'
      | 'pluginVersion'
      | 'sdkVersion'
      | 'installationId'
      | 'capabilities'
      | 'maxReconnectAttempts'
      | 'initialReconnectDelay'
      | 'maxReconnectDelay'
      | 'standbyReconnectDelay'
    >;

  constructor(config: WebSocketClientConfig) {
    this.config = {
      ...config,
      sdkVersion: config.sdkVersion ?? '0.0.46',
      installationId: config.installationId ?? randomId(),
      capabilities: config.capabilities ?? defaultCapabilities(),
      maxReconnectAttempts: config.maxReconnectAttempts ?? 10,
      initialReconnectDelay: config.initialReconnectDelay ?? 1_000,
      maxReconnectDelay: config.maxReconnectDelay ?? 30_000,
      standbyReconnectDelay: config.standbyReconnectDelay ?? 10 * 60 * 1_000,
    };
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    this.isShuttingDown = false;
    this.nextRetryAt = undefined;
    this.lastRetryDelayMs = undefined;
    this.setStatus('connecting');
    this.setAuthStatus('authenticating');
    this.log(`Connecting securely to ${this.config.url}...`);

    try {
      this.ws = new WebSocket(this.config.url);
      this.ws.onopen = () => {
        this.log('Transport connected; waiting for server challenge');
        this.reconnectAttempts = 0;
        this.nextRetryAt = undefined;
        this.lastRetryDelayMs = undefined;
        this.setCompanionInfo(undefined);
        this.setRetryPhase('idle');
      };
      this.ws.onmessage = async (event) => {
        await this.handleMessage(String(event.data));
      };
      this.ws.onclose = (event) => {
        this.lastDisconnectReason = this.formatDisconnectReason(event);
        this.log(`Disconnected: ${this.lastDisconnectReason}`, 'warn');
        this.setCompanionInfo(undefined);
        this.pairingId = undefined;
        this.grantedScopes = [];
        this.setAuthStatus('disconnected');
        this.setStatus('disconnected');
        if (!this.isShuttingDown) {
          this.scheduleReconnect();
        }
      };
      this.ws.onerror = (error) => this.log(`WebSocket error: ${String(error)}`, 'error');
    } catch (error) {
      this.log(`Connection failed: ${String(error)}`, 'error');
      this.setAuthStatus('disconnected');
      this.setStatus('disconnected');
      this.scheduleReconnect();
    }
  }

  async confirmPairing(pairingCode: string): Promise<void> {
    const normalizedCode = pairingCode.trim();
    if (!/^\d{6}$/.test(normalizedCode)) {
      throw new Error('Pairing code must contain exactly six digits');
    }
    if (!this.pairingId || this.ws?.readyState !== WebSocket.OPEN) {
      throw new Error('No active pairing request. Reconnect the bridge and try again.');
    }

    this.ws.send(
      JSON.stringify({
        type: 'pairing_confirm',
        pairingId: this.pairingId,
        pairingCode: normalizedCode,
        installationId: this.config.installationId,
        bridgeVersion: this.config.pluginVersion,
        sdkVersion: this.config.sdkVersion,
        capabilities: this.config.capabilities,
      })
    );
    this.setAuthStatus('authenticating');
    this.log('Pairing code submitted; waiting for confirmation');
  }

  setMessageHandler(handler: (request: BridgeRequest) => Promise<unknown>): void {
    this.messageHandler = handler;
  }

  disconnect(): void {
    this.isShuttingDown = true;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this.nextRetryAt = undefined;
    this.lastRetryDelayMs = undefined;
    this.setCompanionInfo(undefined);
    this.setRetryPhase('idle');
    this.setAuthStatus('disconnected');
    this.setStatus('disconnected');
  }

  reconnect(): void {
    this.reconnectAttempts = 0;
    this.disconnect();
    this.connect();
  }

  wakeReconnect(reason: string): void {
    if (this.isShuttingDown || this.status === 'connected' || this.status === 'connecting') {
      return;
    }
    this.cancelReconnect();
    this.reconnectAttempts = 0;
    this.nextRetryAt = undefined;
    this.lastRetryDelayMs = undefined;
    this.setRetryPhase('burst');
    this.log(`Reconnect wake-up triggered: ${reason}`);
    this.connect();
  }

  nudgeReconnect(reason: string): void {
    if (this.isShuttingDown || this.status === 'connected' || this.status === 'connecting') {
      return;
    }
    this.cancelReconnect();
    this.nextRetryAt = undefined;
    this.lastRetryDelayMs = undefined;
    this.log(`Reconnect nudged: ${reason}`);
    this.connect();
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getRetryPhase(): RetryPhase {
    return this.retryPhase;
  }

  getReconnectMetadata(): ReconnectMetadata {
    return {
      reconnectAttempts: this.reconnectAttempts,
      maxReconnectAttempts: this.config.maxReconnectAttempts,
      nextRetryAt: this.nextRetryAt,
      lastRetryDelayMs: this.lastRetryDelayMs,
      lastDisconnectReason: this.lastDisconnectReason,
    };
  }

  getAuthSnapshot(): AuthSnapshot {
    return {
      status: this.authStatus,
      pairingRequired: this.authStatus === 'pairing-required',
      authenticated: this.authStatus === 'authenticated',
      grantedScopes: [...this.grantedScopes],
      rejectionReason: this.rejectionReason,
    };
  }

  private async handleMessage(data: string): Promise<void> {
    try {
      const message = JSON.parse(data) as Record<string, unknown>;
      switch (message.type) {
        case 'ping':
          this.ws?.send(JSON.stringify({ type: 'pong' }));
          return;
        case 'companion_info':
          this.handleCompanionInfo(message as unknown as CompanionInfoMessage);
          return;
        case 'server_challenge':
          await this.handleServerChallenge(message as unknown as ServerChallengeMessage);
          return;
        case 'pairing_required':
          this.handlePairingRequired(message as unknown as PairingRequiredMessage);
          return;
        case 'pairing_complete':
          await this.handlePairingComplete(message as unknown as PairingCompleteMessage);
          return;
        case 'auth_accepted':
          this.handleAuthAccepted(message as unknown as AuthAcceptedMessage);
          return;
        case 'auth_rejected':
          await this.handleAuthRejected(message as unknown as AuthRejectedMessage);
          return;
      }

      if (typeof message.id === 'string' && typeof message.action === 'string') {
        await this.handleRequest(message as unknown as BridgeRequest);
      }
    } catch (error) {
      this.log(`Failed to process message: ${String(error)}`, 'error');
    }
  }

  private async handleServerChallenge(challenge: ServerChallengeMessage): Promise<void> {
    if (challenge.protocolVersion !== REMNOTE_AGENT_PROTOCOL_VERSION) {
      throw new Error(`Unsupported server protocol ${challenge.protocolVersion}`);
    }
    const clientNonce = randomId();
    const proof = this.config.pairingSecret
      ? await createProof(this.config.pairingSecret, {
          serverInstanceId: challenge.serverInstanceId,
          serverNonce: challenge.nonce,
          clientNonce,
          installationId: this.config.installationId,
          bridgeVersion: this.config.pluginVersion,
          protocolVersion: REMNOTE_AGENT_PROTOCOL_VERSION,
        })
      : undefined;

    this.ws?.send(
      JSON.stringify({
        type: 'client_hello',
        protocolVersion: REMNOTE_AGENT_PROTOCOL_VERSION,
        bridgeVersion: this.config.pluginVersion,
        sdkVersion: this.config.sdkVersion,
        installationId: this.config.installationId,
        clientNonce,
        capabilities: this.config.capabilities,
        proof,
      })
    );
    this.log(`Sent authenticated client hello (v${this.config.pluginVersion})`);
  }

  private handlePairingRequired(message: PairingRequiredMessage): void {
    this.pairingId = message.pairingId;
    this.setAuthStatus('pairing-required');
    this.log('Pairing required. Enter the six-digit code shown by Codex.', 'warn');
  }

  private async handlePairingComplete(message: PairingCompleteMessage): Promise<void> {
    this.config.pairingSecret = message.secret;
    this.grantedScopes = [...message.grantedScopes];
    await this.config.onPairingSecretChange?.(message.secret);
    this.log('Pairing secret stored locally');
  }

  private handleAuthAccepted(message: AuthAcceptedMessage): void {
    this.pairingId = undefined;
    this.grantedScopes = [...message.grantedScopes];
    this.rejectionReason = undefined;
    this.setAuthStatus('authenticated');
    this.setStatus('connected');
    this.log(`Authenticated with scopes: ${this.grantedScopes.join(', ')}`);
  }

  private async handleAuthRejected(message: AuthRejectedMessage): Promise<void> {
    this.rejectionReason = message.reason;
    if (message.resetPairing) {
      this.config.pairingSecret = undefined;
      await this.config.onPairingSecretChange?.(undefined);
    }
    this.setAuthStatus('rejected');
    this.log(`Authentication rejected: ${message.reason}`, 'error');
  }

  private handleCompanionInfo(message: CompanionInfoMessage): void {
    this.setCompanionInfo({ kind: message.kind, version: message.version });
    this.log(`Companion identified: ${message.kind} v${message.version}`);
  }

  private async handleRequest(request: BridgeRequest): Promise<void> {
    const requestSocket = this.ws;
    const cached = this.responseCache.get(request.operationId);
    if (cached) {
      if (requestSocket?.readyState === WebSocket.OPEN) {
        requestSocket.send(JSON.stringify(cached));
      }
      this.log(`Replayed cached response: ${request.action}`);
      return;
    }

    const policy = getActionPolicy(request.action);
    const capability = this.config.capabilities.find(
      (candidate) => candidate.id === request.action
    );
    let response: BridgeResponse;
    if (this.authStatus !== 'authenticated') {
      response = errorResponse(request, 'NOT_AUTHENTICATED', 'Bridge is not authenticated');
    } else if (!policy || request.scope !== policy.scope) {
      response = errorResponse(request, 'POLICY_MISMATCH', 'Action scope does not match policy');
    } else if (!this.grantedScopes.includes(request.scope)) {
      response = errorResponse(request, 'SCOPE_DENIED', `Scope ${request.scope} was not granted`);
    } else if (!capability?.available) {
      response = errorResponse(
        request,
        'CAPABILITY_UNAVAILABLE',
        capability?.reason ?? `Capability ${request.action} is unavailable`
      );
    } else if (!this.messageHandler) {
      response = errorResponse(request, 'NO_HANDLER', 'Bridge request handler is unavailable');
    } else {
      try {
        const result = await Promise.race([
          this.messageHandler(request),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new BridgeActionTimeoutError()), BRIDGE_ACTION_TIMEOUT_MS)
          ),
        ]);
        response = { id: request.id, operationId: request.operationId, result };
        this.log(`Completed: ${request.action}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const timedOut = error instanceof BridgeActionTimeoutError;
        response = errorResponse(
          request,
          timedOut ? 'ACTION_TIMEOUT' : 'ACTION_FAILED',
          message,
          timedOut
        );
        this.log(`Failed: ${request.action} - ${message}`, 'error');
      }
    }

    this.cacheResponse(request.operationId, response);
    if (requestSocket === this.ws && requestSocket?.readyState === WebSocket.OPEN) {
      requestSocket.send(JSON.stringify(response));
    } else {
      this.log(`Skipped stale response for ${request.action}`, 'warn');
    }
  }

  private cacheResponse(operationId: string, response: BridgeResponse): void {
    this.responseCache.set(operationId, response);
    if (this.responseCache.size > 256) {
      const oldest = this.responseCache.keys().next().value as string | undefined;
      if (oldest) this.responseCache.delete(oldest);
    }
  }

  private scheduleReconnect(): void {
    if (this.isShuttingDown) return;
    let delay: number;
    if (this.reconnectAttempts < this.config.maxReconnectAttempts) {
      const baseDelay = Math.min(
        this.config.initialReconnectDelay * 2 ** this.reconnectAttempts,
        this.config.maxReconnectDelay
      );
      delay = baseDelay + Math.random() * 0.3 * baseDelay;
      this.reconnectAttempts += 1;
      this.setRetryPhase('burst');
      this.log(
        `Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts})`
      );
    } else {
      delay =
        this.config.standbyReconnectDelay + Math.random() * 0.1 * this.config.standbyReconnectDelay;
      this.setRetryPhase('standby');
      this.log(`Standby reconnect in ${Math.round(delay / 1000)}s`, 'warn');
    }
    this.lastRetryDelayMs = delay;
    this.nextRetryAt = Date.now() + delay;
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, delay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  private formatDisconnectReason(event: CloseEvent): string {
    if (event.code === 1008 && isBridgeCompatibilityDisconnect(event.reason)) {
      return `${event.code} ${formatBridgeCompatibilityDisconnect(this.config.pluginVersion)}`;
    }
    return event.reason ? `${event.code} ${event.reason}` : `${event.code}`;
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.config.onStatusChange?.(status);
    }
  }

  private setAuthStatus(status: AuthStatus): void {
    this.authStatus = status;
    this.config.onAuthChange?.(this.getAuthSnapshot());
  }

  private setRetryPhase(phase: RetryPhase): void {
    if (this.retryPhase !== phase) {
      this.retryPhase = phase;
      this.config.onRetryPhaseChange?.(phase);
    }
  }

  private setCompanionInfo(info: CompanionInfo | undefined): void {
    if (this.companionInfo?.kind === info?.kind && this.companionInfo?.version === info?.version) {
      return;
    }
    this.companionInfo = info;
    this.config.onCompanionInfoChange?.(info);
  }

  private log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    this.config.onLog?.(message, level);
  }
}

function defaultCapabilities(): BridgeCapability[] {
  return Object.entries(ACTION_POLICIES).map(([id, policy]) => ({
    id,
    scope: policy.scope,
    risk: policy.risk,
    available: true,
  }));
}

function errorResponse(
  request: BridgeRequest,
  code: string,
  message: string,
  retryable = false
): BridgeResponse {
  return {
    id: request.id,
    operationId: request.operationId,
    error: { code, message, retryable },
  };
}

function randomId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `rn-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

async function createProof(
  secret: string,
  input: Parameters<typeof canonicalAuthMessage>[0]
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = new Uint8Array(
    await globalThis.crypto.subtle.sign('HMAC', key, encoder.encode(canonicalAuthMessage(input)))
  );
  let binary = '';
  signature.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
