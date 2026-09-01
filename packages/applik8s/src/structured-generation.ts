// typecast-file-boundary: Public provider constructors validate the bounded
// structural configuration before branding it as a callable provider token.
import type { ApplicationResourceRef } from '@applik8s/core';
import type {
  ApplicationSecretSourceBinding,
} from './application-configuration.js';
import type {
  ApplicationProviderConfigString,
  ApplicationProviderConfigUrl,
  ApplicationProviderToken,
  ApplicationQualifiableProviderToken,
  ApplicationTypedProviderContract,
} from './application-providers.js';
import {
  type ApplicationCapabilityImplementation,
  maintainedApplicationCapabilityImplementation,
} from './application-capability-implementation.js';
import { applicationQualifiableProviderToken } from './application-provider-qualification.js';

export interface ApplicationStructuredGenerationHttpProvider {
  readonly kind: 'structured-generation-http';
  /** Provider-neutral JSON generation endpoint. HTTPS is required unless explicitly limited to a local test profile. */
  readonly endpoint: ApplicationProviderConfigUrl;
  readonly credentialSecret?: ApplicationResourceRef;
  /** Provider-neutral deployment secret source. It is projected into the selected runtime without entering the plan or application graph as plaintext. */
  readonly credential?: ApplicationSecretSourceBinding;
  readonly credentialKey?: string;
  readonly authorization?: 'bearer' | 'x-api-key';
  readonly defaultProfile?: ApplicationProviderConfigString;
  readonly timeoutSeconds?: number;
  readonly maxResponseBytes?: number;
  readonly allowInsecureHttp?: boolean;
}

/** Deterministic schema-validated provider intended for tests and local examples. */
export interface ApplicationStructuredGenerationDeterministicProvider {
  readonly kind: 'structured-generation-deterministic';
  readonly output: Readonly<Record<string, unknown>>;
  readonly inputUnits?: number;
  readonly outputUnits?: number;
}

export type ApplicationStructuredGenerationProvider =
  | ApplicationStructuredGenerationHttpProvider
  | ApplicationStructuredGenerationDeterministicProvider;

export interface ApplicationStructuredGenerationProviderToken extends ApplicationQualifiableProviderToken<ApplicationStructuredGenerationProvider> {
  http(options: Omit<ApplicationStructuredGenerationHttpProvider, 'kind'>): ApplicationCapabilityImplementation<ApplicationStructuredGenerationHttpProvider>;
  deterministic(options: Omit<ApplicationStructuredGenerationDeterministicProvider, 'kind'>): ApplicationCapabilityImplementation<ApplicationStructuredGenerationDeterministicProvider>;
}

const contract: ApplicationTypedProviderContract = {
  apiVersion: 'applik8s.provider/v1alpha1',
  interface: 'StructuredGeneration',
  version: 'v1alpha1',
  requirements: [],
  guarantees: ['schemaBoundOutput', 'cancellation', 'idempotency', 'usageEvidence', 'secretBackedCredentials'],
};

/** Handler-safe capability token shared by provide() and task context.use(). */
export const StructuredGeneration: ApplicationStructuredGenerationProviderToken = applicationQualifiableProviderToken({
  name: 'StructuredGeneration',
  description: 'Schema-bound, cancellable structured generation with bounded usage and Secret-backed credentials.',
  contract,
  accepts: isApplicationStructuredGenerationProvider,
  http(options) {
    if (options.credential && options.credentialSecret) {
      throw new Error('StructuredGeneration.http(...) accepts credential or credentialSecret, not both.');
    }
    if (typeof options.endpoint === 'string') {
      const endpoint = options.endpoint.trim();
      if (!endpoint) throw new Error('StructuredGeneration.http({ endpoint }) must not be empty.');
      const parsed = new URL(endpoint);
      if (parsed.protocol !== 'https:' && !(options.allowInsecureHttp === true && parsed.protocol === 'http:')) {
        throw new Error('StructuredGeneration.http({ endpoint }) requires HTTPS. Set allowInsecureHttp only for an explicit local test provider.');
      }
    }
    if (options.timeoutSeconds !== undefined && (!Number.isInteger(options.timeoutSeconds) || options.timeoutSeconds < 1 || options.timeoutSeconds > 300)) {
      throw new Error('StructuredGeneration.http({ timeoutSeconds }) must be an integer between 1 and 300.');
    }
    if (options.maxResponseBytes !== undefined && (!Number.isInteger(options.maxResponseBytes) || options.maxResponseBytes < 1_024 || options.maxResponseBytes > 10_000_000)) {
      throw new Error('StructuredGeneration.http({ maxResponseBytes }) must be between 1 KiB and 10 MB.');
    }
    return maintainedApplicationCapabilityImplementation(
      StructuredGeneration as ApplicationProviderToken<ApplicationStructuredGenerationHttpProvider>, {
      provider: { package: '@applik8s/applik8s', export: 'StructuredGeneration.http', version: '0.9.0-alpha.1' },
      value: { kind: 'structured-generation-http', ...options },
      runtimeAdapter: '@applik8s/runtime-ai',
      readiness: 'applik8s.structured-generation.http.readiness/v1alpha1',
      lifecycle: 'external',
      migration: 'applik8s.structured-generation.http.migration/v1alpha1',
      maturity: 'experimental',
      },
    );
  },
  deterministic(options) {
    if (!options.output || typeof options.output !== 'object' || Array.isArray(options.output)) {
      throw new Error('StructuredGeneration.deterministic({ output }) requires one JSON object fixture.');
    }
    return maintainedApplicationCapabilityImplementation(
      StructuredGeneration as ApplicationProviderToken<ApplicationStructuredGenerationDeterministicProvider>, {
      provider: { package: '@applik8s/applik8s', export: 'StructuredGeneration.deterministic', version: '0.9.0-alpha.1' },
      value: { kind: 'structured-generation-deterministic', ...options },
      runtimeAdapter: '@applik8s/runtime-ai',
      readiness: 'applik8s.structured-generation.deterministic.readiness/v1alpha1',
      lifecycle: 'application',
      migration: 'applik8s.structured-generation.deterministic.migration/v1alpha1',
      maturity: 'stable',
      },
    );
  },
});

export function isApplicationStructuredGenerationProvider(value: unknown): value is ApplicationStructuredGenerationProvider {
  if (!value || typeof value !== 'object') return false;
  const kind = Reflect.get(value, 'kind');
  if (kind === 'structured-generation-deterministic') {
    const output = Reflect.get(value, 'output');
    return Boolean(output && typeof output === 'object' && !Array.isArray(output));
  }
  if (kind !== 'structured-generation-http') return false;
  const endpoint = Reflect.get(value, 'endpoint');
  return (typeof endpoint === 'string' && endpoint.trim().length > 0) || Boolean(endpoint && typeof endpoint === 'object');
}
