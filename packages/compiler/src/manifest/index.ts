import { createHash } from 'node:crypto';

import type { AnyHandlerRegistration, AnyResourceDefinition, BundleArtifact, CapabilityDescriptor, CapabilityExecutionPolicy, CapabilityKind, ConcurrencyConfig, HandlerEventType, HandlerId, OperatorDefinition, OperatorManifest, PermissionRule, Result, RetryPolicy, RuntimePayloadSchemaDigests, SecretRef } from '@applik8s/core';
import { canonicalRuntimeContract } from '@applik8s/runtime-contract';
import type { ContainerRecipe } from '@applik8s/typetainer';
import { canonicalBundleArtifacts, computeBundleDigest } from './bundle-digest.js';
import { validateOperatorManifest } from './validation.js';

export { validateOperatorManifest } from './validation.js';

export interface ManifestBuildRequest {
  readonly operator: OperatorDefinition;
  readonly handlerArtifactPath: string;
  readonly handlerArtifactDigest: string;
  readonly runtimeContractPath: string;
  readonly runtimeContractDigest: string;
  readonly additionalArtifacts?: readonly BundleArtifact[];
  readonly runtimeVersionRange?: string;
  readonly compilerVersion?: string;
  readonly containerBuildContext?: string;
  readonly portability?: ManifestPortabilityPolicy;
}

export interface ManifestPortabilityPolicy {
  readonly deterministicBuild: boolean;
  readonly allowEnvironmentAccess: boolean;
  readonly allowFilesystemAccess: boolean;
  readonly allowNetworkAccess: boolean;
  readonly sourceMaps: { readonly emit: boolean; readonly includeSourceContent: boolean; readonly redactPaths: boolean };
}

export interface ManifestBuilder {
  build(request: ManifestBuildRequest): Result<OperatorManifest>;
}

export function buildOperatorManifest(request: ManifestBuildRequest): Result<OperatorManifest> {
  const contract = canonicalRuntimeContract();
  const resourceHandlers = request.operator.handlers.filter(hasResourceHandlerIdentity);
  const validationError = validateManifestBuildRequest(request, resourceHandlers);
  if (validationError) {
    return validationError;
  }

  const compilerVersion = request.compilerVersion ?? 'applik8s-compiler-dev';
  const handlerExports = resourceHandlers.map((handler) => ({
    handlerId: handler.id,
    exportName: 'handle',
    resource: {
      apiVersion: handler.resource.apiVersion,
      kind: handler.resource.kind,
    },
    event: handler.event,
    ...(handler.finalizers && handler.finalizers.length > 0 ? { finalizers: [...handler.finalizers] } : {}),
  }));
  const resources = Object.values(request.operator.resources);
  const permissions = runtimePermissions(request.operator, mergePermissionRules([
    ...inferRuntimeResourcePermissions(resources, resourceHandlers),
    ...(request.operator.permissions ?? []),
  ]));
  const capabilities = normalizedCapabilities(request.operator.capabilities ?? {});
  const schemaDigests = payloadSchemaDigests(contract.payloadSchemas);
  const ownedCrds = resources.map(ownedCrdManifestEntry);
  const artifactInventory = canonicalBundleArtifacts([
    { kind: 'wasm-component', path: request.handlerArtifactPath, digest: request.handlerArtifactDigest },
    { kind: 'runtime-contract', path: request.runtimeContractPath, digest: request.runtimeContractDigest },
    ...(request.additionalArtifacts ?? []),
  ]);
  const artifactValidationError = validateBundleArtifactInventory(request, artifactInventory);
  if (artifactValidationError) {
    return artifactValidationError;
  }
  const bundleDigest = computeBundleDigest({
    compilerVersion,
    handlerAbi: contract.abiVersion,
    operatorName: request.operator.name,
    artifacts: artifactInventory,
    handlerExports,
    ownedCrds,
    payloadSchemaDigests: schemaDigests,
  });
  const container = implicitRuntimeContainer(request.operator.name, bundleDigest, request.containerBuildContext ?? '.');
  const manifest: OperatorManifest = {
    apiVersion: 'applik8s.operator/v1alpha1',
    kind: 'OperatorBundle',
    metadata: {
      name: request.operator.name,
      ...(request.operator.deployment?.labels ? { labels: request.operator.deployment.labels } : {}),
      ...(request.operator.deployment?.annotations || request.operator.deployment?.namespace
        ? {
            annotations: {
              ...(request.operator.deployment.annotations ?? {}),
              ...(request.operator.deployment.namespace ? { 'applik8s.dev/namespace': request.operator.deployment.namespace } : {}),
            },
          }
        : {}),
    },
    spec: {
      handlerAbi: contract.abiVersion,
      payloadSchemaDigests: schemaDigests,
      requiresRuntime: request.runtimeVersionRange ?? '^0.1.0',
      handlerArtifact: {
        kind: 'wasm-component',
        path: request.handlerArtifactPath,
        digest: request.handlerArtifactDigest,
      },
      adapterRequirements: {
        kind: 'wasmComponent',
        wasmComponentModel: true,
        hostImports: ['capability-request', 'log', 'cancel'],
        javascript: { features: ['closures', 'asyncFunctions', 'promises', 'es6Proxy'] },
      },
      handlerExports,
      ownedCrds,
      watches: watchRegistrations(resources, resourceHandlers),
      permissions,
      ...(Object.keys(capabilities).length > 0 ? { capabilities } : {}),
      security: securityContract(request.operator, permissions, capabilities, request.portability),
      lifecycle: request.operator.lifecycle ?? defaultLifecycleContract(),
      ...(request.operator.runtime ? { runtime: request.operator.runtime } : {}),
      container,
      bundle: {
        digest: bundleDigest,
        sourceDigest: request.runtimeContractDigest,
        compilerVersion,
        createdAt: new Date(0).toISOString(),
        artifacts: artifactInventory,
        supplyChain: {
          signatures: [],
          posture: {
            signing: 'unsigned',
            sbom: 'notGenerated',
            provenance: 'notGenerated',
            admission: 'metadataOnly',
          },
        },
        portability: {
          operatorIdentity: request.operator.name,
          bundleDigest,
          runtimeAbi: contract.abiVersion,
          crdVersions: resources.flatMap((resource) => resource.versions.map((version) => `${resource.apiVersion}/${version.name}`)),
          labels: { 'app.kubernetes.io/managed-by': 'applik8s' },
        },
      },
    },
  };

  const manifestValidation = validateOperatorManifest(manifest);
  if (!manifestValidation.ok) {
    return manifestValidation;
  }

  return { ok: true, value: manifest };
}

