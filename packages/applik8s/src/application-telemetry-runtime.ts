export interface ApplicationTelemetryBoundary {
  readonly kind: 'actor' | 'schedule' | 'operation' | 'event' | 'workflow' | 'query' | 'http' | 'reconciler';
  readonly identity: string;
  readonly attempt?: number;
  readonly attributes?: Readonly<Record<string, string | number | boolean>>;
}

export interface ApplicationTelemetryRuntime {
  run<TResult>(boundary: ApplicationTelemetryBoundary, execute: () => Promise<TResult>): Promise<TResult>;
  log(severity: 'debug' | 'info' | 'warn' | 'error', event: string, fields?: Readonly<Record<string, unknown>>): void;
  count(metric: string, value?: number, attributes?: Readonly<Record<string, string | number | boolean>>): void;
}

const telemetryRuntimeResolvers: Array<() => ApplicationTelemetryRuntime | undefined> = [];

export function installApplicationTelemetryRuntimeResolver(resolver: () => ApplicationTelemetryRuntime | undefined): () => void {
  telemetryRuntimeResolvers.push(resolver);
  return () => { const index = telemetryRuntimeResolvers.lastIndexOf(resolver); if (index >= 0) telemetryRuntimeResolvers.splice(index, 1); };
}

export async function runApplicationTelemetryBoundary<TResult>(boundary: ApplicationTelemetryBoundary, execute: () => Promise<TResult>): Promise<TResult> {
  for (let index = telemetryRuntimeResolvers.length - 1; index >= 0; index -= 1) {
    const runtime = telemetryRuntimeResolvers[index]?.();
    if (runtime) return runtime.run(boundary, execute);
  }
  return execute();
}
