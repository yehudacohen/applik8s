import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ApplicationGraph,
  ApplicationHandlerDependencies,
  ApplicationModelNode,
  ApplicationProviderNode,
} from '@applik8s/core';
import type { ApplicationFrameworkCredentialDependency } from '@applik8s/deployment-contract';
import { build } from 'esbuild';
import { generatedCallbackFactoryModule } from '../application-callback-module.js';
import type { GeneratedApplicationContainerArtifact } from '../application-containers/index.js';
import { emitGeneratedApplicationContainer } from '../application-containers/index.js';
import { applicationFrameworkCredentialDependencies } from '../application-framework-credentials.js';
import { generatedRuntimeNodePaths } from '../node-module-resolution.js';
import { applicationGraphStringValue } from '../application-installation-values.js';
import { applik8sWorkspaceSourcePlugin } from '../bundling/index.js';
import { handlerSourceMetadataPlugin } from '../pipeline/entrypoint-handler-instrumentation.js';

const runtimeImage = 'node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2';

export interface GeneratedApplicationManagedModelArtifact {
  readonly name: string;
  readonly providerId: string;
  readonly modelIds: readonly string[];
  readonly sourcePath: string;
  readonly sourceMapPath: string;
  readonly manifestPath: string;
  readonly metafilePath: string;
  readonly digest: string;
  readonly sizeBytes: number;
  readonly container: GeneratedApplicationContainerArtifact;
  readonly resources: readonly GeneratedApplicationManagedModelResource[];
  readonly frameworkCredentials: readonly ApplicationFrameworkCredentialDependency[];
}

export interface GeneratedApplicationManagedModelResource {
  readonly apiVersion: string;
  readonly kind: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly spec?: Readonly<Record<string, unknown>>;
}

interface ManagedModelContract {
  readonly graphName: string;
  readonly provider: ApplicationProviderNode<'OperatorRuntime'>;
  readonly namespace: string;
  readonly name: string;
  readonly port: number;
  readonly models: readonly (ApplicationModelNode & {
    readonly runtime: NonNullable<ApplicationModelNode['runtime']>;
    readonly managed: NonNullable<ApplicationModelNode['managed']>;
  })[];
  readonly storeSchemas: Readonly<Record<string, string | undefined>>;
}

/** Emits the maintained PostgreSQL-backed distributed OperatorRuntime. */
export async function emitGeneratedApplicationManagedModels(options: {
  readonly graph: ApplicationGraph;
  readonly outDir: string;
  readonly entrypoint: string;
  readonly executionTarget?: 'kubernetes' | 'local' | 'aws-local' | 'aws';
}): Promise<readonly GeneratedApplicationManagedModelArtifact[]> {
  const models = options.graph.nodes.filter(
    (node): node is ApplicationModelNode & {
      readonly runtime: NonNullable<ApplicationModelNode['runtime']>;
      readonly managed: NonNullable<ApplicationModelNode['managed']>;
    } => node.kind === 'model' && Boolean(node.runtime && node.managed),
  );
  if (models.length === 0) return [];
  if (options.executionTarget !== undefined && options.executionTarget !== 'kubernetes') return [];
  const providerIds = [...new Set(models.map(({ managed }) => managed.runtime.nodeId))];
  const artifacts: GeneratedApplicationManagedModelArtifact[] = [];
  for (const providerId of providerIds) {
    const provider = options.graph.nodes.find(
      (node): node is ApplicationProviderNode<'OperatorRuntime'> =>
        node.kind === 'provider'
        && node.interface === 'OperatorRuntime'
        && node.id === providerId,
    );
    if (!provider) {
      throw new Error(`Managed models reference missing OperatorRuntime provider ${providerId}.`);
    }
    if (provider.implementation === 'kubernetes-operator-runtime') continue;
    if (provider.implementation !== 'distributed-operator-runtime') {
      throw new Error(`Kubernetes compilation cannot lower OperatorRuntime implementation ${provider.implementation}.`);
    }
    const selected = models.filter(({ managed }) => managed.runtime.nodeId === providerId);
    const contract = managedModelContract(options.graph, provider, selected);
    artifacts.push(await emitManagedModelArtifact(options, contract));
  }
  return artifacts;
}

