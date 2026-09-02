// typecast-file-boundary: the release runner validates generated manifests,
// Kubernetes objects, and Playwright reports before using their fields.
import { createHash, randomUUID } from 'node:crypto';
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { agenticProductEvidenceJourneys } from '../packages/e2e/browser/agentic-product-evidence-contract.js';
import { createApplicationAgenticStart } from '../packages/start-agentic/src/index.js';
import { checkAgenticProductBundles } from './check-agentic-product-bundles.js';
import {
  materializePackedGeneratedWorkspaceDependencies,
  writeOfficialTanStackScaffold,
} from './generated-agentic-start-live-support.js';
import {
  captureIdentityStartCommand,
  type IdentityStartServiceTunnel,
  identityStartResourceExists,
  identityStartServiceTunnel,
  passedIdentityStartBrowserProjectTests,
  passedIdentityStartBrowserTests,
  runIdentityStartCommand,
  waitForIdentityStartAbsent,
} from './identity-start-live-support.js';
import {
  collectV06ArtifactIdentity,
  collectV06ClusterIdentity,
  collectV06GitIdentity,
  collectV06InstallationIdentity,
  createV06AssertionEvidence,
  discardV06Evidence,
  writeV06EvidenceReceipt,
} from './v06-evidence.js';
import {
  v09EvidenceDirectory,
  v09ReleaseEvidenceContract,
} from './v09-release-evidence-contract.js';

const root = process.cwd();
const context = process.env.APPLIK8S_E2E_CONTEXT ?? 'orbstack';
const projectName = 'agentic-product-evidence';
const target = join(root, '.applik8s-tmp', projectName);
const namespace = `${projectName}-system`;
const environmentFile = process.env.APPLIK8S_AGENTIC_PRODUCT_ENV_FILE;
const developerProfile = environmentFile !== undefined;
const assemblyProfile = developerProfile ? 'developer' : 'starter';
const instancePath = developerProfile
  ? 'kubernetes/application.developer.yaml'
  : 'kubernetes/application.yaml';
const instanceName = developerProfile ? `${projectName}-developer` : projectName;
const execution = {
  root,
  context,
  label: 'agentic-product-starter',
} as const;
const cli = join(root, 'packages/cli/dist/bin.js');
const timeoutMs = 20 * 60_000;
const evidencePath = join(
  root,
  v09EvidenceDirectory,
  'agentic-product-starter.json',
);
const requiredAssertions = v09ReleaseEvidenceContract['agentic-product-starter'];
if (!requiredAssertions) {
  throw new Error('The v0.9 evidence contract must define the Agentic product suite.');
}
const deploymentGraphPath = join(
  target,
  '.applik8s/deploy/typekro/application-deployment-graph.json',
);
const runId = randomUUID();
const startedAt = new Date().toISOString();
const focusedBrowserTest = process.env.APPLIK8S_AGENTIC_PRODUCT_TEST_GREP;
const observed = new Map<
  string,
  { readonly test: string; readonly observedAt: string }
>();
let deployed = false;
let tunnel: IdentityStartServiceTunnel | undefined;
const preservedEnvironmentFiles = new Map<string, string>();
let qualificationEnvironmentBackup: string | undefined;
let qualificationEnvironmentOverlay = false;
let buildLineage = '';

async function waitForExactGeneratedHandoff(
  url: string,
  expectedBuildLineage: string,
): Promise<void> {
  const deadline = Date.now() + 90_000;
  let consecutiveHealthyResponses = 0;
  let lastDiagnostic = 'the application did not answer';

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/app`, {
        signal: AbortSignal.timeout(10_000),
      });
      const body = await response.text();
      const exactBuild = body.includes('applik8s-build-lineage')
        && body.includes(expectedBuildLineage);
      if (response.ok && body.includes('What should we accomplish?') && exactBuild) {
        consecutiveHealthyResponses += 1;
        if (consecutiveHealthyResponses >= 3) return;
      } else {
        consecutiveHealthyResponses = 0;
        const responseExcerpt = body
          .replace(/\s+/gu, ' ')
          .slice(0, 500);
        lastDiagnostic = `HTTP ${response.status}; heading=${body.includes('What should we accomplish?')}; exactBuild=${exactBuild}; body=${JSON.stringify(responseExcerpt)}`;
      }
    } catch (error) {
      consecutiveHealthyResponses = 0;
      lastDiagnostic = error instanceof Error ? error.message : String(error);
    }
    await new Promise(resolve => setTimeout(resolve, 2_000));
  }

  throw new Error(
    `The deployed handoff server did not serve the exact generated build for three consecutive observations: ${lastDiagnostic}`,
  );
}

async function restoreQualificationEnvironment(): Promise<void> {
  if (!qualificationEnvironmentOverlay) return;
  const overlay = join(target, '.env.local');
  await rm(overlay, { force: true });
  if (qualificationEnvironmentBackup) {
    await rename(qualificationEnvironmentBackup, overlay);
  }
  qualificationEnvironmentBackup = undefined;
  qualificationEnvironmentOverlay = false;
}

async function normalizeGeneratedMigrationIdentity(): Promise<string> {
  const directory = join(target, 'drizzle');
  const generated = (await readdir(directory)).filter(
    file => /^\d{4}_.+\.sql$/u.test(file),
  );
  if (generated.length !== 1) {
    throw new Error(
      `Expected one generated baseline migration, received ${generated.length}.`,
    );
  }
  const tag = '0000_agentic_product_schema';
  const filename = `${tag}.sql`;
  const generatedMigration = generated[0];
  if (!generatedMigration) {
    throw new Error('Generated migration selection became empty after validation.');
  }
  if (generatedMigration !== filename) {
    await rename(join(directory, generatedMigration), join(directory, filename));
  }

  const journalPath = join(directory, 'meta/_journal.json');
  const journal: unknown = JSON.parse(await readFile(journalPath, 'utf8'));
  const entries = journal && typeof journal === 'object'
    ? Reflect.get(journal, 'entries')
    : undefined;
  if (!Array.isArray(entries) || entries.length !== 1) {
    throw new Error('Expected one Drizzle journal entry for the baseline migration.');
  }
  const entry = entries[0];
  if (!entry || typeof entry !== 'object') {
    throw new Error('The generated Drizzle journal entry is malformed.');
  }
  Reflect.set(entry, 'tag', tag);
  Reflect.set(entry, 'when', 0);
  await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`);

  const snapshotPath = join(directory, 'meta/0000_snapshot.json');
  const snapshot: unknown = JSON.parse(await readFile(snapshotPath, 'utf8'));
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('The generated Drizzle baseline snapshot is malformed.');
  }
  Reflect.set(snapshot, 'id', '00000000-0000-4000-8000-000000000001');
  await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  return filename;
}

