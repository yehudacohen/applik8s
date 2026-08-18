// typecast-file-boundary: compiler tests inspect emitted JSON manifests and
// Kubernetes resources after checking their artifact and kind discriminants.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  app,
  applicationGraphFor,
  EventLog,
  IdentityProvider,
} from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applicationHttpProfileEnvironment,
  emitGeneratedApplicationHttpServers,
} from '../src/application-http/index.js';
import { applicationGraphJsonStringArray } from '../src/application-installation-values.js';
import { compileApplicationOperationCatalog } from '../src/application-operations/index.js';
import { compileTypeKroComposition } from '../src/pipeline/index.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })),
  );
});

describe('generated function-native HTTP worker', () => {
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
    const Database = application.database.postgres('main', {
      schema: { posts },
    });
    const Post = application.model(posts, { name: 'Post', database: Database });
    Post.create.public();
    const api = application.http('public-api', { replicas: 2 });
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
    expect(generatedEntrypoint).toMatch(
      /"Billing":\s*\{\s*"Subscription":\s*\{\s*"find":\s*modelHandle\("Post"\)\["find"\]/u,
    );
    expect(generatedEntrypoint).toContain('"Catalog": modelHandle("Post")');
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
    ]));
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
import { EventLog, IdentityProvider, app } from '@applik8s/applik8s';
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
const Database = application.database.postgres('main', {
  schema: { posts },
  migrations: { path: './migrations' },
});
const Post = application.model(posts, { name: 'Post', database: Database });
Post.create.public();
const api = application.http('public-api', { replicas: 2 });
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
});
