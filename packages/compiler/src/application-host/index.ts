// typecast-file-boundary: Compiler lowering converts validated normalized graph nodes into Kubernetes resource records at this emission boundary.
import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  type ApplicationGraph,
  type ApplicationProviderNode,
  type JsonObject,
  normalizeApplicationGraph,
} from '@applik8s/core';
import { applicationGraphNumberValue, applicationGraphStringValue } from '../application-installation-values.js';
import { applicationObjectStorageEnvironment } from '../application-object-storage-environment.js';

export interface GeneratedApplicationHostResource {
  readonly apiVersion: string;
  readonly kind: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly spec?: Readonly<Record<string, unknown>>;
  readonly data?: Readonly<Record<string, string>>;
  readonly binaryData?: Readonly<Record<string, string>>;
  readonly rules?: readonly Readonly<Record<string, unknown>>[];
  readonly roleRef?: Readonly<Record<string, unknown>>;
  readonly subjects?: readonly Readonly<Record<string, unknown>>[];
}

export interface ApplicationWebArtifactManifest {
  readonly apiVersion: 'applik8s.webArtifact/v1alpha1';
  readonly application: string;
  readonly output: string;
  readonly target: 'browser' | 'server';
  readonly digest: string;
  readonly entrypoint?: string;
  readonly artifacts: readonly { readonly path: string; readonly bytes: number; readonly digest: string }[];
}

/**
 * A successful Vite/Start server build is itself the user's request to run
 * that web application. Preserve the authored graph while contributing the
 * compiler-owned host provider only when no advanced host was selected.
 */
export async function applicationGraphWithInferredApplicationHost(
  graph: ApplicationGraph,
  entrypoint: string,
): Promise<ApplicationGraph> {
  if (
    graph.nodes.some(
      (node) =>
        node.kind === 'provider'
        && node.interface === 'ApplicationHost',
    )
  ) {
    return graph;
  }
  const manifestPath = await findStartArtifactManifest(
    dirname(resolve(entrypoint)),
  );
  if (!manifestPath) return graph;
  const manifest = validateWebArtifactManifest(
    JSON.parse(await readFile(manifestPath, 'utf8')),
  );
  if (manifest.target !== 'server' || !manifest.entrypoint) {
    throw new Error(
      'Inferred ApplicationHost requires the executable server artifact emitted by the Applik8s Vite adapter.',
    );
  }
  const name = `${graph.metadata.name}-app`;
  const provider: ApplicationProviderNode<'ApplicationHost'> = {
    id: 'provider.ApplicationHost',
    kind: 'provider',
    name: 'ApplicationHost',
    stability: 'stable',
    interface: 'ApplicationHost',
    implementation: 'kubernetes-application-host',
    config: {
      host: {
        kind: 'kubernetes-application-host',
        name,
        namespace: graph.metadata.namespace ?? 'default',
        replicas: 1,
        port: 3000,
      },
    },
  };
  return normalizeApplicationGraph({
    ...graph,
    nodes: [...graph.nodes, provider],
  });
}

