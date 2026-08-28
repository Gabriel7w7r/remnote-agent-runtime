import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalAuthMessage } from '@remnote-agent/protocol';
import { AuthStore } from '../../src/auth-store.js';

describe('AuthStore', () => {
  it('persists one HTTP token and verifies it timing-safely', () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'remnote-agent-auth-'));
    const first = new AuthStore(stateDir);
    const token = first.getHttpToken();
    const second = new AuthStore(stateDir);

    expect(second.getHttpToken()).toBe(token);
    expect(second.verifyHttpToken(token)).toBe(true);
    expect(second.verifyHttpToken(`${token}x`)).toBe(false);
    expect(JSON.parse(readFileSync(join(stateDir, 'auth.json'), 'utf8')).httpToken).toBe(token);
  });

  it('pairs once and accepts a valid reconnect proof', () => {
    const store = new AuthStore(mkdtempSync(join(tmpdir(), 'remnote-agent-auth-')));
    const challenge = store.ensurePairingChallenge('install-1');
    const status = store.getPairingStatus();
    const pairing = store.completePairing({
      pairingId: challenge.pairingId,
      pairingCode: String(status.pairingCode),
      installationId: 'install-1',
      bridgeVersion: '0.19.0',
      sdkVersion: '0.0.46',
      capabilities: [],
    });
    const proofInput = {
      serverInstanceId: 'server-1',
      serverNonce: 'server-nonce',
      clientNonce: 'client-nonce',
      installationId: 'install-1',
      bridgeVersion: '0.19.0',
      protocolVersion: 2,
    };
    const proof = createHmac('sha256', pairing.secret)
      .update(canonicalAuthMessage(proofInput))
      .digest('base64url');

    expect(store.verifyBridgeProof({ ...proofInput, proof })).toBe(true);
    expect(store.verifyBridgeProof({ ...proofInput, proof: `${proof}x` })).toBe(false);
  });
});
