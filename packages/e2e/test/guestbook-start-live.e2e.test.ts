import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  assertExpectedKubectlContext,
  describeLive,
  exec,
  formatSettledOutput,
  kubectl,
  sleep,
} from './live-e2e-helpers';

const applicationName = process.env.APPLIK8S_E2E_GUESTBOOK_NAME ?? `guestbook-start-live-${process.pid}`;
const namespace = process.env.APPLIK8S_E2E_GUESTBOOK_NAMESPACE ?? `applik8s-v06-guestbook-${process.pid}`;
const exampleRoot = join(process.cwd(), 'examples/guestbook-start');
const applicationEntrypoint = join(exampleRoot, 'src/application.ts');
const hostName = `${applicationName}-web`;
const operatorName = 'guest-book-entry-controller';
const cursorSecretName = `${hostName}-gateway-cursor`;
const publishedMessage = `Generated GuestBook golden path ${Date.now()}`;
const restartMessage = `Restart-resumed GuestBook golden path ${Date.now()}`;

let composition: DeletableComposition | undefined;
let instanceApplied = false;
let proofComplete = false;
let emptyCrdRecoveryUsed = false;

describeLive('v0.6 GuestBook Start golden path on OrbStack', () => {
  beforeAll(async () => {
    await assertExpectedKubectlContext();
    await kubectl(['get', 'crd/resourcegraphdefinitions.kro.run']);
    process.env.APPLIK8S_APPLICATION_NAME = applicationName;
    process.env.APPLIK8S_NAMESPACE = namespace;
    await exec('bun', ['run', 'build:packages'], process.cwd());
    const moduleUrl = `${pathToFileURL(applicationEntrypoint).href}?live=${Date.now()}`;
    // static-import-exception: environment-scoped loading is required; typecast: the repository fixture is narrowed to its lifecycle-only export.
    const loaded = await import(/* @vite-ignore */ moduleUrl) as {
      readonly app?: { readonly composition?: DeletableComposition };
    };
    composition = loaded.app?.composition;
    if (!composition) throw new Error('GuestBook Start example did not expose its TypeKro composition.');
    await exec('bun', ['run', 'deploy:local'], exampleRoot);
    instanceApplied = true;
  }, 600_000);

  afterAll(async () => {
    let cleanupFailure: unknown;
    try {
      await deleteApplicationThroughTypeKro();
      await ensureGeneratedCrdDeletionCompletes();
      await kubectl([
        'delete',
        'guestbookentries.guestbook.applik8s.dev',
        '--all',
        '--namespace',
        namespace,
        '--ignore-not-found=true',
        '--wait=true',
        '--timeout=60s',
      ]);
      await kubectl([
        'delete',
        `secret/${cursorSecretName}`,
        '--namespace',
        namespace,
        '--ignore-not-found=true',
        '--wait=true',
        '--timeout=60s',
      ]);
      await deleteNamespaceAndWait();
      if (proofComplete) await writeEvidenceReceipt();
    } catch (cause) {
      cleanupFailure = cause;
    } finally {
      delete process.env.APPLIK8S_APPLICATION_NAME;
      delete process.env.APPLIK8S_NAMESPACE;
    }
    if (cleanupFailure) throw cleanupFailure;
  }, 720_000);

  it('runs browser-shaped commands through Kubernetes reconciliation and resumable invalidation', async () => {
    try {
      await waitForDeployment(hostName, 600_000);
      await waitForDeployment(operatorName, 600_000);
      let forward = await startPortForward(`service/${hostName}`, 3000);
      try {
        await expect(waitForJson(
          `${forward.endpoint}/__applik8s/v1/readyz`,
          {},
          (value) => value.ready === true,
        )).resolves.toMatchObject({ ready: true });

        const initial = await snapshot(forward.endpoint);
        const firstInvalidation = waitForSseInvalidation(forward.endpoint, initial.cursor);
        const created = await createEntry(forward.endpoint, 'Codex E2E', publishedMessage, 'published-once');
        expect(created.reconciliation).toMatch(/notObserved|progressing|ready/);
        await firstInvalidation;
        const published = await waitForPublished(forward.endpoint, publishedMessage);
        expect(published).toMatchObject({ author: 'Codex E2E', message: publishedMessage });

        const rejectedInitial = await snapshot(forward.endpoint);
        const rejectionInvalidation = waitForSseInvalidation(forward.endpoint, rejectedInitial.cursor);
        const rejected = await createEntry(
          forward.endpoint,
          'Codex E2E',
          'Links are rejected: https://example.invalid',
          'rejected-once',
        );
        await rejectionInvalidation;
        await waitForEntryPhase(rejected.output.identity, 'Rejected');
        expect((await snapshot(forward.endpoint)).value).not.toEqual(
          expect.arrayContaining([expect.objectContaining({ id: rejected.output.identity })]),
        );

        const html = await fetch(forward.endpoint).then(async (response) => {
          const value = await response.text();
          if (!response.ok) throw new Error(`GuestBook SSR returned ${response.status}: ${value}`);
          return value;
        });
        expect(html).toContain(publishedMessage);

        const beforeRestart = await snapshot(forward.endpoint);
        await forward.close();
        await restartDeployment(hostName);
        await restartDeployment(operatorName);
        forward = await startPortForward(`service/${hostName}`, 3000);
        await waitForJson(
          `${forward.endpoint}/__applik8s/v1/readyz`,
          {},
          (value) => value.ready === true,
        );
        const resumedInvalidation = waitForSseInvalidation(forward.endpoint, beforeRestart.cursor);
        await createEntry(forward.endpoint, 'Restart E2E', restartMessage, 'restart-once');
        await resumedInvalidation;
        await expect(waitForPublished(forward.endpoint, restartMessage)).resolves.toMatchObject({
          author: 'Restart E2E',
          message: restartMessage,
        });
        proofComplete = true;
      } finally {
        await forward.close();
      }
    } catch (cause) {
      const diagnostics = await Promise.allSettled([
        kubectl(['get', 'pods,deployments,services,guestbookentries', '--namespace', namespace, '--output=wide']),
        kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
        kubectl(['logs', '--namespace', namespace, `deployment/${hostName}`, '--all-containers=true', '--tail=500']),
        kubectl(['logs', '--namespace', namespace, `deployment/${operatorName}`, '--all-containers=true', '--tail=500']),
      ]);
      throw new Error(`${cause instanceof Error ? cause.message : String(cause)}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
    }
  }, 900_000);
});

interface DeletableComposition {
  factory(mode: 'kro', options: {
    readonly namespace: string;
    readonly waitForReady: boolean;
    readonly timeout: number;
  }): {
    getInstances(): Promise<readonly { readonly metadata?: { readonly name?: string } }[]>;
    deleteInstance(name: string): Promise<void>;
    dispose(): Promise<void>;
  };
}

interface PortForward {
  readonly endpoint: string;
  close(): Promise<void>;
}

interface Snapshot {
  readonly value: readonly PublishedEntry[];
  readonly cursor: string;
}

interface PublishedEntry {
  readonly id: string;
  readonly author: string;
  readonly message: string;
  readonly publishedAt: string;
}

interface CreatedEntry {
  readonly reconciliation: string;
  readonly output: {
    readonly identity: string;
    readonly value: unknown;
    readonly revision?: string;
  };
}

async function waitForDeployment(name: string, timeout: number): Promise<void> {
  await waitForResource(`deployment/${name}`, Math.min(timeout, 120_000));
  await kubectl([
    'rollout',
    'status',
    `deployment/${name}`,
    '--namespace',
    namespace,
    `--timeout=${Math.floor(timeout / 1_000)}s`,
  ]);
}

async function waitForResource(resource: string, timeout: number): Promise<void> {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < timeout) {
    try {
      await kubectl(['get', resource, '--namespace', namespace]);
      return;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for ${resource} to be created. Last error: ${last}`);
}

async function restartDeployment(name: string): Promise<void> {
  await kubectl(['rollout', 'restart', `deployment/${name}`, '--namespace', namespace]);
  await waitForDeployment(name, 600_000);
}

async function snapshot(endpoint: string): Promise<Snapshot> {
  const response = await postJson(`${endpoint}/__applik8s/v1/queries/GuestBookEntry.published/snapshot`, {
    input: { guestbook: 'main', limit: 20 },
  });
  if (!Array.isArray(response.value) || typeof response.cursor !== 'string') {
    throw new Error(`Unexpected GuestBook snapshot: ${JSON.stringify(response)}`);
  }
  return {
    // typecast: the array guard above establishes the response collection; individual entries are validated by the assertions that consume them.
    value: response.value as readonly PublishedEntry[],
    cursor: response.cursor,
  };
}

async function createEntry(
  endpoint: string,
  author: string,
  message: string,
  idempotencyKey: string,
): Promise<CreatedEntry> {
  const commandId = `${idempotencyKey}-${Date.now()}`;
  const submission = await postJson(
    `${endpoint}/__applik8s/v1/commands/GuestBookEntry.create/submit`,
    {
      input: { guestbook: 'main', author, message },
      commandId,
      idempotencyKey,
    },
  );
  if (typeof submission.progressCursor !== 'string') {
    throw new Error(`Unexpected GuestBook command submission: ${JSON.stringify(submission)}`);
  }
  return waitForCommandResult(endpoint, submission.progressCursor);
}

async function waitForCommandResult(endpoint: string, cursor: string): Promise<CreatedEntry> {
  const value = await waitForJson(
    `${endpoint}/__applik8s/v1/commands/GuestBookEntry.create/progress`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cursor }),
    },
    (value) => value.durableResult === 'succeeded' && isCreatedOutput(value.output),
  );
  if (typeof value.reconciliation !== 'string' || !isCreatedOutput(value.output)) {
    throw new Error(`Unexpected GuestBook command result: ${JSON.stringify(value)}`);
  }
  return {
    reconciliation: value.reconciliation,
    output: value.output,
  };
}

async function waitForPublished(endpoint: string, message: string): Promise<PublishedEntry> {
  let found: PublishedEntry | undefined;
  await waitForJson(
    `${endpoint}/__applik8s/v1/queries/GuestBookEntry.published/snapshot`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: { guestbook: 'main', limit: 20 } }),
    },
    (value) => {
      if (!Array.isArray(value.value)) return false;
      // typecast: the live endpoint's public output schema validates this array before it reaches the test boundary.
      found = (value.value as readonly PublishedEntry[]).find((entry) => entry.message === message);
      return Boolean(found);
    },
  );
  if (!found) throw new Error(`Published GuestBook entry ${message} was not returned.`);
  return found;
}