export async function emitGeneratedApplicationHost(options: {
  readonly graph: ApplicationGraph;
  readonly entrypoint: string;
  readonly outDir: string;
}): Promise<readonly GeneratedApplicationHostResource[]> {
  const host = options.graph.nodes.find(
    (node): node is ApplicationProviderNode => node.kind === 'provider' && node.interface === 'ApplicationHost',
  );
  if (!host) return [];
  const config = objectValue(host.config?.host);
  if (stringValue(config.kind) !== 'kubernetes-application-host') {
    throw new Error(`ApplicationHost provider ${host.id} uses unsupported implementation ${JSON.stringify(config.kind)}.`);
  }
  const manifestPath = await findStartArtifactManifest(dirname(resolve(options.entrypoint)));
  if (!manifestPath) {
    throw new Error('ApplicationHost requires a Vite web artifact manifest. Run the browser/server build with the Applik8s Vite adapter before compiling the application graph.');
  }
  const manifest = validateWebArtifactManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
  if (manifest.target !== 'server' || !manifest.entrypoint) {
    throw new Error('ApplicationHost requires the server Start build artifact manifest with an executable entrypoint.');
  }
  const name = stringValue(config.name) ?? `${options.graph.metadata.name}-web`;
  const namespace = applicationGraphStringValue(config.namespace) ?? applicationGraphStringValue(options.graph.metadata.namespace) ?? 'default';
  assertApplicationHostKubernetesNamespaces(options.graph, namespace);
  const port = positiveInteger(config.port) ?? 3000;
  const replicas = applicationGraphNumberValue(config.replicas) ?? 1;
  const serviceAccountName = stringValue(config.serviceAccountName) ?? name;
  const image = stringValue(config.image) ?? `applik8s.local/${name}:sha256-${manifest.digest.slice('sha256:'.length, 'sha256:'.length + 16)}`;
  const imagePullPolicy = stringValue(config.imagePullPolicy) ?? (config.image ? 'IfNotPresent' : 'Never');
  const cursorSecret = objectValue(config.cursorSecret);
  const sharedGatewayCursor = applicationSharedGatewayCursorSecret(options.graph, namespace);
  const cursorSecretName = stringValue(cursorSecret.name) ?? sharedGatewayCursor?.name ?? `${name}-gateway-cursor`;
  const cursorSecretKey = stringValue(cursorSecret.key) ?? sharedGatewayCursor?.key ?? 'key';
  const labels = {
    'app.kubernetes.io/name': name,
    'app.kubernetes.io/component': 'application-host',
    'applik8s.dev/graph': options.graph.metadata.name,
  };
  const resources = objectValue(config.resources);
  const resourceRequirements = {
    requests: { cpu: '100m', memory: '128Mi', ...objectValue(resources.requests) },
    limits: { memory: '256Mi', ...objectValue(resources.limits) },
  };
  const objectStorageEnvironment = options.graph.nodes.some(
    (node) => node.kind === 'objectStore',
  )
    ? applicationObjectStorageEnvironment(
        options.graph,
        namespace,
        'ApplicationHost browser object intents',
      )
    : [];
  const identityDatabaseEnvironment =
    applicationHostIdentityDatabaseEnvironment(options.graph, namespace);
  const internalOperationEnvironment = applicationHostInternalOperationEnvironment(
    options.graph,
    namespace,
  );
  const artifactRoot = resolve(applicationArtifactRoot(manifestPath), manifest.output);
  const contextRoot = resolve(options.outDir, 'context');
  await rm(contextRoot, { recursive: true, force: true });
  await mkdir(contextRoot, { recursive: true });
  await Promise.all(manifest.artifacts.map(async (artifact) => {
    const source = resolve(artifactRoot, artifact.path);
    const content = await readFile(source);
    const actual = createArtifactDigest(content);
    if (actual !== artifact.digest) throw new Error(`ApplicationHost artifact ${artifact.path} digest does not match its Vite manifest.`);
    const target = resolve(contextRoot, artifact.path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
  }));
  await writeFile(resolve(options.outDir, 'Dockerfile.applik8s-host'), [
    'FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2',
    'WORKDIR /app',
    'COPY --chown=node:node context/ /app/',
    'USER node',
    `EXPOSE ${port}`,
    `CMD ["node", ${JSON.stringify(`/app/${manifest.entrypoint}`)}]`,
    '',
  ].join('\n'));
  await writeFile(resolve(options.outDir, 'application-host.json'), `${JSON.stringify({
    apiVersion: 'applik8s.applicationHost/v1alpha1',
    kind: 'ApplicationHostArtifact',
    metadata: { name },
    spec: {
      application: options.graph.metadata.name,
      namespace,
      image,
      imagePullPolicy,
      artifactDigest: manifest.digest,
      dockerfile: 'Dockerfile.applik8s-host',
      context: '.',
      cursorSecret: { name: cursorSecretName, key: cursorSecretKey },
    },
  }, null, 2)}\n`);
  const clusterScopedRbac = requiresClusterScopedHostRbac(options.graph);
  if (clusterScopedRbac && namespace.startsWith('${')) {
    throw new Error('An installation-scoped ApplicationHost cannot own fixed-name cluster RBAC. Move cluster-scoped Kubernetes access into a separately owned shared gateway.');
  }
  const roleKind = clusterScopedRbac ? 'ClusterRole' : 'Role';
  const bindingKind = clusterScopedRbac ? 'ClusterRoleBinding' : 'RoleBinding';
  const emitted: GeneratedApplicationHostResource[] = [
    {
      apiVersion: 'v1',
      kind: 'ServiceAccount',
      metadata: { name: serviceAccountName, namespace, labels },
    },
    {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: roleKind,
      metadata: { name: serviceAccountName, ...(clusterScopedRbac ? {} : { namespace }), labels },
      rules: applicationHostRules(options.graph),
    },
    {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: bindingKind,
      metadata: { name: serviceAccountName, ...(clusterScopedRbac ? {} : { namespace }), labels },
      roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: roleKind, name: serviceAccountName },
      subjects: [{ kind: 'ServiceAccount', name: serviceAccountName, namespace }],
    },
    {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name, namespace, labels, annotations: { 'applik8s.dev/web-artifact-digest': manifest.digest } },
      spec: {
        replicas,
        selector: { matchLabels: labels },
        strategy: { type: 'RollingUpdate', rollingUpdate: { maxUnavailable: 1, maxSurge: 0 } },
        template: {
          metadata: { labels, annotations: { 'applik8s.dev/web-artifact-digest': manifest.digest } },
          spec: {
            serviceAccountName,
            terminationGracePeriodSeconds: 30,
            containers: [{
              name: 'application',
              image,
              imagePullPolicy,
              command: ['node', `/app/${manifest.entrypoint}`],
              env: [
                { name: 'PORT', value: String(port) },
                { name: 'APPLIK8S_APPLICATION_NAME', value: options.graph.metadata.name },
                { name: 'APPLIK8S_NAMESPACE', value: namespace },
                { name: 'APPLIK8S_WEB_ARTIFACT_DIGEST', value: manifest.digest },
                { name: 'APPLIK8S_CURSOR_SECRET', valueFrom: { secretKeyRef: { name: cursorSecretName, key: cursorSecretKey } } },
                ...internalOperationEnvironment,
                ...identityDatabaseEnvironment,
                ...objectStorageEnvironment,
              ],
              ports: [{ name: 'http', containerPort: port }],
              startupProbe: { httpGet: { path: '/__applik8s/v1/healthz', port: 'http' }, periodSeconds: 2, failureThreshold: 30 },
              readinessProbe: { httpGet: { path: '/__applik8s/v1/readyz', port: 'http' }, periodSeconds: 5, failureThreshold: 6 },
              livenessProbe: { httpGet: { path: '/__applik8s/v1/healthz', port: 'http' }, periodSeconds: 10, failureThreshold: 6 },
              resources: resourceRequirements,
            }],
          },
        },
      },
    },
    {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        name,
        namespace,
        labels,
      },
      spec: {
        selector: labels,
        ports: [{ name: 'http', port, targetPort: 'http' }],
      },
    },
    {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'NetworkPolicy',
      metadata: { name, namespace, labels },
      spec: { podSelector: { matchLabels: labels }, policyTypes: ['Ingress'], ingress: [{ ports: [{ protocol: 'TCP', port }] }] },
    },
  ];
  if (typeof replicas === 'number' && replicas > 1) {
    emitted.push({
      apiVersion: 'policy/v1',
      kind: 'PodDisruptionBudget',
      metadata: { name, namespace, labels },
      spec: { minAvailable: 1, selector: { matchLabels: labels } },
    });
  }
  return emitted;
}

