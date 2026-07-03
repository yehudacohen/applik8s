import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildImplicitRuntimeImage } from '@applik8s/compiler';
import type { OperatorManifest } from '@applik8s/core';
import { typeKroRuntimeBootstrap } from 'typekro';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { assertExpectedKubectlContext, describeLive, docker, exec, formatSettledOutput, kubectl, sleep } from './live-e2e-helpers';

const namespace = process.env.APPLIK8S_E2E_NAMESPACE ?? `applik8s-guestbook-${process.pid}`;
const runtimeNamespace = process.env.APPLIK8S_E2E_TYPEKRO_RUNTIME_NAMESPACE ?? 'applik8s-typekro-runtime';
const group = `guestbook${process.pid}.applik8s.dev`;
const operatorName = 'guestbook-renderer';
const stackName = `guestbook-${process.pid}`;
const stackKind = `GuestBook${process.pid}`;
const bookName = 'main';
const expectedTitle = 'Typed GuestBook';
const expectedDescription = 'This page was rendered from live GuestBookEntry CRDs.';

let tempDir: string | undefined;
let outDir: string | undefined;

describeLive('live TypeKro GuestBook tutorial', () => {
  beforeAll(async () => {
    await assertExpectedKubectlContext();

    await docker(['build', '--file', 'Dockerfile.operator-host', '--tag', 'ghcr.io/applik8s/applik8s-operator-host:dev', '.'], process.cwd());
    await ensureKroRuntime();
    await ensureNamespace(namespace);

    tempDir = await mkdtemp(join(tmpdir(), 'applik8s-guestbook-'));
    outDir = join(tempDir, 'dist');
    const entrypoint = join(tempDir, 'guestbook-live.ts');
    await writeFile(entrypoint, liveEntrypointSource());
    setBuildTimeExampleEnv();

    await exec('bun', ['run', 'applik8s', 'build', entrypoint, '--typekro', '--composition-name', 'guestBookStack', '--out-dir', outDir], process.cwd());

    for (const manifestPath of await nestedOperatorManifestPaths()) {
      const image = await buildImplicitRuntimeImage({ manifest: await readOperatorManifest(manifestPath) });
      if (!image.ok) {
        throw new Error(image.error.message);
      }
    }
  }, 720_000);

  afterAll(async () => {
    if (process.env.APPLIK8S_E2E_LIVE === '1') {
      await kubectl(['delete', 'namespace', namespace, '--ignore-not-found=true', '--wait=false']);
      await kubectl(['delete', 'resourcegraphdefinition', stackName, '--ignore-not-found=true', '--wait=false']);
      await kubectl(['delete', 'crd', `guestbooks.${group}`, '--ignore-not-found=true', '--wait=false']);
      await kubectl(['delete', 'crd', `guestbookentries.${group}`, '--ignore-not-found=true', '--wait=false']);
      await kubectl(['delete', 'crd', `guestbookpageviewbuckets.${group}`, '--ignore-not-found=true', '--wait=false']);
    }
    if (tempDir && process.env.APPLIK8S_KEEP_TMP !== '1') {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('renders a website from cached typed GuestBookEntry CRD indexes', async () => {
    await runGeneratedTypeKroApplyScript();

    await kubectl(['wait', `crd/guestbooks.${group}`, '--for=condition=Established', '--timeout=90s']);
    await kubectl(['wait', `crd/guestbookentries.${group}`, '--for=condition=Established', '--timeout=90s']);
    await kubectl(['wait', `crd/guestbookpageviewbuckets.${group}`, '--for=condition=Established', '--timeout=90s']);
    await rolloutStatusWithDiagnostics(operatorName);
    await waitForGuestBookPhase('Rendered');
    await rolloutStatusWithDiagnostics(`${bookName}-server-index`);
    await rolloutStatusWithDiagnostics(`${bookName}-server-indexer`);
    await rolloutStatusWithDiagnostics(`${bookName}-server`);
    await rolloutStatusWithDiagnostics('page-view-stats-aggregate');

    expect(await serverPageViewBucketVerbs()).toBe('create get patch');

    const html = await waitForRenderedHtml();
    expect(html).toContain(expectedTitle);
    expect(html).toContain(expectedDescription);
    expect(html).toContain('Ada');
    expect(html).toContain('Typed reads make CRDs feel like application data.');
    expect(html).toContain('Grace');
    expect(html).toContain('The generated server rendered this page from a cached typed index.');
    await waitForPageViewBucketObserved();
    await waitForGuestBookPageViewStats(1);

    await waitForGuestBookEntryCount(2);
    const status = await guestBookStatus();
    expect(status.phase).toBe('Rendered');
    expect(status.url).toBe(`http://${bookName}-svc.${namespace}.svc.cluster.local/`);
    expect(status.entryCount).toBe(2);
    expect(status.pageViewsTotal).toBeGreaterThanOrEqual(1);
    expect(status.pageViewsLastMinute).toBeGreaterThanOrEqual(1);
    expect(status.contentHash).toMatch(/^[a-f0-9]{8}$/);
    expect(status.message).toContain('cached typed index');

    expect(await guestBookEntryPhase(`${bookName}-ada`)).toBe('Published');
    expect((await kubectl(['get', `deployment/${bookName}-server`, '--namespace', namespace, '--output=jsonpath={.spec.template.spec.volumes[0].configMap.name}'])).stdout.trim()).toBe(`${bookName}-server-source`);
    expect((await kubectl(['get', `service/${bookName}-svc`, '--namespace', namespace, '--output=jsonpath={.spec.ports[0].port}'])).stdout.trim()).toBe('80');

    await submitEntryThroughWebForm();
    const updatedHtml = await waitForRenderedHtml('A web form created this GuestBookEntry CRD.');
    expect(updatedHtml).toContain('Katherine');
    expect(updatedHtml).toContain('<time datetime=');
    expect(updatedHtml).toContain('Page 1 of');
    expect(updatedHtml.indexOf('Katherine')).toBeLessThan(updatedHtml.indexOf('Grace'));
    await waitForGuestBookEntryCount(3);
    expect(await guestBookStatus()).toMatchObject({ phase: 'Rendered', entryCount: 3 });

    await createGuestBookEntry(`${bookName}-link-rejected`, 'Spammer', 'Visit http://example.test for a surprise.');
    await waitForGuestBookEntryStatus(`${bookName}-link-rejected`, { phase: 'Rejected', reason: 'links-disabled' });
    await createGuestBookEntry(`${bookName}-katherine-duplicate`, 'Katherine', 'A web form created this GuestBookEntry CRD.', {
      'guestbook.applik8s.dev/fingerprint': fingerprintFor(`${bookName}\nKatherine\nA web form created this GuestBookEntry CRD.`),
    });
    await waitForGuestBookEntryStatus(`${bookName}-katherine-duplicate`, { phase: 'Rejected', reason: 'duplicate' });
    await waitForGuestBookEntryCount(3);
    expect(await guestBookStatus()).toMatchObject({ phase: 'Rendered', entryCount: 3 });
    expect(await waitForRenderedHtml('A web form created this GuestBookEntry CRD.')).not.toContain('Visit http://example.test for a surprise.');
  }, 360_000);
});

async function ensureKroRuntime(): Promise<void> {
  try {
    await kubectl(['get', 'crd/resourcegraphdefinitions.kro.run']);
    return;
  } catch {
    await ensureNamespace(runtimeNamespace);
    const bootstrap = typeKroRuntimeBootstrap({ namespace: runtimeNamespace, kroVersion: '0.9.0' });
    const factory = bootstrap.factory('direct', { namespace: runtimeNamespace, waitForReady: true, timeout: 300_000 });
    await factory.deploy({ namespace: runtimeNamespace });
    await kubectl(['wait', 'crd/resourcegraphdefinitions.kro.run', '--for=condition=Established', '--timeout=180s']);
  }
}

async function ensureNamespace(name: string): Promise<void> {
  try {
    await kubectl(['get', 'namespace', name]);
  } catch {
    await kubectl(['create', 'namespace', name]);
  }
}

async function nestedOperatorManifestPaths(): Promise<readonly string[]> {
  const manifestPath = join(requiredOutDir(), 'typekro', 'typekro-composition.json');
  // typecast: composition bundle JSON is generated by applik8s; this test validates only the operator manifest references it needs.
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { readonly spec?: { readonly operators?: readonly { readonly manifest?: string }[] } };
  const paths = manifest.spec?.operators?.map((operator) => operator.manifest).filter((path): path is string => typeof path === 'string') ?? [];
  if (paths.length === 0) {
    throw new Error(`TypeKro composition manifest did not reference nested operator manifests: ${manifestPath}`);
  }
  return paths;
}

async function readOperatorManifest(path: string): Promise<OperatorManifest> {
  // typecast: nested operator manifest JSON is generated by the compiler and consumed immediately by the runtime image builder.
  return JSON.parse(await readFile(path, 'utf8')) as OperatorManifest;
}

async function runGeneratedTypeKroApplyScript(): Promise<void> {
  await exec('sh', [join(requiredOutDir(), 'typekro', 'apply.sh')], process.cwd());
}

async function rolloutStatusWithDiagnostics(deployment: string): Promise<void> {
  try {
    await waitForDeploymentExists(deployment);
    await kubectl(['rollout', 'status', `deployment/${deployment}`, '--namespace', namespace, '--timeout=180s']);
  } catch (cause) {
    const diagnostics = await Promise.allSettled([
      kubectl(['describe', `deployment/${deployment}`, '--namespace', namespace]),
      kubectl(['get', 'pods', '--namespace', namespace, '--selector', `app.kubernetes.io/name=${deployment}`, '--output=wide']),
      kubectl(['describe', 'pods', '--namespace', namespace, '--selector', `app.kubernetes.io/name=${deployment}`]),
      kubectl(['logs', '--namespace', namespace, '--selector', `app.kubernetes.io/name=${deployment}`, '--all-containers=true', '--tail=300']),
      kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
    ]);
    throw new Error(`${cause instanceof Error ? cause.message : 'Rollout failed.'}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
  }
}

async function waitForDeploymentExists(deployment: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 180_000) {
    try {
      await kubectl(['get', `deployment/${deployment}`, '--namespace', namespace]);
      return;
    } catch {
      await sleep(2_000);
    }
  }
  throw new Error(`Timed out waiting for deployment/${deployment} to be created in namespace ${namespace}.`);
}

async function waitForGuestBookPhase(phase: string): Promise<void> {
  try {
    await kubectl(['wait', `guestbooks.${group}/${bookName}`, '--namespace', namespace, `--for=jsonpath={.status.phase}=${phase}`, '--timeout=180s']);
  } catch (cause) {
    const diagnostics = await Promise.allSettled([
      kubectl(['get', `guestbooks.${group}/${bookName}`, '--namespace', namespace, '--output=yaml']),
      kubectl(['logs', '--namespace', namespace, '--selector', `app.kubernetes.io/name=${operatorName}`, '--all-containers=true', '--tail=500']),
      kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
    ]);
    throw new Error(`${cause instanceof Error ? cause.message : `Expected GuestBook phase ${phase}.`}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
  }
}

async function waitForRenderedHtml(expectedText = 'Typed reads make CRDs feel like application data.'): Promise<string> {
  const started = Date.now();
  let lastOutput = '<missing>';
  const portForward = await startPortForward(['--namespace', namespace, `service/${bookName}-svc`, '0:80']);
  try {
    while (Date.now() - started < 180_000) {
      try {
        const response = await fetch(`${portForward.endpoint}/`, { headers: { 'cache-control': 'no-store' } });
        lastOutput = await response.text();
        if (response.ok && lastOutput.includes(expectedText)) {
          return lastOutput;
        }
      } catch (error) {
        lastOutput = error instanceof Error ? error.message : String(error);
      }
      await sleep(2_000);
    }
  } finally {
    await portForward.close();
  }
  const diagnostics = await Promise.allSettled([
    kubectl(['get', `configmap/${bookName}-html`, '--namespace', namespace, '--ignore-not-found=true', '--output=yaml']),
    kubectl(['get', `configmap/${bookName}-server-source`, '--namespace', namespace, '--ignore-not-found=true', '--output=yaml']),
    kubectl(['get', `guestbooks.${group}/${bookName}`, '--namespace', namespace, '--ignore-not-found=true', '--output=yaml']),
    kubectl(['logs', '--namespace', namespace, '--selector', `app.kubernetes.io/name=${bookName}-server`, '--all-containers=true', '--tail=300']),
    kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
  ]);
  throw new Error(`Expected generated GuestBook server HTML to contain ${expectedText}, got ${lastOutput}.\n${diagnostics.map(formatSettledOutput).join('\n')}`);
}

async function submitEntryThroughWebForm(): Promise<void> {
  const portForward = await startPortForward(['--namespace', namespace, `service/${bookName}-svc`, '0:80']);
  try {
    const form = new URLSearchParams({ author: 'Katherine', message: 'A web form created this GuestBookEntry CRD.' });
    const response = await fetch(`${portForward.endpoint}/entries`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    expect(response.status).toBe(303);
    await waitForSubmittedEntry();
  } finally {
    await portForward.close();
  }
}

async function createGuestBookEntry(name: string, author: string, message: string, labels: Readonly<Record<string, string>> = {}): Promise<void> {
  const manifestPath = join(requiredTempDir(), `${name}.json`);
  await writeFile(manifestPath, JSON.stringify({
    apiVersion: `${group}/v1alpha1`,
    kind: 'GuestBookEntry',
    metadata: {
      name,
      namespace,
      labels: {
        'guestbook.applik8s.dev/book': bookName,
        ...labels,
      },
    },
    spec: { guestbook: bookName, author, message },
  }));
  await kubectl(['apply', '--filename', manifestPath]);
}

async function waitForSubmittedEntry(): Promise<void> {
  const started = Date.now();
  let lastOutput = '<missing>';
  while (Date.now() - started < 60_000) {
    lastOutput = (await kubectl(['get', `guestbookentries.${group}`, '--namespace', namespace, '--selector', `guestbook.applik8s.dev/book=${bookName}`, '--output=jsonpath={.items[*].spec.author}'])).stdout;
    if (lastOutput.split(/\s+/).includes('Katherine')) {
      return;
    }
    await sleep(1_000);
  }
  throw new Error(`Expected submitted GuestBookEntry author Katherine, got ${lastOutput}.`);
}

async function waitForGuestBookEntryCount(expected: number): Promise<void> {
  const started = Date.now();
  let lastOutput = '<missing>';
  while (Date.now() - started < 120_000) {
    lastOutput = (await kubectl(['get', `guestbooks.${group}/${bookName}`, '--namespace', namespace, '--output=jsonpath={.status.entryCount}'])).stdout.trim();
    if (lastOutput === String(expected)) {
      return;
    }
    await sleep(1_000);
  }
  throw new Error(`Expected GuestBook status.entryCount ${expected}, got ${lastOutput}.`);
}

async function waitForGuestBookPageViewStats(minimum: number): Promise<void> {
  const started = Date.now();
  let lastStatus: Awaited<ReturnType<typeof guestBookStatus>> | undefined;
  while (Date.now() - started < 120_000) {
    lastStatus = await guestBookStatus();
    if ((lastStatus.pageViewsTotal ?? 0) >= minimum && (lastStatus.pageViewsLastMinute ?? 0) >= minimum) {
      return;
    }
    await sleep(1_000);
  }
  throw new Error(`Expected GuestBook page views >= ${minimum}, got ${JSON.stringify(lastStatus)}.`);
}

async function waitForPageViewBucketObserved(): Promise<void> {
  const started = Date.now();
  let lastOutput = '<missing>';
  while (Date.now() - started < 120_000) {
    lastOutput = (await kubectl(['get', `guestbookpageviewbuckets.${group}`, '--namespace', namespace, '--selector', `guestbook.applik8s.dev/book=${bookName}`, '--output=jsonpath={.items[*].status.observedCount}'])).stdout.trim();
    if (lastOutput.split(/\s+/).some((value) => Number.parseInt(value, 10) > 0)) {
      return;
    }
    await sleep(1_000);
  }
  throw new Error(`Expected an observed GuestBookPageViewBucket count, got ${lastOutput}.`);
}

async function waitForGuestBookEntryStatus(name: string, expected: { readonly phase: string; readonly reason?: string }): Promise<void> {
  const started = Date.now();
  let lastStatus: GuestBookEntryStatus | undefined;
  while (Date.now() - started < 120_000) {
    lastStatus = await guestBookEntryStatus(name);
    if (lastStatus.phase === expected.phase && (!expected.reason || lastStatus.reason === expected.reason)) {
      return;
    }
    await sleep(1_000);
  }
  throw new Error(`Expected GuestBookEntry ${name} status ${JSON.stringify(expected)}, got ${JSON.stringify(lastStatus)}.`);
}

interface PortForward {
  readonly endpoint: string;
  close(): Promise<void>;
}

async function startPortForward(args: readonly string[]): Promise<PortForward> {
  const child = spawn('kubectl', ['port-forward', ...args], { cwd: process.cwd(), env: process.env });
  let output = '';
  const endpoint = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out starting kubectl port-forward.\n${output}`)), 30_000);
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/Forwarding from 127\.0\.0\.1:(\d+) -> (?:80|8080)/);
      if (match?.[1]) {
        clearTimeout(timeout);
        resolve(`http://127.0.0.1:${match[1]}`);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`kubectl port-forward exited with code ${code}.\n${output}`));
    });
  });
  return { endpoint, close: () => closePortForward(child) };
}

async function closePortForward(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null) {
        child.kill('SIGKILL');
      }
      resolve();
    }, 5_000);
  });
}

