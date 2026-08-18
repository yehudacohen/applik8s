import { execFile, spawn } from 'node:child_process';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { cpus, platform } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import { collectV06GitIdentity } from './v06-evidence.ts';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const example = join(root, 'examples/chirp-start');
const output = join(root, 'dist/examples/chirp');
const record = process.argv.includes('--record');
const reuseBuild = process.argv.includes('--reuse-build');

const webBuildStarted = performance.now();
if (!reuseBuild) await run('bun', ['run', 'build'], example, { TYPEKRO_LOG_LEVEL: 'fatal' });
const webBuildDurationMs = performance.now() - webBuildStarted;

const browser = await json(join(example, '.applik8s/web-artifacts/browser.json'));
const server = await json(join(example, '.applik8s/web-artifacts/server.json'));
assert(browser.target === 'browser' && browser.output === '.output/public', 'Chirp browser artifact manifest must name the final public output.');
assert(server.target === 'server' && server.output === '.output' && server.entrypoint === 'server/index.mjs', 'Chirp server artifact manifest must name the final Nitro entrypoint.');

const budgets = await json(join(root, 'benchmarks/v0.6/budgets.json'));
const publicAssets = join(example, '.output/public/assets');
const browserJavaScript = (await readdir(publicAssets)).filter((name) => name.endsWith('.js'));
const browserGzipBytes = (await Promise.all(browserJavaScript.map(async (name) => gzipSync(await readFile(join(publicAssets, name)), { level: 9 }).byteLength)))
  .reduce((total, bytes) => total + bytes, 0);
assert(
  browserGzipBytes <= budgets.chirp.maximumBrowserJavaScriptGzipBytes,
  `Chirp browser JavaScript is ${browserGzipBytes} gzip bytes; budget is ${budgets.chirp.maximumBrowserJavaScriptGzipBytes}.`,
);

const serverFiles = await recursiveFiles(join(example, '.output/server'));
assert(!serverFiles.some((path) => path.includes('@kubernetes/client-node')), 'Relational-only Chirp web host must not bundle @kubernetes/client-node.');
const serverOutputBytes = await totalFileBytes(serverFiles);
assert(serverOutputBytes <= budgets.chirp.maximumServerOutputBytes, `Chirp server output is ${serverOutputBytes} bytes; budget is ${budgets.chirp.maximumServerOutputBytes}.`);

if (!reuseBuild) await rm(output, { recursive: true, force: true });
const compilerBuildStarted = performance.now();
if (!reuseBuild) {
  await run('bun', [
    'run', 'applik8s', 'build', 'examples/chirp-start/src/application.ts',
    '--typekro', '--composition-name', 'app', '--out-dir', 'dist/examples/chirp',
  ], root, { TYPEKRO_LOG_LEVEL: 'fatal' });
}
const compilerBuildDurationMs = performance.now() - compilerBuildStarted;

const graph = await json(join(output, 'typekro/application-graph.json'));
assert(!JSON.stringify(graph).includes('[object Object]'), 'Chirp ApplicationGraph must preserve installation-derived values instead of coercing TypeKro references to [object Object].');
const workflowGatewaySource = await readFile(
  join(output, 'typekro/workflows/chirp-workflows/workflow-worker.generated.ts'),
  'utf8',
);
assert(
  workflowGatewaySource.includes("requiredEnv('APPLIK8S_WORKFLOW_NAMESPACE')"),
  'The private workflow gateway must derive its caller namespace from the running Pod.',
);
assert(
  !workflowGatewaySource.includes('system:serviceaccount:${schema.spec.name}:'),
  'The immutable workflow worker must not embed a TypeKro installation expression as a literal service-account subject.',
);
const qualifiedProvider = (providerInterface, qualifier) =>
  graph.nodes.find(
    (node) =>
      node.kind === 'provider'
      && node.interface === providerInterface
      && node.config?.qualification?.name === qualifier,
  );
const profileBranch = (provider, variant) =>
  provider?.config?.profile?.branches?.find((branch) => branch.variant === variant);
