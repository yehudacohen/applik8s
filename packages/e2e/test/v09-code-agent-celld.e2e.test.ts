// typecast-file-boundary: Docker, model, and Celld transport envelopes are validated at this live qualification boundary.
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  app,
  installApplicationActorRuntimeResolver,
  type,
  withApplicationActorTurnAuthority,
} from '@applik8s/applik8s';
import {
  AgentHarness,
  CodeWorkspace,
  ProcessRunner,
  SourceRepository,
  codeAgent,
  createLocalCodeWorkspaceProvider,
  createLocalProcessRunnerProvider,
  createLocalSourceRepositoryProvider,
  type ApplicationAgentHarnessProvider,
} from '@applik8s/code-agent';
import {
  createCodeAgentProviderHttpServer,
  createHttpCodeAgentProviders,
  type ApplicationCodeAgentHttpServer,
} from '@applik8s/code-agent/http';
import { installApplicationCodeAgentRuntimeResolver } from '@applik8s/code-agent/runtime';
import { emitApplicationDeploymentGraph } from '@applik8s/compiler';
import type { ApplicationGraph } from '@applik8s/core';
import { applicationCelldRuntimeRelease } from '@applik8s/deployment-compiler';
import { OpenCodeHarnessProvider } from '@applik8s/dev/agent/opencode-code-harness';
import { createCelldApplicationActorRuntime } from '@applik8s/runtime-celld';
import { afterEach, describe, expect, it } from 'vitest';
import { createActorLiveAuthority } from './actor-live-authority.js';

const enabled = process.env.APPLIK8S_E2E_CELLD === '1' && process.env.APPLIK8S_E2E_OPENCODE === '1';
const run = promisify(execFile);
const celldImage = applicationCelldRuntimeRelease.image;
const seaweedImage = 'docker.io/chrislusf/seaweedfs@sha256:f898c91e42d7da5f4bb13f1efd424ff03ba85b420312eb929708a384e8a8b03d';
const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  const failures: string[] = [];
  while (cleanup.length > 0) {
    try { await cleanup.pop()?.(); } catch (cause) { failures.push(errorMessage(cause)); }
  }
  if (failures.length > 0) throw new Error(`code-agent Celld cleanup failed:\n${failures.join('\n')}`);
});

