// typecast-file-boundary: Runtime JSON, Kubernetes Secret data, dynamic composition exports, and Alchemy outputs are discriminator-checked before typed deployment use.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createApplicationAlchemyGraphDeployment,
  type ApplicationAlchemyDeployment,
} from '@applik8s/deployment-alchemy';
import type {
  ApplicationContainerArtifactProviderOptions,
  ApplicationContainerArtifactRegistry,
} from '@applik8s/deployment-provider-oci';
import {
  decodeApplicationDeploymentGraph,
  type ApplicationDeploymentGraph,
} from '@applik8s/deployment-contract';
import type { ApplicationTypeKroCompositionSource } from '@applik8s/deployment-typekro';
import type { KroCompatibleType } from 'typekro';
import type {
  ApplicationContainerRegistryCredentialSecret,
  ApplicationContainerRegistryProvider,
  ResolvedApplicationContainerRegistry,
} from '@applik8s/applik8s/deployment-registry';
import { APPLICATION_DEPLOYMENT_TIMEOUT_MS } from './application-deployment-timeouts.js';
import {
  applicationDevelopmentAspects,
  applicationDevelopmentGraph,
} from './application-development-aspect.js';
import { makeKubernetesApiClient } from './kubernetes-api-client.js';

interface KubernetesSecretCredentialBinding {
  readonly version: 1;
  readonly kind: 'kubernetesSecretRegistryCredential';
  readonly context: string;
  readonly registry: string;
  readonly secret: ApplicationContainerRegistryCredentialSecret;
}

export interface GeneratedApplicationAlchemyDeploymentOptions<
  TSpec extends KroCompatibleType,
  TStatus extends KroCompatibleType,
> {
  readonly graphPath: string;
  readonly source: ApplicationTypeKroCompositionSource<TSpec, TStatus>;
  readonly spec: TSpec;
  readonly context: string;
  readonly registry: ResolvedApplicationContainerRegistry;
  readonly projectRoot: string;
  readonly owner?: string;
  /** One-deployment TypeKro schema-migration acknowledgement. */
  readonly allowBreakingChanges?: boolean;
  /** Mount a closed source allowlist into the graph-owned ApplicationHost. */
  readonly development?: boolean;
}

/**
 * CLI boundary for the portable deployment graph. Kubernetes credentials and
 * registry credentials are rebound in the operation host; neither is copied
 * into the graph or Alchemy state.
 */
export async function createGeneratedApplicationAlchemyDeployment<
  TSpec extends KroCompatibleType,
  TStatus extends KroCompatibleType,
>(
  options: GeneratedApplicationAlchemyDeploymentOptions<TSpec, TStatus>,
): Promise<ApplicationAlchemyDeployment> {
  const compiledGraph = await readApplicationDeploymentGraph(options.graphPath);
  assertDeploymentConnection(compiledGraph, options.context);
  const graph = options.development
    ? applicationDevelopmentGraph(compiledGraph)
    : compiledGraph;
  // static-import-exception: the Bun CLI loads the Node Kubernetes client only after entering deployment execution.
  const kubernetes = await import('@kubernetes/client-node');
  const kubeConfig = new kubernetes.KubeConfig();
  kubeConfig.loadFromDefault();
  kubeConfig.setCurrentContext(options.context);
  // Resolve eagerly so an unknown context fails before Alchemy creates state.
  if (!kubeConfig.getCurrentCluster() || !kubeConfig.getCurrentUser()) {
    throw new Error(`Kubernetes context ${options.context} does not resolve a cluster and user.`);
  }
  const artifactRegistry = applicationAlchemyArtifactRegistry(
    options.registry,
    options.context,
  );
  const developmentAspects = options.development
    ? await applicationDevelopmentAspects(graph, options.projectRoot)
    : undefined;
  return createApplicationAlchemyGraphDeployment({
    graph,
    source: options.source,
    spec: options.spec,
    stateRoot: resolve(options.projectRoot, '.applik8s', 'state', 'alchemy'),
    // The Alchemy stage is the stable installation lifecycle. Profile changes
    // are planned inside that same state graph rather than creating an
    // unrelated stack that cannot diff or migrate the prior provider.
    stage: 'installation',
    owner: options.owner ?? `applik8s-cli:${process.pid}`,
    artifactRegistry,
    artifactProvider: applicationAlchemyArtifactProvider(),
    harborProvider: {
      resolveCredential: (reference, context) =>
        resolveKubernetesSecretCredential({
          version: 1,
          kind: 'kubernetesSecretRegistryCredential',
          context,
          registry: options.registry.origin ?? '',
          secret: reference,
        }),
    },
    factory: {
      namespace: graph.metadata.identity.controlPlaneNamespace,
      kubeConfig,
      alchemyKubeConfig: { source: { kind: 'default' } },
      waitForReady: true,
      timeout: APPLICATION_DEPLOYMENT_TIMEOUT_MS,
      ...(developmentAspects ? { aspects: developmentAspects } : {}),
      ...(options.allowBreakingChanges
        ? { allowBreakingChanges: true }
        : {}),
    },
  });
}

