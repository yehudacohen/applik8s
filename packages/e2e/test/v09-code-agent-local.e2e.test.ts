// typecast-file-boundary: the qualification server decodes generic OpenAI-compatible request bodies at its transport edge.
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  app,
  createDeterministicApplicationActorRuntime,
  installApplicationActorRuntimeResolver,
} from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
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
import type { ApplicationCodeAgentRuntimeProviders } from '@applik8s/code-agent/runtime';
import { installApplicationCodeAgentRuntimeResolver } from '@applik8s/code-agent/runtime';
import { OpenCodeHarnessProvider } from '@applik8s/dev/agent/opencode-code-harness';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const enabled = process.env.APPLIK8S_E2E_OPENCODE === '1';

describe.skipIf(!enabled)('v0.9 local codeAgent qualification', () => {
  let root = '';
  let repositoryRoot = '';
  let modelPort = 0;
  let modelResponse = '';
  let modelDelayMilliseconds = 0;
  let firstHarness: OpenCodeHarnessProvider | undefined;
  let secondHarness: OpenCodeHarnessProvider | undefined;
  let firstProviderServer: ApplicationCodeAgentHttpServer | undefined;
  const modelRequests: unknown[] = [];
  const model = createServer((request, response) => void serveModel(
    request,
    response,
    modelRequests,
    () => modelResponse,
    () => modelDelayMilliseconds,
  ));

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'applik8s-code-agent-local-'));
    repositoryRoot = join(root, 'repository-one');
    await mkdir(repositoryRoot);
    await writeFile(join(repositoryRoot, 'package.json'), JSON.stringify({ name: 'code-agent-local', private: true, type: 'module' }));
    await writeFile(join(repositoryRoot, 'app.ts'), 'export const greeting = "before";\n');
    model.listen(0, '127.0.0.1');
    await once(model, 'listening');
    modelPort = addressPort(model.address());
  });

  afterAll(async () => {
    await firstHarness?.stop();
    await secondHarness?.stop();
    await firstProviderServer?.close();
    model.close();
    if (model.listening) await once(model, 'close');
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('executes real OpenCode changes through fenced capabilities and survives provider replacement', async () => {
    const before = 'export const greeting = "before";\n';
    const afterFirst = 'export const greeting = "after-first";\n';
    const afterSecond = 'export const greeting = "after-second";\n';
    modelResponse = proposal(before, afterFirst, 'First bounded update');
    firstHarness = createHarness(await unusedPort(), modelPort);
    let activeHarness = firstHarness;
    const harnessBoundary: ApplicationAgentHarnessProvider = {
      provider: 'replaceable-opencode', kind: 'opencode-harness-boundary', mode: 'live',
      run: input => activeHarness.run(input),
      cancel: input => activeHarness.cancel(input),
    };
    const workspace = createLocalCodeWorkspaceProvider({ root });
    const repository = createLocalSourceRepositoryProvider({ root });
    const processRunner = createLocalProcessRunnerProvider({ root, allow: [process.execPath] });
    const authorization = 'code-agent-local-provider-authorization-qualification-only';
    firstProviderServer = await createCodeAgentProviderHttpServer({
      providers: { harness: harnessBoundary, workspace, repository, process: processRunner },
      authorization,
    });
    let activeProviders: ApplicationCodeAgentRuntimeProviders = createHttpCodeAgentProviders({
      endpoint: firstProviderServer.origin,
      authorization,
      authorizationSecret: providerAuthorizationSecret(),
    });
    const application = app('code-agent-local-proof', {
      spec: type({ profile: "'starter' | 'external'" }),
      status: type({ ready: 'boolean' }),
    });
    const Harness = AgentHarness.named('coding');
    const Workspace = CodeWorkspace.named('primary');
    const Repository = SourceRepository.named('primary');
    const Processes = ProcessRunner.named('bounded');
    application.profile(application.installation.spec, 'profile').provide(Harness).starter(() => activeProviders.harness).external(() => activeProviders.harness).exhaustive();
    application.profile(application.installation.spec, 'profile').provide(Workspace).starter(() => activeProviders.workspace).external(() => activeProviders.workspace).exhaustive();
    application.profile(application.installation.spec, 'profile').provide(Repository).starter(() => activeProviders.repository).external(() => activeProviders.repository).exhaustive();
    application.profile(application.installation.spec, 'profile').provide(Processes).starter(() => activeProviders.process).external(() => activeProviders.process).exhaustive();
    const identity = application.serviceIdentity('product-builder');
    const ProductBuilder = application.include(codeAgent('product-builder.v1', {
      actor: { key: type('string') },
      identity,
      harness: Harness,
      workspace: Workspace,
      source: Repository,
      process: Processes,
      validation: [{ executable: process.execPath, arguments: ['-e', 'process.exit(0)'] }],
    }));
    const actorRuntime = createDeterministicApplicationActorRuntime();
    const uninstallActor = installApplicationActorRuntimeResolver(() => actorRuntime);
    const uninstallCode = installApplicationCodeAgentRuntimeResolver(() => activeProviders);
    const priorProfile = process.env.APPLIK8S_PROFILE_VARIANT;
    process.env.APPLIK8S_PROFILE_VARIANT = 'starter';
    try {
      const first = await ProductBuilder({
        repositoryId: 'repository-one',
        instruction: 'Apply the first bounded update.',
        idempotencyKey: 'request-one',
      });
      expect(first).toMatchObject({
        status: 'completed',
        summary: 'First bounded update',
        workspace: { workspace: 'repository-one' },
        harness: { receipt: { provider: 'opencode', changeCount: 1 } },
        validation: [{ exitCode: 0 }],
      });
      expect(await readFile(join(repositoryRoot, 'app.ts'), 'utf8')).toBe(afterFirst);
      const requestsAfterFirst = modelRequests.length;
      await expect(ProductBuilder({
        repositoryId: 'repository-one',
        instruction: 'Apply the first bounded update.',
        idempotencyKey: 'request-one',
      })).resolves.toEqual(first);
      expect(modelRequests).toHaveLength(requestsAfterFirst);

      await firstHarness.stop();
      secondHarness = createHarness(await unusedPort(), modelPort);
      activeHarness = secondHarness;
      modelResponse = proposal(afterFirst, afterSecond, 'Second update after provider replacement');
      const second = await ProductBuilder({
        repositoryId: 'repository-one',
        instruction: 'Apply the second bounded update after replacing OpenCode.',
        idempotencyKey: 'request-two',
      });
      expect(second, JSON.stringify(second)).toMatchObject({
        status: 'completed',
        summary: 'Second update after provider replacement',
        workspace: { workspace: 'repository-one' },
        harness: { receipt: { provider: 'opencode', changeCount: 1 } },
      });
      expect(second.status === 'completed' && first.status === 'completed' && second.harness.sessionId)
        .not.toBe(first.status === 'completed' ? first.harness.sessionId : '');
      expect(await readFile(join(repositoryRoot, 'app.ts'), 'utf8')).toBe(afterSecond);

      const requestsBeforeCancellation = modelRequests.length;
      modelDelayMilliseconds = 5_000;
      modelResponse = proposal(afterSecond, 'export const greeting = "must-not-apply";\n', 'Cancelled update');
      const cancelledRun = ProductBuilder({
        repositoryId: 'repository-one',
        instruction: 'Begin an update that will be cancelled.',
        idempotencyKey: 'request-cancelled',
      });
      await waitUntil(() => modelRequests.length > requestsBeforeCancellation, 20_000);
      await expect(ProductBuilder.cancel({ repositoryId: 'repository-one', idempotencyKey: 'request-cancelled' }))
        .resolves.toEqual({ status: 'cancelled' });
      await expect(cancelledRun).resolves.toMatchObject({ status: 'cancelled', reason: 'OpenCode run was cancelled.' });
      expect(await readFile(join(repositoryRoot, 'app.ts'), 'utf8')).toBe(afterSecond);
      modelDelayMilliseconds = 0;
    } finally {
      if (priorProfile === undefined) delete process.env.APPLIK8S_PROFILE_VARIANT;
      else process.env.APPLIK8S_PROFILE_VARIANT = priorProfile;
      uninstallCode();
      uninstallActor();
    }
  }, 60_000);
});

