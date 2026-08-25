import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  ApplicationTelemetryBoundary,
  ApplicationTelemetryRuntime,
} from '@applik8s/applik8s';
import {
  type ApplicationTelemetryEnvelopeV1,
  type ApplicationTelemetryMetricName,
  applicationTelemetryMetricDefinition,
  createApplicationTelemetryEnvelopeV1,
  defaultDeniedTelemetryFields,
  redactApplicationTelemetryValue,
  validateApplicationTelemetryEnvelopeV1,
  validateApplicationTelemetryMetricAttributes,
} from '@applik8s/core';
import {
  type Attributes,
  type Counter,
  context,
  createTraceState,
  type Gauge,
  type Histogram,
  type Link,
  type Meter,
  metrics,
  type Span,
  type SpanContext,
  SpanStatusCode,
  TraceFlags,
  type Tracer,
  trace,
} from '@opentelemetry/api';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';

export interface ApplicationOpenTelemetryRuntimeOptions {
  readonly application: string;
  readonly environment: string;
  readonly target: string;
  readonly service?: string;
  readonly provider?: string;
  readonly tracer?: Tracer;
  readonly meter?: Meter;
  readonly log?: (record: Readonly<Record<string, unknown>>) => void;
  readonly maximumMetricSeries?: number;
  readonly maximumSpanLinks?: number;
  readonly allowedBaggageKeys?: readonly string[];
  readonly maximumBaggageBytes?: number;
  readonly deniedLogFields?: readonly string[];
  readonly now?: () => Date;
  readonly monotonicNow?: () => number;
}

export interface ApplicationOpenTelemetryStartOptions extends ApplicationOpenTelemetryRuntimeOptions {
  readonly endpoint: string;
  readonly traceEndpoint?: string;
  readonly metricEndpoint?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly metricIntervalMs?: number;
  readonly samplingRatio?: number;
}

export interface ApplicationOpenTelemetrySession {
  readonly runtime: ApplicationTelemetryRuntime;
  shutdown(): Promise<void>;
}

interface ActiveTelemetryBoundary {
  readonly envelope: ApplicationTelemetryEnvelopeV1;
  readonly span: Span;
}

type RuntimeMetricInstrument =
  | { readonly kind: 'counter'; readonly instrument: Counter }
  | { readonly kind: 'gauge'; readonly instrument: Gauge }
  | { readonly kind: 'histogram'; readonly instrument: Histogram };

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return value !== null
    && (typeof value === 'object' || typeof value === 'function')
    && typeof Reflect.get(value, 'then') === 'function';
}

const activeBoundary = new AsyncLocalStorage<ActiveTelemetryBoundary>();

