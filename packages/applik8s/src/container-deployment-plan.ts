// typecast-file-boundary: normalized graph/workload metadata is discriminator-checked before conversion into an immutable deployment plan.
import { createHash } from 'node:crypto';
import type { ApplicationGraph, ApplicationProviderNode } from '@applik8s/core';

import type {
  ApplicationContainerRegistryEndpoint,
  ApplicationContainerRegistryProvider,
  ApplicationContainerRegistrySecretRef,
} from './application-providers.js';
import { canonicalApplicationContainerRegistryOrigin, isApplicationContainerRegistryProvider } from './application-providers.js';

export interface ResolvedApplicationContainerRegistry {
  readonly provider: ApplicationContainerRegistryProvider;
  /** Endpoint used by the deployment client and image builder to publish and verify artifacts. */
  readonly origin?: string;
  /** Endpoint embedded in Kubernetes workloads; differs for local NodePort topologies. */
  readonly pullOrigin?: string;
  /** Installation-derived prefix retained in generated workload image references. */
  readonly deploymentRepositoryPrefix?: string;
  readonly repositoryPrefix?: string;
  readonly remote: boolean;
  readonly pullSecretName?: string;
  readonly pullSecret?: ApplicationContainerRegistrySecretRef;
}

export interface ApplicationImageReceipt {
  readonly logicalImage: string;
  /** Digest reference embedded in the deployed workload (the node-visible origin). */
  readonly immutableImage: string;
  /** Digest reference used as a base image by the publisher when it differs from immutableImage. */
  readonly publishedImage?: string;
  readonly taggedImage: string;
  readonly digest?: string;
  readonly pushed: boolean;
  /** Whether this deployment built the artifact or reused an already verified immutable registry tag. */
  readonly publication?: 'built' | 'reused';
  readonly sourceDigest?: string;
  readonly platforms?: readonly string[];
  readonly artifact?: {
    readonly class: 'operator-host' | 'operator' | 'migration' | 'command-processor' | 'workflow-worker' | 'reactive-worker' | 'application-host';
    readonly name: string;
  };
}

export interface ApplicationImageEvidence {
  readonly apiVersion: 'applik8s.deployment/v1alpha1';
  readonly kind: 'ApplicationImageEvidence';
  readonly applicationGraph: { readonly path: string; readonly digest: string };
  readonly registry: {
    readonly kind: ApplicationContainerRegistryProvider['kind'];
    readonly remote: boolean;
    readonly origin?: string;
    readonly pullOrigin?: string;
    readonly repositoryPrefix?: string;
    readonly deploymentRepositoryPrefix?: string;
  };
  readonly artifactSetDigest: string;
  readonly images: readonly ApplicationImageReceipt[];
}

/** Resolve the one registry deployment binding recorded by app.provide(ContainerRegistry, ...). */
export function applicationContainerRegistryFromGraph(
  graph: ApplicationGraph,
): ApplicationContainerRegistryProvider {
  const candidates = graph.nodes.filter(
    (node): node is ApplicationProviderNode<'ContainerRegistry'> =>
      node.kind === 'provider' && node.interface === 'ContainerRegistry',
  );
  if (candidates.length === 0) return { kind: 'orbstack-container-registry' };
  if (candidates.length > 1) {
    throw new Error('ApplicationGraph declares more than one ContainerRegistry provider.');
  }
  const provider = candidates[0]?.config?.containerRegistry;
  if (!isApplicationContainerRegistryProvider(provider)) {
    throw new Error('ApplicationGraph ContainerRegistry provider is missing its validated deployment contract.');
  }
  return provider;
}

export async function resolveApplicationContainerRegistry(
  provider: ApplicationContainerRegistryProvider,
  resolveNodePort: (
    endpoint: Extract<ApplicationContainerRegistryEndpoint, { readonly kind: 'kubernetes-node-port' }>,
  ) => Promise<string>,
): Promise<ResolvedApplicationContainerRegistry> {
  if (provider.kind === 'orbstack-container-registry') {
    return { provider, remote: false };
  }
  const resolvedOrigin = provider.endpoint.kind === 'origin'
    ? provider.endpoint.origin
    : await resolveNodePort(provider.endpoint);
  const origin = canonicalApplicationContainerRegistryOrigin(resolvedOrigin);
  const pullOrigin = canonicalApplicationContainerRegistryOrigin(
    provider.endpoint.kind === 'kubernetes-node-port' && provider.endpoint.pullHost
      ? `${provider.endpoint.protocol}://${provider.endpoint.pullHost}:${provider.endpoint.port}`
      : origin,
  );
  const pullSecretName = provider.pullSecret?.name;
  return {
    provider,
    origin,
    pullOrigin,
    remote: true,
    ...(provider.kind === 'harbor-container-registry'
      ? { repositoryPrefix: provider.project }
      : provider.repositoryPrefix
        ? { repositoryPrefix: provider.repositoryPrefix }
        : {}),
    ...(pullSecretName ? { pullSecretName } : {}),
    ...(provider.pullSecret ? { pullSecret: provider.pullSecret } : {}),
  };
}