async function captureGeneratedContainerLogs(
  component: string,
  container: string,
) {
  let pods = await captureIdentityStartCommand(
    'kubectl',
    [
      '--context',
      context,
      'get',
      'pods',
      '--selector',
      `applik8s.dev/graph=${projectName},app.kubernetes.io/component=${component}`,
      '--namespace',
      namespace,
      '--output=json',
    ],
    root,
  );
  if (pods.code !== 0) return pods;
  try {
    const value: unknown = JSON.parse(pods.stdout);
    const items = value && typeof value === 'object'
      ? Reflect.get(value, 'items')
      : undefined;
    if (Array.isArray(items) && items.length === 0) {
      // Some framework-owned workloads predate graph-label propagation. The
      // generated product owns this namespace, so component-only fallback is
      // still bounded to the qualification deployment and preserves useful
      // failure evidence while that compatibility seam is removed.
      pods = await captureIdentityStartCommand(
        'kubectl',
        [
          '--context',
          context,
          'get',
          'pods',
          '--selector',
          `app.kubernetes.io/component=${component}`,
          '--namespace',
          namespace,
          '--output=json',
        ],
        root,
      );
    }
  } catch {
    return pods;
  }
  let selectedPod: string | undefined;
  try {
    const value: unknown = JSON.parse(pods.stdout);
    const items = value && typeof value === 'object'
      ? Reflect.get(value, 'items')
      : undefined;
    if (Array.isArray(items)) {
      for (const item of items) {
        const containers = item && typeof item === 'object'
          ? Reflect.get(Reflect.get(item, 'spec') ?? {}, 'containers')
          : undefined;
        if (!Array.isArray(containers) || !containers.some(
          (candidate) => candidate
            && typeof candidate === 'object'
            && Reflect.get(candidate, 'name') === container,
        )) continue;
        const metadata = Reflect.get(item, 'metadata');
        const name = metadata && typeof metadata === 'object'
          ? Reflect.get(metadata, 'name')
          : undefined;
        if (typeof name === 'string') {
          selectedPod = name;
          break;
        }
      }
    }
  } catch {
    return pods;
  }
  if (!selectedPod) return pods;
  return captureIdentityStartCommand(
    'kubectl',
    [
      '--context',
      context,
      'logs',
      selectedPod,
      '--namespace',
      namespace,
      '--container',
      container,
      '--tail=200',
    ],
    root,
  );
}

async function preserveGeneratedDiagnostic(
  name: string,
  diagnostic: { readonly stdout: string; readonly stderr: string },
): Promise<void> {
  const directory = join(
    root,
    v09EvidenceDirectory,
    'agentic-product-diagnostics',
  );
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, `${name}.log`),
    [diagnostic.stdout, diagnostic.stderr].filter(Boolean).join('\n'),
  );
}

async function captureLifecycleDatabaseDiagnostics() {
  const pods = await captureIdentityStartCommand(
    'kubectl',
    [
      '--context',
      context,
      'get',
      'pods',
      '--selector',
      `cnpg.io/cluster=${projectName}-db`,
      '--namespace',
      namespace,
      '--output=jsonpath={.items[0].metadata.name}',
    ],
    root,
  );
  const pod = pods.stdout.trim();
  if (pods.code !== 0 || !pod) return pods;
  return captureIdentityStartCommand(
    'kubectl',
    [
      '--context',
      context,
      'exec',
      pod,
      '--namespace',
      namespace,
      '--container',
      'postgres',
      '--',
      'psql',
      '--username=postgres',
      `--dbname=${projectName}`,
      '--tuples-only',
      '--no-align',
      '--command',
      `SELECT json_build_object(
  'requests', coalesce((SELECT json_agg(json_build_object('id', id, 'state', state, 'requestedAt', requested_at)) FROM data_lifecycle_requests), '[]'::json),
  'stream', coalesce((SELECT json_agg(json_build_object('id', id, 'sequence', sequence, 'contract', contract_name, 'recordedAt', recorded_at, 'payload', payload)) FROM applik8s_public_stream_events WHERE contract_name = 'models.DataLifecycleRequest.created'), '[]'::json),
  'checkpoint', coalesce((SELECT json_agg(json_build_object('processor', processor, 'stream', stream, 'sequence', sequence, 'updatedAt', updated_at)) FROM applik8s_stream_processor_checkpoints WHERE processor = 'process-data-lifecycle-request-create'), '[]'::json),
  'deadLetters', coalesce((SELECT json_agg(json_build_object('eventId', event_id, 'attempts', attempts, 'error', error)) FROM applik8s_stream_processor_dead_letters WHERE processor = 'process-data-lifecycle-request-create'), '[]'::json)
)::text;`,
    ],
    root,
  );
}