async function emitManagedModelArtifact(
  options: {
    readonly graph: ApplicationGraph;
    readonly outDir: string;
    readonly entrypoint: string;
  },
  contract: ManagedModelContract,
): Promise<GeneratedApplicationManagedModelArtifact> {
  const artifactDir = join(options.outDir, contract.name);
  await mkdir(artifactDir, { recursive: true });
  await Promise.all(contract.models.flatMap((model) => [
    ...(model.managed.reconcile ? [writeCallback(artifactDir, model, 'reconcile', model.managed.reconcile)] : []),
    ...model.managed.finalizers.map((finalizer, index) =>
      writeCallback(artifactDir, model, `finalizer-${index}`, finalizer)),
  ]));
  const generatedEntrypoint = join(artifactDir, 'managed-model-operator.generated.ts');
  const sourcePath = join(artifactDir, 'managed-model-operator.mjs');
  const sourceMapPath = `${sourcePath}.map`;
  const manifestPath = join(artifactDir, 'managed-model-operator.manifest.json');
  const metafilePath = join(artifactDir, 'managed-model-operator.esbuild-meta.json');
  await writeFile(generatedEntrypoint, generatedManagedModelSource(contract));
  const result = await build({
    entryPoints: [generatedEntrypoint],
    outfile: sourcePath,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    legalComments: 'none',
    minify: true,
    keepNames: true,
    lineLimit: 120,
    sourcemap: 'external',
    sourcesContent: false,
    metafile: true,
    nodePaths: [...generatedRuntimeNodePaths()],
    banner: { js: "import { createRequire as __applik8sCreateRequire } from 'node:module'; const require = __applik8sCreateRequire(import.meta.url);" },
    supported: { 'template-literal': false },
    plugins: [
      handlerSourceMetadataPlugin(options.entrypoint, { includeMaintainedPackages: false }),
      applik8sWorkspaceSourcePlugin(),
    ],
  });
  const source = await readFile(sourcePath, 'utf8');
  const sizeBytes = Buffer.byteLength(source);
  const digest = `sha256:${createHash('sha256').update(source).digest('hex')}`;
  const container = await emitGeneratedApplicationContainer({
    graphName: contract.graphName,
    workloadName: contract.name,
    role: 'managed-model-operator',
    artifactDir,
    sourcePath,
    sourceMapPath,
    entrypoint: '/app/managed-model-operator.mjs',
    baseImage: runtimeImage,
    sourceDigest: digest,
  });
  const resources = managedModelResources(contract, container.image, digest);
  await writeFile(manifestPath, `${JSON.stringify({
    apiVersion: 'applik8s.managedModelOperator/v1alpha1',
    kind: 'GeneratedApplicationManagedModelOperator',
    metadata: { name: contract.name },
    spec: {
      graph: contract.graphName,
      provider: contract.provider.id,
      models: contract.models.map(({ id }) => id),
      activation: 'checkpointedBeforeReadiness',
      runtime: { source: sourcePath, sourceMap: sourceMapPath, digest, sizeBytes },
      container,
      resources: resources.map(({ apiVersion, kind, metadata }) => ({ apiVersion, kind, metadata })),
    },
  }, null, 2)}\n`);
  await writeFile(metafilePath, `${JSON.stringify(result.metafile, null, 2)}\n`);
  return {
    name: contract.name,
    providerId: contract.provider.id,
    modelIds: contract.models.map(({ id }) => id),
    sourcePath,
    sourceMapPath,
    manifestPath,
    metafilePath,
    digest,
    sizeBytes,
    container,
    resources,
    frameworkCredentials: applicationFrameworkCredentialDependencies(source),
  };
}

async function writeCallback(
  directory: string,
  model: ManagedModelContract['models'][number],
  role: string,
  callback: {
    readonly handlerSource: string;
    readonly handlerDependencies?: ApplicationHandlerDependencies;
    readonly handlerUnresolved?: readonly string[];
  },
): Promise<void> {
  if (callback.handlerUnresolved?.length) {
    throw new Error(
      `Managed model ${model.name} ${role} callback has unresolved identifiers: ${callback.handlerUnresolved.join(', ')}.`,
    );
  }
  await writeFile(
    join(directory, callbackFile(model, role)),
    generatedCallbackFactoryModule({
      source: callback.handlerSource,
      ...(callback.handlerDependencies ? { dependencies: callback.handlerDependencies } : {}),
      injectedIdentifiers: [],
      exportName: 'createCallback',
    }),
  );
}