function createHarness(port: number, modelPort: number): OpenCodeHarnessProvider {
  return new OpenCodeHarnessProvider({
    port,
    protocolVersion: 'latest-v2',
    environment: {
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        $schema: 'https://opencode.ai/config.json',
        model: 'qualification/coder',
        provider: {
          qualification: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Applik8s code-agent qualification',
            options: { baseURL: `http://127.0.0.1:${modelPort}/v1`, apiKey: 'qualification-only' },
            models: { coder: { name: 'Qualification coder', limit: { context: 8_192, output: 2_048 } } },
          },
        },
      }),
      OPENCODE_DISABLE_AUTOUPDATE: 'true',
    },
    model: { providerID: 'qualification', modelID: 'coder' },
  });
}

function providerAuthorizationSecret() {
  return {
    secret: { apiVersion: 'v1', kind: 'Secret', name: 'code-agent-provider-authorization' },
    key: 'token',
  } as const;
}

function proposal(before: string, after: string, summary: string): string {
  return JSON.stringify({
    protocol: 'applik8s.developmentChangeProposal/v1alpha1',
    message: summary,
    plan: {
      id: `plan_${createHash('sha256').update(summary).digest('hex').slice(0, 12)}`,
      summary,
      requestedOutcome: summary,
      contextReferents: [],
      files: [{
        path: 'app.ts',
        baseDigest: `sha256:${createHash('sha256').update(before).digest('hex')}`,
        nextText: after,
        classification: 'update',
      }],
      graphChanges: [], schemaChanges: [], authorityChanges: [], infrastructureChanges: [], dependencies: [], risks: [], validation: [],
      rollbackBoundary: { kind: 'agent-owned-hunks', files: ['app.ts'] },
    },
  });
}