function implicitRuntimeContainer(operatorName: string, bundleDigest: string, context: string): ContainerRecipe {
  const tag = bundleDigest.replace('sha256:', '').slice(0, 12);
  return {
    image: {
      repository: `applik8s/${operatorName}-operator`,
      tag,
    },
    baseImage: { registry: 'ghcr.io', repository: 'applik8s/applik8s-operator-host', tag: 'dev' },
    files: [
      { source: 'operator-manifest.json', destination: '/etc/applik8s/operator-manifest.json' },
      { source: 'wasm/handler.wasm', destination: '/handler/handler.wasm' },
      { source: 'bundle/handler.js', destination: '/handler/handler.js' },
      { source: 'bundle/handler.js.map', destination: '/handler/handler.js.map' },
    ],
    build: {
      context,
      dockerfile: 'Dockerfile.applik8s-runtime',
      labels: {
        'app.kubernetes.io/managed-by': 'applik8s',
        'applik8s.dev/operator': operatorName,
        'applik8s.dev/bundle-digest': bundleDigest,
      },
    },
    publish: { enabled: false },
  };
}

function ownedCrdManifestEntry(resource: AnyResourceDefinition): OperatorManifest['spec']['ownedCrds'][number] {
  return {
    apiVersion: resource.apiVersion,
    kind: resource.kind,
    plural: resource.plural,
    scope: resource.scope,
    versions: resource.versions.map((version) => version.name),
    storageVersion: resource.versions.find((version) => version.storage)?.name ?? resource.versions[0]?.name ?? 'v1',
    conversionStrategy: 'none',
    versioning: {
      multiVersion: 'singleVersion',
      conversionWebhook: 'notConfigured',
      storageMigration: 'notRequired',
      rollbackSafety: 'schemaCompatibleOnly',
    },
    statusSubresource: resource.statusSubresource,
    ...(resource.statusConvention ? { statusConvention: resource.statusConvention } : {}),
  };
}

function securityContract(operator: OperatorDefinition, permissions: readonly PermissionRule[], capabilities: Readonly<Record<string, CapabilityDescriptor>>, portability: ManifestPortabilityPolicy | undefined): OperatorManifest['spec']['security'] {
  return {
    trustLevel: operator.trustLevel,
    effects: operator.effects ?? { mode: 'planned', replayable: true },
    capabilities: Object.entries(capabilities).map(([name, descriptor]) => ({
      name,
      descriptor,
      required: true,
      exposedToHandlers: true,
      execution: descriptor.execution ?? disabledCapabilityExecutionPolicy(),
      ...(descriptor.permissions ? { rbac: descriptor.permissions } : {}),
    })),
    rbac: {
      mode: operator.permissions ? 'explicitAndInferred' : 'inferred',
      rules: permissions,
      leastPrivilegeReviewed: Boolean(operator.permissions),
    },
    secrets: {
      mode: 'referencesOnly',
      secretRefs: secretRefs(capabilities),
      embedSecretMaterial: false,
    },
    hostAccess: {
      filesystem: 'denied',
      network: Object.keys(capabilities).length > 0 ? 'declaredCapabilityOnly' : 'denied',
      environment: 'declaredConfigOnly',
      undeclaredHostImports: 'denied',
    },
    portability: portabilitySecurityContract(portability),
  };
}