function applicationHostIdentityDatabaseEnvironment(
  graph: ApplicationGraph,
  hostNamespace: string,
): readonly Readonly<Record<string, unknown>>[] {
  const providerIds = new Set<string>();
  for (const node of graph.nodes) {
    if (node.kind !== 'provider' || node.interface !== 'IdentityProvider') {
      continue;
    }
    const runtime = objectValue(node.config?.identityRuntime);
    const database = objectValue(runtime.databaseProvider);
    const nodeId = stringValue(database.nodeId);
    if (nodeId) providerIds.add(nodeId);
  }
  if (providerIds.size === 0) return [];
  if (providerIds.size !== 1) {
    throw new Error(
      `ApplicationHost identity admission resolves ${providerIds.size} TransactionalDatabase dependencies; exactly one is required.`,
    );
  }
  const providerId = [...providerIds][0]!;
  const consumerIds = new Set(
    graph.providerRequirements
      .filter(
        (requirement) =>
          requirement.interface === 'TransactionalDatabase'
          && requirement.provider?.nodeId === providerId,
      )
      .map((requirement) => requirement.consumer.nodeId),
  );
  const runtimes = new Map<
    string,
    {
      readonly connectionEnvName: string;
      readonly secretName: string;
      readonly secretNamespace?: string;
      readonly secretKey: string;
    }
  >();
  for (const node of graph.nodes) {
    if (node.kind !== 'model' || !consumerIds.has(node.id) || !node.runtime) {
      continue;
    }
    const runtime = node.runtime;
    const current = {
      connectionEnvName: runtime.connectionEnvName,
      secretName: runtime.secretName,
      ...(runtime.secretNamespace
        ? { secretNamespace: runtime.secretNamespace }
        : {}),
      secretKey: runtime.secretKey,
    };
    const previous = runtimes.get(current.connectionEnvName);
    if (previous && JSON.stringify(previous) !== JSON.stringify(current)) {
      throw new Error(
        `ApplicationHost identity admission resolves incompatible database bindings for ${current.connectionEnvName}.`,
      );
    }
    runtimes.set(current.connectionEnvName, current);
  }
  if (runtimes.size === 0) {
    throw new Error(
      `ApplicationHost identity admission depends on ${providerId}, but no bound model exposes its runtime connection.`,
    );
  }
  return [...runtimes.values()]
    .sort((left, right) =>
      left.connectionEnvName.localeCompare(right.connectionEnvName))
    .map((runtime) => {
      const secretNamespace = runtime.secretNamespace ?? hostNamespace;
      if (secretNamespace !== hostNamespace) {
        throw new Error(
          `ApplicationHost identity admission Secret ${runtime.secretName} is in ${secretNamespace}, but the host runs in ${hostNamespace}.`,
        );
      }
      return {
        name: runtime.connectionEnvName,
        valueFrom: {
          secretKeyRef: {
            name: runtime.secretName,
            key: runtime.secretKey,
            optional: false,
          },
        },
      };
    });
}