function generatedManagedModelSource(contract: ManagedModelContract): string {
  const imports = contract.models.flatMap((model, modelIndex) => [
    ...(model.managed.reconcile
      ? [`import { createCallback as createReconcile${modelIndex} } from './${callbackFile(model, 'reconcile').replace(/\.ts$/u, '.js')}';`]
      : []),
    ...model.managed.finalizers.map((_, finalizerIndex) =>
      `import { createCallback as createFinalizer${modelIndex}_${finalizerIndex} } from './${callbackFile(model, `finalizer-${finalizerIndex}`).replace(/\.ts$/u, '.js')}';`),
  ]).join('\n');
  const connections = uniqueConnections(contract.models).map(({ environmentName }, index) =>
    `const sql${index} = createApplicationPostgresSql(requiredEnv(${JSON.stringify(environmentName)}), { max: 8 });`,
  ).join('\n');
  const modelDefinitions = contract.models.map((model, index) =>
    `const model${index} = Object.freeze(${JSON.stringify(model.runtime)});`,
  ).join('\n');
  const readClientGroups = uniqueConnections(contract.models).map(({ environmentName }, index) => {
    const modelVariables = contract.models.flatMap((model, modelIndex) =>
      model.runtime.connectionEnvName === environmentName ? [`model${modelIndex}`] : []);
    return `await applicationPostgresModelReadClients(sql${index}, [${modelVariables.join(', ')}])`;
  });
  const stores = contract.models.map((model, index) => {
    const connectionIndex = uniqueConnections(contract.models).findIndex(
      ({ environmentName }) => environmentName === model.runtime.connectionEnvName,
    );
    const storeSchema = contract.storeSchemas[model.id];
    return `const store${index} = createPostgresApplicationManagedModelStore({
  sql: sql${connectionIndex},
  applicationId: ${JSON.stringify(model.runtime.managed?.applicationId ?? contract.graphName)},
  model: ${JSON.stringify(model.name)},
  statusSchemaVersion: ${JSON.stringify(model.managed.statusSchemaVersion)},
  ${storeSchema ? `schema: ${JSON.stringify(storeSchema)},` : ''}
  readValue: identity => readPostgresApplicationManagedModelValue(sql${connectionIndex}, model${index}, identity),
  deleteValue: (identity, transaction) => deletePostgresApplicationManagedModelValue(transaction, model${index}, identity),
});`;
  }).join('\n');
  const bindings = contract.models.map((model, index) => {
    const conditionTypes = [
      ...(model.managed.reconcile?.conditionTypes ?? []),
      ...model.managed.finalizers.flatMap(({ conditionTypes }) => conditionTypes),
    ];
    return `const binding${index} = Object.freeze({
  model: ${JSON.stringify(model.name)},
  status: normalizedSchema(${JSON.stringify(model.managed.status.jsonSchema)}, ${JSON.stringify(`${model.name}.status`)}),
  leaseDurationSeconds: ${model.managed.lifecycle.lease.durationSeconds},
  conditionTypes: ${JSON.stringify([...new Set(conditionTypes)].sort())},
  ${model.managed.reconcile ? `reconcile: withReads(createReconcile${index}({})),` : ''}
  finalizers: [${model.managed.finalizers.map((finalizer, finalizerIndex) => `{
    name: ${JSON.stringify(finalizer.name)},
    conditionTypes: ${JSON.stringify(finalizer.conditionTypes)},
    handler: withReads(createFinalizer${index}_${finalizerIndex}({})),
  }`).join(',')}],
});`;
  }).join('\n');
  const activations = contract.models.map((model, index) =>
    `const activation${index} = await store${index}.activateExisting({
  initialStatus: ${JSON.stringify(model.managed.initialStatus)},
  pageSize: 500,
  scanPage: request => scanPostgresApplicationManagedModelValues(request.transaction, model${index}, request),
});
if (!activation${index}.completed) throw new Error(${JSON.stringify(`Managed model ${model.name} activation exceeded its bounded migration window.`)});`,
  ).join('\n');
  const work = contract.models.map((model, index) =>
    `postgresApplicationOperatorWorkItem({
  store: store${index},
  binding: binding${index},
  resyncIntervalSeconds: ${model.managed.lifecycle.resync.intervalSeconds},
  maximumResyncItems: ${model.managed.lifecycle.resync.maximumItems},
})`,
  ).join(',\n');
  return `
import { createServer } from 'node:http';
import { normalizeSchema } from '@applik8s/sdk/schema-runtime';
import {
  applicationPostgresModelReadClients,
  deletePostgresApplicationManagedModelValue,
  readPostgresApplicationManagedModelValue,
  scanPostgresApplicationManagedModelValues,
  withApplicationNativeModelReadClients,
} from '@applik8s/applik8s/managed-model-postgres-runtime';
import { createApplicationPostgresSql } from '@applik8s/runtime-postgres/sql';
import { createPostgresApplicationManagedModelStore } from '@applik8s/runtime-postgres/managed-model-store';
import { createPostgresApplicationOperatorRuntime, postgresApplicationOperatorWorkItem } from '@applik8s/runtime-postgres/operator-runtime';
${imports}

function requiredEnv(name) { const value = process.env[name]; if (!value) throw new Error('Missing required environment variable ' + name); return value; }
function normalizedSchema(schema, name) { return normalizeSchema({ kind: 'jsonSchema', ref: { kind: 'jsonSchema', uri: 'generated:' + name }, schema }, name); }
${connections}
${modelDefinitions}
const readClients = Object.freeze(Object.assign({}, ${readClientGroups.join(', ')}));
const withReads = handler => async (...args) => withApplicationNativeModelReadClients(readClients, () => handler(...args));
${stores}
${bindings}
let ready = false;
let failure;
let runtime;
const server = createServer((request, response) => {
  if (request.url === '/healthz') {
    const failed = Boolean(failure || runtime?.snapshot().state === 'failed');
    response.statusCode = failed ? 500 : 200;
    response.end(failed ? String(failure || runtime?.snapshot().lastError || 'operator_failed') : 'ok');
    return;
  }
  if (request.url === '/readyz') {
    response.statusCode = ready ? 200 : 503;
    response.end(ready ? 'ready' : 'activating');
    return;
  }
  response.statusCode = 404;
  response.end('not_found');
});
server.listen(${contract.port}, '0.0.0.0');

async function bootstrap() {
  await Promise.all([${contract.models.map((_, index) => `store${index}.initialize()`).join(',')}]);
  ${activations}
  runtime = createPostgresApplicationOperatorRuntime({ work: [${work}], maximumConcurrency: 4 });
  ready = true;
  void runtime.start().catch(error => { failure = error instanceof Error ? error.message : String(error); ready = false; });
}
void bootstrap().catch(error => { failure = error instanceof Error ? error.message : String(error); ready = false; });

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  ready = false;
  server.close();
  await runtime?.close();
  await Promise.all([${contract.models.map((_, index) => `store${index}.close()`).join(',')}]);
  await Promise.all([${uniqueConnections(contract.models).map((_, index) => `sql${index}.end()`).join(',')}]);
}
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
`.trimStart();
}