export function createApplicationOpenTelemetryRuntime(
  options: ApplicationOpenTelemetryRuntimeOptions,
): ApplicationTelemetryRuntime {
  const tracer = options.tracer ?? trace.getTracer('applik8s', '0.8.0');
  const meter = options.meter ?? metrics.getMeter('applik8s', '0.8.0');
  const logSink = options.log ?? ((record) => process.stdout.write(`${JSON.stringify(record)}\n`));
  const instruments = new Map<ApplicationTelemetryMetricName, RuntimeMetricInstrument>();
  const metricSeries = new Set<string>();
  const maximumMetricSeries = positiveInteger(options.maximumMetricSeries, 1_000);
  const maximumSpanLinks = positiveInteger(options.maximumSpanLinks, 32);
  const maximumBaggageBytes = boundedBaggageBytes(options.maximumBaggageBytes);
  const allowedBaggageKeys = new Set(validateAllowedBaggageKeys(options.allowedBaggageKeys));
  const now = options.now ?? (() => new Date());
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const resourceAttributes = Object.freeze({
    'service.name': options.service ?? options.application,
    'deployment.environment.name': options.environment,
    'applik8s.application': options.application,
    'applik8s.target': options.target,
    ...(options.provider ? { 'applik8s.provider': options.provider } : {}),
  });

  const internalRecord = (
    metric: ApplicationTelemetryMetricName,
    value: number,
    attributes: Readonly<Record<string, string | number | boolean>>,
    cardinalityPolicy: 'bounded' | 'internal',
  ): void => {
    const definition = applicationTelemetryMetricDefinition(metric);
    validateMetricValue(definition.kind, metric, value);
    validateApplicationTelemetryMetricAttributes(definition, attributes);
    const identity = `${metric}:${stableAttributeIdentity(attributes)}`;
    if (cardinalityPolicy === 'bounded' && !metricSeries.has(identity)) {
      if (metricSeries.size >= maximumMetricSeries) {
        internalRecord('applik8s.telemetry.drop', 1, {
          'applik8s.signal': 'metric',
          'applik8s.drop.reason': 'cardinality',
        }, 'internal');
        return;
      }
      metricSeries.add(identity);
    }
    let instrument = instruments.get(metric);
    if (!instrument) {
      const metricOptions = {
        description: definition.description,
        unit: definition.unit,
        ...(definition.boundaries
          ? { advice: { explicitBucketBoundaries: [...definition.boundaries] } }
          : {}),
      };
      if (definition.kind === 'counter') {
        instrument = { kind: 'counter', instrument: meter.createCounter(metric, metricOptions) };
      } else if (definition.kind === 'histogram') {
        instrument = { kind: 'histogram', instrument: meter.createHistogram(metric, metricOptions) };
      } else {
        instrument = { kind: 'gauge', instrument: meter.createGauge(metric, metricOptions) };
      }
      instruments.set(metric, instrument);
    }
    try {
      if (instrument.kind === 'counter') instrument.instrument.add(value, attributes);
      else instrument.instrument.record(value, attributes);
    } catch (cause) {
      if (metric !== 'applik8s.telemetry.export.failure') {
        try {
          internalRecord('applik8s.telemetry.export.failure', 1, {
            'applik8s.signal': 'metric',
            'applik8s.provider': options.provider ?? 'otel',
            'error.type': errorType(cause),
          }, 'internal');
        } catch {
          // Telemetry failure must never become a business-operation failure.
        }
      }
    }
  };

  const runBoundary = <TResult>(
    boundary: ApplicationTelemetryBoundary,
    execute: () => TResult,
  ): TResult => {
      const candidateParent = boundary.parent ?? activeBoundary.getStore()?.envelope;
      const inherited = candidateParent && validEnvelope(candidateParent)
        ? candidateParent
        : undefined;
      const relationship = boundary.relationship ?? 'synchronous';
      const linkEnvelopes = deduplicateEnvelopes([
        ...(relationship === 'asynchronous' && inherited ? [inherited] : []),
        ...(boundary.links ?? []),
      ].filter(validEnvelope));
      const rejectedCarrierCount = (candidateParent && !inherited ? 1 : 0)
        + (boundary.links?.length ?? 0)
        - (boundary.links ?? []).filter(validEnvelope).length;
      const baggage = boundedBaggage(
        inherited?.baggage ?? {},
        boundary.baggage ?? {},
        allowedBaggageKeys,
        maximumBaggageBytes,
      );
      const selectedLinks = linkEnvelopes.slice(0, maximumSpanLinks);
      const droppedLinks = Math.max(0, linkEnvelopes.length - selectedLinks.length);
      const parentContext = relationship === 'synchronous' && inherited
        ? trace.setSpanContext(context.active(), spanContextFromEnvelope(inherited))
        : context.active();
      let span: Span;
      try {
        span = tracer.startSpan(
          `applik8s.${boundary.kind}.${boundary.identity}`,
          {
            root: relationship === 'asynchronous' || !inherited,
            attributes: boundedSpanAttributes({
              ...resourceAttributes,
              'applik8s.boundary.kind': boundary.kind,
              'applik8s.operation': boundary.identity,
              'applik8s.execution': boundary.execution ?? `${boundary.kind}:${boundary.identity}`,
              'applik8s.attempt': boundary.attempt ?? 1,
              'applik8s.invocation.kind': boundary.invocation ?? 'live',
              'applik8s.invocation.relationship': relationship,
              ...(boundary.service ? { 'applik8s.service': boundary.service } : {}),
              ...(boundary.provider ? { 'applik8s.provider': boundary.provider } : {}),
              ...(droppedLinks > 0 ? { 'applik8s.links.dropped': droppedLinks } : {}),
              ...boundary.attributes,
            }),
            links: selectedLinks.map((envelope): Link => ({
              context: spanContextFromEnvelope(envelope),
              attributes: {
                'applik8s.operation': envelope.identity.operation,
                'applik8s.execution': envelope.identity.execution,
                'applik8s.attempt': envelope.identity.attempt,
              },
            })),
          },
          parentContext,
        );
      } catch {
        return execute();
      }

      const spanContext = span.spanContext();
      let envelope: ApplicationTelemetryEnvelopeV1;
      try {
        envelope = createApplicationTelemetryEnvelopeV1({
          traceparent: traceparentFromSpanContext(spanContext),
          ...(spanContext.traceState ? { tracestate: spanContext.traceState.serialize() } : {}),
          baggage: baggage.values,
          identity: {
            application: options.application,
            environment: options.environment,
            target: options.target,
            operation: boundary.identity,
            execution: boundary.execution ?? `${boundary.kind}:${boundary.identity}`,
            attempt: boundary.attempt ?? 1,
            ...(boundary.service ?? options.service
              ? { service: boundary.service ?? options.service ?? options.application }
              : {}),
            ...(boundary.provider ?? options.provider
              ? { provider: boundary.provider ?? options.provider ?? 'otel' }
              : {}),
            ...(boundary.definition ? { definition: boundary.definition } : {}),
            ...(boundary.instance ? { instance: boundary.instance } : {}),
            ...(boundary.occurrence ? { occurrence: boundary.occurrence } : {}),
            ...(boundary.actor ? { actor: boundary.actor } : {}),
            ...(boundary.principalClass ? { principalClass: boundary.principalClass } : {}),
            ...(boundary.causalPrincipalClass
              ? { causalPrincipalClass: boundary.causalPrincipalClass }
              : {}),
          },
          invocation: {
            kind: boundary.invocation ?? 'live',
            relationship,
            replaySuppressed: boundary.invocation === 'replay',
          },
          sampled: (spanContext.traceFlags & TraceFlags.SAMPLED) === TraceFlags.SAMPLED,
        });
      } catch {
        span.end();
        return execute();
      }

      const started = monotonicNow();
      let finished = false;
      const finish = (result: 'error' | 'ok', cause?: unknown): void => {
        if (finished) return;
        finished = true;
        const caughtErrorType = result === 'error' ? errorType(cause) : undefined;
        try {
          span.setStatus({
            code: result === 'ok' ? SpanStatusCode.OK : SpanStatusCode.ERROR,
          });
          if (caughtErrorType) span.setAttribute('error.type', caughtErrorType);
        } catch {
          // Telemetry span failures cannot replace the business result.
        }
        const attributes = {
          'applik8s.boundary.kind': boundary.kind,
          'applik8s.operation': boundary.identity,
          'applik8s.result': result,
          'applik8s.invocation.kind': boundary.invocation ?? 'live',
          ...((boundary.provider ?? options.provider)
            ? { 'applik8s.provider': boundary.provider ?? options.provider ?? 'otel' }
            : {}),
          ...(caughtErrorType ? { 'error.type': caughtErrorType } : {}),
        } as const;
        try {
          internalRecord('applik8s.operation.count', 1, attributes, 'bounded');
          internalRecord(
            'applik8s.operation.duration',
            Math.max(0, monotonicNow() - started) / 1_000,
            attributes,
            'bounded',
          );
          if (boundary.invocation === 'retry') {
            internalRecord('applik8s.retry.count', 1, {
              'applik8s.boundary.kind': boundary.kind,
              'applik8s.operation': boundary.identity,
              'applik8s.result': result,
            }, 'bounded');
          }
          if (droppedLinks > 0) {
            internalRecord('applik8s.telemetry.drop', droppedLinks, {
              'applik8s.signal': 'trace-link',
              'applik8s.drop.reason': 'link-limit',
            }, 'internal');
          }
          if (rejectedCarrierCount > 0) {
            internalRecord('applik8s.telemetry.drop', rejectedCarrierCount, {
              'applik8s.signal': 'trace-carrier',
              'applik8s.drop.reason': 'invalid-carrier',
            }, 'internal');
          }
          if (baggage.dropped > 0) {
            internalRecord('applik8s.telemetry.drop', baggage.dropped, {
              'applik8s.signal': 'baggage',
              'applik8s.drop.reason': 'policy',
            }, 'internal');
          }
        } catch {
          // Metric contract or exporter failures cannot change the operation result.
        }
        try {
          span.end();
        } catch {
          // Telemetry span failures cannot replace the business result.
        }
      };
      try {
        const result = activeBoundary.run({ envelope, span }, execute);
        if (isPromiseLike(result)) {
          // typecast: Promise settlement preserves the caller's original generic
          // return type while keeping the span open through asynchronous work.
          return Promise.resolve(result).then(
            (value) => {
              finish('ok');
              return value;
            },
            (cause) => {
              finish('error', cause);
              throw cause;
            },
          ) as TResult;
        }
        finish('ok');
        return result;
      } catch (cause) {
        finish('error', cause);
        throw cause;
      }
  };

  const runtime: ApplicationTelemetryRuntime = {
    run<TResult>(
      boundary: ApplicationTelemetryBoundary,
      execute: () => Promise<TResult>,
    ): Promise<TResult> {
      return runBoundary(boundary, execute);
    },

    runValue<TResult>(
      boundary: ApplicationTelemetryBoundary,
      execute: () => TResult,
    ): TResult {
      return runBoundary(boundary, execute);
    },

    log(severity, event, fields = {}) {
      const active = activeBoundary.getStore();
      const spanContext = active?.span.spanContext();
      const record = Object.freeze({
        version: 'applik8s.log/v1alpha1',
        timestamp: now().toISOString(),
        severity,
        event: event.slice(0, 256),
        source: 'framework',
        ...resourceAttributes,
        ...(active ? {
          'applik8s.operation': active.envelope.identity.operation,
          'applik8s.execution': active.envelope.identity.execution,
          'applik8s.attempt': active.envelope.identity.attempt,
        } : {}),
        ...(spanContext?.traceId ? {
          traceId: spanContext.traceId,
          spanId: spanContext.spanId,
        } : {}),
        fields: redactApplicationTelemetryValue(fields, options.deniedLogFields),
      });
      try {
        logSink(record);
      } catch (cause) {
        try {
          internalRecord('applik8s.telemetry.export.failure', 1, {
            'applik8s.signal': 'log',
            'applik8s.provider': options.provider ?? 'otel',
            'error.type': errorType(cause),
          }, 'internal');
        } catch {
          // The fallback is deliberately silent and bounded.
        }
      }
    },

    count(metric, value = 1, attributes = {}) {
      const definition = applicationTelemetryMetricDefinition(metric);
      if (definition.kind !== 'counter') {
        throw new Error(`Telemetry metric ${metric} is ${definition.kind}; use record() rather than count().`);
      }
      internalRecord(metric, value, attributes, 'bounded');
    },

    record(metric, value, attributes = {}) {
      internalRecord(metric, value, attributes, 'bounded');
    },

    capture() {
      return activeBoundary.getStore()?.envelope;
    },
  };

  return Object.freeze(runtime);
}