const installationNamespace = ['$', '{schema.spec.name}'].join('');
const installationFeatureValue = (feature) => ['$', `{schema.spec.features.${feature}}`].join('');
const installationBackupValue = ['$', '{schema.spec.backup.enabled}'].join('');
const installationProfileValue = (value) => typeof value === 'string' && value.startsWith('${') && value.includes('schema.spec.profile');
const commandProcessors = graph.nodes.filter((node) => node.kind === 'processor');
assert(commandProcessors.length === 1, `Chirp must consolidate its transactional model commands into one bounded pool; found ${commandProcessors.length}.`);
assert(commandProcessors[0]?.name === 'chirp-commands' && commandProcessors[0]?.handlers?.length >= 45, 'Chirp command pool must retain every generated typed model mutation handler.');
const kinds = new Set(graph.nodes.map((node) => node.kind));
for (const kind of ['model', 'command', 'commandHandler', 'query', 'stream', 'streamProcessor', 'projection', 'objectStore', 'task', 'workflow', 'crd', 'operator', 'gateway', 'provider']) {
  assert(kinds.has(kind), `Chirp ApplicationGraph is missing ${kind}.`);
}
for (const projection of ['post-analytics-hourly', 'follow-analytics-hourly', 'reaction-analytics-hourly']) {
  assert(graph.nodes.some((node) => node.kind === 'projection' && node.name === projection), `Chirp is missing ${projection} projection.`);
}
for (const model of ['Account', 'Automation', 'AutomationRun', 'Block', 'Bookmark', 'CredentialLink', 'Follow', 'InstallationSetting', 'Media', 'ModerationCase', 'Mute', 'Notification', 'Post', 'Reaction', 'Report']) {
  assert(graph.nodes.some((node) => node.kind === 'model' && node.name === model), `Chirp is missing the ${model} domain model.`);
}
assert(!JSON.stringify(graph).includes('audienceIds'), 'Chirp must never accept or persist client-computed audience lists.');
assert(!graph.nodes.some((node) => node.kind === 'subscription' && node.source?.nodeId === 'stream.posts.published.v1'), 'Chirp must not expose raw publication events; the generated authorized query SSE route carries invalidation and requery instead.');
const createPost = graph.nodes.find((node) => node.kind === 'command' && node.name === 'models.Post.create.v1');
assert(createPost, 'Post.create must be derived directly from the promoted Post model.');
assert(!createPost.contract.input.jsonSchema.required?.includes('authorId'), 'Post.create must derive author identity from the admitted principal rather than require a client-supplied authorId.');
const createAccount = graph.nodes.find((node) => node.kind === 'command' && node.name === 'models.Account.create.v1');
assert(createAccount && !createAccount.contract.input.jsonSchema.required?.includes('id'), 'Account.create must derive account identity from the admitted principal rather than browser input.');
const createAccountHandler = graph.nodes.find((node) => node.kind === 'commandHandler' && node.command?.nodeId === createAccount?.id);
assert(createAccountHandler?.transaction?.commands?.some((command) => command.nodeId === 'command.models.credential-link.create.v1'), 'Account registration must transactionally persist its admitted issuer/subject credential link.');
const createPostHandler = graph.nodes.find((node) => node.kind === 'commandHandler' && node.command?.nodeId === createPost?.id);
assert(createPostHandler?.transaction?.models?.some((model) => model.nodeId === 'model.account'), 'Post.create must read Account in the same transaction domain.');
for (const [name, forbidden] of [
  ['Account.me', []],
  ['Post.homeTimeline', ['viewerId']],
  ['Bookmark.mine', ['accountId']],
  ['Notification.inbox', ['recipientId']],
  ['Automation.mine', ['ownerId']],
  ['AutomationRun.recent', ['ownerId']],
  ['Report.openQueue', ['moderatorId']],
  ['ModerationCase.queue', ['moderatorId']],
]) {
  const query = graph.nodes.find((node) => node.kind === 'query' && node.name === name);
  assert(query, `Chirp must expose the principal-derived ${name} view.`);
  const properties = Object.keys(query.input.jsonSchema.properties ?? {});
  assert(forbidden.every((field) => !properties.includes(field)), `${name} must derive its actor from the gateway principal instead of accepting ${forbidden.join(', ')}.`);
}
const moderationPolicyQuery = graph.nodes.find((node) => node.kind === 'query' && node.name === 'ModerationPolicy.current');
assert(
  moderationPolicyQuery?.kubernetes?.kind === 'kubernetes-list-watch'
    && moderationPolicyQuery.kubernetes.namespace === installationNamespace
    && moderationPolicyQuery.kubernetes.pageSize === 10
    && moderationPolicyQuery.kubernetes.maxPages === 2
    && moderationPolicyQuery.kubernetes.maxItems === 10
    && moderationPolicyQuery.budgets?.timeoutMs === 2_000
    && moderationPolicyQuery.budgets?.maxRows === 1,
  'ModerationPolicy.current must use one installation-scoped, bounded Kubernetes snapshot/watch authority.',
);
const moderationPolicyOperator = graph.nodes.find(
  (node) => node.kind === 'operator' && node.name === 'moderation-policy-controller',
);
const moderationPolicyWorkflow = graph.nodes.find(
  (node) => node.kind === 'workflowHandler' && node.name === 'moderation.apply-policy.v1',
);
assert(
  moderationPolicyOperator?.resources?.some(
    (resource) =>
      resource.apiVersion === 'chirp.applik8s.dev/v1alpha1'
      && resource.kind === 'ModerationPolicy',
  ) && moderationPolicyWorkflow,
  'ModerationPolicy.on.reconcile(...) must lower to one inferred operator that invokes its typed durable workflow.',
);
for (const processor of ['validate-published-post-create', 'validate-updated-post-update', 'validate-deleted-post-delete']) {
  assert(graph.nodes.some((node) => node.kind === 'streamProcessor' && node.name === processor), `Post.${processor} must lower through the canonical typed lifecycle-event processor path.`);
}
for (const processor of ['reconcile-automation-schedules', 'verify-uploaded-media']) {
  const node = graph.nodes.find((candidate) => candidate.kind === 'streamProcessor' && candidate.name === processor);
  assert(node?.tasks?.length === 1, `${processor} must retain its compiler-captured direct durable dependency.`);
}
const engagementBatchProcessor = graph.nodes.find(
  (node) => node.kind === 'streamProcessor' && node.name === 'persist-engagement-batch',
);
assert(
  engagementBatchProcessor?.invocation === 'batch'
    && engagementBatchProcessor.idempotency === 'frozen-batch-id'
    && engagementBatchProcessor.batch?.membership === 'durableFrozenManifest'
    && engagementBatchProcessor.batch?.acknowledgement === 'wholeBatch'
    && engagementBatchProcessor.batch?.ordering === 'partition'
    && engagementBatchProcessor.batch?.maxItems === 100
    && engagementBatchProcessor.batch?.maxBytes === 262_144
    && engagementBatchProcessor.batch?.maxWaitMs === 1_000
    && engagementBatchProcessor.tasks?.length === 1
    && engagementBatchProcessor.tasks[0]?.target?.nodeId
      === 'workflow.engagement.record-batch.v1',
  'ReactionChanges.onBatch(...) must freeze bounded partition-ordered membership, acknowledge atomically, and invoke one compiler-captured durable receipt workflow.',
);
assert(
  graph.nodes.some((node) => node.kind === 'model' && node.name === 'EngagementBatch')
    && graph.nodes.some((node) => node.kind === 'query' && node.name === 'EngagementBatch.recentEngagementBatches')
    && graph.nodes.some((node) => node.kind === 'gateway' && node.name === 'system' && node.visibility === 'internal')
    && !graph.nodes.some(
      (node) =>
        node.kind === 'gateway'
        && node.visibility !== 'internal'
        && node.commands?.some((command) => command.command?.nodeId === 'command.models.engagement-batch.create.v1'),
    ),
  'Chirp batch receipts must be inspectable through a bounded moderator view while their write authority stays behind an internal generated gateway.',
);
assert(graph.nodes.some((node) => node.kind === 'provider' && node.interface === 'WorkflowEngine' && node.config?.namespace === installationNamespace), 'Chirp Hatchet provider must be scoped by ChirpInstallation.spec.name.');
assert(graph.nodes.some((node) => node.kind === 'provider' && node.interface === 'ApplicationHost'), 'Chirp must include its immutable ApplicationHost.');
const containerRegistry = graph.nodes.find((node) => node.kind === 'provider' && node.interface === 'ContainerRegistry')?.config?.containerRegistry;
assert(containerRegistry?.kind === 'application-provider-selection' && containerRegistry.selector === 'schema.spec.profile', 'Chirp provider profile must select the deployment-bound registry from typed installation desired state.');
const localRegistry = containerRegistry?.default;
const externalRegistry = containerRegistry?.cases?.external;
assert(localRegistry?.project === installationNamespace && localRegistry.management?.pullRobotName === installationNamespace, 'ChirpInstallation.spec.name must isolate the cluster-global Harbor project and runtime robot identity.');
assert(localRegistry?.pullSecret?.namespace === installationNamespace && localRegistry.pullSecret.name === 'chirp-registry-pull', 'Each local Chirp installation must receive its own namespace-scoped Harbor pull credential.');
assert(localRegistry?.management?.projectLifecycle?.deletionPolicy === ['$', '{schema.spec.lifecycle.registryProjectDeletion}'].join(''), 'ChirpInstallation lifecycle policy must drive Harbor project retention or deletion.');
assert(localRegistry?.management?.projectLifecycle?.purgeRepositories === ['$', '{schema.spec.lifecycle.purgeRegistryRepositories}'].join(''), 'Irreversible Harbor repository purging must require an explicit typed installation value.');
assert(externalRegistry?.kind === 'oci-container-registry' && externalRegistry.endpoint?.origin === '${schema.spec.providers.registry.origin}', 'The external profile must bind a provider-neutral OCI registry entirely from typed provider references.');
const indexStore = graph.nodes.find((node) => node.kind === 'provider' && node.interface === 'IndexStore');
assert(indexStore?.config?.indexStore?.kind === 'valkey' && indexStore.config.indexStore.provisioner === 'hyperspike', 'Chirp must bind an operator-backed Valkey IndexStore.');
assert(installationProfileValue(indexStore?.config?.indexStore?.host) && indexStore.config.indexStore.host.includes('schema.spec.providers.index.host'), 'The external profile must select its online index endpoint from typed provider coordinates.');
assert(installationProfileValue(indexStore?.config?.indexStore?.provision) && indexStore.config.indexStore.provision.includes('false') && indexStore.config.indexStore.provision.includes('true'), 'Managed profiles must own Valkey directly while the external profile references it.');
const objectStoreProvider = graph.nodes.find((node) => node.kind === 'provider' && node.interface === 'ObjectStorage');
const qualifiedObjectStore = qualifiedProvider('ObjectStorage', 'media');
const starterObjects = profileBranch(qualifiedObjectStore, 'starter')?.config;
const dedicatedObjects = profileBranch(qualifiedObjectStore, 'dedicated')?.config;
const externalObjects = profileBranch(qualifiedObjectStore, 'external')?.config;
assert(
  starterObjects?.ownership === 'direct-provisioned'
    && starterObjects.provisioning?.storageClassName === 'typekro-harbor-bucket-retain'
    && dedicatedObjects?.ownership === 'direct-provisioned'
    && dedicatedObjects.provisioning?.storageClassName === 'typekro-harbor-bucket-retain'
    && externalObjects?.ownership === 'external'
    && externalObjects.provisioning === undefined,
  'Managed profiles must declare automatic direct Rook bucket provisioning while the external profile retains external ownership.',
);
assert(objectStoreProvider?.config?.objectStorage?.enabled === true, 'Chirp must retain ObjectStorage as a core projection-recovery dependency.');
const qualifiedDatabase = qualifiedProvider('TransactionalDatabase', 'primary');
const starterDatabase = profileBranch(qualifiedDatabase, 'starter')?.config;
const dedicatedDatabase = profileBranch(qualifiedDatabase, 'dedicated')?.config;
const externalDatabase = profileBranch(qualifiedDatabase, 'external')?.config;
assert(
  starterDatabase?.ownership === 'direct-provisioned'
    && dedicatedDatabase?.ownership === 'direct-provisioned'
    && externalDatabase?.ownership === 'external'
    && externalDatabase?.lifecycle?.deletionPolicy === '${schema.spec.lifecycle.databaseDeletion}',
  'Chirp PostgreSQL must select external or explicit direct ownership from typed profile and lifecycle desired state.',
);
assert(
  externalDatabase?.connectionSecret?.name === '${schema.spec.providers.database.connectionSecretName}',
  'The external profile must select its PostgreSQL connection Secret from typed provider coordinates.',
);
for (const managedDatabase of [starterDatabase, dedicatedDatabase]) {
  assert(
    managedDatabase?.backup?.enabled === installationBackupValue
      && managedDatabase.backup?.destination?.kind === 's3',
    'Managed Chirp PostgreSQL branches must retain typed S3 backup desired state without embedding credentials.',
  );
}
assert(
  externalDatabase?.backup === undefined,
  'The external PostgreSQL branch must not acquire managed backup resources.',
);
const workflowProvider = graph.nodes.find((node) => node.kind === 'provider' && node.interface === 'WorkflowEngine');
assert(workflowProvider?.config?.enabled === true, 'Chirp must retain its WorkflowEngine as a core projection-recovery dependency.');
const generationProvider = graph.nodes.find((node) => node.kind === 'provider' && node.interface === 'StructuredGeneration');
assert(generationProvider?.implementation === 'application-provider-selection' && generationProvider.config?.selector === 'schema.spec.profile', 'StructuredGeneration must be selected from typed installation desired state without changing task code.');
const starterGeneration = generationProvider.config.cases?.starter;
assert(starterGeneration?.kind === 'structured-generation-deterministic' && !starterGeneration?.credentialSecret, 'The starter StructuredGeneration branch must be deterministic and credential-free.');
for (const profile of ['dedicated', 'external']) {
  const selected = generationProvider.config.cases?.[profile];
  assert(selected?.kind === 'structured-generation-http' && selected.endpoint === '${schema.spec.providers.generation.endpoint}', `${profile} StructuredGeneration must use the provider-neutral HTTP adapter.`);
  assert(selected?.credentialSecret?.name === '${schema.spec.providers.generation.credentialsSecretName}' && selected.credentialSecret.namespace === installationNamespace, `${profile} StructuredGeneration credentials must remain a namespace-scoped Secret reference.`);
}
const generationTask = graph.nodes.find((node) => node.kind === 'taskHandler' && node.name === 'automation.generate-post.v1.step');
assert(generationTask?.capabilities?.some((capability) => capability.interface === 'StructuredGeneration'), 'Automation generation must declare StructuredGeneration as an explicit injected task capability.');
const automationPreparationTask = graph.nodes.find((node) => node.kind === 'taskHandler' && node.name === 'automation.prepare-run.v1.step');
const automationPublicationTask = graph.nodes.find((node) => node.kind === 'taskHandler' && node.name === 'automation.publish-run.v1.step');
const automationRejectionTask = graph.nodes.find((node) => node.kind === 'taskHandler' && node.name === 'automation.reject-run.v1.step');
const automationExecutionWorkflow = graph.nodes.find((node) => node.kind === 'workflowHandler' && node.name === 'automation.execute-run.v1');
const automationReviewStream = graph.nodes.find((node) => node.kind === 'stream' && node.signal?.id === 'automation.post-review.v1');
const automationReviewSubscription = graph.nodes.find((node) => node.kind === 'subscription' && node.name === 'automation-post-review-requests');
assert(
  automationPreparationTask?.capabilities?.some((capability) => capability.interface === 'StructuredGeneration')
    && automationPreparationTask.operations?.map((operation) => operation.alias).sort().join(',') === 'AutomationRun.create,AutomationRun.update'
    && automationPreparationTask.queries?.map((query) => query.alias).sort().join(',') === 'AutomationControlCurrent,PostHomeTimeline'
    && automationPreparationTask.queries?.some((query) => query.alias === 'PostHomeTimeline' && query.query?.nodeId === 'query.Post.homeTimeline')
    && automationPreparationTask.operationPrincipalSource?.includes('automation-worker')
    && automationPublicationTask?.operations?.map((operation) => operation.alias).sort().join(',') === 'AutomationRun.update,Post.create'
    && automationPublicationTask.operations?.some((operation) => operation.command?.nodeId === 'command.models.post.create.v1')
    && automationRejectionTask?.operations?.map((operation) => operation.alias).join(',') === 'AutomationRun.update'
    && automationExecutionWorkflow?.childWorkflowBindings?.map((binding) => binding.workflow?.nodeId).sort().join(',') === [
      'workflow.automation.prepare-run.v1',
      'workflow.automation.publish-run.v1',
      'workflow.automation.reject-run.v1',
    ].sort().join(',')
    && automationExecutionWorkflow.signalBindings?.some((binding) => binding.id === 'automation.post-review.v1')
    && automationExecutionWorkflow.handlerSource?.includes('context.now()'),
  'Automation execution must keep history-backed time and signal decisions in one durable coordinator while compiler-owned callable steps isolate typed generation, bounded reads, and declared model operations under a service principal.',
);
assert(
  automationReviewStream?.signal?.actions?.map((action) => action.name).sort().join(',') === 'approve,reject'
    && automationReviewSubscription?.source?.nodeId === automationReviewStream.id
    && graph.nodes.some((node) => node.kind === 'gateway' && node.name === 'administration' && node.subscriptions?.some((subscription) => subscription.nodeId === automationReviewSubscription.id)),
  'Risky automation must publish one typed, exact-authority signal issuance through the moderator SSE gateway.',
);
const automationScheduleProcessor = graph.nodes.find((node) => node.kind === 'streamProcessor' && node.name === 'reconcile-automation-schedules');
assert(
  automationScheduleProcessor?.tasks?.length === 1
    && automationScheduleProcessor.tasks[0]?.target?.nodeId === 'workflow.automation.execute-run.v1'
    && automationScheduleProcessor.workflowEngine?.nodeId === 'provider.workflow-engine',
  'Committed automation desired state must converge its one typed recurring workflow through the provider-neutral WorkflowEngine boundary.',
);
const analyticalProvider = graph.nodes.find((node) => node.kind === 'provider' && node.interface === 'AnalyticalDatabase');
const analyticalConfiguration = analyticalProvider?.config?.analyticalDatabase;
const analyticalBranches = analyticalConfiguration?.kind === 'application-provider-selection'
  ? [
      analyticalConfiguration.default,
      ...Object.values(analyticalConfiguration.cases ?? {}),
    ]
  : [analyticalConfiguration];
