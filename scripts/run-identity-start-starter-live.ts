// typecast-file-boundary: Playwright and Kubernetes JSON become typed release
// evidence only after explicit structural checks in this candidate gate.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
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
const applicationDir = join(root, 'examples/identity-start');
const cli = join(root, 'packages/cli/dist/bin.js');
const controlPlaneNamespace = 'identity-start-control';
const installationName = 'identity-start';
const applicationNamespace = 'identity-start-system';
const browserResultsPath = join(
  root,
  '.applik8s-tmp/evidence/v0.7/identity-start-starter-browser-results.json',
);
const browserReceiptPath = join(
  root,
  '.applik8s-tmp/evidence/v0.7/identity-start-starter-browser.json',
);
const evidencePath = join(
  root,
  '.applik8s-tmp/evidence/v0.7/identity-start-starter.json',
);
const deploymentGraphPath = join(
  applicationDir,
  '.applik8s/deploy/typekro/application-deployment-graph.json',
);
const browserJourney =
  'admits a typed request, delivers its durable signal, and requeries authoritative state without reload';
const agentJourney =
  'executes the exported agent through its declared typed model operation';
const runId = randomUUID();
const startedAt = new Date().toISOString();
const observed = new Map<
  string,
  { readonly test: string; readonly observedAt: string }
>();
let deployed = false;
const lifecycleTimeoutMs = 20 * 60_000;
const assemblyProfile = 'starter';

await discardV06Evidence(evidencePath);
await discardV06Evidence(browserReceiptPath);

try {
  if (
    await kubernetesResourceExists(
      'identitystart/identity-start',
      controlPlaneNamespace,
    )
    || await kubernetesResourceExists(
      'resourcegraphdefinition/identity-start',
    )
    || await kubernetesResourceExists(
      `namespace/${applicationNamespace}`,
    )
  ) {
    await run(
      'remove the prior or interrupted Identity Start graph',
      cli,
      ['destroy', '--profile', assemblyProfile, '--context', context],
      applicationDir,
    );
  }
  await waitForAbsent(
    'identitystart/identity-start',
    controlPlaneNamespace,
    lifecycleTimeoutMs,
  );
  await waitForAbsent(
    'resourcegraphdefinition/identity-start',
    undefined,
    lifecycleTimeoutMs,
  );
  await waitForAbsent(
    `namespace/${applicationNamespace}`,
    undefined,
    lifecycleTimeoutMs,
  );

  await run(
    'verify a fresh packed Agentic Start consumer',
    'node',
    ['scripts/package-consumer-smoke.mjs'],
    root,
    { NODE_OPTIONS: '--max-old-space-size=8192' },
  );
  observed.set('fresh-packed-application', {
    test:
      'fresh packed Agentic Start generation, discovery, compilation, and browser/server build',
    observedAt: new Date().toISOString(),
  });

  deployed = true;
  await run(
    'deploy Identity Start through Alchemy and TypeKro',
    cli,
    ['deploy', '--profile', assemblyProfile, '--context', context],
    applicationDir,
    { NODE_OPTIONS: '--max-old-space-size=8192' },
  );

  const endpoint = await starterEndpoint();
  await assertCredentialFreeStarter();
  observed.set('credential-free-start', {
    test:
      'Starter selected deterministic inference and deployed without AI provider credentials',
    observedAt: new Date().toISOString(),
  });

  await run(
    'execute maintained Identity Start browser journeys',
    join(root, 'node_modules/.bin/playwright'),
    ['test', '--config', 'playwright.identity.config.ts'],
    root,
    { APPLIK8S_IDENTITY_START_BASE_URL: endpoint },
  );
  const passedTests = await passedBrowserTests(browserResultsPath);
  const human = passedTests.get(browserJourney);
  const agent = passedTests.get(agentJourney);
  if (!human || !agent || passedTests.size !== 2) {
    throw new Error(
      'Identity Start browser evidence does not contain exactly the two maintained golden paths.',
    );
  }
  for (const assertion of [
    'human-session-admission',
    'typed-operation',
    'signal-issuance-sse-delivery',
    'signal-resolution',
    'authoritative-requery',
  ]) {
    observed.set(assertion, {
      test: browserJourney,
      observedAt: human.completedAt,
    });
  }
  observed.set('agent-operation', {
    test: agentJourney,
    observedAt: agent.completedAt,
  });

  const [git, cluster, installation, artifacts] = await Promise.all([
    collectV06GitIdentity(root),
    collectV06ClusterIdentity(context),
    collectV06InstallationIdentity({
      context,
      resource: `identitystart/${installationName}`,
      namespace: controlPlaneNamespace,
    }),
    collectV06ArtifactIdentity(deploymentGraphPath),
  ]);

  await run(
    'destroy Identity Start through Alchemy and TypeKro',
    cli,
    ['destroy', '--profile', assemblyProfile, '--context', context],
    applicationDir,
  );
  deployed = false;
  await waitForAbsent(
    `identitystart/${installationName}`,
    controlPlaneNamespace,
    lifecycleTimeoutMs,
  );
  await waitForAbsent(
    'resourcegraphdefinition/identity-start',
    undefined,
    lifecycleTimeoutMs,
  );
  await waitForAbsent(
    `namespace/${applicationNamespace}`,
    undefined,
    lifecycleTimeoutMs,
  );
  observed.set('graph-backed-destroy', {
    test:
      'applik8s destroy removed the root instance, RGD, and owned application namespace',
    observedAt: new Date().toISOString(),
  });

  const completedAt = new Date().toISOString();
  const required = [
    'fresh-packed-application',
    'credential-free-start',
    'human-session-admission',
    'typed-operation',
    'agent-operation',
    'signal-issuance-sse-delivery',
    'signal-resolution',
    'authoritative-requery',
    'graph-backed-destroy',
  ] as const;
  await writeV06EvidenceReceipt(evidencePath, {
    suite: 'identity-start-starter',
    run: { id: runId, startedAt, completedAt },
    candidate: { git, cluster, installation, artifacts },
    environment: {
      context,
      controlPlaneNamespace,
      installation: installationName,
      applicationNamespace,
      endpoint,
      profile: 'starter',
      deployment: 'ApplicationDeploymentGraph -> Alchemy -> TypeKro',
    },
    assertionEvidence: createV06AssertionEvidence(
      required.map((assertion) => {
        const evidence = observed.get(assertion);
        if (!evidence) throw new Error(`Missing Starter evidence ${assertion}.`);
        return { assertion, ...evidence };
      }),
      runId,
    ),
  });
  console.log(`Recorded exact-candidate Starter evidence at ${evidencePath}.`);
} catch (error) {
  await discardV06Evidence(evidencePath);
  if (deployed) {
    try {
      await run(
        'clean up failed Identity Start qualification',
        cli,
        ['destroy', '--profile', assemblyProfile, '--context', context],
        applicationDir,
      );
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Identity Start qualification and graph-backed cleanup both failed.',
      );
    }
  }
  throw error;
}

