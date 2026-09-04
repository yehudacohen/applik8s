// typecast-file-boundary: the release runner validates generated manifests,
// Kubernetes objects, and Playwright reports before using their fields.
import { randomUUID } from 'node:crypto';
import { copyFile, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createApplicationAgenticStart } from '../packages/start-agentic/src/index.js';
import {
  materializePackedGeneratedWorkspaceDependencies,
  writeOfficialTanStackScaffold,
} from './generated-agentic-start-live-support';
import {
  captureIdentityStartCommand,
  captureIdentityStartContainerLogs,
  type IdentityStartServiceTunnel,
  identityStartResourceExists,
  identityStartServiceTunnel,
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
} from './v06-evidence';

const root = process.cwd();
const context = process.env.APPLIK8S_E2E_CONTEXT ?? 'orbstack';
const managedResearch =
  process.env.APPLIK8S_AGENTIC_START_LIVE_PROFILE === 'managed-research';
const browserTestName = process.env.APPLIK8S_AGENTIC_START_BROWSER_TEST?.trim();
const environmentFile = process.env.APPLIK8S_AGENTIC_START_ENV_FILE?.trim();
const projectName = managedResearch
  ? 'agentic-start-v09-research-evidence'
  : 'agentic-start-evidence';
const target = join(root, '.applik8s-tmp', projectName);
const namespace = `${projectName}-system`;
const searchNamespace = `${projectName}-web-search-system`;
const searchSecret = `${projectName}-web-search`;
const installationName = managedResearch
  ? `${projectName}-research-live`
  : projectName;
const installationResource = managedResearch
  ? 'agenticstartv09researchevidence'
  : 'agenticstartevidence';
