// typecast-file-boundary: Test exporters expose OpenTelemetry's erased recording shapes for semantic assertions.
import { AggregationTemporality, InMemoryMetricExporter, MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import type { ApplicationTelemetryEnvelopeV1 } from '@applik8s/core';
import { describe, expect, it } from 'vitest';
import {
  applicationOtlpSignalEndpoint,
  createApplicationOpenTelemetryRuntime,
} from '../src/index.js';

describe('OpenTelemetry runtime', () => {
  it('uses parent-child context for synchronous work and links separate asynchronous traces', async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
    const runtime = createApplicationOpenTelemetryRuntime({
      application: 'demo',
      environment: 'test',
      target: 'local',
      tracer: provider.getTracer('test'),
    });
    let producer = runtime.capture();

    await runtime.run({ kind: 'http', identity: 'post.publish', execution: 'request:one' }, async () => {
      producer = runtime.capture();
      await runtime.run({ kind: 'model', identity: 'post.commit', execution: 'transaction:one' }, async () => {
        expect(runtime.capture()?.identity.operation).toBe('post.commit');
      });
    });
    expect(producer).toBeDefined();
    if (!producer) throw new Error('Producer telemetry carrier was not captured.');
    await runtime.run({
      kind: 'processor',
      identity: 'timeline.project',
      execution: 'delivery:one',
      relationship: 'asynchronous',
      parent: producer,
    }, async () => undefined);

    const spans = exporter.getFinishedSpans();
    const request = spans.find(({ name }) => name === 'applik8s.http.post.publish');
    const commit = spans.find(({ name }) => name === 'applik8s.model.post.commit');
    const consumer = spans.find(({ name }) => name === 'applik8s.processor.timeline.project');
    expect(request).toBeDefined();
    expect(commit?.spanContext().traceId).toBe(request?.spanContext().traceId);
    expect(commit?.parentSpanContext?.spanId).toBe(request?.spanContext().spanId);
    expect(consumer?.spanContext().traceId).not.toBe(request?.spanContext().traceId);
    expect(consumer?.parentSpanContext).toBeUndefined();
    expect(consumer?.links).toHaveLength(1);
    expect(consumer?.links[0]?.context.traceId).toBe(request?.spanContext().traceId);
    expect(consumer?.links[0]?.context.spanId).toBe(request?.spanContext().spanId);
    await provider.shutdown();
  });

  it('bounds fan-in links and keeps the durable carrier free of raw identities and payloads', async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
    const runtime = createApplicationOpenTelemetryRuntime({
      application: 'demo',
      environment: 'test',
      target: 'local',
      tracer: provider.getTracer('test'),
      maximumSpanLinks: 2,
      allowedBaggageKeys: ['tenant.class'],
      maximumBaggageBytes: 128,
    });
    const carriers: ApplicationTelemetryEnvelopeV1[] = [];
    for (let index = 0; index < 4; index += 1) {
      await runtime.run({ kind: 'event', identity: `post.issued.${index}` }, async () => {
        const carrier = runtime.capture();
        if (carrier) carriers.push(carrier);
      });
    }
    await runtime.run({
      kind: 'processor',
      identity: 'timeline.batch',
      relationship: 'asynchronous',
      links: carriers,
      principalClass: 'human',
      causalPrincipalClass: 'human',
      attributes: {
        principalId: 'principal:private',
        payload: 'private body',
      },
      baggage: {
        'tenant.class': 'starter',
        'credential.token': 'private-baggage',
      },
    }, async () => {
      const carrier = runtime.capture();
      expect(carrier?.identity).toMatchObject({
        principalClass: 'human',
        causalPrincipalClass: 'human',
      });
      expect(JSON.stringify(carrier)).not.toContain('principal:private');
      expect(JSON.stringify(carrier)).not.toContain('private body');
      expect(carrier?.baggage).toEqual({ 'tenant.class': 'starter' });
      expect(JSON.stringify(carrier)).not.toContain('private-baggage');
    });
    const consumer = exporter.getFinishedSpans().find(({ name }) => name.endsWith('timeline.batch'));
    expect(consumer?.links).toHaveLength(2);
    expect(consumer?.attributes).toMatchObject({ 'applik8s.links.dropped': 2 });
    expect(JSON.stringify(consumer?.attributes)).not.toContain('principal:private');
    expect(JSON.stringify(consumer?.attributes)).not.toContain('private body');
    await provider.shutdown();
  });

  it('drops an incompatible carrier without blocking the managed operation', async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
    const runtime = createApplicationOpenTelemetryRuntime({
      application: 'demo',
      environment: 'test',
      target: 'local',
      tracer: provider.getTracer('test'),
    });
    const malformed = {
      version: 'applik8s.telemetry/v0',
      traceparent: 'private-carrier',
    } as unknown as ApplicationTelemetryEnvelopeV1;
    await expect(runtime.run({
      kind: 'workflow',
      identity: 'document.publish',
      relationship: 'asynchronous',
      parent: malformed,
    }, async () => 'completed')).resolves.toBe('completed');
    const span = exporter.getFinishedSpans().find(({ name }) => name.endsWith('document.publish'));
    expect(span).toBeDefined();
    expect(span?.parentSpanContext).toBeUndefined();
    await provider.shutdown();
  });

  it('records catalog metrics, enforces cardinality, and isolates a failing log sink', async () => {
    const spanExporter = new InMemorySpanExporter();
    const traceProvider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(spanExporter)],
    });
    const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const metricReader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 60_000,
    });
    const meterProvider = new MeterProvider({ readers: [metricReader] });
    const runtime = createApplicationOpenTelemetryRuntime({
      application: 'demo',
      environment: 'test',
      target: 'local',
      tracer: traceProvider.getTracer('test'),
      meter: meterProvider.getMeter('test'),
      maximumMetricSeries: 1,
      log: () => {
        throw new Error('collector unavailable');
      },
    });
    await expect(runtime.run({ kind: 'actor', identity: 'workspace.rename' }, async () => {
      runtime.log('info', 'renamed', { token: 'do-not-leak' });
      return 'business-result';
    })).resolves.toBe('business-result');
    runtime.count('applik8s.actor.authority.legacy_read', 1, {
      'applik8s.actor.authority.format': 'legacy-a',
    });
    runtime.count('applik8s.actor.authority.legacy_read', 1, {
      'applik8s.actor.authority.format': 'legacy-b',
    });
    expect(() => runtime.record('applik8s.operation.duration', 1, {
      'applik8s.operation': 'ok',
      forbidden: 'unbounded',
    })).toThrow(/does not allow attribute/u);
    await meterProvider.forceFlush();
    const metricNames = metricExporter.getMetrics().flatMap(({ scopeMetrics }) =>
      scopeMetrics.flatMap(({ metrics: exported }) => exported.map(({ descriptor }) => descriptor.name)));
    expect(metricNames).toEqual(expect.arrayContaining([
      'applik8s.operation.count',
      'applik8s.telemetry.drop',
      'applik8s.telemetry.export.failure',
    ]));
    await meterProvider.shutdown();
    await traceProvider.shutdown();
  });

  it('records failures without error messages and redacts correlated structured logs', async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
    const records: Record<string, unknown>[] = [];
    const runtime = createApplicationOpenTelemetryRuntime({
      application: 'demo',
      environment: 'test',
      target: 'local',
      tracer: provider.getTracer('test'),
      log: (record) => records.push(record as Record<string, unknown>),
      now: () => new Date('2026-08-24T12:00:00.000Z'),
    });
    await runtime.run({ kind: 'actor', identity: 'workspace.rename' }, async () => {
      runtime.log('info', 'renamed', {
        token: 'do-not-leak',
        principalId: 'principal:private',
        revision: 2,
      });
    });
    await expect(runtime.run({ kind: 'schedule', identity: 'cleanup' }, async () => {
      throw new Error('private payload');
    })).rejects.toThrow('private payload');
    const spans = exporter.getFinishedSpans();
    expect(spans.map(({ name }) => name)).toEqual(['applik8s.actor.workspace.rename', 'applik8s.schedule.cleanup']);
    expect(spans[1]?.attributes).toMatchObject({ 'error.type': 'Error' });
    expect(JSON.stringify(spans.map(({ attributes, events, status }) => ({ attributes, events, status })))).not.toContain('private payload');
    expect(records[0]).toMatchObject({
      version: 'applik8s.log/v1alpha1',
      timestamp: '2026-08-24T12:00:00.000Z',
      traceId: expect.stringMatching(/^[0-9a-f]{32}$/u),
      spanId: expect.stringMatching(/^[0-9a-f]{16}$/u),
      fields: {
        token: '[REDACTED]',
        principalId: '[REDACTED]',
        revision: 2,
      },
    });
    await provider.shutdown();
  });

  it('preserves OTLP base paths and rejects credential-bearing or non-HTTP endpoints', () => {
    expect(applicationOtlpSignalEndpoint('https://collector.example/tenant/acme', 'traces'))
      .toBe('https://collector.example/tenant/acme/v1/traces');
    expect(applicationOtlpSignalEndpoint('https://collector.example/tenant/acme/v1/metrics', 'metrics'))
      .toBe('https://collector.example/tenant/acme/v1/metrics');
    expect(() => applicationOtlpSignalEndpoint('grpc://collector.example', 'traces'))
      .toThrow(/HTTP or HTTPS/u);
    expect(() => applicationOtlpSignalEndpoint('https://user:secret@collector.example', 'traces'))
      .toThrow(/Secret-backed header/u);
    expect(() => createApplicationOpenTelemetryRuntime({
      application: 'demo',
      environment: 'test',
      target: 'local',
      allowedBaggageKeys: ['principal.id'],
    })).toThrow(/not a safe stable attribute/u);
  });
});
