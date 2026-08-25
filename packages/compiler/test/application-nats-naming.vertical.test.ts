import { describe, expect, it } from 'vitest';
import { jetStreamConsumerName } from '../src/application-nats-naming.js';

describe('generated JetStream consumer naming', () => {
  it('preserves conventional names and collision-resistently lowers JetStream-invalid identities', () => {
    expect(jetStreamConsumerName('CompilerParent-commands')).toBe(
      'compiler-parent-commands',
    );

    const dotted = jetStreamConsumerName('usage.recorded.v1');
    const dashed = jetStreamConsumerName('usage-recorded-v1');
    expect(dotted).toMatch(/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/u);
    expect(dotted).not.toContain('.');
    expect(dotted).not.toBe(dashed);
    expect(dotted.length).toBeLessThanOrEqual(63);
  });
});