async function waitForEntryPhase(name: string, phase: string): Promise<void> {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < 120_000) {
    try {
      last = (await kubectl([
        'get',
        `guestbookentries.guestbook.applik8s.dev/${name}`,
        '--namespace',
        namespace,
        '--output=jsonpath={.status.phase}',
      ])).stdout.trim();
      if (last === phase) return;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for GuestBookEntry ${name} phase ${phase}; last value: ${last}`);
}

async function waitForSseInvalidation(endpoint: string, cursor: string): Promise<void> {
  const controller = new AbortController();
  const response = await fetch(
    `${endpoint}/__applik8s/v1/queries/GuestBookEntry.published/subscribe`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: { guestbook: 'main', limit: 20 }, cursor }),
      signal: controller.signal,
    },
  );
  if (!response.ok || !response.body) {
    throw new Error(`GuestBook SSE returned ${response.status}: ${await response.text()}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  const deadline = Date.now() + 60_000;
  try {
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      const result = await Promise.race([
        reader.read().then((next) => ({ next })),
        sleep(remaining).then(() => ({ timeout: true })),
      ]);
      if ('timeout' in result) throw new Error('Timed out waiting for GuestBook SSE invalidation.');
      if (result.next.done) break;
      pending += decoder.decode(result.next.value, { stream: true });
      const frames = pending.split('\n\n');
      pending = frames.pop() ?? '';
      if (frames.some((frame) => frame.includes('event: invalidate'))) return;
    }
    throw new Error('GuestBook SSE ended before an invalidation was observed.');
  } finally {
    controller.abort();
    await reader.cancel().catch(() => undefined);
  }
}

