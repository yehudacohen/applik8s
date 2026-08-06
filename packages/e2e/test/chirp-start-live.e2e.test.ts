// typecast-file-boundary: live Kubernetes, HTTP, Valkey, and ClickHouse responses are shape-checked before focused evidence assertions.
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setApplicationWorkflowRuntimeFactory } from '@applik8s/applik8s';
import { S3Client } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RebuildHomeTimelines } from '../../../examples/chirp-start/src/recovery/timeline';
import { createS3ApplicationObjectStorageRuntime } from '@applik8s/runtime-s3';
import { createHatchetWorkflowRuntime } from '@applik8s/runtime-hatchet';
import {
  collectV06ArtifactIdentity,
  collectV06ClusterIdentity,
  collectV06GitIdentity,
  collectV06InstallationIdentity,
  createV06AssertionEvidence,
  discardV06Evidence,
  writeV06EvidenceReceipt,
} from '../../../scripts/v06-evidence';
import { assertExpectedKubectlContext, kubectl, sleep } from './live-e2e-helpers';

const enabled = process.env.APPLIK8S_E2E_CHIRP_LIVE === '1';
const namespace = process.env.APPLIK8S_NAMESPACE ?? 'chirp';
const controlPlaneNamespace = process.env.APPLIK8S_CONTROL_PLANE_NAMESPACE ?? 'chirp-control';
const installationName = process.env.APPLIK8S_CHIRP_INSTANCE ?? 'chirp';
const onlineIndexName = process.env.APPLIK8S_CHIRP_INDEX ?? 'chirp-online-index';
const headers = { 'content-type': 'application/json', 'x-chirp-user': 'demo-user' };

let web: PortForward | undefined;
let clickhouse: PortForward | undefined;
let workflowApi: PortForward | undefined;
let workflowEngine: PortForward | undefined;
let restoreWorkflowRuntime: (() => void) | undefined;
let previousWorkflowToken: string | undefined;
const evidencePath = join(process.cwd(), '.applik8s-tmp/evidence/v0.6/chirp.json');
const evidenceRunId = randomUUID();
const evidenceStartedAt = new Date().toISOString();
const completedEvidenceTests = new Set<string>();
let runtimeEvidence: { readonly endpoint: string; readonly status: Record<string, unknown>; readonly artifactEvidence: Record<string, unknown> } | undefined;
let recoveryEvidence: { readonly result: ProjectionRebuildResult; readonly evidence: ProjectionRebuildEvidence } | undefined;

