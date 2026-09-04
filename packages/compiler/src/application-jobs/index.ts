// typecast-file-boundary: compiler-owned Job manifests validate graph discriminants before restoring callback and provider-specific artifact contracts.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ApplicationGraph,
  ApplicationJobNode,
  ApplicationProviderNode,
  ApplicationQueryNode,
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

export interface GeneratedApplicationJobArtifact {
  readonly name: string;
  readonly providerId: string;
  readonly jobIds: readonly string[];
  readonly sourcePath: string;
  readonly sourceMapPath: string;
  readonly manifestPath: string;
  readonly metafilePath: string;
  readonly digest: string;
  readonly sizeBytes: number;
  readonly container: GeneratedApplicationContainerArtifact;
  readonly resources: readonly GeneratedApplicationJobResource[];
  readonly frameworkCredentials: readonly ApplicationFrameworkCredentialDependency[];
}

export interface GeneratedApplicationJobResource {
  readonly apiVersion: string;
  readonly kind: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly spec?: Readonly<Record<string, unknown>>;
  readonly rules?: readonly Readonly<Record<string, unknown>>[];
  readonly roleRef?: Readonly<Record<string, unknown>>;
  readonly subjects?: readonly Readonly<Record<string, unknown>>[];
}

interface JobControllerContract {
  readonly executionTarget: 'kubernetes' | 'aws';
  readonly graphName: string;
  readonly provider: ApplicationProviderNode<'JobRuntime'>;
  readonly namespace: string;
  readonly name: string;
  readonly serviceAccountName: string;
  readonly port: number;
  readonly maximumConcurrency: number;
  readonly resultRetentionSeconds: number;
  readonly progressRetentionSeconds: number;
  readonly database: {
    readonly secretName: string;
    readonly secretKey: string;
  };
  readonly queryBatches: readonly {
    readonly jobId: string;
    readonly selection: Readonly<Record<string, unknown>> & { readonly digest: string };
    readonly lowering: NonNullable<ApplicationJobNode['queryBatch']>['lowering'];
    readonly query: ApplicationQueryNode & {
      readonly selection: NonNullable<ApplicationQueryNode['selection']>;
      readonly database: NonNullable<ApplicationQueryNode['database']>;
    };
  }[];
  readonly jobs: readonly ApplicationJobNode[];
}

