import { access, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { ApplicationGraph, ApplicationProviderNode, JsonObject } from '@applik8s/core';

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

export interface ApplicationStartArtifactManifest {
  readonly apiVersion: 'applik8s.startArtifact/v1alpha1';
  readonly application: string;
  readonly output: string;
  readonly target: 'browser' | 'server';
  readonly digest: string;
  readonly entrypoint?: string;
  readonly artifacts: readonly { readonly path: string; readonly bytes: number; readonly digest: string }[];
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
    throw new Error('ApplicationHost requires a Vite Start artifact manifest. Run the Start browser/server builds with applik8sStart() before compiling the application graph.');
  }
  const manifest = validateStartArtifactManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
  if (manifest.target !== 'server' || !manifest.entrypoint) {
    throw new Error('ApplicationHost requires the server Start build artifact manifest with an executable entrypoint.');
  }
  const name = stringValue(config.name) ?? `${options.graph.metadata.name}-web`;
  const namespace = stringValue(config.namespace) ?? options.graph.metadata.namespace ?? 'default';
  const port = positiveInteger(config.port) ?? 3000;
  const replicas = positiveInteger(config.replicas) ?? 1;
  const serviceAccountName = stringValue(config.serviceAccountName) ?? name;
  const image = stringValue(config.image) ?? `applik8s.local/${name}:sha256-${manifest.digest.slice('sha256:'.length, 'sha256:'.length + 16)}`;
  const imagePullPolicy = stringValue(config.imagePullPolicy) ?? (config.image ? 'IfNotPresent' : 'Never');
  const cursorSecret = objectValue(config.cursorSecret);
  const cursorSecretName = stringValue(cursorSecret.name) ?? `${name}-gateway-cursor`;
  const cursorSecretKey = stringValue(cursorSecret.key) ?? 'key';
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
  const artifactRoot = resolve(dirname(dirname(manifestPath)), manifest.output);
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
      metadata: { name, namespace, labels, annotations: { 'applik8s.dev/start-artifact-digest': manifest.digest } },
      spec: {
        replicas,
        selector: { matchLabels: labels },
        strategy: { type: 'RollingUpdate', rollingUpdate: { maxUnavailable: 0, maxSurge: 1 } },
        template: {
          metadata: { labels, annotations: { 'applik8s.dev/start-artifact-digest': manifest.digest } },
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
                { name: 'APPLIK8S_NAMESPACE', value: namespace },
                { name: 'APPLIK8S_START_ARTIFACT_DIGEST', value: manifest.digest },
                { name: 'APPLIK8S_CURSOR_SECRET', valueFrom: { secretKeyRef: { name: cursorSecretName, key: cursorSecretKey } } },
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
      metadata: { name, namespace, labels },
      spec: { selector: labels, ports: [{ name: 'http', port, targetPort: 'http' }] },
    },
    {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'NetworkPolicy',
      metadata: { name, namespace, labels },
      spec: { podSelector: { matchLabels: labels }, policyTypes: ['Ingress'], ingress: [{ ports: [{ protocol: 'TCP', port }] }] },
    },
  ];
  if (replicas > 1) {
    emitted.push({
      apiVersion: 'policy/v1',
      kind: 'PodDisruptionBudget',
      metadata: { name, namespace, labels },
      spec: { minAvailable: 1, selector: { matchLabels: labels } },
    });
  }
  return emitted;
}

function applicationHostRules(graph: ApplicationGraph): readonly Readonly<Record<string, unknown>>[] {
  const groups = new Map<string, Map<string, Set<string>>>();
  for (const node of graph.nodes) {
    if (node.kind === 'crd' && node.create) addRule(node.resource.apiVersion, node.resource.plural, ['create', 'get']);
    if (node.kind === 'query' && node.kubernetes) addRule(node.kubernetes.resource.apiVersion, node.kubernetes.resource.plural, ['get', 'list', 'watch']);
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
  return graph.nodes.some((node) =>
    (node.kind === 'crd' && Boolean(node.create))
    || (node.kind === 'query' && Boolean(node.kubernetes?.namespaceResolver))
    || (node.kind === 'query' && node.kubernetes?.resource.scope === 'Cluster'));
}

function createArtifactDigest(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

async function findStartArtifactManifest(start: string): Promise<string | undefined> {
  let directory = start;
  while (true) {
    const candidate = join(directory, '.applik8s', 'start-artifact.json');
    if (await access(candidate).then(() => true).catch(() => false)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function validateStartArtifactManifest(value: unknown): ApplicationStartArtifactManifest {
  if (!value || typeof value !== 'object') throw new Error('Applik8s Start artifact manifest must be an object.');
  if (Reflect.get(value, 'apiVersion') !== 'applik8s.startArtifact/v1alpha1') throw new Error('Applik8s Start artifact manifest has an unsupported apiVersion.');
  const digest = Reflect.get(value, 'digest');
  if (typeof digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error('Applik8s Start artifact manifest has an invalid digest.');
  const target = Reflect.get(value, 'target');
  if (target !== 'browser' && target !== 'server') throw new Error('Applik8s Start artifact manifest has an invalid target.');
  // typecast: the preceding structural and discriminant checks establish the manifest contract consumed below.
  return value as ApplicationStartArtifactManifest;
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