function managedModelContract(
  graph: ApplicationGraph,
  provider: ApplicationProviderNode<'OperatorRuntime'>,
  models: ManagedModelContract['models'],
): ManagedModelContract {
  const namespace = applicationGraphStringValue(graph.metadata.namespace) ?? 'default';
  const storeSchemas: Record<string, string | undefined> = {};
  for (const model of models) {
    const secretNamespace = applicationGraphStringValue(model.runtime.secretNamespace) ?? namespace;
    if (secretNamespace !== namespace) {
      throw new Error(`Managed model ${model.name} is deployed to ${namespace}, but its PostgreSQL Secret is in ${secretNamespace}.`);
    }
    const store = graph.nodes.find(
      (node): node is ApplicationProviderNode<'ManagedModelStore'> =>
        node.kind === 'provider'
        && node.interface === 'ManagedModelStore'
        && node.id === model.managed.store.nodeId,
    );
    if (!store) throw new Error(`Managed model ${model.name} references missing store ${model.managed.store.nodeId}.`);
    if (store.implementation !== 'postgres-managed-model-store') {
      throw new Error(`Distributed OperatorRuntime cannot lower ${store.implementation} for managed model ${model.name}.`);
    }
    storeSchemas[model.id] = applicationGraphStringValue(store.config?.schema);
  }
  return {
    graphName: graph.metadata.name,
    provider,
    namespace,
    name: kubernetesName(`${graph.metadata.name}-managed-models`),
    port: 8092,
    models,
    storeSchemas,
  };
}