export async function startApplicationOpenTelemetryRuntime(
  options: ApplicationOpenTelemetryStartOptions,
): Promise<ApplicationOpenTelemetrySession> {
  const samplingRatio = options.samplingRatio ?? 1;
  if (!Number.isFinite(samplingRatio) || samplingRatio < 0 || samplingRatio > 1) {
    throw new Error('OpenTelemetry samplingRatio must be between 0 and 1.');
  }
  const headers = Object.freeze({ ...(options.headers ?? {}) });
  const traceEndpoint = signalEndpoint(options.traceEndpoint ?? options.endpoint, 'traces');
  const metricEndpoint = signalEndpoint(options.metricEndpoint ?? options.endpoint, 'metrics');
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      'service.name': options.service ?? options.application,
      'deployment.environment.name': options.environment,
      'applik8s.application': options.application,
      'applik8s.target': options.target,
      ...(options.provider ? { 'applik8s.provider': options.provider } : {}),
    }),
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(samplingRatio) }),
    traceExporter: new OTLPTraceExporter({ url: traceEndpoint, headers }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: metricEndpoint, headers }),
      exportIntervalMillis: options.metricIntervalMs ?? 30_000,
    }),
  });
  sdk.start();
  return Object.freeze({
    runtime: createApplicationOpenTelemetryRuntime(options),
    shutdown: () => sdk.shutdown(),
  });
}

