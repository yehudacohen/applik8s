// typecast-file-boundary: Validated graph configuration becomes generated runtime and Kubernetes JSON at this compiler boundary.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ApplicationGraph, ApplicationLakehousePublicationNode, ApplicationProviderNode } from '@applik8s/core';
import { build } from 'esbuild';
import { generatedCallbackFactoryModule } from '../application-callback-module.js';
import { emitGeneratedApplicationContainer, type GeneratedApplicationContainerArtifact } from '../application-containers/index.js';
import { applicationGraphBooleanCondition, applicationGraphInterpolate, applicationGraphJsonStringArray, applicationGraphStringValue } from '../application-installation-values.js';
import { applik8sWorkspaceSourcePlugin } from '../bundling/index.js';

const runtimeImage = 'node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2';

export interface GeneratedApplicationLakehousePublisherArtifact {
  readonly name: string;
  readonly publicationId: string;
  readonly sourcePath: string;
  readonly sourceMapPath: string;
  readonly localSourcePath: string;
  readonly localSourceMapPath: string;
  readonly localDigest: `sha256:${string}`;
  readonly localSizeBytes: number;
  readonly manifestPath: string;
  readonly digest: `sha256:${string}`;
  readonly sizeBytes: number;
  readonly container: GeneratedApplicationContainerArtifact;
  readonly resources: readonly GeneratedApplicationLakehousePublisherResource[];
}

export interface GeneratedApplicationLakehousePublisherResource {
  readonly apiVersion: string;
  readonly kind: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly spec?: Readonly<Record<string, unknown>>;
}

interface DatasetConfiguration {
  readonly kind: 'duckdb-dataset' | 's3-dataset';
  readonly targets?: readonly ('local' | 'aws-local' | 'aws' | 'kubernetes')[];
  readonly root?: string;
  readonly bucket?: string;
  readonly prefix?: string;
  readonly region?: string;
  readonly catalog?: string;
  readonly schemaRevision: string;
  readonly cursorSecretEnvironment: string;
  readonly maximumObjectsPerSnapshot?: number;
  readonly retainedSnapshots?: number;
}

interface PublisherContract {
  readonly graph: ApplicationGraph;
  readonly publication: ApplicationLakehousePublicationNode & { readonly eventLog: NonNullable<ApplicationLakehousePublicationNode['eventLog']> };
  readonly eventLog: ApplicationProviderNode;
  readonly qualification: string;
  readonly datasets: readonly DatasetConfiguration[];
  readonly namespace?: string;
  readonly servers: readonly string[];
  readonly stream: string;
  readonly streamResourceName: string;
  readonly provisionStream: boolean;
  readonly streamIncludeWhen?: string;
  readonly streamReplicas: number;
  readonly subjectPrefix: string;
  readonly consumer: string;
  readonly connectionSecret?: { readonly name: string; readonly authMode: 'token' | 'userPassword'; readonly tokenKey: string; readonly userKey: string; readonly passwordKey: string };
}

export async function emitGeneratedApplicationLakehousePublishers(options: {
  readonly graph: ApplicationGraph;
  readonly outDir: string;
  readonly executionTarget?: 'kubernetes' | 'local' | 'aws-local' | 'aws';
}): Promise<readonly GeneratedApplicationLakehousePublisherArtifact[]> {
  const publications = options.graph.nodes.filter((node): node is ApplicationLakehousePublicationNode => node.kind === 'lakehousePublication');
  if (publications.length === 0) return [];
  await mkdir(options.outDir, { recursive: true });
  const streams = new Set(options.graph.nodes.flatMap((node) =>
    node.kind === 'processor' && node.eventLog?.nodeId ? [node.eventLog.nodeId] : []));
  const artifacts: GeneratedApplicationLakehousePublisherArtifact[] = [];
  for (const publication of publications) {
    const eventLog = publication.eventLog;
    if (!eventLog) throw new Error(`Lakehouse publication ${publication.id} has no executable EventLog binding.`);
    const boundPublication = { ...publication, eventLog };
    const contract = publisherContract(options.graph, boundPublication, !streams.has(eventLog.nodeId));
    streams.add(eventLog.nodeId);
    artifacts.push(await emitPublisher(
      contract,
      options.outDir,
      options.executionTarget === 'aws' || options.executionTarget === 'aws-local'
        ? 'aws'
        : 'kubernetes',
    ));
  }
  return artifacts;
}

