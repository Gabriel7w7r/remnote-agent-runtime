import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CapabilityRisk, CapabilityScope } from '@remnote-agent/protocol';

export interface AuditEntry {
  timestamp: string;
  operationId: string;
  requestId: string;
  action: string;
  scope: CapabilityScope;
  risk: CapabilityRisk;
  payloadHash: string;
  payloadKeys: string[];
  durationMs: number;
  outcome: 'success' | 'error' | 'timeout' | 'transport_error';
  error?: string;
}

export class AuditLog {
  readonly path: string;

  constructor(stateDir: string, path = join(stateDir, 'audit.jsonl')) {
    this.path = path;
  }

  payloadFingerprint(payload: Record<string, unknown>): {
    payloadHash: string;
    payloadKeys: string[];
  } {
    const canonical = stableStringify(payload);
    return {
      payloadHash: createHash('sha256').update(canonical).digest('hex'),
      payloadKeys: Object.keys(payload).sort(),
    };
  }

  append(entry: AuditEntry): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    appendFileSync(this.path, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
  }

  readRecent(limit = 100): AuditEntry[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new Error('Audit limit must be an integer between 1 and 1000');
    }
    try {
      return readFileSync(this.path, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .slice(-limit)
        .map((line) => JSON.parse(line) as AuditEntry);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}
