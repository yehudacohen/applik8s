// typecast-file-boundary: Kubernetes, deployment-graph, and Playwright values
// become release evidence only after explicit structural checks.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type IdentityStartLiveContext,
  identityStartKubectlJson,
  identityStartResourceExists,
  identityStartServiceUrl,
  jsonObject,
  nestedArray,
  nestedString,
  passedIdentityStartBrowserTests,
  runIdentityStartCommand,
  waitForIdentityStartAbsent,
} from './identity-start-live-support';
import { createIdentityStartOrySession } from './identity-start-ory-session';
import {
  collectV06ArtifactIdentity,
  collectV06ClusterIdentity,
  collectV06GitIdentity,
  collectV06InstallationIdentity,
  createV06AssertionEvidence,
  discardV06Evidence,
  writeV06EvidenceReceipt,
} from './v06-evidence';

const root = process.cwd();
const context = process.env.APPLIK8S_E2E_CONTEXT ?? 'orbstack';
if (context !== 'orbstack') {
  throw new Error(
    `The External Identity gate is restricted to context "orbstack"; received ${JSON.stringify(context)}.`,
  );
}
const execution: IdentityStartLiveContext = {
  root,
  context,
  label: 'identity-start-external',
};
const applicationDir = join(root, 'examples/identity-start');
const providerFixtureDir = join(
  root,
  'packages/e2e/test/fixtures/v07-external-providers',
);
const cli = join(root, 'packages/cli/dist/bin.js');
const applicationNamespace = 'identity-start-system';
const controlPlaneNamespace = 'identity-start-control';
const installationName = 'identity-start-external';
const instancePath = 'kubernetes/application.external.orbstack.yaml';
const providerInstallationName = 'identity-external-providers';
const providerRoot =
  `identityexternalproviders/${providerInstallationName}`;
const providerDefinition =
  'resourcegraphdefinition/identity-external-providers';
const applicationRoot = `identitystart/${installationName}`;
const applicationDefinition = 'resourcegraphdefinition/identity-start';
const lifecycleTimeoutMs = 20 * 60_000;
const assemblyProfile = 'external';
const providerAssemblyProfile = 'external-providers';
const evidencePath = join(
  root,
  '.applik8s-tmp/evidence/v0.7/identity-start-external.json',
);
const browserResultsPath = join(
  root,
  '.applik8s-tmp/evidence/v0.7/identity-start-external-browser-results.json',
);
const deploymentGraphPath = join(
  applicationDir,
  '.applik8s/deploy/typekro/application-deployment-graph.json',
);
const browserJourney =
  'admits a typed request, delivers its durable signal, and requeries authoritative state without reload';
const runId = randomUUID();
const startedAt = new Date().toISOString();
const observed = new Map<
  string,
  { readonly test: string; readonly observedAt: string }
>();
let providerFixtureDeployed = false;
let inferenceFixtureDeployed = false;
let applicationDeployed = false;

const providerResources = [
  'cluster.postgresql.cnpg.io/identity-external-db',
  'clickhouseinstallation.clickhouse.altinity.com/identity-external-analytics',
  'helmrelease.helm.toolkit.fluxcd.io/identity-external-events',
  'stream.jetstream.nats.io/identity-external-events',
  'deployment.apps/identity-external-objects',
  'secret/identity-external-payments',
  'helmrelease.helm.toolkit.fluxcd.io/hatchet',
  'opensearchcluster.opensearch.org/identity-external-search',
  'helmrelease.helm.toolkit.fluxcd.io/identity-external-identity-kratos',
] as const;

await discardV06Evidence(evidencePath);