(enabled ? describe : describe.skip)('Chirp public golden path on OrbStack', () => {
  beforeAll(async () => {
    await discardV06Evidence(evidencePath);
    await assertExpectedKubectlContext();
    const installedUrl = await installationStatusUrl();
    web = externalEndpoint(process.env.APPLIK8S_CHIRP_BASE_URL ?? installedUrl);
    clickhouse = await startPortForward('service/clickhouse-chirp-analytics', 8_123);
    const workflowEndpoints = await deployedWorkflowEndpoints();
    workflowApi = await portForwardClusterServiceEndpoint(workflowEndpoints.apiUrl);
    workflowEngine = await portForwardClusterServiceEndpoint(workflowEndpoints.hostPort);
    previousWorkflowToken = process.env.HATCHET_CLIENT_TOKEN;
    process.env.HATCHET_CLIENT_TOKEN = await secretValue(namespace, 'hatchet-client-config', 'HATCHET_CLIENT_TOKEN');
    restoreWorkflowRuntime = setApplicationWorkflowRuntimeFactory(async () => createHatchetWorkflowRuntime({
      kind: 'hatchet',
      provision: false,
      hostPort: `127.0.0.1:${required(workflowEngine).port}`,
      apiUrl: required(workflowApi).endpoint,
      tls: false,
    }));
  }, 60_000);

  afterAll(async () => {
    try {
      if (completedEvidenceTests.size === 3) await writeCompleteChirpEvidenceReceipt();
    } finally {
      restoreWorkflowRuntime?.();
      if (previousWorkflowToken === undefined) delete process.env.HATCHET_CLIENT_TOKEN;
      else process.env.HATCHET_CLIENT_TOKEN = previousWorkflowToken;
      await Promise.all([web?.close(), clickhouse?.close(), workflowApi?.close(), workflowEngine?.close()]);
    }
  });

  it('runs SSR, JetStream command delivery, durable mutation, Valkey projection, SSE invalidation, authoritative requery, and ClickHouse projection', async () => {
    const endpoint = required(web).endpoint;
    const page = await fetch(endpoint);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('Chirp · built with Applik8s');
    expect(html).toContain('Why this feed matters');

    const registrationPrincipal = `live-account-${Date.now()}`;
    const registrationHeaders = { 'content-type': 'application/json', 'x-chirp-user': registrationPrincipal };
    const registrationBefore = await querySnapshot(endpoint, 'Account.me', {}, registrationHeaders);
    expect(registrationBefore.value).toMatchObject({
      registered: false,
      id: registrationPrincipal,
      suggestedHandle: expect.any(String),
    });
    const registrationCommandId = `register-${registrationPrincipal}`;
    const registration = await postJson(`${endpoint}/__applik8s/v1/commands/models.Account.create.v1/submit`, {
      input: {
        handle: `user_${Date.now().toString(36)}`,
        displayName: 'Live registration account',
        bio: 'Registered through the public principal-derived command path.',
        visibility: 'public',
      },
      commandId: registrationCommandId,
      idempotencyKey: registrationCommandId,
    }, registrationHeaders);
    expect(registration.durableResult).toBe('pending');
    await expect(waitForCommand(
      endpoint,
      stringField(registration, 'progressCursor'),
      'models.Account.create.v1',
      registrationHeaders,
    )).resolves.toMatchObject({ durableResult: 'succeeded' });
    const registrationAfter = await querySnapshot(endpoint, 'Account.me', {}, registrationHeaders);
    expect(registrationAfter.value).toMatchObject({
      registered: true,
      id: registrationPrincipal,
      displayName: 'Live registration account',
      state: 'active',
    });

    const before = await snapshot(endpoint);
    const postAnalyticsPartition = 'demo-user';
    const postAnalyticsRowsBefore = await analyticalProjectionCount(
      required(clickhouse).endpoint,
      postAnalyticsPartition,
    );
    const postId = `e2e-${Date.now()}`;
    const body = `Chirp public golden path ${new Date().toISOString()}`;
    const invalidation = waitForInvalidation(endpoint, before.cursor);
    const submission = await postJson(`${endpoint}/__applik8s/v1/commands/models.Post.create.v1/submit`, {
      input: { id: postId, body, visibility: 'public' },
      commandId: postId,
      idempotencyKey: `golden-${postId}`,
    });
    expect(submission.durableResult).toBe('pending');
    const progressCursor = stringField(submission, 'progressCursor');
    const result = await waitForCommand(endpoint, progressCursor);
    expect(result).toMatchObject({ durableResult: 'succeeded', modelRevision: expect.any(String) });

    const event = await invalidation;
    expect(event).toContain('event: invalidate');
    expect(event).toContain('Post.homeTimeline');

    const found = await waitForPost(endpoint, postId);
    expect(found).toMatchObject({ id: postId, body, authorId: 'demo-user', visibility: 'public' });
    await assertOnlineTimelineProjection(postId, body);
    await waitForProjection(
      required(clickhouse).endpoint,
      postAnalyticsPartition,
      postAnalyticsRowsBefore,
    );

    const reactionId = `e2e-like-${postId}`;
    const reaction = await postJson(`${endpoint}/__applik8s/v1/commands/models.Reaction.create.v1/submit`, {
      input: { id: reactionId, postId, kind: 'like' },
      commandId: reactionId,
      idempotencyKey: `golden-${reactionId}`,
    });
    expect(reaction.durableResult).toBe('pending');
    await expect(waitForCommand(endpoint, stringField(reaction, 'progressCursor'), 'models.Reaction.create.v1')).resolves.toMatchObject({ durableResult: 'succeeded' });
    await waitForReactionProjection(required(clickhouse).endpoint, postId);
    await waitForTrendingPost(endpoint, postId);
    await expect(waitForEngagementBatch(endpoint, postId)).resolves.toMatchObject({
      partitionKey: postId,
      eventCount: '1',
      netDelta: '1',
      firstSequence: expect.any(String),
      lastSequence: expect.any(String),
      processedAt: expect.any(String),
    });

    const processorLogs = (await kubectl(['logs', `deployment/chirp-commands`, '--namespace', namespace, '--since=5m'])).stdout;
    expect(processorLogs).toContain(`"event":"applik8s-command-processed"`);
    expect(processorLogs).toContain(`"messageId":"${postId}"`);
    expect(processorLogs).toContain('"event":"applik8s-event-outbox-relayed"');

    const installation = jsonObject((await kubectl([
      'get', `chirpinstallation/${installationName}`, '--namespace', controlPlaneNamespace, '--output=json',
    ])).stdout);
    const status = objectField(installation, 'status');
    expect(status).toMatchObject({
      ready: true,
      phase: 'Ready',
      url: endpoint,
      providerStatus: {
        analytics: 'Ready', database: 'Ready', eventLog: 'Ready', index: 'Ready',
        objectStorage: 'Ready', registry: 'Ready', workflows: 'Ready', identity: 'Ready',
        authorization: 'Ready', exposure: 'Ready', workloads: 'Ready',
      },
    });
    if (endpoint.startsWith('http://127.0.0.1:')) {
      const service = jsonObject((await kubectl([
        'get', 'service/web-local-node-port', '--namespace', namespace, '--output=json',
      ])).stdout);
      const spec = objectField(service, 'spec');
      expect(spec.type).toBe('NodePort');
      expect(Array.isArray(spec.ports) ? spec.ports : []).toContainEqual(expect.objectContaining({
        port: 3_000,
        nodePort: Number(new URL(endpoint).port),
      }));
      expect(objectField(service, 'metadata').annotations).toMatchObject({
        'applik8s.dev/public-url': endpoint,
      });
    }
    runtimeEvidence = await collectRuntimeEvidence(endpoint, status, installation);
    completedEvidenceTests.add('runtime');
  }, 180_000);

  it('recovers complete Valkey loss from an authoritative snapshot without blocking foreground commits', async () => {
    const endpoint = required(web).endpoint;
    const baselineId = `rebuild-baseline-${Date.now()}`;
    const baselineBody = `Chirp rebuild baseline ${new Date().toISOString()}`;
    await createPostAndWait(endpoint, baselineId, baselineBody, `rebuild-baseline-${baselineId}`);
    await waitForPost(endpoint, baselineId);

    // This is an intentional failure injection against the derived store. The
    // PostgreSQL model remains the authority and the workflow below must
    // reconstruct a new generation rather than falling back to relational
    // query execution or silently serving an empty feed.
    await valkeyCommand(['FLUSHDB']);
    const root = timelineProjectionRoot();
    const activeGenerationKey = `${metadataTag(root)}:active-generation`;
    // The live worker is intentionally fast enough to recreate its initial
    // generation between two shell invocations. Replace the marker with an
    // empty value after the destructive flush so SETNX-based preparation
    // cannot heal the fault before the public query observes it.
    await valkeyCommand(['SET', activeGenerationKey, '']);
    expect((await valkeyCommand(['GET', activeGenerationKey])).trim()).toBe('');
    const unavailable = await fetch(`${endpoint}/__applik8s/v1/queries/Post.homeTimeline/snapshot`, {
      method: 'POST', headers, body: JSON.stringify({ input: { limit: 50 } }),
    });
    const unavailableBody = await unavailable.text();
    expect(unavailable.ok).toBe(false);
    expect(unavailableBody).toMatch(/projection|generation|valkey|unavailable/i);

    // Reintroduce only the previous generation identity and zero checkpoint;
    // the generation contents remain absent and must be rebuilt from the
    // authoritative PostgreSQL snapshot.
    await valkeyCommand(['SET', activeGenerationKey, 'live']);
    await valkeyCommand(['SET', `${metadataTag(root)}:checkpoint:posts.timeline-changed.v1`, '0']);

    const generation = `recovery-${Date.now()}`;
    const rebuild = await RebuildHomeTimelines.start({ generation }, {
      idempotencyKey: `chirp-live-rebuild-${generation}`,
      correlationId: `chirp-live-recovery-${generation}`,
    });
    const foregroundId = `rebuild-foreground-${Date.now()}`;
    const foregroundBody = `Committed while rebuilding ${new Date().toISOString()}`;
    const foreground = createPostAndWait(endpoint, foregroundId, foregroundBody, `rebuild-foreground-${foregroundId}`);
    const [result] = await Promise.all([
      rebuild.result({ timeoutMs: 600_000, pollIntervalMs: 500 }),
      foreground,
    ]);

    expect(result).toMatchObject({
      generation,
      previousGeneration: 'live',
      sourceWatermark: expect.any(Number),
      publishedWatermark: expect.any(Number),
      events: expect.any(Number),
      rows: expect.any(Number),
      manifest: expect.objectContaining({
        store: 'home-timeline-rebuild-artifacts',
        key: `projection-rebuilds/home-timeline/${generation}/manifest.json`,
      }),
    });
    expect(result.publishedWatermark).toBeGreaterThanOrEqual(result.sourceWatermark);
    expect(result.rows).toBeGreaterThan(0);

    const state = await timelineProjectionState();
    expect(state).toMatchObject({ activeGeneration: generation, rebuildingGeneration: '' });
    expect(state.checkpoint).toBe(result.publishedWatermark);
    expect(state.highwater).toBe(result.publishedWatermark);
    await expect(waitForPost(endpoint, baselineId)).resolves.toMatchObject({ id: baselineId, body: baselineBody });
    await expect(waitForPost(endpoint, foregroundId)).resolves.toMatchObject({ id: foregroundId, body: foregroundBody });

    const evidence = await validateProjectionRebuildArtifacts(
      result.manifest,
      generation,
    );
    expect(evidence.manifest.sourceWatermark).toBe(result.sourceWatermark);
    expect(evidence.manifest.segments.length).toBeGreaterThan(0);

    // A distinct provider invocation reaches the task again. The runtime must
    // validate and reuse the already-published immutable manifest instead of
    // rescanning authority or rejecting the target as active.
    const repeated = await RebuildHomeTimelines.run(
      { generation },
      { idempotencyKey: `chirp-live-rebuild-repeat-${generation}` },
      { timeoutMs: 600_000, pollIntervalMs: 500 },
    );
    expect(repeated).toEqual(result);
    recoveryEvidence = { result, evidence };
    completedEvidenceTests.add('recovery');
  }, 900_000);

  it('preserves acknowledged work across processor, projection, gateway, web, and Harbor restarts', async () => {
    const endpoint = required(web).endpoint;
    const postId = `restart-${Date.now()}`;
    const body = `Acknowledged before component replacement ${new Date().toISOString()}`;
    const submission = await postJson(`${endpoint}/__applik8s/v1/commands/models.Post.create.v1/submit`, {
      input: { id: postId, body, visibility: 'public' },
      commandId: postId,
      idempotencyKey: `restart-${postId}`,
    });
    expect(submission.durableResult).toBe('pending');

    await Promise.all([
      restartLogicalWorkload('chirp-commands'),
      restartLogicalWorkload('chirp-home-timeline'),
      restartLogicalWorkload('chirp-social'),
      restartLogicalWorkload('chirp-web'),
    ]);
    await expect(waitForCommand(endpoint, stringField(submission, 'progressCursor'))).resolves.toMatchObject({
      durableResult: 'succeeded',
    });
    await expect(waitForPost(endpoint, postId)).resolves.toMatchObject({ id: postId, body });
    await assertOnlineTimelineProjection(postId, body);

    const registryPostId = `registry-restart-${Date.now()}`;
    const registryBody = `Acknowledged while Harbor restarted ${new Date().toISOString()}`;
    const registrySubmission = await postJson(`${endpoint}/__applik8s/v1/commands/models.Post.create.v1/submit`, {
      input: { id: registryPostId, body: registryBody, visibility: 'public' },
      commandId: registryPostId,
      idempotencyKey: `registry-restart-${registryPostId}`,
    });
    expect(registrySubmission.durableResult).toBe('pending');
    await Promise.all([
      restartDeployment('harbor-core', 'typekro-harbor-registry'),
      restartDeployment('harbor-registry', 'typekro-harbor-registry'),
      restartDeployment('harbor-nginx', 'typekro-harbor-registry'),
      waitForCommand(endpoint, stringField(registrySubmission, 'progressCursor')),
    ]);
    await restartDeployment('chirp-web');
    await expect(waitForPost(endpoint, registryPostId)).resolves.toMatchObject({ id: registryPostId, body: registryBody });
    completedEvidenceTests.add('restart');
  }, 900_000);
});