async function captureUsagePublicationDatabaseDiagnostics() {
  const pods = await captureIdentityStartCommand(
    'kubectl',
    [
      '--context',
      context,
      'get',
      'pods',
      '--selector',
      `cnpg.io/cluster=${projectName}-db`,
      '--namespace',
      namespace,
      '--output=jsonpath={.items[0].metadata.name}',
    ],
    root,
  );
  const pod = pods.stdout.trim();
  if (pods.code !== 0 || !pod) return pods;
  return captureIdentityStartCommand(
    'kubectl',
    [
      '--context',
      context,
      'exec',
      pod,
      '--namespace',
      namespace,
      '--container',
      'postgres',
      '--',
      'psql',
      '--username=postgres',
      `--dbname=${projectName}`,
      '--tuples-only',
      '--no-align',
      '--command',
      `SELECT json_build_object(
  'conversationRuns', coalesce((SELECT json_agg(json_build_object(
    'id', id,
    'status', status,
    'terminalReason', terminal_reason,
    'updatedAt', updated_at
  ) ORDER BY updated_at) FROM applik8s_conversation_runs), '[]'::json),
  'usageFacts', coalesce((SELECT json_agg(json_build_object(
    'id', id,
    'principalScope', principal_scope,
    'inputTokens', input_tokens,
    'outputTokens', output_tokens,
    'occurredAt', occurred_at
  ) ORDER BY occurred_at) FROM applik8s_usage_facts), '[]'::json),
  'eventOutbox', coalesce((SELECT json_agg(json_build_object(
    'id', id,
    'contract', contract_name || '.' || contract_version,
    'publishedAt', published_at
  ) ORDER BY created_at) FROM applik8s_event_outbox
    WHERE contract_name IN ('models.UsageFact.created', 'agentic.usage-recorded')), '[]'::json),
  'publicEvents', coalesce((SELECT json_agg(json_build_object(
    'id', id,
    'sequence', sequence,
    'contract', contract_name || '.' || contract_version,
    'recordedAt', recorded_at
  ) ORDER BY sequence) FROM applik8s_public_stream_events
    WHERE contract_name IN ('models.UsageFact.created', 'agentic.usage-recorded')), '[]'::json),
  'processorCheckpoints', coalesce((SELECT json_agg(json_build_object(
    'processor', processor,
    'stream', stream,
    'sequence', sequence,
    'updatedAt', updated_at
  )) FROM applik8s_stream_processor_checkpoints
    WHERE processor = 'deliver-billable-usage-create'), '[]'::json),
  'processorDeadLetters', coalesce((SELECT json_agg(json_build_object(
    'eventId', event_id,
    'attempts', attempts,
    'error', error
  )) FROM applik8s_stream_processor_dead_letters
    WHERE processor = 'deliver-billable-usage-create'), '[]'::json)
)::text;`,
    ],
    root,
  );
}

async function captureNotificationDatabaseDiagnostics() {
  const pods = await captureIdentityStartCommand(
    'kubectl',
    [
      '--context',
      context,
      'get',
      'pods',
      '--selector',
      `cnpg.io/cluster=${projectName}-db`,
      '--namespace',
      namespace,
      '--output=jsonpath={.items[0].metadata.name}',
    ],
    root,
  );
  const pod = pods.stdout.trim();
  if (pods.code !== 0 || !pod) return pods;
  return captureIdentityStartCommand(
    'kubectl',
    [
      '--context',
      context,
      'exec',
      pod,
      '--namespace',
      namespace,
      '--container',
      'postgres',
      '--',
      'psql',
      '--username=postgres',
      `--dbname=${projectName}`,
      '--tuples-only',
      '--no-align',
      '--command',
      `SELECT json_build_object(
  'invitations', coalesce((SELECT json_agg(json_build_object(
    'id', id,
    'workspaceId', workspace_id,
    'email', email,
    'state', state,
    'createdAt', created_at
  ) ORDER BY created_at) FROM workspace_invitations), '[]'::json),
  'notificationRequests', coalesce((SELECT json_agg(json_build_object(
    'id', id,
    'idempotencyKey', idempotency_key,
    'state', state,
    'attempts', attempts,
    'provider', provider,
    'providerMessageId', provider_message_id,
    'lastError', last_error,
    'createdAt', created_at,
    'updatedAt', updated_at
  ) ORDER BY created_at) FROM applik8s_notification_requests), '[]'::json),
  'publicEvents', coalesce((SELECT json_agg(json_build_object(
    'id', id,
    'sequence', sequence,
    'contract', contract_name || '.' || contract_version,
    'recordedAt', recorded_at,
    'payload', payload
  ) ORDER BY sequence) FROM applik8s_public_stream_events
    WHERE contract_name IN ('models.Invitation.created', 'models.NotificationRequest.created')), '[]'::json),
  'processorCheckpoints', coalesce((SELECT json_agg(json_build_object(
    'processor', processor,
    'stream', stream,
    'sequence', sequence,
    'updatedAt', updated_at
  )) FROM applik8s_stream_processor_checkpoints
    WHERE processor IN ('request-invitation-delivery-create', 'deliver-requested-notification-create')), '[]'::json),
  'processorDeadLetters', coalesce((SELECT json_agg(json_build_object(
    'processor', processor,
    'eventId', event_id,
    'attempts', attempts,
    'error', error
  )) FROM applik8s_stream_processor_dead_letters
    WHERE processor IN ('request-invitation-delivery-create', 'deliver-requested-notification-create')), '[]'::json)
)::text;`,
    ],
    root,
  );
}

