import { describe, expect, it } from 'vitest';

import { diagnosticAdviceForDiagnostic, diagnosticAdviceForReason, diagnosticTaxonomyEntries } from '../src/index.js';

describe('diagnostic taxonomy', () => {
  it('maps common first-error reasons to user-facing recovery guidance', () => {
    expect(diagnosticAdviceForReason('UndeclaredPermission')).toMatchObject({
      category: 'rbac',
      effects: 'none',
      retry: 'notUntilFixed',
    });
    expect(diagnosticAdviceForReason('ApplyFailed')).toMatchObject({
      category: 'kubernetes',
      effects: 'partial',
      retry: 'automatic',
    });
    expect(diagnosticAdviceForReason('HandlerRuntimeFailed')?.howToFix).toContain('source-mapped stack frames');
  });

  it('can resolve advice from typed diagnostic codes', () => {
    expect(diagnosticAdviceForDiagnostic({
      code: 'BUNDLE_INVALID',
      message: 'invalid bundle',
      severity: 'error',
    })).toMatchObject({ reason: 'BUNDLE_INVALID' });

    expect(diagnosticAdviceForDiagnostic({
      code: 'SCHEMA_UNSUPPORTED',
      message: 'schema failed',
      severity: 'error',
    })).toMatchObject({ reason: 'SCHEMA_UNSUPPORTED' });
  });

  it('keeps taxonomy entries complete enough for docs and CLI output', () => {
    for (const entry of diagnosticTaxonomyEntries()) {
      expect(entry.reason.length).toBeGreaterThan(0);
      expect(entry.whatHappened.length).toBeGreaterThan(20);
      expect(entry.likelyCause.length).toBeGreaterThan(20);
      expect(entry.howToFix.length).toBeGreaterThan(20);
    }
  });
});