const execution = {
  root,
  context,
  label: managedResearch
    ? 'agentic-start-managed-research'
    : 'agentic-start-starter',
} as const;
const cli = join(root, 'packages/cli/dist/bin.js');
const timeoutMs = 20 * 60_000;
const deploymentProfile = 'developer';
const evidencePath = join(
  root,
  managedResearch
    ? '.applik8s-tmp/evidence/v0.9/agentic-start-managed-research.json'
    : '.applik8s-tmp/evidence/v0.7/agentic-start-starter.json',
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
let searchFixture = false;
let tunnel: IdentityStartServiceTunnel | undefined;
const preservedEnvironmentFiles = new Map<string, string>();

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
      ['destroy', '--profile', deploymentProfile, '--context', context],
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
    const preservedEnvironmentPath = `${target}.${runId}.${name.slice(1)}.preserved`;
    await rename(generatedEnvironmentPath, preservedEnvironmentPath);
    preservedEnvironmentFiles.set(name, preservedEnvironmentPath);
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
  await materializePackedGeneratedWorkspaceDependencies({
    workspaceRoot: root,
    targetDirectory: target,
  });
  if (managedResearch) {
    // The live lane deliberately reuses the maintainer-provided operation-host
    // bindings without parsing, logging, or embedding their values. The CLI
    // admits only variables named by the installation's credential sources.
    if (preservedEnvironmentFiles.size > 0) {
      for (const [name, preservedEnvironmentPath] of preservedEnvironmentFiles) {
        await rename(preservedEnvironmentPath, join(target, name));
      }
      preservedEnvironmentFiles.clear();
      observed.set('environment-preservation', {
        test: 'existing generated-project environment files were mechanically preserved across regeneration without reading, logging, or overwriting them',
        observedAt: new Date().toISOString(),
      });
    } else if (environmentFile) {
      if (!await Bun.file(environmentFile).exists()) {
        throw new Error(`The requested mechanical environment source does not exist: ${environmentFile}`);
      }
      await copyFile(environmentFile, join(target, '.env.local'));
      observed.set('environment-copy', {
        test: 'the requested environment file was mechanically copied for qualification without inspecting or logging its values',
        observedAt: new Date().toISOString(),
      });
    } else {
      await copyFile(join(root, '.env'), join(target, '.env'));
    }
    await copyFile(
      join(target, 'kubernetes/application.research-live.yaml'),
      join(target, 'kubernetes/application.yaml'),
    );
    await resetManagedResearchFixture();
    searchFixture = true;
    observed.set('managed-search-prerequisite', {
      test: 'reference-only SearXNG Secret and external namespace fixture',
      observedAt: new Date().toISOString(),
    });
  }
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
    [
      'deploy',
      '--profile', deploymentProfile,
      '--context', context,
      '--skip-app-build',
    ],
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
    [
      'deploy',
      '--profile', deploymentProfile,
      '--context', context,
      '--skip-app-build',
    ],
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
  const preflight = await fetch(new URL('/workspaces', tunnel.url), {
    headers: { accept: 'text/html' },
  });
  if (!preflight.ok) {
    throw new Error(
      `Generated application preflight GET /workspaces failed with HTTP ${preflight.status}: ${(await preflight.text()).slice(0, 2_000)}`,
    );
  }
  const expectedBrowserTests = [
    'bootstraps a local owner and admits only server-validated workspace selection',
    'calls the bounded public assistant through its generated function-native facade',
    'renders provider-neutral billing and executes simulated checkout and portal calls',
    'persists, reloads, renames, and archives a generated research conversation',
    'researches public sources and publishes an evidence-linked artifact',
    'runs a workspace-scoped durable review from SSE signal to immutable artifact',
  ];
  if (browserTestName && !expectedBrowserTests.includes(browserTestName)) {
    throw new Error(
      `APPLIK8S_AGENTIC_START_BROWSER_TEST must name one canonical Agentic Start journey; received ${browserTestName}.`,
    );
  }
  await runIdentityStartCommand(
    execution,
    'execute the generated owner/workspace/conversation browser journeys',
    join(root, 'node_modules/.bin/playwright'),
    [
      'test',
      '--config',
      'playwright.agentic.config.ts',
      ...(browserTestName ? ['--grep', escapeRegularExpression(browserTestName)] : []),
    ],
    root,
    { APPLIK8S_AGENTIC_START_BASE_URL: tunnel.url },
  );
  const results = await passedIdentityStartBrowserTests(
    join(
      root,
      '.applik8s-tmp/evidence/v0.7/agentic-start-browser-results.json',
    ),
  );
  const expected = browserTestName ? [browserTestName] : expectedBrowserTests;
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
      resource: `${installationResource}/${installationName}`,
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
    ['destroy', '--profile', deploymentProfile, '--context', context],
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
  if (managedResearch) {
    await assertManagedResearchTeardown();
    await deleteManagedResearchFixture();
    searchFixture = false;
  }
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
    ...(managedResearch ? ['managed-search-prerequisite'] : []),
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
      profile: managedResearch ? 'developer-managed-research' : 'starter',
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
  const cleanupErrors: unknown[] = [];
  const deploymentGraphExists = await Bun.file(
    join(
      target,
      '.applik8s/deploy/typekro/application-deployment-graph.json',
    ),
  ).exists();
  if (deployed && deploymentGraphExists) {
    for (const diagnostic of [
      {
        label: 'application host',
        component: 'application-host',
        container: 'application',
      },
      {
        label: 'query gateway',
        component: 'query-gateway',
        container: `${projectName}-web`,
      },
      {
        label: 'command processor',
        component: 'command-processor',
        container: 'processor',
      },
      {
        label: 'research agent',
        component: 'ai-agent',
        container: 'agent',
      },
      {
        label: 'Celld actor runtime',
        component: 'actor-runtime',
        container: 'celld',
      },
    ]) {
      const logs = await captureIdentityStartContainerLogs(execution, {
        namespace,
        graph: projectName,
        component: diagnostic.component,
        container: diagnostic.container,
      });
      if (!logs.stdout.trim() && !logs.stderr.trim()) continue;
      console.error(`\n[${execution.label}] ${diagnostic.label} diagnostics`);
      process.stderr.write(logs.stdout);
      process.stderr.write(logs.stderr);
    }
    try {
      await runIdentityStartCommand(
        execution,
        'clean up a failed generated Agentic Start qualification',
        cli,
        ['destroy', '--profile', deploymentProfile, '--context', context],
        target,
      );
      deployed = false;
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
  }
  if (searchFixture) {
    try {
      await deleteManagedResearchFixture();
      searchFixture = false;
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
  }
  for (const [name, preservedEnvironmentPath] of preservedEnvironmentFiles) {
    if (await Bun.file(preservedEnvironmentPath).exists()) {
      await rename(preservedEnvironmentPath, join(target, name));
    }
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      [error, ...cleanupErrors],
      'Generated Agentic Start qualification failed and one or more cleanup operations also failed.',
    );
  }
  throw error;
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

async function resetManagedResearchFixture(): Promise<void> {
  await runIdentityStartCommand(
    execution,
    'remove a stale managed-research prerequisite namespace',
    'kubectl',
    [
      '--context',
      context,
      'delete',
      `namespace/${searchNamespace}`,
      '--ignore-not-found=true',
      '--wait=true',
      '--timeout=180s',
    ],
    root,
  );
  await runIdentityStartCommand(
    execution,
    'create the disposable managed-research prerequisite namespace',
    'kubectl',
    ['--context', context, 'create', 'namespace', searchNamespace],
    root,
  );
  await runIdentityStartCommand(
    execution,
    'create the reference-only managed SearXNG settings Secret',
    'kubectl',
    [
      '--context',
      context,
      '--namespace',
      searchNamespace,
      'create',
      'secret',
      'generic',
      searchSecret,
      `--from-literal=secret_key=${randomUUID()}`,
    ],
    root,
  );
}

async function assertManagedResearchTeardown(): Promise<void> {
  const remaining = await captureIdentityStartCommand(
    'kubectl',
    [
      '--context',
      context,
      '--namespace',
      searchNamespace,
      'get',
      'deployment,statefulset,service,networkpolicy,configmap',
      '--ignore-not-found=true',
      '--output=name',
      '--selector',
      `app.kubernetes.io/instance=${projectName}-web-search`,
    ],
    root,
  );
  if (remaining.code !== 0) {
    throw new Error(
      `Unable to verify managed SearXNG teardown: ${remaining.stderr || remaining.stdout}`,
    );
  }
  if (remaining.stdout.trim()) {
    throw new Error(
      `Managed SearXNG teardown retained graph-owned resources:\n${remaining.stdout.trim()}`,
    );
  }
}

async function deleteManagedResearchFixture(): Promise<void> {
  await runIdentityStartCommand(
    execution,
    'delete the disposable managed-research prerequisite namespace',
    'kubectl',
    [
      '--context',
      context,
      'delete',
      `namespace/${searchNamespace}`,
      '--ignore-not-found=true',
      '--wait=true',
      '--timeout=180s',
    ],
    root,
  );
}
