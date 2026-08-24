// typecast-file-boundary: compiler tests inspect emitted JSON manifests and
// Kubernetes resources after checking their artifact and kind discriminants.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  app,
  applicationGraphFor,
  EventLog,
  IdentityProvider,
  WorkflowEngine,
  workflow,
} from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import {
  type ApplicationGraph,
  deriveApplicationGraphFoundation,
} from '@applik8s/core';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { afterEach, describe, expect, it } from 'vitest';
import { applicationProviderConsumerWorkloads } from '../src/application-deployment-graph.js';
import {
  applicationHttpProfileEnvironment,
  emitGeneratedApplicationHttpServers,
} from '../src/application-http/index.js';
import { applicationGraphJsonStringArray } from '../src/application-installation-values.js';
import { compileApplicationOperationCatalog } from '../src/application-operations/index.js';
import { applicationServerNamespace } from '../src/application-server-namespace.js';
import { compileTypeKroComposition } from '../src/pipeline/index.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })),
  );
});

describe('generated function-native HTTP worker', () => {
  it('uses the generated workload namespace as the private caller identity', () => {
    const server = {
      id: 'server.generated-caller',
      kind: 'server' as const,
      name: 'generated-caller',
      stability: 'stable' as const,
      routes: [],
      resources: [],
      indexes: [],
      observability: {
        health: {
          mode: 'http' as const,
          readinessPath: '/readyz',
          livenessPath: '/healthz',
        },
        logs: {
          format: 'json' as const,
          component: 'generated-caller',
          failureEvents: [],
        },
        metrics: { mode: 'none' as const, names: [] },
        events: [],
        sourceMaps: 'required' as const,
        replayArtifacts: [],
        diagnosticsArtifact: {
          kind: 'routeDiagnostics' as const,
          name: 'generated-caller-diagnostics',
        },
      },
      generatedResources: [{
        role: 'workload' as const,
        graphNode: { nodeId: 'generated.server.generated-caller' },
        resource: {
          apiVersion: 'apps/v1',
          kind: 'Deployment',
          name: 'generated-caller',
          namespace: 'generated-caller-system',
        },
        artifact: {
          kind: 'kubernetesManifest' as const,
          name: 'generated-caller',
        },
      }],
    };
    const graph = {
      apiVersion: 'applik8s.appGraph/v1alpha1' as const,
      kind: 'ApplicationGraph' as const,
      metadata: { name: 'generated-caller' },
      nodes: [server],
      edges: [],
      providerRequirements: [],
      providerBindings: [],
      compatibility: {
        stablePublicApis: [],
        documentedInternalContracts: [],
        experimentalSurfaces: [],
        postV3Surfaces: [],
        labels: [],
      },
    };

    expect(applicationServerNamespace(graph, server)).toBe(
      'generated-caller-system',
    );
  });

  it('lowers profile selectors into live TypeKro workload values', () => {
    expect(
      applicationHttpProfileEnvironment({
        authenticationProfile: {
          selector: 'schema.spec.profile',
        },
      }),
    ).toEqual([
      {
        name: 'APPLIK8S_PROFILE_VARIANT',
        value: '${schema.spec.profile}',
      },
    ]);
    expect(() =>
      applicationHttpProfileEnvironment({
        authenticationProfile: {
          selector: 'unsafe(profile)',
        },
      }),
    ).toThrow(/cannot be lowered/);
  });

  it('bundles authentication, authority, idempotency, and direct model operations', async () => {
    const posts = pgTable('generated_http_posts', {
      id: text('id').primaryKey(),
      body: text('body').notNull(),
      revision: text('revision').notNull().default(''),
    });
    const application = app('generated-http', {
      namespace: 'generated-http',
    });
    application.provide(
      IdentityProvider,
      IdentityProvider.deterministic({
        mode: 'starter',
        application: 'generated-http',
        subject: 'alice',
        audience: ['generated-http'],
        catalogRevision: 'catalog-v1',
        authorityRevision: 'authority-v1',
      }),
    );
    application.provide(
      EventLog,
      {
        kind: 'nats-jetstream',
        name: 'events',
        namespace: 'generated-http',
        provision: false,
        servers: ['nats://events.generated-http.svc:4222'],
      },
    );
    application.provide(
      WorkflowEngine,
      WorkflowEngine.hatchet({
        namespace: 'generated-http',
        workerTokenSecret: {
          apiVersion: 'v1',
          kind: 'Secret',
          name: 'generated-http-workflow-token',
          namespace: 'generated-http',
        },
      }),
    );
    const Database = application.database.postgres('main', {
      schema: { posts },
    });
    const Post = application.model(posts, { name: 'Post', database: Database });
    Post.create.public();
    const api = application.http('public-api', { replicas: 2 });
    const Provision = workflow('tenant.provision.v1', {
      input: type({ tenantId: 'string' }),
      output: type({ accepted: 'boolean' }),
    });
    const provision = application.workflow(
      Provision,
      { retries: 1 },
      async () => ({ accepted: true }),
    );
    api.post(
      'provision-tenant',
      '/tenants/provision',
      {
        input: type({ tenantId: 'string' }),
        output: type({ accepted: 'boolean' }),
        __generatedCalls: [provision],
        __generatedBindings: { provision },
      },
      async ({ input }) =>
        provision(input, { idempotencyKey: input.tenantId }),
    ).public();
    const createPost = api.post(
      'create-post',
      '/posts',
      {
        input: type({ id: 'string', body: 'string' }),
        output: type({
          identity: 'string',
          value: {
            id: 'string',
            body: 'string',
            revision: 'string',
          },
          'revision?': 'string',
        }),
        authorize: (_request, context) => context.principal.id === 'alice',
        // Compiler-equivalent metadata; authored source never supplies it.
        __generatedBindings: { 'Post.create': Post.create },
      },
      async ({ input }) => Post.create(input),
    );
    createPost.public();
    const listPosts = api.post(
      'list-posts',
      '/posts/list',
      {
        input: type({}),
        output: type({ count: 'number' }),
        authorize: (_request, context) => context.principal.id === 'alice',
        // Compiler-equivalent transitive helper metadata.
        __generatedBindings: { 'Post.find': Post.find },
      },
      async () => ({ count: (await Post.find({ limit: 10 })).length }),
    );
    listPosts.public();
    const Catalog = Post;
    const listCatalogPosts = api.post(
      'list-catalog-posts',
      '/catalog/posts',
      {
        input: type({}),
        output: type({ count: 'number' }),
        authorize: (_request, context) => context.principal.id === 'alice',
        // A helper may capture the model object and select its operation at
        // runtime; the generated worker must hydrate the complete handle.
        __generatedBindings: { Catalog },
      },
      async () => ({ count: (await Catalog.find({ limit: 10 })).length }),
    );
    listCatalogPosts.public();
    const Billing = { Subscription: Post };
    const listNestedSubscriptions = api.post(
      'list-nested-subscriptions',
      '/billing/subscriptions',
      {
        input: type({}),
        output: type({ count: 'number' }),
        authorize: (_request, context) => context.principal.id === 'alice',
        // Compiler-equivalent metadata for a model reached through a module
        // namespace. The emitted runtime must preserve this complete path.
        __generatedBindings: {
          'Billing.Subscription.find': Post.find,
        },
      },
      async () => ({
        count: (await Billing.Subscription.find({ limit: 10 })).length,
      }),
    );
    listNestedSubscriptions.public();
    api.webhook(
      'receive-provider-event',
      '/webhooks/provider',
      {
        event: type({ id: 'string > 0', state: "'ready' | 'failed'" }),
        output: type({ received: 'true', id: 'string > 0' }),
        authenticate: async request => {
          if (request.headers['x-provider-signature'] !== 'accepted') {
            throw new Error('invalid provider signature');
          }
          return {
            id: new TextDecoder().decode(request.body),
            state: 'ready' as const,
          };
        },
      },
      async ({ input }) => ({ received: true as const, id: input.id }),
    );
    const previewGraph = applicationGraphFor(application);
    expect(
      previewGraph?.nodes.find(
        (node) => node.kind === 'server' && node.name === 'public-api',
      ),
    ).toMatchObject({
      kind: 'server',
      routes: expect.arrayContaining([
        expect.objectContaining({ id: 'create-post' }),
      ]),
    });
    const graph = applicationGraphFor(application.composition);
    if (!graph) throw new Error('Expected an application graph.');
    const selectedEventLogServer = {
      expression:
        'schema.spec.profile == "external" ? schema.spec.providers.events.server : "nats://events.generated-http.svc:4222"',
    };
    const graphWithSelectedEventLog = {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.kind === 'provider' && node.interface === 'EventLog'
          ? {
              ...node,
              config: {
                ...node.config,
                servers: [selectedEventLogServer],
              },
            }
          : node),
    };
    const outDir = await mkdtemp(join(tmpdir(), 'applik8s-http-worker-'));
    directories.push(outDir);

    const artifacts = await emitGeneratedApplicationHttpServers({
      graph: graphWithSelectedEventLog,
      operationCatalog: compileApplicationOperationCatalog(
        graphWithSelectedEventLog,
      ),
      outDir,
    });

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      name: 'public-api',
      serverId: 'server.public-api',
      sizeBytes: expect.any(Number),
    });
    expect(artifacts[0]?.sizeBytes).toBeLessThan(625_000);
    expect(artifacts[0]!.resources.map((resource) => resource.kind)).toEqual([
      'ServiceAccount',
      'Service',
      'Deployment',
    ]);
    const source = (await readFile(artifacts[0]!.sourcePath, 'utf8'))
      .replaceAll('\\\n', '');
    const repeatedOutDir = await mkdtemp(
      join(tmpdir(), 'applik8s-http-worker-repeat-'),
    );
    directories.push(repeatedOutDir);
    const repeatedArtifacts = await emitGeneratedApplicationHttpServers({
      graph: graphWithSelectedEventLog,
      operationCatalog: compileApplicationOperationCatalog(
        graphWithSelectedEventLog,
      ),
      outDir: repeatedOutDir,
    });
    expect(
      await readFile(repeatedArtifacts[0]!.sourcePath, 'utf8'),
    ).toBe(await readFile(artifacts[0]!.sourcePath, 'utf8'));
    expect(repeatedArtifacts[0]!.container.image).toBe(
      artifacts[0]!.container.image,
    );
    const metafile = JSON.parse(
      await readFile(artifacts[0]!.metafilePath, 'utf8'),
    ) as { readonly inputs?: Readonly<Record<string, unknown>> };
    expect(source).toContain('idempotency_key_required');
    expect(source).toContain('authorization_denied');
    expect(source).toContain('applik8s.runtime/v1alpha1');
    expect(source).toContain('invalid_runtime_envelope');
    expect(source).toContain('provider-signed-webhook');
    expect(source).toContain('webhook_authentication_failed');
    expect(source).toContain('webhook_event_unsupported');
    expect(source).toContain('webhook_payload_invalid');
    expect(source).toContain('x-provider-signature');
    expect(source).toContain('provider-event:');
    expect(
      Object.keys(metafile.inputs ?? {}).some((path) =>
        path.endsWith('/task-operation-runtime.ts')),
    ).toBe(true);
    expect(
      Object.keys(metafile.inputs ?? {}).some((path) =>
        path.endsWith('/runtime-hatchet/src/index.ts')),
    ).toBe(false);
    expect(
      Object.keys(metafile.inputs ?? {}).some((path) =>
        path.endsWith('/runtime/src/signed-envelope.ts')),
    ).toBe(true);
    expect(source).toContain('applik8s://models/Post/operations/create');
    expect(source).toContain('Post.create');
    expect(source).toContain('applicationPostgresModelReadClients');
    expect(source).toContain('withApplicationNativeModelReadClients');
    expect(source).toContain('trustedContext:{values:');
    expect(source).toContain('requestOrigin:');
    expect(source).toContain('headers.get("origin")');
    expect(source).toContain('pathname!=="/"');
    expect(source).toMatch(
      /digest:[A-Za-z_$][\w$]*\.trustedContextDigest/u,
    );
    expect(source).not.toContain('__generatedBindings');
    const generatedEntrypoint = await readFile(
      join(outDir, 'public-api', 'http.generated.ts'),
      'utf8',
    );
    expect(generatedEntrypoint).toContain(
      "from '@applik8s/runtime-nats/event-log'",
    );
    expect(generatedEntrypoint).toContain(
      'validateApplicationAdmissionContextV1WithoutReceipt',
    );
    expect(generatedEntrypoint).toContain(
      'validateApplicationAdmissionContextV1({',
    );
    expect(generatedEntrypoint).toContain(
      "transport: webhookEvent ? 'webhook' : 'http'",
    );
    expect(generatedEntrypoint).toContain(
      'admission: applicationAdmissionInvocationView(baseAdmission)',
    );
    expect(generatedEntrypoint).toContain(
      '.update(canonicalJsonV1String(input))',
    );
    expect(generatedEntrypoint).not.toContain('.update(JSON.stringify(input))');
    expect(generatedEntrypoint).not.toContain(
      "from '@applik8s/runtime-aws/kinesis'",
    );
    expect(generatedEntrypoint).toMatch(
      /"Billing":\s*\{\s*"Subscription":\s*\{\s*"find":\s*modelHandle\("Post"\)\["find"\]/u,
    );
    expect(generatedEntrypoint).toContain('"Catalog": modelHandle("Post")');
    expect(generatedEntrypoint).toContain(
      '"provision": workflowHandle("workflow", "tenant.provision.v1"',
    );
    expect(generatedEntrypoint).toContain('directWorkflowScope.run');
    expect(generatedEntrypoint).toContain('occurrences: new Map()');
    expect(generatedEntrypoint).toContain('failure.retryable = false');
    expect(generatedEntrypoint).toContain(
      'if (error?.retryable === false) throw error',
    );
    expect(generatedEntrypoint).toContain(
      "context.invocationId + ':' + contractName + ':'",
    );
    expect(generatedEntrypoint).toContain(
      'correlationId:\n      metadata?.correlationId ?? context.admission.correlationId',
    );
    expect(generatedEntrypoint).not.toContain(
      'withApplicationWorkflowCausalPrincipal({',
    );
    expect(generatedEntrypoint).toContain(
      "purpose: 'applik8s.workflow-gateway-admission/v1'",
    );
    expect(generatedEntrypoint).toMatch(
      /"Post":\s*\{\s*"find":\s*modelHandle\("Post"\)\["find"\]/u,
    );
    expect(generatedEntrypoint).toMatch(
      /applicationPostgresModelReadClients\(\s*sql,\s*route\.transaction\.models,\s*\{\s*values:\s*applicationRequestContextValues\([\s\S]*?digest:\s*principal\.trustedContextDigest,[\s\S]*?changeScopes:\s*applicationRelationalChangeScopes/u,
    );
    expect(generatedEntrypoint).not.toContain(
      '"Billing": modelHandle("Post")',
    );
    const deployment = artifacts[0]!.resources.find(
      (resource) => resource.kind === 'Deployment',
    );
    const podSpec = deployment?.spec?.template
      && typeof deployment.spec.template === 'object'
      ? Reflect.get(deployment.spec.template, 'spec')
      : undefined;
    const containers = podSpec && typeof podSpec === 'object'
      ? Reflect.get(podSpec, 'containers')
      : undefined;
    const environment = Array.isArray(containers)
      && containers[0]
      && typeof containers[0] === 'object'
      ? Reflect.get(containers[0], 'env')
      : undefined;
    expect(deployment?.spec?.replicas).toBe(2);
    expect(
      Array.isArray(environment)
        ? environment.map((entry) => Reflect.get(entry, 'name'))
        : [],
    ).toEqual(expect.arrayContaining([
      'APPLIK8S_APPLICATION_NAME',
      'APPLIK8S_NAMESPACE',
      'APPLIK8S_HTTP_CONTEXT_SECRET',
      'APPLIK8S_NATS_SERVERS',
      'APPLIK8S_DATABASE_MAIN_URL',
      'APPLIK8S_WORKFLOW_GATEWAY_TOKEN_FILE',
      'APPLIK8S_INTERNAL_OPERATION_SECRET',
    ]));
    expect(Reflect.get(containers[0] as object, 'volumeMounts')).toEqual([
      expect.objectContaining({
        name: 'workflow-gateway-token',
        readOnly: true,
      }),
    ]);
    expect(Reflect.get(podSpec as object, 'volumes')).toEqual([
      expect.objectContaining({
        name: 'workflow-gateway-token',
        projected: expect.objectContaining({
          sources: [expect.objectContaining({
            serviceAccountToken: expect.objectContaining({
              audience: 'https://kubernetes.default.svc',
            }),
          })],
        }),
      }),
    ]);
    const natsServers = Array.isArray(environment)
      ? environment.find(
          (entry) => Reflect.get(entry, 'name') === 'APPLIK8S_NATS_SERVERS',
        )
      : undefined;
    expect(Reflect.get(natsServers as object, 'value')).toBe(
      applicationGraphJsonStringArray([selectedEventLogServer]),
    );
    expect(Reflect.get(natsServers as object, 'value')).not.toContain(
      'applik8s-events',
    );

    const awsOutDir = await mkdtemp(
      join(tmpdir(), 'applik8s-http-worker-aws-'),
    );
    directories.push(awsOutDir);
    await emitGeneratedApplicationHttpServers({
      graph: graphWithSelectedEventLog,
      operationCatalog: compileApplicationOperationCatalog(
        graphWithSelectedEventLog,
      ),
      outDir: awsOutDir,
      executionTarget: 'aws',
    });
    const awsGeneratedEntrypoint = await readFile(
      join(awsOutDir, 'public-api', 'http.generated.ts'),
      'utf8',
    );
    expect(awsGeneratedEntrypoint).toContain(
      "from '@applik8s/runtime-aws/kinesis'",
    );
    expect(awsGeneratedEntrypoint).not.toContain(
      "from '@applik8s/runtime-nats/event-log'",
    );
  });

  it('compiles app.http into one OCI worker and removes the raw server bundle', async () => {
    const directory = await mkdtemp(
      join(process.cwd(), '.tmp-applik8s-http-pipeline-'),
    );
    directories.push(directory);
    const entrypoint = join(directory, 'entrypoint.ts');
    await mkdir(join(directory, 'migrations'));
    await writeFile(
      join(directory, 'migrations', '0000_posts.sql'),
      'create table pipeline_http_posts (id text primary key, body text not null, revision text not null default \'\');\n',
    );
    await writeFile(entrypoint, `
import { EventLog, IdentityProvider, WorkflowEngine, app, workflow } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { pgTable, text } from 'drizzle-orm/pg-core';

const posts = pgTable('pipeline_http_posts', {
  id: text('id').primaryKey(),
  body: text('body').notNull(),
  revision: text('revision').notNull().default(''),
});
const application = app('pipeline-http', { namespace: 'pipeline-http' });
application.provide(IdentityProvider, IdentityProvider.deterministic({
  mode: 'starter',
  application: 'pipeline-http',
  subject: 'alice',
  audience: ['pipeline-http'],
  catalogRevision: 'catalog-v1',
  authorityRevision: 'authority-v1',
}));
application.provide(EventLog, {
  kind: 'nats-jetstream',
  name: 'events',
  namespace: 'pipeline-http',
  provision: false,
  servers: ['nats://events.pipeline-http.svc:4222'],
});
application.provide(WorkflowEngine, WorkflowEngine.hatchet({
  namespace: 'pipeline-http',
  workerTokenSecret: {
    apiVersion: 'v1',
    kind: 'Secret',
    name: 'pipeline-http-workflow-token',
    namespace: 'pipeline-http',
  },
}));
const Database = application.database.postgres('main', {
  schema: { posts },
  migrations: { path: './migrations' },
});
const Post = application.model(posts, { name: 'Post', database: Database });
Post.create.public();
const api = application.http('public-api', { replicas: 2 });
const Provision = workflow('tenant.provision.v1', {
  input: type({ tenantId: 'string' }),
  output: type({ accepted: 'boolean' }),
});
const provision = application.workflow(
  Provision,
  { retries: 1 },
  async () => ({ accepted: true }),
);
const provisionTenant = api.post('provision-tenant', '/tenants/provision', {
  input: type({ tenantId: 'string' }),
  output: type({ accepted: 'boolean' }),
}, async ({ input }) => provision(input, {
  idempotencyKey: input.tenantId,
}));
provisionTenant.public();
const createPost = api.post('create-post', '/posts', {
  input: type({ id: 'string', body: 'string' }),
  output: type({
    identity: 'string',
    value: { id: 'string', body: 'string', revision: 'string' },
    'revision?': 'string',
  }),
}, async ({ input }) => Post.create(input));
createPost.public();
export const pipelineHttpStack = application.composition;
`);

    const result = await compileTypeKroComposition({
      entrypoint,
      compositionName: 'pipelineHttpStack',
      outDir: join(directory, 'dist'),
      runtimeVersionRange: '^0.7.0',
      handlerAbiVersion: 'applik8s.handler/v1alpha1',
      adapter: 'wasmComponent',
      portability: {
        deterministicBuild: true,
        allowEnvironmentAccess: false,
        allowFilesystemAccess: false,
        allowNetworkAccess: false,
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
    expect(result.value.artifacts.httpArtifacts).toHaveLength(1);
    expect(result.value.artifacts.workflowArtifacts).toHaveLength(1);
    const workflowArtifact = result.value.artifacts.workflowArtifacts[0];
    expect(workflowArtifact?.resources.some((resource) =>
      resource.kind === 'Service'
      && Array.isArray(resource.spec?.ports)
      && resource.spec.ports.some((port) =>
        Reflect.get(port as object, 'name') === 'gateway'))).toBe(true);
    expect(workflowArtifact?.resources.some((resource) =>
      resource.kind === 'NetworkPolicy'
      && JSON.stringify(resource).includes('public-api'))).toBe(true);
    const workflowGeneratedSource = workflowArtifact
      ? await readFile(
          join(
            dirname(workflowArtifact.sourcePath),
            'workflow-worker.generated.ts',
          ),
          'utf8',
        )
      : '';
    expect(
      workflowGeneratedSource,
    ).toContain(
      '{"namespace":"pipeline-http","serviceAccount":"public-api","contracts":["tenant.provision.v1"]}',
    );
    expect(workflowGeneratedSource).toContain('gatewayCallerContracts');
    expect(workflowGeneratedSource).toContain(
      "audiences: ['https://kubernetes.default.svc']",
    );
    expect(workflowGeneratedSource).toContain(
      '!gatewayCallerContracts.get(gatewayCaller)?.has(contract)',
    );
    expect(workflowGeneratedSource).toContain('admission-invalid');
    const resources = result.value.artifacts.resources.filter((resource) =>
      resource.metadata?.name === 'public-api'
      || resource.metadata?.name === 'public-api-source');
    expect(resources.filter((resource) =>
      resource.kind === 'Deployment')).toHaveLength(1);
    expect(resources.filter((resource) =>
      resource.kind === 'Service')).toHaveLength(1);
    expect(resources.some((resource) =>
      resource.kind === 'ConfigMap'
      && resource.metadata?.name === 'public-api-source')).toBe(false);
    const deployment = resources.find((resource) =>
      resource.kind === 'Deployment');
    expect(deployment?.metadata?.labels).toMatchObject({
      'app.kubernetes.io/component': 'typed-http',
    });
  }, 120_000);

  it('compiles an injected provider operation without application runtime glue', async () => {
    const directory = await mkdtemp(
      join(process.cwd(), '.tmp-applik8s-provider-http-'),
    );
    directories.push(directory);
    const entrypoint = join(directory, 'entrypoint.ts');
    await mkdir(join(directory, 'migrations'));
    await writeFile(
      join(directory, 'migrations', '0000_provider_records.sql'),
      'create table provider_records (id text primary key);\n',
    );
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
import { defineApplicationProvider, module } from '@applik8s/applik8s';
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
export const acquisition = module('acquisition', application => {
  const provider = application.inject(AcquisitionProvider);
  const acquire = provider.acquire;
  async function acquireThroughHelper(input) {
    return acquire(input);
  }
  return Object.freeze({ acquire, acquireThroughHelper });
});
`);
    await writeFile(entrypoint, `
import { IdentityProvider, app } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { AcquisitionProvider, acquisition } from '@fixture/acquisition';

const application = app('provider-http', {
  namespace: 'provider-http',
  spec: type({ profile: "'starter' | 'dedicated'" }),
  status: type({ ready: 'boolean' }),
});
application.provide(IdentityProvider, IdentityProvider.deterministic({
  mode: 'starter',
  application: 'provider-http',
  subject: 'alice',
  audience: ['provider-http'],
  catalogRevision: 'catalog-v1',
  authorityRevision: 'authority-v1',
}));
const records = pgTable('provider_records', { id: text('id').primaryKey() });
const database = application.database.postgres('main', {
  schema: { records },
  migrations: { path: './migrations' },
});
application.model(records, { name: 'ProviderRecord', database });
const implementation = (source, secretName) => ({
  kind: 'acquisition',
  source,
  credentialSecret: {
    apiVersion: 'v1',
    kind: 'Secret',
    name: secretName,
    namespace: 'provider-http',
  },
  async acquire(input) { return { value: this.source + ':' + input.id }; },
});
application.profile(application.installation.spec, 'profile')
  .provide(AcquisitionProvider)
  .starter(() => implementation('starter', 'acquisition-starter'))
  .dedicated(() => implementation('dedicated', 'acquisition-dedicated'))
  .exhaustive();
const provider = application.inject(AcquisitionProvider);
const { acquire, acquireThroughHelper } = acquisition(application);
const api = application.http('public-api');
api.post('acquire-direct', '/acquire/direct', {
  input: type({ id: 'string' }),
  output: type({ value: 'string' }),
}, async ({ input }) => provider.acquire(input)).public();
api.post('acquire-extracted', '/acquire/extracted', {
  input: type({ id: 'string' }),
  output: type({ value: 'string' }),
}, async ({ input }) => acquire(input)).public();
api.post('acquire-helper', '/acquire/helper', {
  input: type({ id: 'string' }),
  output: type({ value: 'string' }),
}, async ({ input }) => acquireThroughHelper(input)).public();
const health = application.http('health-api');
health.post('health', '/health', {
  input: type({}),
  output: type({ ok: 'boolean' }),
}, async () => ({ ok: true })).public();
export const providerHttpStack = application.composition;
`);

    const compilation = {
      entrypoint,
      compositionName: 'providerHttpStack',
      outDir: join(directory, 'dist'),
      runtimeVersionRange: '^0.8.0',
      handlerAbiVersion: 'applik8s.handler/v1alpha1',
      adapter: 'wasmComponent',
      portability: {
        deterministicBuild: true,
        allowEnvironmentAccess: false,
        allowFilesystemAccess: false,
        allowNetworkAccess: false,
        allowedHostImports: [],
        sourceMaps: {
          emit: true,
          includeSourceContent: false,
          redactPaths: false,
        },
      },
    } as const;
    const result = await compileTypeKroComposition(compilation);

    expect(result.ok, result.ok ? undefined : result.error.message).toBe(true);
    if (!result.ok) return;
    const artifact = result.value.artifacts.httpArtifacts.find(
      (candidate) => candidate.serverId === 'server.public-api',
    );
    if (!artifact) throw new Error('Expected a generated provider HTTP worker.');
    const source = await readFile(artifact.sourcePath, 'utf8');
    expect(source).toContain('APPLIK8S_PROFILE_VARIANT');
    expect(source).toContain('acquireItem');
    expect(source).toContain('dedicated');
    const deployment = artifact.resources.find(
      (resource) => resource.kind === 'Deployment',
    );
    const deploymentSource = JSON.stringify(deployment);
    expect(deploymentSource).toContain('APPLIK8S_PROFILE_VARIANT');
    expect(deploymentSource).toContain('ACQUISITION_SOURCE');
    expect(deploymentSource).toContain('ACQUISITION_TOKEN');
    expect(deploymentSource).toContain('acquisition-starter');
    const unrelated = result.value.artifacts.httpArtifacts.find(
      (candidate) => candidate.serverId === 'server.health-api',
    );
    expect(JSON.stringify(unrelated?.resources ?? [])).not.toContain(
      'ACQUISITION_TOKEN',
    );
    const graph = JSON.parse(
      await readFile(
        result.value.artifacts.applicationGraphJsonPath ?? '',
        'utf8',
      ),
    ) as ApplicationGraph;
    const providerNode = graph.nodes.find(
      (node) => node.kind === 'provider'
        && node.interface === 'AcquisitionProvider',
    );
    expect(providerNode?.kind).toBe('provider');
    if (providerNode?.kind !== 'provider') return;
    expect(providerNode.config?.callableRuntime).toMatchObject({
      kind: 'profileSelection',
      cases: {
        starter: {
          runtime: {
            env: { ACQUISITION_SOURCE: 'starter' },
            secretEnv: {
              ACQUISITION_TOKEN: {
                secret: expect.objectContaining({
                  kind: 'Secret',
                  name: 'acquisition-starter',
                }),
                key: 'token',
              },
            },
            readiness: expect.objectContaining({
              condition: 'the selected acquisition credential is projected',
              timeoutSeconds: 30,
            }),
          },
        },
      },
    });
    expect(
      [...applicationProviderConsumerWorkloads(
        graph,
        new Set([providerNode.id]),
      )],
    ).toEqual(['public-api']);
    const serverNode = graph.nodes.find(
      (node) => node.kind === 'server' && node.id === 'server.public-api',
    );
    expect(
      serverNode?.kind === 'server'
        ? serverNode.routes.flatMap(
            (route) => route.functionNative?.providerBindings ?? [],
          )
        : [],
    ).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: expect.objectContaining({ nodeId: providerNode.id }),
        operation: expect.objectContaining({
          runtime: expect.objectContaining({
            access: expect.objectContaining({
              operations: expect.arrayContaining([
                'connection.use',
                'network.connect',
              ]),
            }),
          }),
        }),
      }),
    ]));
    const access = deriveApplicationGraphFoundation(graph)
      .runtimeAccess.filter(
        (requirement) =>
          requirement.target.capabilityId === providerNode.id,
      );
    expect(access).toEqual(expect.arrayContaining([
      expect.objectContaining({
        consumer: expect.objectContaining({ nodeId: 'server.public-api' }),
        target: expect.objectContaining({ operation: 'connection.use' }),
      }),
      expect.objectContaining({
        consumer: expect.objectContaining({ nodeId: 'server.public-api' }),
        target: expect.objectContaining({ operation: 'network.connect' }),
      }),
    ]));
    expect(
      access.every(
        (requirement) => requirement.consumer.nodeId === 'server.public-api',
      ),
    ).toBe(true);
    const repeated = await compileTypeKroComposition({
      ...compilation,
      outDir: join(directory, 'dist-repeat'),
    });
    expect(repeated.ok, repeated.ok ? undefined : repeated.error.message).toBe(true);
    if (!repeated.ok) return;
    const repeatedArtifact = repeated.value.artifacts.httpArtifacts.find(
      (candidate) => candidate.serverId === 'server.public-api',
    );
    expect(repeatedArtifact?.digest).toBe(artifact.digest);
    expect(await readFile(repeatedArtifact?.sourcePath ?? '', 'utf8')).toBe(source);
    const missingRuntimeGraph = {
      ...graph,
      nodes: graph.nodes.filter(
        (node) => node.id !== 'server.health-api',
      ).map((node) =>
        node.kind !== 'server' || node.id !== 'server.public-api'
          ? node
          : {
              ...node,
              routes: node.routes.map((route) => ({
                ...route,
                ...(route.functionNative
                  ? {
                      functionNative: {
                        ...route.functionNative,
                        providerBindings:
                          route.functionNative.providerBindings?.map(
                            (binding) => ({
                              ...binding,
                              ...(binding.operation
                                ? {
                                    operation: {
                                      member: binding.operation.member,
                                    },
                                  }
                                : {}),
                            }),
                          ),
                      },
                    }
                  : {}),
              })),
            }),
      edges: graph.edges.filter(
        (edge) => edge.from.nodeId !== 'server.health-api'
          && edge.to.nodeId !== 'server.health-api',
      ),
    } as ApplicationGraph;
    await expect(
      emitGeneratedApplicationHttpServers({
        graph: missingRuntimeGraph,
        outDir: join(directory, 'missing-runtime'),
      }),
    ).rejects.toThrow(/has no public static runtime operation/);
    const placementOnlyGraph = {
      ...missingRuntimeGraph,
      nodes: missingRuntimeGraph.nodes.map((node) =>
        node.kind !== 'server'
          ? node
          : {
              ...node,
              routes: node.routes.map((route) => ({
                ...route,
                ...(route.functionNative
                  ? {
                      functionNative: {
                        ...route.functionNative,
                        providerBindings:
                          route.functionNative.providerBindings?.map(
                            ({ operation: _operation, ...binding }) => binding,
                          ),
                      },
                    }
                  : {}),
              })),
            }),
    } as ApplicationGraph;
    await expect(
      emitGeneratedApplicationHttpServers({
        graph: placementOnlyGraph,
        outDir: join(directory, 'placement-only'),
      }),
    ).rejects.toThrow(/has no callable operation metadata/);
  }, 120_000);
});
