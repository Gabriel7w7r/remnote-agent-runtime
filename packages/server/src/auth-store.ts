import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  canonicalAuthMessage,
  CAPABILITY_SCOPES,
  type BridgeCapability,
  type CapabilityScope,
} from '@remnote-agent/protocol';

const AUTH_SCHEMA_VERSION = 1;
const PAIRING_TTL_MS = 10 * 60 * 1000;

interface PairedBridge {
  installationId: string;
  secret: string;
  scopes: CapabilityScope[];
  bridgeVersion: string;
  sdkVersion: string;
  capabilities: BridgeCapability[];
  pairedAt: string;
}

interface AuthState {
  schemaVersion: typeof AUTH_SCHEMA_VERSION;
  httpToken: string;
  pairedBridge?: PairedBridge;
}

interface PairingChallenge {
  pairingId: string;
  pairingCode: string;
  installationId: string;
  expiresAt: number;
}

export interface BridgeProofInput {
  serverInstanceId: string;
  serverNonce: string;
  clientNonce: string;
  installationId: string;
  bridgeVersion: string;
  protocolVersion: number;
  proof: string;
}

export class AuthStore {
  readonly stateDir: string;
  readonly authFile: string;
  private state: AuthState;
  private pairingChallenge: PairingChallenge | null = null;

  constructor(stateDir = process.env.REMNOTE_AGENT_STATE_DIR ?? join(homedir(), '.remnote-agent')) {
    this.stateDir = stateDir;
    this.authFile = join(stateDir, 'auth.json');
    this.state = this.loadOrCreate();
  }

  getHttpToken(): string {
    return this.state.httpToken;
  }

  verifyHttpToken(candidate: string | undefined): boolean {
    return safeEqual(this.state.httpToken, candidate);
  }

  getPairedBridge(): Readonly<PairedBridge> | null {
    return this.state.pairedBridge ?? null;
  }

  ensurePairingChallenge(installationId: string): Omit<PairingChallenge, 'pairingCode'> {
    const now = Date.now();
    if (
      !this.pairingChallenge ||
      this.pairingChallenge.expiresAt <= now ||
      this.pairingChallenge.installationId !== installationId
    ) {
      this.pairingChallenge = {
        pairingId: randomToken(18),
        pairingCode: randomInt(0, 1_000_000).toString().padStart(6, '0'),
        installationId,
        expiresAt: now + PAIRING_TTL_MS,
      };
    }

    const { pairingId, expiresAt } = this.pairingChallenge;
    return { pairingId, installationId, expiresAt };
  }

  getPairingStatus(): Record<string, unknown> {
    const paired = this.state.pairedBridge;
    const challenge =
      this.pairingChallenge && this.pairingChallenge.expiresAt > Date.now()
        ? this.pairingChallenge
        : null;

    return {
      paired: Boolean(paired),
      stateDir: this.stateDir,
      pairedInstallationId: paired?.installationId,
      pairedAt: paired?.pairedAt,
      grantedScopes: paired?.scopes ?? [],
      pairingPending: Boolean(challenge),
      pairingId: challenge?.pairingId,
      pairingCode: challenge?.pairingCode,
      pairingExpiresAt: challenge ? new Date(challenge.expiresAt).toISOString() : undefined,
    };
  }

  completePairing(input: {
    pairingId: string;
    pairingCode: string;
    installationId: string;
    bridgeVersion: string;
    sdkVersion: string;
    capabilities: BridgeCapability[];
  }): { secret: string; grantedScopes: CapabilityScope[] } {
    const challenge = this.pairingChallenge;
    if (!challenge || challenge.expiresAt <= Date.now()) {
      this.pairingChallenge = null;
      throw new Error('Pairing code expired. Request a new code and try again.');
    }
    if (
      challenge.pairingId !== input.pairingId ||
      challenge.installationId !== input.installationId ||
      !safeEqual(challenge.pairingCode, input.pairingCode)
    ) {
      throw new Error('Invalid pairing code.');
    }

    const secret = randomToken(32);
    const grantedScopes = [...CAPABILITY_SCOPES];
    this.state.pairedBridge = {
      installationId: input.installationId,
      secret,
      scopes: grantedScopes,
      bridgeVersion: input.bridgeVersion,
      sdkVersion: input.sdkVersion,
      capabilities: input.capabilities,
      pairedAt: new Date().toISOString(),
    };
    this.pairingChallenge = null;
    this.persist();
    return { secret, grantedScopes };
  }

  verifyBridgeProof(input: BridgeProofInput): boolean {
    const paired = this.state.pairedBridge;
    if (!paired || paired.installationId !== input.installationId) {
      return false;
    }
    const canonical = canonicalAuthMessage(input);
    const expected = createHmac('sha256', paired.secret).update(canonical).digest('base64url');
    return safeEqual(expected, input.proof);
  }

  resetPairing(): void {
    delete this.state.pairedBridge;
    this.pairingChallenge = null;
    this.persist();
  }

  private loadOrCreate(): AuthState {
    try {
      const parsed = JSON.parse(readFileSync(this.authFile, 'utf8')) as Partial<AuthState>;
      if (
        parsed.schemaVersion === AUTH_SCHEMA_VERSION &&
        typeof parsed.httpToken === 'string' &&
        parsed.httpToken.length >= 32
      ) {
        return parsed as AuthState;
      }
    } catch {
      // First run or an invalid legacy state is replaced with secure defaults.
    }

    const state: AuthState = {
      schemaVersion: AUTH_SCHEMA_VERSION,
      httpToken: randomToken(32),
    };
    this.state = state;
    this.persist();
    return state;
  }

  private persist(): void {
    mkdirSync(dirname(this.authFile), { recursive: true, mode: 0o700 });
    const temporaryFile = `${this.authFile}.${process.pid}.tmp`;
    writeFileSync(temporaryFile, `${JSON.stringify(this.state, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    renameSync(temporaryFile, this.authFile);
  }
}

function randomToken(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

function safeEqual(expected: string, candidate: string | undefined): boolean {
  if (typeof candidate !== 'string') {
    return false;
  }
  const expectedBuffer = Buffer.from(expected);
  const candidateBuffer = Buffer.from(candidate);
  return (
    expectedBuffer.length === candidateBuffer.length &&
    timingSafeEqual(expectedBuffer, candidateBuffer)
  );
}
