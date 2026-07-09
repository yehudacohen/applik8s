import type { ApplicationObservabilityContract } from '@applik8s/core';

export interface GeneratedServerRuntimeBundleContract {
  readonly apiVersion: 'applik8s.runtime/v1alpha1';
  readonly kind: 'GeneratedServerRuntimeBundle';
  readonly entrypoint: string;
  readonly packageManagerAtStartup: false;
  readonly bundledDependencies: readonly string[];
  readonly observability: ApplicationObservabilityContract;
  readonly releasePolicy: {
    readonly dependencyInstallation: 'buildTimeOnly';
    readonly runtimeImage: 'explicitImageOrGeneratedRecipe';
    readonly supplyChain: 'metadataOnlyUntilSignedArtifacts';
    readonly failurePolicy: 'failClosed';
  };
}

export function generatedServerRuntimeBundleContract(entrypoint: string): GeneratedServerRuntimeBundleContract {
  return {
    apiVersion: 'applik8s.runtime/v1alpha1',
    kind: 'GeneratedServerRuntimeBundle',
    entrypoint,
    packageManagerAtStartup: false,
    bundledDependencies: ['hono', 'drizzle-orm', 'postgres'],
    observability: generatedServerRuntimeObservability(),
    releasePolicy: {
      dependencyInstallation: 'buildTimeOnly',
      runtimeImage: 'explicitImageOrGeneratedRecipe',
      supplyChain: 'metadataOnlyUntilSignedArtifacts',
      failurePolicy: 'failClosed',
    },
  };
}

export function validateGeneratedServerRuntimeBundleContract(contract: GeneratedServerRuntimeBundleContract): readonly string[] {
  const diagnostics: string[] = [];
  if (contract.apiVersion !== 'applik8s.runtime/v1alpha1') {
    diagnostics.push('Generated server runtime bundle must use applik8s.runtime/v1alpha1.');
  }
  if (contract.kind !== 'GeneratedServerRuntimeBundle') {
    diagnostics.push('Generated server runtime bundle kind must be GeneratedServerRuntimeBundle.');
  }
  if (!contract.entrypoint.endsWith('.mjs')) {
    diagnostics.push('Generated server runtime bundle entrypoint must be an ESM .mjs file.');
  }
  if (contract.packageManagerAtStartup !== false) {
    diagnostics.push('Generated server runtime bundle must not install packages at startup.');
  }
  if (contract.releasePolicy.dependencyInstallation !== 'buildTimeOnly') {
    diagnostics.push('Generated server runtime bundle dependencies must be installed only at build time.');
  }
  if (contract.releasePolicy.runtimeImage !== 'explicitImageOrGeneratedRecipe') {
    diagnostics.push('Generated server runtime bundle must require an explicit image or generated image recipe.');
  }
  if (contract.releasePolicy.supplyChain !== 'metadataOnlyUntilSignedArtifacts') {
    diagnostics.push('Generated server runtime bundle supply-chain policy must stay metadata-only until signed artifacts exist.');
  }
  if (contract.releasePolicy.failurePolicy !== 'failClosed') {
    diagnostics.push('Generated server runtime bundle release policy must fail closed.');
  }
  if (contract.observability.health.mode !== 'http' || contract.observability.health.readinessPath !== '/-/healthz' || contract.observability.health.livenessPath !== '/-/healthz') {
    diagnostics.push('Generated server runtime bundle must declare HTTP health checks on /-/healthz.');
  }
  if (!contract.observability.logs.failureEvents.includes('applik8s-route-action-failure')) {
    diagnostics.push('Generated server runtime bundle must declare route action failure diagnostics.');
  }
  return diagnostics;
}

function generatedServerRuntimeObservability(): ApplicationObservabilityContract {
  return {
    health: { mode: 'http', readinessPath: '/-/healthz', livenessPath: '/-/healthz' },
    logs: { format: 'json', component: 'applik8s-server', failureEvents: ['applik8s-server-route-failure', 'applik8s-server-request-failure', 'applik8s-route-action-failure'] },
    metrics: { mode: 'declaredHooks', names: ['applik8s_server_requests_total', 'applik8s_server_route_failures_total'] },
    events: ['applik8s-server-route-failure', 'applik8s-server-request-failure', 'applik8s-route-action-failure'],
    sourceMaps: 'required',
    replayArtifacts: [{ kind: 'routeDiagnostics', name: 'routes.manifest.json' }],
    diagnosticsArtifact: { kind: 'routeDiagnostics', name: 'routes.manifest.json' },
  };
}