/** Emits one immutable controller/worker artifact for maintained finite Jobs. */
export async function emitGeneratedApplicationJobs(options: {
  readonly graph: ApplicationGraph;
  readonly outDir: string;
  readonly entrypoint: string;
  readonly executionTarget?: 'kubernetes' | 'local' | 'aws-local' | 'aws';
}): Promise<readonly GeneratedApplicationJobArtifact[]> {
  const jobs = options.graph.nodes.filter(
    (node): node is ApplicationJobNode => node.kind === 'job',
  );
  if (jobs.length === 0) return [];
  const provider = options.graph.nodes.find(
    (node): node is ApplicationProviderNode<'JobRuntime'> =>
      node.kind === 'provider' && node.interface === 'JobRuntime',
  );
  if (!provider) throw new Error('Application Jobs require one selected JobRuntime provider.');
  const executionTarget = options.executionTarget ?? 'kubernetes';
  if (provider.implementation === 'local-job-runtime') return [];
  const expectedImplementation = executionTarget === 'kubernetes'
    ? 'kubernetes-job-runtime'
    : executionTarget === 'aws' || executionTarget === 'aws-local'
      ? 'aws-job-runtime'
      : undefined;
  if (!expectedImplementation) return [];
  if (provider.implementation !== expectedImplementation) {
    throw new Error(`${executionTarget} compilation cannot lower JobRuntime implementation ${provider.implementation}.`);
  }
  const contract = jobControllerContract(
    options.graph,
    provider,
    jobs,
    executionTarget === 'kubernetes' ? 'kubernetes' : 'aws',
  );
  await mkdir(options.outDir, { recursive: true });
  const generatedEntrypoint = join(options.outDir, 'job-controller.generated.ts');
  const sourcePath = join(options.outDir, 'job-controller.mjs');
  const sourceMapPath = `${sourcePath}.map`;
  const manifestPath = join(options.outDir, 'job-controller.manifest.json');
  const metafilePath = join(options.outDir, 'job-controller.esbuild-meta.json');

  await Promise.all(contract.jobs.map((job) => writeJobCallbackModule(options.outDir, job)));
  await writeFile(generatedEntrypoint, generatedJobControllerSource(contract));
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
    graphName: options.graph.metadata.name,
    workloadName: contract.name,
    role: 'job-runtime',
    artifactDir: options.outDir,
    sourcePath,
    sourceMapPath,
    entrypoint: '/app/job-controller.mjs',
    baseImage: runtimeImage,
    sourceDigest: digest,
  });
  const resources = contract.executionTarget === 'kubernetes'
    ? jobControllerResources(contract, container.image, digest)
    : [];
  const manifest = {
    apiVersion: 'applik8s.jobController/v1alpha1',
    kind: 'GeneratedApplicationJobController',
    metadata: { name: contract.name },
    spec: {
      graph: contract.graphName,
      provider: contract.provider.id,
      jobs: contract.jobs.map((job) => job.id),
      runtime: {
        entrypoint: sourcePath,
        sourceMap: sourceMapPath,
        digest,
        sizeBytes,
        distribution: 'ociImage',
        packageManagerAtStartup: false,
        image: container.image,
        baseImage: container.baseImage,
      },
      worker: {
        mode: 'sameImmutableArtifact',
        physicalResource: contract.executionTarget === 'kubernetes' ? 'batch/v1 Job' : 'AWS ECS Fargate task',
        durableAuthority: 'postgres',
      },
      container,
      resources: resources.map(({ apiVersion, kind, metadata }) => ({ apiVersion, kind, metadata })),
    },
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(metafilePath, `${JSON.stringify(result.metafile, null, 2)}\n`);
  return [{
    name: contract.name,
    providerId: contract.provider.id,
    jobIds: contract.jobs.map((job) => job.id),
    sourcePath,
    sourceMapPath,
    manifestPath,
    metafilePath,
    digest,
    sizeBytes,
    container,
    resources,
    frameworkCredentials: applicationFrameworkCredentialDependencies(source),
  }];
}

async function writeJobCallbackModule(
  outDir: string,
  job: ApplicationJobNode,
): Promise<void> {
  await writeFile(join(outDir, `${jobModuleName(job)}.generated.ts`), generatedCallbackFactoryModule({
    source: job.queryBatch?.handlerSource ?? job.handlerSource,
    ...((job.queryBatch?.handlerDependencies ?? job.handlerDependencies)
      ? { dependencies: job.queryBatch?.handlerDependencies ?? job.handlerDependencies }
      : {}),
    injectedIdentifiers: [],
    exportName: 'createCallback',
  }));
}

