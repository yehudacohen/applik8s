import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import type {
  ApplicationGraph,
  ApplicationProviderNode,
  ApplicationTaskHandlerNode,
  ApplicationTaskNode,
  ApplicationWorkflowHandlerNode,
  ApplicationWorkflowNode,
  ApplicationWorkflowWorkerNode,
} from '@applik8s/core';
import { build, type Plugin } from 'esbuild';
import { applik8sWorkspaceSourcePlugin } from '../bundling/index.js';

const DEFAULT_WORKER_IMAGE = 'node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2';

export interface GeneratedApplicationWorkflowArtifact {
  readonly name: string;
  readonly sourcePath: string;
  readonly sourceMapPath: string;
  readonly manifestPath: string;
  readonly metafilePath: string;
  readonly digest: string;
  readonly sizeBytes: number;
  readonly resources: readonly GeneratedApplicationWorkflowResource[];
}

export interface GeneratedApplicationWorkflowResource {
  readonly apiVersion: string;
  readonly kind: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly data?: Readonly<Record<string, string>>;
  readonly binaryData?: Readonly<Record<string, string>>;
  readonly spec?: Readonly<Record<string, unknown>>;
}

export async function emitGeneratedApplicationWorkflows(options: {
  readonly graph: ApplicationGraph;
  readonly outDir: string;
  readonly entrypoint: string;
}): Promise<readonly GeneratedApplicationWorkflowArtifact[]> {
  const workers = options.graph.nodes.filter((node): node is ApplicationWorkflowWorkerNode => node.kind === 'workflowWorker');
  if (workers.length === 0) return [];
  await mkdir(options.outDir, { recursive: true });
  const artifacts: GeneratedApplicationWorkflowArtifact[] = [];
  const provisionedProviders = new Set<string>();
  for (const worker of workers) {
    const contract = workflowContract(options.graph, worker);
    const ownsProvider = !provisionedProviders.has(contract.provider.id);
    provisionedProviders.add(contract.provider.id);
    artifacts.push(await emitWorkflowWorker(contract, options.outDir, ownsProvider));
  }
  return artifacts;
}

interface WorkflowContract {
  readonly graphName: string;
  readonly worker: ApplicationWorkflowWorkerNode;
  readonly provider: ApplicationProviderNode;
  readonly providerConfig: Readonly<Record<string, unknown>>;
  readonly tasks: readonly { readonly handler: ApplicationTaskHandlerNode; readonly task: ApplicationTaskNode }[];
  readonly workflows: readonly { readonly handler: ApplicationWorkflowHandlerNode; readonly workflow: ApplicationWorkflowNode }[];
  readonly namespace: string;
  readonly engineName: string;
  readonly adminCredentialsSecret: string;
  readonly workerTokenSecret: string;
  readonly tokenKey: string;
  readonly image: string;
  readonly contractNames: Readonly<Record<string, string>>;
}