interface PortForward { readonly endpoint: string; readonly port: number; close(): Promise<void> }

interface ProjectionRebuildResult {
  readonly generation: string;
  readonly previousGeneration: string;
  readonly sourceWatermark: number;
  readonly publishedWatermark: number;
  readonly events: number;
  readonly rows: number;
  readonly manifest: {
    readonly store: string;
    readonly key: string;
    readonly size: number;
    readonly contentType: string;
    readonly sha256: string;
  };
}

interface ProjectionRebuildEvidence {
  readonly manifest: {
    readonly protocol: string;
    readonly projection: string;
    readonly stream: string;
    readonly generation: string;
    readonly sourceKind: string;
    readonly sourceWatermark: number;
    readonly segments: readonly Record<string, unknown>[];
  };
  readonly manifestSha256: string;
  readonly segmentSha256: readonly string[];
}

async function assertOnlineTimelineProjection(postId: string, body: string): Promise<void> {
  const deployment = await deploymentForLogicalWorkload('chirp-home-timeline');
  const ready = (await kubectl([
    'get', `deployment/${deployment}`, '--namespace', namespace,
    '--output=jsonpath={.status.readyReplicas}',
  ])).stdout.trim();
  expect(ready).toBe('1');
  const root = timelineProjectionRoot();
  const generation = (await valkeyCommand(['GET', `${metadataTag(root)}:active-generation`])).trim();
  expect(generation).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
  const checkpoint = Number((await valkeyCommand(['GET', `${metadataTag(root)}:checkpoint:posts.timeline-changed.v1`])).trim());
  expect(Number.isSafeInteger(checkpoint) && checkpoint > 0).toBe(true);
  const partition = Buffer.from('demo-user').toString('base64url');
  const raw = (await valkeyCommand([
    'HGET', `{${root}:generation:${generation}:partition:${partition}}:values`, postId,
  ])).trim();
  expect(jsonObject(raw)).toMatchObject({ id: postId, body, authorId: 'demo-user', visibility: 'public' });
}