export function applicationOtlpSignalEndpoint(
  endpoint: string,
  signal: 'metrics' | 'traces',
): string {
  return signalEndpoint(endpoint, signal);
}

function signalEndpoint(endpoint: string, signal: 'metrics' | 'traces'): string {
  const parsed = new URL(endpoint);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('OpenTelemetry endpoint must use HTTP or HTTPS.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('OpenTelemetry endpoint credentials must use a Secret-backed header rather than URL userinfo.');
  }
  const suffix = `/v1/${signal}`;
  if (!parsed.pathname.endsWith(suffix)) {
    parsed.pathname = `${parsed.pathname.replace(/\/$/u, '')}${suffix}`;
  }
  return parsed.href;
}

function spanContextFromEnvelope(envelope: ApplicationTelemetryEnvelopeV1): SpanContext {
  validateApplicationTelemetryEnvelopeV1(envelope);
  const [, traceId = '', spanId = '', flags = '00'] = envelope.traceparent.split('-');
  return {
    traceId,
    spanId,
    traceFlags: flags === '01' ? TraceFlags.SAMPLED : TraceFlags.NONE,
    ...(envelope.tracestate ? { traceState: createTraceState(envelope.tracestate) } : {}),
    isRemote: true,
  };
}

function traceparentFromSpanContext(spanContext: SpanContext): string {
  const flags = (spanContext.traceFlags & TraceFlags.SAMPLED) === TraceFlags.SAMPLED ? '01' : '00';
  return `00-${spanContext.traceId}-${spanContext.spanId}-${flags}`;
}