async function emitPublisher(
  contract: PublisherContract,
  outDir: string,
  executionTarget: 'kubernetes' | 'aws',
): Promise<GeneratedApplicationLakehousePublisherArtifact> {
  const directory = join(outDir, contract.consumer);
  await mkdir(directory, { recursive: true });
  const transformModule = 'transform.generated';
  const partitionModule = contract.publication.partition ? 'partition.generated' : undefined;
  await writeFile(join(directory, `${transformModule}.ts`), generatedCallbackFactoryModule({
    source: contract.publication.transform.source,
    ...(contract.publication.transform.dependencies ? { dependencies: contract.publication.transform.dependencies } : {}),
    injectedIdentifiers: [],
    exportName: 'createCallback',
  }));
  if (contract.publication.partition && partitionModule) {
    await writeFile(join(directory, `${partitionModule}.ts`), generatedCallbackFactoryModule({
      source: contract.publication.partition.source,
      ...(contract.publication.partition.dependencies ? { dependencies: contract.publication.partition.dependencies } : {}),
      injectedIdentifiers: [],
      exportName: 'createCallback',
    }));
  }
  const generated = join(directory, 'publisher.cloud.generated.ts');
  const sourcePath = join(directory, 'publisher.mjs');
  const sourceMapPath = `${sourcePath}.map`;
  const localGenerated = join(directory, 'publisher.local.generated.ts');
  const localSourcePath = join(directory, 'publisher.local.mjs');
  const localSourceMapPath = `${localSourcePath}.map`;
  const manifestPath = join(directory, 'publisher.manifest.json');
  await writeFile(generated, publisherSource(contract, transformModule, partitionModule, executionTarget));
  await writeFile(localGenerated, publisherSource(contract, transformModule, partitionModule, 'local'));
  await build({
    entryPoints: [generated], outfile: sourcePath, bundle: true, format: 'esm', platform: 'node', target: 'node22',
    legalComments: 'none', minify: true, keepNames: true, lineLimit: 120, sourcemap: 'external', sourcesContent: false,
    nodePaths: [join(process.cwd(), 'node_modules')],
    banner: { js: "import { createRequire as __applik8sCreateRequire } from 'node:module'; const require = __applik8sCreateRequire(import.meta.url);" },
    supported: { 'template-literal': false }, plugins: [applik8sWorkspaceSourcePlugin()],
  });
  await build({
    entryPoints: [localGenerated], outfile: localSourcePath, bundle: true, format: 'esm', platform: 'node', target: 'node22',
    legalComments: 'none', minify: true, keepNames: true, lineLimit: 120, sourcemap: 'external', sourcesContent: false,
    nodePaths: [join(process.cwd(), 'node_modules')], external: ['@duckdb/node-api', '@duckdb/node-bindings', '@duckdb/node-bindings-*'],
    banner: { js: "import { createRequire as __applik8sCreateRequire } from 'node:module'; const require = __applik8sCreateRequire(import.meta.url);" },
    supported: { 'template-literal': false }, plugins: [applik8sWorkspaceSourcePlugin()],
  });
  const source = await readFile(sourcePath);
  const localSource = await readFile(localSourcePath);
  const digest = `sha256:${createHash('sha256').update(source).digest('hex')}` as const;
  const localDigest = `sha256:${createHash('sha256').update(localSource).digest('hex')}` as const;
  const container = await emitGeneratedApplicationContainer({
    graphName: contract.graph.metadata.name,
    workloadName: contract.consumer,
    role: 'lakehouse-publisher',
    artifactDir: directory,
    sourcePath,
    sourceMapPath,
    entrypoint: '/app/publisher.mjs',
    baseImage: runtimeImage,
    sourceDigest: digest,
  });
  const resources = publisherResources(contract, container.image, digest);
  await writeFile(manifestPath, `${JSON.stringify({
    apiVersion: 'applik8s.lakehousePublisher/v1alpha1', kind: 'GeneratedLakehousePublisher',
    metadata: { name: contract.consumer },
    spec: {
      graph: contract.graph.metadata.name,
      publication: contract.publication.id,
      sourceEvent: contract.publication.sourceContract,
      dataset: contract.publication.dataset,
      runtime: { source: sourcePath, digest, sizeBytes: source.byteLength, image: container.image },
      localRuntime: { source: localSourcePath, digest: localDigest, sizeBytes: localSource.byteLength },
      guarantees: { delivery: 'atLeastOnce', checkpoint: 'afterManifestReceipt', logicalDeduplication: 'source-frontier' },
    },
  }, null, 2)}\n`);
  return { name: contract.consumer, publicationId: contract.publication.id, sourcePath, sourceMapPath, localSourcePath, localSourceMapPath, localDigest, localSizeBytes: localSource.byteLength, manifestPath, digest, sizeBytes: source.byteLength, container, resources };
}