if (!focusedBrowserTest) await discardV06Evidence(evidencePath);

try {
  await runIdentityStartCommand(
    execution,
    'build publishable Applik8s packages and the CLI',
    'node',
    ['scripts/build-publishable-packages.mjs'],
    root,
    { NODE_OPTIONS: '--max-old-space-size=8192' },
  );
  const priorDeploymentGraphPath = join(
    target,
    '.applik8s/deploy/typekro/application-deployment-graph.json',
  );
  const priorDeploymentExists =
    await identityStartResourceExists(
      execution,
      `resourcegraphdefinition/${projectName}`,
    )
    || await identityStartResourceExists(
      execution,
      `namespace/${namespace}`,
    );
  if (priorDeploymentExists) {
    if (!await Bun.file(priorDeploymentGraphPath).exists()) {
      throw new Error(
        'A prior generated product is still deployed, but its local Alchemy/TypeKro lifecycle state is absent. Restore the matching generated project and run `applik8s destroy`; refusing to reconcile a newly generated migration history over the retained database.',
      );
    }
    await runIdentityStartCommand(
      execution,
      'destroy the prior generated product through its preserved Alchemy and TypeKro state',
      cli,
      ['destroy', '--context', context],
      target,
    );
    await waitForIdentityStartAbsent(
      execution,
      `resourcegraphdefinition/${projectName}`,
      undefined,
      timeoutMs,
    );
    await waitForIdentityStartAbsent(
      execution,
      `namespace/${namespace}`,
      undefined,
      timeoutMs,
    );
  }
  for (const name of ['.env', '.env.local']) {
    const generatedEnvironmentPath = join(target, name);
    if (!await Bun.file(generatedEnvironmentPath).exists()) continue;
    const preservedEnvironmentPath = join(
      root,
      '.applik8s-tmp',
      `${projectName}.${runId}.${name.slice(1)}.preserved`,
    );
    await rename(generatedEnvironmentPath, preservedEnvironmentPath);
    preservedEnvironmentFiles.set(name, preservedEnvironmentPath);
  }
  await rm(target, { recursive: true, force: true });
  await createApplicationAgenticStart({
    targetDirectory: target,
    projectName,
    applik8sVersion: 'workspace:*',
    context,
    example: 'product',
    install: false,
    async run(command) {
      if (
        command.executable !== 'bunx'
        || command.arguments[0] !== '@tanstack/cli@0.70.1'
      ) {
        throw new Error(
          `Generated product invoked an unexpected scaffold command: ${command.executable} ${command.arguments.join(' ')}`,
        );
      }
      await writeOfficialTanStackScaffold(target, projectName);
    },
  });
  const packedWorkspacePackages = await materializePackedGeneratedWorkspaceDependencies({
    workspaceRoot: root,
    targetDirectory: target,
  });
  observed.set('workspace-package-boundary', {
    test: `the generated product materialized ${packedWorkspacePackages.length} built npm package artifacts without relying on root hoisting or workspace source traversal`,
    observedAt: new Date().toISOString(),
  });
  if (preservedEnvironmentFiles.size > 0) {
    for (const [name, preservedEnvironmentPath] of preservedEnvironmentFiles) {
      await rename(preservedEnvironmentPath, join(target, name));
    }
    preservedEnvironmentFiles.clear();
    observed.set('environment-preservation', {
      test: 'existing generated-project environment files were mechanically preserved across regeneration without reading, logging, or overwriting them',
      observedAt: new Date().toISOString(),
    });
  }
  if (environmentFile) {
    if (!await Bun.file(environmentFile).exists()) {
      throw new Error(`The requested mechanical environment source does not exist: ${environmentFile}`);
    }
    const overlay = join(target, '.env.local');
    if (await Bun.file(overlay).exists()) {
      qualificationEnvironmentBackup = join(
        root,
        '.applik8s-tmp',
        `${projectName}.${runId}.env-local.qualification-preserved`,
      );
      await rename(overlay, qualificationEnvironmentBackup);
    }
    qualificationEnvironmentOverlay = true;
    await copyFile(environmentFile, overlay);
    observed.set('environment-copy', {
      test: 'the requested environment file was mechanically overlaid for qualification and restored afterward without inspecting or logging its values',
      observedAt: new Date().toISOString(),
    });
  }

  await runIdentityStartCommand(
    execution,
    'run read-only generated product prerequisite diagnostics',
    cli,
    ['doctor', '--context', context],
    target,
  );
  observed.set('doctor', {
    test: 'applik8s doctor verified project and cluster prerequisites without reading .env values',
    observedAt: new Date().toISOString(),
  });
  await runIdentityStartCommand(
    execution,
    'generate the product relational migration',
    join(root, 'node_modules/.bin/drizzle-kit'),
    ['generate', '--config', 'drizzle.config.ts'],
    target,
  );
  const migrations = (await readdir(join(target, 'drizzle'))).filter(
    (file) => file.endsWith('.sql'),
  );
  if (migrations.length === 0) {
    throw new Error(
      'Drizzle reported success without generating a product migration.',
    );
  }
  const normalizedMigration = await normalizeGeneratedMigrationIdentity();
  observed.set('migration-generation', {
    test: `Drizzle generated the model-owned schema and the release runner normalized its reproducible baseline identity to ${normalizedMigration}`,
    observedAt: new Date().toISOString(),
  });
  await runIdentityStartCommand(
    execution,
    'generate the official TanStack file-route tree',
    join(root, 'node_modules/.bin/tsr'),
    ['generate'],
    target,
  );
  const lineage = JSON.parse(await readFile(join(target, '.applik8s-start.json'), 'utf8')) as { readonly templateRevision?: unknown };
  if (typeof lineage.templateRevision !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(lineage.templateRevision)) {
    throw new Error('Generated product lineage is missing its canonical template revision.');
  }
  buildLineage = lineage.templateRevision;
  await runIdentityStartCommand(
    execution,
    'run the generated product consumer gates',
    'bun',
    ['run', 'check'],
    target,
    {
      NODE_OPTIONS: '--max-old-space-size=8192',
      APPLIK8S_BUILD_LINEAGE: buildLineage,
    },
  );
  observed.set('generated-consumer-gates', {
    test: 'the clean generated application passed route generation, typecheck, lint, unit tests, application compilation, and database-schema verification',
    observedAt: new Date().toISOString(),
  });
  const bundleReport = await checkAgenticProductBundles(target);
  observed.set('production-build', {
    test: `official TanStack Start client, SSR, and Nitro production build within bundle ceilings (client ${bundleReport.javascriptBytes} bytes/${bundleReport.javascriptGzipBytes} gzip; compiled server ${bundleReport.serverJavaScriptBytes} bytes/${bundleReport.serverJavaScriptGzipBytes} gzip; traced runtime dependencies ${bundleReport.tracedDependencyJavaScriptBytes} bytes/${bundleReport.tracedDependencyJavaScriptGzipBytes} gzip; largest client chunk ${bundleReport.largestChunk.name}; largest server chunk ${bundleReport.largestServerChunk.name})`,
    observedAt: new Date().toISOString(),
  });

  deployed = true;
  await runIdentityStartCommand(
    execution,
    'deploy the generated product through Alchemy and TypeKro',
    cli,
    ['deploy', '--profile', assemblyProfile, '--context', context, '--instance', instancePath, '--skip-app-build'],
    target,
    { NODE_OPTIONS: '--max-old-space-size=8192' },
  );
  observed.set('graph-backed-deploy', {
    test: 'Alchemy and TypeKro deployed the generated product graph',
    observedAt: new Date().toISOString(),
  });
  const firstDeploymentGraphDigest = createHash('sha256')
    .update(await readFile(deploymentGraphPath))
    .digest('hex');
  console.log(
    `\n[${execution.label}] reapply the exact generated product to prove graph idempotency`,
  );
  const reapply = await captureIdentityStartCommand(
    cli,
    ['deploy', '--profile', assemblyProfile, '--context', context, '--instance', instancePath, '--skip-app-build'],
    target,
    { NODE_OPTIONS: '--max-old-space-size=8192' },
  );
  process.stdout.write(reapply.stdout);
  process.stderr.write(reapply.stderr);
  if (reapply.code !== 0) {
    throw new Error(
      `Exact generated product reapply failed with exit ${reapply.code}.`,
    );
  }
  if (!/Alchemy plan: \d+ resources, 0 changes,/u.test(reapply.stdout)) {
    throw new Error(
      'Exact generated product reapply was not a no-op according to the Alchemy plan.',
    );
  }
  const secondDeploymentGraphDigest = createHash('sha256')
    .update(await readFile(deploymentGraphPath))
    .digest('hex');
  if (secondDeploymentGraphDigest !== firstDeploymentGraphDigest) {
    throw new Error(
      `Exact generated product compilation changed its deployment graph (${firstDeploymentGraphDigest} -> ${secondDeploymentGraphDigest}).`,
    );
  }
  observed.set('graph-noop-redeploy', {
    test: 'the exact generated product graph reapplied without drift or migration conflict',
    observedAt: new Date().toISOString(),
  });

  await runIdentityStartCommand(
    execution,
    'observe the exact deployment and publish a bounded Launchpad receipt when application authority is reachable',
    cli,
    ['status', '--context', context],
    target,
  );
  observed.set('deployment-status', {
    test: 'the CLI observed the exact persisted graph and published canonical redacted Launchpad evidence through application authority',
    observedAt: new Date().toISOString(),
  });

  tunnel = await identityStartServiceTunnel(
    execution,
    `${projectName}-app`,
    namespace,
    3000,
  );
  await waitForExactGeneratedHandoff(tunnel.url, buildLineage);
  observed.set('handoff-freshness', {
    test: 'the live application served the exact generated template lineage and remained healthy at browser handoff',
    observedAt: new Date().toISOString(),
  });
  await runIdentityStartCommand(
    execution,
    'execute the generated product browser journeys',
    join(root, 'node_modules/.bin/playwright'),
    [
      'test',
      '--config',
      'playwright.agentic-product.config.ts',
      ...(focusedBrowserTest
        ? ['--grep', focusedBrowserTest]
        : []),
    ],
    root,
    {
      APPLIK8S_AGENTIC_PRODUCT_BASE_URL: tunnel.url,
      APPLIK8S_AGENTIC_PRODUCT_SOURCE_ROOT: target,
      APPLIK8S_AGENTIC_PRODUCT_PROFILE: developerProfile
        ? 'developer'
        : 'starter',
    },
  );
  const visualArtifactsRoot = join(
    root,
    v09EvidenceDirectory,
    'agentic-product-browser-artifacts',
  );
  const visualArtifacts = (await readdir(visualArtifactsRoot, { recursive: true }))
    .filter(path => path.endsWith('.png'));
  if (!focusedBrowserTest && visualArtifacts.length < 16) {
    throw new Error(`Generated product retained only ${visualArtifacts.length} visual captures; expected product, builder, billing, and operator views for four browser/device profiles.`);
  }
  if (!focusedBrowserTest) {
    observed.set('visual-review-artifacts', {
      test: `${visualArtifacts.length} desktop/mobile visual captures retained for product review`,
      observedAt: new Date().toISOString(),
    });
  }
  const journeys = new Map(
    Object.values(agenticProductEvidenceJourneys).map(
      journey => [journey.test, journey.evidenceId] as const,
    ),
  );
  const results = await passedIdentityStartBrowserTests(
    join(
      root,
      v09EvidenceDirectory,
      'agentic-product-browser-results.json',
    ),
  );
  if (
    !focusedBrowserTest
    && [...journeys.keys()].some((journey) => !results.has(journey))
  ) {
    throw new Error(
      `Generated Agentic product browser evidence is incomplete: ${[
        ...results.keys(),
      ].join(', ') || '<none>'}.`,
    );
  }
  for (const [journey, evidenceId] of journeys) {
    const browser = results.get(journey);
    if (!browser && !focusedBrowserTest) {
      throw new Error(`Generated product browser evidence vanished for ${journey}.`);
    }
    if (!browser) continue;
    observed.set(evidenceId, {
      test: journey,
      observedAt: browser.completedAt,
    });
  }
  const projectResults = await passedIdentityStartBrowserProjectTests(
    join(
      root,
      v09EvidenceDirectory,
      'agentic-product-browser-results.json',
    ),
  );
  const qualityJourneys = [
    'keeps the representative product surface responsive and free of browser failures',
    'exposes a keyboard-usable, semantically named first-run experience',
    'preserves product meaning in dark mode and reduced motion',
    'captures a reviewable product, builder, billing, and operator journey',
    'preserves SSR content, bounded navigation, and live-query recovery on a degraded connection',
    'recovers an authenticated session from a stale workspace selector',
    'uses one bounded mobile navigation with an authority-shaped More sheet',
  ] as const;
  const qualityProjects = [
    'chromium-product-quality',
    'firefox-product-quality',
    'webkit-product-quality',
    'mobile-product-quality',
  ] as const;
  const missingQualityEvidence: string[] = [];
  let qualityCompletedAtMs = 0;
  for (const project of qualityProjects) {
    for (const journey of qualityJourneys) {
      const result = projectResults.get(`${project}::${journey}`);
      if (!result) {
        missingQualityEvidence.push(`${project}/${journey}`);
        continue;
      }
      qualityCompletedAtMs = Math.max(
        qualityCompletedAtMs,
        Date.parse(result.completedAt),
      );
    }
  }
  if (!focusedBrowserTest && missingQualityEvidence.length > 0) {
    throw new Error(
      `Generated Agentic product cross-browser evidence is incomplete: ${missingQualityEvidence.join(', ')}.`,
    );
  }
  if (!focusedBrowserTest) {
    const qualityCompletedAt = new Date(qualityCompletedAtMs).toISOString();
    observed.set('cross-browser-product-quality', {
      test: 'Chromium, Firefox, WebKit, and mobile product quality journeys',
      observedAt: qualityCompletedAt,
    });
  }

  const [git, cluster, installation, artifacts] = await Promise.all([
    collectV06GitIdentity(root),
    collectV06ClusterIdentity(context),
    collectV06InstallationIdentity({
      context,
      resource: `agenticproductevidence/${instanceName}`,
      namespace: 'default',
    }),
    collectV06ArtifactIdentity(deploymentGraphPath),
  ]);
  await tunnel.close();
  tunnel = undefined;

  await runIdentityStartCommand(
    execution,
    'destroy the generated product through Alchemy and TypeKro',
    cli,
    ['destroy', '--context', context],
    target,
  );
  deployed = false;
  await waitForIdentityStartAbsent(
    execution,
    `resourcegraphdefinition/${projectName}`,
    undefined,
    timeoutMs,
  );
  await waitForIdentityStartAbsent(
    execution,
    `namespace/${namespace}`,
    undefined,
    timeoutMs,
  );
  observed.set('graph-backed-destroy', {
    test: 'Applik8s destroy removed the product graph and owned namespace',
    observedAt: new Date().toISOString(),
  });
  await restoreQualificationEnvironment();

  const completedAt = new Date().toISOString();
  if (!focusedBrowserTest) {
    await writeV06EvidenceReceipt(evidencePath, {
    suite: 'agentic-product-starter',
    run: { id: runId, startedAt, completedAt },
    candidate: { git, cluster, installation, artifacts },
    environment: {
      context,
      controlPlaneNamespace: 'default',
      installation: projectName,
      applicationNamespace: namespace,
      profile: developerProfile ? 'developer' : 'starter',
      deployment: 'ApplicationDeploymentGraph -> Alchemy -> TypeKro',
    },
    assertionEvidence: createV06AssertionEvidence(
      requiredAssertions.map((assertion) => {
        const evidence = observed.get(assertion);
        if (!evidence) {
          throw new Error(
            `Missing generated Agentic product evidence ${assertion}.`,
          );
        }
        return { assertion, ...evidence };
      }),
      runId,
    ),
    });
    console.log(
      `Generated Agentic product qualification passed; evidence recorded at ${evidencePath}.`,
    );
  } else {
    console.log(
      `Focused generated Agentic product qualification passed for ${JSON.stringify(focusedBrowserTest)}; the application graph was destroyed cleanly and no release evidence receipt was published.`,
    );
  }
} catch (error) {
  if (!focusedBrowserTest) await discardV06Evidence(evidencePath);
  await tunnel?.close();
  if (deployed && await Bun.file(deploymentGraphPath).exists()) {
    const applicationHostLogs = await captureGeneratedContainerLogs(
      'application-host',
      'application',
    );
    if (applicationHostLogs.stdout.trim() || applicationHostLogs.stderr.trim()) {
      console.error('\n[agentic-product-starter] application host diagnostics');
      process.stderr.write(applicationHostLogs.stdout);
      process.stderr.write(applicationHostLogs.stderr);
    }
    const documentPublicationLogs = await captureGeneratedContainerLogs(
      'reactive-worker',
      `${projectName}-publish-document-artifact-update`,
    );
    if (
      documentPublicationLogs.stdout.trim()
      || documentPublicationLogs.stderr.trim()
    ) {
      console.error('\n[agentic-product-starter] document publication diagnostics');
      process.stderr.write(documentPublicationLogs.stdout);
      process.stderr.write(documentPublicationLogs.stderr);
    }
    const lifecycleLogs = await captureGeneratedContainerLogs(
      'reactive-worker',
      `${projectName}-process-data-lifecycle-request-create`,
    );
    if (lifecycleLogs.stdout.trim() || lifecycleLogs.stderr.trim()) {
      console.error('\n[agentic-product-starter] lifecycle processor diagnostics');
      process.stderr.write(lifecycleLogs.stdout);
      process.stderr.write(lifecycleLogs.stderr);
    }
    const lifecycleDatabase = await captureLifecycleDatabaseDiagnostics();
    if (lifecycleDatabase.stdout.trim() || lifecycleDatabase.stderr.trim()) {
      console.error('\n[agentic-product-starter] lifecycle database diagnostics');
      process.stderr.write(lifecycleDatabase.stdout);
      process.stderr.write(lifecycleDatabase.stderr);
    }
    const evaluationLogs = await captureGeneratedContainerLogs(
      'reactive-worker',
      `${projectName}-evaluate-agent-revision-create`,
    );
    if (evaluationLogs.stdout.trim() || evaluationLogs.stderr.trim()) {
      console.error('\n[agentic-product-starter] agent evaluation processor diagnostics');
      process.stderr.write(evaluationLogs.stdout);
      process.stderr.write(evaluationLogs.stderr);
    }
    const usageDeliveryLogs = await captureGeneratedContainerLogs(
      'reactive-worker',
      `${projectName}-deliver-billable-usage-create`,
    );
    await preserveGeneratedDiagnostic('usage-delivery', usageDeliveryLogs);
    if (usageDeliveryLogs.stdout.trim() || usageDeliveryLogs.stderr.trim()) {
      console.error('\n[agentic-product-starter] usage delivery diagnostics');
      process.stderr.write(usageDeliveryLogs.stdout);
      process.stderr.write(usageDeliveryLogs.stderr);
    }
    const invitationDeliveryLogs = await captureGeneratedContainerLogs(
      'reactive-worker',
      `${projectName}-request-invitation-delivery-create`,
    );
    await preserveGeneratedDiagnostic(
      'invitation-delivery-request',
      invitationDeliveryLogs,
    );
    if (
      invitationDeliveryLogs.stdout.trim()
      || invitationDeliveryLogs.stderr.trim()
    ) {
      console.error('\n[agentic-product-starter] invitation delivery request diagnostics');
      process.stderr.write(invitationDeliveryLogs.stdout);
      process.stderr.write(invitationDeliveryLogs.stderr);
    }
    const notificationDeliveryLogs = await captureGeneratedContainerLogs(
      'reactive-worker',
      `${projectName}-deliver-requested-notification-create`,
    );
    await preserveGeneratedDiagnostic(
      'notification-delivery',
      notificationDeliveryLogs,
    );
    if (
      notificationDeliveryLogs.stdout.trim()
      || notificationDeliveryLogs.stderr.trim()
    ) {
      console.error('\n[agentic-product-starter] notification delivery diagnostics');
      process.stderr.write(notificationDeliveryLogs.stdout);
      process.stderr.write(notificationDeliveryLogs.stderr);
    }
    const notificationDatabase = await captureNotificationDatabaseDiagnostics();
    await preserveGeneratedDiagnostic(
      'notification-database',
      notificationDatabase,
    );
    if (
      notificationDatabase.stdout.trim()
      || notificationDatabase.stderr.trim()
    ) {
      console.error('\n[agentic-product-starter] notification database diagnostics');
      process.stderr.write(notificationDatabase.stdout);
      process.stderr.write(notificationDatabase.stderr);
    }
    const lakehousePublisherLogs = await captureGeneratedContainerLogs(
      'lakehouse-publisher',
      'publisher',
    );
    await preserveGeneratedDiagnostic('lakehouse-publisher', lakehousePublisherLogs);
    if (
      lakehousePublisherLogs.stdout.trim()
      || lakehousePublisherLogs.stderr.trim()
    ) {
      console.error('\n[agentic-product-starter] lakehouse publisher diagnostics');
      process.stderr.write(lakehousePublisherLogs.stdout);
      process.stderr.write(lakehousePublisherLogs.stderr);
    }
    const usagePublicationDatabase =
      await captureUsagePublicationDatabaseDiagnostics();
    await preserveGeneratedDiagnostic(
      'usage-publication-database',
      usagePublicationDatabase,
    );
    if (
      usagePublicationDatabase.stdout.trim()
      || usagePublicationDatabase.stderr.trim()
    ) {
      console.error('\n[agentic-product-starter] usage publication database diagnostics');
      process.stderr.write(usagePublicationDatabase.stdout);
      process.stderr.write(usagePublicationDatabase.stderr);
    }
    const queryGatewayLogs = await captureGeneratedContainerLogs(
      'query-gateway',
      `${projectName}-web`,
    );
    if (queryGatewayLogs.stdout.trim() || queryGatewayLogs.stderr.trim()) {
      console.error('\n[agentic-product-starter] query gateway diagnostics');
      process.stderr.write(queryGatewayLogs.stdout);
      process.stderr.write(queryGatewayLogs.stderr);
    }
    const billingHttpLogs = await captureGeneratedContainerLogs(
      'typed-http',
      'http',
    );
    if (billingHttpLogs.stdout.trim() || billingHttpLogs.stderr.trim()) {
      console.error('\n[agentic-product-starter] billing HTTP diagnostics');
      process.stderr.write(billingHttpLogs.stdout);
      process.stderr.write(billingHttpLogs.stderr);
    }
    const agentLogs = await captureGeneratedContainerLogs(
      'ai-agent',
      'agent',
    );
    await preserveGeneratedDiagnostic('ai-agent', agentLogs);
    if (agentLogs.stdout.trim() || agentLogs.stderr.trim()) {
      console.error('\n[agentic-product-starter] AI agent diagnostics');
      process.stderr.write(agentLogs.stdout);
      process.stderr.write(agentLogs.stderr);
    }
    const toolReceiverLogs = await captureGeneratedContainerLogs(
      'query-gateway',
      `${projectName}-workspace-assistant-tool-receiver`,
    );
    await preserveGeneratedDiagnostic('agent-tool-receiver', toolReceiverLogs);
    if (toolReceiverLogs.stdout.trim() || toolReceiverLogs.stderr.trim()) {
      console.error('\n[agentic-product-starter] agent tool receiver diagnostics');
      process.stderr.write(toolReceiverLogs.stdout);
      process.stderr.write(toolReceiverLogs.stderr);
    }
    const commandProcessorLogs = await captureGeneratedContainerLogs(
      'command-processor',
      'processor',
    );
    await preserveGeneratedDiagnostic('command-processor', commandProcessorLogs);
    if (commandProcessorLogs.stdout.trim() || commandProcessorLogs.stderr.trim()) {
      console.error('\n[agentic-product-starter] command processor diagnostics');
      process.stderr.write(commandProcessorLogs.stdout);
      process.stderr.write(commandProcessorLogs.stderr);
    }
    const workflowWorkerLogs = await captureGeneratedContainerLogs(
      'workflow-worker',
      'worker',
    );
    await preserveGeneratedDiagnostic('workflow-worker', workflowWorkerLogs);
    if (workflowWorkerLogs.stdout.trim() || workflowWorkerLogs.stderr.trim()) {
      console.error('\n[agentic-product-starter] workflow worker diagnostics');
      process.stderr.write(workflowWorkerLogs.stdout);
      process.stderr.write(workflowWorkerLogs.stderr);
    }
    const decisionCoordinatorLogs = await captureGeneratedContainerLogs(
      'reactive-worker',
      `${projectName}-begin-decision-review-create`,
    );
    await preserveGeneratedDiagnostic(
      'decision-review-coordinator',
      decisionCoordinatorLogs,
    );
    if (
      decisionCoordinatorLogs.stdout.trim()
      || decisionCoordinatorLogs.stderr.trim()
    ) {
      console.error(
        '\n[agentic-product-starter] decision review coordinator diagnostics',
      );
      process.stderr.write(decisionCoordinatorLogs.stdout);
      process.stderr.write(decisionCoordinatorLogs.stderr);
    }
    try {
      await runIdentityStartCommand(
        execution,
        'clean up a failed generated product qualification',
        cli,
        ['destroy', '--context', context],
        target,
      );
    } catch (cleanupError) {
      await restoreQualificationEnvironment();
      throw new AggregateError(
        [error, cleanupError],
        'Generated product qualification and cleanup both failed.',
      );
    }
  }
  await restoreQualificationEnvironment();
  if (preservedEnvironmentFiles.size > 0) {
    await mkdir(target, { recursive: true });
    for (const [name, preservedEnvironmentPath] of preservedEnvironmentFiles) {
      await rename(preservedEnvironmentPath, join(target, name));
    }
    preservedEnvironmentFiles.clear();
  }
  throw error;
}
