// typecast-file-boundary: Telemetry tests deliberately create partial and malformed carriers that safe application code cannot construct.
import {
  ApplicationTelemetryContractError,
  applicationTelemetryMetricDefinition,
  createApplicationTelemetryEnvelopeV1,
  redactApplicationTelemetryValue,
  validateApplicationTelemetryEnvelopeV1,
  validateApplicationTelemetryMetricAttributes,
} from '@applik8s/core';
import { describe, expect, it } from 'vitest';

const traceparent = '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01';

describe('v0.8 telemetry semantic contract', () => {
  it('normalizes and validates one bounded portable carrier', () => {
    const carrier = createApplicationTelemetryEnvelopeV1({
      traceparent,
      tracestate: 'vendor=opaque',
      baggage: { 'tenant.class': 'starter', 'deployment.ring': 'canary' },
      identity: {
        application: 'agentic-start',
        environment: 'test',
        target: 'local',
        operation: 'document.create',
        execution: 'command.document.create',
        attempt: 2,
        principalClass: 'service',
        causalPrincipalClass: 'human',
      },
      invocation: { kind: 'retry', relationship: 'asynchronous' },
    });

    expect(carrier).toEqual({
      version: 'applik8s.telemetry/v1alpha1',
      traceparent,
      tracestate: 'vendor=opaque',
      baggage: { 'deployment.ring': 'canary', 'tenant.class': 'starter' },
      identity: expect.objectContaining({
        application: 'agentic-start',
        operation: 'document.create',
        attempt: 2,
        principalClass: 'service',
        causalPrincipalClass: 'human',
      }),
      invocation: {
        kind: 'retry',
        relationship: 'asynchronous',
        replaySuppressed: false,
      },
      sampled: true,
    });
    expect(() => validateApplicationTelemetryEnvelopeV1(carrier)).not.toThrow();
    expect(JSON.stringify(carrier)).not.toContain('principalId');
  });

  it('rejects malformed trace context, raw identities, and unbounded baggage', () => {
    const identity = {
      application: 'demo', environment: 'test', target: 'local',
      operation: 'operation', execution: 'execution', attempt: 1,
    } as const;
    expect(() => createApplicationTelemetryEnvelopeV1({ traceparent: 'invalid', identity }))
      .toThrow(ApplicationTelemetryContractError);
    expect(() => createApplicationTelemetryEnvelopeV1({
      traceparent,
      identity: { ...identity, principalClass: 'user-123' as never },
    })).toThrow(/principal class/u);
    expect(() => createApplicationTelemetryEnvelopeV1({
      traceparent,
      identity,
      baggage: { 'tenant.id': 'x'.repeat(257) },
    })).toThrow(/invalid or unbounded/u);
    const sampled = createApplicationTelemetryEnvelopeV1({ traceparent, identity });
    expect(() => validateApplicationTelemetryEnvelopeV1({ ...sampled, sampled: false }))
      .toThrow(/sampling fields are invalid/u);
    expect(createApplicationTelemetryEnvelopeV1({
      traceparent,
      identity,
      invocation: { kind: 'replay' },
    }).invocation.replaySuppressed).toBe(true);
    expect(() => validateApplicationTelemetryEnvelopeV1({
      ...sampled,
      invocation: { ...sampled.invocation, replaySuppressed: true },
    })).toThrow(/invocation and sampling fields are invalid/u);
  });

  it('redacts sensitive fields before any exporter and bounds recursive data', () => {
    const cyclic: Record<string, unknown> = {
      authorization: 'Bearer secret-canary',
      nested: {
        prompt: 'secret-prompt-canary',
        principalId: 'principal:secret-canary',
        safe: 'visible',
        queryValue: 'secret-query-canary',
      },
      safe: 'x'.repeat(3_000),
    };
    cyclic.self = cyclic;
    const redacted = redactApplicationTelemetryValue(cyclic, ['organizationEmail']);
    const encoded = JSON.stringify(redacted);
    expect(redacted).toMatchObject({
      authorization: '[REDACTED]',
      nested: {
        prompt: '[REDACTED]',
        principalId: '[REDACTED]',
        safe: 'visible',
        queryValue: '[REDACTED]',
      },
      self: '[CIRCULAR]',
    });
    expect(encoded).not.toContain('secret-canary');
    expect(encoded).not.toContain('secret-prompt-canary');
    expect(encoded).not.toContain('secret-query-canary');
    expect((redacted as { readonly safe: string }).safe).toHaveLength(2_048);
  });

  it('freezes metric units, temporality, boundaries, and attribute budgets', () => {
    const duration = applicationTelemetryMetricDefinition('applik8s.operation.duration');
    expect(duration).toMatchObject({
      kind: 'histogram',
      unit: 's',
      temporality: 'cumulative',
      boundaries: expect.arrayContaining([0.001, 1, 60]),
    });
    expect(() => validateApplicationTelemetryMetricAttributes(duration, {
      'applik8s.boundary.kind': 'workflow',
      'applik8s.operation': 'document.publish',
      'applik8s.result': 'ok',
    })).not.toThrow();
    expect(() => validateApplicationTelemetryMetricAttributes(duration, {
      'user.id': 'raw-user-id',
    })).toThrow(/does not allow attribute/u);
    expect(() => applicationTelemetryMetricDefinition('applik8s.dynamic.metric'))
      .toThrow(/not in the versioned/u);

    const integrity = applicationTelemetryMetricDefinition('applik8s.runtime.integrity.envelope');
    expect(integrity).toMatchObject({ kind: 'counter', unit: '{envelope}' });
    expect(() => validateApplicationTelemetryMetricAttributes(integrity, {
      'applik8s.runtime.integrity.purpose': 'applik8s.query-cursor/v1',
      'applik8s.runtime.integrity.format': 'legacy',
      'applik8s.runtime.integrity.operation': 'verify',
      'applik8s.runtime.integrity.result': 'accepted',
    })).not.toThrow();
  });
});
// typecast-file-boundary: Telemetry tests deliberately create partial and malformed carriers that safe application code cannot construct.