function publisherSource(
  contract: PublisherContract,
  transformModule: string,
  partitionModule: string | undefined,
  runtimeTarget: 'local' | 'kubernetes' | 'aws',
): string {
  const publication = contract.publication;
  return `
import { rm, writeFile } from 'node:fs/promises';
import { executeApplicationLakehousePublication, installApplicationLakehousePublicationRuntimeResolver } from '@applik8s/applik8s/lakehouse-runtime';
${runtimeTarget === 'local'
  ? "import { createDuckDbApplicationLakehouseRuntime } from '@applik8s/runtime-duckdb';\nimport { startJetStreamEventConsumer } from '@applik8s/runtime-nats/event-consumer';"
  : runtimeTarget === 'aws'
    ? "import { createAwsApplicationLakehouseDatasetRuntime } from '@applik8s/runtime-aws/lakehouse';\nimport { startKinesisEventConsumer } from '@applik8s/runtime-aws/kinesis';"
    : "import { createAwsApplicationLakehouseDatasetRuntime } from '@applik8s/runtime-aws/lakehouse';\nimport { startJetStreamEventConsumer } from '@applik8s/runtime-nats/event-consumer';"}
import { normalizeSchema } from '@applik8s/sdk';
import { createCallback as createTransform } from './${transformModule}.js';
${partitionModule ? `import { createCallback as createPartition } from './${partitionModule}.js';` : ''}

function requiredEnv(name) { const value = process.env[name]; if (!value) throw new Error('Missing required environment variable ' + name); return value; }
function runtimeJsonSchema(schema, exportName) {
  const normalized = normalizeSchema({ kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName }, schema });
  if (!normalized.ok) throw new Error(normalized.error.message);
  return normalized.value;
}
const transform = createTransform({});
${partitionModule ? 'const partition = createPartition({});' : ''}
const Publication = {
  kind: 'applicationLakehousePublication',
  event: { id: ${JSON.stringify(publication.sourceEventId)}, payload: runtimeJsonSchema(${JSON.stringify(publication.source.jsonSchema)}, ${JSON.stringify(`${publication.sourceEventId}.payload`)}) },
  dataset: { name: 'LakehouseDataset', qualification: { name: ${JSON.stringify(contract.qualification)} } },
  transform,
  ${partitionModule ? 'partition,' : ''}
};
const datasets = ${JSON.stringify(contract.datasets)};
const target = process.env.APPLIK8S_DEPLOYMENT_TARGET ?? 'local';
const overrides = process.env.APPLIK8S_AWS_LAKEHOUSE_BINDINGS ? JSON.parse(process.env.APPLIK8S_AWS_LAKEHOUSE_BINDINGS) : { datasets: {} };
const selected = datasets.find((candidate) => !candidate.targets || candidate.targets.includes(target) || (target === 'aws-local' && candidate.targets.includes('aws')));
if (!selected) throw new Error('No LakehouseDataset runtime branch supports target ' + target + '.');
const runtime = ${runtimeTarget === 'local' ? `selected.kind === 'duckdb-dataset'
  ? await createDuckDbApplicationLakehouseRuntime({
      datasetId: ${JSON.stringify(contract.qualification)}, schemaRevision: selected.schemaRevision,
      schema: runtimeJsonSchema(${JSON.stringify(publication.row.jsonSchema)}, ${JSON.stringify(`${contract.qualification}.row`)}),
      cursorKey: requiredEnv(selected.cursorSecretEnvironment), root: selected.root,
      maximumObjectsPerSnapshot: selected.maximumObjectsPerSnapshot, retainedSnapshots: selected.retainedSnapshots,
    })
  : (() => { throw new Error('Local lakehouse publishers require a DuckDB dataset branch.'); })()` : `selected.kind === 's3-dataset'
  ? (() => {
      const override = overrides.datasets?.[${JSON.stringify(contract.qualification)}] ?? {};
      return createAwsApplicationLakehouseDatasetRuntime({
        datasetId: ${JSON.stringify(contract.qualification)}, bucket: override.bucket ?? selected.bucket,
        prefix: override.prefix ?? selected.prefix, region: override.region ?? selected.region ?? process.env.AWS_REGION,
        catalogDatabase: override.catalogDatabase ?? selected.catalog, schemaRevision: selected.schemaRevision,
        schema: runtimeJsonSchema(${JSON.stringify(publication.row.jsonSchema)}, ${JSON.stringify(`${contract.qualification}.row`)}),
        cursorKey: requiredEnv(selected.cursorSecretEnvironment),
        maximumObjectsPerSnapshot: selected.maximumObjectsPerSnapshot, retainedSnapshots: selected.retainedSnapshots,
      });
    })()
  : (() => { throw new Error('Cloud lakehouse publishers require an S3 dataset branch.'); })()`};
const disposeRuntime = installApplicationLakehousePublicationRuntimeResolver((qualification) => qualification === ${JSON.stringify(contract.qualification)} ? runtime : undefined);
const binding = {
  bindingId: ${JSON.stringify(contract.consumer)},
  contract: ${JSON.stringify(publication.sourceContract)},
  execute: (envelope) => executeApplicationLakehousePublication(Publication, envelope),
};
const runner = ${runtimeTarget === 'aws' ? `await startKinesisEventConsumer({
      streamName: requiredEnv('APPLIK8S_KINESIS_STREAM'), checkpointTable: requiredEnv('APPLIK8S_KINESIS_CHECKPOINT_TABLE'),
      consumer: process.env.APPLIK8S_KINESIS_CONSUMER ?? ${JSON.stringify(contract.consumer)}, bindings: [binding],
      region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION,
      logger: (record) => console.log(JSON.stringify(record)),
    })` : `await startJetStreamEventConsumer({
      servers: JSON.parse(requiredEnv('APPLIK8S_NATS_SERVERS')), stream: requiredEnv('APPLIK8S_NATS_STREAM'), consumer: ${JSON.stringify(contract.consumer)},
      subjectPrefix: requiredEnv('APPLIK8S_NATS_SUBJECT_PREFIX'), bindings: [binding], connectionName: ${JSON.stringify(`applik8s-${contract.consumer}`)},
      token: process.env.APPLIK8S_NATS_TOKEN, user: process.env.APPLIK8S_NATS_USER, pass: process.env.APPLIK8S_NATS_PASSWORD,
      logger: (record) => console.log(JSON.stringify(record)),
    })`};
const heartbeat = '/tmp/applik8s-lakehouse-publisher-heartbeat';
await writeFile('/tmp/applik8s-lakehouse-publisher-ready', 'ready\\n');
await writeFile(heartbeat, String(Date.now()));
const pulse = setInterval(() => { void writeFile(heartbeat, String(Date.now())); }, 10_000);
let draining = false;
async function drain(signal) {
  if (draining) return;
  draining = true;
  clearInterval(pulse);
  await rm('/tmp/applik8s-lakehouse-publisher-ready', { force: true });
  await runner.drain();
  disposeRuntime();
  console.log(JSON.stringify({ event: 'applik8s-lakehouse-publisher-drained', signal }));
}
process.once('SIGTERM', () => void drain('SIGTERM'));
process.once('SIGINT', () => void drain('SIGINT'));
await runner.closed;
`;
}

