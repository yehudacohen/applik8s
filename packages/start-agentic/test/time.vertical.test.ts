import { describe, expect, it } from 'vitest';
import { agenticLeaseExpiration } from '../src/time.js';

describe('Agentic Start trusted-time helpers', () => {
  it('derives a deterministic lease deadline from framework-issued time', () => {
    expect(agenticLeaseExpiration('2026-08-16T12:00:00.000Z', 10 * 60_000))
      .toBe('2026-08-16T12:10:00.000Z');
  });

  it('rejects invalid issuance evidence and unbounded durations', () => {
    expect(() => agenticLeaseExpiration('not-time', 10)).toThrow('ISO timestamp');
    expect(() => agenticLeaseExpiration('2026-08-16T12:00:00.000Z', 0))
      .toThrow('positive integer');
  });
});