export async function readApplicationDeploymentGraph(
  path: string,
): Promise<ApplicationDeploymentGraph> {
  return decodeApplicationDeploymentGraph(await readFile(path, 'utf8'));
}

export function applicationDeploymentInstallationSpec(
  graph: ApplicationDeploymentGraph,
): Readonly<Record<string, unknown>> {
  const root = graph.nodes.find(
    (node) => node.id === 'kubernetes.application',
  );
  if (root?.kind !== 'kubernetesComposition') {
    throw new Error('Application deployment graph has no kubernetes.application root.');
  }
  const spec = root.spec.installationSpec;
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error('Application deployment graph root has no concrete installationSpec.');
  }
  // typecast: the readonly JSON-array branch is rejected above; deployment
  // typecast: graph decoding already proved every nested value is portable JSON.
  return spec as Readonly<Record<string, unknown>>;
}

export function applicationAlchemyArtifactRegistry(
  resolved: ResolvedApplicationContainerRegistry,
  context: string,
): ApplicationContainerArtifactRegistry {
  if (resolved.provider.kind === 'orbstack-container-registry') {
    return { type: 'orbstack' };
  }
  if (!resolved.origin) {
    throw new Error('Remote ContainerRegistry has no deployment-host publication origin.');
  }
  const provider = resolved.provider;
  const credentialBinding = provider.pushCredentials
    ? encodeKubernetesSecretCredentialBinding({
        version: 1,
        kind: 'kubernetesSecretRegistryCredential',
        context,
        registry: resolved.origin,
        secret: provider.pushCredentials,
      })
    : undefined;
  const tls = applicationAlchemyRegistryTls(provider);
  const deploymentRegistry =
    resolved.pullOrigin && resolved.pullOrigin !== resolved.origin
      ? resolved.pullOrigin
      : undefined;
  if (provider.kind === 'harbor-container-registry') {
    const deploymentProject = concreteRepositoryPrefix(
      resolved.deploymentRepositoryPrefix,
      resolved.repositoryPrefix ?? provider.project,
    );
    return {
      type: 'harbor',
      registry: resolved.origin,
      project: resolved.repositoryPrefix ?? provider.project,
      ...(deploymentRegistry ? { deploymentRegistry } : {}),
      ...(deploymentProject &&
      deploymentProject !== resolved.repositoryPrefix
        ? { deploymentProject }
        : {}),
      ...(credentialBinding ? { credentialBinding } : {}),
      ...(tls ? { tls } : {}),
    };
  }
  return {
    type: 'oci',
    registry: resolved.origin,
    ...(resolved.repositoryPrefix
      ? { repositoryPrefix: resolved.repositoryPrefix }
      : {}),
    ...(deploymentRegistry ? { deploymentRegistry } : {}),
    ...(resolved.deploymentRepositoryPrefix &&
    resolved.deploymentRepositoryPrefix !== resolved.repositoryPrefix
      ? {
          deploymentRepositoryPrefix:
            resolved.deploymentRepositoryPrefix,
        }
      : {}),
    ...(credentialBinding ? { credentialBinding } : {}),
    ...(tls ? { tls } : {}),
  };
}

function concreteRepositoryPrefix(
  value: string | undefined,
  fallback: string | undefined,
): string | undefined {
  if (!value || value.includes('${')) return fallback;
  return value;
}

function applicationAlchemyArtifactProvider(): ApplicationContainerArtifactProviderOptions {
  return {
    resolveCredential: async (encoded) =>
      resolveKubernetesSecretCredential(
        decodeKubernetesSecretCredentialBinding(encoded),
      ),
  };
}

function applicationAlchemyRegistryTls(
  provider: Exclude<
    ApplicationContainerRegistryProvider,
    { readonly kind: 'orbstack-container-registry' }
  >,
): {
  readonly caFile?: string;
  readonly insecure?: boolean;
  readonly plainHttp?: boolean;
} | undefined {
  const plainHttp =
    provider.endpoint.kind === 'kubernetes-node-port'
      ? provider.endpoint.protocol === 'http'
      : provider.endpoint.origin.startsWith('http://');
  const tls = {
    ...(provider.tls?.caFile ? { caFile: provider.tls.caFile } : {}),
    ...(provider.tls?.insecure === true ? { insecure: true } : {}),
    ...(provider.tls?.plainHttp === true || plainHttp
      ? { plainHttp: true }
      : {}),
  };
  return Object.keys(tls).length > 0 ? tls : undefined;
}

function assertDeploymentConnection(
  graph: ApplicationDeploymentGraph,
  context: string,
): void {
  if (
    graph.metadata.identity.connection.provider !== 'kubernetes' ||
    graph.metadata.identity.connection.cluster !== context
  ) {
    throw new Error(
      `Deployment graph targets ${graph.metadata.identity.connection.provider}/${graph.metadata.identity.connection.cluster}, not explicit Kubernetes context ${context}. Recompile the deployment graph for the selected context.`,
    );
  }
}

function encodeKubernetesSecretCredentialBinding(
  binding: KubernetesSecretCredentialBinding,
): string {
  return `kubernetes-secret:${Buffer.from(JSON.stringify(binding), 'utf8').toString('base64url')}`;
}