function publisherContract(
  graph: ApplicationGraph,
  publication: ApplicationLakehousePublicationNode & { readonly eventLog: NonNullable<ApplicationLakehousePublicationNode['eventLog']> },
  ownsStream: boolean,
): PublisherContract {
  const eventLog = graph.nodes.find((node): node is ApplicationProviderNode => node.kind === 'provider' && node.id === publication.eventLog.nodeId);
  const dataset = graph.nodes.find((node): node is ApplicationProviderNode => node.kind === 'provider' && node.id === publication.dataset.nodeId);
  if (!eventLog || eventLog.interface !== 'EventLog') throw new Error(`Lakehouse publication ${publication.id} references missing EventLog ${publication.eventLog.nodeId}.`);
  if (!dataset || dataset.interface !== 'LakehouseDataset') throw new Error(`Lakehouse publication ${publication.id} references missing LakehouseDataset ${publication.dataset.nodeId}.`);
  const eventConfig = targetConfiguration(eventLog, 'kubernetes') ?? objectConfig(eventLog.config);
  const qualification = stringValue(objectConfig(dataset.config?.qualification).name);
  if (!qualification) throw new Error(`Lakehouse publication ${publication.id} references an unqualified dataset provider.`);
  const datasets = targetConfigurations(dataset).map(({ configuration, targets }) => {
    const kind = stringValue(configuration.kind);
    if (kind !== 'duckdb-dataset' && kind !== 's3-dataset') throw new Error(`Lakehouse publisher ${publication.id} cannot run dataset implementation ${kind || '<unknown>'}.`);
    const cursorSecretEnvironment = stringValue(configuration.cursorSecretEnvironment) || 'APPLIK8S_CURSOR_SECRET';
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(cursorSecretEnvironment)) throw new Error(`Lakehouse publisher ${publication.id} has invalid cursor Secret environment ${cursorSecretEnvironment}.`);
    const maximumObjectsPerSnapshot = positiveInteger(configuration.maximumObjectsPerSnapshot);
    const retainedSnapshots = positiveInteger(configuration.retainedSnapshots);
    return {
      kind,
      ...(targets ? { targets } : {}),
      root: stringValue(configuration.root) || `.applik8s/state/lakehouse/${qualification}`,
      bucket: stringValue(configuration.bucket), prefix: stringValue(configuration.prefix) || `lakehouse/${qualification}`,
      region: stringValue(configuration.region), catalog: stringValue(configuration.catalog),
      schemaRevision: stringValue(configuration.schemaRevision) || 'v1', cursorSecretEnvironment,
      ...(maximumObjectsPerSnapshot ? { maximumObjectsPerSnapshot } : {}),
      ...(retainedSnapshots ? { retainedSnapshots } : {}),
    } satisfies DatasetConfiguration;
  });
  const namespace = applicationGraphStringValue(eventConfig.namespace) || applicationGraphStringValue(graph.metadata.namespace) || undefined;
  const serviceName = applicationGraphStringValue(eventConfig.name) || 'applik8s-events';
  const servers = Array.isArray(eventConfig.servers) ? eventConfig.servers.map(applicationGraphStringValue).filter((value): value is string => Boolean(value)) : [];
  const runtimeBinding = graph.providerBindings.find((binding) => binding.provider.nodeId === eventLog.id && binding.requirement === `requirement.${publication.id}.event-log`);
  const secret = runtimeBinding?.runtime.secretRefs?.[0];
  const authMode = stringValue(eventConfig.authMode) === 'userPassword' ? 'userPassword' as const : 'token' as const;
  const streamCondition = applicationGraphBooleanCondition(eventConfig.provision);
  return {
    graph, publication, eventLog, qualification, datasets,
    ...(namespace ? { namespace } : {}),
    servers: servers.length ? servers : [`nats://${serviceName}${namespace ? `.${namespace}` : ''}.svc:4222`],
    stream: applicationGraphStringValue(eventConfig.stream) || 'APPLIK8S_EVENTS',
    streamResourceName: kubernetesName(serviceName),
    provisionStream: ownsStream && streamCondition !== 'false',
    ...(ownsStream && streamCondition && streamCondition !== 'true' ? { streamIncludeWhen: streamCondition } : {}),
    streamReplicas: positiveInteger(eventConfig.replicas) ?? 1,
    subjectPrefix: applicationGraphStringValue(eventConfig.subjectPrefix) || 'applik8s',
    consumer: kubernetesName(`lakehouse-${publication.name}-${createHash('sha256').update(publication.id).digest('hex').slice(0, 8)}`),
    ...(secret?.name ? { connectionSecret: { name: secret.name, authMode, tokenKey: stringValue(eventConfig.tokenKey) || 'token', userKey: stringValue(eventConfig.userKey) || 'user', passwordKey: stringValue(eventConfig.passwordKey) || 'password' } } : {}),
  };
}