assert(
  analyticalBranches.length > 0
    && analyticalBranches.every(
      (branch) => branch?.enabled === installationFeatureValue('analytics'),
    ),
  'ChirpInstallation.spec.features.analytics must drive every selectable AnalyticalDatabase provider.',
);

const resources = await json(join(output, 'typekro/resources.json'));
const chirpRgd = resources.find((resource) => resource.apiVersion === 'kro.run/v1alpha1' && resource.kind === 'ResourceGraphDefinition' && resource.metadata?.name === 'chirp');
assert(chirpRgd?.spec?.schema?.kind === 'ChirpInstallation', 'Chirp must compile to the typed ChirpInstallation ResourceGraphDefinition.');
assert(!containsExpressionDescriptor(chirpRgd), 'Chirp RGD templates must contain serialized KRO expressions rather than JavaScript expression descriptor objects.');
const invalidEmptyNamespaceValues = [];
visit(resources, (value, path) => {
  if (path.endsWith('.namespace') && isEmptyObject(value)) invalidEmptyNamespaceValues.push(path);
  if (path.includes('.matchLabels.') && isEmptyObject(value)) invalidEmptyNamespaceValues.push(path);
});
assert(invalidEmptyNamespaceValues.length === 0, `Chirp RGD contains erased installation namespace values at ${invalidEmptyNamespaceValues.join(', ')}.`);
const chirpRgdBytes = Buffer.byteLength(JSON.stringify(chirpRgd));
assert(chirpRgdBytes <= budgets.chirp.maximumResourceGraphDefinitionBytes, `Chirp RGD is ${chirpRgdBytes} bytes; budget is ${budgets.chirp.maximumResourceGraphDefinitionBytes}. Executable workloads must remain OCI artifacts.`);
for (const field of ['ready', 'phase', 'url', 'observedVersion', 'artifactDigest']) {
  assert(typeof chirpRgd.spec.schema.status?.[field] === 'string' && chirpRgd.spec.schema.status[field].startsWith('${'), `Chirp installation status.${field} must be a KRO-hydrated expression.`);
}
for (const field of ['migrationStatus', 'rolloutStatus', 'degradedReasons']) {
  assert(typeof chirpRgd.spec.schema.status?.[field] === 'string' && chirpRgd.spec.schema.status[field].startsWith('${'), `Chirp installation status.${field} must be hydrated from child-resource evidence.`);
}
assert(chirpRgd.spec.schema.status.migrationStatus.includes('applik8sGeneratedJobChirpChirpMigration'), 'Chirp migration status must observe the generated migration Job rather than report a static placeholder.');
assert(
  typeof chirpRgd.spec.schema.status.backupStatus === 'string'
    && chirpRgd.spec.schema.status.backupStatus.startsWith('${')
    && chirpRgd.spec.schema.status.backupStatus.includes('TransactionalDatabaseScheduledBackup')
    && chirpRgd.spec.schema.status.backupStatus.includes('NotConfigured'),
  'Chirp backup status must observe the conditional ScheduledBackup and remain NotConfigured when desired state disables it.',
);
assert(Object.values(chirpRgd.spec.schema.status.projectionStatus ?? {}).every((value) => typeof value === 'string' && value.startsWith('${')), 'Chirp projection status must observe both online and analytical stores.');
assert(!Object.hasOwn(chirpRgd.spec.schema.status ?? {}, 'conditions'), 'Chirp must leave status.conditions to KRO canonical condition ownership instead of projecting a competing custom value.');
assert(Object.values(chirpRgd.spec.schema.status?.providerStatus ?? {}).every((value) => typeof value === 'string' && value.startsWith('${')), 'Chirp installation providerStatus must be KRO-owned readiness projection.');
assert(
  chirpRgd.spec.schema.status.providerStatus.analytics.includes('"NotConfigured"')
    && chirpRgd.spec.schema.status.providerStatus.workflows.startsWith('${(true) ?'),
  'Analytics may remain optional, while workflow readiness must be activated unconditionally for recovery.',
);
const statusWithoutFeatureConditions = JSON.stringify(chirpRgd.spec.schema.status)
  .replaceAll('schema.spec.features.analytics', '')
  .replaceAll('schema.spec.features.media', '')
  .replaceAll('schema.spec.features.automatedAccounts', '')
  .replaceAll('schema.spec.profile', '')
  .replaceAll('schema.spec.exposure.mode', '');