async function assertCredentialFreeStarter(): Promise<void> {
  const installation = await kubectlJson([
    'get',
    `identitystart/${installationName}`,
    '--namespace',
    controlPlaneNamespace,
    '--output=json',
  ]);
  const profile = nestedString(installation, ['spec', 'profile']);
  if (profile !== 'starter') {
    throw new Error(
      `Identity Start qualification expected profile starter; received ${JSON.stringify(profile)}.`,
    );
  }
  const agent = await kubectlJson([
    'get',
    'deployment/access-advisor',
    '--namespace',
    applicationNamespace,
    '--output=json',
  ]);
  const containers = nestedArray(
    agent,
    ['spec', 'template', 'spec', 'containers'],
  );
  const environmentNames = containers.flatMap((container) =>
    nestedArray(container, ['env'])
      .map((entry) => nestedString(entry, ['name']))
      .filter((name): name is string => Boolean(name))
  );
  const forbidden = environmentNames.filter((name) =>
    /(?:OPENAI|ANTHROPIC|AI_GATEWAY_API_KEY|MODEL_API_KEY)/u.test(name)
  );
  if (forbidden.length > 0) {
    throw new Error(
      `Credential-free Starter unexpectedly injects AI credentials: ${forbidden.join(', ')}.`,
    );
  }
  const graph = jsonObject(
    JSON.parse(
      await readFile(
        join(applicationDir, '.applik8s/deploy/typekro/application-graph.json'),
        'utf8',
      ),
    ),
    'Identity Start graph',
  );
  const nodes = nestedArray(graph, ['nodes']);
  const provider = nodes.find((node) =>
    nestedString(node, ['kind']) === 'provider'
    && nestedString(node, ['interface']) === 'AI'
  );
  const starterKind = provider
    ? nestedString(provider, ['config', 'ai', 'cases', 'starter', 'kind'])
    : undefined;
  if (starterKind !== 'ai-deterministic') {
    throw new Error(
      'Credential-free Starter must select the deterministic inference provider.',
    );
  }
}

async function starterEndpoint(): Promise<string> {
  const service = await kubectlJson([
    'get',
    'service/identity-start-app',
    '--namespace',
    applicationNamespace,
    '--output=json',
  ]);
  const clusterIp = nestedString(service, ['spec', 'clusterIP']);
  if (!clusterIp || clusterIp === 'None') {
    throw new Error('Identity Start application Service has no routable ClusterIP.');
  }
  return `http://${clusterIp}:3000`;
}

