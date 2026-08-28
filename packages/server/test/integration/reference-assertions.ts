import { assertEqual, assertTruthy } from './assertions.js';

type InlineRef = Record<string, unknown>;

function collectInlineRefs(value: unknown, refs: InlineRef[] = []): InlineRef[] {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectInlineRefs(item, refs);
    }
    return refs;
  }

  if (!value || typeof value !== 'object') {
    return refs;
  }

  const record = value as Record<string, unknown>;
  if (Array.isArray(record.inlineRefs)) {
    for (const ref of record.inlineRefs) {
      if (ref && typeof ref === 'object') {
        refs.push(ref as InlineRef);
      }
    }
  }

  for (const [key, child] of Object.entries(record)) {
    if (key !== 'inlineRefs') {
      collectInlineRefs(child, refs);
    }
  }

  return refs;
}

export function assertInlineRefTargetCountAtLeast(
  value: unknown,
  targetRemId: string,
  expectedCount: number,
  label: string
): void {
  const matches = collectInlineRefs(value).filter((ref) => ref.targetRemId === targetRemId);

  assertTruthy(
    matches.length >= expectedCount,
    `${label}: expected at least ${expectedCount} inline reference(s) to ${targetRemId}, got ${matches.length}`
  );

  for (const [index, match] of matches.entries()) {
    assertEqual(match.kind, 'rem', `${label}: inline reference ${index} kind`);
    assertTruthy(
      typeof match.text === 'string' && match.text.length > 0,
      `${label}: inline reference ${index} should include rendered text`
    );
  }
}

export function assertInlineRefTarget(value: unknown, targetRemId: string, label: string): void {
  assertInlineRefTargetCountAtLeast(value, targetRemId, 1, label);
}