function applicationHostInternalOperationEnvironment(
  graph: ApplicationGraph,
  hostNamespace: string,
): readonly Readonly<Record<string, unknown>>[] {
  const needsInternalOperations = graph.nodes.some(
    (node) => node.kind === 'aiAgent' || node.kind === 'mcpServer',
  );
  if (!needsInternalOperations) return [];
  const applicationNamespace = applicationGraphStringValue(graph.metadata.namespace) ?? 'default';
  if (applicationNamespace !== hostNamespace) {
    throw new Error(
      `ApplicationHost internal operations use namespace ${applicationNamespace}, but the host is deployed to ${hostNamespace}. Keep the host with its application or move internal operations behind an explicit gateway.`,
    );
  }
  return [{
    name: 'APPLIK8S_INTERNAL_OPERATION_SECRET',
    valueFrom: {
      secretKeyRef: {
        name: `${graph.metadata.name}-internal-operation`,
        key: 'key',
      },
    },
  }];
}

/**
 * Browser runtime operations can issue evidence (for example an object-upload
 * completion receipt) that a generated command gateway verifies. When every
 * gateway in the host namespace deliberately shares one signing Secret, make
 * that application authority the host default as well. Explicit host config
 * still wins, and ambiguous gateway authorities are never guessed.
 */
function applicationSharedGatewayCursorSecret(graph: ApplicationGraph, namespace: string): { readonly name: string; readonly key: string } | undefined {
  const candidates = new Map<string, { readonly name: string; readonly key: string }>();
  for (const node of graph.nodes) {
    if (
      node.kind !== 'gateway'
      || (node.materialization !== 'generatedDeployment'
        && node.materialization !== 'runtimeOnly')
      || !node.deployment
      || !node.cursorSecret
    ) continue;
    // Internal placement/tool receivers are separate workload authorities,
    // not browser context authorities. Counting them makes a host with one
    // public gateway appear ambiguous and gives agent invocations a different
    // durable principal scope from browser queries.
    if (node.visibility === 'internal') continue;
    const gatewayNamespace = applicationGraphStringValue(node.cursorSecret.namespace ?? node.deployment.namespace);
    const name = applicationGraphStringValue(node.cursorSecret.name);
    const key = applicationGraphStringValue(node.cursorSecret.key);
    if (gatewayNamespace !== namespace || !name || !key) continue;
    candidates.set(`${name}\0${key}`, { name, key });
  }
  return candidates.size === 1 ? [...candidates.values()][0] : undefined;
}