function normalizedCapabilities(capabilities: Readonly<Record<string, CapabilityDescriptor>>): Readonly<Record<string, CapabilityDescriptor>> {
  const normalized: Record<string, CapabilityDescriptor> = {};
  for (const [name, descriptor] of Object.entries(capabilities)) {
    normalized[name] = {
      ...descriptor,
      name,
      execution: descriptor.execution ?? disabledCapabilityExecutionPolicy(),
    };
  }
  return normalized;
}

function disabledCapabilityExecutionPolicy(): CapabilityExecutionPolicy {
  return {
    liveExecution: 'disabled',
    protocol: 'notImplemented',
    audit: {
      recordRequests: true,
      recordResponses: false,
      includePayloads: false,
    },
    redaction: {
      requestBody: 'redacted',
      responseBody: 'redacted',
      headers: 'redacted',
      errors: 'publicMessageOnly',
    },
    idempotency: {
      requiredForMutations: true,
      keySource: 'handlerProvided',
    },
  };
}

function portabilitySecurityContract(portability: ManifestPortabilityPolicy | undefined): OperatorManifest['spec']['security']['portability'] {
  const policy = portability ?? {
    deterministicBuild: true,
    allowEnvironmentAccess: false,
    allowFilesystemAccess: false,
    allowNetworkAccess: false,
    sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false },
  };
  return {
    enforcement: 'failClosed',
    deterministicBuild: policy.deterministicBuild,
    environmentAccess: policy.allowEnvironmentAccess ? 'allowedByPolicy' : 'denied',
    filesystemAccess: policy.allowFilesystemAccess ? 'allowedByPolicy' : 'denied',
    networkAccess: policy.allowNetworkAccess ? 'allowedByPolicy' : 'denied',
    dynamicImport: 'denied',
    localCredentialPaths: 'denied',
    embeddedSecretMaterial: 'denied',
    unsupportedNativeModules: 'denied',
    sourceMaps: {
      emitted: policy.sourceMaps.emit,
      sourceContent: policy.sourceMaps.includeSourceContent ? 'includedByPolicy' : 'excluded',
      paths: policy.sourceMaps.redactPaths ? 'redacted' : 'preservedByPolicy',
    },
  };
}

function secretRefs(capabilities: Readonly<Record<string, CapabilityDescriptor>>): readonly SecretRef[] {
  return Object.values(capabilities).flatMap((descriptor) => descriptor.auth?.type === 'secretRef' ? [descriptor.auth.secretRef] : []);
}

function defaultLifecycleContract(): OperatorManifest['spec']['lifecycle'] {
  const preserveDomainData = {
    preserveCrds: true,
    preserveInstances: true,
    destructive: false,
    requiresExplicitConfirmation: false,
  };
  const destructiveDomainData = {
    preserveCrds: false,
    preserveInstances: false,
    destructive: true,
    requiresExplicitConfirmation: true,
  };

  return {
    install: { action: 'install', domainDataPolicy: preserveDomainData, requiresExplicitConfirmation: false },
    upgrade: {
      requiresRuntimeCompatibility: true,
      requiresHandlerAbiCompatibility: true,
      requiresCrdVersionCompatibility: true,
      requiresStorageVersionCompatibility: true,
      requiresExternalEffectCompatibility: true,
    },
    rollback: {
      requiresRuntimeCompatibility: true,
      requiresHandlerAbiCompatibility: true,
      requiresCrdVersionCompatibility: true,
      requiresStorageVersionCompatibility: true,
      requiresExternalEffectCompatibility: true,
    },
    uninstallController: { action: 'uninstallController', domainDataPolicy: preserveDomainData, requiresExplicitConfirmation: false },
    deleteDomainData: { action: 'deleteDomainData', domainDataPolicy: destructiveDomainData, requiresExplicitConfirmation: true },
  };
}

function validateBundleArtifactInventory(request: ManifestBuildRequest, artifacts: readonly BundleArtifact[]): Result<never> | undefined {
  for (const artifact of artifacts) {
    if (artifact.path.length === 0) {
      return bundleArtifactError(request, artifact, 'Bundle artifacts must include non-empty paths.');
    }
    if (!isSha256Digest(artifact.digest)) {
      return bundleArtifactError(request, artifact, `Bundle artifact ${artifact.path} must include a real sha256 digest.`);
    }
  }

  const duplicatePath = firstDuplicate(artifacts.map((artifact) => artifact.path));
  if (duplicatePath) {
    return {
      ok: false,
      error: {
        code: 'BUNDLE_INVALID',
        message: `Bundle artifact inventory contains duplicate path ${duplicatePath}.`,
        severity: 'error',
        context: { operatorName: request.operator.name, sourceFile: duplicatePath },
        recovery: { summary: 'Ensure every emitted artifact has a single canonical path in the bundle inventory.' },
      },
    };
  }

  return undefined;
}