assert(!statusWithoutFeatureConditions.includes('schema.'), 'KRO-owned Chirp status may reference only typed desired-state activation switches; all operational evidence must remain resource-anchored.');
assert(chirpRgd.spec.schema.status.ready.includes('applik8sGeneratedDeploymentChirpWeb'), 'Chirp readiness must observe the generated ApplicationHost Deployment.');
assert(/applik8sGeneratedDeploymentChirpWeb\d+/.test(chirpRgd.spec.schema.status.providerStatus.identity), 'Chirp identity status must be backed by the authored workloads that host request admission.');
assert(/applik8sGeneratedDeploymentChirpWeb\d+/.test(chirpRgd.spec.schema.status.providerStatus.authorization), 'Chirp authorization status must be backed by the authored workloads that enforce policy.');
assert(chirpRgd.spec.schema.status.providerStatus.exposure.includes('active.webPublicIngressApplicationExposure') && chirpRgd.spec.schema.status.providerStatus.exposure.includes('active.webLocalNodePortApplicationExposure'), 'Chirp exposure status must observe both conditionally selected public transports.');
assert(chirpRgd.spec.schema.status.ready.includes('TransactionalDatabaseCluster'), 'Chirp readiness must observe the authoritative PostgreSQL cluster without depending on model registration order.');
assert(chirpRgd.spec.schema.status.ready.includes('applik8sObjectStorageCredentials'), 'Chirp readiness must observe the direct/external object-storage credentials boundary.');
assert(chirpRgd.spec.schema.status.ready.includes('chirpProvidedValkeyIndex'), 'Chirp readiness must observe the operator-backed Valkey cluster.');
assert(chirpRgd.spec.schema.status.ready.includes('applik8sEventsNatsHelmRelease') && chirpRgd.spec.schema.status.ready.includes('applik8sEventsNackHelmRelease'), 'Chirp readiness must observe both NATS and NACK controller prerequisites.');
const jetStreamResources = chirpRgd.spec.resources.filter((resource) => ['Stream', 'Consumer'].includes(resource.template?.kind));
assert(jetStreamResources.length > 0, 'Chirp must materialize declared JetStream Streams and Consumers.');
assert(jetStreamResources.every((resource) => chirpRgd.spec.schema.status.ready.includes(resource.id)), 'Chirp readiness must observe every declared JetStream Stream and Consumer.');
const applicationClusters = chirpRgd.spec.resources
  .filter((resource) => resource.externalRef?.apiVersion === 'postgresql.cnpg.io/v1' && resource.externalRef?.kind === 'Cluster' && resource.externalRef.metadata?.name === 'chirp-models');
assert(applicationClusters.length === 1, `Chirp must observe exactly one direct-lifecycle authoritative application database cluster, found ${applicationClusters.length}.`);
assert(applicationClusters[0]?.externalRef?.metadata?.namespace === installationNamespace, 'ChirpInstallation.spec.name must scope the authoritative application database.');
assert(!chirpRgd.spec.resources.some((resource) => resource.template?.apiVersion === 'postgresql.cnpg.io/v1' && resource.template?.kind === 'Cluster' && resource.template.metadata?.name === 'chirp-models'), 'The retained Chirp database must never be a KRO-owned graph child.');
assert(
  [starterDatabase, dedicatedDatabase].every(
    (provider) =>
      installationProfileValue(provider?.instances)
      && installationProfileValue(provider?.storage?.size),
  ),
  'ChirpInstallation.spec.profile must drive every managed PostgreSQL provisioning branch.',
);
const eventLogProvider = graph.nodes.find((node) =>
  node.kind === 'provider'
  && node.interface === 'EventLog'
  && node.implementation === 'nats-jetstream');
assert(
  installationProfileValue(eventLogProvider?.config?.replicas)
    && installationProfileValue(eventLogProvider?.config?.storageSize),
  'ChirpInstallation.spec.profile must drive the direct TypeKro JetStream replicas and durable-storage contract.',
);
assert(
  installationProfileValue(workflowProvider?.config?.database?.instances)
    && installationProfileValue(workflowProvider?.config?.database?.storageSize),
  'ChirpInstallation.spec.profile must drive the direct TypeKro Hatchet database replicas and storage.',
);
assert(
  !chirpRgd.spec.resources
    .map((resource) => resource.template)
    .some(
      (resource) =>
        resource?.apiVersion === 'postgresql.cnpg.io/v1'
        && resource?.kind === 'Cluster'
        && resource.metadata?.name === 'chirp-workflows-db',
    ),
  'The Hatchet database belongs to its direct TypeKro provider graph and must not be embedded in the root Chirp RGD.',
);
const workflowWorker = chirpRgd.spec.resources.map((resource) => resource.template).find((resource) => resource?.kind === 'Deployment' && resource.metadata?.name === 'chirp-workflows');
assert(installationProfileValue(workflowWorker?.spec?.replicas), 'ChirpInstallation.spec.profile must drive workflow worker replicas.');
const workflowWorkerEnvironment = workflowWorker?.spec?.template?.spec?.containers?.[0]?.env ?? [];
for (const name of [
  'APPLIK8S_TASK_OPERATION_CONTEXT_SECRET', 'APPLIK8S_TASK_QUERY_CONTEXT_SECRET', 'APPLIK8S_NATS_SERVERS', 'APPLIK8S_DATABASE_CHIRP_URL',
  'APPLIK8S_REBUILD_VALKEY_HOST', 'APPLIK8S_REBUILD_VALKEY_PORT', 'APPLIK8S_REBUILD_OBJECT_BUCKET', 'APPLIK8S_REBUILD_OBJECT_REGION',
]) {
  assert(workflowWorkerEnvironment.some((entry) => entry.name === name), `Chirp workflow operations require ${name} at the generated worker boundary.`);
}
assert(
  workflowWorkerEnvironment.find((entry) => entry.name === 'APPLIK8S_TASK_OPERATION_CONTEXT_SECRET')?.valueFrom?.secretKeyRef?.name === 'chirp-context',
  'Workflow-issued commands must use the application-wide context authority without embedding its secret or coupling durable execution to one gateway.',
);
const timelineRebuildHandler = graph.nodes.find((node) => node.kind === 'taskHandler' && node.name === 'timeline.rebuild.v1.step');
const homeTimelineProjection = graph.nodes.find((node) => node.kind === 'projection' && node.name === 'home-timeline');
assert(
  homeTimelineProjection?.online?.rebuild?.source?.nodeId === 'model.post'
    && typeof homeTimelineProjection.online.rebuild.mapSource === 'string'
    && homeTimelineProjection.online.rebuild.mapSource.includes('publicationState'),
  'HomeTimeline recovery must reconstruct from the canonical Post model before retained-stream catch-up.',
);
assert(
  timelineRebuildHandler?.projections?.length === 1
    && timelineRebuildHandler.projections[0]?.alias === 'HomeTimeline'
    && timelineRebuildHandler.projections[0]?.projection?.nodeId === 'projection.home-timeline'
    && timelineRebuildHandler.projections[0]?.artifacts?.nodeId === 'objectStore.home-timeline-rebuild-artifacts',
  'Chirp timeline recovery must infer the generation-scoped projection and framework-owned immutable evidence store from HomeTimeline.rebuild(...).',
);
const workflowSource = await readFile(join(output, 'typekro/workflows/chirp-workflows/workflow-worker.generated.ts'), 'utf8');
for (const marker of [
  'createPostgresApplicationProjectionSnapshotSource', 'createPostgresApplicationStream', 'createValkeyOnlineProjectionWriter',
  'createS3ApplicationObjectStorageRuntime', 'runApplicationOnlineProjectionRebuild', 'snapshotPartition',
  'projections: Object.freeze', 'APPLIK8S_REBUILD_VALKEY_HOST', 'APPLIK8S_REBUILD_OBJECT_BUCKET',
]) {
  assert(workflowSource.includes(marker), `Chirp generated workflow worker is missing projection-recovery runtime marker ${marker}.`);
}
assert(
  workflowSource.match(/applicationPolicyAllowed: true/g)?.length >= 2,
  'Workflow signal issuance and compiler-bounded task operations must both reach their authoritative transactional policy boundary.',
);
const automationScheduleWorker = chirpRgd.spec.resources.find((resource) =>
  resource.template?.kind === 'Deployment'
  && resource.template?.metadata?.name === 'chirp-reconcile-automation-schedules');
