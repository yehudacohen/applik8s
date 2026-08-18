import {
  applicationOperationalHealthState,
} from '../src/health.js';
import { describe, expect, it } from 'vitest';

describe('browser-safe operational health', () => {
  it('requires non-inferred evidence and prioritizes actionable failure', () => {
    expect(applicationOperationalHealthState([
      { state: 'ready', authority: 'inferred' },
    ])).toBe('Needs verification');
    expect(applicationOperationalHealthState([
      { state: 'ready', authority: 'provider' },
    ])).toBe('Ready');
    expect(applicationOperationalHealthState([
      { state: 'ready', authority: 'provider' },
      { state: 'degraded', authority: 'canonical' },
    ])).toBe('Action required');
  });
});
