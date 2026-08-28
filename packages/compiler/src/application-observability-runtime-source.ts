import type { ApplicationGraph } from "@applik8s/core";

export function applicationGraphHasObservabilityRuntime(
	graph: ApplicationGraph,
): boolean {
	return graph.nodes.some(
		(node) =>
			node.kind === "provider" &&
			node.interface === "Observability" &&
			!node.config?.qualification,
	);
}

export function generatedApplicationTelemetryImports(options?: {
	readonly boundaryRunner?: boolean;
	readonly carrierCapture?: boolean;
	readonly carrierTransport?: boolean;
	readonly providerOperationInstrumentation?: boolean;
	readonly runtimeIntegrityObserver?: boolean;
	readonly runtimeImplementation?: boolean;
}): readonly string[] {
	const applik8sImports = [
		"installApplicationTelemetryRuntimeResolver",
		...(options?.boundaryRunner ? ["runApplicationTelemetryBoundary"] : []),
		...(options?.carrierCapture ? ["captureApplicationTelemetryContext"] : []),
		...(options?.carrierTransport
			? ["applicationTelemetryCarrierHeaderName", "decodeApplicationTelemetryCarrier", "encodeApplicationTelemetryCarrier"]
			: []),
		...(options?.providerOperationInstrumentation
			? ["instrumentApplicationProviderOperation"]
			: []),
		...(options?.runtimeIntegrityObserver
			? ["observeApplicationRuntimeIntegrityEnvelope"]
			: []),
	];
	return [
		`import { ${applik8sImports.join(", ")} } from '@applik8s/applik8s/telemetry-runtime';`,
		...(options?.runtimeImplementation === false
			? []
			: ["import { createApplicationOpenTelemetryRuntime, startApplicationOpenTelemetryRuntime } from '@applik8s/runtime-otel';"]),
	];
}

export function generatedApplicationTelemetryRuntimeSource(options: {
	readonly application: string;
	readonly service: string;
}): string {
	return `const applicationTelemetryOptions = {
  application: process.env.APPLIK8S_APPLICATION_NAME ?? ${JSON.stringify(options.application)},
  environment: process.env.APPLIK8S_ENVIRONMENT_ID ?? 'default',
  target: process.env.APPLIK8S_DEPLOYMENT_TARGET ?? 'unknown',
  service: process.env.APPLIK8S_SERVICE_NAME ?? ${JSON.stringify(options.service)},
};
const applicationTelemetryEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const applicationTelemetrySignals = process.env.APPLIK8S_OTLP_SIGNALS
  ?.split(',')
  .map(value => value.trim())
  .filter(Boolean);
const applicationTelemetryHeaderName = process.env.APPLIK8S_OTLP_HEADER_NAME;
const applicationTelemetryHeaderValue = process.env.APPLIK8S_OTLP_HEADER_VALUE;
const applicationTelemetrySession = applicationTelemetryEndpoint
  ? await startApplicationOpenTelemetryRuntime({
      ...applicationTelemetryOptions,
      endpoint: applicationTelemetryEndpoint,
      ...(applicationTelemetrySignals ? { signals: applicationTelemetrySignals } : {}),
      ...(applicationTelemetryHeaderName && applicationTelemetryHeaderValue
        ? { headers: { [applicationTelemetryHeaderName]: applicationTelemetryHeaderValue } }
        : {}),
      ...(process.env.APPLIK8S_OTLP_CA_PEM ? { certificateAuthority: process.env.APPLIK8S_OTLP_CA_PEM } : {}),
      ...(process.env.APPLIK8S_OTLP_SERVER_NAME ? { serverName: process.env.APPLIK8S_OTLP_SERVER_NAME } : {}),
    })
  : undefined;
const applicationTelemetryRuntime = applicationTelemetrySession?.runtime
  ?? createApplicationOpenTelemetryRuntime(applicationTelemetryOptions);
const disposeApplicationTelemetryRuntime = installApplicationTelemetryRuntimeResolver(() => applicationTelemetryRuntime);
let applicationTelemetryRuntimeClosed = false;
async function closeApplicationTelemetryRuntime() {
  if (applicationTelemetryRuntimeClosed) return;
  applicationTelemetryRuntimeClosed = true;
  disposeApplicationTelemetryRuntime();
  await applicationTelemetrySession?.shutdown();
}`;
}