/**
 * Replace compiler-logical image references with verified immutable results and add the selected
 * pull Secret only to Pod specs that actually consume one of those authored images.
 */
export function materializeApplicationImages<T>(
  value: T,
  receipts: readonly ApplicationImageReceipt[],
  pullSecretName?: string,
  repositoryProjection?: {
    readonly published: string;
    readonly deployment: string;
  },
): T {
  const replacements = new Map(receipts.map((receipt) => [
    receipt.logicalImage,
    repositoryProjection
      ? projectApplicationImageRepository(receipt.immutableImage, repositoryProjection)
      : receipt.immutableImage,
  ]));
  return materializeValue(value, replacements, pullSecretName) as T;
}

/** Fail closed before apply when a remote publication is not complete and digest-addressed. */
export function validateApplicationImageReceipts(
  receipts: readonly ApplicationImageReceipt[],
  remote: boolean,
): void {
  if (receipts.length === 0) {
    throw new Error('Application image publication produced no receipts for the generated workloads.');
  }
  const logicalImages = new Set<string>();
  for (const receipt of receipts) {
    if (!receipt.logicalImage.trim() || !receipt.immutableImage.trim() || !receipt.taggedImage.trim()) {
      throw new Error('Application image receipts require non-empty logical, immutable, and tagged image references.');
    }
    if (logicalImages.has(receipt.logicalImage)) {
      throw new Error(`Application image publication produced duplicate receipts for ${receipt.logicalImage}.`);
    }
    logicalImages.add(receipt.logicalImage);
    if (remote && (!receipt.pushed || !/^sha256:[a-f0-9]{64}$/.test(receipt.digest ?? '') || !/@sha256:[a-f0-9]{64}$/.test(receipt.immutableImage) || (receipt.publishedImage !== undefined && !/@sha256:[a-f0-9]{64}$/.test(receipt.publishedImage)))) {
      throw new Error(`Remote application image ${receipt.logicalImage} is not a pushed, registry-verified immutable digest.`);
    }
  }
}

/**
 * Stable digest covering exactly the immutable artifacts selected for one deployment.
 *
 * `logicalImage` is a compiler-local replacement key, not published artifact identity. In
 * particular, ComponentizeJS may emit byte-distinct but semantically equivalent components;
 * generated operator source identity deliberately normalizes those bytes and therefore maps
 * successive logical aliases to the same content-tagged OCI artifact. Keep that transient alias
 * in the evidence receipt for materialization diagnostics, but do not let it make an unchanged
 * immutable artifact set appear different.
 */
