import { createDeterministicApplicationJobRuntime } from '@applik8s/applik8s';
import { describe, expect, test } from 'vitest';
import { inspectApplicationJobRuntimeConformance } from '../src/job-runtime-conformance.js';

describe('finite Job provider conformance', () => {
  test('qualifies the deterministic local semantic reference through the reusable black-box suite', async () => {
    const report = await inspectApplicationJobRuntimeConformance({
      name: 'deterministic-local',
      createRuntime: ({ maximumConcurrency }) => createDeterministicApplicationJobRuntime({ maximumConcurrency }),
    });

    expect(report.checks.map(({ id }) => id)).toEqual([
      'direct-and-start-result-parity',
      'scoped-idempotency-and-conflict',
      'whole-attempt-retry-and-typed-failure',
      'queued-cancellation-and-terminal-race',
      'caller-timeout-rejoin',
      'deadline-first-terminal-transition',
      'progress-and-causal-admission',
    ]);
    expect(report, report.checks.filter(({ passed }) => !passed).map(({ id, message }) => `${id}: ${message}`).join('\n')).toMatchObject({
      protocol: 'applik8s.jobRuntimeConformance/v1alpha1',
      provider: 'deterministic-local',
      ok: true,
    });
  });
});