function deduplicateEnvelopes(
  envelopes: readonly ApplicationTelemetryEnvelopeV1[],
): ApplicationTelemetryEnvelopeV1[] {
  const seen = new Set<string>();
  return envelopes.filter((envelope) => {
    const identity = `${envelope.traceparent}:${envelope.identity.execution}:${envelope.identity.attempt}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function validEnvelope(value: unknown): value is ApplicationTelemetryEnvelopeV1 {
  try {
    validateApplicationTelemetryEnvelopeV1(value);
    return true;
  } catch {
    return false;
  }
}

function boundedBaggage(
  inherited: Readonly<Record<string, string>>,
  requested: Readonly<Record<string, string>>,
  allowedKeys: ReadonlySet<string>,
  maximumBytes: number,
): { readonly values: Readonly<Record<string, string>>; readonly dropped: number } {
  let bytes = 0;
  let dropped = 0;
  const accepted: Array<[string, string]> = [];
  for (const [key, value] of Object.entries({ ...inherited, ...requested })
    .sort(([left], [right]) => left.localeCompare(right))) {
    const entryBytes = new TextEncoder().encode(`${key}=${value}`).byteLength;
    if (!allowedKeys.has(key) || bytes + entryBytes > maximumBytes) {
      dropped += 1;
      continue;
    }
    accepted.push([key, value]);
    bytes += entryBytes;
  }
  return Object.freeze({
    values: Object.freeze(Object.fromEntries(accepted)),
    dropped,
  });
}

function boundedSpanAttributes(
  values: Readonly<Record<string, string | number | boolean | undefined>>,
): Attributes {
  const entries = Object.entries(values)
    .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
    .filter(([key]) => !sensitiveTelemetryKey(key))
    .slice(0, 32);
  return Object.fromEntries(entries.map(([key, value]) => [
    key,
    typeof value === 'string' ? value.slice(0, 256) : value,
  ]));
}

function sensitiveTelemetryKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/giu, '').toLowerCase();
  return defaultDeniedTelemetryFields.some((denied) =>
    normalized.includes(denied.replace(/[^a-z0-9]/giu, '').toLowerCase()));
}

function stableAttributeIdentity(
  attributes: Readonly<Record<string, string | number | boolean>>,
): string {
  return JSON.stringify(Object.entries(attributes).sort(([left], [right]) => left.localeCompare(right)));
}

function validateMetricValue(
  kind: 'counter' | 'gauge' | 'histogram',
  metric: ApplicationTelemetryMetricName,
  value: number,
): void {
  if (!Number.isFinite(value) || (kind !== 'gauge' && value < 0)) {
    throw new Error(`Telemetry metric ${metric} requires a finite${kind === 'gauge' ? '' : ' non-negative'} value.`);
  }
}

function errorType(cause: unknown): string {
  const value = cause instanceof Error ? cause.name : typeof cause;
  return /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/u.test(value) ? value : 'UnknownError';
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('OpenTelemetry runtime bounds must be positive integers.');
  }
  return value;
}

function boundedBaggageBytes(value: number | undefined): number {
  if (value === undefined) return 8_192;
  if (!Number.isSafeInteger(value) || value < 0 || value > 8_192) {
    throw new Error('OpenTelemetry maximumBaggageBytes must be an integer between 0 and 8192.');
  }
  return value;
}

function validateAllowedBaggageKeys(keys: readonly string[] | undefined): readonly string[] {
  const unique = new Set<string>();
  for (const key of keys ?? []) {
    if (!/^[a-z][a-z0-9_.-]{0,62}$/u.test(key) || sensitiveTelemetryKey(key)) {
      throw new Error(`OpenTelemetry baggage key ${JSON.stringify(key)} is not a safe stable attribute.`);
    }
    unique.add(key);
  }
  return [...unique].sort();
}