function applicationArtifactRoot(manifestPath: string): string {
  const manifestDirectory = dirname(manifestPath);
  return manifestDirectory.endsWith(`${join('.applik8s', 'web-artifacts')}`)
    ? dirname(dirname(manifestDirectory))
    : dirname(manifestDirectory);
}

function applicationHostRules(graph: ApplicationGraph): readonly Readonly<Record<string, unknown>>[] {
  const groups = new Map<string, Map<string, Set<string>>>();
  const remoteQueries = generatedGatewayQueryIds(graph);
  for (const node of graph.nodes) {
    if (node.kind === 'crd' && node.create) addRule(node.resource.apiVersion, node.resource.plural, ['create', 'get']);
    if (node.kind === 'query' && node.kubernetes && !remoteQueries.has(node.id)) addRule(node.kubernetes.resource.apiVersion, node.kubernetes.resource.plural, ['get', 'list', 'watch']);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([group, resources]) => [...resources.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([resource, verbs]) => ({
        apiGroups: [group],
        resources: [resource],
        verbs: [...verbs].sort(),
      })));

  function addRule(apiVersion: string, resource: string, verbs: readonly string[]): void {
    const group = apiVersion.split('/')[0] ?? '';
    const resources = groups.get(group) ?? new Map<string, Set<string>>();
    const resourceVerbs = resources.get(resource) ?? new Set<string>();
    for (const verb of verbs) resourceVerbs.add(verb);
    resources.set(resource, resourceVerbs);
    groups.set(group, resources);
  }
}

function requiresClusterScopedHostRbac(graph: ApplicationGraph): boolean {
  const remoteQueries = generatedGatewayQueryIds(graph);
  return graph.nodes.some((node) =>
    (node.kind === 'crd' && Boolean(node.create) && node.resource.scope === 'Cluster')
    || (node.kind === 'query' && !remoteQueries.has(node.id) && node.kubernetes?.resource.scope === 'Cluster'));
}

function assertApplicationHostKubernetesNamespaces(graph: ApplicationGraph, hostNamespace: string): void {
  const remoteQueries = generatedGatewayQueryIds(graph);
  for (const node of graph.nodes) {
    if (node.kind !== 'query' || !node.kubernetes || remoteQueries.has(node.id) || node.kubernetes.resource.scope !== 'Namespaced') continue;
    const namespace = node.kubernetes.namespace;
    if (namespace && namespace !== hostNamespace) {
      throw new Error(`ApplicationHost query ${node.id} reads namespace ${namespace}, but the host is bounded to ${hostNamespace}. Use a generated gateway for explicit cross-namespace access.`);
    }
  }
}

function generatedGatewayQueryIds(graph: ApplicationGraph): ReadonlySet<string> {
  return new Set(graph.nodes.flatMap((node) => node.kind === 'gateway' && node.materialization === 'generatedDeployment'
    ? node.queries.map((query) => query.nodeId)
    : []));
}

function createArtifactDigest(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

async function findStartArtifactManifest(start: string): Promise<string | undefined> {
  let directory = start;
  while (true) {
    for (const candidate of [
      join(directory, '.applik8s', 'web-artifacts', 'server.json'),
      join(directory, '.applik8s', 'web-artifact.json'),
    ]) {
      if (await access(candidate).then(() => true).catch(() => false)) return candidate;
    }
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function validateWebArtifactManifest(value: unknown): ApplicationWebArtifactManifest {
  if (!value || typeof value !== 'object') throw new Error('Applik8s web artifact manifest must be an object.');
  if (Reflect.get(value, 'apiVersion') !== 'applik8s.webArtifact/v1alpha1') throw new Error('Applik8s web artifact manifest has an unsupported apiVersion.');
  const digest = Reflect.get(value, 'digest');
  if (typeof digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error('Applik8s web artifact manifest has an invalid digest.');
  const target = Reflect.get(value, 'target');
  if (target !== 'browser' && target !== 'server') throw new Error('Applik8s web artifact manifest has an invalid target.');
  // typecast: the preceding structural and discriminant checks establish the manifest contract consumed below.
  return value as ApplicationWebArtifactManifest;
}

function objectValue(value: unknown): JsonObject {
  // typecast: the object/array guard narrows provider configuration to the JSON-object surface used by graph lowering.
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}
