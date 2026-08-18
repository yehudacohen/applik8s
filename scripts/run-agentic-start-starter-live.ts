// typecast-file-boundary: the release runner validates generated manifests,
// Kubernetes objects, and Playwright reports before using their fields.
import { randomUUID } from 'node:crypto';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createApplicationAgenticStart } from '../packages/start-agentic/src/index.js';
import {
  identityStartResourceExists,
  identityStartServiceTunnel,
  passedIdentityStartBrowserTests,
  runIdentityStartCommand,
  waitForIdentityStartAbsent,
  type IdentityStartServiceTunnel,
} from './identity-start-live-support.js';
import {
  collectV06ArtifactIdentity,
  collectV06ClusterIdentity,
  collectV06GitIdentity,
  collectV06InstallationIdentity,
  createV06AssertionEvidence,
  discardV06Evidence,
  writeV06EvidenceReceipt,
} from './v06-evidence';
import {
  writeOfficialTanStackScaffold,
} from './generated-agentic-start-live-support';

const root = process.cwd();
const context = process.env.APPLIK8S_E2E_CONTEXT ?? 'orbstack';
const projectName = 'agentic-start-evidence';
const target = join(root, '.applik8s-tmp', projectName);
const namespace = `${projectName}-system`;
const execution = {
  root,
  context,
  label: 'agentic-start-starter',
} as const;
const cli = join(root, 'packages/cli/dist/bin.js');
const timeoutMs = 20 * 60_000;
const evidencePath = join(
  root,
  '.applik8s-tmp/evidence/v0.7/agentic-start-starter.json',
);
const deploymentGraphPath = join(
  target,
  '.applik8s/deploy/typekro/application-deployment-graph.json',
);
const runId = randomUUID();
const startedAt = new Date().toISOString();
const observed = new Map<
  string,
  { readonly test: string; readonly observedAt: string }
>();
let deployed = false;
let tunnel: IdentityStartServiceTunnel | undefined;

await discardV06Evidence(evidencePath);