function workflowContract(graph: ApplicationGraph, worker: ApplicationWorkflowWorkerNode): WorkflowContract {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const provider = nodes.get(worker.workflowEngine.nodeId);
  if (provider?.kind !== 'provider' || provider.interface !== 'WorkflowEngine' || provider.implementation !== 'hatchet') {
    throw new Error(`Generated workflow worker ${worker.id} requires one resolved Hatchet WorkflowEngine provider.`);
  }
  const tasks: { handler: ApplicationTaskHandlerNode; task: ApplicationTaskNode }[] = [];
  const workflows: { handler: ApplicationWorkflowHandlerNode; workflow: ApplicationWorkflowNode }[] = [];
  for (const reference of worker.handlers) {
    const handler = nodes.get(reference.nodeId);
    if (handler?.kind === 'taskHandler') {
      const task = nodes.get(handler.task.nodeId);
      if (task?.kind !== 'task') throw new Error(`Workflow task handler ${handler.id} references missing task ${handler.task.nodeId}.`);
      tasks.push({ handler, task });
    } else if (handler?.kind === 'workflowHandler') {
      const workflow = nodes.get(handler.workflow.nodeId);
      if (workflow?.kind !== 'workflow') throw new Error(`Workflow handler ${handler.id} references missing workflow ${handler.workflow.nodeId}.`);
      workflows.push({ handler, workflow });
    } else {
      throw new Error(`Generated workflow worker ${worker.id} references invalid handler ${reference.nodeId}.`);
    }
  }
  const config = provider.config ?? {};
  const namespace = stringConfig(config.namespace) || 'default';
  const engineName = kubernetesName(stringConfig(config.name) || 'applik8s-hatchet');
  const legacyCredentials = objectConfig(config.credentialsSecret);
  const adminCredentials = objectConfig(config.adminCredentialsSecret);
  const workerToken = objectConfig(config.workerTokenSecret);
  for (const credentials of [legacyCredentials, adminCredentials, workerToken]) {
    const credentialNamespace = stringConfig(credentials.namespace);
    if (credentialNamespace && credentialNamespace !== namespace) {
      throw new Error(`Generated workflow worker ${worker.id} cannot read Hatchet Secret ${credentialNamespace}/${stringConfig(credentials.name)} from namespace ${namespace}.`);
    }
  }
  if (worker.deployment.scaling.mode === 'kedaHatchetSlots' && !stringConfig(config.tenantId)) {
    throw new Error(`Generated workflow worker ${worker.id} uses KEDA Hatchet task-stat scaling but its WorkflowEngine provider has no tenantId.`);
  }
  return {
    graphName: graph.metadata.name,
    worker,
    provider,
    providerConfig: config,
    tasks,
    workflows,
    namespace,
    engineName,
    adminCredentialsSecret: stringConfig(adminCredentials.name) || stringConfig(legacyCredentials.name) || `${engineName}-admin`,
    workerTokenSecret: stringConfig(workerToken.name) || stringConfig(legacyCredentials.name) || (config.provision === false ? `${engineName}-worker` : `${engineName}-client-config`),
    tokenKey: stringConfig(config.tokenKey) || (stringConfig(workerToken.name) || (!stringConfig(legacyCredentials.name) && config.provision !== false) ? 'HATCHET_CLIENT_TOKEN' : 'token'),
    image: stringConfig(objectConfig(config.worker).image) || DEFAULT_WORKER_IMAGE,
    contractNames: Object.fromEntries(graph.nodes.flatMap((node) => node.kind === 'task' || node.kind === 'workflow' ? [[node.id, node.name]] : [])),
  };
}

