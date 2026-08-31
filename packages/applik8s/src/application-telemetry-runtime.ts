// typecast-file-boundary: Runtime telemetry context is validated by the canonical carrier owner before this adapter restores execution-specific generics.
import type {
  ApplicationTelemetryBoundaryKind,
  ApplicationTelemetryEnvelopeV1,
  ApplicationTelemetryInvocationKind,
  ApplicationTelemetryMetricName,
  ApplicationTelemetryPrincipalClass,
} from '@applik8s/core';
import { validateApplicationTelemetryEnvelopeV1 } from '@applik8s/core';
import type { SignedEnvelopeCodecObserver } from '@applik8s/runtime/signed-envelope';

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
  /**
   * Executes a boundary without changing whether the business callable returns
   * a value or a Promise. Maintained v0.8 runtimes implement this path; the
   * optional shape keeps pre-v0.8 custom telemetry runtimes source-compatible.
   */
  runValue?<TResult>(boundary: ApplicationTelemetryBoundary, execute: () => TResult): TResult;
  log(severity: 'debug' | 'info' | 'warn' | 'error', event: string, fields?: Readonly<Record<string, unknown>>): void;
  count(metric: ApplicationTelemetryMetricName, value?: number, attributes?: Readonly<Record<string, string | number | boolean>>): void;
  record(metric: ApplicationTelemetryMetricName, value: number, attributes?: Readonly<Record<string, string | number | boolean>>): void;
  capture(): ApplicationTelemetryEnvelopeV1 | undefined;
}

const telemetryRuntimeResolvers: Array<() => ApplicationTelemetryRuntime | undefined> = [];

export const applicationTelemetryCarrierHeaderName = 'x-applik8s-telemetry';
export const maximumApplicationTelemetryCarrierBytes = 8_192;

/** @internal Handler-safe runtime lookup used by focused runtime adapters. */
export function currentApplicationTelemetryRuntime(): ApplicationTelemetryRuntime | undefined {
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

/**
 * Serializes the framework-owned carrier used only between generated runtime
 * boundaries. Application ingress must overwrite this header rather than trust
 * a caller-authored value.
 */
export function encodeApplicationTelemetryCarrier(
  carrier: ApplicationTelemetryEnvelopeV1,
): string | undefined {
  try {
    validateApplicationTelemetryEnvelopeV1(carrier);
    const encoded = JSON.stringify(carrier);
    if (new TextEncoder().encode(encoded).byteLength > maximumApplicationTelemetryCarrierBytes) {
      return undefined;
    }
    return encoded;
  } catch {
    return undefined;
  }
}

/** Decodes a bounded internal carrier. Malformed telemetry is ignored and can never fail business execution. */
export function decodeApplicationTelemetryCarrier(
  encoded: string | null | undefined,
): ApplicationTelemetryEnvelopeV1 | undefined {
  if (!encoded) return undefined;
  try {
    if (new TextEncoder().encode(encoded).byteLength > maximumApplicationTelemetryCarrierBytes) {
      return undefined;
    }
    const carrier: unknown = JSON.parse(encoded);
    validateApplicationTelemetryEnvelopeV1(carrier);
    return carrier;
  } catch {
    return undefined;
  }
}

/** @internal Records bounded framework compatibility evidence without exposing provider telemetry to application code. */
export function countApplicationTelemetry(
  metric: ApplicationTelemetryMetricName,
  value = 1,
  attributes?: Readonly<Record<string, string | number | boolean>>,
): void {
  currentApplicationTelemetryRuntime()?.count(metric, value, attributes);
}

/**
 * Shared payload-free observer for every maintained signed-envelope owner.
 * The codec already isolates observer failures, while this adapter keeps the
 * application telemetry vocabulary out of the integrity package.
 *
 * @internal Framework/runtime seam.
 */
export const observeApplicationRuntimeIntegrityEnvelope: SignedEnvelopeCodecObserver = (
  observation,
) => {
  countApplicationTelemetry('applik8s.runtime.integrity.envelope', 1, {
    'applik8s.runtime.integrity.purpose': observation.purpose,
    'applik8s.runtime.integrity.format': observation.format,
    'applik8s.runtime.integrity.operation': observation.operation,
    'applik8s.runtime.integrity.result': observation.result,
    ...(observation.errorCode === undefined
      ? {}
      : { 'error.type': observation.errorCode }),
  });
};

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
// typecast-file-boundary: Runtime telemetry context is validated by the canonical carrier owner before this adapter restores execution-specific generics.
