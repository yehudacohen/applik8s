// typecast-file-boundary: Test exporters expose OpenTelemetry's erased recording shapes for semantic assertions.

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ApplicationTelemetryEnvelopeV1 } from '@applik8s/core';
import { AggregationTemporality, InMemoryMetricExporter, MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { describe, expect, it } from 'vitest';
import {
  applicationOtlpSignalEndpoint,
  createApplicationOpenTelemetryRuntime,
  startApplicationOpenTelemetryRuntime,
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

  it('keeps synchronous and Promise provider attempts nested and redacts provider failures', async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
    const runtime = createApplicationOpenTelemetryRuntime({
      application: 'demo',
      environment: 'test',
      target: 'local',
      tracer: provider.getTracer('test'),
    });
    const privateFailure = new Error('token sk-private must not escape');

    await runtime.run({ kind: 'operation', identity: 'document.import' }, async () => {
      expect(runtime.runValue?.({
        kind: 'provider',
        identity: 'AcquisitionProvider.acquire',
        provider: 'provider.acquisition-provider.v1alpha1.primary',
        relationship: 'synchronous',
      }, () => 'sync-result')).toBe('sync-result');
      await expect(runtime.runValue?.({
        kind: 'provider',
        identity: 'AcquisitionProvider.acquire',
        provider: 'provider.acquisition-provider.v1alpha1.primary',
        relationship: 'synchronous',
      }, async () => { throw privateFailure; })).rejects.toBe(privateFailure);
    });

    const spans = exporter.getFinishedSpans();
    const parent = spans.find(({ name }) => name === 'applik8s.operation.document.import');
    const attempts = spans.filter(({ name }) =>
      name === 'applik8s.provider.AcquisitionProvider.acquire');
    expect(attempts).toHaveLength(2);
    expect(attempts.every(({ parentSpanContext }) =>
      parentSpanContext?.spanId === parent?.spanContext().spanId)).toBe(true);
    expect(attempts[1]?.attributes).toMatchObject({ 'error.type': 'Error' });
    expect(JSON.stringify(attempts.map(({ attributes, events, status }) => ({
      attributes,
      events,
      status,
    })))).not.toContain('sk-private');
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
    expect(applicationOtlpSignalEndpoint('https://collector.example/tenant/acme', 'logs'))
      .toBe('https://collector.example/tenant/acme/v1/logs');
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

  it('exports traces, metrics, and redacted logs over authenticated OTLP HTTP without leaking credentials', async () => {
    const requests: Array<{ path: string; authorization?: string; body: Buffer; mode: string }> = [];
    let mode: 'ok' | 'throttled' | 'malformed' = 'ok';
    const createReceiver = () => createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        requests.push({
          path: request.url ?? '', mode,
          ...(typeof request.headers['x-collector-token'] === 'string'
            ? { authorization: request.headers['x-collector-token'] }
            : {}),
          body: Buffer.concat(chunks),
        });
        if (mode === 'throttled') {
          response.writeHead(429, { 'content-type': 'application/x-protobuf' });
          response.end();
          return;
        }
        response.writeHead(200, { 'content-type': 'application/x-protobuf' });
        response.end(mode === 'malformed' ? 'not-protobuf' : undefined);
      });
    });
    let server = createReceiver();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/tenant/demo`;
    const session = await startApplicationOpenTelemetryRuntime({
      application: 'demo', environment: 'test', target: 'local', endpoint,
      headers: { 'x-collector-token': 'secret-header-canary' },
      metricIntervalMs: 500,
      exportTimeoutMs: 500,
      batchDelayMs: 25,
      maximumTraceQueueSize: 8,
      maximumLogQueueSize: 8,
      log: () => undefined,
    });
    await session.runtime.run({ kind: 'http', identity: 'documents.create' }, async () => {
      session.runtime.log('info', 'document.created', {
        token: 'secret-payload-canary',
        principalId: 'private-principal-canary',
        count: 1,
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 550));
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    const offlineStarted = performance.now();
    await expect(session.runtime.run({ kind: 'operation', identity: 'collector.offline' }, async () => {
      for (let index = 0; index < 64; index += 1) {
        session.runtime.log('info', 'collector.offline', { index, token: 'offline-private-canary' });
      }
      return 'business-progress';
    })).resolves.toBe('business-progress');
    expect(performance.now() - offlineStarted).toBeLessThan(250);
    await new Promise((resolve) => setTimeout(resolve, 75));

    server = createReceiver();
    await new Promise<void>((resolve) => server.listen(Number(new URL(endpoint).port), '127.0.0.1', resolve));
    await waitFor(() => requests.some(({ mode: requestMode }) => requestMode === 'ok'), 2_000);
    mode = 'throttled';
    await session.runtime.run({ kind: 'operation', identity: 'collector.throttled' }, async () => {
      session.runtime.log('warn', 'collector.throttled', { token: 'throttled-private-canary' });
    });
    await waitFor(() => requests.some(({ mode: requestMode }) => requestMode === 'throttled'), 2_000);
    mode = 'malformed';
    await session.runtime.run({ kind: 'operation', identity: 'collector.malformed' }, async () => {
      session.runtime.log('warn', 'collector.malformed', { token: 'malformed-private-canary' });
    });
    await waitFor(() => requests.some(({ mode: requestMode }) => requestMode === 'malformed'), 2_000);
    mode = 'ok';
    await session.runtime.run({ kind: 'operation', identity: 'collector.recovered' }, async () => {
      session.runtime.log('info', 'collector.recovered', { token: 'recovered-private-canary' });
    });
    await new Promise((resolve) => setTimeout(resolve, 600));
    const shutdownStarted = performance.now();
    await session.shutdown();
    expect(performance.now() - shutdownStarted).toBeLessThan(2_000);
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

    expect(new Set(requests.map(({ path }) => path))).toEqual(new Set([
      '/tenant/demo/v1/traces',
      '/tenant/demo/v1/metrics',
      '/tenant/demo/v1/logs',
    ]));
    expect(requests.every(({ authorization }) => authorization === 'secret-header-canary')).toBe(true);
    expect(requests.some(({ mode: requestMode }) => requestMode === 'throttled')).toBe(true);
    expect(requests.some(({ mode: requestMode }) => requestMode === 'malformed')).toBe(true);
    expect(requests.some(({ mode: requestMode, path }) => requestMode === 'ok' && path === '/tenant/demo/v1/traces')).toBe(true);
    const exported = Buffer.concat(requests.map(({ body }) => body)).toString('utf8');
    expect(exported).not.toContain('secret-header-canary');
    expect(exported).not.toContain('secret-payload-canary');
    expect(exported).not.toContain('private-principal-canary');
    expect(exported).not.toContain('offline-private-canary');
    expect(exported).not.toContain('throttled-private-canary');
    expect(exported).not.toContain('malformed-private-canary');
    expect(exported).not.toContain('recovered-private-canary');
    expect(exported).toContain('[REDACTED]');
  });

  it('rejects unsupported signal sets and custom trust on plaintext before starting export', async () => {
    await expect(startApplicationOpenTelemetryRuntime({
      application: 'demo', environment: 'test', target: 'local', endpoint: 'http://127.0.0.1:4318',
      signals: [] as never,
    })).rejects.toThrow(/non-empty unique subset/u);
    await expect(startApplicationOpenTelemetryRuntime({
      application: 'demo', environment: 'test', target: 'local', endpoint: 'http://127.0.0.1:4318',
      certificateAuthority: 'test-ca',
    })).rejects.toThrow(/requires an HTTPS endpoint/u);
  });
});

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error(`Timed out after ${timeoutMs}ms waiting for OTLP receiver evidence.`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
