import type {
  ApplicationTelemetryBoundaryKind,
  ApplicationTelemetryEnvelopeV1,
  ApplicationTelemetryInvocationKind,
  ApplicationTelemetryMetricName,
  ApplicationTelemetryPrincipalClass,
} from '@applik8s/core';

export interface ApplicationTelemetryBoundary {
  readonly kind: ApplicationTelemetryBoundaryKind;
  readonly identity: string;
  readonly attempt?: number;
  readonly execution?: string;
  readonly service?: string;
  readonly provider?: string;
  readonly definition?: string;
  readonly instance?: string;
  readonly occurrence?: string;
  readonly actor?: string;
  readonly principalClass?: ApplicationTelemetryPrincipalClass;
  readonly causalPrincipalClass?: ApplicationTelemetryPrincipalClass;
  readonly invocation?: ApplicationTelemetryInvocationKind;
  readonly relationship?: 'asynchronous' | 'synchronous';
  readonly parent?: ApplicationTelemetryEnvelopeV1;
  readonly links?: readonly ApplicationTelemetryEnvelopeV1[];
  readonly baggage?: Readonly<Record<string, string>>;
  readonly attributes?: Readonly<Record<string, string | number | boolean>>;
}

export interface ApplicationTelemetryRuntime {
  run<TResult>(boundary: ApplicationTelemetryBoundary, execute: () => Promise<TResult>): Promise<TResult>;
  log(severity: 'debug' | 'info' | 'warn' | 'error', event: string, fields?: Readonly<Record<string, unknown>>): void;
  count(metric: ApplicationTelemetryMetricName, value?: number, attributes?: Readonly<Record<string, string | number | boolean>>): void;
  record(metric: ApplicationTelemetryMetricName, value: number, attributes?: Readonly<Record<string, string | number | boolean>>): void;
  capture(): ApplicationTelemetryEnvelopeV1 | undefined;
}

const telemetryRuntimeResolvers: Array<() => ApplicationTelemetryRuntime | undefined> = [];

function currentApplicationTelemetryRuntime(): ApplicationTelemetryRuntime | undefined {
  for (let index = telemetryRuntimeResolvers.length - 1; index >= 0; index -= 1) {
    const runtime = telemetryRuntimeResolvers[index]?.();
    if (runtime) return runtime;
  }
  return undefined;
}

export function installApplicationTelemetryRuntimeResolver(resolver: () => ApplicationTelemetryRuntime | undefined): () => void {
  telemetryRuntimeResolvers.push(resolver);
  return () => { const index = telemetryRuntimeResolvers.lastIndexOf(resolver); if (index >= 0) telemetryRuntimeResolvers.splice(index, 1); };
}

export async function runApplicationTelemetryBoundary<TResult>(boundary: ApplicationTelemetryBoundary, execute: () => Promise<TResult>): Promise<TResult> {
  const runtime = currentApplicationTelemetryRuntime();
  if (runtime) return runtime.run(boundary, execute);
  return execute();
}

/** Captures the bounded, serialization-safe carrier for an explicit asynchronous handoff. */
export function captureApplicationTelemetryContext(): ApplicationTelemetryEnvelopeV1 | undefined {
  return currentApplicationTelemetryRuntime()?.capture();
}

/** @internal Records bounded framework compatibility evidence without exposing provider telemetry to application code. */
export function countApplicationTelemetry(
  metric: ApplicationTelemetryMetricName,
  value = 1,
  attributes?: Readonly<Record<string, string | number | boolean>>,
): void {
  currentApplicationTelemetryRuntime()?.count(metric, value, attributes);
}

/** @internal Records a value through the versioned metric catalog. */
export function recordApplicationTelemetry(
  metric: ApplicationTelemetryMetricName,
  value: number,
  attributes?: Readonly<Record<string, string | number | boolean>>,
): void {
  currentApplicationTelemetryRuntime()?.record(metric, value, attributes);
}

/** @internal Records a redacted framework lifecycle event through the selected telemetry runtime. */
export function logApplicationTelemetry(
  severity: 'debug' | 'info' | 'warn' | 'error',
  event: string,
  fields?: Readonly<Record<string, unknown>>,
): void {
  currentApplicationTelemetryRuntime()?.log(severity, event, fields);
}