async function emitWorkflowWorker(contract: WorkflowContract, outDir: string, ownsProvider: boolean): Promise<GeneratedApplicationWorkflowArtifact> {
  const name = kubernetesName(contract.worker.name);
  const workerDir = join(outDir, name);
  const generatedEntrypoint = join(workerDir, 'workflow-worker.generated.ts');
  const sourcePath = join(workerDir, 'workflow-worker.mjs');
  const sourceMapPath = `${sourcePath}.map`;
  const manifestPath = join(workerDir, 'workflow-worker.manifest.json');
  const metafilePath = join(workerDir, 'workflow-worker.esbuild-meta.json');
  await mkdir(workerDir, { recursive: true });
  for (const handler of [...contract.tasks.map((entry) => entry.handler), ...contract.workflows.map((entry) => entry.handler)]) {
    await writeFile(join(workerDir, handlerModuleFile(handler.id)), generatedHandlerModule(handler));
  }
  await writeFile(generatedEntrypoint, generatedWorkerSource(contract));
  const result = await build({
    entryPoints: [generatedEntrypoint],
    outfile: sourcePath,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    legalComments: 'none',
    minify: true,
    sourcemap: 'external',
    metafile: true,
    banner: { js: "import { createRequire as __applik8sCreateRequire } from 'node:module'; const require = __applik8sCreateRequire(import.meta.url);" },
    nodePaths: [join(process.cwd(), 'node_modules')],
    plugins: [hatchetSingleFileHeartbeatPlugin(), applik8sWorkspaceSourcePlugin()],
  });
  const source = await readFile(sourcePath, 'utf8');
  const sizeBytes = Buffer.byteLength(source);
  const compressedSource = gzipSync(source, { level: 9 });
  if (compressedSource.byteLength > 700_000) throw new Error(`Generated workflow worker ${contract.worker.id} compresses to ${compressedSource.byteLength} bytes and exceeds the safe ConfigMap binary-bundle limit.`);
  const digest = `sha256:${createHash('sha256').update(source).digest('hex')}`;
  const resources = workflowResources(contract, name, compressedSource.toString('base64'), digest, ownsProvider);
  const manifest = {
    apiVersion: 'applik8s.workflow/v1alpha1',
    kind: 'GeneratedWorkflowWorker',
    metadata: { name },
    spec: {
      graph: contract.graphName,
      worker: contract.worker.id,
      provider: { interface: 'WorkflowEngine', implementation: 'hatchet', version: stringConfig(contract.providerConfig.serverVersion) },
      tasks: contract.tasks.map(({ task }) => task.id),
      workflows: contract.workflows.map(({ workflow }) => workflow.id),
      runtime: { entrypoint: sourcePath, sourceMap: sourceMapPath, digest, sizeBytes, compressedSizeBytes: compressedSource.byteLength, distribution: 'gzipConfigMapBinaryData', packageManagerAtStartup: false, image: contract.image, hatchetHeartbeat: 'inProcessPinnedSdkAdapter' },
      guarantees: { tasks: 'atLeastOnceRetrySafe', workflows: 'durableHistory', externalEffects: 'tasksOnly', operationalAuthority: 'hatchetPostgres', canonicalAuthority: 'applik8sModelTransactions' },
      deployment: contract.worker.deployment,
    },
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(metafilePath, `${JSON.stringify(result.metafile, null, 2)}\n`);
  return { name, sourcePath, sourceMapPath, manifestPath, metafilePath, digest, sizeBytes, resources };
}

function generatedWorkerSource(contract: WorkflowContract): string {
  const handlerImports = [...contract.tasks.map((entry) => entry.handler), ...contract.workflows.map((entry) => entry.handler)]
    .map((handler) => `import { handler as ${handlerVariable(handler.id)} } from ${JSON.stringify(`./${handlerModuleFile(handler.id)}`)};`)
    .join('\n');
  const taskDeclarations = contract.tasks.map(({ handler, task }) => {
    const errors = Object.fromEntries(task.contract.errors.map((error) => [error.name, error.schema.jsonSchema]));
    return `
const ${jsName(task.id)} = hatchet.task({
  name: ${JSON.stringify(task.name)},
  retries: ${Math.max(0, (handler.retry.maxAttempts ?? 1) - 1)},
  backoff: { factor: ${Math.max(1, handler.retry.factor ?? 2)}, maxSeconds: ${Math.max(1, (handler.retry.maxDelayMs ?? 60_000) / 1_000)} },
  executionTimeout: ${JSON.stringify(`${handler.executionTimeoutSeconds}s`)},
  scheduleTimeout: ${JSON.stringify(`${handler.scheduleTimeoutSeconds}s`)},
  fn: async (input, context) => {
    const validInput = validate(${JSON.stringify(task.contract.input.jsonSchema)}, input, ${JSON.stringify(`${task.name}.input`)});
    const output = await ${handlerVariable(handler.id)}(validInput, taskContext(context, ${JSON.stringify(task.name)}, ${JSON.stringify(errors)}));
    return validate(${JSON.stringify(task.contract.output.jsonSchema)}, output, ${JSON.stringify(`${task.name}.output`)});
  },
});`;
  }).join('\n');
  const workflowDeclarations = contract.workflows.map(({ handler, workflow }) => {
    const taskBindings = Object.fromEntries(handler.taskBindings.map((binding) => [binding.alias, contract.contractNames[binding.task.nodeId]]));
    const childBindings = Object.fromEntries(handler.childWorkflowBindings.map((binding) => [binding.alias, contract.contractNames[binding.workflow.nodeId]]));
    const errors = Object.fromEntries(workflow.contract.errors.map((error) => [error.name, error.schema.jsonSchema]));
    if (Object.values(taskBindings).some((value) => !value) || Object.values(childBindings).some((value) => !value)) throw new Error(`Workflow handler ${handler.id} contains an unresolved task or child-workflow binding.`);
    return `
const ${jsName(workflow.id)} = hatchet.durableTask({
  name: ${JSON.stringify(workflow.name)},
  fn: async (input, context) => {
    const validInput = validate(${JSON.stringify(workflow.contract.input.jsonSchema)}, input, ${JSON.stringify(`${workflow.name}.input`)});
    const output = await ${handlerVariable(handler.id)}(validInput, workflowContext(context, ${JSON.stringify(workflow.name)}, ${JSON.stringify(taskBindings)}, ${JSON.stringify(childBindings)}, ${JSON.stringify(errors)}, declarations));
    return validate(${JSON.stringify(workflow.contract.output.jsonSchema)}, output, ${JSON.stringify(`${workflow.name}.output`)});
  },
});`;
  }).join('\n');
  const declarationNames = [...contract.tasks.map(({ task }) => jsName(task.id)), ...contract.workflows.map(({ workflow }) => jsName(workflow.id))];
  const declarationEntries = [
    ...contract.tasks.map(({ task }) => `${JSON.stringify(task.name)}: ${jsName(task.id)}`),
    ...contract.workflows.map(({ workflow }) => `${JSON.stringify(workflow.name)}: ${jsName(workflow.id)}`),
  ];
  const cronRegistrations = contract.workflows.flatMap(({ workflow }) => workflow.triggers.crons.map((cron) => `${jsName(workflow.id)}.cron(${JSON.stringify(cron.name)}, ${JSON.stringify(cron.expression)}, ${JSON.stringify(cron.input)})`));
  return `import { createServer } from 'node:http';
import { HatchetClient } from '@hatchet-dev/typescript-sdk/v1';
import { normalizeSchema } from '@applik8s/sdk';
${handlerImports}

const hatchet = HatchetClient.init();
const declarations = Object.create(null);
function validate(schema, value, name) {
  const result = normalizeSchema({ kind: 'jsonSchema', ref: { kind: 'jsonSchema', uri: 'generated:' + name }, schema }, name).validate(value);
  if (!result.ok) throw new Error('applik8s-workflow-schema-invalid: ' + name + ': ' + result.error.message);
  return result.value;
}

function metadata(context) {
  const invocationId = String(context.workflowRunId?.() ?? context.stepRunId?.() ?? 'unknown');
  const data = typeof context.additionalMetadata === 'function' ? context.additionalMetadata() : {};
  let trustedContext;
  if (data?.['applik8s.trusted-context']) {
    try { trustedContext = JSON.parse(data['applik8s.trusted-context']); } catch { throw new Error('applik8s-workflow-trusted-context-invalid'); }
    if (!trustedContext || typeof trustedContext !== 'object' || !trustedContext.values || typeof trustedContext.digest !== 'string') throw new Error('applik8s-workflow-trusted-context-invalid');
  }
  return { invocationId, idempotencyKey: invocationId, attempt: Number(context.retryCount?.() ?? 0) + 1, correlationId: data?.['applik8s.correlation-id'], causationId: data?.['applik8s.causation-id'], traceparent: data?.traceparent, ...(trustedContext ? { trustedContext } : {}), signal: context.abortController?.signal ?? new AbortController().signal };
}
function declaredFailure(contractName, errorSchemas, name, payload) {
  const schema = errorSchemas[name];
  if (!schema) throw new Error('Unknown declared durable error ' + JSON.stringify(name) + ' for ' + contractName);
  const validPayload = validate(schema, payload, contractName + '.errors.' + name);
  throw new Error('applik8s-durable-error:' + JSON.stringify({ name, payload: validPayload }));
}
function taskContext(context, contractName, errorSchemas) {
  return { ...metadata(context), fail: (name, payload) => declaredFailure(contractName, errorSchemas, name, payload) };
}
function childOptions(options) {
  return { ...(options?.idempotencyKey ? { childKey: options.idempotencyKey } : {}), ...(options ? { additionalMetadata: Object.fromEntries(Object.entries({ 'applik8s.idempotency-key': options.idempotencyKey, 'applik8s.tenant': options.tenant, 'applik8s.correlation-id': options.correlationId, 'applik8s.causation-id': options.causationId, traceparent: options.traceparent, 'applik8s.trusted-context': options.trustedContext ? JSON.stringify(options.trustedContext) : undefined }).filter(([, value]) => typeof value === 'string')) } : {}) };
}
function workflowContext(context, workflowName, taskBindings, childBindings, errorSchemas, registry) {
  const base = metadata(context);
  return {
    ...base,
    task: (alias, input, options) => context.spawnChild(resolveDeclaration(registry, taskBindings, 'task', alias), input, childOptions({ ...base, ...options, trustedContext: options?.trustedContext ?? base.trustedContext })),
    child: (alias, input, options) => context.spawnChild(resolveDeclaration(registry, childBindings, 'child workflow', alias), input, childOptions({ ...base, ...options, trustedContext: options?.trustedContext ?? base.trustedContext })),
    sleep: async (duration) => { await context.sleepFor(duration); },
    waitFor: (signal, options = {}) => context.waitForEvent(workflowName + '.' + signal, options.expression, undefined, options.scope ?? base.invocationId, options.lookback),
    now: () => context.now(),
    cancelled: () => context.cancelled,
    rethrowIfCancelled: (error) => context.rethrowIfCancelled(error),
    fail: (name, payload) => declaredFailure(workflowName, errorSchemas, name, payload),
  };
}
function resolveDeclaration(registry, bindings, kind, alias) { const name = bindings[alias]; if (!name) return missing(kind, alias); return registry[name] ?? name; }
function missing(kind, alias) { throw new Error('Unknown declared workflow ' + kind + ' alias ' + JSON.stringify(alias)); }
${taskDeclarations}
${workflowDeclarations}
Object.assign(declarations, { ${declarationEntries.join(', ')} });
${cronRegistrations.length > 0 ? `await Promise.all([${cronRegistrations.join(', ')}]);` : ''}

const worker = await hatchet.worker(${JSON.stringify(contract.worker.name)}, { slots: ${contract.worker.deployment.taskSlots}, durableSlots: ${contract.worker.deployment.durableSlots}, workflows: [${declarationNames.join(', ')}], handleKill: false });
let ready = false;
let stopping = false;
const server = createServer((request, response) => {
  const healthy = request.url === '/live' || (request.url === '/ready' && ready && !stopping);
  response.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ ready, stopping }));
});
server.listen(${contract.worker.deployment.healthPort}, '0.0.0.0');
const running = worker.start();
await worker.waitUntilReady(60_000);
ready = true;
async function shutdown() {
  if (stopping) return;
  stopping = true; ready = false;
  await worker.stop();
  server.close();
}
process.once('SIGTERM', () => { shutdown().catch((error) => { console.error(error); process.exitCode = 1; }); });
process.once('SIGINT', () => { shutdown().catch((error) => { console.error(error); process.exitCode = 1; }); });
await running;
`;
}

function generatedHandlerModule(handler: ApplicationTaskHandlerNode | ApplicationWorkflowHandlerNode): string {
  const dependencies = handler.handlerDependencies?.source
    ? absoluteDependencyImports(handler.handlerDependencies.source, handler.handlerDependencies.resolveDir)
    : '';
  return `${dependencies}${dependencies ? '\n\n' : ''}export const handler = (${handler.handlerSource});\n`;
}

function absoluteDependencyImports(source: string, resolveDir: string): string {
  return source
    .replace(/(\bfrom\s+['"])(\.[^'"]+)(['"])/g, (_match, prefix: string, specifier: string, suffix: string) => `${prefix}${resolve(resolveDir, specifier)}${suffix}`)
    .replace(/(^|\n)(\s*import\s+['"])(\.[^'"]+)(['"])/g, (_match, line: string, prefix: string, specifier: string, suffix: string) => `${line}${prefix}${resolve(resolveDir, specifier)}${suffix}`);
}

function handlerModuleFile(id: string): string {
  return `handler-${createHash('sha256').update(id).digest('hex').slice(0, 12)}.generated.ts`;
}

function handlerVariable(id: string): string {
  return `handler_${createHash('sha256').update(id).digest('hex').slice(0, 12)}`;
}

function workflowResources(contract: WorkflowContract, name: string, compressedSource: string, digest: string, ownsProvider: boolean): GeneratedApplicationWorkflowResource[] {
  const labels = { 'app.kubernetes.io/name': name, 'app.kubernetes.io/component': 'workflow-worker', 'applik8s.dev/graph': contract.graphName };
  const sourceName = `${name}-source`;
  const resources: GeneratedApplicationWorkflowResource[] = ownsProvider ? workflowProviderResources(contract) : [];
  resources.push(
    { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: sourceName, namespace: contract.namespace, labels, annotations: { 'applik8s.dev/digest': digest, 'applik8s.dev/content-encoding': 'gzip' } }, binaryData: { 'workflow-worker.mjs.gz': compressedSource } },
    {
      apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name, namespace: contract.namespace, labels }, spec: {
        replicas: contract.worker.deployment.replicas,
        selector: { matchLabels: labels },
        strategy: { type: 'RollingUpdate', rollingUpdate: { maxUnavailable: 0, maxSurge: 1 } },
        template: { metadata: { labels, annotations: { 'applik8s.dev/digest': digest } }, spec: {
          terminationGracePeriodSeconds: contract.worker.deployment.gracefulShutdownSeconds,
          initContainers: [{ name: 'unpack-worker', image: contract.image, command: ['node', '-e', "const fs=require('node:fs');const zlib=require('node:zlib');fs.writeFileSync('/app/workflow-worker.mjs',zlib.gunzipSync(fs.readFileSync('/bundle/workflow-worker.mjs.gz')));"], volumeMounts: [{ name: 'source', mountPath: '/bundle', readOnly: true }, { name: 'runtime', mountPath: '/app' }] }],
          containers: [{
            name: 'worker', image: contract.image, imagePullPolicy: 'IfNotPresent', command: ['node', '/app/workflow-worker.mjs'],
            env: [
              { name: 'HATCHET_CLIENT_TOKEN', valueFrom: { secretKeyRef: { name: contract.workerTokenSecret, key: contract.tokenKey } } },
              { name: 'HATCHET_CLIENT_HOST_PORT', value: stringConfig(contract.providerConfig.hostPort) || `${contract.engineName}-engine.${contract.namespace}.svc:7070` },
              { name: 'HATCHET_CLIENT_API_URL', value: stringConfig(contract.providerConfig.apiUrl) || `http://${contract.engineName}-api.${contract.namespace}.svc:8080` },
              { name: 'HATCHET_CLIENT_TLS_STRATEGY', value: contract.providerConfig.tls === true ? 'tls' : 'none' },
            ],
            ports: [{ name: 'health', containerPort: contract.worker.deployment.healthPort }],
            readinessProbe: { httpGet: { path: '/ready', port: 'health' }, periodSeconds: 5, failureThreshold: 6 },
            livenessProbe: { httpGet: { path: '/live', port: 'health' }, periodSeconds: 10, failureThreshold: 6 },
            resources: { requests: { cpu: '100m', memory: '128Mi' }, limits: { cpu: '1', memory: '512Mi' } },
            volumeMounts: [{ name: 'runtime', mountPath: '/app', readOnly: true }],
          }],
          volumes: [{ name: 'source', configMap: { name: sourceName } }, { name: 'runtime', emptyDir: {} }],
        } },
      },
    },
    { apiVersion: 'policy/v1', kind: 'PodDisruptionBudget', metadata: { name, namespace: contract.namespace, labels }, spec: { maxUnavailable: contract.worker.deployment.replicas > 1 ? 1 : 0, selector: { matchLabels: labels } } },
    workflowWorkerNetworkPolicy(contract, name, labels),
  );
  if (contract.worker.deployment.scaling.mode === 'kedaHatchetSlots') resources.push(...workflowScalingResources(contract, name));
  return resources;
}

