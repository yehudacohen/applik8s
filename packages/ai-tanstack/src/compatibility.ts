// typecast-file-boundary: exact compatibility literals intentionally retain their manifest-level discriminants.
import {
  type ApplicationAICompatibilityTuple,
  applicationAIAdapterRevision,
} from '@applik8s/ai';

export const applicationTanStackAICompatibility = Object.freeze({
  tanstackAI: '0.45.1',
  tanstackAIClient: '0.23.3',
  tanstackAIReact: '0.19.3',
  tanstackAIPersistence: '0.1.5',
  agUi: '0.1.1-canary.beta.0',
  applik8sAdapter: applicationAIAdapterRevision,
} as const);

export interface ApplicationAIInfrastructureCompatibility {
  readonly envoyGateway: string;
  readonly envoyAIGateway: string;
  readonly providerAdapters?: Readonly<Record<string, string>>;
}

/**
 * Construct the complete compatibility tuple recorded in manifests and run
 * provenance. Infrastructure versions stay explicit because the TanStack
 * adapter must not silently choose or provision an Envoy provider.
 */
export function createApplicationAICompatibilityTuple(
  infrastructure: ApplicationAIInfrastructureCompatibility,
): ApplicationAICompatibilityTuple {
  requireVersion(infrastructure.envoyGateway, 'Envoy Gateway');
  requireVersion(infrastructure.envoyAIGateway, 'Envoy AI Gateway');
  for (const [name, version] of Object.entries(infrastructure.providerAdapters ?? {})) {
    requireVersion(version, `AI provider adapter ${name}`);
  }
  return Object.freeze({
    apiVersion: 'applik8s.aiCompatibility/v1alpha1',
    ...applicationTanStackAICompatibility,
    envoyGateway: infrastructure.envoyGateway,
    envoyAIGateway: infrastructure.envoyAIGateway,
    providerAdapters: Object.freeze({ ...infrastructure.providerAdapters }),
  });
}

function requireVersion(value: string, label: string): void {
  if (!value.trim() || value === 'latest' || /[*^~]/u.test(value)) {
    throw new Error(`${label} compatibility requires an exact, non-latest version.`);
  }
}
