import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ApplicationGraph,
  ApplicationJobNode,
  ApplicationProviderNode,
} from '@applik8s/core';
import type { ApplicationFrameworkCredentialDependency } from '@applik8s/deployment-contract';
import { build } from 'esbuild';
import { generatedCallbackFactoryModule } from '../application-callback-module.js';
import type { GeneratedApplicationContainerArtifact } from '../application-containers/index.js';
import { emitGeneratedApplicationContainer } from '../application-containers/index.js';
import { applicationFrameworkCredentialDependencies } from '../application-framework-credentials.js';
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
  readonly jobs: readonly ApplicationJobNode[];
}

/** Emits one immutable controller/worker artifact for Kubernetes finite Jobs. */
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
  if (options.executionTarget !== undefined && options.executionTarget !== 'kubernetes') {
    if (provider.implementation === 'kubernetes-job-runtime') {
      throw new Error(`JobRuntime ${provider.id} selects Kubernetes but compilation targets ${options.executionTarget}.`);
    }
    return [];
  }
  if (provider.implementation === 'local-job-runtime') return [];
  if (provider.implementation !== 'kubernetes-job-runtime') {
    throw new Error(`Kubernetes compilation cannot lower JobRuntime implementation ${provider.implementation}.`);
  }
  const contract = jobControllerContract(options.graph, provider, jobs);
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
    nodePaths: [join(process.cwd(), 'node_modules')],
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
  const resources = jobControllerResources(contract, container.image, digest);
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
        physicalResource: 'batch/v1 Job',
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
    source: job.handlerSource,
    ...(job.handlerDependencies ? { dependencies: job.handlerDependencies } : {}),
    injectedIdentifiers: [],
    exportName: 'createCallback',
  }));
}

function generatedJobControllerSource(contract: JobControllerContract): string {
  const imports = contract.jobs.map((job, index) =>
    `import { createCallback as createJob${index} } from './${jobModuleName(job)}.generated.js';`,
  ).join('\n');
  const definitions = contract.jobs.map((job, index) => `{
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
    handler: createJob${index}({}),
  }`).join(',\n');
  return `
import { createServer } from 'node:http';
import { createApplicationJobControllerHandler } from '@applik8s/applik8s/job-controller-runtime';
import { validateApplicationAdmissionContextV1 } from '@applik8s/core';
import { createSignedEnvelopeCodec, signedEnvelopeUtf8Key, staticSignedEnvelopeKeyProvider } from '@applik8s/runtime';
import { createPostgresApplicationJobStore } from '@applik8s/runtime-postgres/job-store';
import { createKubernetesApplicationJobRuntime } from '@applik8s/runtime-kubernetes/job-runtime';
${imports}

function requiredEnv(name) { const value = process.env[name]; if (!value) throw new Error('Missing required environment variable ' + name); return value; }
function jsonSchema(schema, name) { return Object.freeze({ kind: 'jsonSchema', ref: { kind: 'jsonSchema', uri: 'generated:' + name }, schema }); }
const databaseUrl = requiredEnv('DATABASE_URL');
const applicationId = ${JSON.stringify(contract.graphName)};
const deploymentId = requiredEnv('APPLIK8S_DEPLOYMENT_ID');
const workerRunId = process.env.APPLIK8S_JOB_RUN_ID || process.argv[process.argv.indexOf('--applik8s-job-run') + 1];
const store = createPostgresApplicationJobStore({ databaseUrl, applicationId, deploymentId });
const runtime = await createKubernetesApplicationJobRuntime({
  applicationId,
  deploymentId,
  namespace: ${JSON.stringify(contract.namespace)},
  image: requiredEnv('APPLIK8S_JOB_IMAGE'),
  serviceAccountName: ${JSON.stringify(contract.serviceAccountName)},
  store,
  maximumConcurrency: ${contract.maximumConcurrency},
  resultRetentionSeconds: ${contract.resultRetentionSeconds},
  progressRetentionSeconds: ${contract.progressRetentionSeconds},
  ...(workerRunId ? { workerRunId, workerId: process.env.HOSTNAME || undefined } : {}),
  environment: [
    { name: 'DATABASE_URL', valueFrom: { secretKeyRef: { name: ${JSON.stringify(contract.database.secretName)}, key: ${JSON.stringify(contract.database.secretKey)}, optional: false } } },
    { name: 'APPLIK8S_DEPLOYMENT_ID', value: deploymentId },
    { name: 'APPLIK8S_JOB_IMAGE', value: requiredEnv('APPLIK8S_JOB_IMAGE') },
  ],
});
const definitions = [${definitions}];
for (const definition of definitions) runtime.register(definition);

async function close() { await runtime.close(); await store.close(); }
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
  if (databaseNamespace !== namespace) {
    throw new Error(`JobRuntime ${provider.id} is deployed to ${namespace}, but its PostgreSQL Secret is in ${databaseNamespace}. Kubernetes Secret env references must remain in one namespace.`);
  }
  const databaseName = applicationGraphStringValue(databaseProvider.clusterName)
    ?? applicationGraphStringValue(databaseProvider.name);
  if (!databaseName) throw new Error(`JobRuntime ${provider.id} PostgreSQL result store has no concrete database identity.`);
  const connectionSecret = record(databaseProvider.connectionSecret);
  return {
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
