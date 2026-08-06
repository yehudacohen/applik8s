// typecast-file-boundary: provider, browser, MCP, and Kubernetes values become
// exact-candidate evidence only after explicit structural checks.
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { OryHydraOAuthAdapter } from '@applik8s/identity-ory';
import { chromium } from '@playwright/test';
import {
  type IdentityStartLiveContext,
  type IdentityStartServiceTunnel,
  identityStartKubectlJson,
  identityStartResourceExists,
  identityStartServiceTunnel,
  identityStartServiceUrl,
  jsonObject,
  nestedArray,
  nestedString,
  passedIdentityStartBrowserTests,
  runIdentityStartCommand,
  waitForIdentityStartAbsent,
} from './identity-start-live-support';
import {
  createIdentityStartMcpCredential,
  type IdentityStartMcpCredential,
  identityStartMcpClientId,
  invokeIdentityStartMcp,
} from './identity-start-mcp';
import {
  createIdentityStartOrySession,
  type IdentityStartOrySession,
} from './identity-start-ory-session';
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
    `The Dedicated Identity gate is restricted to context "orbstack"; received ${JSON.stringify(context)}.`,
  );
}
const execution: IdentityStartLiveContext = {
  root,
  context,
  label: 'identity-start-dedicated',
};
const applicationDir = join(root, 'examples/identity-start');
const cli = join(root, 'packages/cli/dist/bin.js');
const instancePath = 'kubernetes/application.dedicated.orbstack.yaml';
const controlPlaneNamespace = 'identity-start-control';
const installationName = 'identity-start-dedicated';
const applicationNamespace = 'identity-start-system';
const rootResource = `identitystart/${installationName}`;
const definitionResource = 'resourcegraphdefinition/identity-start';
const lifecycleTimeoutMs = 20 * 60_000;
const browserResultsPath = join(
  root,
  '.applik8s-tmp/evidence/v0.7/identity-start-dedicated-browser-results.json',
);
const evidencePath = join(
  root,
  '.applik8s-tmp/evidence/v0.7/identity-start-dedicated.json',
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
const observed = new Map<string, {
  readonly test: string;
  readonly observedAt: string;
}>();
let deployed = false;
let credential: IdentityStartMcpCredential | undefined;
let session: IdentityStartOrySession | undefined;
let hydraPublicTunnel: IdentityStartServiceTunnel | undefined;
let hydraAdminTunnel: IdentityStartServiceTunnel | undefined;
let endpoint = '';

await discardV06Evidence(evidencePath);

try {
  if (
    await identityStartResourceExists(
      execution,
      definitionResource,
    )
  ) {
    await destroyApplication('remove the prior Dedicated Identity Start graph');
  }
  await waitForIdentityStartAbsent(
    execution,
    rootResource,
    controlPlaneNamespace,
    lifecycleTimeoutMs,
  );
  await waitForIdentityStartAbsent(
    execution,
    definitionResource,
    undefined,
    lifecycleTimeoutMs,
  );

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

  await runIdentityStartCommand(
    execution,
    'prepare the retained OrbStack block device through TypeKro',
    'node',
    ['scripts/orbstack-local-block-fixture.ts', 'prepare'],
    root,
    { APPLIK8S_E2E_CONTEXT: context },
  );
  await runIdentityStartCommand(
    execution,
    'prepare the Dedicated inference and namespace fixture through TypeKro',
    'bun',
    ['run', 'scripts/identity-start-dedicated-fixture.ts', 'prepare'],
    root,
    { APPLIK8S_E2E_CONTEXT: context },
  );
  deployed = true;
  await runIdentityStartCommand(
    execution,
    'deploy Dedicated Identity Start through Alchemy and TypeKro',
    cli,
    [
      'deploy',
      '--context',
      context,
      '--instance',
      instancePath,
    ],
    applicationDir,
    { NODE_OPTIONS: '--max-old-space-size=8192' },
  );

  await waitForDedicatedInferenceDataPlane();
  record(
    'managed-inference-data-plane',
    'the managed Envoy route completed an OpenAI-compatible request against the declared Dedicated backend',
  );

  endpoint = await identityStartServiceUrl(
    execution,
    'identity-start-app',
    applicationNamespace,
    3000,
  );
  const [kratosPublicUrl, kratosAdminUrl, mcpBaseUrl] =
    await Promise.all([
      identityStartServiceUrl(
        execution,
        'identity-start-identity-kratos-public',
        applicationNamespace,
        80,
      ),
      identityStartServiceUrl(
        execution,
        'identity-start-identity-kratos-admin',
        applicationNamespace,
        80,
      ),
      identityStartServiceUrl(
        execution,
        'identity-start-access-mcp',
        applicationNamespace,
        8080,
      ),
    ]);

  session = await createIdentityStartOrySession({
    publicUrl: kratosPublicUrl,
    adminUrl: kratosAdminUrl,
    roles: ['reviewer', 'administrator'],
  });
  record(
    'ory-human-session-admission',
    'Kratos browser flow issued the session admitted by the application',
  );

  await runIdentityStartCommand(
    execution,
    'execute maintained Dedicated Identity browser journeys',
    join(root, 'node_modules/.bin/playwright'),
    ['test', '--config', 'playwright.identity.config.ts'],
    root,
    {
      APPLIK8S_IDENTITY_START_BASE_URL: endpoint,
      APPLIK8S_IDENTITY_START_EXPECTED_PRINCIPAL: session.expectedPrincipal,
      APPLIK8S_IDENTITY_START_PROFILE: 'dedicated',
      APPLIK8S_IDENTITY_START_SESSION_COOKIE: session.cookie,
    },
  );
  const passedTests = await passedIdentityStartBrowserTests(browserResultsPath);
  const human = passedTests.get(browserJourney);
  const agent = passedTests.get(agentJourney);
  if (!human || !agent || passedTests.size !== 2) {
    throw new Error(
      'Dedicated browser evidence does not contain exactly the two maintained Identity Start golden paths.',
    );
  }
  observed.set('provider-derived-role-authority', {
    test:
      'Ory provider metadata admitted reviewer and administrator authority for maintained browser journeys',
    observedAt: human.completedAt,
  });
  observed.set('durable-human-approval', {
    test: browserJourney,
    observedAt: human.completedAt,
  });
  observed.set('framework-derived-signal-actor', {
    test: browserJourney,
    observedAt: human.completedAt,
  });
  observed.set('authorization-receipt', {
    test: browserJourney,
    observedAt: human.completedAt,
  });
  observed.set('production-sensitive-agent-admission', {
    test: agentJourney,
    observedAt: agent.completedAt,
  });

  [hydraPublicTunnel, hydraAdminTunnel] = await Promise.all([
    identityStartServiceTunnel(
      execution,
      'identity-start-identity-hydra-public',
      applicationNamespace,
      4444,
    ),
    identityStartServiceTunnel(
      execution,
      'identity-start-identity-hydra-admin',
      applicationNamespace,
      4445,
    ),
  ]);
  const hydra = new OryHydraOAuthAdapter({
    adminUrl: hydraAdminTunnel.url,
    publicUrl: hydraPublicTunnel.url,
  });
  await hydra.ready();
  credential = await createIdentityStartMcpCredential(hydra);
  const mcpTarget = `production/mcp/${runId}`;
  const mcpEvidence =
    `Dedicated MCP release evidence ${runId} exercises exact OAuth authority.`;
  const mcpOutcome =
    `Approve ${runId} after a workload restart and requery canonical state.`;
  const mcp = await invokeIdentityStartMcp({
    endpoint: `${mcpBaseUrl}/__applik8s/mcp/access`,
    accessToken: credential.accessToken,
    input: {
      operation: 'catalog.repair',
      target: mcpTarget,
      evidence: mcpEvidence,
      intendedOutcome: mcpOutcome,
    },
  });
  if (!mcp.sessionId || !mcp.catalogRevision || mcp.tool !== 'create') {
    throw new Error('MCP invocation did not preserve its typed discovery contract.');
  }
  record(
    'mcp-http-invocation',
    'Hydra client credentials discovered and invoked the typed MCP create tool',
  );

  const pending = await waitForAccessRequest(
    endpoint,
    session.cookie,
    (request) =>
      request.target === mcpTarget && request.state === 'pending',
    'MCP-created pending access request',
  );
  await restartApplicationWorkloads();
  const recovered = await waitForAccessRequest(
    endpoint,
    session.cookie,
    (request) =>
      request.id === pending.id && request.state === 'pending',
    'pending request after workload restart',
  );
  await approveRequestThroughBrowser(
    endpoint,
    session.cookie,
    recovered.id,
  );
  const approved = await waitForAccessRequest(
    endpoint,
    session.cookie,
    (request) =>
      request.id === pending.id
      && request.state === 'approved'
      && request.approvedBy === session?.expectedPrincipal
      && Boolean(request.decisionReceipt),
    'approved request after workload restart',
  );
  if (!approved.decisionReceipt) {
    throw new Error('Recovered workflow did not persist its authorization receipt.');
  }
  record(
    'restart-recovery',
    'MCP-created durable review remained pending across workload restart and resumed to approval',
  );

  const audit = await operationsAudit(
    endpoint,
    session.cookie,
    'AccessRequest',
  );
  if (audit.length === 0) {
    throw new Error('Dedicated operations query returned no searchable audit evidence.');
  }
  assertRedactedAudit(audit, [
    mcpTarget,
    mcpEvidence,
    mcpOutcome,
    session.expectedPrincipal,
    identityStartMcpClientId,
  ]);
  record(
    'redacted-audit-search',
    'authenticated operations query returned searchable public audit records without sensitive authority data',
  );

  const [git, cluster, installation, artifacts] = await Promise.all([
    collectV06GitIdentity(root),
    collectV06ClusterIdentity(context),
    collectV06InstallationIdentity({
      context,
      resource: rootResource,
      namespace: controlPlaneNamespace,
    }),
    collectV06ArtifactIdentity(deploymentGraphPath),
  ]);

  await credential.revoke();
  credential = undefined;
  await Promise.all([
    hydraPublicTunnel.close(),
    hydraAdminTunnel.close(),
  ]);
  hydraPublicTunnel = undefined;
  hydraAdminTunnel = undefined;
  await destroyApplication(
    'destroy Dedicated Identity Start through Alchemy and TypeKro',
  );
  deployed = false;
  await waitForIdentityStartAbsent(
    execution,
    rootResource,
    controlPlaneNamespace,
    lifecycleTimeoutMs,
  );
  await waitForIdentityStartAbsent(
    execution,
    definitionResource,
    undefined,
    lifecycleTimeoutMs,
  );
  if (
    !await identityStartResourceExists(
      execution,
      'service/identity-start-identity-hydra-public',
      applicationNamespace,
    )
  ) {
    throw new Error(
      'Dedicated graph destruction removed a retained provider resource.',
    );
  }
  record(
    'graph-backed-destroy',
    'Alchemy and TypeKro removed the root lifecycle while preserving retained Dedicated providers',
  );

  const required = [
    'fresh-packed-application',
    'managed-inference-data-plane',
    'ory-human-session-admission',
    'provider-derived-role-authority',
    'production-sensitive-agent-admission',
    'durable-human-approval',
    'framework-derived-signal-actor',
    'authorization-receipt',
    'mcp-http-invocation',
    'redacted-audit-search',
    'restart-recovery',
    'graph-backed-destroy',
  ] as const;
  const completedAt = new Date().toISOString();
  await writeV06EvidenceReceipt(evidencePath, {
    suite: 'identity-start-dedicated',
    run: { id: runId, startedAt, completedAt },
    candidate: { git, cluster, installation, artifacts },
    environment: {
      context,
      controlPlaneNamespace,
      installation: installationName,
      applicationNamespace,
      endpoint,
      profile: 'dedicated',
      identityProvider: 'ory',
      deployment: 'ApplicationDeploymentGraph -> Alchemy -> TypeKro',
      retainedProviders: true,
    },
    assertionEvidence: createV06AssertionEvidence(
      required.map((assertion) => {
        const evidence = observed.get(assertion);
        if (!evidence) {
          throw new Error(`Missing Dedicated evidence ${assertion}.`);
        }
        return { assertion, ...evidence };
      }),
      runId,
    ),
  });
  console.log(`Recorded exact-candidate Dedicated evidence at ${evidencePath}.`);
} catch (error) {
  await discardV06Evidence(evidencePath);
  const cleanupErrors: unknown[] = [error];
  if (credential) {
    await credential.revoke().catch((cleanupError) => {
      cleanupErrors.push(cleanupError);
    });
  }
  await Promise.all([
    hydraPublicTunnel?.close(),
    hydraAdminTunnel?.close(),
  ]).catch((cleanupError) => {
    cleanupErrors.push(cleanupError);
  });
  const lifecycleExists = await identityStartResourceExists(
    execution,
    definitionResource,
  ).catch((cleanupError) => {
    cleanupErrors.push(cleanupError);
    return false;
  });
  if (deployed || lifecycleExists) {
    await destroyApplication(
      'clean up failed Dedicated Identity Start qualification',
    ).catch((cleanupError) => {
      cleanupErrors.push(cleanupError);
    });
  }
  if (cleanupErrors.length > 1) {
    throw new AggregateError(
      cleanupErrors,
      'Dedicated Identity qualification and graph-backed cleanup both failed.',
    );
  }
  throw error;
}

function record(assertion: string, test: string): void {
  observed.set(assertion, {
    test,
    observedAt: new Date().toISOString(),
  });
}

async function destroyApplication(label: string): Promise<void> {
  await runIdentityStartCommand(
    execution,
    label,
    cli,
    [
      'destroy',
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

interface AccessRequestSnapshot {
  readonly id: string;
  readonly target?: string;
  readonly state?: string;
  readonly approvedBy?: string;
  readonly decisionReceipt?: string;
}

async function waitForAccessRequest(
  baseUrl: string,
  cookie: string,
  predicate: (request: AccessRequestSnapshot) => boolean,
  label: string,
): Promise<AccessRequestSnapshot> {
  const deadline = Date.now() + 120_000;
  let last: readonly AccessRequestSnapshot[] = [];
  while (Date.now() <= deadline) {
    last = await accessRequests(baseUrl, cookie);
    const match = last.find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(
    `${label} did not appear within 120000ms; observed ${JSON.stringify(last)}.`,
  );
}

async function accessRequests(
  baseUrl: string,
  cookie: string,
): Promise<readonly AccessRequestSnapshot[]> {
  const payload = await applicationQuery(
    baseUrl,
    cookie,
    'AccessRequest.accessRequestQueue',
    { limit: 100 },
  );
  const value = payload.value;
  if (!Array.isArray(value)) {
    throw new Error('AccessRequest queue response has no value array.');
  }
  return value.map((candidate, index) => {
    const request = jsonObject(candidate, `AccessRequest[${index}]`);
    const id = nestedString(request, ['id']);
    if (!id) throw new Error(`AccessRequest[${index}] has no id.`);
    const target = nestedString(request, ['target']);
    const state = nestedString(request, ['state']);
    const approvedBy = nestedString(request, ['approvedBy']);
    const decisionReceipt = nestedString(request, ['decisionReceipt']);
    return {
      id,
      ...(target ? { target } : {}),
      ...(state ? { state } : {}),
      ...(approvedBy ? { approvedBy } : {}),
      ...(decisionReceipt ? { decisionReceipt } : {}),
    };
  });
}

async function operationsAudit(
  baseUrl: string,
  cookie: string,
  search: string,
): Promise<readonly Record<string, unknown>[]> {
  const payload = await applicationQuery(
    baseUrl,
    cookie,
    'Conversation.operationsSnapshot',
    { limit: 100, auditSearch: search },
  );
  const value = jsonObject(payload.value, 'operations snapshot value');
  const audit = value.audit;
  if (!Array.isArray(audit)) {
    throw new Error('Operations snapshot has no audit array.');
  }
  return audit.map((entry, index) =>
    jsonObject(entry, `operations audit[${index}]`)
  );
}

async function applicationQuery(
  baseUrl: string,
  cookie: string,
  operation: string,
  input: Readonly<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const response = await fetch(
    new URL(
      `/__applik8s/v1/queries/${encodeURIComponent(operation)}/snapshot`,
      baseUrl,
    ),
    {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        cookie,
      },
      body: JSON.stringify({ input }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Query ${operation} returned ${response.status}: ${text.slice(0, 2_000)}`,
    );
  }
  return jsonObject(JSON.parse(text), `${operation} response`);
}

async function restartApplicationWorkloads(): Promise<void> {
  const deployments = await identityStartKubectlJson(execution, [
    'get',
    'deployments',
    '--namespace',
    applicationNamespace,
    '--selector',
    'applik8s.dev/graph=identity-start',
    '--output=json',
  ]);
  const workloads = nestedArray(deployments, ['items'])
    .map((item) => ({
      name: nestedString(item, ['metadata', 'name']),
      component: nestedString(item, [
        'metadata',
        'labels',
        'app.kubernetes.io/component',
      ]),
    }))
    .filter(
      (workload): workload is {
        readonly name: string;
        readonly component: string | undefined;
      } =>
        Boolean(workload.name),
    );
  const names = workloads.map((workload) => workload.name);
  for (const expected of [
    'application-host',
    'query-gateway',
    'workflow-worker',
  ]) {
    if (!workloads.some((workload) => workload.component === expected)) {
      throw new Error(
        `Dedicated restart set is missing the ${expected} component; observed ${
          workloads
            .map(
              (workload) =>
                `${workload.name} (${workload.component ?? 'unclassified'})`,
            )
            .join(', ')
        }.`,
      );
    }
  }
  for (const name of names) {
    await runIdentityStartCommand(
      execution,
      `restart deployment/${name}`,
      'kubectl',
      [
        '--context',
        context,
        'rollout',
        'restart',
        `deployment/${name}`,
        '--namespace',
        applicationNamespace,
      ],
      root,
    );
  }
  for (const name of names) {
    await runIdentityStartCommand(
      execution,
      `wait for deployment/${name} after restart`,
      'kubectl',
      [
        '--context',
        context,
        'rollout',
        'status',
        `deployment/${name}`,
        '--namespace',
        applicationNamespace,
        '--timeout=10m',
      ],
      root,
    );
  }
}

async function approveRequestThroughBrowser(
  baseUrl: string,
  cookie: string,
  requestId: string,
): Promise<void> {
  const separator = cookie.indexOf('=');
  if (separator <= 0 || separator === cookie.length - 1) {
    throw new Error('Provider session cookie must contain name=value.');
  }
  const browser = await chromium.launch({ headless: true });
  try {
    const browserContext = await browser.newContext();
    await browserContext.addCookies([{
      name: cookie.slice(0, separator),
      value: cookie.slice(separator + 1),
      url: baseUrl,
      httpOnly: true,
      sameSite: 'Lax',
    }]);
    const page = await browserContext.newPage();
    await page.goto(baseUrl);
    const review = page.locator(
      `[data-review-request-id="${requestId}"]`,
    );
    await review.waitFor({ state: 'visible', timeout: 45_000 });
    await review.getByRole('button', { name: 'Approve' }).click();
    await review.waitFor({ state: 'hidden', timeout: 45_000 });
  } finally {
    await browser.close();
  }
}

async function waitForDedicatedInferenceDataPlane(): Promise<void> {
  const deadline = Date.now() + 120_000;
  let lastObservation = 'the Gateway has not been observed';
  while (Date.now() <= deadline) {
    try {
      const gateway = await identityStartKubectlJson(execution, [
        'get',
        'gateway/identity-start-inference',
        '--namespace',
        applicationNamespace,
        '--output=json',
      ]);
      const generation = Number(
        jsonObject(gateway.metadata, 'Gateway metadata').generation,
      );
      const programmed = nestedArray(gateway, ['status', 'conditions'])
        .map((condition, index) =>
          jsonObject(condition, `Gateway status.conditions[${index}]`)
        )
        .find((condition) =>
          nestedString(condition, ['type']) === 'Programmed'
          && nestedString(condition, ['status']) === 'True'
          && Number(condition.observedGeneration) >= generation
        );
      const address = nestedArray(gateway, ['status', 'addresses'])
        .map((candidate, index) =>
          jsonObject(candidate, `Gateway status.addresses[${index}]`)
        )
        .map((candidate) => nestedString(candidate, ['value']))
        .find((candidate): candidate is string => Boolean(candidate));
      const port = nestedArray(gateway, ['spec', 'listeners'])
        .map((listener, index) =>
          jsonObject(listener, `Gateway spec.listeners[${index}]`)
        )
        .map((listener) => Number(listener.port))
        .find((candidate) => Number.isInteger(candidate));
      if (!programmed || !address || !port) {
        lastObservation =
          `Gateway is not current-generation Programmed with an address and listener: ${
            JSON.stringify({
              generation,
              programmed: Boolean(programmed),
              address,
              port,
            })
          }`;
      } else {
        const response = await fetch(
          `http://${address}:${port}/v1/chat/completions`,
          {
            method: 'POST',
            headers: {
              accept: 'application/json',
              'content-type': 'application/json',
              'x-ai-eg-model': 'fast',
            },
            body: JSON.stringify({
              model: 'fast',
              messages: [{
                role: 'user',
                content: 'Prove the managed inference data plane is ready.',
              }],
              tools: [{
                type: 'function',
                function: {
                  name: 'managed_inference_readiness',
                  description: 'Release-gate readiness probe.',
                  parameters: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {},
                  },
                },
              }],
            }),
            signal: AbortSignal.timeout(10_000),
          },
        );
        const source = await response.text();
        if (response.ok) {
          const body = jsonObject(
            JSON.parse(source),
            'Dedicated inference readiness response',
          );
          const choices = nestedArray(body, ['choices']);
          const message = choices.length > 0
            ? jsonObject(
                jsonObject(
                  choices[0],
                  'Dedicated inference choice',
                ).message,
                'Dedicated inference message',
              )
            : undefined;
          const toolCalls = message
            ? nestedArray(message, ['tool_calls'])
            : [];
          const functionName = toolCalls.length > 0
            ? nestedString(
                jsonObject(
                  jsonObject(
                    toolCalls[0],
                    'Dedicated inference tool call',
                  ).function,
                  'Dedicated inference tool call function',
                ),
                ['name'],
              )
            : undefined;
          if (functionName === 'managed_inference_readiness') return;
          lastObservation =
            `Gateway returned 200 without the expected typed tool call: ${
              source.slice(0, 2_000)
            }`;
        } else {
          lastObservation =
            `Gateway returned ${response.status}: ${source.slice(0, 2_000)}`;
        }
      }
    } catch (error) {
      lastObservation = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(
    'Dedicated managed inference data plane did not become usable within '
    + `120000ms: ${lastObservation}`,
  );
}

function assertRedactedAudit(
  audit: readonly Record<string, unknown>[],
  forbidden: readonly string[],
): void {
  const publicKeys = new Set([
    'category',
    'id',
    'label',
    'state',
    'authority',
    'observedAt',
  ]);
  for (const [index, entry] of audit.entries()) {
    const unexpected = Object.keys(entry).filter((key) => !publicKeys.has(key));
    if (unexpected.length > 0) {
      throw new Error(
        `Operations audit[${index}] exposed non-public fields: ${unexpected.join(', ')}.`,
      );
    }
    if (
      nestedString(entry, ['category']) !== 'audit'
      || nestedString(entry, ['authority']) !== 'canonical'
    ) {
      throw new Error(
        `Operations audit[${index}] lacks canonical public classification.`,
      );
    }
  }
  const serialized = JSON.stringify(audit);
  for (const value of forbidden) {
    if (serialized.includes(value)) {
      throw new Error(
        `Operations audit leaked forbidden source value ${JSON.stringify(value)}.`,
      );
    }
  }
}