async function serverPageViewBucketVerbs(): Promise<string> {
  return (await kubectl([
    'get',
    `role/${bookName}-web`,
    '--namespace',
    namespace,
    `--output=jsonpath={.rules[?(@.resources[0]=="guestbookpageviewbuckets")].verbs[*]}`,
  ])).stdout.trim();
}

async function guestBookStatus(): Promise<{ readonly phase: string; readonly url: string; readonly entryCount: number; readonly pageViewsTotal?: number; readonly pageViewsLastMinute?: number; readonly contentHash: string; readonly message: string }> {
  const raw = (await kubectl(['get', `guestbooks.${group}/${bookName}`, '--namespace', namespace, '--output=jsonpath={.status}'])).stdout.trim();
  // typecast: status JSON is read back from the generated CRD instance this test just waited on.
  return JSON.parse(raw) as { readonly phase: string; readonly url: string; readonly entryCount: number; readonly pageViewsTotal?: number; readonly pageViewsLastMinute?: number; readonly contentHash: string; readonly message: string };
}

async function guestBookEntryPhase(name: string): Promise<string> {
  return (await kubectl(['get', `guestbookentries.${group}/${name}`, '--namespace', namespace, '--output=jsonpath={.status.phase}'])).stdout.trim();
}

interface GuestBookEntryStatus {
  readonly phase?: string;
  readonly reason?: string;
}