function generatedJobControllerSource(contract: JobControllerContract): string {
  const runtimeQueries = uniqueQueryBatchSources(contract.queryBatches);
  const imports = contract.jobs.map((job, index) =>
    `import { createCallback as createJob${index} } from './${jobModuleName(job)}.generated.js';`,
  ).join('\n');
  const definitions = contract.jobs.map((job, index) => {
    const queryBatch = contract.queryBatches.find((candidate) => candidate.jobId === job.id);
    const batch = job.queryBatch;
    if (queryBatch && !batch) {
      throw new Error(`Generated query-batch contract ${job.id} lost its batch policy.`);
    }
    let handler = `createJob${index}({})`;
    if (queryBatch && batch) {
      handler = `async (input, execution) => executeApplicationQueryBatch({ selection: ${JSON.stringify(queryBatch.selection)}, input, policy: ${JSON.stringify({
          consistency: batch.consistency,
          batch: { maxItems: batch.batch.maxItems },
          concurrency: batch.batch.concurrency,
          ...(job.retry.maxAttempts > 1 ? { retries: job.retry.maxAttempts - 1 } : {}),
          ...(job.executionDeadlineSeconds ? { timeout: `${job.executionDeadlineSeconds}s` } : {}),
          ...(batch.resources ? { resources: batch.resources } : {}),
        })}, handler: createJob${index}({}), execution })`;
    }
    return `{
    id: ${JSON.stringify(job.name)},
    contract: {
      input: jsonSchema(${JSON.stringify(job.contract.input.jsonSchema)}, ${JSON.stringify(`${job.name}.input`)}),
      output: jsonSchema(${JSON.stringify(job.contract.output.jsonSchema)}, ${JSON.stringify(`${job.name}.output`)}),
      ${job.contract.progress ? `progress: jsonSchema(${JSON.stringify(job.contract.progress.jsonSchema)}, ${JSON.stringify(`${job.name}.progress`)}),` : ''}
      ${job.contract.error ? `error: jsonSchema(${JSON.stringify(job.contract.error.jsonSchema)}, ${JSON.stringify(`${job.name}.error`)}),` : ''}
    },
    options: {
      retries: ${job.retry.maxAttempts - 1},
      ${job.executionDeadlineSeconds ? `timeout: ${JSON.stringify(`${job.executionDeadlineSeconds}s`)},` : ''}
      ${job.idempotency.expression?.source ? `idempotencyKey: (${job.idempotency.expression.source}),` : ''}
      retention: ${JSON.stringify(retentionOptions(job))},
    },
    handler: ${handler},
  }`;
  }).join(',\n');
  const batchRuntimeDeclarations = runtimeQueries.map(({ query, lowering }, index) => `
const queryBatchRuntime${index} = createPostgresApplicationQueryBatchRuntime({
  databaseUrl: requiredEnv(${JSON.stringify(query.database.connectionEnvName)}),
  applicationId,
  deploymentId,
  maximumSnapshotItems: ${lowering.maximumSnapshotItems},
  snapshotRetentionSeconds: ${lowering.maximumSnapshotAgeSeconds},
  ${query.database?.access ? `access: ${JSON.stringify({ context: query.database.access.context, setting: query.database.access.setting })},` : ''}
});`).join('\n');
  const batchRuntimeResolver = runtimeQueries.length > 0
    ? `const removeQueryBatchRuntimeResolver = installApplicationQueryBatchRuntimeResolver((selection) => {\n${runtimeQueries.map(({ selection }, index) => `  if (selection.digest === ${JSON.stringify(selection.digest)}) return queryBatchRuntime${index};`).join('\n')}\n  return undefined;\n});`
    : '';
  const batchRuntimeEnvironment = uniqueQueryBatchDatabases(runtimeQueries).map(({ query }) =>
    `{ name: ${JSON.stringify(query.database.connectionEnvName)}, valueFrom: { secretKeyRef: { name: ${JSON.stringify(query.database.secretName)}, key: ${JSON.stringify(query.database.secretKey)}, optional: false } } },`,
  ).join('\n    ');
  const batchRuntimeImports = runtimeQueries.length > 0
    ? `import { executeApplicationQueryBatch, installApplicationQueryBatchRuntimeResolver } from '@applik8s/applik8s/query-batch-runtime';\nimport { createPostgresApplicationQueryBatchRuntime } from '@applik8s/runtime-postgres/query-batch';`
    : '';
  const batchRuntimeClose = runtimeQueries.length > 0
    ? `removeQueryBatchRuntimeResolver(); await Promise.all([${runtimeQueries.map((_, index) => `queryBatchRuntime${index}.close()`).join(', ')}]);`
    : '';
  const providerRuntimeImport = contract.executionTarget === 'kubernetes'
    ? `import { createKubernetesApplicationJobRuntime } from '@applik8s/runtime-kubernetes/job-runtime';`
    : `import { createAwsApplicationJobRuntime, resolveAwsApplicationJobTaskIdentity } from '@applik8s/runtime-aws/job-runtime';`;
  const providerRuntimeInitialization = contract.executionTarget === 'kubernetes'
    ? `const runtime = await createKubernetesApplicationJobRuntime({
  applicationId,
  deploymentId,
  namespace: ${JSON.stringify(contract.namespace)},
  image: requiredEnv('APPLIK8S_JOB_IMAGE'),
  serviceAccountName: ${JSON.stringify(contract.serviceAccountName)},
  workerCommand: ['node', '/app/job-controller.mjs'],
  inCluster: true,
  store,
  maximumConcurrency: ${contract.maximumConcurrency},
  resultRetentionSeconds: ${contract.resultRetentionSeconds},
  progressRetentionSeconds: ${contract.progressRetentionSeconds},
  ...(workerRunId ? { workerRunId, workerId: process.env.HOSTNAME || undefined } : {}),
  environment: [
    { name: 'DATABASE_URL', valueFrom: { secretKeyRef: { name: ${JSON.stringify(contract.database.secretName)}, key: ${JSON.stringify(contract.database.secretKey)}, optional: false } } },
    { name: 'APPLIK8S_DEPLOYMENT_ID', value: deploymentId },
    { name: 'APPLIK8S_JOB_IMAGE', value: requiredEnv('APPLIK8S_JOB_IMAGE') },
    ${batchRuntimeEnvironment}
  ],
});`
    : `const taskIdentity = await resolveAwsApplicationJobTaskIdentity();
const runtime = await createAwsApplicationJobRuntime({
  applicationId,
  deploymentId,
  cluster: taskIdentity.cluster,
  taskDefinition: taskIdentity.taskDefinition,
  containerName: requiredEnv('APPLIK8S_AWS_JOB_CONTAINER'),
  subnets: jsonStringArrayEnv('APPLIK8S_AWS_JOB_SUBNETS'),
  securityGroups: jsonStringArrayEnv('APPLIK8S_AWS_JOB_SECURITY_GROUPS', false),
  region: process.env.AWS_REGION,
  store,
  resultRetentionSeconds: ${contract.resultRetentionSeconds},
  progressRetentionSeconds: ${contract.progressRetentionSeconds},
  ...(workerRunId ? { workerRunId, workerId: taskIdentity.taskArn } : {}),
});`;
  return `
import { createServer } from 'node:http';
import { createApplicationJobControllerHandler } from '@applik8s/applik8s/job-controller-runtime';
import { validateApplicationAdmissionContextV1 } from '@applik8s/core';
import { createSignedEnvelopeCodec, signedEnvelopeUtf8Key, staticSignedEnvelopeKeyProvider } from '@applik8s/runtime';
import { createPostgresApplicationJobStore } from '@applik8s/runtime-postgres/job-store';
${providerRuntimeImport}
${batchRuntimeImports}
${imports}

function requiredEnv(name) { const value = process.env[name]; if (!value) throw new Error('Missing required environment variable ' + name); return value; }
function jsonStringArrayEnv(name, required = true) {
  const raw = process.env[name];
  if (!raw && !required) return undefined;
  let value;
  try { value = JSON.parse(requiredEnv(name)); } catch (cause) { throw new Error('Environment variable ' + name + ' must contain a JSON string array.', { cause }); }
  if (!Array.isArray(value) || value.length === 0 || value.some(item => typeof item !== 'string' || !item)) throw new Error('Environment variable ' + name + ' must contain a non-empty JSON string array.');
  return value;
}
function jsonSchema(schema, name) { return Object.freeze({ kind: 'jsonSchema', ref: { kind: 'jsonSchema', uri: 'generated:' + name }, schema }); }
const databaseUrl = requiredEnv('DATABASE_URL');
const applicationId = ${JSON.stringify(contract.graphName)};
const deploymentId = requiredEnv('APPLIK8S_DEPLOYMENT_ID');
${batchRuntimeDeclarations}
${batchRuntimeResolver}
const workerArgumentIndex = process.argv.indexOf('--applik8s-job-run');
const workerRunId = process.env.APPLIK8S_JOB_RUN_ID || (workerArgumentIndex >= 0 ? process.argv[workerArgumentIndex + 1] : undefined);
const store = createPostgresApplicationJobStore({ databaseUrl, applicationId, deploymentId });
${providerRuntimeInitialization}
const definitions = [${definitions}];
for (const definition of definitions) runtime.register(definition);

async function close() { ${batchRuntimeClose} await runtime.close(); await store.close(); }
if (workerRunId) {
  const stored = await store.read(workerRunId);
  if (!stored) throw new Error('Durable Job run ' + workerRunId + ' was not found.');
  if (!definitions.some((definition) => definition.id === stored.reference.job)) throw new Error('Immutable worker artifact does not contain Job ' + stored.reference.job + '.');
  const run = await runtime.attach(stored.reference.job, stored.reference);
  await run.outcome();
  await close();
} else {
  const admissionCodec = createSignedEnvelopeCodec({
    purpose: 'applik8s.job-controller-admission/v1',
    keys: staticSignedEnvelopeKeyProvider({
      current: {
        id: 'application-internal-operation',
        key: signedEnvelopeUtf8Key(requiredEnv('APPLIK8S_INTERNAL_OPERATION_SECRET')),
      },
    }),
    validatePayload: value => validateApplicationAdmissionContextV1(value),
    maximumEncodedBytes: 32_768,
    maximumLifetimeMs: 60_000,
  });
  const handler = createApplicationJobControllerHandler({
    runtime,
    store,
    definitions,
    authorization: requiredEnv('APPLIK8S_INTERNAL_OPERATION_SECRET'),
    decodeAdmission: async envelope => (await admissionCodec.verify(envelope)).payload,
  });
  const server = createServer(async (incoming, outgoing) => {
    const body = incoming.method === 'GET' ? undefined : await new Promise((resolve, reject) => {
      const chunks = []; let size = 0;
      incoming.on('data', (chunk) => { size += chunk.length; if (size > 1_048_576) { reject(new Error('request_too_large')); incoming.destroy(); } else chunks.push(chunk); });
      incoming.on('end', () => resolve(Buffer.concat(chunks)));
      incoming.on('error', reject);
    });
    const request = new Request('http://job-controller' + (incoming.url || '/'), { method: incoming.method, headers: incoming.headers, ...(body ? { body, duplex: 'half' } : {}) });
    const response = await handler(request);
    outgoing.statusCode = response.status;
    response.headers.forEach((value, key) => outgoing.setHeader(key, value));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  });
  server.listen(${contract.port}, '0.0.0.0');
  const shutdown = async () => { server.close(); await close(); };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
}
`.trimStart();
}