function uniqueConnections(models: ManagedModelContract['models']): readonly { readonly environmentName: string }[] {
  return [...new Set(models.map(({ runtime }) => runtime.connectionEnvName))]
    .sort()
    .map((environmentName) => ({ environmentName }));
}

function managedModelResources(
  contract: ManagedModelContract,
  image: string,
  digest: string,
): readonly GeneratedApplicationManagedModelResource[] {
  const labels = {
    'app.kubernetes.io/name': contract.name,
    'app.kubernetes.io/component': 'managed-model-operator',
    'app.kubernetes.io/managed-by': 'applik8s',
  };
  const metadata = { name: contract.name, namespace: contract.namespace, labels };
  const environments = uniqueConnections(contract.models).map(({ environmentName }) => {
    const model = contract.models.find(({ runtime }) => runtime.connectionEnvName === environmentName);
    if (!model) throw new Error(`Managed-model connection ${environmentName} has no model.`);
    return {
      name: environmentName,
      valueFrom: {
        secretKeyRef: {
          name: model.runtime.secretName,
          key: model.runtime.secretKey,
          optional: false,
        },
      },
    };
  });
  return [
    {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'NetworkPolicy',
      metadata,
      spec: {
        podSelector: { matchLabels: labels },
        policyTypes: ['Ingress', 'Egress'],
        ingress: [{ ports: [{ protocol: 'TCP', port: contract.port }] }],
        egress: [
          { to: [{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'kube-system' } }, podSelector: { matchLabels: { 'k8s-app': 'kube-dns' } } }], ports: [{ protocol: 'UDP', port: 53 }, { protocol: 'TCP', port: 53 }] },
          { ports: [{ protocol: 'TCP', port: 5432 }, { protocol: 'TCP', port: 443 }] },
        ],
      },
    },
    {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata,
      spec: {
        replicas: 2,
        selector: { matchLabels: labels },
        strategy: { type: 'RollingUpdate', rollingUpdate: { maxUnavailable: 0, maxSurge: 1 } },
        template: {
          metadata: { labels, annotations: { 'applik8s.dev/runtime-digest': digest } },
          spec: {
            automountServiceAccountToken: false,
            terminationGracePeriodSeconds: 30,
            securityContext: { runAsNonRoot: true, runAsUser: 1000, runAsGroup: 1000, seccompProfile: { type: 'RuntimeDefault' } },
            containers: [{
              name: 'operator',
              image,
              imagePullPolicy: 'IfNotPresent',
              command: ['node', '/app/managed-model-operator.mjs'],
              ports: [{ name: 'health', containerPort: contract.port }],
              env: environments,
              readinessProbe: { httpGet: { path: '/readyz', port: 'health' }, periodSeconds: 5, timeoutSeconds: 2 },
              livenessProbe: { httpGet: { path: '/healthz', port: 'health' }, periodSeconds: 10, timeoutSeconds: 2 },
              securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ['ALL'] } },
              resources: { requests: { cpu: '50m', memory: '96Mi' }, limits: { cpu: '500m', memory: '256Mi' } },
            }],
          },
        },
      },
    },
  ];
}

function callbackFile(model: ApplicationModelNode, role: string): string {
  return `managed-${createHash('sha256').update(`${model.id}:${role}`).digest('hex').slice(0, 16)}.generated.ts`;
}

function kubernetesName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 63) || 'managed-models';
}