async function passedBrowserTests(
  path: string,
): Promise<Map<string, { readonly completedAt: string }>> {
  const report = jsonObject(
    JSON.parse(await readFile(path, 'utf8')),
    'Playwright report',
  );
  const output = new Map<string, { readonly completedAt: string }>();
  collectPassedBrowserTests(nestedArray(report, ['suites']), output);
  return output;
}

function collectPassedBrowserTests(
  suites: readonly Record<string, unknown>[],
  output: Map<string, { readonly completedAt: string }>,
): void {
  for (const suite of suites) {
    for (const spec of nestedArray(suite, ['specs'])) {
      const title = nestedString(spec, ['title']);
      const tests = nestedArray(spec, ['tests']);
      const results = tests.flatMap((test) => nestedArray(test, ['results']));
      if (
        !title
        || spec.ok !== true
        || results.length === 0
        || results.some((result) => nestedString(result, ['status']) !== 'passed')
      ) {
        continue;
      }
      const completed = results.map((result) => {
        const started = Date.parse(nestedString(result, ['startTime']) ?? '');
        const duration = Number(result.duration);
        if (!Number.isFinite(started) || !Number.isFinite(duration)) {
          throw new Error(`Playwright result ${title} has invalid timing.`);
        }
        return started + duration;
      });
      output.set(title, {
        completedAt: new Date(Math.max(...completed)).toISOString(),
      });
    }
    collectPassedBrowserTests(nestedArray(suite, ['suites']), output);
  }
}

async function waitForAbsent(
  resource: string,
  namespace: string | undefined,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let nextProgressAt = 0;
  while (Date.now() <= deadline) {
    if (!await kubernetesResourceExists(resource, namespace)) return;
    if (Date.now() >= nextProgressAt) {
      console.log(
        `[identity-start-starter] waiting for ${resource}${
          namespace ? ` in ${namespace}` : ''
        } to become absent`,
      );
      nextProgressAt = Date.now() + 10_000;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(
    `${resource}${namespace ? ` in ${namespace}` : ''} did not become absent within ${timeoutMs}ms.`,
  );
}

async function kubernetesResourceExists(
  resource: string,
  namespace?: string,
): Promise<boolean> {
  const result = await runCapture(
    'kubectl',
    [
      '--context',
      context,
      'get',
      resource,
      ...(namespace ? ['--namespace', namespace] : []),
      '--output=name',
    ],
    root,
  );
  if (result.code === 0) return true;
  if (/not found|NotFound/iu.test(result.stderr)) return false;
  throw new Error(
    `Failed to observe ${resource}: ${result.stderr || result.stdout}`,
  );
}

async function kubectlJson(
  arguments_: readonly string[],
): Promise<Record<string, unknown>> {
  const result = await runCapture(
    'kubectl',
    ['--context', context, ...arguments_],
    root,
  );
  if (result.code !== 0) {
    throw new Error(`kubectl failed: ${result.stderr || result.stdout}`);
  }
  return jsonObject(JSON.parse(result.stdout), 'Kubernetes object');
}

function run(
  label: string,
  executable: string,
  arguments_: readonly string[],
  cwd: string,
  extraEnvironment: Readonly<Record<string, string>> = {},
): Promise<void> {
  console.log(`\n[identity-start-starter] ${label}`);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, arguments_, {
      cwd,
      stdio: 'inherit',
      env: { ...process.env, ...extraEnvironment },
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${label} failed with ${signal ? `signal ${signal}` : `exit ${code}`}.`,
        ),
      );
    });
  });
}

function runCapture(
  executable: string,
  arguments_: readonly string[],
  cwd: string,
): Promise<{
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, arguments_, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

function jsonObject(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is not an object.`);
  }
  return value as Record<string, unknown>;
}

function nestedArray(
  value: Record<string, unknown>,
  path: readonly string[],
): readonly Record<string, unknown>[] {
  const candidate = nestedValue(value, path);
  if (!Array.isArray(candidate)) return [];
  return candidate.map((entry, index) =>
    jsonObject(entry, `${path.join('.')}[${index}]`)
  );
}

function nestedString(
  value: Record<string, unknown>,
  path: readonly string[],
): string | undefined {
  const candidate = nestedValue(value, path);
  return typeof candidate === 'string' ? candidate : undefined;
}

function nestedValue(
  value: Record<string, unknown>,
  path: readonly string[],
): unknown {
  let current: unknown = value;
  for (const segment of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    current = Reflect.get(current, segment);
  }
  return current;
}