const automationScheduleEnvironment = automationScheduleWorker?.template?.spec?.template?.spec?.containers?.[0]?.env ?? [];
for (const name of ['HATCHET_CLIENT_TOKEN', 'HATCHET_CLIENT_HOST_PORT', 'HATCHET_CLIENT_API_URL', 'HATCHET_CLIENT_TLS_STRATEGY']) {
  assert(automationScheduleEnvironment.some((entry) => entry.name === name), `Automation schedule reconciliation requires ${name} at its generated provider boundary.`);
}
assert(
  automationScheduleWorker?.includeWhen?.some((condition) => condition.includes('schema.spec.features.automatedAccounts')),
  'Automation schedule reconciliation must be omitted with the WorkflowEngine when automated accounts are disabled.',
);
const applicationHost = chirpRgd.spec.resources.map((resource) => resource.template).find((resource) => resource?.kind === 'Deployment' && resource.metadata?.name === 'chirp-web');
assert(installationProfileValue(applicationHost?.spec?.replicas), 'ChirpInstallation.spec.profile must drive ApplicationHost replicas.');
const queryGateways = chirpRgd.spec.resources.map((resource) => resource.template).filter((resource) => resource?.kind === 'Deployment' && resource.metadata?.labels?.['app.kubernetes.io/component'] === 'query-gateway');
const queryGatewayContainers = queryGateways.flatMap((resource) => resource.spec?.template?.spec?.containers ?? []);
assert(
  queryGateways.length === 2
    && queryGateways.every((resource) => installationProfileValue(resource.spec?.replicas))
    && queryGatewayContainers.map((container) => container.name).sort().join(',') === 'chirp-account,chirp-social,chirp-system,runtime',
  'ChirpInstallation.spec.profile must drive both the dedicated Kubernetes gateway and the compatible three-gateway workload envelope.',
);
const administrationGateway = queryGateways.find((resource) => resource.metadata?.name === 'chirp-administration');
const administrationNamespaceEnvironment = administrationGateway?.spec?.template?.spec?.containers?.[0]?.env?.find((entry) => entry.name?.startsWith('APPLIK8S_KUBERNETES_QUERY_'));
assert(administrationNamespaceEnvironment?.value === installationNamespace, 'The administration gateway must receive its evaluated installation namespace at deployment time.');
const administrationQueryRoles = chirpRgd.spec.resources.filter((resource) =>
  ['Role', 'ClusterRole'].includes(resource.template?.kind)
  && resource.template?.metadata?.name === 'chirp-administration');
assert(
  administrationQueryRoles.length === 1
    && administrationQueryRoles[0]?.template?.kind === 'Role'
    && administrationQueryRoles[0]?.template?.metadata?.namespace === installationNamespace
    && administrationQueryRoles[0]?.template?.rules?.some((rule) =>
      rule.apiGroups?.join(',') === 'chirp.applik8s.dev'
      && rule.resources?.join(',') === 'moderationpolicies'
      && rule.verbs?.join(',') === 'get,list,watch'),
  'The Kubernetes query gateway must receive only namespaced get/list/watch access to ModerationPolicy.',
);
const analyticsCluster = chirpRgd.spec.resources.map((resource) => resource.template).find((resource) => resource?.kind === 'ClickHouseInstallation' && resource.metadata?.name === 'chirp-analytics');
assert(installationProfileValue(analyticsCluster?.spec?.templates?.volumeClaimTemplates?.[0]?.spec?.resources?.requests?.storage), 'ChirpInstallation.spec.profile must drive analytics storage.');
const analyticsResources = chirpRgd.spec.resources.filter((resource) =>
  resource.template?.kind === 'ClickHouseInstallation'
  || resource.externalRef?.kind === 'ClickHouseHelmRepository'
  || resource.externalRef?.kind === 'ClickHouseOperatorBootstrap'
  || (resource.template?.kind === 'Deployment'
    && resource.template?.spec?.template?.spec?.containers?.some((container) => /analytics-hourly$/.test(container.name ?? ''))));
const analyticsWorkers = analyticsResources.filter((resource) => resource.template?.kind === 'Deployment');
const analyticsInstallationResources = analyticsResources.filter((resource) =>
  resource.template?.kind === 'ClickHouseInstallation'
  || resource.template?.kind === 'Deployment');
const analyticsSharedPrerequisites = analyticsResources.filter((resource) =>
  resource.externalRef?.kind === 'ClickHouseHelmRepository'
  || resource.externalRef?.kind === 'ClickHouseOperatorBootstrap');
assert(
  analyticsResources.length === 4
    && analyticsWorkers.length === 1
    && analyticsWorkers[0]?.template?.spec?.template?.spec?.containers?.filter((container) => /analytics-hourly$/.test(container.name ?? '')).length === 3
    && analyticsInstallationResources.every((resource) => resource.includeWhen?.some((condition) => condition.includes('schema.spec.features.analytics')))
    && analyticsSharedPrerequisites.length === 2,
  'Analytics feature selection must omit the installation-owned ClickHouse data plane and co-located three-projection worker while retaining the singleton-owned shared operator prerequisites.',
);
const workflowResources = chirpRgd.spec.resources.filter((resource) =>
  ['chirp-workflows', 'chirp-workflows-db', 'chirp-workflows-repository'].includes(resource.template?.metadata?.name));
assert(
  workflowProvider?.config?.enabled === true
    && workflowResources.map((resource) => resource.template?.kind).sort().join(',')
      === 'Deployment,NetworkPolicy,PodDisruptionBudget,Service'
    && workflowResources.every((resource) => !JSON.stringify(resource.includeWhen ?? []).includes('features.automatedAccounts')),
  'The direct TypeKro Hatchet provider, private workflow gateway, and root worker resources must remain available for core projection recovery and resource tracking independently of automated accounts.',
);
const graphOwnedWorkloadNamespaces = chirpRgd.spec.resources
  .map((resource) => resource.template)
  .filter((resource) => resource?.apiVersion === 'v1' && resource?.kind === 'Namespace' && resource.metadata?.name === installationNamespace);