function bundleArtifactError(request: ManifestBuildRequest, artifact: BundleArtifact, message: string): Result<never> {
  return {
    ok: false,
    error: {
      code: 'BUNDLE_INVALID',
      message,
      severity: 'error',
      context: { operatorName: request.operator.name, sourceFile: artifact.path },
      recovery: { summary: 'Regenerate artifact metadata from the actual emitted artifact bytes.' },
    },
  };
}

function validateManifestBuildRequest(request: ManifestBuildRequest, resourceHandlers: readonly ResourceHandlerIdentity[]): Result<never> | undefined {
  if (!isSha256Digest(request.handlerArtifactDigest)) {
    return {
      ok: false,
      error: {
        code: 'BUNDLE_INVALID',
        message: 'Manifest build requires a real sha256 handler artifact digest.',
        severity: 'error',
        context: { sourceFile: request.handlerArtifactPath },
        recovery: { summary: 'Pass the sha256 digest of the emitted handler artifact bytes.' },
      },
    };
  }

  if (!isSha256Digest(request.runtimeContractDigest)) {
    return {
      ok: false,
      error: {
        code: 'BUNDLE_INVALID',
        message: 'Manifest build requires a real sha256 runtime contract digest.',
        severity: 'error',
        context: { sourceFile: request.runtimeContractPath },
        recovery: { summary: 'Pass the sha256 digest of the emitted runtime contract artifact.' },
      },
    };
  }

  const duplicateHandlerId = firstDuplicate(resourceHandlers.map((handler) => handler.id));
  if (duplicateHandlerId) {
    return {
      ok: false,
      error: {
        code: 'BUNDLE_INVALID',
        message: `Manifest build requires unique handler IDs; found duplicate ${duplicateHandlerId}.`,
        severity: 'error',
        context: { operatorName: request.operator.name, handlerId: duplicateHandlerId },
        recovery: { summary: 'Ensure handler IDs are stable and unique before emitting the operator manifest.' },
      },
    };
  }

  const ambiguousHandlerRoute = firstAmbiguousHandlerRoute(resourceHandlers);
  if (ambiguousHandlerRoute) {
    return {
      ok: false,
      error: {
        code: 'BUNDLE_INVALID',
        message: `Manifest build does not support multiple handlers for ${ambiguousHandlerRoute.resource.apiVersion}/${ambiguousHandlerRoute.resource.kind} ${ambiguousHandlerRoute.event}: ${ambiguousHandlerRoute.handlerIds.join(', ')}.`,
        severity: 'error',
        context: { operatorName: request.operator.name, handlerId: ambiguousHandlerRoute.handlerIds.join(',') },
        recovery: { summary: 'Register one handler for each resource/event route until deterministic multi-handler semantics are specified and implemented.' },
      },
    };
  }

  const replicas = request.operator.deployment?.replicas ?? 1;
  const leaderElectionEnabled = request.operator.runtime?.leaderElection?.enabled === true;
  if (replicas > 1 && !leaderElectionEnabled) {
    return {
      ok: false,
      error: {
        code: 'BUNDLE_INVALID',
        message: 'Operator deployment.replicas greater than 1 requires runtime.leaderElection.enabled.',
        severity: 'error',
        context: { operatorName: request.operator.name },
        recovery: { summary: 'Enable runtime.leaderElection with a valid Lease configuration, or use replicas: 1.' },
      },
    };
  }

  if (leaderElectionEnabled) {
    const leaderElectionValidation = validateLeaderElectionConfig(request.operator);
    if (leaderElectionValidation) {
      return leaderElectionValidation;
    }
  }

  const unsupportedConcurrency = unsupportedRuntimeConcurrency(request.operator.runtime?.concurrency);
  if (unsupportedConcurrency) {
    return {
      ok: false,
      error: {
        code: 'BUNDLE_INVALID',
        message: unsupportedConcurrency,
        severity: 'error',
        context: { operatorName: request.operator.name },
        recovery: { summary: 'Use workerCount: 1, maxInFlightPerResource: 1, and omit maxQueueDepth until explicit runtime concurrency support is implemented.' },
      },
    };
  }

  if (request.operator.runtime?.replayArtifacts?.enabled && !request.operator.runtime.replayArtifacts.directory) {
    return {
      ok: false,
      error: {
        code: 'BUNDLE_INVALID',
        message: 'runtime.replayArtifacts.directory is required when replay artifacts are enabled.',
        severity: 'error',
        context: { operatorName: request.operator.name },
        recovery: { summary: 'Set runtime.replayArtifacts.directory to a writable path, or disable replay artifacts.' },
      },
    };
  }

  const capabilityValidation = validateCapabilityDescriptors(request.operator);
  if (capabilityValidation) {
    return capabilityValidation;
  }

  const crdVersionValidation = validateCrdVersioning(request.operator);
  if (crdVersionValidation) {
    return crdVersionValidation;
  }

  return undefined;
}