async function valkeyCommand(parts: readonly string[]): Promise<string> {
  return (await kubectl([
    'exec', `statefulset/${onlineIndexName}`, '--namespace', namespace,
    '--', 'valkey-cli', '--raw', ...parts,
  ])).stdout;
}

function timelineProjectionRoot(): string { return 'chirp:projection:home-timeline'; }

function metadataTag(root: string): string { return `{${root}:metadata}`; }

async function timelineProjectionState(): Promise<{
  readonly activeGeneration: string;
  readonly rebuildingGeneration: string;
  readonly checkpoint: number;
  readonly highwater: number;
}> {
  const root = timelineProjectionRoot();
  const activeGeneration = (await valkeyCommand(['GET', `${metadataTag(root)}:active-generation`])).trim();
  const rebuildingGeneration = (await valkeyCommand(['GET', `${metadataTag(root)}:rebuilding-generation`])).trim();
  const checkpoint = Number((await valkeyCommand(['GET', `${metadataTag(root)}:checkpoint:posts.timeline-changed.v1`])).trim());
  const highwater = Number((await valkeyCommand(['GET', `${metadataTag(root)}:generation:${activeGeneration}:highwater`])).trim());
  if (!activeGeneration || !Number.isSafeInteger(checkpoint) || !Number.isSafeInteger(highwater)) {
    throw new Error(`Chirp projection returned invalid recovery state: ${JSON.stringify({ activeGeneration, rebuildingGeneration, checkpoint, highwater })}`);
  }
  return { activeGeneration, rebuildingGeneration, checkpoint, highwater };
}

function externalEndpoint(endpoint: string): PortForward {
  const normalized = endpoint.replace(/\/$/, '');
  return { endpoint: normalized, port: Number(new URL(normalized).port || (normalized.startsWith('https:') ? 443 : 80)), async close() {} };
}

async function installationStatusUrl(): Promise<string> {
  const installation = jsonObject((await kubectl([
    'get', `chirpinstallation/${installationName}`, '--namespace', controlPlaneNamespace, '--output=json',
  ])).stdout);
  return stringField(objectField(installation, 'status'), 'url');
}