function publisherResources(contract: PublisherContract, image: string, digest: string): readonly GeneratedApplicationLakehousePublisherResource[] {
  const labels = { 'app.kubernetes.io/name': contract.consumer, 'app.kubernetes.io/component': 'lakehouse-publisher', 'app.kubernetes.io/managed-by': 'applik8s' };
  const metadata = { name: contract.consumer, ...(contract.namespace ? { namespace: contract.namespace } : {}), labels };
  const cursorEnvironments = [...new Set(contract.datasets.map(({ cursorSecretEnvironment }) => cursorSecretEnvironment))];
  const env: unknown[] = [
    { name: 'NODE_OPTIONS', value: '--enable-source-maps' }, { name: 'APPLIK8S_DEPLOYMENT_TARGET', value: 'kubernetes' },
    { name: 'APPLIK8S_NATS_SERVERS', value: applicationGraphJsonStringArray(contract.servers) },
    { name: 'APPLIK8S_NATS_STREAM', value: contract.stream }, { name: 'APPLIK8S_NATS_SUBJECT_PREFIX', value: contract.subjectPrefix },
    ...cursorEnvironments.map((name) => ({ name, valueFrom: { secretKeyRef: { name: `${kubernetesName(contract.graph.metadata.name)}-lakehouse-cursor`, key: 'key', optional: false } } })),
  ];
  if (contract.connectionSecret?.authMode === 'token') env.push({ name: 'APPLIK8S_NATS_TOKEN', valueFrom: { secretKeyRef: { name: contract.connectionSecret.name, key: contract.connectionSecret.tokenKey, optional: false } } });
  if (contract.connectionSecret?.authMode === 'userPassword') env.push(
    { name: 'APPLIK8S_NATS_USER', valueFrom: { secretKeyRef: { name: contract.connectionSecret.name, key: contract.connectionSecret.userKey, optional: false } } },
    { name: 'APPLIK8S_NATS_PASSWORD', valueFrom: { secretKeyRef: { name: contract.connectionSecret.name, key: contract.connectionSecret.passwordKey, optional: false } } },
  );
  const filter = applicationGraphInterpolate(contract.subjectPrefix, `.events.${subjectToken(contract.publication.sourceContract.name)}.${subjectToken(contract.publication.sourceContract.version)}.>`);
  return [
    ...(contract.provisionStream ? [{
      apiVersion: 'jetstream.nats.io/v1beta2', kind: 'Stream',
      metadata: { ...metadata, name: contract.streamResourceName, ...(contract.streamIncludeWhen ? { annotations: { 'applik8s.dev/include-when': contract.streamIncludeWhen } } : {}) },
      spec: { name: contract.stream, subjects: [applicationGraphInterpolate(contract.subjectPrefix, '.>')], retention: 'limits', storage: 'file', replicas: contract.streamReplicas, duplicateWindow: '2m', servers: contract.servers },
    }] : []),
    { apiVersion: 'jetstream.nats.io/v1beta2', kind: 'Consumer', metadata, spec: { durableName: contract.consumer, streamName: contract.stream, ackPolicy: 'explicit', ackWait: '60s', maxDeliver: 5, maxAckPending: 16, filterSubjects: [filter], servers: contract.servers } },
    { apiVersion: 'networking.k8s.io/v1', kind: 'NetworkPolicy', metadata, spec: { podSelector: { matchLabels: labels }, policyTypes: ['Ingress', 'Egress'], egress: [
      { to: [{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'kube-system' } }, podSelector: { matchLabels: { 'k8s-app': 'kube-dns' } } }], ports: [{ protocol: 'UDP', port: 53 }, { protocol: 'TCP', port: 53 }] },
      { ports: [{ protocol: 'TCP', port: 4222 }, { protocol: 'TCP', port: 443 }] },
    ] } },
    { apiVersion: 'apps/v1', kind: 'Deployment', metadata, spec: { replicas: 1, selector: { matchLabels: labels }, strategy: { type: 'RollingUpdate', rollingUpdate: { maxUnavailable: 1, maxSurge: 0 } }, template: { metadata: { labels, annotations: { 'applik8s.dev/runtime-digest': digest } }, spec: {
      automountServiceAccountToken: false, terminationGracePeriodSeconds: 60,
      securityContext: { runAsNonRoot: true, runAsUser: 1000, runAsGroup: 1000, fsGroup: 1000, seccompProfile: { type: 'RuntimeDefault' } },
      containers: [{ name: 'publisher', image, imagePullPolicy: 'IfNotPresent', command: ['node', '/app/publisher.mjs'], env,
        securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ['ALL'] } },
        resources: { requests: { cpu: '50m', memory: '128Mi' }, limits: { memory: '512Mi' } },
        readinessProbe: { exec: { command: ['test', '-f', '/tmp/applik8s-lakehouse-publisher-ready'] }, periodSeconds: 5, failureThreshold: 3 },
        livenessProbe: { exec: { command: ['node', '-e', "const {mtimeMs}=require('node:fs').statSync('/tmp/applik8s-lakehouse-publisher-heartbeat');process.exit(Date.now()-mtimeMs<60000?0:1)"] }, periodSeconds: 20, failureThreshold: 3 },
        volumeMounts: [{ name: 'tmp', mountPath: '/tmp' }],
      }], volumes: [{ name: 'tmp', emptyDir: { sizeLimit: '16Mi' } }],
    } } } },
  ];
}