function workflowProviderResources(contract: WorkflowContract): GeneratedApplicationWorkflowResource[] {
  if (contract.providerConfig.provision === false) return [];
  const config = contract.providerConfig;
  const database = objectConfig(config.database);
  const clusterName = kubernetesName(stringConfig(database.clusterName) || `${contract.engineName}-db`);
  const instances = numberConfig(database.instances) || (stringConfig(config.mode) === 'ha' ? 3 : 1);
  const chartVersion = stringConfig(config.chartVersion) || '0.12.4';
  const serverVersion = stringConfig(config.serverVersion) || 'v0.90.13';
  const databaseSecret = objectConfig(database.connectionSecret);
  const databaseSecretName = stringConfig(databaseSecret.name) || `${clusterName}-app`;
  const databaseKey = stringConfig(database.connectionSecretKey) || 'uri';
  const adminEmailKey = 'adminEmail';
  const adminPasswordKey = 'adminPassword';
  const replicas = stringConfig(config.mode) === 'ha' ? 2 : 1;
  const storageClass = stringConfig(database.storageClass);
  return [
    { apiVersion: 'source.toolkit.fluxcd.io/v1', kind: 'HelmRepository', metadata: { name: `${contract.engineName}-repository`, namespace: contract.namespace }, spec: { interval: '1h', url: 'https://hatchet-dev.github.io/hatchet-charts' } },
    ...(database.provision === false ? [] : [{ apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', metadata: { name: clusterName, namespace: contract.namespace }, spec: { instances, storage: { size: stringConfig(database.storageSize) || '8Gi', ...(storageClass ? { storageClass } : {}) }, bootstrap: { initdb: { database: stringConfig(database.database) || 'hatchet', owner: 'app' } }, monitoring: { enablePodMonitor: true } } }]),
    { apiVersion: 'helm.toolkit.fluxcd.io/v2', kind: 'HelmRelease', metadata: { name: contract.engineName, namespace: contract.namespace }, spec: {
      interval: '10m', timeout: '15m', releaseName: contract.engineName,
      chart: { spec: { chart: 'hatchet-stack', version: chartVersion, sourceRef: { kind: 'HelmRepository', name: `${contract.engineName}-repository`, namespace: contract.namespace }, interval: '1h' } },
      valuesFrom: [
        { kind: 'Secret', name: databaseSecretName, valuesKey: databaseKey, targetPath: 'sharedConfig.env.DATABASE_URL' },
        { kind: 'Secret', name: contract.adminCredentialsSecret, valuesKey: adminEmailKey, targetPath: 'sharedConfig.defaultAdminEmail' },
        { kind: 'Secret', name: contract.adminCredentialsSecret, valuesKey: adminPasswordKey, targetPath: 'sharedConfig.defaultAdminPassword' },
      ],
      values: { global: { sharedConfigSecretName: `${contract.engineName}-shared-config` }, sharedConfig: { image: { tag: serverVersion }, serverUrl: `http://${contract.engineName}-api.${contract.namespace}.svc:8080`, serverAuthCookieDomain: `${contract.engineName}-api.${contract.namespace}.svc`, serverAuthCookieInsecure: 't', grpcBroadcastAddress: `${contract.engineName}-engine.${contract.namespace}.svc:7070`, grpcInsecure: 't', env: { SERVER_MSGQUEUE_KIND: 'postgres' } }, postgres: { enabled: false }, rabbitmq: { enabled: false }, api: { replicaCount: replicas }, engine: { replicaCount: replicas }, frontend: { enabled: stringConfig(config.dashboard) !== 'disabled' }, caddy: { enabled: false } },
      install: { remediation: { retries: 3 } }, upgrade: { remediation: { retries: 3, remediateLastFailure: true } },
    } },
  ];
}

function workflowWorkerNetworkPolicy(contract: WorkflowContract, name: string, labels: Readonly<Record<string, string>>): GeneratedApplicationWorkflowResource {
  const sameNamespaceEgress = contract.worker.deployment.egress === 'sameNamespace';
  return {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'NetworkPolicy',
    metadata: { name, namespace: contract.namespace, labels },
    spec: {
      podSelector: { matchLabels: labels },
      policyTypes: sameNamespaceEgress ? ['Ingress', 'Egress'] : ['Ingress'],
      ingress: [{ ports: [{ protocol: 'TCP', port: contract.worker.deployment.healthPort }] }],
      ...(sameNamespaceEgress ? {
        egress: [
          { to: [{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': contract.namespace } } }] },
          { to: [{ namespaceSelector: {}, podSelector: { matchLabels: { 'k8s-app': 'kube-dns' } } }], ports: [{ protocol: 'UDP', port: 53 }, { protocol: 'TCP', port: 53 }] },
        ],
      } : {}),
    },
  };
}

function workflowScalingResources(contract: WorkflowContract, name: string): GeneratedApplicationWorkflowResource[] {
  const scaling = contract.worker.deployment.scaling;
  if (scaling.mode !== 'kedaHatchetSlots') return [];
  const authName = `${name}-hatchet-metrics`;
  const tenantId = stringConfig(contract.providerConfig.tenantId);
  const apiUrl = stringConfig(contract.providerConfig.apiUrl) || `http://${contract.engineName}-api.${contract.namespace}.svc:8080`;
  const triggers = [...contract.tasks.map(({ task }) => task.name), ...contract.workflows.map(({ workflow }) => workflow.name)].map((contractName) => ({
    type: 'metrics-api',
    metadata: { targetValue: String(contract.worker.deployment.taskSlots), activationTargetValue: '1', url: `${apiUrl}/api/v1/tenants/${tenantId}/task-stats`, valueLocation: `${contractName}.queued.total`, authMode: 'bearer', timeout: '3000' },
    authenticationRef: { name: authName },
  }));
  return [
    { apiVersion: 'keda.sh/v1alpha1', kind: 'TriggerAuthentication', metadata: { name: authName, namespace: contract.namespace }, spec: { secretTargetRef: [{ parameter: 'token', name: contract.workerTokenSecret, key: contract.tokenKey }] } },
    { apiVersion: 'keda.sh/v1alpha1', kind: 'ScaledObject', metadata: { name, namespace: contract.namespace }, spec: { scaleTargetRef: { name }, pollingInterval: scaling.pollingIntervalSeconds, cooldownPeriod: 60, minReplicaCount: scaling.minReplicas, maxReplicaCount: scaling.maxReplicas, advanced: { horizontalPodAutoscalerConfig: { behavior: { scaleDown: { stabilizationWindowSeconds: 300 }, scaleUp: { stabilizationWindowSeconds: 0 } } } }, triggers } },
  ];
}

function objectConfig(value: unknown): Readonly<Record<string, unknown>> {
  // typecast: the preceding runtime guards narrow unknown to a non-array object whose fields are read defensively.
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {};
}

function stringConfig(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberConfig(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function kubernetesName(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
}

function jsName(value: string): string {
  return `declaration_${createHash('sha256').update(value).digest('hex').slice(0, 12)}`;
}

/**
 * Hatchet 1.24.3 starts heartbeats from a sibling worker-thread file resolved
 * through CommonJS __dirname. Generated workers are intentionally one
 * build-time-complete ESM artifact, so preserve the heartbeat protocol in the
 * main process instead of leaving a runtime filesystem/package dependency.
 */
function hatchetSingleFileHeartbeatPlugin(): Plugin {
  const namespace = 'applik8s-hatchet-heartbeat';
  return {
    name: 'applik8s-hatchet-single-file-heartbeat',
    setup(context) {
      context.onResolve({ filter: /heartbeat\/heartbeat-controller(?:\.js)?$/ }, () => ({ path: 'heartbeat-controller', namespace }));
      context.onLoad({ filter: /.*/, namespace }, () => ({
        loader: 'js',
        contents: `
export const STOP_HEARTBEAT = 'stop';
export class Heartbeat {
  constructor(client, workerId) {
    this.client = client.client;
    this.workerId = workerId;
    this.logger = client.config.logger('HeartbeatController', client.config.log_level);
    this.running = false;
  }
  async beat() {
    if (this.running) return;
    this.running = true;
    try {
      await this.client.heartbeat({ workerId: this.workerId, heartbeatAt: new Date() });
    } catch (error) {
      this.logger.error('Heartbeat failed: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      this.running = false;
    }
  }
  async start() {
    if (this.timer) return;
    await this.beat();
    this.timer = setInterval(() => { void this.beat(); }, 4000);
    this.timer.unref?.();
  }
  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
`,
      }));
    },
  };
}