try {
  await removePriorApplication();
  await cleanupDedicatedFixture();
  await cleanupInferenceFixture();
  await removePriorProviderFixture();

  await runIdentityStartCommand(
    execution,
    'verify a fresh packed Agentic Start consumer',
    'node',
    ['scripts/package-consumer-smoke.mjs'],
    root,
    { NODE_OPTIONS: '--max-old-space-size=8192' },
  );
  record(
    'fresh-packed-application',
    'fresh packed Agentic Start generation, discovery, compilation, and browser/server build',
  );

  providerFixtureDeployed = true;
  await runIdentityStartCommand(
    execution,
    'deploy the independently owned External provider graph',
    cli,
    ['deploy', '--profile', providerAssemblyProfile, '--context', context, '--skip-app-build'],
    providerFixtureDir,
    { NODE_OPTIONS: '--max-old-space-size=8192' },
  );
  inferenceFixtureDeployed = true;
  await runIdentityStartCommand(
    execution,
    'prepare the External inference fixture through TypeKro',
    'bun',
    [
      'run',
      'scripts/identity-start-dedicated-fixture.ts',
      'prepare-external',
    ],
    root,
    { APPLIK8S_E2E_CONTEXT: context },
  );
  const providerIdentities = await readProviderIdentities();
  record(
    'external-provider-readiness',
    'the independently owned PostgreSQL, ClickHouse, NATS, object storage, Hatchet, OpenSearch, and Ory resources reached readiness',
  );

  applicationDeployed = true;
  await runIdentityStartCommand(
    execution,
    'deploy External Identity Start through Alchemy and TypeKro',
    cli,
    [
      'deploy',
      '--profile',
      assemblyProfile,
      '--context',
      context,
      '--instance',
      instancePath,
    ],
    applicationDir,
    { NODE_OPTIONS: '--max-old-space-size=8192' },
  );
  await assertProviderIdentities(providerIdentities);
  record(
    'externally-owned-provider-adoption',
    'the External application consumed provider coordinates without changing their Kubernetes identities',
  );
  await assertNoOwnedProviderBootstrap();
  record(
    'no-owned-provider-bootstrap',
    'the application deployment graph contains no managed provider installation nodes in the External profile',
  );

  const endpoint = await identityStartServiceUrl(
    execution,
    'identity-start-app',
    applicationNamespace,
    3000,
  );
  const [kratosPublicUrl, kratosAdminUrl] = await Promise.all([
    identityStartServiceUrl(
      execution,
      'identity-external-identity-kratos-public',
      applicationNamespace,
      80,
    ),
    identityStartServiceUrl(
      execution,
      'identity-external-identity-kratos-admin',
      applicationNamespace,
      80,
    ),
  ]);
  const session = await createIdentityStartOrySession({
    publicUrl: kratosPublicUrl,
    adminUrl: kratosAdminUrl,
    roles: ['reviewer', 'administrator', 'application-operator'],
  });
  await runIdentityStartCommand(
    execution,
    'execute maintained External Identity browser journeys',
    join(root, 'node_modules/.bin/playwright'),
    ['test', '--config', 'playwright.identity.config.ts'],
    root,
    {
      APPLIK8S_IDENTITY_START_BASE_URL: endpoint,
      APPLIK8S_IDENTITY_START_EXPECTED_PRINCIPAL: session.expectedPrincipal,
      APPLIK8S_IDENTITY_START_PROFILE: 'external',
      APPLIK8S_IDENTITY_START_SESSION_COOKIE: session.cookie,
    },
  );
  const passedTests = await passedIdentityStartBrowserTests(browserResultsPath);
  const human = passedTests.get(browserJourney);
  if (!human || passedTests.size !== 2) {
    throw new Error(
      'External browser evidence does not contain exactly the two maintained golden paths.',
    );
  }
  record('typed-operation', browserJourney, human.completedAt);
  record('authoritative-requery', browserJourney, human.completedAt);

  const [git, cluster, installation, artifacts] = await Promise.all([
    collectV06GitIdentity(root),
    collectV06ClusterIdentity(context),
    collectV06InstallationIdentity({
      context,
      resource: applicationRoot,
      namespace: controlPlaneNamespace,
    }),
    collectV06ArtifactIdentity(deploymentGraphPath),
  ]);

  await destroyApplication(
    'destroy External Identity Start through Alchemy and TypeKro',
  );
  applicationDeployed = false;
  await waitForIdentityStartAbsent(
    execution,
    applicationRoot,
    controlPlaneNamespace,
    lifecycleTimeoutMs,
  );
  await waitForIdentityStartAbsent(
    execution,
    applicationDefinition,
    undefined,
    lifecycleTimeoutMs,
  );
  await assertProviderIdentities(providerIdentities);
  record(
    'destroy-preserves-external-providers',
    'application destroy removed only application-owned resources and preserved every external provider identity',
  );

  const required = [
    'fresh-packed-application',
    'external-provider-readiness',
    'externally-owned-provider-adoption',
    'no-owned-provider-bootstrap',
    'typed-operation',
    'authoritative-requery',
    'destroy-preserves-external-providers',
    'provider-destroy-completes',
  ] as const;

  await cleanupInferenceFixture();
  inferenceFixtureDeployed = false;
  await destroyProviderFixture();
  providerFixtureDeployed = false;
  record(
    'provider-destroy-completes',
    'provider destroy removed the instance, RGD, owned Namespace, controller descendants, and retained PVCs before reporting success',
  );

  const completedAt = new Date().toISOString();
  await writeV06EvidenceReceipt(evidencePath, {
    suite: 'identity-start-external',
    run: { id: runId, startedAt, completedAt },
    candidate: { git, cluster, installation, artifacts },
    environment: {
      context,
      controlPlaneNamespace,
      installation: installationName,
      applicationNamespace,
      endpoint,
      profile: 'external',
      identityProvider: 'ory',
      providerFixture: providerInstallationName,
      deployment: 'ApplicationDeploymentGraph -> Alchemy -> TypeKro',
    },
    assertionEvidence: createV06AssertionEvidence(
      required.map((assertion) => {
        const evidence = observed.get(assertion);
        if (!evidence) {
          throw new Error(`Missing External evidence ${assertion}.`);
        }
        return { assertion, ...evidence };
      }),
      runId,
    ),
  });
  console.log(`Recorded exact-candidate External evidence at ${evidencePath}.`);
} catch (error) {
  await discardV06Evidence(evidencePath);
  const cleanupErrors: unknown[] = [error];
  if (applicationDeployed) {
    await destroyApplication(
      'clean up failed External Identity Start qualification',
    ).catch((cleanupError) => cleanupErrors.push(cleanupError));
  }
  if (inferenceFixtureDeployed) {
    await cleanupInferenceFixture()
      .catch((cleanupError) => cleanupErrors.push(cleanupError));
  }
  if (providerFixtureDeployed) {
    await destroyProviderFixture()
      .catch((cleanupError) => cleanupErrors.push(cleanupError));
  }
  if (cleanupErrors.length > 1) {
    throw new AggregateError(
      cleanupErrors,
      'External Identity qualification and graph-backed cleanup both failed.',
    );
  }
  throw error;
}

