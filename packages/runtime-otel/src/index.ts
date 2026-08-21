import { metrics, SpanStatusCode, trace, type Attributes, type Meter, type Tracer } from '@opentelemetry/api';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import type { ApplicationTelemetryBoundary, ApplicationTelemetryRuntime } from '@applik8s/applik8s';

export interface ApplicationOpenTelemetryRuntimeOptions {
  readonly application: string;
  readonly environment: string;
  readonly target: string;
  readonly tracer?: Tracer;
  readonly meter?: Meter;
  readonly log?: (record: Readonly<Record<string, unknown>>) => void;
  readonly maximumMetricSeries?: number;
}

export interface ApplicationOpenTelemetrySession {
  readonly runtime: ApplicationTelemetryRuntime;
  shutdown(): Promise<void>;
}

export function createApplicationOpenTelemetryRuntime(options: ApplicationOpenTelemetryRuntimeOptions): ApplicationTelemetryRuntime {
  const tracer = options.tracer ?? trace.getTracer('applik8s', '0.8.0');
  const meter = options.meter ?? metrics.getMeter('applik8s', '0.8.0');
  const log = options.log ?? ((record) => process.stdout.write(`${JSON.stringify(record)}\n`));
  const counters = new Map<string, ReturnType<Meter['createCounter']>>();
  const series = new Set<string>();
  const maximumMetricSeries = options.maximumMetricSeries ?? 1_000;
  const base = { 'service.name': options.application, 'deployment.environment.name': options.environment, 'applik8s.target': options.target };
  return {
    run(boundary, execute) {
      return tracer.startActiveSpan(`applik8s.${boundary.kind}.${boundary.identity}`, { attributes: boundedAttributes({ ...base, 'applik8s.boundary.kind': boundary.kind, 'applik8s.boundary.identity': boundary.identity, ...(boundary.attempt ? { 'applik8s.attempt': boundary.attempt } : {}), ...boundary.attributes }) }, async (span) => {
        const started = performance.now();
        try {
          const result = await execute();
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (cause) {
          span.setStatus({ code: SpanStatusCode.ERROR });
          span.setAttribute('error.type', cause instanceof Error ? cause.name : 'unknown');
          throw cause;
        } finally {
          span.setAttribute('applik8s.duration_ms', Math.max(0, performance.now() - started));
          span.end();
        }
      });
    },
    log(severity, event, fields = {}) {
      const span = trace.getActiveSpan()?.spanContext();
      log(Object.freeze({ timestamp: new Date().toISOString(), severity, event, ...base, ...(span?.traceId ? { traceId: span.traceId, spanId: span.spanId } : {}), fields: redact(fields) }));
    },
    count(metric, value = 1, attributes = {}) {
      if (!/^applik8s\.[a-z0-9_.]+$/u.test(metric)) throw new Error(`OpenTelemetry metric ${metric} is not a stable Applik8s metric identity.`);
      const bounded = boundedAttributes({ ...base, ...attributes });
      const identity = `${metric}:${JSON.stringify(Object.entries(bounded).sort())}`;
      if (!series.has(identity) && series.size >= maximumMetricSeries) return;
      series.add(identity);
      let counter = counters.get(metric);
      if (!counter) { counter = meter.createCounter(metric); counters.set(metric, counter); }
      counter.add(value, bounded);
    },
  };
}

export async function startApplicationOpenTelemetryRuntime(options: ApplicationOpenTelemetryRuntimeOptions & { readonly endpoint: string; readonly metricIntervalMs?: number }): Promise<ApplicationOpenTelemetrySession> {
  const endpoint = new URL(options.endpoint);
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('OpenTelemetry endpoint must use HTTP or HTTPS.');
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({ 'service.name': options.application, 'deployment.environment.name': options.environment, 'applik8s.target': options.target }),
    traceExporter: new OTLPTraceExporter({ url: new URL('/v1/traces', endpoint).href }),
    metricReader: new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter({ url: new URL('/v1/metrics', endpoint).href }), exportIntervalMillis: options.metricIntervalMs ?? 30_000 }),
  });
  sdk.start();
  return { runtime: createApplicationOpenTelemetryRuntime(options), shutdown: () => sdk.shutdown() };
}

function boundedAttributes(values: Readonly<Record<string, string | number | boolean>>): Attributes {
  const entries = Object.entries(values).filter(([key]) => !/(?:user|principal|object|prompt|payload|url|key|token|secret|password)(?:\.|_|$)/iu.test(key)).slice(0, 24);
  return Object.fromEntries(entries.map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 256) : value]));
}

function redact(value: unknown, key = ''): unknown {
  if (/(?:authorization|cookie|token|secret|password|prompt|payload)/iu.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redact(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 100).map(([name, item]) => [name, redact(item, name)]));
  return typeof value === 'string' ? value.slice(0, 2_048) : value;
}