try {
  await runIdentityStartCommand(
    execution,
    'build publishable Applik8s packages and the CLI',
    'node',
    ['scripts/build-publishable-packages.mjs'],
    root,
    { NODE_OPTIONS: '--max-old-space-size=8192' },
  );
  if (
    await identityStartResourceExists(
      execution,
      `resourcegraphdefinition/${projectName}`,
    )
    || await identityStartResourceExists(
      execution,
      `namespace/${namespace}`,
    )
  ) {
    if (!await Bun.file(deploymentGraphPath).exists()) {
      throw new Error(
        'A prior generated Agentic Start is still deployed, but its local Alchemy/TypeKro lifecycle state is absent. Restore the matching generated project and run `applik8s destroy`; refusing to guess ownership from cluster resources.',
      );
    }
    await runIdentityStartCommand(
      execution,
      'destroy a prior or interrupted generated Agentic Start graph',
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

  await rm(target, { recursive: true, force: true });
  await createApplicationAgenticStart({
    targetDirectory: target,
    projectName,
    applik8sVersion: 'workspace:*',
    example: 'research',
    install: false,
    async run(command) {
      if (
        command.executable !== 'bunx'
        || command.arguments[0] !== '@tanstack/cli@0.70.1'
      ) {
        throw new Error(
          `Generated live Start invoked an unexpected scaffold command: ${command.executable} ${command.arguments.join(' ')}`,
        );
      }
      await writeOfficialTanStackScaffold(target, projectName);
    },
  });
  await runIdentityStartCommand(
    execution,
    'generate relational migrations from the generated model declarations',
    join(root, 'node_modules/.bin/drizzle-kit'),
    ['generate', '--config', 'drizzle.config.ts'],
    target,
  );
  const migrations = (await readdir(join(target, 'drizzle'))).filter(
    (file) => file.endsWith('.sql'),
  );
  if (migrations.length === 0) {
    throw new Error(
      'Drizzle reported success without generating a relational migration.',
    );
  }
  observed.set('migration-generation', {
    test: 'Drizzle generated the authoritative schema from application models',
    observedAt: new Date().toISOString(),
  });
  await runIdentityStartCommand(
    execution,
    'generate the official TanStack file-route tree',
    join(root, 'node_modules/.bin/tsr'),
    ['generate'],
    target,
  );
  await runIdentityStartCommand(
    execution,
    'typecheck the generated TanStack Start application',
    join(root, 'node_modules/.bin/tsc'),
    ['--project', 'tsconfig.json', '--noEmit'],
    target,
  );
  await runIdentityStartCommand(
    execution,
    'build the generated TanStack Start application',
    'bun',
    ['run', 'build'],
    target,
    { NODE_OPTIONS: '--max-old-space-size=8192' },
  );
  observed.set('production-build', {
    test: 'official TanStack Start client, SSR, and Nitro production build',
    observedAt: new Date().toISOString(),
  });
  deployed = true;
  await runIdentityStartCommand(
    execution,
    'deploy the generated Start through Alchemy and TypeKro',
    cli,
    ['deploy', '--context', context, '--skip-app-build'],
    target,
    { NODE_OPTIONS: '--max-old-space-size=8192' },
  );
  observed.set('graph-backed-deploy', {
    test: 'Alchemy and TypeKro deployed the generated application graph',
    observedAt: new Date().toISOString(),
  });
  await runIdentityStartCommand(
    execution,
    'reapply the exact generated Start to prove migration and graph idempotency',
    cli,
    ['deploy', '--context', context, '--skip-app-build'],
    target,
    { NODE_OPTIONS: '--max-old-space-size=8192' },
  );
  observed.set('graph-noop-redeploy', {
    test:
      'the exact generated graph and migration workload reapplied without a schema conflict',
    observedAt: new Date().toISOString(),
  });

  tunnel = await identityStartServiceTunnel(
    execution,
    `${projectName}-app`,
    namespace,
    3000,
  );
  await runIdentityStartCommand(
    execution,
    'execute the generated owner/workspace/conversation browser journeys',
    join(root, 'node_modules/.bin/playwright'),
    ['test', '--config', 'playwright.agentic.config.ts'],
    root,
    { APPLIK8S_AGENTIC_START_BASE_URL: tunnel.url },
  );
  const results = await passedIdentityStartBrowserTests(
    join(
      root,
      '.applik8s-tmp/evidence/v0.7/agentic-start-browser-results.json',
    ),
  );
  const expected = [
    'bootstraps a local owner and admits only server-validated workspace selection',
    'calls the bounded public assistant through its generated function-native facade',
    'renders provider-neutral billing and executes simulated checkout and portal calls',
    'persists, reloads, renames, and archives a generated research conversation',
  'runs a workspace-scoped durable review from SSE signal to immutable artifact',
  ];
  if (
    results.size !== expected.length
    || expected.some((name) => !results.has(name))
  ) {
    throw new Error(
      `Generated Agentic Start browser evidence is incomplete: ${[
        ...results.keys(),
      ].join(', ') || '<none>'}.`,
    );
  }
  for (const [name, result] of results) {
    observed.set(`browser:${name}`, {
      test: name,
      observedAt: result.completedAt,
    });
  }
  const [git, cluster, installation, artifacts] = await Promise.all([
    collectV06GitIdentity(root),
    collectV06ClusterIdentity(context),
    collectV06InstallationIdentity({
      context,
      resource: `agenticstartevidence/${projectName}`,
      namespace: 'default',
    }),
    collectV06ArtifactIdentity(deploymentGraphPath),
  ]);
  await tunnel.close();
  tunnel = undefined;

  await runIdentityStartCommand(
    execution,
    'destroy the generated Start through Alchemy and TypeKro',
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
    test:
      'Applik8s destroy removed the root instance, RGD, and owned application namespace',
    observedAt: new Date().toISOString(),
  });
  const required = [
    'migration-generation',
    'production-build',
    'graph-backed-deploy',
    'graph-noop-redeploy',
    ...expected.map((name) => `browser:${name}`),
    'graph-backed-destroy',
  ];
  const completedAt = new Date().toISOString();
  await writeV06EvidenceReceipt(evidencePath, {
    suite: 'agentic-start-starter',
    run: { id: runId, startedAt, completedAt },
    candidate: { git, cluster, installation, artifacts },
    environment: {
      context,
      controlPlaneNamespace: 'default',
      installation: projectName,
      applicationNamespace: namespace,
      profile: 'starter',
      deployment: 'ApplicationDeploymentGraph -> Alchemy -> TypeKro',
    },
    assertionEvidence: createV06AssertionEvidence(
      required.map((assertion) => {
        const evidence = observed.get(assertion);
        if (!evidence) {
          throw new Error(`Missing generated Agentic Start evidence ${assertion}.`);
        }
        return { assertion, ...evidence };
      }),
      runId,
    ),
  });
  console.log(
    `Generated Agentic Start Starter qualification passed with graph-backed cleanup; evidence recorded at ${evidencePath}.`,
  );
} catch (error) {
  await discardV06Evidence(evidencePath);
  await tunnel?.close();
  const deploymentGraphExists = await Bun.file(
    join(
      target,
      '.applik8s/deploy/typekro/application-deployment-graph.json',
    ),
  ).exists();
  if (deployed && deploymentGraphExists) {
    try {
      await runIdentityStartCommand(
        execution,
        'clean up a failed generated Agentic Start qualification',
        cli,
        ['destroy', '--context', context],
        target,
      );
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Generated Agentic Start qualification and graph-backed cleanup both failed.',
      );
    }
  }
  throw error;
}