function record(
  assertion: string,
  test: string,
  observedAt = new Date().toISOString(),
): void {
  observed.set(assertion, { test, observedAt });
}

async function removePriorApplication(): Promise<void> {
  if (
    await identityStartResourceExists(
      execution,
      applicationDefinition,
    )
  ) {
    await destroyApplication('remove the prior External Identity Start graph');
  }
  await waitForIdentityStartAbsent(
    execution,
    applicationRoot,
    controlPlaneNamespace,
    lifecycleTimeoutMs,
  );
  await waitForIdentityStartAbsent(
    execution,
    applicationDefinition,
    undefined,
    lifecycleTimeoutMs,
  );
}

async function removePriorProviderFixture(): Promise<void> {
  if (
    await identityStartResourceExists(
      execution,
      providerDefinition,
    )
  ) {
    await destroyProviderFixture();
  }
  await waitForIdentityStartAbsent(
    execution,
    providerRoot,
    controlPlaneNamespace,
    lifecycleTimeoutMs,
  );
  await waitForIdentityStartAbsent(
    execution,
    providerDefinition,
    undefined,
    lifecycleTimeoutMs,
  );
  await waitForIdentityStartAbsent(
    execution,
    `namespace/${applicationNamespace}`,
    undefined,
    lifecycleTimeoutMs,
  );
}