describe.skipIf(!enabled)('v0.9 Celld-backed codeAgent qualification', () => {
  it('preserves one run across an unknown commit outcome, Celld replacement, and OpenCode replacement', async () => {
    const suffix = `${process.pid}-${randomUUID().slice(0, 8)}`.toLowerCase();
    const applicationName = `code-agent-celld-${suffix}`;
    const network = `applik8s-v09-code-${suffix}`;
    const storage = `${network}-storage`;
    const nodeA = `${network}-a`;
    const nodeB = `${network}-b`;
    const image = `applik8s-v09-code-celld:${suffix}`;
    const bucket = `applik8s-v09-code-${suffix}`;
    const actorAuthorization = `actor-${randomUUID()}-${randomUUID()}`;
    const directory = await mkdtemp(join(tmpdir(), 'applik8s-v09-code-celld-'));
    const repositoryRoot = join(directory, 'repository-one');
    await mkdir(repositoryRoot);
    const before = 'export const distributed = "before";\n';
    const afterFirst = 'export const distributed = "after-first";\n';
    const afterSecond = 'export const distributed = "after-second";\n';
    await writeFile(join(repositoryRoot, 'app.ts'), before);
    cleanup.push(() => rm(directory, { recursive: true, force: true }));

    const artifact = await generatedCelldArtifact(directory, applicationName);
    await preflight({ network, image, containers: [storage, nodeA, nodeB] });
    await docker(['network', 'create', network]);
    cleanup.push(() => removeDockerNetwork(network));
    cleanup.push(() => removeDockerImage(image));
    for (const container of [storage, nodeA, nodeB]) cleanup.push(() => removeDockerContainer(container));
    await docker(['build', '--tag', image, '--file', String(artifact.sourceDescriptor.dockerfilePath), String(artifact.sourceDescriptor.contextPath)], 300_000);
    await docker([
      'run', '--detach', '--name', storage, '--network', network,
      '-p', '127.0.0.1::8333', '-e', `S3_BUCKET=${bucket}`,
      seaweedImage, 'mini', '-dir=/data', `-bucket=${bucket}`,
    ]);
    const storagePort = await publishedPort(storage, 8333);
    await waitForHttp(`http://127.0.0.1:${storagePort}/`, 90_000, () => true);
    await createS3Bucket(`http://127.0.0.1:${storagePort}`, bucket);
    await docker([
      'run', '--rm', '--network', network, ...storageEnvironment(), image,
      'deploy', '/app', '--bucket', `s3://${bucket}`, '--endpoint', `http://${storage}:8333`, '--region', 'us-east-1',
    ], 180_000);

    await startCelldNode({ name: nodeA, network, image, bucket, storage, actorAuthorization });
    await startCelldNode({ name: nodeB, network, image, bucket, storage, actorAuthorization });
    const portA = await publishedPort(nodeA, 8080);
    const portB = await publishedPort(nodeB, 8080);
    await Promise.all([
      waitForHttp(`http://127.0.0.1:${portA}/healthz`, 90_000),
      waitForHttp(`http://127.0.0.1:${portB}/healthz`, 90_000),
    ]);

    const modelRequests: unknown[] = [];
    let modelResponse = proposal(before, afterFirst, 'Distributed first update');
    const modelServer = createServer((request, response) => void serveModel(request, response, modelRequests, () => modelResponse));
    modelServer.listen(0, '127.0.0.1');
    await once(modelServer, 'listening');
    cleanup.push(() => closeServer(modelServer));
    const modelPort = addressPort(modelServer.address());
    let activeHarness = createHarness(await unusedPort(), modelPort);
    cleanup.push(() => activeHarness.stop());
    const workspace = createLocalCodeWorkspaceProvider({ root: directory });
    const repository = createLocalSourceRepositoryProvider({ root: directory });
    const processRunner = createLocalProcessRunnerProvider({ root: directory, allow: [process.execPath] });
    const harnessBoundary: ApplicationAgentHarnessProvider = {
      provider: 'managed-opencode', kind: 'opencode-harness-boundary', mode: 'live',
      run: input => activeHarness.run(input), cancel: input => activeHarness.cancel(input),
    };
    const providerAuthorization = `provider-${randomUUID()}-${randomUUID()}`;
    const providerServer = await createCodeAgentProviderHttpServer({
      providers: { harness: harnessBoundary, workspace, repository, process: processRunner },
      authorization: providerAuthorization,
    });
    cleanup.push(() => providerServer.close());
    const clients = createHttpCodeAgentProviders({
      endpoint: providerServer.origin,
      authorization: providerAuthorization,
      authorizationSecret: {
        secret: { apiVersion: 'v1', kind: 'Secret', name: 'code-agent-provider-authorization' },
        key: 'token',
      },
    });

    const application = app(applicationName, {
      spec: type({ profile: "'starter' | 'external'" }), status: type({ ready: 'boolean' }),
    });
    const Harness = AgentHarness.named('coding');
    const Workspace = CodeWorkspace.named('primary');
    const Repository = SourceRepository.named('primary');
    const Processes = ProcessRunner.named('bounded');
    application.profile(application.installation.spec, 'profile').provide(Harness).starter(() => clients.harness).external(() => clients.harness).exhaustive();
    application.profile(application.installation.spec, 'profile').provide(Workspace).starter(() => clients.workspace).external(() => clients.workspace).exhaustive();
    application.profile(application.installation.spec, 'profile').provide(Repository).starter(() => clients.repository).external(() => clients.repository).exhaustive();
    application.profile(application.installation.spec, 'profile').provide(Processes).starter(() => clients.process).external(() => clients.process).exhaustive();
    const identity = application.serviceIdentity('product-builder');
    const ProductBuilder = application.include(codeAgent('product-builder.v1', {
      actor: { key: type('string') }, identity, harness: Harness, workspace: Workspace, source: Repository, process: Processes,
      validation: [{ executable: process.execPath, arguments: ['-e', 'process.exit(0)'] }],
    }));
    const uninstallCode = installApplicationCodeAgentRuntimeResolver(() => clients);
    cleanup.push(async () => { uninstallCode(); });
    let failCommitResponse = true;
    let activeRuntime = createCelldApplicationActorRuntime({
      endpoint: `http://127.0.0.1:${portA}`,
      authorization: actorAuthorization,
      admissionTimeout: '60s',
      fetch: (async (input, init) => {
        const response = await fetch(input, init);
        if (failCommitResponse && String(input).endsWith('/turns:commit')) {
          failCommitResponse = false;
          throw new Error('qualification dropped the committed response');
        }
        return response;
      }) as typeof globalThis.fetch,
    });
    const uninstallActor = installApplicationActorRuntimeResolver(() => activeRuntime);
    cleanup.push(async () => { uninstallActor(); });
    const priorProfile = process.env.APPLIK8S_PROFILE_VARIANT;
    process.env.APPLIK8S_PROFILE_VARIANT = 'starter';
    cleanup.push(async () => {
      if (priorProfile === undefined) delete process.env.APPLIK8S_PROFILE_VARIANT;
      else process.env.APPLIK8S_PROFILE_VARIANT = priorProfile;
    });
    const firstInput = { repositoryId: 'repository-one', instruction: 'Apply the distributed update.', idempotencyKey: 'request-one' };
    const firstAuthority = () => createActorLiveAuthority(applicationName, ProductBuilder.actorId, 'execute', firstInput.repositoryId, firstInput);
    const recovered = await withApplicationActorTurnAuthority(firstAuthority(), () => ProductBuilder(firstInput));
    expect(recovered).toMatchObject({ status: 'completed', summary: 'Distributed first update' });
    expect(await readFile(join(repositoryRoot, 'app.ts'), 'utf8')).toBe(afterFirst);
    expect(modelRequests).toHaveLength(1);

    activeRuntime = createCelldApplicationActorRuntime({ endpoint: `http://127.0.0.1:${portA}`, authorization: actorAuthorization, admissionTimeout: '60s' });
    const replayed = await withApplicationActorTurnAuthority(firstAuthority(), () => ProductBuilder(firstInput));
    expect(replayed).toEqual(recovered);
    expect(replayed).toMatchObject({ status: 'completed', summary: 'Distributed first update', workspace: { workspace: 'repository-one' } });
    expect(modelRequests).toHaveLength(1);

    await docker(['stop', '--time', '0', nodeA], 30_000);
    activeRuntime = createCelldApplicationActorRuntime({ endpoint: `http://127.0.0.1:${portB}`, authorization: actorAuthorization, admissionTimeout: '60s' });
    await expectEventually(
      () => withApplicationActorTurnAuthority(firstAuthority(), () => ProductBuilder(firstInput)),
      replayed,
      90_000,
    );

    await activeHarness.stop();
    activeHarness = createHarness(await unusedPort(), modelPort);
    modelResponse = proposal(afterFirst, afterSecond, 'Distributed update after harness replacement');
    const secondInput = { repositoryId: 'repository-one', instruction: 'Apply another update.', idempotencyKey: 'request-two' };
    const second = await withApplicationActorTurnAuthority(
      createActorLiveAuthority(applicationName, ProductBuilder.actorId, 'execute', secondInput.repositoryId, secondInput),
      () => ProductBuilder(secondInput),
    );
    expect(second).toMatchObject({ status: 'completed', summary: 'Distributed update after harness replacement' });
    expect(await readFile(join(repositoryRoot, 'app.ts'), 'utf8')).toBe(afterSecond);
    expect(modelRequests).toHaveLength(2);
  }, 900_000);
});