async function postJson(url: string, body: object): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} returned ${response.status}: ${text}`);
  // typecast: endpoint-specific callers validate every field they consume from this JSON object.
  return JSON.parse(text) as Record<string, unknown>;
}

async function waitForJson(
  url: string,
  init: RequestInit,
  predicate: (value: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < 120_000) {
    try {
      const response = await fetch(url, init);
      last = await response.text();
      if (response.ok) {
        // typecast: the supplied predicate is the runtime validator for each polled endpoint response.
        const value = JSON.parse(last) as Record<string, unknown>;
        if (predicate(value)) return value;
      }
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for ${url}: ${last}`);
}

async function startPortForward(resource: string, remotePort: number): Promise<PortForward> {
  const child = spawn(
    'kubectl',
    ['--context', process.env.APPLIK8S_E2E_CONTEXT ?? 'orbstack', 'port-forward', '--namespace', namespace, resource, `0:${remotePort}`],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  child.stdout.on('data', (chunk) => { output += String(chunk); });
  child.stderr.on('data', (chunk) => { output += String(chunk); });
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    const match = output.match(/Forwarding from 127\.0\.0\.1:(\d+)/);
    if (match?.[1]) {
      return {
        endpoint: `http://127.0.0.1:${match[1]}`,
        async close() {
          if (child.exitCode !== null) return;
          if (!child.killed) child.kill('SIGTERM');
          await new Promise((resolve) => child.once('exit', resolve));
        },
      };
    }
    if (child.exitCode !== null) throw new Error(`kubectl port-forward ${resource} exited: ${output}`);
    await sleep(100);
  }
  child.kill('SIGTERM');
  throw new Error(`Timed out starting port-forward for ${resource}: ${output}`);
}

