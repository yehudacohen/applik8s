// typecast-file-boundary: Test spans use OpenTelemetry's erased recording implementation for boundary assertions.
import { context, trace } from '@opentelemetry/api';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { describe, expect, it } from 'vitest';
import { createApplicationOpenTelemetryRuntime } from '../src/index.js';

describe('OpenTelemetry runtime', () => {
  it('correlates managed boundaries, records failures without payloads, and redacts logs', async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
    const records: Record<string, unknown>[] = [];
    const runtime = createApplicationOpenTelemetryRuntime({ application: 'demo', environment: 'test', target: 'local', tracer: provider.getTracer('test'), log: (record) => records.push(record as Record<string, unknown>) });
    await runtime.run({ kind: 'actor', identity: 'workspace.rename' }, async () => { runtime.log('info', 'renamed', { token: 'do-not-leak', revision: 2 }); });
    await expect(runtime.run({ kind: 'schedule', identity: 'cleanup' }, async () => { throw new Error('private payload'); })).rejects.toThrow('private payload');
    const spans = exporter.getFinishedSpans();
    expect(spans.map(({ name }) => name)).toEqual(['applik8s.actor.workspace.rename', 'applik8s.schedule.cleanup']);
    expect(spans[1]?.attributes).toMatchObject({ 'error.type': 'Error' });
    expect(JSON.stringify(spans.map(({ attributes, events, status }) => ({ attributes, events, status })))).not.toContain('private payload');
    expect(records[0]?.fields).toEqual({ token: '[REDACTED]', revision: 2 });
    expect(context.active()).toBeDefined();
    await provider.shutdown();
  });
});