assert(graphOwnedWorkloadNamespaces.length === 0, 'TypeKro 0.27+ must hoist the workload Namespace out of the RGD so instance finalization cannot delete its own lifecycle boundary.');
const hoistedWorkloadNamespaces = resources.filter((resource) => resource?.apiVersion === 'v1' && resource?.kind === 'Namespace' && resource.metadata?.name === installationNamespace);
assert(hoistedWorkloadNamespaces.length === 1, `Chirp must emit exactly one TypeKro-hoisted workload Namespace distinct from the control-plane instance Namespace, found ${hoistedWorkloadNamespaces.length}.`);
const templateManifests = await readFile(join(output, 'typekro/template-manifests.txt'), 'utf8');
assert(templateManifests.split('\n').some((line) => line.includes('-namespace-') && line.includes('schema.spec.name')), 'The hoisted external Namespace must be classified as observed-only so apply never tries to take ownership of it.');
const publicExposure = graph.nodes.find((node) => node.kind === 'exposure' && node.name === 'web-public');
const localExposure = graph.nodes.find((node) => node.kind === 'exposure' && node.name === 'web-local');
assert(publicExposure?.enabled?.includes('schema.spec.exposure.mode') && localExposure?.enabled?.includes('schema.spec.exposure.mode'), 'Chirp exposure transport must be selected by typed installation desired state.');
const publicIngress = chirpRgd.spec.resources.map((resource) => resource.template).find((resource) => resource?.kind === 'Ingress' && resource.metadata?.name === 'web-public-ingress');
assert(publicIngress?.spec?.rules?.[0]?.host === ['$', '{schema.spec.hostname}'].join(''), 'ChirpInstallation.spec.hostname must drive the generated Ingress rather than a build-time hostname.');
const publicService = chirpRgd.spec.resources.map((resource) => resource.template).find((resource) => resource?.kind === 'Service' && resource.metadata?.name === 'web-local-node-port');
assert(publicService?.spec?.type === 'NodePort' && publicService.spec.ports?.[0]?.nodePort === ['$', '{schema.spec.exposure.nodePort}'].join(''), 'Each local Chirp installation must select its own bounded NodePort through typed desired state.');
assert(publicService?.metadata?.annotations?.['applik8s.dev/public-url']?.includes('schema.spec.exposure.nodePort'), 'The local NodePort Service must carry the installation-derived public URL projected into status.');
const objectStorageCredentials = chirpRgd.spec.resources.find((resource) => resource.id === 'applik8sObjectStorageCredentials');
assert(objectStorageCredentials?.externalRef?.kind === 'Secret' && objectStorageCredentials.externalRef.metadata?.name?.includes('schema.spec.profile'), 'Chirp must fail closed on the profile-selected object-storage credential reference.');
const objectStorageProvider = graph.nodes.find((node) => node.id === 'provider.object-storage')?.config?.objectStorage;
assert(objectStorageProvider?.bucket?.includes('schema.spec.providers.objectStorage.bucket') && objectStorageProvider.bucket.includes('schema.spec.name'), 'Chirp must select either the local installation-derived bucket or the typed external bucket reference.');
assert(
  // The compiler normalizes an unconditional includeWhen to absence because
  // KRO's active-resource semantics already make an externalRef mandatory.
  // Reject only a conditional credential boundary: projection rebuild is a
  // core recovery dependency even when media and scheduled backups are off.
  objectStorageCredentials.includeWhen === undefined
    && chirpRgd.spec.schema.status.ready.includes('applik8sObjectStorageCredentials')
    && chirpRgd.spec.schema.status.providerStatus.objectStorage.startsWith('${(true) ?')
    && chirpRgd.spec.schema.status.providerStatus.objectStorage.includes('applik8sObjectStorageCredentials'),
  'Every installation must require and observe object-storage credentials for immutable projection-rebuild evidence.',
);
const scheduledBackup = chirpRgd.spec.resources.find((resource) => resource.template?.kind === 'ScheduledBackup');
assert(
  scheduledBackup?.includeWhen?.length === 1
    && scheduledBackup.includeWhen[0].includes('schema.spec.profile == "starter"')
    && scheduledBackup.includeWhen[0].includes('schema.spec.profile == "dedicated"')
    && !scheduledBackup.includeWhen[0].includes('schema.spec.profile == "external"')
    && scheduledBackup.includeWhen[0].includes('schema.spec.backup.enabled')
    && scheduledBackup.template.spec?.cluster?.name === 'chirp-models'
    && scheduledBackup.template.spec?.method === 'barmanObjectStore',
  'Chirp backup desired state must emit one condition-aware CNPG ScheduledBackup for the externally observed direct cluster.',
);
const valkeyIndex = chirpRgd.spec.resources.find((resource) => resource.id === 'chirpProvidedValkeyIndex');
assert(valkeyIndex?.externalRef?.apiVersion === 'hyperspike.io/v1' && valkeyIndex.externalRef.kind === 'Valkey' && valkeyIndex.externalRef.metadata?.name === 'chirp-online-index', 'Chirp must observe the direct-lifecycle Valkey cluster without adopting its operator-owned children into the KRO ApplySet.');
assert(!chirpRgd.spec.resources.some((resource) => resource.template?.apiVersion === 'hyperspike.io/v1' && resource.template?.kind === 'Valkey'), 'The Chirp KRO graph must not own a Hyperspike Valkey CR whose propagated ApplySet labels would prune controller-owned Services.');
const installationContract = chirpRgd.spec.resources.find((resource) => resource.id === 'applik8sInstallationContract');
assert(installationContract?.template?.kind === 'ConfigMap' && installationContract.template.data?.artifactDigest === '__APPLIK8S_ARTIFACT_SET_DIGEST__', 'Chirp must project instance inputs and deployment provenance through a resource-anchored installation contract.');
assert(installationContract.template.data?.['spec.json'] === '${json.marshal(schema.spec)}', 'Chirp must expose one KRO-owned non-secret installation desired-state document to authored runtimes.');
const authoredDeployments = chirpRgd.spec.resources.filter((resource) => resource.template?.kind === 'Deployment'
  && resource.template?.metadata?.labels?.['app.kubernetes.io/managed-by'] === 'applik8s');
assert(authoredDeployments.length > 0, 'Chirp must generate Applik8s-authored Deployment resources.');
assert(
  authoredDeployments.every((resource) => {
    const pod = resource.template.spec?.template?.spec;
    return Number(pod?.terminationGracePeriodSeconds) >= 30
      && pod?.containers?.every((container) => container.resources?.requests?.cpu && container.resources?.requests?.memory && container.resources?.limits?.cpu && container.resources?.limits?.memory && container.readinessProbe && container.livenessProbe);
  }),
  'Every Applik8s-authored Chirp Deployment must declare capacity, readiness/liveness, and bounded graceful shutdown.',
);
assert(
  authoredDeployments.every((resource) => resource.template.spec?.template?.metadata?.annotations?.['applik8s.dev/requested-version'] === '${string(schema.spec.version)}'),
  'Every Applik8s-authored Deployment must roll when the typed installation version changes.',
);
assert(
  authoredDeployments.every((resource) => resource.template.spec?.template?.spec?.containers?.every((container) =>
    container.env?.some((entry) => entry.name === 'APPLIK8S_INSTALLATION_SPEC'
      && entry.valueFrom?.configMapKeyRef?.name === 'chirp-installation-contract'
      && entry.valueFrom?.configMapKeyRef?.key === 'spec.json'))),
  'Every Applik8s-authored runtime container must receive the KRO-owned installation desired-state document.',
);
assert(!JSON.stringify(chirpRgd.spec.schema.status).includes('omit()'), 'KRO instance status expressions must not use resource-template-only omit().');
const nackReference = chirpRgd.spec.resources.find((resource) =>
  resource.externalRef?.kind === 'HelmRelease'
  && resource.externalRef?.metadata?.name === 'nack');
assert(
  nackReference?.externalRef?.metadata?.namespace === 'typekro-nack-system'
    && jetStreamResources
      .filter((resource) => resource.template?.kind === 'Stream')
      .every((resource) =>
      Object.values(resource.template?.metadata?.annotations ?? {})
        .includes('${applik8sEventsNackHelmRelease.metadata.name}')),
  'Chirp must observe the TypeKro-owned NACK singleton and order every KRO-owned JetStream resource behind it.',
);
const embeddedRuntimeBundle = chirpRgd.spec.resources.find((resource) => resource.template?.kind === 'ConfigMap' && Object.keys({ ...resource.template.data, ...resource.template.binaryData }).some((key) => /\.(?:mjs|cjs|js)(?:\.gz)?$/.test(key)));
assert(!embeddedRuntimeBundle, 'Chirp must not transport executable JavaScript through ConfigMaps.');
const bundleManifest = await json(join(output, 'typekro/typekro-composition.json'));
const executableArtifacts = [...(bundleManifest.spec.migrations ?? []), ...(bundleManifest.spec.processors ?? []), ...(bundleManifest.spec.workflows ?? []), ...(bundleManifest.spec.reactive ?? [])];
assert(executableArtifacts.length > 0, 'Chirp must emit generated executable workload artifacts.');
for (const artifact of executableArtifacts) {
  assert(artifact.container?.image?.startsWith('applik8s/') && /^sha-[0-9a-f]{64}$/.test(artifact.container?.tag ?? ''), `${artifact.name} must use a content-tagged generated OCI image.`);
  assert((await readFile(artifact.container.dockerfilePath, 'utf8')).includes('COPY --chown=1000:1000'), `${artifact.name} must emit an immutable OCI Dockerfile.`);
}