async function destroyApplication(label: string): Promise<void> {
  await runIdentityStartCommand(
    execution,
    label,
    cli,
    [
      'destroy',
      '--profile',
      assemblyProfile,
      '--context',
      context,
      '--instance-name',
      installationName,
      '--control-plane-namespace',
      controlPlaneNamespace,
    ],
    applicationDir,
    { NODE_OPTIONS: '--max-old-space-size=8192' },
  );
}

async function destroyProviderFixture(): Promise<void> {
  await runIdentityStartCommand(
    execution,
    'destroy the independently owned External provider graph',
    cli,
    [
      'destroy',
      '--profile',
      providerAssemblyProfile,
      '--context',
      context,
      '--instance-name',
      providerInstallationName,
      '--control-plane-namespace',
      controlPlaneNamespace,
    ],
    providerFixtureDir,
    { NODE_OPTIONS: '--max-old-space-size=8192' },
  );
  await waitForIdentityStartAbsent(
    execution,
    providerRoot,
    controlPlaneNamespace,
    lifecycleTimeoutMs,
  );
  await waitForIdentityStartAbsent(
    execution,
    providerDefinition,
    undefined,
    lifecycleTimeoutMs,
  );
}

async function cleanupInferenceFixture(): Promise<void> {
  await runIdentityStartCommand(
    execution,
    'clean the External inference fixture through TypeKro',
    'bun',
    [
      'run',
      'scripts/identity-start-dedicated-fixture.ts',
      'cleanup-external',
    ],
    root,
    { APPLIK8S_E2E_CONTEXT: context },
  );
}

async function cleanupDedicatedFixture(): Promise<void> {
  await runIdentityStartCommand(
    execution,
    'clean the retained Dedicated fixture through TypeKro',
    'bun',
    [
      'run',
      'scripts/identity-start-dedicated-fixture.ts',
      'cleanup',
    ],
    root,
    { APPLIK8S_E2E_CONTEXT: context },
  );
}

async function readProviderIdentities(): Promise<ReadonlyMap<string, string>> {
  const identities = new Map<string, string>();
  for (const resource of providerResources) {
    const object = await identityStartKubectlJson(execution, [
      'get',
      resource,
      '--namespace',
      applicationNamespace,
      '--output=json',
    ]);
    const uid = nestedString(object, ['metadata', 'uid']);
    if (!uid) {
      throw new Error(`External provider ${resource} has no Kubernetes UID.`);
    }
    identities.set(resource, uid);
  }
  return identities;
}

async function assertProviderIdentities(
  expected: ReadonlyMap<string, string>,
): Promise<void> {
  const observedIdentities = await readProviderIdentities();
  for (const [resource, uid] of expected) {
    if (observedIdentities.get(resource) !== uid) {
      throw new Error(
        `External provider ${resource} changed identity while consumed by the application.`,
      );
    }
  }
}

async function assertNoOwnedProviderBootstrap(): Promise<void> {
  const graph = jsonObject(
    JSON.parse(await readFile(deploymentGraphPath, 'utf8')),
    'External application deployment graph',
  );
  const ownedProviderNodes = nestedArray(graph, ['nodes'])
    .filter((node) => {
      const id = nestedString(node, ['id']) ?? '';
      const sourceId = nestedString(node, ['source', 'semanticNodeId']) ?? '';
      return id.startsWith('direct.provider.')
        || (
          sourceId.startsWith('provider.')
          && nestedString(node, ['kind']) === 'kubernetesDirect'
        );
    });
  if (ownedProviderNodes.length > 0) {
    throw new Error(
      `External profile unexpectedly owns provider bootstrap nodes: ${
        ownedProviderNodes.map((node) => nestedString(node, ['id'])).join(', ')
      }.`,
    );
  }
}
