import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Proves that clean packed consumers retain callable-provider dependencies
 * through every effect-permitted reactive callback family. Projection purity
 * is covered separately because projection workers must never receive these
 * handles or credentials.
 */
export async function runPackedReactiveProviderProof(options) {
  const { consumerDir } = options;
  const migrations = join(consumerDir, 'packed-reactive-migrations');
  await mkdir(migrations, { recursive: true });
  await writeFile(
    join(migrations, '0000_records.sql'),
    'create table packed_reactive_records (id text primary key, revision text not null);\n',
  );
  const applicationPath = join(consumerDir, 'packed-reactive-provider.mjs');
  await writeFile(
    applicationPath,
    `import { app, event } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { AcquisitionProvider, acquisition } from '@fixture/acquisition';
const application = app('packed-reactive-provider', {
  namespace: 'packed-reactive-provider',
  spec: type({ profile: "'starter' | 'dedicated'" }),
  status: type({ ready: 'boolean' }),
});
const records = pgTable('packed_reactive_records', {
  id: text('id').primaryKey(),
  revision: text('revision').notNull(),
});
const database = application.database.postgres('main', {
  schema: { records },
  migrations: { path: './packed-reactive-migrations' },
});
const Record = application.model(records, {
  name: 'PackedReactiveRecord',
  database,
});
const implementation = source => ({
  kind: 'acquisition',
  source,
  credentialSecret: {
    apiVersion: 'v1',
    kind: 'Secret',
    name: 'acquisition-' + source,
    namespace: 'packed-reactive-provider',
  },
  async acquire(input) { return { value: source + ':' + input.id }; },
});
application.profile(application.installation.spec, 'profile')
  .provide(AcquisitionProvider)
  .starter(() => implementation('starter'))
  .dedicated(() => implementation('dedicated'))
  .exhaustive();
const { acquire } = application.include(acquisition);
const directProvider = application.inject(AcquisitionProvider);
async function acquireThroughHelper(id) {
  return acquire({ id });
}
async function acquireEveryWay(id) {
  const direct = await directProvider.acquire({ id: id + '-direct' });
  const extracted = await acquire({ id: id + '-extracted' });
  const helper = await acquireThroughHelper(id + '-helper');
  return [direct.value, extracted.value, helper.value];
}
const ItemRequested = event('packed.item-requested.v1', {
  payload: type({ id: 'string' }),
});
const requests = application.stream(ItemRequested, {
  database,
  retention: { maxAgeSeconds: 3600 },
  partitionBy: payload => payload.id,
  authorize: () => true,
});
async function acquireRequestedEvent(payload) {
  await acquireEveryWay(payload.id);
}
async function acquireRequestedBatch(batch) {
  await acquireEveryWay(batch.events[0]?.value.id ?? batch.id);
}
async function acquireCreatedRecord(created) {
  await acquireEveryWay(created.value.id);
}
async function observeRequested(_payload) {}
requests.onEvent(acquireRequestedEvent);
requests.onBatch({
  batch: { maxItems: 32, maxBytes: '1MiB', maxWait: '1s' },
  ordering: 'partition',
  concurrency: 2,
}, acquireRequestedBatch);
Record.on.create(acquireCreatedRecord);
requests.onEvent(observeRequested);
export const reactiveProviderStack = application.composition;
`,
  );

  const proofPath = join(consumerDir, 'packed-reactive-provider-proof.mjs');
  await writeFile(
    proofPath,
    `import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { deriveApplicationGraphFoundation } from '@applik8s/core';
import {
  compileTypeKroComposition,
  discoverApplicationGraphWithExports,
} from '@applik8s/compiler';
const applicationPath = ${JSON.stringify(applicationPath)};
const discovered = await discoverApplicationGraphWithExports(
  applicationPath,
  'reactiveProviderStack',
);
if (!discovered.ok) throw discovered.error;
const graph = discovered.value.graph;
const effectNames = [
  'acquire-requested-event',
  'acquire-requested-batch',
  'acquire-created-record-create',
];
const effectProcessors = effectNames.map(name => {
  const processor = graph.nodes.find(node =>
    node.kind === 'streamProcessor' && node.name === name
  );
  if (!processor) throw new Error('Packed reactive processor is missing: ' + name);
  return processor;
});
const observer = graph.nodes.find(node =>
  node.kind === 'streamProcessor' && node.name === 'observe-requested'
);
if (!observer || observer.providerBindings?.length) {
  throw new Error('Packed unrelated reactive processor received provider metadata.');
}
for (const processor of effectProcessors) {
  if (processor.name === 'acquire-requested-batch' && processor.invocation !== 'batch') {
    throw new Error('Packed onBatch provider callback lost batch invocation semantics.');
  }
  if (processor.name !== 'acquire-requested-batch' && processor.invocation !== 'event') {
    throw new Error('Packed event/lifecycle provider callback lost event invocation semantics.');
  }
  for (const identifier of ['acquire', 'directProvider.acquire']) {
    const runtime = processor.providerBindings?.find(binding =>
      binding.identifier === identifier
    )?.operation?.runtime;
    if (
      runtime?.module !== '@fixture/acquisition/runtime'
      || runtime.export !== 'acquireItem'
    ) throw new Error(
      'Packed reactive provider operation ' + processor.name + ':' + identifier
      + ' did not survive discovery.',
    );
  }
}
const providerId = 'provider.acquisition-provider.v1alpha1.primary';
const access = deriveApplicationGraphFoundation(graph, {
  workspaceRoot: ${JSON.stringify(consumerDir)},
}).runtimeAccess.filter(requirement =>
  requirement.target.capabilityId === providerId
);
if (
  access.some(requirement => !effectProcessors.some(processor =>
    processor.id === requirement.consumer.nodeId
  ))
  || effectProcessors.some(processor => {
    const operations = access
      .filter(requirement => requirement.consumer.nodeId === processor.id)
      .map(requirement => requirement.target.operation)
      .sort();
    return operations.join(',') !== 'connection.use,network.connect';
  })
) throw new Error('Packed reactive provider access was not placed exactly.');
const compiled = await compileTypeKroComposition({
  entrypoint: applicationPath,
  compositionName: 'reactiveProviderStack',
  outDir: join(${JSON.stringify(consumerDir)}, 'packed-reactive-build'),
  runtimeVersionRange: '^0.8.0',
  handlerAbiVersion: 'applik8s.handler/v1alpha1',
  adapter: 'wasmComponent',
  portability: {
    deterministicBuild: true,
    allowEnvironmentAccess: false,
    allowFilesystemAccess: false,
    allowNetworkAccess: true,
    allowedHostImports: [],
    sourceMaps: {
      emit: true,
      includeSourceContent: false,
      redactPaths: false,
    },
  },
});
if (!compiled.ok) throw compiled.error;
const artifacts = compiled.value.artifacts.reactiveArtifacts.filter(artifact =>
  artifact.kind === 'streamProcessorWorker'
);
for (const processor of effectProcessors) {
  const artifact = artifacts.find(candidate => candidate.nodeId === processor.id);
  if (!artifact) throw new Error('Packed reactive artifact is missing: ' + processor.name);
  const source = [
    await readFile(artifact.sourcePath, 'utf8'),
    await readFile(join(dirname(artifact.sourcePath), 'stream-processor.generated.ts'), 'utf8'),
    await readFile(join(dirname(artifact.sourcePath), 'handle.generated.ts'), 'utf8'),
  ].join('\n');
  if (
    !source.includes('@fixture/acquisition/runtime')
    || !source.includes('acquireEveryWay')
    || !source.includes('acquireThroughHelper')
    || source.includes('@applik8s/applik8s/internal/provider-runtime')
    || source.includes('application.inject')
    || source.includes('application.profile')
    || source.includes('application.provide')
  ) throw new Error('Packed generated reactive worker did not hydrate only the public provider operation: ' + processor.name);
  const deployment = artifact.resources.find(resource => resource.kind === 'Deployment');
  const deploymentJson = JSON.stringify(deployment);
  if (
    !deploymentJson.includes('ACQUISITION_SOURCE')
    || !deploymentJson.includes('ACQUISITION_TOKEN')
    || !deploymentJson.includes('acquisition-starter')
    || !deploymentJson.includes('acquisition-dedicated')
  ) throw new Error('Packed reactive provider configuration was not placed on its consumer: ' + processor.name);
}
const observerArtifact = artifacts.find(candidate => candidate.nodeId === observer.id);
if (!observerArtifact) throw new Error('Packed unrelated reactive artifact is missing.');
if (JSON.stringify(observerArtifact.resources).includes('ACQUISITION_TOKEN')) {
  throw new Error('Packed reactive provider credentials reached an unrelated processor.');
}
`,
  );
  await execFileAsync(process.execPath, [proofPath], {
    cwd: consumerDir,
    env: {
      ...process.env,
      NODE_OPTIONS: '--max-old-space-size=8192',
    },
    maxBuffer: 20 * 1024 * 1024,
  });
  console.log(
    'Package consumer smoke: packed external onEvent/onBatch/model-lifecycle provider hydration passed.',
  );
}
