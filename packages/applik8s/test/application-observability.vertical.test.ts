// typecast-file-boundary: Test assertions inspect hidden graph metadata through the framework test helper.
import {
  app,
  applicationGraphFor,
  applicationTelemetryCarrierHeaderName,
  decodeApplicationTelemetryCarrier,
  encodeApplicationTelemetryCarrier,
  maximumApplicationTelemetryCarrierBytes,
  Observability,
  telemetryPolicy,
} from '@applik8s/applik8s';
import { createApplicationTelemetryEnvelopeV1, validateApplicationGraphStructure } from '@applik8s/core';
import { describe, expect, it } from 'vitest';

describe('v0.8 provider-neutral observability', () => {
  it('round-trips only bounded validated framework telemetry carriers', () => {
    const carrier = createApplicationTelemetryEnvelopeV1({
      traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
      identity: {
        application: 'observed',
        environment: 'test',
        target: 'local',
        operation: 'query:cards.list.v1',
        execution: 'http:query:cards.list.v1',
        attempt: 1,
      },
    });
    const encoded = encodeApplicationTelemetryCarrier(carrier);
    expect(applicationTelemetryCarrierHeaderName).toBe('x-applik8s-telemetry');
    expect(decodeApplicationTelemetryCarrier(encoded)).toEqual(carrier);
    expect(decodeApplicationTelemetryCarrier('{"version":"caller-authored"}')).toBeUndefined();
    expect(decodeApplicationTelemetryCarrier('x'.repeat(maximumApplicationTelemetryCarrierBytes + 1))).toBeUndefined();
    expect(encodeApplicationTelemetryCarrier({ ...carrier, traceparent: 'caller-authored' })).toBeUndefined();
  });

  it('normalizes bounded signal policy and records the selected provider in the canonical graph', () => {
    const policy = telemetryPolicy({
      logs: { level: 'info', overrides: { 'billing.checkout': 'debug' }, sample: { debug: 0.05 } },
      metrics: { interval: '30s', cardinalityBudget: 'bounded' },
      traces: { headSample: 0.2, alwaysSampleErrors: true, tailSample: { latency: '>2s' } },
      baggage: { allowedKeys: ['tenant.id'], maximumBytes: 1_024 },
    });
    const application = app('observability-fixture');
    application.provide(Observability, Observability.local({ policy }));
    const graph = applicationGraphFor(application.composition)!;

    expect(policy).toMatchObject({
      apiVersion: 'applik8s.telemetryPolicy/v1alpha1',
      metrics: { intervalSeconds: 30, cardinalityBudget: 'bounded' },
      traces: { headSample: 0.2, tailSample: { latencyGreaterThanSeconds: 2 } },
      baggage: { allowedKeys: ['tenant.id'], maximumBytes: 1_024 },
    });
    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'provider',
        interface: 'Observability',
        implementation: 'local-otel',
        config: expect.objectContaining({ observability: expect.objectContaining({ policy }) }),
      }),
    ]));
    expect(validateApplicationGraphStructure(graph)).toEqual([]);
  });

  it('rejects unbounded sampling, baggage, and external endpoints before deployment', () => {
    expect(() => telemetryPolicy({ traces: { headSample: 1.1 } })).toThrow(/between 0 and 1/u);
    expect(() => telemetryPolicy({ baggage: { allowedKeys: ['User ID'] } })).toThrow(/stable identifier/u);
    expect(() => telemetryPolicy({ baggage: { maximumBytes: 100_000 } })).toThrow(/between 0 and 8192/u);
    expect(() => Observability.otlp({ endpoint: 'collector.internal', policy: telemetryPolicy() })).toThrow(/absolute HTTP/u);
    expect(() => Observability.otlp({ endpoint: 'http://collector.internal', policy: telemetryPolicy() })).toThrow(/requires HTTPS/u);
    expect(() => Observability.otlp({ endpoint: 'https://user:secret@collector.internal', policy: telemetryPolicy() })).toThrow(/without URL credentials/u);
    expect(() => Observability.otlp({ endpoint: 'https://collector.internal', signals: [] })).toThrow(/non-empty unique subset/u);
    expect(() => Observability.otlp({
      endpoint: 'https://collector.internal',
      authentication: {
        secret: { apiVersion: 'v1', kind: 'ConfigMap', name: 'telemetry' },
        key: 'token', header: 'authorization',
      },
    })).toThrow(/named Secret/u);
    expect(() => Observability.otlp({
      endpoint: 'http://127.0.0.1:4318',
      tls: {
        trust: 'custom-ca',
        certificateAuthority: { apiVersion: 'v1', kind: 'Secret', name: 'telemetry-ca' },
        key: 'ca.crt',
      },
    })).toThrow(/custom CA trust requires HTTPS/u);
  });

  it('normalizes the generic external OTLP contract without embedding credential values', () => {
    const external = Observability.otlp({
      endpoint: 'https://collector.example/tenant/demo',
      signals: ['traces', 'logs'],
      authentication: {
        secret: { apiVersion: 'v1', kind: 'Secret', name: 'telemetry-auth', namespace: 'telemetry' },
        key: 'token', header: 'x-collector-token',
      },
      tls: {
        trust: 'custom-ca',
        certificateAuthority: { apiVersion: 'v1', kind: 'Secret', name: 'telemetry-ca', namespace: 'telemetry' },
        key: 'ca.crt', serverName: 'collector.example',
      },
    });
    expect(external).toMatchObject({
      kind: 'otlp', protocol: 'http/protobuf', signals: ['traces', 'logs'],
      authentication: { secret: { kind: 'Secret', name: 'telemetry-auth' }, key: 'token', header: 'x-collector-token' },
      tls: { trust: 'custom-ca', certificateAuthority: { kind: 'Secret', name: 'telemetry-ca' }, key: 'ca.crt' },
    });
    expect(JSON.stringify(external)).not.toContain('secret-header-canary');
  });
});