async function guestBookEntryStatus(name: string): Promise<GuestBookEntryStatus> {
  const raw = (await kubectl(['get', `guestbookentries.${group}/${name}`, '--namespace', namespace, '--output=jsonpath={.status}'])).stdout.trim();
  // typecast: status JSON is read back from the generated CRD instance this test just created.
  return JSON.parse(raw || '{}') as GuestBookEntryStatus;
}

function fingerprintFor(input: string): string {
  let hash = 2166136261;
  for (const character of input) {
    hash ^= character.charCodeAt(0);
    hash = (hash * 16777619) >>> 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function requiredTempDir(): string {
  if (!tempDir) {
    throw new Error('GuestBook e2e temp directory was not initialized.');
  }
  return tempDir;
}

function requiredOutDir(): string {
  if (!outDir) {
    throw new Error('GuestBook e2e output directory was not initialized.');
  }
  return outDir;
}

function liveEntrypointSource(): string {
  return `export { guestBookStack, guestBookRenderer } from ${JSON.stringify(join(process.cwd(), 'examples/guestbook.ts'))};
`;
}

function setBuildTimeExampleEnv(): void {
  process.env.APPLIK8S_GUESTBOOK_API_GROUP = group;
  process.env.APPLIK8S_GUESTBOOK_NAMESPACE = namespace;
  process.env.APPLIK8S_GUESTBOOK_OPERATOR_NAME = operatorName;
  process.env.APPLIK8S_GUESTBOOK_STACK_NAME = stackName;
  process.env.APPLIK8S_GUESTBOOK_STACK_KIND = stackKind;
  process.env.APPLIK8S_GUESTBOOK_BOOK_NAME = bookName;
  process.env.APPLIK8S_GUESTBOOK_TITLE = expectedTitle;
  process.env.APPLIK8S_GUESTBOOK_DESCRIPTION = expectedDescription;
}