async function deployedWorkflowEndpoints(): Promise<{
  readonly apiUrl: string;
  readonly hostPort: string;
}> {
  const deployment = jsonObject((await kubectl([
    'get', 'deployment/chirp-workflows', '--namespace', namespace, '--output=json',
  ])).stdout);
  const spec = objectField(deployment, 'spec');
  const template = objectField(spec, 'template');
  const podSpec = objectField(template, 'spec');
  const containers = podSpec.containers;
  if (!Array.isArray(containers) || containers.length === 0) {
    throw new Error('The deployed Chirp workflow worker has no containers.');
  }
  const container = containers[0];
  if (!container || typeof container !== 'object' || Array.isArray(container)) {
    throw new Error('The deployed Chirp workflow worker has an invalid primary container.');
  }
  const environment = Reflect.get(container, 'env');
  if (!Array.isArray(environment)) {
    throw new Error('The deployed Chirp workflow worker has no hydrated environment.');
  }
  const value = (name: string): string => {
    const entry = environment.find((candidate) =>
      candidate !== null
      && typeof candidate === 'object'
      && !Array.isArray(candidate)
      && Reflect.get(candidate, 'name') === name
    );
    const result = entry && typeof entry === 'object' ? Reflect.get(entry, 'value') : undefined;
    if (typeof result !== 'string' || result.length === 0) {
      throw new Error(`The deployed Chirp workflow worker is missing ${name}.`);
    }
    return result;
  };
  return {
    apiUrl: value('HATCHET_CLIENT_API_URL'),
    hostPort: value('HATCHET_CLIENT_HOST_PORT'),
  };
}

async function portForwardClusterServiceEndpoint(endpoint: string): Promise<PortForward> {
  const parsed = endpoint.includes('://')
    ? new URL(endpoint)
    : new URL(`tcp://${endpoint}`);
  const hostParts = parsed.hostname.split('.');
  const service = hostParts[0];
  const serviceNamespace = hostParts[1] ?? namespace;
  const remotePort = Number(parsed.port);
  if (
    !service
    || !Number.isSafeInteger(remotePort)
    || remotePort < 1
    || remotePort > 65_535
    || (hostParts.length > 2 && hostParts[2] !== 'svc')
  ) {
    throw new Error(
      `The deployed Chirp workflow endpoint is not a cluster Service endpoint: ${endpoint}`,
    );
  }
  return startPortForward(`service/${service}`, remotePort, serviceNamespace);
}

async function snapshot(endpoint: string): Promise<{ readonly value: readonly unknown[]; readonly cursor: string }> {
  const response = await querySnapshot(endpoint, 'Post.homeTimeline', { limit: 50 });
  if (!Array.isArray(response.value)) throw new Error(`Chirp snapshot returned an invalid value: ${JSON.stringify(response)}`);
  return { value: response.value, cursor: stringField(response, 'cursor') };
}

async function querySnapshot(
  endpoint: string,
  query: string,
  input: object,
  requestHeaders: Readonly<Record<string, string>> = headers,
): Promise<Record<string, unknown>> {
  return postJson(`${endpoint}/__applik8s/v1/queries/${encodeURIComponent(query)}/snapshot`, { input }, requestHeaders);
}

async function waitForCommand(
  endpoint: string,
  cursor: string,
  operation = 'models.Post.create.v1',
  requestHeaders: Readonly<Record<string, string>> = headers,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 120_000;
  let last: Record<string, unknown> = {};
  while (Date.now() < deadline) {
    try {
      last = await postJson(`${endpoint}/__applik8s/v1/commands/${operation}/progress`, { cursor }, requestHeaders);
    } catch (cause) {
      last = { transientError: cause instanceof Error ? cause.message : String(cause) };
      await sleep(500);
      continue;
    }
    if (last.durableResult === 'succeeded') return last;
    if (last.durableResult === 'rejected') throw new Error(`Chirp command was rejected: ${JSON.stringify(last)}`);
    if (last.durableResult === 'failed') throw new Error(`Chirp command failed: ${JSON.stringify(last)}`);
    await sleep(500);
  }
  throw new Error(`Timed out waiting for Chirp command result: ${JSON.stringify(last)}`);
}

async function restartDeployment(name: string, targetNamespace = namespace): Promise<void> {
  await kubectl(['rollout', 'restart', `deployment/${name}`, '--namespace', targetNamespace]);
  await kubectl(['rollout', 'status', `deployment/${name}`, '--namespace', targetNamespace, '--timeout=300s']);
}

async function restartLogicalWorkload(name: string): Promise<void> {
  await restartDeployment(await deploymentForLogicalWorkload(name));
}

async function deploymentForLogicalWorkload(name: string): Promise<string> {
  const response = jsonObject((await kubectl(['get', 'deployments', '--namespace', namespace, '--output=json'])).stdout);
  const items = response.items;
  if (!Array.isArray(items)) throw new Error('Kubernetes returned no Deployment items for Chirp.');
  const deployments = items
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object' && !Array.isArray(item))
    .map((item) => {
      const metadata = objectField(item, 'metadata');
      const spec = objectField(item, 'spec');
      const template = objectField(spec, 'template');
      const templateMetadata = objectField(template, 'metadata');
      const annotations = templateMetadata.annotations;
      const members = annotations && typeof annotations === 'object' && !Array.isArray(annotations)
        ? Reflect.get(annotations, 'applik8s.dev/workload-members')
        : undefined;
      return {
        name: stringField(metadata, 'name'),
        members: typeof members === 'string' ? members.split(',').map((member) => member.trim()) : [],
      };
    });
  const matches = deployments.filter((deployment) => deployment.name === name || deployment.members.includes(name));
  if (matches.length !== 1) {
    throw new Error(`Expected one Deployment for logical Chirp workload ${name}, found ${JSON.stringify(matches.map((match) => match.name))}.`);
  }
  return matches[0]?.name as string;
}

