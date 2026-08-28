import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalhostOAuthProvider } from '../../src/oauth-provider.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

const TEST_CLIENT: OAuthClientInformationFull = {
  client_id: 'test-client-id',
  client_id_issued_at: Math.floor(Date.now() / 1000),
  redirect_uris: ['http://localhost:9999/callback'],
  client_name: 'Test Client',
};

const TEST_AUTH_PARAMS = {
  codeChallenge: 'test-challenge',
  redirectUri: 'http://localhost:9999/callback',
  scopes: ['mcp:tools'],
};

describe('LocalhostOAuthProvider', () => {
  let provider: LocalhostOAuthProvider;

  beforeEach(() => {
    provider = new LocalhostOAuthProvider();
  });

  describe('clientsStore', () => {
    it('registers a new client and returns it with a generated client_id', async () => {
      const {
        client_id: _clientId,
        client_id_issued_at: _clientIdIssuedAt,
        ...metadata
      } = TEST_CLIENT;
      const registered = await provider.clientsStore.registerClient!(metadata);

      expect(registered.client_id).toBeDefined();
      expect(registered.client_id).not.toBe('');
      expect(registered.client_id_issued_at).toBeGreaterThan(0);
      expect(registered.redirect_uris).toEqual(TEST_CLIENT.redirect_uris);
    });

    it('retrieves a registered client by id', async () => {
      const {
        client_id: _clientId,
        client_id_issued_at: _clientIdIssuedAt,
        ...metadata
      } = TEST_CLIENT;
      const registered = await provider.clientsStore.registerClient!(metadata);
      const fetched = await provider.clientsStore.getClient(registered.client_id);

      expect(fetched).toEqual(registered);
    });

    it('returns undefined for an unknown client id', async () => {
      const result = await provider.clientsStore.getClient('nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('authorize', () => {
    it('redirects to the redirect_uri with a code and state', async () => {
      const redirectSpy = vi.fn();
      const mockRes = { redirect: redirectSpy } as unknown as import('express').Response;

      await provider.authorize(TEST_CLIENT, { ...TEST_AUTH_PARAMS, state: 'xyz' }, mockRes);

      expect(redirectSpy).toHaveBeenCalledOnce();
      const redirectUrl = new URL(redirectSpy.mock.calls[0][0]);
      expect(redirectUrl.origin + redirectUrl.pathname).toBe('http://localhost:9999/callback');
      expect(redirectUrl.searchParams.get('code')).toBeTruthy();
      expect(redirectUrl.searchParams.get('state')).toBe('xyz');
    });

    it('redirects without state when not provided', async () => {
      const redirectSpy = vi.fn();
      const mockRes = { redirect: redirectSpy } as unknown as import('express').Response;

      await provider.authorize(TEST_CLIENT, TEST_AUTH_PARAMS, mockRes);

      const redirectUrl = new URL(redirectSpy.mock.calls[0][0]);
      expect(redirectUrl.searchParams.has('state')).toBe(false);
    });

    it('throws InvalidRequestError for unregistered redirect_uri', async () => {
      const mockRes = {} as unknown as import('express').Response;

      await expect(
        provider.authorize(
          TEST_CLIENT,
          { ...TEST_AUTH_PARAMS, redirectUri: 'http://evil.example.com/callback' },
          mockRes
        )
      ).rejects.toThrow('Unregistered redirect_uri');
    });
  });

  describe('challengeForAuthorizationCode', () => {
    it('returns the code challenge for a valid code', async () => {
      const redirectSpy = vi.fn();
      const mockRes = { redirect: redirectSpy } as unknown as import('express').Response;
      await provider.authorize(TEST_CLIENT, TEST_AUTH_PARAMS, mockRes);

      const redirectUrl = new URL(redirectSpy.mock.calls[0][0]);
      const code = redirectUrl.searchParams.get('code')!;

      const challenge = await provider.challengeForAuthorizationCode(TEST_CLIENT, code);
      expect(challenge).toBe(TEST_AUTH_PARAMS.codeChallenge);
    });

    it('throws for an invalid code', async () => {
      await expect(
        provider.challengeForAuthorizationCode(TEST_CLIENT, 'bogus-code')
      ).rejects.toThrow('Invalid authorization code');
    });
  });

  describe('exchangeAuthorizationCode', () => {
    async function issueCode(): Promise<string> {
      const redirectSpy = vi.fn();
      const mockRes = { redirect: redirectSpy } as unknown as import('express').Response;
      await provider.authorize(TEST_CLIENT, TEST_AUTH_PARAMS, mockRes);
      return new URL(redirectSpy.mock.calls[0][0]).searchParams.get('code')!;
    }

    it('returns an access token for a valid code', async () => {
      const code = await issueCode();
      const tokens = await provider.exchangeAuthorizationCode(TEST_CLIENT, code);

      expect(tokens.access_token).toBeTruthy();
      expect(tokens.token_type).toBe('bearer');
      expect(tokens.expires_in).toBe(3600);
    });

    it('deletes the code after exchange (single-use)', async () => {
      const code = await issueCode();
      await provider.exchangeAuthorizationCode(TEST_CLIENT, code);

      await expect(provider.exchangeAuthorizationCode(TEST_CLIENT, code)).rejects.toThrow(
        'Invalid authorization code'
      );
    });

    it('throws for an invalid code', async () => {
      await expect(provider.exchangeAuthorizationCode(TEST_CLIENT, 'bogus-code')).rejects.toThrow(
        'Invalid authorization code'
      );
    });

    it('throws when the code was issued to a different client', async () => {
      const code = await issueCode();
      const otherClient = { ...TEST_CLIENT, client_id: 'other-client' };

      await expect(provider.exchangeAuthorizationCode(otherClient, code)).rejects.toThrow(
        'not issued to this client'
      );
    });
  });

  describe('verifyAccessToken', () => {
    async function issueToken(): Promise<string> {
      const redirectSpy = vi.fn();
      const mockRes = { redirect: redirectSpy } as unknown as import('express').Response;
      await provider.authorize(TEST_CLIENT, TEST_AUTH_PARAMS, mockRes);
      const code = new URL(redirectSpy.mock.calls[0][0]).searchParams.get('code')!;
      const tokens = await provider.exchangeAuthorizationCode(TEST_CLIENT, code);
      return tokens.access_token;
    }

    it('returns AuthInfo for a valid token', async () => {
      const token = await issueToken();
      const info = await provider.verifyAccessToken(token);

      expect(info.token).toBe(token);
      expect(info.clientId).toBe(TEST_CLIENT.client_id);
      expect(info.scopes).toEqual(TEST_AUTH_PARAMS.scopes);
      expect(info.expiresAt).toBeGreaterThan(Date.now() / 1000);
    });

    it('throws for an unknown token', async () => {
      await expect(provider.verifyAccessToken('bogus-token')).rejects.toThrow(
        'Invalid or expired token'
      );
    });
  });

  describe('revokeToken', () => {
    async function issueToken(): Promise<string> {
      const redirectSpy = vi.fn();
      const mockRes = { redirect: redirectSpy } as unknown as import('express').Response;
      await provider.authorize(TEST_CLIENT, TEST_AUTH_PARAMS, mockRes);
      const code = new URL(redirectSpy.mock.calls[0][0]).searchParams.get('code')!;
      const tokens = await provider.exchangeAuthorizationCode(TEST_CLIENT, code);
      return tokens.access_token;
    }

    it('makes a revoked token invalid', async () => {
      const token = await issueToken();
      await provider.revokeToken(TEST_CLIENT, { token, token_type_hint: 'access_token' });

      await expect(provider.verifyAccessToken(token)).rejects.toThrow('Invalid or expired token');
    });
  });

  describe('exchangeRefreshToken', () => {
    it('always throws (not supported)', async () => {
      await expect(provider.exchangeRefreshToken()).rejects.toThrow('Refresh tokens not supported');
    });
  });
});
