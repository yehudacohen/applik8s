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
} from 'node:fs/promises';
import { join } from 'node:path';
import { createApplicationAgenticStart } from '../packages/start-agentic/src/index.js';
import {
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

const root = process.cwd();
const context = process.env.APPLIK8S_E2E_CONTEXT ?? 'orbstack';
const projectName = 'agentic-product-evidence';
const target = join(root, '.applik8s-tmp', projectName);
const namespace = `${projectName}-system`;
const environmentFile = process.env.APPLIK8S_AGENTIC_PRODUCT_ENV_FILE;
const developerProfile = environmentFile !== undefined;
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
let preservedEnvironmentPath: string | undefined;

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
  const generatedEnvironmentPath = join(target, '.env');
  if (await Bun.file(generatedEnvironmentPath).exists()) {
    preservedEnvironmentPath = join(
      root,
      '.applik8s-tmp',
      `${projectName}.${runId}.env.preserved`,
    );
    await rename(generatedEnvironmentPath, preservedEnvironmentPath);
  }
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
  if (preservedEnvironmentPath) {
    await rename(preservedEnvironmentPath, join(target, '.env'));
    preservedEnvironmentPath = undefined;
    observed.set('environment-preservation', {
      test: 'an existing generated-project .env was mechanically preserved across regeneration without reading, logging, or overwriting it',
      observedAt: new Date().toISOString(),
    });
  } else if (environmentFile) {
    if (!await Bun.file(environmentFile).exists()) {
      throw new Error(`The requested mechanical environment source does not exist: ${environmentFile}`);
    }
    await copyFile(environmentFile, join(target, '.env'));
    observed.set('environment-copy', {
      test: 'the requested environment file was mechanically copied without inspecting or logging its values',
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
  observed.set('migration-generation', {
    test: 'Drizzle generated the Document schema from its model declaration',
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
    ['deploy', '--context', context, '--instance', instancePath, '--skip-app-build'],
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
    ['deploy', '--context', context, '--instance', instancePath, '--skip-app-build'],
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

  tunnel = await identityStartServiceTunnel(
    execution,
    `${projectName}-app`,
    namespace,
    3000,
  );
  await runIdentityStartCommand(
    execution,
    'execute the generated product browser journeys',
    join(root, 'node_modules/.bin/playwright'),
    ['test', '--config', 'playwright.agentic-product.config.ts'],
    root,
    { APPLIK8S_AGENTIC_PRODUCT_BASE_URL: tunnel.url },
  );
  const journeys = new Map([
    [
      'renders every first-run route without an unexpected server or hydration failure',
      'route-reliability',
    ],
    [
      'attributes an agent-created document to its human requester and reactively renders it',
      'causal-agent-note',
    ],
    [
      'uses the provider-neutral Starter billing path without Stripe credentials',
      'starter-billing',
    ],
    [
      'renders maintained provider-neutral account security without generated provider plumbing',
      'maintained-account',
    ],
    [
      'delivers and resolves a durable workspace decision across browser reload',
      'durable-decision',
    ],
    [
      'persists the product journey, explains AI trust, and enforces bounded data lifecycle controls',
      'product-lifecycle-trust',
    ],
    [
      'delivers an authenticated workspace invitation through the configured notification provider',
      'application-notification-delivery',
    ],
  ] as const);
  const results = await passedIdentityStartBrowserTests(
    join(
      root,
      '.applik8s-tmp/evidence/v0.7/agentic-product-browser-results.json',
    ),
  );
  if ([...journeys.keys()].some((journey) => !results.has(journey))) {
    throw new Error(
      `Generated Agentic product browser evidence is incomplete: ${[
        ...results.keys(),
      ].join(', ') || '<none>'}.`,
    );
  }
  for (const [journey, evidenceId] of journeys) {
    const browser = results.get(journey);
    if (!browser) {
      throw new Error(`Generated product browser evidence vanished for ${journey}.`);
    }
    observed.set(evidenceId, {
      test: journey,
      observedAt: browser.completedAt,
    });
  }
  const projectResults = await passedIdentityStartBrowserProjectTests(
    join(
      root,
      '.applik8s-tmp/evidence/v0.7/agentic-product-browser-results.json',
    ),
  );
  const qualityJourneys = [
    'keeps the representative product surface responsive and free of browser failures',
    'exposes a keyboard-usable, semantically named first-run experience',
    'preserves product meaning in dark mode and reduced motion',
    'preserves SSR content, bounded navigation, and live-query recovery on a degraded connection',
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
  if (missingQualityEvidence.length > 0) {
    throw new Error(
      `Generated Agentic product cross-browser evidence is incomplete: ${missingQualityEvidence.join(', ')}.`,
    );
  }
  const qualityCompletedAt = new Date(qualityCompletedAtMs).toISOString();
  observed.set('cross-browser-product-quality', {
    test: 'Chromium, Firefox, WebKit, and mobile product quality journeys',
    observedAt: qualityCompletedAt,
  });

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

  const required = [
    'doctor',
    'migration-generation',
    'production-build',
    'graph-backed-deploy',
    'graph-noop-redeploy',
    'causal-agent-note',
    'application-notification-delivery',
    'product-lifecycle-trust',
    'cross-browser-product-quality',
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
      profile: developerProfile ? 'developer' : 'starter',
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
    const lifecycleLogs = await captureIdentityStartCommand(
      'kubectl',
      [
        '--context',
        context,
        'logs',
        '--selector',
        `applik8s.dev/graph=${projectName},app.kubernetes.io/component=reactive-worker`,
        '--namespace',
        namespace,
        '--container',
        `${projectName}-process-data-lifecycle-request-create`,
        '--tail=200',
      ],
      root,
    );
    if (lifecycleLogs.stdout.trim() || lifecycleLogs.stderr.trim()) {
      console.error('\n[agentic-product-starter] lifecycle processor diagnostics');
      process.stderr.write(lifecycleLogs.stdout);
      process.stderr.write(lifecycleLogs.stderr);
    }
    const queryGatewayLogs = await captureIdentityStartCommand(
      'kubectl',
      [
        '--context',
        context,
        'logs',
        '--selector',
        `applik8s.dev/graph=${projectName},app.kubernetes.io/component=query-gateway`,
        '--namespace',
        namespace,
        '--container',
        `${projectName}-web`,
        '--tail=200',
      ],
      root,
    );
    if (queryGatewayLogs.stdout.trim() || queryGatewayLogs.stderr.trim()) {
      console.error('\n[agentic-product-starter] query gateway diagnostics');
      process.stderr.write(queryGatewayLogs.stdout);
      process.stderr.write(queryGatewayLogs.stderr);
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
      throw new AggregateError(
        [error, cleanupError],
        'Generated product qualification and cleanup both failed.',
      );
    }
  }
  if (preservedEnvironmentPath) {
    await mkdir(target, { recursive: true });
    await rename(preservedEnvironmentPath, join(target, '.env'));
    preservedEnvironmentPath = undefined;
  }
  throw error;
}