async function generatedCelldArtifact(directory: string, application: string) {
  const bundlePath = join(directory, 'typekro-bundle.json');
  const operatorManifestPath = join(directory, 'celld-operator-manifest.json');
  await writeFile(operatorManifestPath, JSON.stringify({ spec: { bundle: { buildIdentityDigest: `sha256:${'c'.repeat(64)}` }, container: { build: { context: join(directory, 'celld-operator'), dockerfile: join(directory, 'celld-operator', 'Dockerfile') }, image: { repository: 'applik8s/applik8s-celld-operator', tag: 'source-test' } } } }));
  await writeFile(bundlePath, JSON.stringify({ spec: { operators: [{ name: 'applik8s-celld-operator', manifest: operatorManifestPath }] } }));
  await writeFile(join(directory, 'resources.json'), JSON.stringify([{
    apiVersion: 'kro.run/v1alpha1', kind: 'ResourceGraphDefinition', metadata: { name: application },
    spec: {
      schema: { apiVersion: 'v1alpha1', kind: 'CodeAgentCelld', spec: { name: 'string', namespace: 'string' }, status: { ready: 'boolean' } },
      resources: [{
        id: 'codeAgentCelldHttp',
        template: {
          apiVersion: 'v1', kind: 'Service',
          metadata: { name: `${application}-http`, namespace: application, labels: { 'app.kubernetes.io/component': 'typed-http' } },
          spec: { selector: { 'app.kubernetes.io/component': 'typed-http' }, ports: [{ name: 'http', port: 3000, targetPort: 'http' }] },
        },
      }],
    },
  }]));
  const emitted = await emitApplicationDeploymentGraph({
    bundlePath, projectRoot: directory, graph: celldGraph(application), sourceGraphDigest: `sha256:${'a'.repeat(64)}`,
    compilerVersion: '0.9.0', context: 'orbstack', controlPlaneNamespace: application, instance: application,
    profile: 'test', strategy: 'direct', installationSpec: { name: application, namespace: application },
  });
  const artifact = emitted.graph.nodes.find(({ id }) => id === 'artifact.celld-runtime');
  if (artifact?.kind !== 'artifact') throw new Error('Compiler did not emit the Celld runtime artifact.');
  expect(await readFile(String(artifact.spec.sourceDescriptor.dockerfilePath), 'utf8')).toContain(celldImage);
  return artifact.spec;
}