function jobControllerContract(
  graph: ApplicationGraph,
  provider: ApplicationProviderNode<'JobRuntime'>,
  jobs: readonly ApplicationJobNode[],
  executionTarget: 'kubernetes' | 'aws',
): JobControllerContract {
  const config = record(provider.config);
  const namespace = applicationGraphStringValue(config.namespace)
    ?? applicationGraphStringValue(graph.metadata.namespace)
    ?? 'default';
  const name = kubernetesName(`${graph.metadata.name}-jobs`);
  const databaseProvider = unwrapApplicationProvider(
    record(record(config.results).database),
  );
  const databaseNamespace = applicationGraphStringValue(databaseProvider.namespace) ?? namespace;
  if (executionTarget === 'kubernetes' && databaseNamespace !== namespace) {
    throw new Error(`JobRuntime ${provider.id} is deployed to ${namespace}, but its PostgreSQL Secret is in ${databaseNamespace}. Kubernetes Secret env references must remain in one namespace.`);
  }
  const databaseName = applicationGraphStringValue(databaseProvider.clusterName)
    ?? applicationGraphStringValue(databaseProvider.name);
  if (!databaseName) throw new Error(`JobRuntime ${provider.id} PostgreSQL result store has no concrete database identity.`);
  const connectionSecret = record(databaseProvider.connectionSecret);
  const queryBatches = jobs.flatMap((job) => {
    if (!job.queryBatch) return [];
    const query = graph.nodes.find((candidate) => candidate.id === job.queryBatch?.query.nodeId);
    if (query?.kind !== 'query' || !query.selection || !query.database) {
      throw new Error(`Application query batch Job ${job.id} references an incomplete selection-backed PostgreSQL Query.`);
    }
    const queryNamespace = applicationGraphStringValue(query.database.secretNamespace) ?? namespace;
    if (queryNamespace !== namespace) {
      throw new Error(
        `Application query batch Job ${job.id} is deployed to ${namespace}, but Query ${query.id} uses a PostgreSQL Secret in ${queryNamespace}.`,
      );
    }
    if (job.queryBatch.consistency.mode !== 'repeatableSnapshot') {
      throw new Error(
        `PostgreSQL query batch Job ${job.id} requests ${job.queryBatch.consistency.mode}, but the maintained v0.9 provider currently qualifies repeatableSnapshot only.`,
      );
    }
    const batchQuery = query as ApplicationQueryNode & {
      readonly selection: NonNullable<ApplicationQueryNode['selection']>;
      readonly database: NonNullable<ApplicationQueryNode['database']>;
    };
    return [{
      jobId: job.id,
      selection: jobQuerySelectionContract(graph, batchQuery),
      lowering: job.queryBatch.lowering,
      query: batchQuery,
    }];
  });
  return {
    executionTarget,
    graphName: graph.metadata.name,
    provider,
    namespace,
    name,
    serviceAccountName: name,
    port: 8091,
    maximumConcurrency: integer(config.maximumConcurrency) ?? 4,
    resultRetentionSeconds: integer(config.resultRetentionSeconds) ?? 86_400,
    progressRetentionSeconds: Math.max(
      60,
      ...jobs.map((job) => job.retention.progressSeconds ?? 86_400),
    ),
    database: {
      secretName: applicationGraphStringValue(connectionSecret.name) ?? `${databaseName}-app`,
      secretKey: applicationGraphStringValue(databaseProvider.connectionSecretKey) ?? 'uri',
    },
    queryBatches,
    jobs,
  };
}