function targetConfigurations(provider: ApplicationProviderNode): readonly { readonly configuration: Readonly<Record<string, unknown>>; readonly targets?: readonly ('local' | 'aws-local' | 'aws' | 'kubernetes')[] }[] {
  const selection = objectConfig(provider.config?.targetSelection);
  const targets = objectConfig(selection.targets);
  if (Object.keys(targets).length === 0) return [{ configuration: objectConfig(provider.config?.lakehouseDataset) }];
  const grouped = new Map<string, { configuration: Readonly<Record<string, unknown>>; targets: Array<'local' | 'aws-local' | 'aws' | 'kubernetes'> }>();
  for (const [target, value] of Object.entries(targets)) {
    if (!isTarget(target)) continue;
    const configuration = objectConfig(objectConfig(value).configuration);
    const identity = JSON.stringify(configuration);
    const prior = grouped.get(identity);
    if (prior) prior.targets.push(target); else grouped.set(identity, { configuration, targets: [target] });
  }
  return [...grouped.values()];
}
function targetConfiguration(provider: ApplicationProviderNode, target: string): Readonly<Record<string, unknown>> | undefined {
  const value = objectConfig(objectConfig(objectConfig(provider.config?.targetSelection).targets)[target]);
  const selected = objectConfig(value.configuration);
  return Object.keys(selected).length > 0 ? selected : undefined;
}
function objectConfig(value: unknown): Readonly<Record<string, unknown>> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {}; }
function stringValue(value: unknown): string { return typeof value === 'string' ? value : ''; }
function positiveInteger(value: unknown): number | undefined { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined; }
function isTarget(value: string): value is 'local' | 'aws-local' | 'aws' | 'kubernetes' { return value === 'local' || value === 'aws-local' || value === 'aws' || value === 'kubernetes'; }
function kubernetesName(value: string): string { return value.replace(/([a-z0-9])([A-Z])/gu, '$1-$2').toLowerCase().replace(/[^a-z0-9.-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 63).replace(/-+$/u, '') || 'lakehouse-publisher'; }
function subjectToken(value: string): string { return value.toLowerCase().replace(/[^a-z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'value'; }