function validateCrdVersioning(operator: OperatorDefinition): Result<never> | undefined {
  for (const resource of Object.values(operator.resources)) {
    if (resource.versions.length !== 1) {
      return crdVersioningError(operator, resource.kind, `CRD ${resource.apiVersion}/${resource.kind} declares ${resource.versions.length} versions; applik8s currently supports exactly one CRD version until conversion and migration compatibility are implemented.`);
    }
    const storageVersions = resource.versions.filter((version) => version.storage);
    if (storageVersions.length !== 1) {
      return crdVersioningError(operator, resource.kind, `CRD ${resource.apiVersion}/${resource.kind} must declare exactly one storage version.`);
    }
    const unsupportedConversion = resource.versions.find((version) => version.compatibility.conversionStrategy !== 'none' || version.compatibility.conversionWebhook);
    if (unsupportedConversion) {
      return crdVersioningError(operator, resource.kind, `CRD ${resource.apiVersion}/${resource.kind} version ${unsupportedConversion.name} declares conversion webhook semantics that are not supported yet.`);
    }
  }
  return undefined;
}

function crdVersioningError(operator: OperatorDefinition, kind: string, message: string): Result<never> {
  return {
    ok: false,
    error: {
      code: 'BUNDLE_INVALID',
      message,
      severity: 'error',
      context: { operatorName: operator.name, sourceFile: kind },
      recovery: { summary: 'Use a single storage version with conversionStrategy: none until applik8s implements CRD conversion, migration, and rollback compatibility.' },
    },
  };
}

function validateCapabilityDescriptors(operator: OperatorDefinition): Result<never> | undefined {
  for (const [name, descriptor] of Object.entries(operator.capabilities ?? {})) {
    if (!isCapabilityName(name)) {
      return capabilityError(operator, name, `Capability name ${name} must be a DNS-label-like identifier.`);
    }
    if (!isSupportedCapabilityKind(descriptor.kind)) {
      return capabilityError(operator, name, `Capability ${name} uses unsupported kind ${descriptor.kind}.`);
    }
    if (descriptor.kind !== 'kubernetes' && !descriptor.endpoint) {
      return capabilityError(operator, name, `Capability ${name} of kind ${descriptor.kind} must declare endpoint metadata.`);
    }
    if (descriptor.endpoint && descriptor.kind === 'http' && !isHttpEndpoint(descriptor.endpoint)) {
      return capabilityError(operator, name, `HTTP capability ${name} endpoint must be an http or https URL.`);
    }
    const authType = descriptor.auth?.type;
    if (authType && !isSupportedCapabilityAuthType(authType)) {
      return capabilityError(operator, name, `Capability ${name} uses unsupported auth type ${authType}.`);
    }
    if (descriptor.auth?.type === 'secretRef' && (!descriptor.auth.secretRef.name || !descriptor.auth.secretRef.key)) {
      return capabilityError(operator, name, `Capability ${name} secretRef auth must include secret name and key.`);
    }
    if (descriptor.policy?.failureMode && descriptor.policy.failureMode !== 'rejectPromiseWithApplik8sError') {
      return capabilityError(operator, name, `Capability ${name} uses unsupported failureMode ${descriptor.policy.failureMode}.`);
    }
    const timeoutValidation = validateCapabilityTimeoutPolicy(name, descriptor.policy?.timeoutMs);
    if (timeoutValidation) {
      return capabilityError(operator, name, timeoutValidation);
    }
    const retryValidation = validateCapabilityRetryPolicy(name, descriptor.policy?.retry);
    if (retryValidation) {
      return capabilityError(operator, name, retryValidation);
    }
    if (descriptor.execution && descriptor.execution.liveExecution !== 'disabled') {
      if (!isSupportedLiveCapabilityDescriptor(descriptor)) {
        return capabilityError(operator, name, `Capability ${name} liveExecution is supported only for auth:none or auth:secretRef HTTP capabilities using applik8s.capability/v1alpha1.`);
      }
      if (descriptor.auth?.type === 'secretRef') {
        if (!operator.deployment?.namespace) {
          return capabilityError(operator, name, `Capability ${name} live secretRef auth requires deployment.namespace so generated Secret RBAC is namespace-scoped and explicit.`);
        }
        if (descriptor.auth.secretRef.namespace && descriptor.auth.secretRef.namespace !== operator.deployment.namespace) {
          return capabilityError(operator, name, `Capability ${name} live secretRef auth must reference a Secret in deployment.namespace; cross-namespace Secret auth is not supported yet.`);
        }
      }
    }
    if (descriptor.execution && descriptor.execution.liveExecution === 'disabled' && descriptor.execution.protocol !== 'notImplemented') {
      return capabilityError(operator, name, `Capability ${name} protocol must be notImplemented when liveExecution is disabled.`);
    }
  }
  return undefined;
}