function decodeKubernetesSecretCredentialBinding(
  value: string,
): KubernetesSecretCredentialBinding {
  const prefix = 'kubernetes-secret:';
  if (!value.startsWith(prefix)) {
    throw new Error(`Unsupported registry credential binding ${value}.`);
  }
  let candidate: unknown;
  try {
    candidate = JSON.parse(
      Buffer.from(value.slice(prefix.length), 'base64url').toString('utf8'),
    );
  } catch (cause) {
    throw new Error('Registry credential binding is not valid encoded JSON.', {
      cause,
    });
  }
  if (
    !candidate ||
    typeof candidate !== 'object' ||
    Reflect.get(candidate, 'version') !== 1 ||
    Reflect.get(candidate, 'kind') !==
      'kubernetesSecretRegistryCredential' ||
    typeof Reflect.get(candidate, 'context') !== 'string' ||
    typeof Reflect.get(candidate, 'registry') !== 'string'
  ) {
    throw new Error('Registry credential binding has an invalid contract.');
  }
  const secret = Reflect.get(candidate, 'secret');
  if (
    !secret ||
    typeof secret !== 'object' ||
    Reflect.get(secret, 'apiVersion') !== 'v1' ||
    Reflect.get(secret, 'kind') !== 'Secret' ||
    typeof Reflect.get(secret, 'namespace') !== 'string' ||
    typeof Reflect.get(secret, 'name') !== 'string'
  ) {
    throw new Error('Registry credential binding has an invalid Secret reference.');
  }
  // typecast: the complete non-secret credential-binding envelope and Secret
  // typecast: discriminator fields are checked above; optional key names are validated at resolution.
  return candidate as KubernetesSecretCredentialBinding;
}

async function resolveKubernetesSecretCredential(
  binding: KubernetesSecretCredentialBinding,
): Promise<{ readonly username: string; readonly password: string }> {
  // static-import-exception: registry credentials are resolved ephemerally only while a remote artifact operation is running.
  const kubernetes = await import('@kubernetes/client-node');
  const kubeConfig = new kubernetes.KubeConfig();
  kubeConfig.loadFromDefault();
  kubeConfig.setCurrentContext(binding.context);
  const value = await makeKubernetesApiClient(
    kubeConfig,
    kubernetes.CoreV1Api,
  ).readNamespacedSecret({
    namespace: binding.secret.namespace,
    name: binding.secret.name,
  });
  const data = value.data ?? {};
  if (binding.secret.dockerConfigJsonKey) {
    const encoded = data[binding.secret.dockerConfigJsonKey];
    if (!encoded) {
      throw new Error(
        `Registry credential Secret ${binding.secret.namespace}/${binding.secret.name} has no ${binding.secret.dockerConfigJsonKey} key.`,
      );
    }
    return credentialFromDockerConfig(
      JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as unknown,
      binding.registry,
    );
  }
  const username = binding.secret.username ?? decodeSecretKey(
    data,
    binding.secret.usernameKey ?? 'username',
    binding.secret,
  );
  const password = decodeSecretKey(
    data,
    binding.secret.passwordKey ?? 'password',
    binding.secret,
  );
  if (!username || !password) {
    throw new Error(
      `Registry credential Secret ${binding.secret.namespace}/${binding.secret.name} resolved an empty username or password.`,
    );
  }
  return { username, password };
}

function decodeSecretKey(
  data: Readonly<Record<string, string>>,
  key: string,
  secret: ApplicationContainerRegistryCredentialSecret,
): string {
  const encoded = data[key];
  if (!encoded) {
    throw new Error(
      `Registry credential Secret ${secret.namespace}/${secret.name} has no ${key} key.`,
    );
  }
  return Buffer.from(encoded, 'base64').toString('utf8');
}

function credentialFromDockerConfig(
  value: unknown,
  registry: string,
): { readonly username: string; readonly password: string } {
  const auths =
    value && typeof value === 'object' ? Reflect.get(value, 'auths') : undefined;
  if (!auths || typeof auths !== 'object') {
    throw new Error('Registry docker config has no auths object.');
  }
  const host = new URL(
    registry.includes('://') ? registry : `https://${registry}`,
  ).host;
  const entries = Object.entries(auths as Readonly<Record<string, unknown>>);
  const match = entries.find(([key]) => {
    try {
      return new URL(key.includes('://') ? key : `https://${key}`).host === host;
    } catch {
      return key === host;
    }
  });
  const credential = match?.[1];
  if (!credential || typeof credential !== 'object') {
    throw new Error(`Registry docker config has no credential for ${host}.`);
  }
  const username = Reflect.get(credential, 'username');
  const password = Reflect.get(credential, 'password');
  if (typeof username === 'string' && typeof password === 'string') {
    return { username, password };
  }
  const auth = Reflect.get(credential, 'auth');
  if (typeof auth === 'string') {
    const decoded = Buffer.from(auth, 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator > 0) {
      return {
        username: decoded.slice(0, separator),
        password: decoded.slice(separator + 1),
      };
    }
  }
  throw new Error(`Registry docker config credential for ${host} is incomplete.`);
}