function jobControllerResources(
  contract: JobControllerContract,
  image: string,
  digest: string,
): readonly GeneratedApplicationJobResource[] {
  const labels = {
    'app.kubernetes.io/name': contract.name,
    'app.kubernetes.io/component': 'job-controller',
    'app.kubernetes.io/managed-by': 'applik8s',
  };
  const metadata = { name: contract.name, namespace: contract.namespace, labels };
  return [
    { apiVersion: 'v1', kind: 'ServiceAccount', metadata },
    {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'Role',
      metadata,
      rules: [{ apiGroups: ['batch'], resources: ['jobs'], verbs: ['create', 'get', 'delete'] }],
    },
    {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'RoleBinding',
      metadata,
      roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name: contract.name },
      subjects: [{ kind: 'ServiceAccount', name: contract.serviceAccountName, namespace: contract.namespace }],
    },
    {
      apiVersion: 'v1',
      kind: 'Service',
      metadata,
      spec: { selector: labels, ports: [{ name: 'http', port: contract.port, targetPort: 'http' }] },
    },
    {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'NetworkPolicy',
      metadata,
      spec: {
        podSelector: { matchLabels: labels },
        policyTypes: ['Ingress', 'Egress'],
        ingress: [{ from: [{ podSelector: {} }], ports: [{ protocol: 'TCP', port: contract.port }] }],
        egress: [
          { to: [{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'kube-system' } }, podSelector: { matchLabels: { 'k8s-app': 'kube-dns' } } }], ports: [{ protocol: 'UDP', port: 53 }, { protocol: 'TCP', port: 53 }] },
          { ports: [{ protocol: 'TCP', port: 443 }, { protocol: 'TCP', port: 5432 }] },
        ],
      },
    },
    {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata,
      spec: {
        replicas: 1,
        selector: { matchLabels: labels },
        strategy: { type: 'RollingUpdate', rollingUpdate: { maxUnavailable: 0, maxSurge: 1 } },
        template: {
          metadata: { labels, annotations: { 'applik8s.dev/runtime-digest': digest } },
          spec: {
            serviceAccountName: contract.serviceAccountName,
            automountServiceAccountToken: true,
            terminationGracePeriodSeconds: 30,
            securityContext: { runAsNonRoot: true, runAsUser: 1000, runAsGroup: 1000, seccompProfile: { type: 'RuntimeDefault' } },
            containers: [{
              name: 'controller',
              image,
              imagePullPolicy: 'IfNotPresent',
              command: ['node', '/app/job-controller.mjs'],
              ports: [{ name: 'http', containerPort: contract.port }],
              env: [
                { name: 'DATABASE_URL', valueFrom: { secretKeyRef: { name: contract.database.secretName, key: contract.database.secretKey, optional: false } } },
                { name: 'APPLIK8S_DEPLOYMENT_ID', value: contract.namespace },
                { name: 'APPLIK8S_JOB_IMAGE', value: image },
                { name: 'APPLIK8S_INTERNAL_OPERATION_SECRET', valueFrom: { secretKeyRef: { name: `${contract.graphName}-internal-operation`, key: 'key', optional: false } } },
                ...uniqueQueryBatchDatabases(contract.queryBatches).map(({ query }) => ({
                  name: query.database.connectionEnvName,
                  valueFrom: { secretKeyRef: { name: query.database.secretName, key: query.database.secretKey, optional: false } },
                })),
              ],
              readinessProbe: { httpGet: { path: '/readyz', port: 'http' }, periodSeconds: 5, timeoutSeconds: 2 },
              livenessProbe: { httpGet: { path: '/healthz', port: 'http' }, periodSeconds: 10, timeoutSeconds: 2 },
              securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ['ALL'] } },
              resources: { requests: { cpu: '50m', memory: '96Mi' }, limits: { memory: '256Mi' } },
            }],
          },
        },
      },
    },
  ];
}