function isSupportedCapabilityAuthType(authType: string): boolean {
  return authType === 'none' || authType === 'secretRef' || authType === 'serviceAccount';
}

function validateCapabilityTimeoutPolicy(name: string, timeoutMs: number | undefined): string | undefined {
  if (timeoutMs === undefined) {
    return undefined;
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    return `Capability ${name} policy.timeoutMs must be an integer between 1 and 30000 milliseconds.`;
  }
  return undefined;
}

function validateCapabilityRetryPolicy(name: string, retry: RetryPolicy | undefined): string | undefined {
  if (retry === undefined) {
    return undefined;
  }
  if (!Number.isInteger(retry.maxAttempts) || retry.maxAttempts < 1 || retry.maxAttempts > 5) {
    return `Capability ${name} policy.retry.maxAttempts must be an integer between 1 and 5.`;
  }
  if (!Number.isInteger(retry.backoffMs) || retry.backoffMs < 1 || retry.backoffMs > 30_000) {
    return `Capability ${name} policy.retry.backoffMs must be an integer between 1 and 30000 milliseconds.`;
  }
  if (retry.maxBackoffMs !== undefined && (!Number.isInteger(retry.maxBackoffMs) || retry.maxBackoffMs < 1 || retry.maxBackoffMs > 30_000)) {
    return `Capability ${name} policy.retry.maxBackoffMs must be an integer between 1 and 30000 milliseconds.`;
  }
  return undefined;
}

function isSupportedLiveCapabilityDescriptor(descriptor: CapabilityDescriptor): boolean {
  return descriptor.kind === 'http'
    && (descriptor.auth?.type === 'none' || descriptor.auth?.type === 'secretRef')
    && descriptor.execution?.liveExecution === 'hostProtocol'
    && descriptor.execution.protocol === 'applik8s.capability/v1alpha1'
    && descriptor.execution.audit.includePayloads === false
    && descriptor.execution.redaction.requestBody === 'redacted'
    && descriptor.execution.redaction.responseBody === 'redacted'
    && descriptor.execution.redaction.headers === 'redacted'
    && descriptor.execution.redaction.errors === 'publicMessageOnly'
    && descriptor.execution.idempotency.requiredForMutations === true;
}

function capabilityError(operator: OperatorDefinition, capabilityName: string, message: string): Result<never> {
  return {
    ok: false,
    error: {
      code: 'BUNDLE_INVALID',
      message,
      severity: 'error',
      context: { operatorName: operator.name, capabilityName },
      recovery: { summary: 'Use declared capability metadata that can be safely represented in the operator manifest; live external effects remain disabled for now.' },
    },
  };
}

function isCapabilityName(value: string): boolean {
  return /^[a-z][a-z0-9-]{0,62}$/.test(value);
}

function isSupportedCapabilityKind(value: CapabilityKind | string): value is CapabilityKind {
  return ['kubernetes', 'http', 'cloudApi', 'database', 'queue', 'objectStore', 'identity'].includes(value);
}

function isHttpEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function unsupportedRuntimeConcurrency(concurrency: ConcurrencyConfig | undefined): string | undefined {
  if (!concurrency) {
    return undefined;
  }
  if (concurrency.workerCount !== 1) {
    return 'runtime.concurrency.workerCount greater than 1 is not supported until the operator host implements explicit worker concurrency semantics.';
  }
  if (concurrency.maxInFlightPerResource !== 1) {
    return 'runtime.concurrency.maxInFlightPerResource greater than 1 is not supported until the operator host implements per-resource concurrency control.';
  }
  if (concurrency.maxQueueDepth !== undefined) {
    return 'runtime.concurrency.maxQueueDepth is not supported until the operator host exposes trustworthy kube-runtime queue depth controls.';
  }
  return undefined;
}

function validateLeaderElectionConfig(operator: OperatorDefinition): Result<never> | undefined {
  const leaderElection = operator.runtime?.leaderElection;
  if (!leaderElection?.enabled) {
    return undefined;
  }
  if (!leaderElection.leaseName) {
    return leaderElectionError(operator, 'runtime.leaderElection.leaseName is required when leader election is enabled.');
  }
  if (leaderElection.leaseDurationSeconds <= 0 || leaderElection.renewDeadlineSeconds <= 0 || leaderElection.retryPeriodSeconds <= 0) {
    return leaderElectionError(operator, 'runtime.leaderElection durations must be positive integers.');
  }
  if (leaderElection.leaseDurationSeconds <= leaderElection.renewDeadlineSeconds) {
    return leaderElectionError(operator, 'runtime.leaderElection.leaseDurationSeconds must be greater than renewDeadlineSeconds.');
  }
  if (leaderElection.renewDeadlineSeconds <= leaderElection.retryPeriodSeconds) {
    return leaderElectionError(operator, 'runtime.leaderElection.renewDeadlineSeconds must be greater than retryPeriodSeconds.');
  }
  if ((operator.deployment?.replicas ?? 1) > 1 && !operator.deployment?.namespace && !leaderElection.leaseNamespace) {
    return leaderElectionError(operator, 'deployment.namespace or runtime.leaderElection.leaseNamespace is required for multi-replica leader election.');
  }
  return undefined;
}