async function createPostAndWait(endpoint: string, id: string, body: string, idempotencyKey: string): Promise<Record<string, unknown>> {
  const submission = await postJson(`${endpoint}/__applik8s/v1/commands/models.Post.create.v1/submit`, {
    input: { id, body, visibility: 'public' }, commandId: id, idempotencyKey,
  });
  expect(submission.durableResult).toBe('pending');
  return waitForCommand(endpoint, stringField(submission, 'progressCursor'));
}

async function waitForPost(endpoint: string, postId: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 60_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const current = await snapshot(endpoint);
      const found = current.value.find((value) => value !== null && typeof value === 'object' && Reflect.get(value, 'id') === postId);
      if (found && typeof found === 'object') return found as Record<string, unknown>;
      lastError = undefined;
    } catch (error) {
      // A rollout can reset an in-flight TCP connection after Kubernetes has
      // declared the replacement Deployment available. Retry within the same
      // bounded assertion deadline instead of making that transport race a
      // false data-loss signal.
      lastError = error;
    }
    await sleep(500);
  }
  throw new Error(`Authoritative Chirp requery never returned ${postId}${lastError instanceof Error ? `; last transport error: ${lastError.message}` : ''}.`);
}

async function analyticalProjectionCount(endpoint: string, partitionKey: string): Promise<number> {
  const query = `SELECT count() AS rows FROM chirp.post_analytics_hourly FINAL WHERE _applik8s_partition_key = '${partitionKey.replaceAll("'", "''")}' FORMAT JSONEachRow`;
  const response = await fetch(`${endpoint}/?query=${encodeURIComponent(query)}`, { method: 'POST' });
  const body = await response.text();
  if (!response.ok) throw new Error(`ClickHouse rejected the Chirp analytical projection query: ${body}`);
  return Number(jsonObject(body).rows);
}

async function waitForProjection(endpoint: string, partitionKey: string, rowsBefore: number): Promise<void> {
  const deadline = Date.now() + 60_000;
  let last = rowsBefore;
  while (Date.now() < deadline) {
    last = await analyticalProjectionCount(endpoint, partitionKey);
    if (last > rowsBefore) return;
    await sleep(500);
  }
  throw new Error(
    `ClickHouse projection partition ${partitionKey} did not advance beyond ${rowsBefore} rows; observed ${last}.`,
  );
}

async function waitForReactionProjection(endpoint: string, postId: string): Promise<void> {
  const query = `SELECT sum(delta) AS score FROM chirp.reaction_analytics_hourly FINAL WHERE postId = '${postId.replaceAll("'", "''")}' FORMAT JSONEachRow`;
  const deadline = Date.now() + 60_000;
  let last = '';
  while (Date.now() < deadline) {
    const response = await fetch(`${endpoint}/?query=${encodeURIComponent(query)}`, { method: 'POST' });
    last = await response.text();
    if (response.ok && Number(jsonObject(last).score) > 0) return;
    await sleep(500);
  }
  throw new Error(`ClickHouse reaction projection never observed ${postId}: ${last}`);
}

async function waitForTrendingPost(endpoint: string, postId: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  let last: Record<string, unknown> = {};
  while (Date.now() < deadline) {
    last = await postJson(`${endpoint}/__applik8s/v1/queries/Post.trending/snapshot`, { input: { limit: 50 } });
    const value = last.value;
    if (Array.isArray(value) && value.some((item) => item !== null && typeof item === 'object' && Reflect.get(item, 'id') === postId)) return;
    await sleep(500);
  }
  throw new Error(`The typed Post.trending query never returned ClickHouse-ranked post ${postId}: ${JSON.stringify(last)}`);
}

async function waitForEngagementBatch(
  endpoint: string,
  partitionKey: string,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 120_000;
  let last: Record<string, unknown> = {};
  while (Date.now() < deadline) {
    last = await querySnapshot(
      endpoint,
      'EngagementBatch.recentEngagementBatches',
      { limit: 100 },
    );
    const value = last.value;
    if (Array.isArray(value)) {
      const receipt = value.find(
        (candidate) =>
          candidate !== null
          && typeof candidate === 'object'
          && Reflect.get(candidate, 'partitionKey') === partitionKey,
      );
      if (receipt && typeof receipt === 'object') {
        return receipt as Record<string, unknown>;
      }
    }
    await sleep(500);
  }
  throw new Error(
    `The bounded EngagementBatch view never returned a frozen batch receipt for ${partitionKey}: ${JSON.stringify(last)}`,
  );
}

async function waitForInvalidation(endpoint: string, cursor: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('Chirp SSE timeout')), 60_000);
  try {
    const response = await fetch(`${endpoint}/__applik8s/v1/queries/Post.homeTimeline/subscribe`, {
      method: 'POST', headers, body: JSON.stringify({ input: { limit: 50 }, cursor }), signal: controller.signal,
    });
    if (!response.ok || !response.body) throw new Error(`Chirp SSE returned ${response.status}: ${await response.text()}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    for (;;) {
      const next = await reader.read();
      if (next.done) throw new Error('Chirp SSE ended before invalidation.');
      pending += decoder.decode(next.value, { stream: true });
      const frames = pending.split('\n\n');
      pending = frames.pop() ?? '';
      const frame = frames.find((candidate) => candidate.includes('event: invalidate'));
      if (frame) return frame;
    }
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

async function postJson(
  url: string,
  body: object,
  requestHeaders: Readonly<Record<string, string>> = headers,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, { method: 'POST', headers: requestHeaders, body: JSON.stringify(body) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} returned ${response.status}: ${text}`);
  return jsonObject(text);
}

