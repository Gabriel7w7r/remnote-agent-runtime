/**
 * Workflow 07: OAuth HTTP Surface
 *
 * Verifies the dummy localhost OAuth endpoints exposed by the MCP server:
 * metadata discovery, dynamic client registration, authorization redirect,
 * and PKCE token exchange.
 */

import { createHash } from 'node:crypto';
import { getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { assertContains, assertEqual, assertHasField, assertTruthy } from '../assertions.js';
import type { WorkflowContext, WorkflowResult, SharedState, StepResult } from '../types.js';

interface RegisteredClient {
  client_id: string;
  redirect_uris: string[];
}

interface AuthorizationServerMetadata {
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  registration_endpoint?: string;
}

function getOauthOrigin(serverBaseUrl: string): string {
  const url = new URL(serverBaseUrl);
  if (url.hostname === '127.0.0.1') {
    url.hostname = 'localhost';
  }
  return url.origin;
}

function createCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export async function oauthWorkflow(
  ctx: WorkflowContext,
  _state: SharedState
): Promise<WorkflowResult> {
  const steps: StepResult[] = [];
  const oauthOrigin = getOauthOrigin(ctx.serverBaseUrl);
  const resourceServerUrl = new URL('/mcp', oauthOrigin);
  const authMetadataUrl = new URL('/.well-known/oauth-authorization-server', ctx.serverBaseUrl);
  const protectedMetadataUrl = new URL(getOAuthProtectedResourceMetadataUrl(resourceServerUrl));
  const registerUrl = new URL('/register', ctx.serverBaseUrl);
  const redirectUri = 'http://localhost:9732/oauth/callback';
  const codeVerifier = 'oauth-integration-verifier-0123456789abcdef';
  const codeChallenge = createCodeChallenge(codeVerifier);
  let client: RegisteredClient | null = null;
  let authorizationCode: string | null = null;

  {
    const start = Date.now();
    try {
      const response = await fetch(authMetadataUrl);
      assertEqual(response.status, 200, 'authorization metadata status');
      const metadata = (await response.json()) as AuthorizationServerMetadata;
      assertEqual(metadata.issuer, `${oauthOrigin}/`, 'authorization metadata issuer');
      assertContains(
        String(metadata.authorization_endpoint),
        '/authorize',
        'authorization endpoint path'
      );
      assertContains(String(metadata.token_endpoint), '/token', 'token endpoint path');
      assertContains(
        String(metadata.registration_endpoint),
        '/register',
        'registration endpoint path'
      );
      steps.push({
        label: 'Authorization metadata is served',
        passed: true,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      steps.push({
        label: 'Authorization metadata is served',
        passed: false,
        durationMs: Date.now() - start,
        error: (e as Error).message,
      });
    }
  }

  {
    const start = Date.now();
    try {
      const response = await fetch(protectedMetadataUrl);
      assertEqual(response.status, 200, 'protected resource metadata status');
      const protectedMetadata = (await response.json()) as Record<string, unknown>;
      assertEqual(
        protectedMetadata.resource,
        resourceServerUrl.toString(),
        'protected resource metadata resource'
      );
      assertTruthy(
        Array.isArray(protectedMetadata.authorization_servers),
        'authorization_servers should be an array'
      );
      assertTruthy(
        (protectedMetadata.authorization_servers as unknown[]).includes(`${oauthOrigin}/`),
        'authorization_servers should include the issuer'
      );
      steps.push({
        label: 'Protected resource metadata is served at the RFC 9728 path',
        passed: true,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      steps.push({
        label: 'Protected resource metadata is served at the RFC 9728 path',
        passed: false,
        durationMs: Date.now() - start,
        error: (e as Error).message,
      });
    }
  }

  {
    const start = Date.now();
    try {
      const response = await fetch(registerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          redirect_uris: [redirectUri],
          client_name: 'OAuth Integration Test Client',
          token_endpoint_auth_method: 'none',
        }),
      });
      assertEqual(response.status, 201, 'registration status');
      const registered = (await response.json()) as RegisteredClient & Record<string, unknown>;
      assertHasField(registered, 'client_id', 'registered client');
      assertEqual(registered.client_id, String(registered.client_id), 'client_id should be string');
      assertEqual(registered.redirect_uris[0], redirectUri, 'registered redirect URI');
      client = registered;
      steps.push({
        label: 'Dynamic client registration succeeds',
        passed: true,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      steps.push({
        label: 'Dynamic client registration succeeds',
        passed: false,
        durationMs: Date.now() - start,
        error: (e as Error).message,
      });
    }
  }

  {
    const start = Date.now();
    try {
      assertTruthy(client, 'registered client should be available');
      const authorizeUrl = new URL('/authorize', ctx.serverBaseUrl);
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('client_id', client.client_id);
      authorizeUrl.searchParams.set('redirect_uri', redirectUri);
      authorizeUrl.searchParams.set('code_challenge', codeChallenge);
      authorizeUrl.searchParams.set('code_challenge_method', 'S256');
      authorizeUrl.searchParams.set('scope', 'mcp:tools');
      authorizeUrl.searchParams.set('state', ctx.runId);
      authorizeUrl.searchParams.set('resource', resourceServerUrl.toString());

      const response = await fetch(authorizeUrl, { redirect: 'manual' });
      assertEqual(response.status, 302, 'authorization redirect status');
      const location = response.headers.get('location');
      assertTruthy(location, 'authorization redirect location');
      const redirected = new URL(location as string);
      assertEqual(
        `${redirected.origin}${redirected.pathname}`,
        redirectUri,
        'authorization redirect target'
      );
      assertEqual(redirected.searchParams.get('state'), ctx.runId, 'authorization redirect state');
      authorizationCode = redirected.searchParams.get('code');
      assertTruthy(authorizationCode, 'authorization code should be present');
      steps.push({
        label: 'Authorization endpoint redirects with a code',
        passed: true,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      steps.push({
        label: 'Authorization endpoint redirects with a code',
        passed: false,
        durationMs: Date.now() - start,
        error: (e as Error).message,
      });
    }
  }

  {
    const start = Date.now();
    try {
      assertTruthy(client, 'registered client should be available');
      assertTruthy(authorizationCode, 'authorization code should be available');
      const form = new URLSearchParams({
        client_id: client.client_id,
        grant_type: 'authorization_code',
        code: authorizationCode,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
        resource: resourceServerUrl.toString(),
      });
      const response = await fetch(new URL('/token', ctx.serverBaseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
      });
      assertEqual(response.status, 200, 'token exchange status');
      const tokens = (await response.json()) as Record<string, unknown>;
      assertHasField(tokens, 'access_token', 'token response');
      assertEqual(tokens.token_type, 'bearer', 'token type');
      assertEqual(tokens.expires_in, 3600, 'token lifetime');
      assertEqual(tokens.scope, 'mcp:tools', 'token scope');
      steps.push({
        label: 'Token endpoint exchanges the code with PKCE',
        passed: true,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      steps.push({
        label: 'Token endpoint exchanges the code with PKCE',
        passed: false,
        durationMs: Date.now() - start,
        error: (e as Error).message,
      });
    }
  }

  return { name: 'OAuth HTTP Surface', steps, skipped: false };
}
