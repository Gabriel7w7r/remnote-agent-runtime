import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AuditLog } from '../../src/audit-log.js';

describe('AuditLog', () => {
  let stateDir: string | undefined;

  afterEach(async () => {
    if (stateDir) await rm(stateDir, { recursive: true, force: true });
  });

  it('stores metadata and a stable payload hash without storing payload contents', async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'remnote-agent-audit-'));
    const audit = new AuditLog(stateDir);
    const first = audit.payloadFingerprint({ title: 'private note', nested: { b: 2, a: 1 } });
    const second = audit.payloadFingerprint({ nested: { a: 1, b: 2 }, title: 'private note' });
    expect(first).toEqual(second);

    audit.append({
      timestamp: new Date(0).toISOString(),
      operationId: 'operation-1',
      requestId: 'request-1',
      action: 'create_note',
      scope: 'write',
      risk: 'write',
      ...first,
      durationMs: 4,
      outcome: 'success',
    });

    const entries = audit.readRecent();
    expect(entries).toHaveLength(1);
    expect(entries[0].payloadKeys).toEqual(['nested', 'title']);
    expect(JSON.stringify(entries)).not.toContain('private note');
  });

  it('returns an empty list before the audit file exists and validates limits', async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'remnote-agent-audit-'));
    const audit = new AuditLog(stateDir);
    expect(audit.readRecent()).toEqual([]);
    expect(() => audit.readRecent(0)).toThrow('between 1 and 1000');
  });

  it('never persists raw error messages from the SDK', async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'remnote-agent-audit-'));
    const audit = new AuditLog(stateDir);
    for (const outcome of ['success', 'error', 'timeout', 'transport_error'] as const) {
      audit.append({
        timestamp: new Date(0).toISOString(),
        operationId: 'op',
        requestId: 'req',
        action: 'search',
        scope: 'read',
        risk: 'read',
        ...audit.payloadFingerprint({ query: 'PRIVATE_NOTE_SENTINEL' }),
        durationMs: 1,
        outcome,
        error: 'PRIVATE_ERROR_SENTINEL',
      });
    }
    const disk = await readFile(audit.path, 'utf8');
    expect(disk).not.toContain('PRIVATE_NOTE_SENTINEL');
    expect(disk).not.toContain('PRIVATE_ERROR_SENTINEL');
    expect(audit.readRecent().map((entry) => entry.error)).toEqual([
      undefined,
      'ERROR',
      'TIMEOUT',
      'TRANSPORT_ERROR',
    ]);
  });
});