async function startPortForward(resource: string, remotePort: number, targetNamespace = namespace): Promise<PortForward> {
  const context = process.env.APPLIK8S_E2E_CONTEXT;
  const args = [...(context ? ['--context', context] : []), 'port-forward', '--namespace', targetNamespace, resource, `0:${remotePort}`];
  const child = spawn('kubectl', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += String(chunk); });
  child.stderr.on('data', (chunk) => { output += String(chunk); });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const port = output.match(/Forwarding from 127\.0\.0\.1:(\d+)/)?.[1];
    if (port) return {
      endpoint: `http://127.0.0.1:${port}`,
      port: Number(port),
      async close() {
        if (child.exitCode === null) child.kill('SIGTERM');
        if (child.exitCode === null) await new Promise<void>((resolve) => child.once('exit', () => resolve()));
      },
    };
    if (child.exitCode !== null) throw new Error(`kubectl port-forward ${resource} exited: ${output}`);
    await sleep(100);
  }
  child.kill('SIGTERM');
  throw new Error(`Timed out starting kubectl port-forward ${resource}: ${output}`);
}

async function secretValue(targetNamespace: string, name: string, key: string): Promise<string> {
  const secret = jsonObject((await kubectl(['get', `secret/${name}`, '--namespace', targetNamespace, '--output=json'])).stdout);
  const encoded = stringField(objectField(secret, 'data'), key);
  const value = Buffer.from(encoded, 'base64').toString('utf8');
  if (!value) throw new Error(`Secret ${targetNamespace}/${name} key ${key} is empty.`);
  return value;
}

async function validateProjectionRebuildArtifacts(
  manifestReference: ProjectionRebuildResult['manifest'],
  generation: string,
): Promise<ProjectionRebuildEvidence> {
  const manifestKey = manifestReference.key;
  const config = jsonObject((await kubectl(['get', 'configmap/chirp-media', '--namespace', namespace, '--output=json'])).stdout);
  const data = objectField(config, 'data');
  const bucket = stringField(data, 'BUCKET_NAME');
  const bucketHost = stringField(data, 'BUCKET_HOST').replace(/^https?:\/\//, '').split(':')[0] ?? '';
  const bucketPort = Number(stringField(data, 'BUCKET_PORT'));
  const service = bucketHost.split('.')[0];
  const serviceNamespace = bucketHost.split('.')[1] || 'typekro-harbor-ceph';
  if (!service || !Number.isSafeInteger(bucketPort) || bucketPort < 1 || bucketPort > 65_535) {
    throw new Error(`ObjectBucketClaim chirp-media returned an invalid endpoint: ${JSON.stringify({ bucketHost, bucketPort })}`);
  }
  const [accessKeyId, secretAccessKey] = await Promise.all([
    secretValue(namespace, 'chirp-media', 'AWS_ACCESS_KEY_ID'),
    secretValue(namespace, 'chirp-media', 'AWS_SECRET_ACCESS_KEY'),
  ]);
  const forward = await startPortForward(`service/${service}`, bucketPort, serviceNamespace);
  const client = new S3Client({
    region: 'us-east-1', endpoint: forward.endpoint, forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
  try {
    const runtime = createS3ApplicationObjectStorageRuntime({
      store: manifestReference.store,
      provider: { kind: 's3', bucket, prefix: 'site', region: 'us-east-1', endpoint: forward.endpoint, forcePathStyle: true },
      client,
    });
    const manifestHead = await runtime.head(manifestKey);
    const manifestBytes = await runtime.get(manifestKey);
    if (!manifestHead || !manifestBytes) throw new Error(`Projection rebuild manifest ${manifestKey} is missing from object storage.`);
    const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');
    expect(manifestSha256).toBe(manifestHead.sha256.replace(/^sha256:/, ''));
    expect(manifestBytes.byteLength).toBe(manifestHead.size);
    const manifest = jsonObject(new TextDecoder().decode(manifestBytes));
    expect(manifest).toMatchObject({
      protocol: 'applik8s.online-projection-rebuild/v1alpha1',
      projection: 'home-timeline', stream: 'posts.timeline-changed.v1', generation, sourceKind: 'model-snapshot',
      sourceWatermark: expect.any(Number), segments: expect.any(Array),
    });
    const segments = manifest.segments;
    if (!Array.isArray(segments)) throw new Error(`Projection rebuild manifest ${manifestKey} has no segment list.`);
    const segmentSha256: string[] = [];
    for (const candidate of segments) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error(`Projection rebuild manifest ${manifestKey} contains an invalid segment reference.`);
      const reference = candidate as Record<string, unknown>;
      const key = stringField(reference, 'key');
      const bytes = await runtime.get(key);
      if (!bytes) throw new Error(`Projection rebuild segment ${key} is missing from object storage.`);
      const digest = createHash('sha256').update(bytes).digest('hex');
      expect(digest).toBe(stringField(reference, 'sha256').replace(/^sha256:/, ''));
      expect(bytes.byteLength).toBe(Number(reference.size));
      expect(jsonObject(new TextDecoder().decode(bytes))).toMatchObject({
        protocol: 'applik8s.online-projection-segment/v1alpha1',
        projection: 'home-timeline', stream: 'posts.timeline-changed.v1', generation,
      });
      segmentSha256.push(digest);
    }
    return {
      manifest: manifest as ProjectionRebuildEvidence['manifest'],
      manifestSha256,
      segmentSha256,
    };
  } finally {
    client.destroy();
    await forward.close();
  }
}

function jsonObject(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`Expected a JSON object, received ${value}.`);
  return parsed as Record<string, unknown>;
}

function objectField(value: Record<string, unknown>, field: string): Record<string, unknown> {
  const result = value[field];
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error(`Expected ${field} to be an object.`);
  return result as Record<string, unknown>;
}

function stringField(value: Record<string, unknown>, field: string): string {
  const result = value[field];
  if (typeof result !== 'string' || result.length === 0) throw new Error(`Expected ${field} to be a non-empty string.`);
  return result;
}

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap(collectStrings);
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Chirp live E2E setup did not complete.');
  return value;
}