function leaderElectionError(operator: OperatorDefinition, message: string): Result<never> {
  return {
    ok: false,
    error: {
      code: 'BUNDLE_INVALID',
      message,
      severity: 'error',
      context: { operatorName: operator.name },
      recovery: { summary: 'Configure Kubernetes Lease-based leader election with leaseDurationSeconds > renewDeadlineSeconds > retryPeriodSeconds.' },
    },
  };
}

function firstDuplicate<T>(values: readonly T[]): T | undefined {
  const seen = new Set<T>();
  for (const value of values) {
    if (seen.has(value)) {
      return value;
    }
    seen.add(value);
  }
  return undefined;
}

function isSha256Digest(value: string): boolean {
  return /^sha256:[a-f0-9]{64}$/.test(value);
}

interface ResourceHandlerIdentity {
  readonly id: HandlerId;
  readonly event: HandlerEventType;
  readonly resource: Pick<AnyResourceDefinition, 'apiVersion' | 'kind'>;
  readonly finalizers?: readonly string[];
}

interface AmbiguousHandlerRoute {
  readonly resource: Pick<AnyResourceDefinition, 'apiVersion' | 'kind'>;
  readonly event: HandlerEventType;
  readonly handlerIds: readonly HandlerId[];
}

function firstAmbiguousHandlerRoute(handlers: readonly ResourceHandlerIdentity[]): AmbiguousHandlerRoute | undefined {
  const routes = new Map<string, ResourceHandlerIdentity[]>();
  for (const handler of handlers) {
    const key = `${handler.resource.apiVersion}\u0000${handler.resource.kind}\u0000${handler.event}`;
    routes.set(key, [...(routes.get(key) ?? []), handler]);
  }

  for (const routeHandlers of routes.values()) {
    if (routeHandlers.length < 2) {
      continue;
    }
    const [first] = routeHandlers;
    if (!first) {
      continue;
    }
    if (first.event !== 'finalize') {
      return { resource: first.resource, event: first.event, handlerIds: routeHandlers.map((handler) => handler.id) };
    }

    const declaredFinalizerHandlers = routeHandlers.filter((handler) => (handler.finalizers?.length ?? 0) > 0);
    if (declaredFinalizerHandlers.length !== routeHandlers.length) {
      return { resource: first.resource, event: first.event, handlerIds: routeHandlers.map((handler) => handler.id) };
    }
    const duplicateFinalizer = firstDuplicate(declaredFinalizerHandlers.flatMap((handler) => handler.finalizers ?? []));
    if (duplicateFinalizer) {
      const conflictingHandlers = declaredFinalizerHandlers
        .filter((handler) => handler.finalizers?.includes(duplicateFinalizer))
        .map((handler) => handler.id);
      return { resource: first.resource, event: first.event, handlerIds: conflictingHandlers };
    }
  }

  return undefined;
}

function watchRegistrations(resources: readonly AnyResourceDefinition[], handlers: readonly ResourceHandlerIdentity[]): OperatorManifest['spec']['watches'] {
  return resources.map((resource) => {
    const resourceHandlers = handlers.filter((handler) => 'resource' in handler && handler.resource.apiVersion === resource.apiVersion && handler.resource.kind === resource.kind);
    const events = unique(resourceHandlers.map((handler) => handler.event));
    return {
      apiVersion: resource.apiVersion,
      kind: resource.kind,
      events: events.length > 0 ? events : ['reconcile'],
      handlers: resourceHandlers.map((handler) => handler.id),
    };
  });
}

function hasResourceHandlerIdentity(handler: AnyHandlerRegistration): handler is AnyHandlerRegistration & ResourceHandlerIdentity {
  const resource = Reflect.get(handler, 'resource');
  return Boolean(resource && (typeof resource === 'object' || typeof resource === 'function') && typeof Reflect.get(resource, 'apiVersion') === 'string' && typeof Reflect.get(resource, 'kind') === 'string');
}