const generated = await recursiveFiles(join(output, 'typekro'));
const chirpRgdPath = generated.find((path) => path.endsWith('/resources/04-resourcegraphdefinition-chirp.yaml'));
assert(chirpRgdPath, 'Chirp build must emit its ResourceGraphDefinition as a standalone artifact.');
const resourceGraphDefinitionBytes = (await stat(chirpRgdPath)).size;
assert(
  resourceGraphDefinitionBytes <= budgets.chirp.maximumResourceGraphDefinitionBytes,
  `Chirp ResourceGraphDefinition is ${resourceGraphDefinitionBytes} bytes; budget is ${budgets.chirp.maximumResourceGraphDefinitionBytes}.`,
);
const dockerfiles = [...new Set([
  join(output, 'typekro/application-host/Dockerfile.applik8s-host'),
  ...executableArtifacts.map((artifact) => artifact.container?.dockerfilePath).filter(Boolean),
])];
const containerContexts = await Promise.all(dockerfiles.map(async (dockerfile) => {
  const directory = dirname(dockerfile);
  const files = await recursiveFiles(directory);
  assert(!files.some((path) => path.endsWith('.map')), `Generated OCI context ${relative(root, directory)} must not ship compiler source maps by default.`);
  return {
    path: relative(root, directory),
    files: files.length,
    bytes: await totalFileBytes(files),
  };
}));
const totalContainerContextBytes = containerContexts.reduce((sum, context) => sum + context.bytes, 0);
const maximumContainerContextBytes = Math.max(0, ...containerContexts.map((context) => context.bytes));
assert(totalContainerContextBytes <= budgets.chirp.maximumTotalContainerContextBytes, `Chirp generated OCI contexts total ${totalContainerContextBytes} bytes; budget is ${budgets.chirp.maximumTotalContainerContextBytes}.`);
assert(maximumContainerContextBytes <= budgets.chirp.maximumContainerContextBytes, `Chirp largest generated OCI context is ${maximumContainerContextBytes} bytes; budget is ${budgets.chirp.maximumContainerContextBytes}.`);
for (const sourceMapPath of generated.filter((path) => path.endsWith('.mjs.map'))) {
  const sourceMap = await json(sourceMapPath);
  assert(!Object.hasOwn(sourceMap, 'sourcesContent'), `Generated source map ${relative(root, sourceMapPath)} must not embed application or dependency source content.`);
}

const instanceFiles = await recursiveFiles(join(output, 'typekro/instances'));
for (const path of instanceFiles) {
  const source = await readFile(path, 'utf8');
  assert(!source.includes('kind: ChirpInstallation'), 'The compiler must not fabricate an empty ChirpInstallation; apply an explicit installation resource.');
}
assert(instanceFiles.length >= 2, 'Installable applications must retain TypeKro singleton owner instances even though the compiler never fabricates the root Application instance.');
const singletonInstances = await Promise.all(instanceFiles.map(async (path) => ({ path, source: await readFile(path, 'utf8') })));
assert(singletonInstances.some(({ source }) => source.includes('kind: ClickHouseHelmRepository') && source.includes('typekro.io/singleton-spec-fingerprint')), 'The shared ClickHouse repository singleton must retain TypeKro drift identity in the installable bundle.');
assert(singletonInstances.some(({ source }) => source.includes('kind: ClickHouseOperatorBootstrap') && source.includes('typekro.io/singleton-spec-fingerprint')), 'The ClickHouse operator singleton must retain TypeKro drift identity in the installable bundle.');
const exampleInstallation = await readFile(join(example, 'kubernetes/chirp.example.yaml'), 'utf8');
assert(exampleInstallation.includes('kind: ChirpInstallation') && exampleInstallation.includes('namespace: chirp-control'), 'Chirp must ship an explicit control-plane installation example.');
assert(exampleInstallation.includes('registryProjectDeletion: delete') && exampleInstallation.includes('purgeRegistryRepositories: true'), 'The disposable local example must make its destructive Harbor lifecycle policy explicit.');
assert(exampleInstallation.includes('databaseDeletion: retain') && exampleInstallation.includes('retentionPolicy: 14d'), 'The local example must make retained PostgreSQL data and its backup window explicit.');
assert(exampleInstallation.includes('nodePort: 30080'), 'The local installation example must choose its collision domain explicitly.');
assert(exampleInstallation.includes('mode: node-port'), 'The local installation example must select its exposure transport through typed desired state.');
const packageManifest = await json(join(example, 'package.json'));
assert(!packageManifest.scripts['prepare:objects'] && !packageManifest.scripts['delete:objects'], 'Chirp object storage must be part of the ordinary deployment planner, not a manual side script.');
const baselineMigration = await readFile(join(example, 'drizzle/0000_chirp.sql'), 'utf8');
const accountDefaultRepair = await readFile(join(example, 'drizzle/0004_account_state_default.sql'), 'utf8');
const accountIdentityRepair = await readFile(join(example, 'drizzle/0005_account_identity_default.sql'), 'utf8');
const notificationCreatedAtRepair = await readFile(join(example, 'drizzle/0006_notification_created_at_default.sql'), 'utf8');
const accountSchemaSource = await readFile(join(example, 'src/schema/accounts.ts'), 'utf8');
const baselineAccounts = sqlTableDefinition(baselineMigration, 'accounts');
assert(baselineAccounts.includes("state text DEFAULT 'saved' NOT NULL"), 'The historically applied Chirp baseline migration must remain immutable; account-state repair belongs in a forward migration.');
assert(accountDefaultRepair.includes("ALTER COLUMN state SET DEFAULT 'active'"), 'Existing Chirp installations must repair the historical account-state default before registration is qualified.');
assert(accountSchemaSource.includes("id: field.text('id').default(authenticatedPrincipalId).primaryKey()") && accountSchemaSource.includes("state: field.text('state').notNull().default('active')"), 'The Applik8s model authority must declare principal-derived account identity and active registration state.');
assert(baselineAccounts.includes('id text PRIMARY KEY'), 'The historically applied baseline must retain its original account identity column; trusted identity repair belongs in a forward migration.');
assert(accountIdentityRepair.includes("ALTER COLUMN id SET DEFAULT nullif(current_setting('applik8s.principal.id', true), '')"), 'Existing Chirp installations must receive the trusted-principal account identity default.');
assert(notificationCreatedAtRepair.includes("ALTER COLUMN \"created_at\" SET DEFAULT ''"), 'Existing Chirp installations must let the server stamp notification creation time without browser-authored timestamps.');