async function serveModel(
  request: IncomingMessage,
  response: ServerResponse,
  requests: unknown[],
  responseText: () => string,
  delayMilliseconds: () => number,
): Promise<void> {
  if (request.method === 'GET' && request.url === '/v1/models') {
    json(response, { object: 'list', data: [{ id: 'coder', object: 'model', owned_by: 'qualification' }] });
    return;
  }
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.writeHead(404).end();
    return;
  }
  const body = await bodyJson(request);
  requests.push(body);
  if (delayMilliseconds() > 0) await new Promise(resolve => setTimeout(resolve, delayMilliseconds()));
  const text = responseText();
  if (Reflect.get(body, 'stream') === true) {
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    response.write(`data: ${JSON.stringify({ id: 'chatcmpl-code-agent', object: 'chat.completion.chunk', created: 1, model: 'coder', choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] })}\n\n`);
    response.write(`data: ${JSON.stringify({ id: 'chatcmpl-code-agent', object: 'chat.completion.chunk', created: 1, model: 'coder', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
    response.end('data: [DONE]\n\n');
    return;
  }
  json(response, {
    id: 'chatcmpl-code-agent', object: 'chat.completion', created: 1, model: 'coder',
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 12, completion_tokens: 12, total_tokens: 24 },
  });
}

async function bodyJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Model request body is invalid.');
  return value as Record<string, unknown>;
}

function json(response: ServerResponse, value: unknown): void {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

function addressPort(address: AddressInfo | string | null): number {
  if (!address || typeof address === 'string') throw new Error('Qualification server did not bind a TCP port.');
  return address.port;
}

async function unusedPort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = addressPort(server.address());
  server.close();
  await once(server, 'close');
  return port;
}

async function waitUntil(predicate: () => boolean, timeout: number): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for the OpenCode model turn to begin.');
}
