// typecast-file-boundary: generated-agent fixtures inspect JSON manifests only after compiler emission and explicit discriminator assertions.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AI } from '@applik8s/ai';
import { app, applicationGraphFor, IdentityProvider, Observability, postgres, trustedContext } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { applicationConversations } from '@applik8s/conversations';
import {
  type ApplicationGraph,
  deriveApplicationGraphFoundation,
} from '@applik8s/core';
import { usage } from '@applik8s/usage';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { afterEach, describe, expect, it } from 'vitest';
import { emitGeneratedApplicationAgents } from '../src/application-agents/index.js';
import { applicationProviderConsumerWorkloads } from '../src/application-deployment-graph.js';
import {
  applicationFacadeManifest,
  generatedApplicationFacadeSource,
} from '../src/application-facade/index.js';
import {
  compileApplicationOperationCatalog,
  compileApplicationWorkloadAuthority,
} from '../src/application-operations/index.js';
import {
  compileTypeKroComposition,
  discoverApplicationGraphWithExports,
} from '../src/pipeline/index.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })),
  );
});

describe('generated application AI agents', () => {
  it('hydrates exact direct actor calls through the authenticated application boundary', async () => {
    const fixture = new URL(
      './fixtures/v08-agent-actor-app.ts',
      import.meta.url,
    ).pathname;
    const discovered = await discoverApplicationGraphWithExports(
      fixture,
      'agentActorProof',
    );
    expect(
      discovered.ok,
      discovered.ok ? undefined : discovered.error.message,
    ).toBe(true);
    if (!discovered.ok) return;
    const agent = discovered.value.graph.nodes.find(
      (node) => node.kind === 'aiAgent',
    );
    expect(agent).toMatchObject({
      actors: [{
        alias: 'ResearchSession.record',
        actor: { nodeId: 'actor.research-session.v1' },
        member: 'record',
        memberKind: 'command',
      }],
    });
    const catalog = compileApplicationOperationCatalog(discovered.value.graph);
    const authority = compileApplicationWorkloadAuthority(
      discovered.value.graph,
      catalog,
    );
    const outDir = await mkdtemp(join(tmpdir(), 'applik8s-agent-actor-'));
    temporaryDirectories.push(outDir);
    const [artifact] = await emitGeneratedApplicationAgents({
      graph: discovered.value.graph,
      operationCatalog: catalog,
      workloadAuthority: authority,
      outDir,
      entrypoint: fixture,
    });
    if (!artifact) throw new Error('Expected one generated actor-aware agent.');
    const generated = await readFile(
      join(dirname(artifact.sourcePath), 'agent.generated.ts'),
      'utf8',
    );
    const handler = await readFile(
      join(dirname(artifact.sourcePath), 'handler.generated.ts'),
      'utf8',
    );
    expect(generated).toContain('invokeApplicationActorBinding');
    expect(generated).toContain('/__applik8s/v1/internal/actors/invoke');
    expect(generated).toContain('captureApplicationTelemetryContext()');
    expect(generated).toContain('...(telemetry ? { telemetry } : {})');
    expect(generated).toContain('"actor":"research-session.v1"');
    expect(generated).toContain('principal: context.principal');
    expect(generated).toContain("transport: 'direct'");
    expect(generated).toContain("request.once('aborted', abortRequest)");
    expect(generated).toContain("response.once('close', abortRequest)");
    expect(generated).toContain('signal: requestController.signal');
    expect(generated).toContain('server.closeIdleConnections?.()');
    expect(generated).toContain('contract.deployment.gracefulShutdownSeconds * 1_000');
    expect(generated).toContain('server.closeAllConnections?.()');
    expect(generated).toContain('(contract.deployment.gracefulShutdownSeconds + 10) * 1_000');
    expect(generated).toContain("process.once('SIGTERM', () => terminate('SIGTERM'))");
    expect(generated).toContain('workloadAuthorityId: binding.workloadAuthority.id');
    expect(handler).not.toContain('application.inject');
    expect(generated).not.toContain("id: 'agent:' + context.invocationId");
    expect(authority).toContainEqual(expect.objectContaining({
      operationId: 'applik8s://actors/research-session.v1/operations/record',
      transports: ['direct'],
    }));
    expect(JSON.stringify(artifact.resources)).toContain(
      'APPLIK8S_ACTOR_APPLICATION_ENDPOINT',
    );
  }, 60_000);

  it('hydrates a clean external callable provider without replaying agent authoring setup', async () => {
    const directory = await mkdtemp(
      join(process.cwd(), '.tmp-applik8s-provider-agent-'),
    );
    temporaryDirectories.push(directory);
    const providerPackage = join(
      directory,
      'node_modules',
      '@fixture',
      'acquisition',
    );
    await mkdir(providerPackage, { recursive: true });
    await writeFile(
      join(providerPackage, 'package.json'),
      JSON.stringify({
        name: '@fixture/acquisition',
        version: '1.0.0',
        type: 'module',
        exports: {
          '.': './index.js',
          './runtime': './runtime.js',
        },
      }),
    );
    await writeFile(join(providerPackage, 'runtime.js'), `
export async function acquireItem(input) {
  return { value: (process.env.ACQUISITION_SOURCE || 'missing') + ':' + input.id };
}
`);
    await writeFile(join(providerPackage, 'index.js'), `
import { defineApplicationProvider } from '@applik8s/applik8s';
export const AcquisitionProvider = defineApplicationProvider({
  interface: 'AcquisitionProvider',
  version: 'v1alpha1',
  runtime: {
    bind(implementation) {
      return {
        env: { ACQUISITION_SOURCE: implementation.source },
        secretEnv: {
          ACQUISITION_TOKEN: {
            secret: implementation.credentialSecret,
            key: 'token',
          },
        },
        readiness: {
          dependencies: [implementation.credentialSecret],
          condition: 'the selected acquisition credential is projected',
          timeoutSeconds: 30,
        },
      };
    },
    operations: {
      acquire: {
        module: '@fixture/acquisition/runtime',
        export: 'acquireItem',
        access: {
          kind: 'provider',
          operations: ['connection.use', 'network.connect'],
        },
      },
    },
  },
  accepts: candidate => candidate?.kind === 'acquisition'
    && candidate.credentialSecret?.kind === 'Secret'
    && typeof candidate.acquire === 'function',
}).named('primary');
`);
    await mkdir(join(directory, 'migrations'));
    await writeFile(
      join(directory, 'migrations', '0000_conversations.sql'),
      'create table provider_agent_conversations (id text primary key, body text not null);\n',
    );
    const entrypoint = join(directory, 'entrypoint.ts');
    await writeFile(entrypoint, `
import { AI } from '@applik8s/ai';
import { IdentityProvider, app } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { AcquisitionProvider } from '@fixture/acquisition';

const application = app('provider-agent', {
  namespace: 'provider-agent',
  spec: type({ profile: "'starter' | 'dedicated'" }),
  status: type({ ready: 'boolean' }),
});
application.provide(AI, AI.deterministic({ fixture: { response: 'recorded' } }));
application.provide(IdentityProvider, IdentityProvider.deterministic({
  mode: 'starter',
  application: 'provider-agent',
  subject: 'test',
  audience: ['provider-agent'],
  catalogRevision: 'catalog-test',
  authorityRevision: 'authority-test',
}));
const conversations = pgTable('provider_agent_conversations', {
  id: text('id').primaryKey(),
  body: text('body').notNull(),
});
const database = application.database.postgres('application', {
  schema: { conversations },
  migrations: { path: './migrations' },
});
const Conversation = application.model(conversations, {
  name: 'Conversation',
  database,
});
const implementation = (source, secretName) => ({
  kind: 'acquisition',
  source,
  credentialSecret: {
    apiVersion: 'v1',
    kind: 'Secret',
    name: secretName,
    namespace: 'provider-agent',
  },
  async acquire(input) { return { value: this.source + ':' + input.id }; },
});
application.profile(application.installation.spec, 'profile')
  .provide(AcquisitionProvider)
  .starter(() => implementation('starter', 'acquisition-starter'))
  .dedicated(() => implementation('dedicated', 'acquisition-dedicated'))
  .exhaustive();
const provider = application.inject(AcquisitionProvider);
const acquire = provider.acquire;
async function acquireThroughHelper(input) {
  return acquire(input);
}
const researcher = application.serviceIdentity('researcher');
researcher.can(Conversation.create);
application.agent('researcher', {
  identity: researcher,
  model: AI.model('deterministic', { capabilities: [AI.chat, AI.tools] }),
  instructions: 'Acquire three records.',
  tools: [Conversation.create],
}, async (request, context) => {
  const direct = await provider.acquire({ id: context.runId + '-direct' });
  const extracted = await acquire({ id: context.runId + '-extracted' });
  const helper = await acquireThroughHelper({ id: context.runId + '-helper' });
  return {
    threadId: request.threadId,
    runId: context.runId,
    result: [direct.value, extracted.value, helper.value].join(','),
  };
});
export const providerAgentStack = application.composition;
`);
    const discovered = await discoverApplicationGraphWithExports(
      entrypoint,
      'providerAgentStack',
    );
    expect(
      discovered.ok,
      discovered.ok ? undefined : discovered.error.message,
    ).toBe(true);
    if (!discovered.ok) return;
    expect(
      discovered.value.graph.nodes.find((node) => node.kind === 'aiAgent'),
    ).toMatchObject({
      providerBindings: expect.arrayContaining([
        expect.objectContaining({ identifier: 'provider.acquire' }),
        expect.objectContaining({ identifier: 'acquire' }),
      ]),
    });
    const graph = discovered.value.graph;
    const operationCatalog = compileApplicationOperationCatalog(graph);
    const workloadAuthority = compileApplicationWorkloadAuthority(
      graph,
      operationCatalog,
    );
    const [artifact] = await emitGeneratedApplicationAgents({
      graph,
      operationCatalog,
      workloadAuthority,
      outDir: join(directory, 'dist'),
      entrypoint,
    });
    if (!artifact) throw new Error('Expected a generated provider agent.');
    const generated = await readFile(artifact.sourcePath, 'utf8');
    const generatedEntrypoint = await readFile(
      join(dirname(artifact.sourcePath), 'agent.generated.ts'),
      'utf8',
    );
    const callback = await readFile(
      join(dirname(artifact.sourcePath), 'handler.generated.ts'),
      'utf8',
    );
    expect(generated).toContain('acquireItem');
    expect(generated).toContain('ACQUISITION_SOURCE');
    expect(generatedEntrypoint).toContain('@fixture/acquisition/runtime');
    expect(generatedEntrypoint).toContain('instrumentApplicationProviderOperation');
    expect(generatedEntrypoint).toContain('"interface":"AcquisitionProvider"');
    expect(generatedEntrypoint).toContain('"member":"acquire"');
    expect(callback).toContain('acquireThroughHelper');
    expect(callback).not.toContain('defineApplicationProvider');
    expect(callback).not.toContain('.provide(');
    expect(callback).not.toContain('.profile(');
    expect(callback).not.toContain('.inject(');
    const deployment = artifact.resources.find(
      (resource) => resource.kind === 'Deployment',
    );
    const deploymentSource = JSON.stringify(deployment);
    expect(deploymentSource).toContain('APPLIK8S_PROFILE_VARIANT');
    expect(deploymentSource).toContain('ACQUISITION_SOURCE');
    expect(deploymentSource).toContain('ACQUISITION_TOKEN');
    expect(deploymentSource).toContain('acquisition-starter');
    const agent = graph.nodes.find((node) => node.kind === 'aiAgent');
    expect(agent?.kind).toBe('aiAgent');
    if (agent?.kind !== 'aiAgent') return;
    expect(agent.providerBindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation: expect.objectContaining({
          member: 'acquire',
          runtime: expect.objectContaining({
            module: '@fixture/acquisition/runtime',
            export: 'acquireItem',
          }),
        }),
      }),
    ]));
    const providerNode = graph.nodes.find(
      (node) => node.kind === 'provider'
        && node.interface === 'AcquisitionProvider',
    );
    expect(providerNode?.kind).toBe('provider');
    if (providerNode?.kind !== 'provider') return;
    expect(
      [...applicationProviderConsumerWorkloads(
        graph,
        new Set([providerNode.id]),
      )],
    ).toEqual(['researcher']);
    const access = deriveApplicationGraphFoundation(graph, {
      workspaceRoot: process.cwd(),
    })
      .runtimeAccess.filter(
        (requirement) => requirement.target.capabilityId === providerNode.id,
      );
    expect(access).toEqual(expect.arrayContaining([
      expect.objectContaining({
        consumer: expect.objectContaining({ nodeId: agent.id }),
        target: expect.objectContaining({ operation: 'connection.use' }),
      }),
      expect.objectContaining({
        consumer: expect.objectContaining({ nodeId: agent.id }),
        target: expect.objectContaining({ operation: 'network.connect' }),
      }),
    ]));
    const [repeatedArtifact] = await emitGeneratedApplicationAgents({
      graph,
      operationCatalog,
      workloadAuthority,
      outDir: join(directory, 'dist-repeat'),
      entrypoint,
    });
    expect(repeatedArtifact?.digest).toBe(artifact.digest);
    expect(await readFile(repeatedArtifact?.sourcePath ?? '', 'utf8')).toBe(
      generated,
    );
    const missingRuntimeGraph = {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.kind !== 'aiAgent'
          ? node
          : {
              ...node,
              providerBindings: node.providerBindings?.map((binding) => ({
                ...binding,
                ...(binding.operation
                  ? { operation: { member: binding.operation.member } }
                  : {}),
              })),
            }),
    } as ApplicationGraph;
    await expect(
      emitGeneratedApplicationAgents({
        graph: missingRuntimeGraph,
        operationCatalog: compileApplicationOperationCatalog(
          missingRuntimeGraph,
        ),
        workloadAuthority: compileApplicationWorkloadAuthority(
          missingRuntimeGraph,
          compileApplicationOperationCatalog(missingRuntimeGraph),
        ),
        outDir: join(directory, 'missing-runtime'),
        entrypoint,
      }),
    ).rejects.toThrow(/has no public static runtime operation/);
    const placementOnlyGraph = {
      ...missingRuntimeGraph,
      nodes: missingRuntimeGraph.nodes.map((node) =>
        node.kind !== 'aiAgent'
          ? node
          : {
              ...node,
              providerBindings: node.providerBindings?.map(
                ({ operation: _operation, ...binding }) => binding,
              ),
            }),
    } as ApplicationGraph;
    await expect(
      emitGeneratedApplicationAgents({
        graph: placementOnlyGraph,
        operationCatalog: compileApplicationOperationCatalog(
          placementOnlyGraph,
        ),
        workloadAuthority: compileApplicationWorkloadAuthority(
          placementOnlyGraph,
          compileApplicationOperationCatalog(placementOnlyGraph),
        ),
        outDir: join(directory, 'placement-only'),
        entrypoint,
      }),
    ).rejects.toThrow(/has no callable operation metadata/);
  }, 120_000);

  it('injects direct query handles without importing the authoring graph into the agent runtime', async () => {
    const fixture = new URL(
      './fixtures/v07-agent-query-app.ts',
      import.meta.url,
    ).pathname;
    const discovered = await discoverApplicationGraphWithExports(
      fixture,
      'agentQueryProof',
    );
    expect(
      discovered.ok,
      discovered.ok ? undefined : discovered.error.message,
    ).toBe(true);
    if (!discovered.ok) return;
    const agent = discovered.value.graph.nodes.find(
      (node) => node.kind === 'aiAgent',
    );
    expect(agent).toMatchObject({
      operations: [{
        alias: 'Audit.create',
        authoringOperationId: 'Audit.create',
        operationId: 'applik8s://models/Audit/operations/create',
      }],
      queries: [{
        alias: 'RecordById',
        query: { nodeId: 'query.Record.loadRecord' },
      }],
    });
    const catalog = compileApplicationOperationCatalog(discovered.value.graph);
    const authority = compileApplicationWorkloadAuthority(
      discovered.value.graph,
      catalog,
    );
    const outDir = await mkdtemp(join(tmpdir(), 'applik8s-agent-query-'));
    temporaryDirectories.push(outDir);
    const [artifact] = await emitGeneratedApplicationAgents({
      graph: discovered.value.graph,
      operationCatalog: catalog,
      workloadAuthority: authority,
      outDir,
      entrypoint: fixture,
    });
    if (!artifact) throw new Error('Expected one generated query agent.');
    const directory = dirname(artifact.sourcePath);
    const callback = await readFile(
      join(directory, 'handler.generated.ts'),
      'utf8',
    );
    const generated = await readFile(
      join(directory, 'agent.generated.ts'),
      'utf8',
    );
    expect(callback).toContain(
      'export function createHandler(__applik8sBindings = {})',
    );
    expect(callback).toContain(
      'const RecordById = __applik8sBindings["RecordById"]',
    );
    expect(callback).not.toContain('v07-agent-query-app');
    expect(generated).toContain('createApplicationTaskQueryRuntime');
    expect(generated).toContain('installApplicationOperationRuntimeResolver');
    expect(generated).toContain('directOperationScope.run(runtime');
    expect(generated).toContain('Agent callback attempted undeclared function-native operation');
    expect(generated).toContain('applik8s://models/Audit/operations/create');
    expect(generated).toContain('"authoringOperationId":"Audit.create"');
    expect(generated).toContain('[dependency.authoringOperationId, dependency.operation]');
    expect(generated).toContain('APPLIK8S_AGENT_QUERY_CONTEXT_SECRET');
    expect(generated).toContain(
      'http://agent-query-proof-queries:8080/queries/Record.loadRecord/snapshot',
    );
    expect(generated).toContain('trustedContext: context.trustedContext');
    expect(generated).toContain('identity: contract.serviceIdentity');
    expect(generated).toContain("authenticationMethod: 'workload-identity'");
    expect(JSON.stringify(artifact.resources)).toContain(
      'APPLIK8S_AGENT_QUERY_CONTEXT_SECRET',
    );
    expect(await readFile(artifact.sourcePath, 'utf8')).not.toContain(
      'Application task starter.knowledge.ingest',
    );
  }, 60_000);

  it('binds function-native agent mutations in their generated placement receiver', async () => {
    const fixture = new URL(
      './fixtures/v07-agent-query-app.ts',
      import.meta.url,
    ).pathname;
    const outDir = await mkdtemp(join(tmpdir(), 'applik8s-agent-placement-'));
    temporaryDirectories.push(outDir);
    const result = await compileTypeKroComposition({
      entrypoint: fixture,
      compositionName: 'agentQueryProof',
      outDir,
      runtimeVersionRange: '^0.7.0',
      handlerAbiVersion: 'applik8s.handler/v1alpha1',
      adapter: 'wasmComponent',
      portability: {
        deterministicBuild: true,
        allowEnvironmentAccess: false,
        allowFilesystemAccess: false,
        allowNetworkAccess: true,
        allowedHostImports: [],
        sourceMaps: {
          emit: true,
          includeSourceContent: false,
          redactPaths: false,
        },
      },
    });
    expect(result.ok, result.ok ? undefined : result.error.message).toBe(true);
    if (!result.ok) return;
    const receiver = result.value.artifacts.reactiveArtifacts.find(
      (artifact) => artifact.kind === 'queryGateway'
        && artifact.name.includes('tool-receiver'),
    );
    expect(receiver).toBeDefined();
    const source = await readFile(
      join(dirname(receiver?.sourcePath ?? ''), 'gateway.generated.ts'),
      'utf8',
    );
    const bindings = /bindings: \[([\s\S]*?)\],\n\s*revalidate:/u.exec(source)?.[1];
    expect(bindings).toContain(
      'applik8s://models/Audit/operations/create',
    );
    expect(bindings).toContain(
      'commandGateway.invoke({ operationId: "applik8s://models/Audit/operations/create"',
    );
  }, 120_000);

  it('compiles an ordinary exported function into one durable local agent tool', async () => {
    const discovered = await discoverApplicationGraphWithExports(
      new URL(
        './fixtures/v07-function-agent-app.ts',
        import.meta.url,
      ).pathname,
      'functionAgentProof',
    );
    expect(
      discovered.ok,
      discovered.ok ? undefined : discovered.error.message,
    ).toBe(true);
    if (!discovered.ok) return;
    expect(discovered.value.agentExports).toEqual([
      { name: 'Publisher', agentName: 'publisher' },
    ]);
    const manifest = applicationFacadeManifest(discovered.value.graph, {
      agentExports: discovered.value.agentExports,
    });
    expect(manifest.agents).toEqual([
      { name: 'publisher', exportNames: ['Publisher'] },
    ]);
    const browser = generatedApplicationFacadeSource(manifest, 'browser');
    expect(browser).toContain(
      "export const Publisher = Object.freeze({ kind: 'applicationAgent', name: \"publisher\" });",
    );
    expect(browser).not.toContain('@applik8s/ai');
    expect(browser).not.toContain('@tanstack/ai');
    const catalog = compileApplicationOperationCatalog(discovered.value.graph);
    const authority = compileApplicationWorkloadAuthority(
      discovered.value.graph,
      catalog,
    );
    const operation = catalog.operations.find(
      (candidate) => candidate.placement?.runtime === 'agent-worker',
    );
    expect(operation).toMatchObject({
      id: expect.stringMatching(
        /^applik8s:\/\/functions\/.*v07-function-agent-app\.ts%23publishPost\/operations\/invoke$/,
      ),
      kind: 'model.operation',
      placement: {
        nodeId: 'aiAgent.publisher',
        runtime: 'agent-worker',
      },
      effects: ['transactional-model-write'],
      emittedEvents: ['event.posts.published.v1'],
    });
    const outDir = await mkdtemp(
      join(tmpdir(), 'applik8s-function-agent-'),
    );
    temporaryDirectories.push(outDir);
    const artifacts = await emitGeneratedApplicationAgents({
      graph: discovered.value.graph,
      operationCatalog: catalog,
      workloadAuthority: authority,
      outDir,
      entrypoint: new URL(
        './fixtures/v07-function-agent-app.ts',
        import.meta.url,
      ).pathname,
    });
    expect(artifacts).toHaveLength(1);
    const artifact = artifacts[0];
    if (!artifact) throw new Error('Expected generated function agent.');
    const generated = await readFile(
      join(dirname(artifact.sourcePath), 'agent.generated.ts'),
      'utf8',
    );
    const toolModule = await readFile(
      join(dirname(artifact.sourcePath), 'tool-0.generated.ts'),
      'utf8',
    );
    expect(generated).toContain(
      'executeFunctionNativePostgresModelEdit',
    );
    expect(generated).toContain(
      'idempotencyKey: context.idempotencyKey',
    );
    expect(generated).toContain(
      'const durableContextValues = applicationRequestContextValues(',
    );
    expect(generated).toContain(
      "digestSecret: requiredEnv('APPLIK8S_CONTEXT_SECRET')",
    );
    expect(generated).toMatch(
      /applicationPostgresModelReadClients\([\s\S]*?values: durableContextValues,[\s\S]*?digest: context\.principal\.trustedContextDigest,\s*changeScopes,/u,
    );
    expect(generated).toMatch(/delivery: \{[\s\S]*?context: \{\s*values: durableContextValues,\s*digest: context\.principal\.trustedContextDigest,\s*changeScopes,/u);
    expect(artifact.frameworkCredentials).toContainEqual(
      expect.objectContaining({ environmentName: 'APPLIK8S_CONTEXT_SECRET' }),
    );
    expect(generated).toContain(
      'authorizationReceipt: context.authorizationReceipt',
    );
    expect(generated).toContain(
      'operationAuthority.revalidate(',
    );
    expect(generated).toContain('const localAgentTools = new Map()');
    expect(generated).toContain(
      '"Post": localToolModelHandle("Post")',
    );
    expect(generated).not.toContain('"Post": { "edit"');
    expect(generated).toContain(
      'const placementRoutes = new Map([])',
    );
    expect(generated.indexOf('const local = localAgentTools.get(operation.id)'))
      .toBeLessThan(
        generated.indexOf(
          "if (!route) throw new Error('AI operation has no compiled placement route.')",
        ),
      );
    expect(toolModule).toContain('export function createTool(__applik8sBindings = {})');
    expect(toolModule).toContain('const Post = __applik8sBindings["Post"]');
    expect(toolModule).toContain('const PostPublished = __applik8sBindings["PostPublished"]');
    expect(toolModule).toContain('Post.edit');
    expect(toolModule).toContain('PostPublished.emit');
    // static-import-exception: this assertion loads the compiler-emitted module at its per-test temporary path.
    const loaded = await import(
      `${pathToFileURL(
        join(dirname(artifact.sourcePath), 'tool-0.generated.ts'),
      ).href}?test=${Date.now()}`
    ) as {
      readonly createTool: (bindings: {
        readonly Post: {
          edit(
            identity: string,
            handler: (post: {
              readonly id: string;
              update(value: unknown): Promise<void>;
            }) => Promise<unknown>,
          ): Promise<unknown>;
        };
        readonly PostPublished: { emit(value: unknown): void };
      }) => (input: {
        readonly postId: string;
        readonly body: string;
      }) => Promise<unknown>;
    };
    const updated: unknown[] = [];
    const emitted: unknown[] = [];
    const tool = loaded.createTool({
      Post: {
        async edit(identity, handler) {
          return handler({
            id: identity,
            async update(value) {
              updated.push(value);
            },
          });
        },
      },
      PostPublished: {
        emit(value) {
          emitted.push(value);
        },
      },
    });
    await expect(
      tool({ postId: 'post-1', body: 'Published by agent' }),
    ).resolves.toEqual({
      postId: 'post-1',
      state: 'published',
    });
    expect(updated).toEqual([
      { body: 'Published by agent', state: 'published' },
    ]);
    expect(emitted).toEqual([
      { postId: 'post-1', body: 'Published by agent' },
    ]);
  }, 60_000);

  it('emits one focused immutable workload with canonical tools and authority', async () => {
    const application = app('research-platform', {
      namespace: 'research-system',
      spec: type({
        name: 'string',
        profile: "'starter' | 'dedicated' | 'external'",
        providers: {
          inference: {
            endpoint: 'string',
            model: 'string',
            credentialSecretName: 'string',
            credentialKey: 'string',
          },
        },
      }),
      status: type({ ready: 'boolean' }),
    });
    const inference = AI.named('inference');
    application
      .profile(application.installation.spec, 'profile')
      .provide(inference)
      .starter(() =>
        AI.deterministic({ fixture: { response: 'starter evidence' } }))
      .dedicated(() =>
        AI.envoy({
          name: 'research-inference',
          namespace: 'research-system',
          provision: true,
          versions: {
            envoyGateway: 'v1.6.0',
            aiGateway: 'v0.6.0',
            gatewayApi: 'v1.4.1',
          },
          models: {
            fast: {
              fallback: 'disabled',
              backends: [
                {
                  apiVersion: 'applik8s.aiBackend/v1alpha1',
                  name: 'primary',
                  providerClass: 'openai-compatible',
                  model: 'fast',
                  endpoint: 'http://model.research-system.svc:8080',
                  credentials: {
                    apiVersion: 'v1',
                    kind: 'Secret',
                    name: 'research-inference-provider',
                    namespace: 'research-system',
                    key: 'apiKey',
                  },
                  capabilities: ['chat', 'tools', 'streaming'],
                },
              ],
            },
          },
        }))
      .external((spec) =>
        AI.envoy({
          provision: false,
          versions: {
            envoyGateway: 'v1.6.0',
            aiGateway: 'v0.6.0',
            gatewayApi: 'v1.4.1',
          },
          models: {
            fast: {
              fallback: 'disabled',
              backends: [{
                apiVersion: 'applik8s.aiBackend/v1alpha1',
                name: 'external',
                providerClass: 'openai-compatible',
                model: spec.providers.inference.model,
                endpoint: spec.providers.inference.endpoint,
                allowInsecureHttp: true,
                credentials: {
                  apiVersion: 'v1',
                  kind: 'Secret',
                  name: spec.providers.inference.credentialSecretName,
                  namespace: 'research-system',
                  key: spec.providers.inference.credentialKey,
                },
                capabilities: ['chat', 'tools', 'streaming'],
              }],
            },
          },
        }))
      .exhaustive();
    application.provide(
      IdentityProvider,
      IdentityProvider.deterministic({
        mode: 'starter',
        application: 'research-platform',
        subject: 'test',
        audience: ['research-platform'],
        catalogRevision: 'catalog-test',
        authorityRevision: 'authority-test',
      }),
    );
    application.provide(Observability, Observability.local());
    const posts = pgTable('research_posts', {
      id: text('id').primaryKey(),
      body: text('body').notNull(),
    });
    const PrincipalScope = trustedContext('principalScope', {
      schema: type('string'),
    });
    const database = application.database.postgres('application', {
      schema: { posts, applicationConversations },
      migrations: { path: './drizzle' },
      access: postgres.rls({
        context: PrincipalScope,
        column: 'principalScope',
        setting: 'applik8s.context.agentConversationScope',
      }),
    });
    application.include(usage);
    const Post = application.model(posts, {
      name: 'Post',
      database,
      access: 'global',
    });
    application.model(applicationConversations, {
      name: 'Conversation',
      database,
    });
    const WorkspaceId = trustedContext('workspaceId', { schema: type('string') });
    const identity = application.serviceIdentity('researcher');
    application.agent(
      'researcher',
      {
        identity,
        scope: WorkspaceId,
        model: AI.model('fast', {
          capabilities: [AI.chat, AI.tools, AI.streaming],
          inference: application.inject(inference),
        }),
        instructions: 'Answer only with evidence.',
        tools: [Post.create],
        deployment: { replicas: 2, maximumConcurrency: 7 },
      },
      async (request, context) => ({
        threadId: request.threadId,
        runId: context.runId,
      }),
    );
    identity.can(Post.create);
    application.gateway('agent-tools', {
      commands: [Post.create],
      authorizeCommand: async () => true,
      deployment: {
        namespace: 'research-system',
        cursorSecret: {
          name: 'research-agent-gateway-cursor',
          key: 'key',
        },
      },
    });
    const previewGraph = applicationGraphFor(application);
    if (!previewGraph) throw new Error('Expected a preview application graph.');
    expect(
      previewGraph.nodes
        .filter((node) => node.kind === 'gateway')
        .map((node) => node.name),
    ).toEqual(['agent-tools']);
    const graph = applicationGraphFor(application.composition);
    if (!graph) throw new Error('Expected an application graph.');
    expect(graph.nodes.find(node => node.kind === 'aiAgent')).toMatchObject({
      scope: { kind: 'trustedContext', name: 'workspaceId' },
    });
    expect(
      graph.nodes
        .filter((node) => node.kind === 'gateway')
        .map((node) => node.name),
    ).toEqual(['agent-tools']);
    const catalog = compileApplicationOperationCatalog(graph);
    const authority = compileApplicationWorkloadAuthority(graph, catalog);
    expect(authority).toEqual([
      expect.objectContaining({
        operationId: 'applik8s://models/Post/operations/create',
        restrictions: {
          target: { kind: 'all' },
          predicates: [],
        },
      }),
    ]);
    const outDir = await mkdtemp(join(tmpdir(), 'applik8s-agent-'));
    temporaryDirectories.push(outDir);

    const artifacts = await emitGeneratedApplicationAgents({
      graph,
      operationCatalog: catalog,
      workloadAuthority: authority,
      outDir,
      entrypoint: import.meta.filename,
    });

    expect(artifacts).toHaveLength(1);
    const artifact = artifacts[0];
    if (!artifact) throw new Error('Expected one generated agent artifact.');
    expect(artifact.container.image).toMatch(
      /^applik8s\/research-platform-ai-agent-researcher:sha-[a-f0-9]{64}$/,
    );
    expect(artifact.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'ServiceAccount',
          metadata: expect.objectContaining({
            name: 'researcher',
            namespace: 'research-system',
          }),
        }),
        expect.objectContaining({
          kind: 'Service',
          spec: expect.objectContaining({
            ports: [expect.objectContaining({ name: 'http', port: 3000 })],
          }),
        }),
        expect.objectContaining({
          kind: 'Deployment',
          spec: expect.objectContaining({
            replicas: 2,
            template: expect.objectContaining({
              spec: expect.objectContaining({
                automountServiceAccountToken: false,
                containers: [
                  expect.objectContaining({
                    resources: {
                      requests: { cpu: '100m', memory: '192Mi' },
                      limits: { cpu: '1', memory: '768Mi' },
                    },
                    env: expect.arrayContaining([
                      {
                        name: 'APPLIK8S_PROFILE_VARIANT',
                        value: '${schema.spec.profile}',
                      },
                      {
                        name: 'APPLIK8S_AI_GATEWAY_MANAGED_URL',
                        value:
                          'applik8s.deployment-output-optional/v1:direct.provider.ai.v1alpha1.inference.envoy-ai-gateway:endpoint',
                      },
                      {
                        name: expect.stringContaining(
                          'APPLIK8S_UNUSED_AI_CREDENTIAL',
                        ),
                        valueFrom: {
                          secretKeyRef: {
                            name: expect.stringContaining(
                              'schema.spec.providers.inference.credentialSecretName',
                            ),
                            key: expect.stringContaining(
                              'schema.spec.providers.inference.credentialKey',
                            ),
                            optional: true,
                          },
                        },
                      },
                      {
                        name: 'APPLIK8S_DATABASE_APPLICATION_URL',
                        valueFrom: {
                          secretKeyRef: {
                            name: 'application-app',
                            key: 'uri',
                            optional: false,
                          },
                        },
                      },
                    ]),
                  }),
                ],
              }),
            }),
          }),
        }),
      ]),
    );
    const manifest = JSON.parse(
      await readFile(artifact.manifestPath, 'utf8'),
    ) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      kind: 'GeneratedApplicationAgent',
      spec: {
        operationCatalogRevision: catalog.revision,
        tools: [
          {
            operationId: 'applik8s://models/Post/operations/create',
            transport: 'command',
            workloadAuthorityId: expect.stringMatching(/^workload-authority:/),
          },
        ],
      },
    });
    const source = await readFile(artifact.sourcePath, 'utf8');
    const generatedSource = await readFile(
      join(dirname(artifact.sourcePath), 'agent.generated.ts'),
      'utf8',
    );
    const normalizedSource = source.replaceAll('\\\n', '');
    expect(normalizedSource).toContain('x-applik8s-execution-admission');
    expect(generatedSource).toContain('invocation: invocationToken');
    expect(normalizedSource).not.toContain('x-applik8s-internal-invocation');
    expect(normalizedSource).toContain('applik8s-ai-operation-placement-error');
    expect(normalizedSource).toContain(
      'applik8s-ai-operation-placement-response-invalid',
    );
    expect(generatedSource).toContain(
      "value = responseText ? JSON.parse(responseText) : undefined",
    );
    expect(normalizedSource).toContain('createApplicationAdmissionObservationV1');
    expect(normalizedSource).toContain('applik8s-agent-admission');
    expect(normalizedSource).toContain('transport:"framework"');
    expect(normalizedSource).not.toContain('evidence: { admission }');
    expect(normalizedSource).toContain(
      'Agent execution admission is required.',
    );
    expect(normalizedSource).toContain(
      'AI operation has no compiled placement route.',
    );
    expect(normalizedSource).not.toContain(
      'requires canonical execution-principal admission',
    );
    expect(JSON.stringify(artifact.resources)).toContain(
      'APPLIK8S_INTERNAL_OPERATION_SECRET',
    );
    expect(normalizedSource).toContain('applik8s_ai_attempts');
    expect(normalizedSource).toContain('applik8s_conversations');
    expect(generatedSource).toContain(
      'createApplicationAIAgentConversationPersistence',
    );
    expect(generatedSource).toContain('applicationAgentDurableScope');
    expect(generatedSource).toContain('contract.scope.name');
    expect(generatedSource).toContain('decodeApplicationAIAgentTelemetry');
    expect(generatedSource).toContain(
      'telemetry: { run: runApplicationTelemetryBoundary }',
    );
    expect(generatedSource).toContain(
      'telemetry: decision.invocation.telemetry',
    );
    expect(generatedSource).toContain('ordinal: decision.attempt.ordinal');
    expect(generatedSource).toContain('startApplicationOpenTelemetryRuntime');
    expect(generatedSource).toContain('await closeApplicationTelemetryRuntime()');
    expect(generatedSource).toContain(
      'applicationAIConversationPrincipalScope(principal, trustedContext ?? {})',
    );
    expect(generatedSource).toContain('async function recordUsageFact');
    expect(generatedSource).toContain('applik8s_usage_facts');
    expect(generatedSource).toContain('await recordUsageFact(reservation, usage)');
    expect(generatedSource).toContain(
      'await executePostgresModelCommand({',
    );
    expect(generatedSource).toContain(
      "bindingId: 'framework.ai-usage.' + contract.name",
    );
    expect(generatedSource).toContain('context.emit(usageCreatedEvent, created)');
    expect(generatedSource).toContain("digestSecret: requiredEnv('APPLIK8S_CONTEXT_SECRET')");
    expect(artifact.frameworkCredentials).toContainEqual({
      kind: 'context',
      environmentName: 'APPLIK8S_CONTEXT_SECRET',
    });
    expect(JSON.stringify(artifact.resources)).toContain(
      'APPLIK8S_CONTEXT_SECRET',
    );
    expect(JSON.stringify(artifact.resources)).toContain(
      'research-platform-context',
    );
    expect(generatedSource).toContain('executionAdmission: admission');
    expect(generatedSource).toContain(
      'const admission = reservation.executionAdmission',
    );
    expect(generatedSource).not.toContain('INSERT INTO applik8s_usage_facts');
    expect(generatedSource).toContain('protocolRunId: reservation.runId');
    expect(generatedSource).toContain('protocolRunId: runId');
    expect(generatedSource).toContain("confidence: 'calculated'");
    expect(generatedSource).toContain('terminal.estimatedInputTokens');
    expect(generatedSource).toContain('await conversationStore.prepare()');
    expect(generatedSource).toContain(
      "access: { setting: contract.conversationAccess.setting }",
    );
    expect(generatedSource).toContain(
      '"conversationAccess":{"setting":"applik8s.context.agentConversationScope"}',
    );
    expect(generatedSource).toContain('persistence: conversationPersistence');
    expect(generatedSource).toContain(
      'applicationCausalPrincipalContext',
    );
    expect(generatedSource).toContain(
      'causalPrincipalId: causalPrincipal.id',
    );
    expect(generatedSource).toContain("kind: 'agent'");
    expect(generatedSource).toContain('threadId: body.threadId');
    expect(generatedSource).toContain('runId: body.runId');
    expect(generatedSource).toContain(
      '...causalPrincipal.grantIds',
    );
    expect(generatedSource).not.toContain(
      'pending-tanstack-server-persistence',
    );
    expect(normalizedSource).toContain('completion-uncertain');
    expect(generatedSource).toContain(
      "source: 'application-ai-attempt-runtime'",
    );
    expect(generatedSource).toContain('subject: contract.name');
    expect(generatedSource).not.toContain("subject: 'agent:' + contract.name");
    expect(generatedSource).toContain(
      "'operator-review-required'",
    );
    expect(generatedSource).toContain(
      "quarantine: failure.classification === 'completion-uncertain'",
    );
    expect(generatedSource).toContain('applik8s-agent-startup-wait');
    expect(generatedSource).toContain('agent_dependencies_unavailable');
    expect(generatedSource).toContain('initializationController.abort()');
    expect(generatedSource).toContain(
      "url.pathname === '/healthz' || url.pathname === '/readyz'",
    );
    expect(normalizedSource).toContain('APPLIK8S_PROFILE_VARIANT');
    expect(normalizedSource).toContain('starter evidence');
    expect(normalizedSource).toContain(
      '${schema.spec.providers.inference.endpoint}',
    );
    expect(generatedSource).toContain('selectedBackend?.endpoint');
    expect(generatedSource).toContain('selectedBackend?.model');
    expect(generatedSource).toContain(
      'materializeInstallationValue(selectedProviderValue(contract.provider))',
    );
    expect(normalizedSource).toContain('APPLIK8S_INSTALLATION_SPEC');
    expect(normalizedSource).toContain(
      'APPLIK8S_AI_GATEWAY_MANAGED_URL',
    );
    expect(generatedSource).toContain(
      "endpoint.pathname = (pathname || '') + '/v1';",
    );
    expect(generatedSource).toContain(
      "managedOpenAICompatibleBaseUrl(\n              requiredEnv('APPLIK8S_AI_GATEWAY_MANAGED_URL'),",
    );
    expect(normalizedSource).not.toContain('gateway-managed');
    expect(generatedSource).toContain(
      'action: decision.action,',
    );
    expect(generatedSource).toContain(
      'observe: (invocationId) => attemptRuntime.observe(invocationId),',
    );
    expect(normalizedSource).not.toContain(
      'stream joining and terminal replay must complete before redispatch',
    );
    expect(source).not.toContain('packageManagerAtStartup');
    // The selected OpenTelemetry implementation is intentionally embedded so
    // an observed agent worker is self-contained rather than relying on a
    // process-global sidecar. Keep the complete generated worker bounded.
    // Canonical observable usage recording deliberately enters the same
    // durable Postgres model kernel as application-authored creates. Keep the
    // self-contained agent bounded while accounting for that correctness
    // boundary instead of regressing to a raw SQL side channel.
    expect(artifact.sizeBytes).toBeLessThan(2_200_000);
  });
});