function inferRuntimeResourcePermissions(resources: readonly AnyResourceDefinition[], handlers: readonly AnyHandlerRegistration[]): readonly PermissionRule[] {
  const resourcePermissions = resources.flatMap((resource) => {
    const watch = resource.permissions.watch();
    const patchStatus = resource.permissions.patchStatus();
    const finalizers = handlers.some((handler) => handlerTargetsResource(handler, resource) && (handler.event === 'finalize' || (handler.finalizers?.length ?? 0) > 0))
      ? [finalizerPermission(resource), finalizerObjectPatchPermission(resource)]
      : [];
    return [watch, patchStatus].flatMap((permission) => (permission.ok ? [permission.value] : [])).concat(finalizers);
  });
  return handlers.length > 0 ? [...resourcePermissions, eventPermission()] : resourcePermissions;
}

function handlerTargetsResource(handler: AnyHandlerRegistration, resource: AnyResourceDefinition): boolean {
  return hasResourceHandlerIdentity(handler) && handler.resource.apiVersion === resource.apiVersion && handler.resource.kind === resource.kind;
}

function finalizerPermission(resource: AnyResourceDefinition): PermissionRule {
  const apiGroup = resource.apiVersion.includes('/') ? resource.apiVersion.split('/')[0] ?? '' : '';
  return { apiGroups: [apiGroup], resources: [`${resource.plural}/finalizers`], verbs: ['get', 'patch', 'update'] };
}

function finalizerObjectPatchPermission(resource: AnyResourceDefinition): PermissionRule {
  const apiGroup = resource.apiVersion.includes('/') ? resource.apiVersion.split('/')[0] ?? '' : '';
  return { apiGroups: [apiGroup], resources: [resource.plural], verbs: ['patch'] };
}

function eventPermission(): PermissionRule {
  return { apiGroups: [''], resources: ['events'], verbs: ['create', 'patch', 'update'] };
}

function runtimePermissions(operator: OperatorDefinition, permissions: readonly PermissionRule[]): readonly PermissionRule[] {
  return mergePermissionRules([
    ...permissions,
    ...secretCapabilityPermissions(operator),
    ...leaderElectionPermissions(operator),
  ]);
}

function mergePermissionRules(permissions: readonly PermissionRule[]): readonly PermissionRule[] {
  const merged = new Map<string, { apiGroups: string[]; resources: string[]; verbs: string[]; resourceNames?: string[] }>();
  for (const permission of permissions) {
    const apiGroups = [...permission.apiGroups].sort();
    const resources = [...permission.resources].sort();
    const resourceNames = permission.resourceNames ? [...permission.resourceNames].sort() : undefined;
    const key = JSON.stringify({ apiGroups, resources, resourceNames });
    const existing = merged.get(key);
    if (existing) {
      existing.verbs = [...unique([...existing.verbs, ...permission.verbs])];
      continue;
    }
    merged.set(key, {
      apiGroups,
      resources,
      verbs: [...unique([...permission.verbs])],
      ...(resourceNames ? { resourceNames } : {}),
    });
  }
  return [...merged.values()];
}

function leaderElectionPermissions(operator: OperatorDefinition): readonly PermissionRule[] {
  const leaderElection = operator.runtime?.leaderElection;
  if (!leaderElection?.enabled) {
    return [];
  }
  const leaseMutationRule = {
    apiGroups: ['coordination.k8s.io'],
    resources: ['leases'],
    verbs: ['get', 'update', 'patch'],
    ...(leaderElection.leaseName ? { resourceNames: [leaderElection.leaseName] } : {}),
  };
  return [
    leaseMutationRule,
    {
      apiGroups: ['coordination.k8s.io'],
      resources: ['leases'],
      verbs: ['create'],
    },
  ];
}

function secretCapabilityPermissions(operator: OperatorDefinition): readonly PermissionRule[] {
  const secretNames = unique(Object.values(operator.capabilities ?? {})
    .flatMap((descriptor) => descriptor.auth?.type === 'secretRef' && descriptor.execution?.liveExecution === 'hostProtocol' ? [descriptor.auth.secretRef.name] : [])
    .filter((name) => name.length > 0));
  if (secretNames.length === 0) {
    return [];
  }
  return [{
    apiGroups: [''],
    resources: ['secrets'],
    verbs: ['get'],
    resourceNames: secretNames,
  }];
}

function payloadSchemaDigests(payloadSchemas: Record<string, unknown>): RuntimePayloadSchemaDigests {
  return {
    handlerInput: digestJson(payloadSchemas.handlerInput),
    normalizedOperationPlan: digestJson(payloadSchemas.normalizedOperationPlan),
    operatorManifest: digestJson(payloadSchemas.operatorManifest),
    handlerError: digestJson(payloadSchemas.handlerError),
    capabilityRequest: digestJson(payloadSchemas.capabilityRequest),
    capabilityResponse: digestJson(payloadSchemas.capabilityResponse),
  };
}

function unique<T>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
}

function digestJson(value: unknown): string {
  return digestText(stableJson(value));
}

function digestText(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(',')}}`;
}