async function deleteApplicationThroughTypeKro(): Promise<void> {
  if (!composition || !instanceApplied) return;
  const factory = composition.factory('kro', {
    namespace,
    waitForReady: true,
    timeout: 600_000,
  });
  try {
    const names = (await factory.getInstances())
      .map((instance) => instance.metadata?.name)
      .filter((name): name is string => Boolean(name));
    if (!names.includes(applicationName)) {
      throw new Error(`Expected GuestBook TypeKro instance ${namespace}/${applicationName}, found ${JSON.stringify(names)}.`);
    }
    await factory.deleteInstance(applicationName);
    instanceApplied = false;
  } finally {
    await factory.dispose();
  }
}

async function deleteNamespaceAndWait(): Promise<void> {
  if (!namespace.startsWith('applik8s-v06-guestbook-')) {
    throw new Error(`Refusing cleanup for non-disposable GuestBook namespace ${namespace}.`);
  }
  await kubectl(['delete', `namespace/${namespace}`, '--ignore-not-found=true', '--wait=true', '--timeout=300s']);
}

async function ensureGeneratedCrdDeletionCompletes(): Promise<void> {
  const plural = `${applicationName.toLowerCase().replaceAll(/[^a-z0-9]/g, '')}s`;
  const crdName = `${plural}.${applicationName}.applik8s.dev`;
  const started = Date.now();
  let crd: Record<string, unknown> | undefined;
  while (Date.now() - started < 30_000) {
    try {
      // typecast: the generated CRD response is narrowed to deletion metadata before any recovery action.
      crd = JSON.parse((await kubectl(['get', `crd/${crdName}`, '--output=json'])).stdout) as Record<string, unknown>;
    } catch {
      return;
    }
    await sleep(1_000);
  }
  const metadata = crd?.metadata;
  if (!metadata || typeof metadata !== 'object' || typeof Reflect.get(metadata, 'deletionTimestamp') !== 'string') {
    throw new Error(`Generated GuestBook CRD ${crdName} remained after TypeKro cleanup without a deletion timestamp.`);
  }
  const rgdStillExists = await kubectl(['get', `resourcegraphdefinition.kro.run/${applicationName}`, '--output=name'])
    .then(() => true, () => false);
  if (rgdStillExists) throw new Error(`Refusing GuestBook CRD recovery while ResourceGraphDefinition/${applicationName} still exists.`);
  const remainingInstances = (await kubectl(['get', crdName, '--all-namespaces', '--output=name'])).stdout.trim();
  if (remainingInstances) throw new Error(`Refusing GuestBook CRD recovery because instances still exist: ${remainingInstances}`);
  await kubectl(['patch', `crd/${crdName}`, '--type=merge', '--patch', '{"metadata":{"finalizers":[]}}']);
  await kubectl(['wait', '--for=delete', `crd/${crdName}`, '--timeout=60s']);
  emptyCrdRecoveryUsed = true;
}

async function writeEvidenceReceipt(): Promise<void> {
  const directory = join(process.cwd(), '.applik8s-tmp/evidence/v0.6');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'guestbook-start.json'), `${JSON.stringify({
    schemaVersion: 1,
    suite: 'guestbook-start',
    completedAt: new Date().toISOString(),
    environment: {
      context: process.env.APPLIK8S_E2E_CONTEXT ?? 'unknown',
      namespace,
      application: applicationName,
    },
    assertions: [
      'vite-application-build',
      'application-host-ready',
      'operator-ready',
      'browser-command-submit',
      'kubernetes-create',
      'operator-publish',
      'operator-reject',
      'sse-invalidation',
      'authoritative-requery',
      'ssr-render',
      'restart-resume',
      'factory-delete',
      'runtime-created-data-cleanup',
      'namespace-removed',
      ...(emptyCrdRecoveryUsed ? ['orbstack-empty-crd-finalizer-recovery'] : []),
    ],
  }, null, 2)}\n`);
}

function isCreatedOutput(value: unknown): value is CreatedEntry['output'] {
  if (!value || typeof value !== 'object') return false;
  const identity = Reflect.get(value, 'identity');
  return typeof identity === 'string' && identity.length > 0;
}