export function applicationImageSetDigest(receipts: readonly ApplicationImageReceipt[]): string {
  validateApplicationImageReceipts(receipts, receipts.some((receipt) => receipt.pushed));
  const canonical = [...receipts]
    .map((receipt) => ({
      immutableImage: receipt.immutableImage,
      publishedImage: receipt.publishedImage ?? null,
      taggedImage: receipt.taggedImage,
      digest: receipt.digest ?? null,
      sourceDigest: receipt.sourceDigest ?? null,
      artifact: receipt.artifact ?? null,
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return `sha256:${createHash('sha256').update(JSON.stringify(canonical)).digest('hex')}`;
}

export function applicationImageEvidence(
  graph: { readonly path: string; readonly digest: string },
  registry: ResolvedApplicationContainerRegistry,
  receipts: readonly ApplicationImageReceipt[],
): ApplicationImageEvidence {
  validateApplicationImageReceipts(receipts, registry.remote);
  return {
    apiVersion: 'applik8s.deployment/v1alpha1',
    kind: 'ApplicationImageEvidence',
    applicationGraph: graph,
    registry: {
      kind: registry.provider.kind,
      remote: registry.remote,
      ...(registry.origin ? { origin: registry.origin } : {}),
      ...(registry.pullOrigin && registry.pullOrigin !== registry.origin ? { pullOrigin: registry.pullOrigin } : {}),
      ...(registry.repositoryPrefix ? { repositoryPrefix: registry.repositoryPrefix } : {}),
      ...(registry.deploymentRepositoryPrefix ? { deploymentRepositoryPrefix: registry.deploymentRepositoryPrefix } : {}),
    },
    artifactSetDigest: applicationImageSetDigest(receipts),
    images: [...receipts].sort((left, right) => left.logicalImage.localeCompare(right.logicalImage)),
  };
}

function projectApplicationImageRepository(
  image: string,
  projection: { readonly published: string; readonly deployment: string },
): string {
  if (!projection.published || !projection.deployment) {
    throw new Error('Application image repository projection requires non-empty published and deployment prefixes.');
  }
  const separator = image.indexOf('/');
  const publishedPrefix = `${projection.published}/`;
  if (separator < 1 || !image.slice(separator + 1).startsWith(publishedPrefix)) {
    throw new Error(`Verified application image ${image} is not beneath published repository prefix ${projection.published}.`);
  }
  return `${image.slice(0, separator + 1)}${projection.deployment}/${image.slice(separator + 1 + publishedPrefix.length)}`;
}

/**
 * A Kubernetes pull Secret is namespace-scoped. Prove that every concrete
 * authored workload receiving it lives in that same namespace; computed
 * namespaces fail closed until the planner has an explicit projection for
 * each resolved instance namespace.
 */
export function validateApplicationPullSecretCoverage(
  value: unknown,
  receipts: readonly ApplicationImageReceipt[],
  pullSecret: ApplicationContainerRegistrySecretRef,
): readonly string[] {
  const logicalImages = new Set(receipts.map((receipt) => receipt.logicalImage));
  const namespaces = new Set<string>();
  collectAuthoredWorkloadNamespaces(value, logicalImages, namespaces);
  for (const namespace of namespaces) {
    if (namespace.includes('${')) {
      throw new Error(`Authored workloads use computed namespace ${namespace}, but ContainerRegistry pull Secret ${pullSecret.namespace}/${pullSecret.name} has no concrete namespace projection.`);
    }
    if (namespace !== pullSecret.namespace) {
      throw new Error(`Authored workload namespace ${namespace} cannot use ContainerRegistry pull Secret ${pullSecret.namespace}/${pullSecret.name}. Project a least-privilege pull Secret into every consuming namespace.`);
    }
  }
  return [...namespaces].sort();
}

const applicationWorkloadKinds = new Set(['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob', 'Pod']);

function collectAuthoredWorkloadNamespaces(
  value: unknown,
  logicalImages: ReadonlySet<string>,
  namespaces: Set<string>,
): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectAuthoredWorkloadNamespaces(entry, logicalImages, namespaces);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const resource = value as Readonly<Record<string, unknown>>;
  if (typeof resource.kind === 'string' && applicationWorkloadKinds.has(resource.kind) && objectContainsLogicalImage(resource, logicalImages)) {
    const metadata = resource.metadata;
    const namespace = metadata && typeof metadata === 'object' ? Reflect.get(metadata, 'namespace') : undefined;
    namespaces.add(typeof namespace === 'string' && namespace.trim() ? namespace : 'default');
  }
  for (const entry of Object.values(resource)) collectAuthoredWorkloadNamespaces(entry, logicalImages, namespaces);
}

function objectContainsLogicalImage(value: unknown, logicalImages: ReadonlySet<string>): boolean {
  if (typeof value === 'string') return logicalImages.has(value);
  if (Array.isArray(value)) return value.some((entry) => objectContainsLogicalImage(entry, logicalImages));
  return Boolean(value && typeof value === 'object' && Object.values(value).some((entry) => objectContainsLogicalImage(entry, logicalImages)));
}

function materializeValue(
  value: unknown,
  replacements: ReadonlyMap<string, string>,
  pullSecretName: string | undefined,
): unknown {
  if (typeof value === 'string') return replacements.get(value) ?? value;
  if (Array.isArray(value)) {
    return value.map((entry) => materializeValue(entry, replacements, pullSecretName));
  }
  if (!value || typeof value !== 'object') return value;

  const source = value as Readonly<Record<string, unknown>>;
  const result = Object.fromEntries(
    Object.entries(source).map(([key, entry]) => [key, materializeValue(entry, replacements, pullSecretName)]),
  );
  if (
    typeof source.image === 'string'
    && replacements.has(source.image)
    && source.imagePullPolicy === 'Never'
  ) {
    result.imagePullPolicy = 'IfNotPresent';
  }
  if (pullSecretName && podSpecConsumesMaterializedImage(source, replacements)) {
    const current = Array.isArray(result.imagePullSecrets)
      ? result.imagePullSecrets.filter(isNamedSecretReference)
      : [];
    if (!current.some((reference) => reference.name === pullSecretName)) {
      result.imagePullSecrets = [...current, { name: pullSecretName }];
    }
  }
  return result;
}

function podSpecConsumesMaterializedImage(
  value: Readonly<Record<string, unknown>>,
  replacements: ReadonlyMap<string, string>,
): boolean {
  const containers = [
    ...(Array.isArray(value.containers) ? value.containers : []),
    ...(Array.isArray(value.initContainers) ? value.initContainers : []),
  ];
  return containers.some((container) => {
    if (!container || typeof container !== 'object') return false;
    const image = Reflect.get(container, 'image');
    return typeof image === 'string' && replacements.has(image);
  });
}

function isNamedSecretReference(value: unknown): value is { readonly name: string } {
  return Boolean(value && typeof value === 'object' && typeof Reflect.get(value, 'name') === 'string');
}