function retentionOptions(job: ApplicationJobNode): Record<string, string> {
  return {
    ...(job.retention.resultSeconds ? { result: `${job.retention.resultSeconds}s` } : {}),
    ...(job.retention.progressSeconds ? { progress: `${job.retention.progressSeconds}s` } : {}),
    ...(job.retention.applicationFactsSeconds ? { applicationFacts: `${job.retention.applicationFactsSeconds}s` } : {}),
    ...(job.retention.providerAttemptsSeconds ? { providerAttempts: `${job.retention.providerAttemptsSeconds}s` } : {}),
  };
}

function uniqueQueryBatchSources(
  queryBatches: JobControllerContract['queryBatches'],
): JobControllerContract['queryBatches'] {
  const seen = new Set<string>();
  return queryBatches.filter(({ selection }) => {
    if (seen.has(selection.digest)) return false;
    seen.add(selection.digest);
    return true;
  });
}

function jobQuerySelectionContract(
  graph: ApplicationGraph,
  query: ApplicationQueryNode & { readonly selection: NonNullable<ApplicationQueryNode['selection']> },
): Readonly<Record<string, unknown>> & { readonly digest: string } {
  const source = graph.nodes.find((candidate) => candidate.id === query.selection.sourceModel.nodeId);
  if (source?.kind !== 'model') {
    throw new Error(`Application query batch ${query.id} references missing source model ${query.selection.sourceModel.nodeId}.`);
  }
  return {
    ...query.selection,
    sourceModel: source.name,
    relationshipReads: query.selection.relationshipReads.map((reference) => {
      const related = graph.nodes.find((candidate) => candidate.id === reference.nodeId);
      if (related?.kind !== 'model') {
        throw new Error(`Application query batch ${query.id} references missing related model ${reference.nodeId}.`);
      }
      return related.name;
    }),
  };
}

function uniqueQueryBatchDatabases(
  queryBatches: JobControllerContract['queryBatches'],
): JobControllerContract['queryBatches'] {
  const seen = new Set<string>();
  return queryBatches.filter(({ query }) => {
    const environmentName = query.database?.connectionEnvName;
    if (!environmentName || seen.has(environmentName)) return false;
    seen.add(environmentName);
    return true;
  });
}

function unwrapApplicationProvider(value: Record<string, unknown>): Record<string, unknown> {
  return value.kind === 'applicationProvider' ? record(value.implementation) : value;
}

function record(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    // typecast: retain object keys after rejecting arrays and primitives at the graph JSON boundary.
    return value as Record<string, unknown>;
  }
  return {};
}

function integer(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : undefined;
}

function jobModuleName(job: ApplicationJobNode): string {
  return `job-${createHash('sha256').update(job.id).digest('hex').slice(0, 16)}`;
}

function kubernetesName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63) || 'jobs';
}
