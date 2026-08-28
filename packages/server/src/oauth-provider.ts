import { randomUUID } from 'crypto';
import type { Response } from 'express';
import type {
  OAuthServerProvider,
  AuthorizationParams,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { InvalidRequestError } from '@modelcontextprotocol/sdk/server/auth/errors.js';

interface TokenRecord {
  clientId: string;
  scopes: string[];
  expiresAt: number;
  resource?: URL;
}

interface CodeRecord {
  client: OAuthClientInformationFull;
  params: AuthorizationParams;
}

class InMemoryClientsStore implements OAuthRegisteredClientsStore {
  private clients = new Map<string, OAuthClientInformationFull>();

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    return this.clients.get(clientId);
  }

  registerClient(
    clientMetadata: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>
  ): OAuthClientInformationFull {
    const client: OAuthClientInformationFull = {
      ...clientMetadata,
      client_id: randomUUID(),
      client_id_issued_at: Math.floor(Date.now() / 1000),
    };
    this.clients.set(client.client_id, client);
    return client;
  }
}

/**
 * In-memory OAuth provider for localhost MCP servers.
 *
 * Auto-approves all client registrations and authorization requests without
 * user interaction. Suitable for localhost-only deployments where the local
 * machine is the trusted security boundary.
 *
 * All state is in-memory: tokens and registrations are lost on server restart,
 * causing MCP clients to re-authenticate automatically on next connection.
 */
export class LocalhostOAuthProvider implements OAuthServerProvider {
  readonly clientsStore: OAuthRegisteredClientsStore;
  private codes = new Map<string, CodeRecord>();
  private tokens = new Map<string, TokenRecord>();

  constructor() {
    this.clientsStore = new InMemoryClientsStore();
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response
  ): Promise<void> {
    if (!client.redirect_uris.includes(params.redirectUri)) {
      throw new InvalidRequestError('Unregistered redirect_uri');
    }

    const code = randomUUID();
    this.codes.set(code, { client, params });

    const target = new URL(params.redirectUri);
    target.searchParams.set('code', code);
    if (params.state !== undefined) {
      target.searchParams.set('state', params.state);
    }

    res.redirect(target.toString());
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<string> {
    const record = this.codes.get(authorizationCode);
    if (!record) throw new Error('Invalid authorization code');
    return record.params.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<OAuthTokens> {
    const record = this.codes.get(authorizationCode);
    if (!record) throw new Error('Invalid authorization code');
    if (record.client.client_id !== client.client_id) {
      throw new Error('Authorization code was not issued to this client');
    }

    this.codes.delete(authorizationCode);

    const token = randomUUID();
    this.tokens.set(token, {
      clientId: client.client_id,
      scopes: record.params.scopes ?? [],
      expiresAt: Date.now() + 3_600_000, // 1 hour
      resource: record.params.resource,
    });

    return {
      access_token: token,
      token_type: 'bearer',
      expires_in: 3600,
      scope: (record.params.scopes ?? []).join(' '),
    };
  }

  async exchangeRefreshToken(): Promise<OAuthTokens> {
    throw new Error('Refresh tokens not supported');
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const record = this.tokens.get(token);
    if (!record || record.expiresAt < Date.now()) {
      throw new Error('Invalid or expired token');
    }
    return {
      token,
      clientId: record.clientId,
      scopes: record.scopes,
      expiresAt: Math.floor(record.expiresAt / 1000),
      resource: record.resource,
    };
  }

  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest
  ): Promise<void> {
    this.tokens.delete(request.token);
  }
}