for (const fragment of [
  'processors/chirp-commands/processor.mjs',
  'reactive/chirp-social/runtime.mjs',
  'reactive/chirp-account/runtime.mjs',
  'reactive/chirp-administration/runtime.mjs',
  'reactive/chirp-validate-created-account-create/runtime.mjs',
  'reactive/chirp-validate-published-post-create/runtime.mjs',
  'reactive/chirp-validate-updated-post-update/runtime.mjs',
  'reactive/chirp-validate-deleted-post-delete/runtime.mjs',
  'reactive/chirp-verify-uploaded-media/runtime.mjs',
  'reactive/chirp-reconcile-automation-schedules/runtime.mjs',
  'reactive/chirp-post-analytics-hourly/runtime.mjs',
  'workflows/chirp-workflows/workflow-worker.mjs',
  'application-host/Dockerfile.applik8s-host',
]) {
  assert(generated.some((path) => path.endsWith(fragment)), `Chirp build did not emit ${fragment}.`);
}
const commandProcessorSource = await readFile(join(output, 'typekro/processors/chirp-commands/processor.generated.ts'), 'utf8');
const commandProcessorRuntimePath = join(output, 'typekro/processors/chirp-commands/processor.mjs');
const workflowWorkerRuntimePath = join(output, 'typekro/workflows/chirp-workflows/workflow-worker.mjs');
const workflowCallingStreamRuntimePath = join(output, 'typekro/reactive/chirp-reconcile-automation-schedules/runtime.mjs');
const commandProcessorBytes = (await stat(commandProcessorRuntimePath)).size;
const workflowWorkerBytes = (await stat(workflowWorkerRuntimePath)).size;
const workflowCallingStreamProcessorBytes = (await stat(workflowCallingStreamRuntimePath)).size;
assert(commandProcessorBytes <= budgets.chirp.maximumCommandProcessorBytes, `Chirp command processor is ${commandProcessorBytes} bytes; budget is ${budgets.chirp.maximumCommandProcessorBytes}.`);
assert(workflowWorkerBytes <= budgets.chirp.maximumWorkflowWorkerBytes, `Chirp workflow worker is ${workflowWorkerBytes} bytes; budget is ${budgets.chirp.maximumWorkflowWorkerBytes}.`);
assert(workflowCallingStreamProcessorBytes <= budgets.chirp.maximumWorkflowCallingStreamProcessorBytes, `Chirp workflow-calling stream processor is ${workflowCallingStreamProcessorBytes} bytes; budget is ${budgets.chirp.maximumWorkflowCallingStreamProcessorBytes}.`);
assert(
  commandProcessorSource.includes('const Account = Object.freeze')
    && commandProcessorSource.includes('context.models["Account"]'),
  'Direct Account.get(...) policy reads must compile into a typed transaction-scoped model binding without an authored dependency map.',
);
const workflowWorkerSource = await readFile(workflowWorkerRuntimePath, 'utf8');
assert(workflowWorkerSource.includes('applik8s.task-query/v1alpha1') && workflowWorkerSource.includes('Post.homeTimeline') && workflowWorkerSource.includes('AutomationControl.current'), 'The workflow worker must bundle its schema-bound task-query runtime and both declared views.');
assert(workflowWorkerSource.includes('REPEATABLE READ READ ONLY') && workflowWorkerSource.includes('different projection definition') && workflowWorkerSource.includes('applik8s.online-projection-rebuild/v1alpha1'), 'The workflow worker must bundle authoritative PostgreSQL snapshot, immutable-manifest resume, and projection-rebuild integrity semantics.');
assert(workflowWorkerSource.includes('http://chirp-social:8080/') && workflowWorkerSource.includes('http://chirp-administration:8080/'), 'Task queries must use same-namespace Service discovery that remains valid for installation-derived namespaces.');
assert(!workflowWorkerSource.includes('http://chirp-social.${schema.spec.name}') && !workflowWorkerSource.includes('http://chirp-administration.${schema.spec.name}'), 'Generated Node workers must never receive unevaluated KRO namespace expressions.');
const workflowCallingStreamSource = await readFile(workflowCallingStreamRuntimePath, 'utf8');
for (const authoringOnlyMarker of ['typekro', '@kubernetes/client-node', 'ObservableAPI', 'CoreV1Api']) {
  assert(!workflowWorkerSource.includes(authoringOnlyMarker), `Workflow workers must not bundle authoring-only dependency ${authoringOnlyMarker}.`);
  assert(!workflowCallingStreamSource.includes(authoringOnlyMarker), `Workflow-calling stream processors must not bundle authoring-only dependency ${authoringOnlyMarker}.`);
}
const socialGatewaySource = await readFile(join(output, 'typekro/reactive/chirp-social/runtime.mjs'), 'utf8');
assert(socialGatewaySource.includes('applik8s.task-query/v1alpha1') && socialGatewaySource.includes('inputKey') && socialGatewaySource.includes('/snapshot'), 'Generated gateways must verify short-lived query-, input-, operation-, and audience-bound task admissions.');
const accountGatewaySource = await readFile(join(output, 'typekro/reactive/chirp-account/runtime.mjs'), 'utf8');
const socialGatewayBytes = (await stat(join(output, 'typekro/reactive/chirp-social/runtime.mjs'))).size;
const accountGatewayBytes = (await stat(join(output, 'typekro/reactive/chirp-account/runtime.mjs'))).size;
assert(
  socialGatewayBytes <= budgets.chirp.maximumFocusedQueryGatewayBytes
    && accountGatewayBytes <= budgets.chirp.maximumFocusedQueryGatewayBytes,
  `Focused query gateways must remain below ${budgets.chirp.maximumFocusedQueryGatewayBytes} bytes (social=${socialGatewayBytes}, account=${accountGatewayBytes}) instead of replaying the authoring graph.`,
);
assert(!socialGatewaySource.includes('typekro') && !accountGatewaySource.includes('typekro'), 'Focused query gateways must not bundle TypeKro or other authoring-only infrastructure modules.');
const administrationGatewaySource = await readFile(join(output, 'typekro/reactive/chirp-administration/runtime.mjs'), 'utf8');
assert(administrationGatewaySource.includes('APPLIK8S_KUBERNETES_QUERY_') && administrationGatewaySource.includes('moderationpolicies') && administrationGatewaySource.includes('/__applik8s/v1'), 'The administration gateway must bundle its Kubernetes snapshot/watch authority behind the ordinary query protocol.');

const artifactReport = {
  schemaVersion: 1,
  release: 'v0.6',
  evidenceClass: 'local-build-artifacts',
  limitations: [
    'OCI context bytes are exact generated build-input sizes, not compressed registry layer or pulled image sizes.',
    'Build durations are local wall-clock observations and exclude container build, registry push/pull, Kubernetes scheduling, and startup.',
  ],
  generatedAt: new Date().toISOString(),
  git: await collectV06GitIdentity(root, {
    exclude: [
      'benchmarks/v0.6/chirp-artifacts/baseline.json',
      'benchmarks/v0.6/chirp-artifacts/history/',
    ],
  }),
  environment: {
    platform: platform(),
    architecture: process.arch,
    cpuModel: cpus()[0]?.model ?? 'unknown',
    cpuCount: cpus().length,
    runtime: `node-${process.version}`,
  },
  build: {
    webDurationMs: round(webBuildDurationMs),
    compilerDurationMs: round(compilerBuildDurationMs),
  },
  graph: {
    nodes: graph.nodes.length,
    resourceGraphDefinitionBytes,
    generatedArtifacts: generated.length,
    prerequisiteInstances: instanceFiles.length,
  },
  web: {
    browserJavaScriptGzipBytes: browserGzipBytes,
    serverFiles: serverFiles.length,
    serverOutputBytes,
  },
  containers: {
    count: containerContexts.length,
    totalContextBytes: totalContainerContextBytes,
    maximumContextBytes: maximumContainerContextBytes,
    contexts: containerContexts,
  },
};
if (record) {
  const directory = join(root, 'benchmarks/v0.6/chirp-artifacts');
  const history = join(directory, 'history');
  await mkdir(history, { recursive: true });
  await writeFile(join(directory, 'baseline.json'), `${JSON.stringify(artifactReport, null, 2)}\n`);
  const name = `${artifactReport.generatedAt.replace(/[:.]/g, '-')}-${artifactReport.git.commit.slice(0, 8)}-${artifactReport.environment.platform}-${artifactReport.environment.architecture}.json`;
  await writeFile(join(history, name), `${JSON.stringify(artifactReport, null, 2)}\n`);
}
console.log(`Chirp full application build passed: ${graph.nodes.length} graph nodes, ${browserGzipBytes} browser gzip bytes, ${serverOutputBytes} server bytes, ${resourceGraphDefinitionBytes} RGD bytes, ${totalContainerContextBytes} OCI context bytes, ${generated.length} generated TypeKro artifacts, ${instanceFiles.length} prerequisite instances.`);

async function json(path) { return JSON.parse(await readFile(path, 'utf8')); }
function assert(condition, message) { if (!condition) throw new Error(message); }

function sqlTableDefinition(source, table) {
  const match = source.match(new RegExp(`CREATE TABLE ${table} \\(([^]*?)\\n\\);`));
  assert(match?.[1], `Missing ${table} table from the immutable Chirp baseline migration.`);
  return match[1];
}
function containsExpressionDescriptor(value) {
  if (!value || typeof value !== 'object') return false;
  if (Object.hasOwn(value, 'expression')) return true;
  return Object.values(value).some(containsExpressionDescriptor);
}
function isEmptyObject(value) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0; }
function visit(value, callback, path = '$') {
  callback(value, path);
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) visit(entry, callback, `${path}[${index}]`);
    return;
  }
  for (const [key, entry] of Object.entries(value)) visit(entry, callback, `${path}.${key}`);
}

async function recursiveFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? recursiveFiles(path) : [path];
  }))).flat();
}

async function totalFileBytes(files) {
  return (await Promise.all(files.map(async (path) => (await stat(path)).size))).reduce((sum, size) => sum + size, 0);
}

function round(value) { return Math.round(value * 100) / 100; }

async function run(command, args, cwd, extraEnvironment = {}) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...extraEnvironment }, stdio: 'inherit' });
  const code = await new Promise((resolve) => child.once('exit', resolve));
  if (code !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${code}.`);
}