async function collectRuntimeEvidence(
  endpoint: string,
  status: Record<string, unknown>,
  installation: Record<string, unknown>,
): Promise<NonNullable<typeof runtimeEvidence>> {
  const deploymentGraphPath = join(
    process.cwd(),
    'examples/chirp-start/.applik8s/deploy/typekro/application-deployment-graph.json',
  );
  const identity = await collectV06ArtifactIdentity(deploymentGraphPath);
  const bindings = objectField(objectField(installation, 'spec'), 'typekroArtifactBindings');
  const immutableReferences = collectStrings(bindings)
    .filter((value) => /@sha256:[a-f0-9]{64}$/.test(value))
    .sort();
  if (immutableReferences.length === 0) {
    throw new Error('Chirp installation contains no digest-pinned TypeKro artifact bindings.');
  }
  return {
    endpoint,
    status,
    artifactEvidence: { ...identity, immutableReferences },
  };
}

async function writeCompleteChirpEvidenceReceipt(): Promise<void> {
  const runtime = required(runtimeEvidence);
  const recovery = required(recoveryEvidence);
  const context = process.env.APPLIK8S_E2E_CONTEXT ?? 'orbstack';
  const completedAt = new Date().toISOString();
  const runtimeTest = 'runtime golden path';
  const recoveryTest = 'authoritative projection recovery';
  const restartTest = 'component restart recovery';
  const runtimeAssertions = [
    'ssr',
    'principal-derived-registration',
    'transactional-credential-link',
    'jetstream-command',
    'postgres-transactional-outbox',
    'valkey-generation-projection',
    'sse-invalidation',
    'authoritative-requery',
    'clickhouse-projection',
    'clickhouse-product-query',
    'frozen-microbatch-durable-receipt',
    'schema-complete-status',
    'harbor-digest-images',
    'declared-nodeport-exposure',
  ];
  const recoveryAssertions = [
    'valkey-complete-loss',
    'degraded-query-fails-closed',
    'postgres-authoritative-snapshot',
    'foreground-commit-during-rebuild',
    'atomic-generation-publication',
    'rebuild-idempotent-retry',
    's3-checksummed-rebuild-evidence',
  ];
  const restartAssertions = [
    'command-processor-restart-recovery',
    'online-projection-restart-recovery',
    'query-gateway-restart-recovery',
    'application-host-restart-recovery',
    'harbor-component-restart-recovery',
    'acknowledged-work-retained',
  ];
  const assertionEvidence = createV06AssertionEvidence([
    ...runtimeAssertions.map((assertion) => ({ assertion, test: runtimeTest })),
    ...recoveryAssertions.map((assertion) => ({ assertion, test: recoveryTest })),
    ...restartAssertions.map((assertion) => ({ assertion, test: restartTest })),
  ], evidenceRunId);
  const deploymentGraphPath = join(process.cwd(), 'examples/chirp-start/.applik8s/deploy/typekro/application-deployment-graph.json');
  const [git, cluster, installation, artifacts] = await Promise.all([
    collectV06GitIdentity(),
    collectV06ClusterIdentity(context),
    collectV06InstallationIdentity({
      context,
      resource: `chirpinstallation/${installationName}`,
      namespace: controlPlaneNamespace,
    }),
    collectV06ArtifactIdentity(deploymentGraphPath),
  ]);
  await writeV06EvidenceReceipt(evidencePath, {
    suite: 'chirp',
    run: { id: evidenceRunId, startedAt: evidenceStartedAt, completedAt },
    candidate: { git, cluster, installation, artifacts },
    environment: { context, namespace, controlPlaneNamespace, installation: installationName, endpoint: runtime.endpoint },
    assertionEvidence,
    installationStatus: runtime.status,
    artifactEvidence: runtime.artifactEvidence,
    onlineProjectionRecovery: {
      ...recovery.result,
      manifestSha256: recovery.evidence.manifestSha256,
      segmentSha256: recovery.evidence.segmentSha256,
      segmentCount: recovery.evidence.manifest.segments.length,
      sourceKind: recovery.evidence.manifest.sourceKind,
    },
  });
}