function celldGraph(application: string): ApplicationGraph {
  return {
    apiVersion: 'applik8s.appGraph/v1alpha1', kind: 'ApplicationGraph', metadata: { name: application, namespace: application },
    nodes: [{
      id: 'provider.ActorRuntime', kind: 'provider', name: 'ActorRuntime', stability: 'experimental', interface: 'ActorRuntime', implementation: 'celld-actors',
      config: { actorRuntime: { kind: 'celld-actors', replicas: 2, stateStore: { kind: 's3', bucket: application, region: 'us-east-1', endpoint: 'http://storage:8333', forcePathStyle: true, credentialsSecret: { apiVersion: 'v1', kind: 'Secret', name: application, namespace: application } } } },
    }],
    edges: [], providerRequirements: [], providerBindings: [],
    compatibility: { stablePublicApis: [], documentedInternalContracts: [], experimentalSurfaces: [], postV3Surfaces: [], labels: [] },
  };
}

async function startCelldNode(options: { readonly name: string; readonly network: string; readonly image: string; readonly bucket: string; readonly storage: string; readonly actorAuthorization: string }): Promise<void> {
  await docker([
    'run', '--detach', '--name', options.name, '--network', options.network, '-p', '127.0.0.1::8080', ...storageEnvironment(),
    '-e', `CELLD_VAR_APPLIK8S_ACTOR_AUTHORIZATION=${options.actorAuthorization}`, '-e', 'CELLD_WATCH=/tmp/celld',
    options.image, '--bucket', `s3://${options.bucket}`, '--endpoint', `http://${options.storage}:8333`, '--region', 'us-east-1',
    '--listen', '0.0.0.0:8080', '--internal-listen', '0.0.0.0:8081', '--advertise', `${options.name}:8081`,
  ]);
}

function createHarness(port: number, modelPort: number): OpenCodeHarnessProvider {
  return new OpenCodeHarnessProvider({
    port, protocolVersion: 'latest-v2',
    environment: {
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        $schema: 'https://opencode.ai/config.json', model: 'qualification/coder',
        provider: { qualification: { npm: '@ai-sdk/openai-compatible', name: 'Applik8s distributed code qualification', options: { baseURL: `http://127.0.0.1:${modelPort}/v1`, apiKey: 'qualification-only' }, models: { coder: { name: 'Qualification coder', limit: { context: 8_192, output: 2_048 } } } } },
      }),
      OPENCODE_DISABLE_AUTOUPDATE: 'true',
    },
    model: { providerID: 'qualification', modelID: 'coder' },
  });
}

function proposal(before: string, after: string, summary: string): string {
  return JSON.stringify({ protocol: 'applik8s.developmentChangeProposal/v1alpha1', message: summary, plan: {
    id: `plan_${createHash('sha256').update(summary).digest('hex').slice(0, 12)}`, summary, requestedOutcome: summary, contextReferents: [],
    files: [{ path: 'app.ts', baseDigest: `sha256:${createHash('sha256').update(before).digest('hex')}`, nextText: after, classification: 'update' }],
    graphChanges: [], schemaChanges: [], authorityChanges: [], infrastructureChanges: [], dependencies: [], risks: [], validation: [], rollbackBoundary: { kind: 'agent-owned-hunks', files: ['app.ts'] },
  } });
}

