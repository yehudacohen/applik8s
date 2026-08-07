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
} from './v06-evidence.js';
import {
  writeOfficialTanStackScaffold,
} from './generated-agentic-start-live-support.js';

const root = process.cwd();
const context = process.env.APPLIK8S_E2E_CONTEXT ?? 'orbstack';
const projectName = 'agentic-product-evidence';
const target = join(root, '.applik8s-tmp', projectName);
const namespace = `${projectName}-system`;
const execution = {
  root,
  context,
  label: 'agentic-product-starter',
} as const;
const cli = join(root, 'packages/cli/dist/bin.js');
const timeoutMs = 20 * 60_000;
const evidencePath = join(
  root,
  '.applik8s-tmp/evidence/v0.7/agentic-product-starter.json',
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
await rm(target, { recursive: true, force: true });
await createApplicationAgenticStart({
  targetDirectory: target,
  projectName,
  applik8sVersion: 'workspace:*',
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

try {
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
    await runIdentityStartCommand(
      execution,
      'destroy a prior or interrupted generated product graph',
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

  await runIdentityStartCommand(
    execution,
    'build publishable Applik8s packages and the CLI',
    'node',
    ['scripts/build-publishable-packages.mjs'],
    root,
    { NODE_OPTIONS: '--max-old-space-size=8192' },
  );
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
  observed.set('migration-generation', {
    test: 'Drizzle generated the Notes schema from its model declaration',
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
    'typecheck the generated product',
    join(root, 'node_modules/.bin/tsc'),
    ['--project', 'tsconfig.json', '--noEmit'],
    target,
  );
  await runIdentityStartCommand(
    execution,
    'build the generated product',
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
    'deploy the generated product through Alchemy and TypeKro',
    cli,
    ['deploy', '--context', context, '--skip-app-build'],
    target,
    { NODE_OPTIONS: '--max-old-space-size=8192' },
  );
  observed.set('graph-backed-deploy', {
    test: 'Alchemy and TypeKro deployed the generated product graph',
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
    'execute the causal agent-owned Notes browser journey',
    join(root, 'node_modules/.bin/playwright'),
    ['test', '--config', 'playwright.agentic-product.config.ts'],
    root,
    { APPLIK8S_AGENTIC_PRODUCT_BASE_URL: tunnel.url },
  );
  const journey =
    'attributes an agent-created note to its human requester and reactively renders it';
  const results = await passedIdentityStartBrowserTests(
    join(
      root,
      '.applik8s-tmp/evidence/v0.7/agentic-product-browser-results.json',
    ),
  );
  if (results.size !== 1 || !results.has(journey)) {
    throw new Error(
      `Generated Agentic product browser evidence is incomplete: ${[
        ...results.keys(),
      ].join(', ') || '<none>'}.`,
    );
  }
  const browser = results.get(journey);
  if (!browser) throw new Error('Generated product browser evidence vanished.');
  observed.set('causal-agent-note', {
    test: journey,
    observedAt: browser.completedAt,
  });

  const [git, cluster, installation, artifacts] = await Promise.all([
    collectV06GitIdentity(root),
    collectV06ClusterIdentity(context),
    collectV06InstallationIdentity({
      context,
      resource: `agenticproductevidence/${projectName}`,
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

  const required = [
    'migration-generation',
    'production-build',
    'graph-backed-deploy',
    'causal-agent-note',
    'graph-backed-destroy',
  ];
  const completedAt = new Date().toISOString();
  await writeV06EvidenceReceipt(evidencePath, {
    suite: 'agentic-product-starter',
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
} catch (error) {
  await discardV06Evidence(evidencePath);
  await tunnel?.close();
  if (deployed && await Bun.file(deploymentGraphPath).exists()) {
    try {
      await runIdentityStartCommand(
        execution,
        'clean up a failed generated product qualification',
        cli,
        ['destroy', '--context', context],
        target,
      );
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Generated product qualification and cleanup both failed.',
      );
    }
  }
  throw error;
}
