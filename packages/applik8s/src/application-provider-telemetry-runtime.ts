// typecast-file-boundary: Compiler-hydrated provider operations preserve their callable signatures across instrumentation.
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  currentApplicationTelemetryRuntime,
  type ApplicationTelemetryBoundary,
} from './application-telemetry-runtime.js';

export interface ApplicationProviderTelemetryOperation {
  readonly interface: string;
  readonly nodeId: string;
  readonly member: string;
}

const applicationProviderOperationScope =
  new AsyncLocalStorage<ApplicationProviderTelemetryOperation>();

/** @internal Returns the compiler-hydrated provider operation active in this Node execution scope. */
export function currentApplicationProviderOperation():
  ApplicationProviderTelemetryOperation | undefined {
  return applicationProviderOperationScope.getStore();
}

/** @internal Records one provider call without exposing arguments, results, or credentials. */
export function runApplicationProviderTelemetryBoundary<TResult>(
  operation: ApplicationProviderTelemetryOperation,
  execute: () => TResult,
): TResult {
  return applicationProviderOperationScope.run(operation, () => {
    const runtime = currentApplicationTelemetryRuntime();
    if (!runtime?.runValue) return execute();
    return runtime.runValue(providerTelemetryBoundary(operation), execute);
  });
}

/** @internal Wraps a provider export while preserving its exact call signature. */
export function instrumentApplicationProviderOperation<
  TOperation extends CallableFunction,
>(
  operation: ApplicationProviderTelemetryOperation,
  callable: TOperation,
): TOperation {
  const instrumented = function applicationProviderOperation(
    this: unknown,
    ...args: unknown[]
  ): unknown {
    return runApplicationProviderTelemetryBoundary(
      operation,
      () => Reflect.apply(callable, this, args),
    );
  };
  Object.defineProperty(instrumented, 'name', {
    configurable: true,
    value: callable.name,
  });
  return instrumented as unknown as TOperation;
}

function providerTelemetryBoundary(
  operation: ApplicationProviderTelemetryOperation,
): ApplicationTelemetryBoundary {
  return {
    kind: 'provider',
    identity: `${operation.interface}.${operation.member}`,
    provider: operation.nodeId,
    definition: operation.member,
    relationship: 'synchronous',
  };
}