async function serveModel(request: IncomingMessage, response: ServerResponse, requests: unknown[], responseText: () => string): Promise<void> {
  if (request.method === 'GET' && request.url === '/v1/models') return json(response, { object: 'list', data: [{ id: 'coder', object: 'model', owned_by: 'qualification' }] });
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') return void response.writeHead(404).end();
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  requests.push(body);
  const text = responseText();
  if (body.stream === true) {
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    response.write(`data: ${JSON.stringify({ id: 'chatcmpl-code-celld', object: 'chat.completion.chunk', created: 1, model: 'coder', choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] })}\n\n`);
    response.write(`data: ${JSON.stringify({ id: 'chatcmpl-code-celld', object: 'chat.completion.chunk', created: 1, model: 'coder', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
    return void response.end('data: [DONE]\n\n');
  }
  json(response, { id: 'chatcmpl-code-celld', object: 'chat.completion', created: 1, model: 'coder', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }] });
}

async function preflight(options: { readonly network: string; readonly image: string; readonly containers: readonly string[] }): Promise<void> {
  await docker(['version', '--format', '{{.Server.Version}}'], 30_000);
  await run('aws', ['--version'], { encoding: 'utf8', timeout: 30_000 });
  for (const source of [celldImage, seaweedImage]) if (!await dockerResourceExists(['image', 'inspect', source])) await docker(['pull', source], 300_000);
  if (await dockerResourceExists(['network', 'inspect', options.network])) throw new Error(`Conflicting Docker network ${options.network}.`);
  if (await dockerResourceExists(['image', 'inspect', options.image])) throw new Error(`Conflicting Docker image ${options.image}.`);
  for (const container of options.containers) if (await dockerResourceExists(['container', 'inspect', container])) throw new Error(`Conflicting Docker container ${container}.`);
}

function storageEnvironment(): string[] { return ['-e', 'AWS_ACCESS_KEY_ID=applik8s-live', '-e', 'AWS_SECRET_ACCESS_KEY=applik8s-live-secret', '-e', 'AWS_REGION=us-east-1']; }
async function docker(args: readonly string[], timeout = 120_000): Promise<string> { return (await run('docker', [...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout })).stdout.trim(); }
async function dockerResourceExists(args: readonly string[]): Promise<boolean> { try { await docker(args, 30_000); return true; } catch (cause) { if (/No such|not found/iu.test(errorMessage(cause))) return false; throw cause; } }
async function removeDockerContainer(name: string): Promise<void> { if (await dockerResourceExists(['container', 'inspect', name])) await docker(['rm', '--force', name], 60_000); }
async function removeDockerImage(name: string): Promise<void> { if (await dockerResourceExists(['image', 'inspect', name])) await docker(['image', 'rm', '--force', name], 60_000); }
async function removeDockerNetwork(name: string): Promise<void> { if (await dockerResourceExists(['network', 'inspect', name])) await docker(['network', 'rm', name], 60_000); }
async function publishedPort(container: string, port: number): Promise<number> { const match = /127\.0\.0\.1:(\d+)/u.exec(await docker(['port', container, `${port}/tcp`])); if (!match?.[1]) throw new Error(`Docker did not publish ${container}:${port}.`); return Number(match[1]); }
async function createS3Bucket(endpoint: string, bucket: string): Promise<void> { await run('aws', ['--endpoint-url', endpoint, 's3api', 'create-bucket', '--bucket', bucket, '--region', 'us-east-1'], { encoding: 'utf8', env: { ...process.env, AWS_ACCESS_KEY_ID: 'applik8s-live', AWS_SECRET_ACCESS_KEY: 'applik8s-live-secret', AWS_REGION: 'us-east-1' } }); }
async function waitForHttp(url: string, timeout: number, accepted: (response: Response) => boolean = response => response.ok): Promise<void> { const deadline = Date.now() + timeout; let latest = ''; while (Date.now() < deadline) { try { const response = await fetch(url); latest = `HTTP ${response.status}`; if (accepted(response)) return; } catch (cause) { latest = errorMessage(cause); } await new Promise(resolve => setTimeout(resolve, 500)); } throw new Error(`Timed out waiting for ${url}: ${latest}`); }
async function expectEventually<T>(operation: () => Promise<T>, expected: T, timeout: number): Promise<void> { const deadline = Date.now() + timeout; let latest: unknown; while (Date.now() < deadline) { try { latest = await operation(); expect(latest).toEqual(expected); return; } catch (cause) { latest = cause; } await new Promise(resolve => setTimeout(resolve, 500)); } throw new Error(`Timed out waiting for Celld replacement recovery: ${errorMessage(latest)}`); }
function addressPort(address: AddressInfo | string | null): number { if (!address || typeof address === 'string') throw new Error('Server did not bind a TCP port.'); return address.port; }
async function unusedPort(): Promise<number> { const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = addressPort(server.address()); server.close(); await once(server, 'close'); return port; }
function closeServer(server: ReturnType<typeof createServer>): Promise<void> { return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
function json(response: ServerResponse, value: unknown): void { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); }
function errorMessage(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
