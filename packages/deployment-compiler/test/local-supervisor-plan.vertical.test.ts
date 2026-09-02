// typecast-file-boundary: Literal graph fixtures exercise the public local-target compiler contract.
import { type ApplicationGraph, validateApplicationPlan } from '@applik8s/core';
import { applicationRuntimeEndpointEnvironmentName, serializeLocalSupervisorPlan, validateLocalSupervisorPlan } from '@applik8s/deployment-contract';
import { describe, expect, it } from 'vitest';
import { compileLocalApplicationPlan, compileLocalSupervisorPlan as compileLocalSupervisorPlanBase } from '../src/index.js';

type LocalPlanRequest = Parameters<typeof compileLocalSupervisorPlanBase>[0];
function compileLocalSupervisorPlan(
  request: Omit<LocalPlanRequest, 'applicationHostFrameworkCredentials'>
    & Partial<Pick<LocalPlanRequest, 'applicationHostFrameworkCredentials'>>,
) {
  return compileLocalSupervisorPlanBase({
    applicationHostFrameworkCredentials: [],
    ...request,
  });
}

describe('local supervisor plan compiler', () => {
  it('lowers a profile-selected stateful graph deterministically without secret values', () => {
    const graph = applicationGraph();
    const runtimeArtifacts = [{ nodeId: 'processor.events', name: 'events', role: 'processor' as const, source: '/workspace/app/.applik8s/build/processor.mjs', digest: `sha256:${'a'.repeat(64)}` as const }];
    const first = compileLocalSupervisorPlan({ graph, target: 'local', profile: 'starter', projectDigest: 'sha256:project', projectDirectory: '/workspace/app', runtimeArtifacts });
    const second = compileLocalSupervisorPlan({ graph: { ...graph, nodes: [...graph.nodes].reverse() }, target: 'local', profile: 'starter', projectDigest: 'sha256:project', projectDirectory: '/workspace/app', runtimeArtifacts });

    expect(validateLocalSupervisorPlan(first)).toEqual({ valid: true, diagnostics: [] });
    expect(serializeLocalSupervisorPlan(first)).toBe(serializeLocalSupervisorPlan(second));
    expect(first.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'provider:provider.database', kind: 'container', image: 'postgres:17-alpine' }),
      expect.objectContaining({ id: 'provider:provider.events', kind: 'container', image: 'nats:2.11-alpine' }),
      expect.objectContaining({
        id: 'provider:provider.observability',
        kind: 'container',
        image: 'ghcr.io/open-telemetry/opentelemetry-collector-releases/opentelemetry-collector-contrib:0.153.0',
        lifecycle: { ownership: 'application', retention: 'ephemeral' },
        volumes: [],
        health: { kind: 'http', path: '/', portBinding: 'endpoint:provider.observability:health', timeoutMs: 30_000 },
      }),
      expect.objectContaining({ id: 'process:server.web', kind: 'process', command: 'bun' }),
      expect.objectContaining({
        id: 'runtime:processor:processor.events', kind: 'process', command: 'node', args: ['/workspace/app/.applik8s/build/processor.mjs'],
        environment: expect.arrayContaining([
          expect.objectContaining({ name: 'APPLIK8S_NATS_SERVERS' }),
          { name: 'OTEL_EXPORTER_OTLP_ENDPOINT', binding: 'endpoint:provider.observability:otlp' },
        ]),
      }),
    ]));
    expect(first.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'process:server.web',
        environment: expect.arrayContaining([{ name: 'OTEL_EXPORTER_OTLP_ENDPOINT', binding: 'endpoint:provider.observability:otlp' }]),
      }),
    ]));
    const encoded = serializeLocalSupervisorPlan(first);
    expect(encoded).not.toContain('password-value');
    expect(encoded).not.toContain('secret-value');
    expect(encoded).not.toContain('credential:framework:');
    expect(encoded).toContain('credential:provider.database:password');

    const applicationPlan = compileLocalApplicationPlan({ graph, supervisor: first, workspaceRoot: '/workspace/app' });
    expect(validateApplicationPlan(applicationPlan)).toMatchObject({ valid: true });
    expect(applicationPlan.physical.nativePlans).toEqual([
      expect.objectContaining({ authority: 'local-supervisor', resourceIds: expect.arrayContaining(['process:server.web', 'provider:provider.database']) }),
    ]);
    expect(applicationPlan.physical.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ deploymentNodeId: 'process:server.web', kind: 'externalProvider', provider: expect.objectContaining({ implementation: 'process' }) }),
      expect.objectContaining({ deploymentNodeId: 'provider:provider.database', kind: 'externalProvider', provider: expect.objectContaining({ implementation: 'container' }) }),
    ]));
    expect(applicationPlan.physical.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ relationship: 'requiresReady' }),
    ]));
    expect(applicationPlan.semantic.observability).toEqual(expect.arrayContaining([
      expect.objectContaining({
        topology: {
          collector: 'local-collector', protocol: 'otlp/http-protobuf', endpoint: 'supervisor-assigned',
          lifecycle: 'ephemeral', authentication: 'none', tls: 'plaintext-loopback',
        },
      }),
    ]));
  });

  it('lowers Hatchet to a bounded local engine, database, and short-lived worker credential', () => {
    const graph = applicationGraph();
    const plan = compileLocalSupervisorPlan({
      graph: { ...graph, nodes: graph.nodes.map((node) => node.id === 'provider.database' && node.kind === 'provider' ? { ...node, interface: 'WorkflowEngine', implementation: 'hatchet', config: {} } : node) },
      target: 'local',
      profile: 'starter',
      projectDigest: 'sha256:project',
    });
    expect(validateLocalSupervisorPlan(plan)).toEqual({ valid: true, diagnostics: [] });
    expect(plan.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'provider:provider.database.database', image: 'postgres:17-alpine' }),
      expect.objectContaining({
        id: 'provider:provider.database',
        image: 'ghcr.io/hatchet-dev/hatchet/hatchet-lite:v0.94.10',
        dependsOn: ['provider:provider.database.database'],
        readyOutputs: [expect.objectContaining({ binding: 'workflow:provider.database:worker-token', command: expect.arrayContaining(['--expiresIn', '24h']) })],
      }),
    ]));
    expect(serializeLocalSupervisorPlan(plan)).not.toContain('HATCHET_CLIENT_TOKEN=');
  });

  it('wires external OTLP headers and custom trust only through declared Secret sources', () => {
    const base = applicationGraph();
    const graph: ApplicationGraph = {
      ...base,
      nodes: base.nodes.map((node) => node.id === 'provider.observability' ? {
        ...node,
        implementation: 'otlp',
        config: {
          observability: {
            kind: 'otlp', endpoint: 'https://collector.example/tenant/demo', protocol: 'http/protobuf',
            signals: ['traces', 'logs'], policy: {}, retention: {},
            authentication: {
              secret: { apiVersion: 'v1', kind: 'Secret', name: 'telemetry-auth', namespace: 'telemetry' },
              key: 'token', header: 'x-collector-token',
            },
            tls: {
              trust: 'custom-ca',
              certificateAuthority: { apiVersion: 'v1', kind: 'Secret', name: 'telemetry-ca', namespace: 'telemetry' },
              key: 'ca.crt', serverName: 'collector.example',
            },
          },
        },
      } : node),
    };
    const plan = compileLocalSupervisorPlan({
      graph, target: 'local', profile: 'starter', projectDigest: 'sha256:project',
      generatedSecrets: [
        {
          id: 'telemetry-auth', namespace: 'telemetry', name: 'telemetry-auth', consumers: ['server.web'], referenceMode: 'staticIdentity',
          values: { token: { kind: 'hostEnvironment', name: 'TEST_OTLP_TOKEN' } },
        },
        {
          id: 'telemetry-ca', namespace: 'telemetry', name: 'telemetry-ca', consumers: ['server.web'], referenceMode: 'staticIdentity',
          values: { 'ca.crt': { kind: 'hostEnvironment', name: 'TEST_OTLP_CA_PEM' } },
        },
      ],
    });
    expect(validateLocalSupervisorPlan(plan)).toEqual({ valid: true, diagnostics: [] });
    const applicationPlan = compileLocalApplicationPlan({ graph, supervisor: plan });
    expect(applicationPlan.semantic.observability).toEqual(expect.arrayContaining([
      expect.objectContaining({
        topology: {
          collector: 'external-collector', protocol: 'otlp/http-protobuf',
          endpoint: 'https://collector.example/tenant/demo', lifecycle: 'external',
          authentication: 'secret-header', tls: 'custom-ca',
        },
      }),
    ]));
    expect(plan.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'provider:provider.observability', kind: 'external', provider: 'otlp',
        lifecycle: { ownership: 'external', retention: 'external' },
      }),
      expect.objectContaining({
        id: 'process:server.web',
        environment: expect.arrayContaining([
          { name: 'OTEL_EXPORTER_OTLP_ENDPOINT', binding: 'endpoint:provider.observability:otlp' },
          { name: 'APPLIK8S_OTLP_SIGNALS', binding: 'literal:traces,logs' },
          { name: 'APPLIK8S_OTLP_HEADER_NAME', binding: 'literal:x-collector-token' },
          expect.objectContaining({ name: 'APPLIK8S_OTLP_HEADER_VALUE' }),
          expect.objectContaining({ name: 'APPLIK8S_OTLP_CA_PEM' }),
          { name: 'APPLIK8S_OTLP_SERVER_NAME', binding: 'literal:collector.example' },
        ]),
      }),
    ]));
    const serialized = serializeLocalSupervisorPlan(plan);
    expect(serialized).toContain('TEST_OTLP_TOKEN');
    expect(serialized).toContain('TEST_OTLP_CA_PEM');
    expect(serialized).not.toContain('secret-header-canary');
  });

  it('places a qualified Hatchet Scheduler and canonical occurrence authority on the local ApplicationHost', () => {
    const base = applicationGraph();
    const schedulerId = 'provider.scheduler.v1alpha1.hosted';
    const graph: ApplicationGraph = {
      ...base,
      nodes: [
        ...base.nodes,
        {
          id: schedulerId,
          kind: 'provider',
          name: 'Scheduler',
          stability: 'stable',
          interface: 'Scheduler',
          implementation: 'hatchet-scheduler',
          config: {
            qualification: { capability: 'Scheduler', name: 'hosted', compatibilityRevision: 'v1alpha1' },
            scheduler: {
              kind: 'hatchet-scheduler',
              workflowEngine: { kind: 'hatchet', name: 'hosted-hatchet' },
            },
          },
        },
        {
          id: 'schedule.cleanup',
          kind: 'schedule',
          name: 'cleanup',
          stability: 'experimental',
          definition: {
            id: 'cleanup.v1',
            configuration: 'fixed',
            cron: '0 3 * * *',
            timezone: 'UTC',
            overlap: 'skip',
            misfires: 'latest',
            maximumLatenessSeconds: 300,
            retry: { maxAttempts: 3, maximumAgeSeconds: 300 },
            requirements: { configuration: 'fixed', cardinality: 'bounded', precision: 'minute' },
          },
          scheduler: { interface: 'Scheduler', nodeId: schedulerId },
          state: { interface: 'TransactionalDatabase', nodeId: 'provider.database' },
          handler: { source: 'async () => undefined' },
          functionNative: true,
        },
      ],
      edges: [
        ...base.edges,
        { from: { nodeId: schedulerId }, to: { nodeId: 'schedule.cleanup' }, relationship: 'provides' },
        { from: { nodeId: 'provider.database' }, to: { nodeId: 'schedule.cleanup' }, relationship: 'provides' },
      ],
    };
    const plan = compileLocalSupervisorPlan({
      graph,
      target: 'local',
      profile: 'starter',
      projectDigest: 'sha256:project',
    });

    expect(validateLocalSupervisorPlan(plan)).toEqual({ valid: true, diagnostics: [] });
    expect(plan.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: `provider:${schedulerId}`, image: 'ghcr.io/hatchet-dev/hatchet/hatchet-lite:v0.94.10' }),
      expect.objectContaining({ id: `provider:${schedulerId}.database`, image: 'postgres:17-alpine' }),
    ]));
    const host = plan.resources.find(({ id }) => id === 'process:server.web');
    expect(host).toMatchObject({
      kind: 'process',
      dependsOn: expect.arrayContaining([
        `provider:${schedulerId}`,
        `provider:${schedulerId}.database`,
      ]),
      environment: expect.arrayContaining([
        expect.objectContaining({ name: 'APPLIK8S_SCHEDULE_DATABASE_URL' }),
        expect.objectContaining({ name: expect.stringMatching(/^APPLIK8S_HATCHET_SCHEDULER_TOKEN_[A-F0-9]{12}$/u) }),
        expect.objectContaining({ name: expect.stringMatching(/^APPLIK8S_HATCHET_SCHEDULER_HOST_[A-F0-9]{12}$/u) }),
        expect.objectContaining({ name: expect.stringMatching(/^APPLIK8S_HATCHET_SCHEDULER_API_[A-F0-9]{12}$/u) }),
      ]),
    });
  });

  it('treats typed HTTP servers as runtime endpoints behind one managed application host', () => {
    const base = applicationGraph();
    const secondServer = {
      ...base.nodes.find((node) => node.id === 'server.web')!,
      id: 'server.billing',
      name: 'billing',
    };
    const graph: ApplicationGraph = {
      ...base,
      nodes: [
        ...base.nodes,
        secondServer,
        {
          id: 'provider.ApplicationHost',
          kind: 'provider',
          name: 'ApplicationHost',
          stability: 'stable',
          interface: 'ApplicationHost',
          implementation: 'managed-application-host',
          config: { kind: 'managed-application-host', port: 3000 },
        },
      ],
    };

    const plan = compileLocalSupervisorPlan({
      graph,
      target: 'local',
      profile: 'starter',
      projectDigest: 'sha256:project',
    });

    expect(plan.diagnostics.filter(({ severity }) => severity === 'error')).toEqual([]);
    expect(plan.resources.filter(({ kind }) => kind === 'process')).toEqual([
      expect.objectContaining({ id: 'process:provider.ApplicationHost' }),
    ]);
  });

  it('runs CRD dispatchers behind one persistent local resource authority and wires the web host to it', () => {
    const graph = applicationGraph();
    const plan = compileLocalSupervisorPlan({
      graph,
      target: 'local',
      profile: 'starter',
      projectDigest: 'sha256:project',
      projectDirectory: '/workspace/app',
      localResourceAuthorityModule: '/workspace/node_modules/@applik8s/server/dist/local-resource-authority-process.js',
      runtimeArtifacts: [{
        nodeId: 'operator.guestbook', name: 'guestbook', role: 'operator',
        source: '/workspace/app/.applik8s/operators/handler.js',
        manifest: '/workspace/app/.applik8s/operators/operator-manifest.json',
        digest: `sha256:${'a'.repeat(64)}`,
      }],
    });
    expect(validateLocalSupervisorPlan(plan)).toEqual({ valid: true, diagnostics: [] });
    expect(plan.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'runtime:local-resource-authority', kind: 'process',
        environment: expect.arrayContaining([
          { name: 'APPLIK8S_LOCAL_RESOURCE_TOKEN', binding: 'credential:framework:local-resource' },
          expect.objectContaining({ name: 'APPLIK8S_LOCAL_OPERATOR_ARTIFACTS' }),
        ]),
      }),
      expect.objectContaining({
        id: 'process:server.web',
        dependsOn: expect.arrayContaining(['runtime:local-resource-authority']),
        environment: expect.arrayContaining([
          { name: 'APPLIK8S_LOCAL_RESOURCE_URL', binding: 'endpoint:runtime:local-resource-authority:http' },
          { name: 'APPLIK8S_LOCAL_RESOURCE_TOKEN', binding: 'credential:framework:local-resource' },
        ]),
      }),
    ]));
    expect(plan.resources.some((resource) => resource.id === 'runtime:operator:operator.guestbook')).toBe(false);
  });

  it('injects provider bindings only into the semantic workload that references them', () => {
    const base = applicationGraph();
    const graph: ApplicationGraph = {
      ...base,
      nodes: [
        ...base.nodes,
        { id: 'provider.objects', kind: 'provider', name: 'objects', stability: 'stable', interface: 'ObjectStorage', implementation: 's3', config: { bucket: 'documents' } },
      ],
      edges: [
        ...base.edges,
        { from: { nodeId: 'server.web' }, to: { nodeId: 'provider.objects' }, relationship: 'writes' },
      ],
    };
    const plan = compileLocalSupervisorPlan({
      graph,
      target: 'local',
      profile: 'starter',
      projectDigest: 'sha256:project',
      runtimeArtifacts: [{ nodeId: 'processor.events', name: 'events', role: 'processor', source: '/workspace/processor.mjs', digest: `sha256:${'a'.repeat(64)}` }],
    });
    const processor = plan.resources.find(({ id }) => id === 'runtime:processor:processor.events');
    const host = plan.resources.find(({ id }) => id === 'process:server.web');
    expect(processor?.kind).toBe('process');
    expect(host?.kind).toBe('process');
    const processorEnvironment = processor?.kind === 'process' ? processor.environment.map(({ name }) => name) : [];
    const hostEnvironment = host?.kind === 'process' ? host.environment.map(({ name }) => name) : [];
    expect(processorEnvironment).toContain('APPLIK8S_NATS_SERVERS');
    expect(processorEnvironment).not.toContain('APPLIK8S_OBJECT_STORAGE_ENDPOINT');
    expect(processorEnvironment).not.toContain('AWS_ACCESS_KEY_ID');
    expect(hostEnvironment).toContain('APPLIK8S_OBJECT_STORAGE_ENDPOINT');
    expect(hostEnvironment).toContain('AWS_ACCESS_KEY_ID');
    expect(hostEnvironment).not.toContain('APPLIK8S_NATS_SERVERS');
  });

  it('projects only declared host-environment credentials into the exact provider consumer', () => {
    const base = applicationGraph();
    const paymentProvider = {
      id: 'provider.payments', kind: 'provider', name: 'payments', stability: 'stable',
      interface: 'PaymentProvider', implementation: 'stripe',
    } as const;
    const graph = {
      ...base,
      nodes: [...base.nodes, paymentProvider],
      edges: [
        ...base.edges,
        { from: { nodeId: 'server.web' }, to: { nodeId: paymentProvider.id }, relationship: 'dependsOn' },
      ],
      providerRequirements: [{
        id: 'requirement.payments', interface: 'PaymentProvider', consumer: { nodeId: 'server.web' },
        provider: { interface: 'PaymentProvider', nodeId: paymentProvider.id }, required: true,
        purpose: 'payments', diagnostics: { missing: 'missing', ambiguous: 'ambiguous' },
      }],
      providerBindings: [{
        requirement: 'requirement.payments',
        provider: { interface: 'PaymentProvider', nodeId: paymentProvider.id },
        generatedResources: [],
        runtime: {
          env: { APPLIK8S_PAYMENT_PROVIDER_KIND: 'stripe' },
          secretEnv: {
            APPLIK8S_PAYMENT_API_KEY: {
              secret: { apiVersion: 'v1', kind: 'Secret', name: 'demo-payments', namespace: 'demo-system' },
              key: 'apiKey',
            },
          },
        },
      }],
    } as unknown as ApplicationGraph;
    const plan = compileLocalSupervisorPlan({
      graph,
      target: 'local',
      profile: 'starter',
      projectDigest: 'sha256:project',
      installationSpec: {
        name: 'demo', profile: 'developer', providers: {
          payments: {
            secretName: 'demo-payments',
            credentialSource: { kind: 'hostEnvironment', apiKeyVariable: 'DECLARED_STRIPE_KEY' },
          },
        },
      },
      generatedSecrets: [{
        id: 'agentic-managed.payments',
        namespace: 'demo-system',
        name: 'demo-payments',
        values: {
          apiKey: { kind: 'hostEnvironment', name: 'DECLARED_STRIPE_KEY' },
        },
        consumers: [paymentProvider.id, 'server.web'],
        referenceMode: 'staticIdentity',
      }],
      runtimeArtifacts: [{ nodeId: 'processor.events', name: 'events', role: 'processor', source: '/workspace/processor.mjs', digest: `sha256:${'a'.repeat(64)}` }],
    });

    expect(validateLocalSupervisorPlan(plan)).toEqual({ valid: true, diagnostics: [] });
    const hostBinding = plan.bindings.find(({ kind }) => kind === 'hostEnvironment');
    expect(hostBinding).toMatchObject({
      owner: 'authority:host-environment',
      sensitivity: 'sensitive',
      sourceEnvironment: 'DECLARED_STRIPE_KEY',
    });
    expect(hostBinding).not.toHaveProperty('value');
    const host = plan.resources.find(({ id }) => id === 'process:server.web');
    const processor = plan.resources.find(({ id }) => id === 'runtime:processor:processor.events');
    const serializedPlan = serializeLocalSupervisorPlan(plan);
    expect(host).toMatchObject({
      kind: 'process',
      environment: expect.arrayContaining([
        { name: 'APPLIK8S_PAYMENT_PROVIDER_KIND', binding: 'literal:stripe' },
        { name: 'APPLIK8S_PAYMENT_API_KEY', binding: hostBinding?.id },
      ]),
    });
    expect(JSON.stringify(processor)).not.toContain('APPLIK8S_PAYMENT_API_KEY');
    expect(serializedPlan).not.toContain('a-secret-value');
  });

  it('assembles external database credentials locally without serializing values', () => {
    const base = applicationGraph();
    const graph = {
      ...base,
      metadata: { name: 'external-data', namespace: 'application' },
      nodes: [
        ...base.nodes.filter((node) => node.id !== 'provider.database'),
        {
          id: 'provider.database', kind: 'provider', name: 'database', stability: 'stable',
          interface: 'TransactionalDatabase', implementation: 'postgres',
          config: {
            transactionalDatabase: {
              kind: 'postgres', name: 'primary-external', namespace: 'application',
              ownership: 'external', provision: false,
              connectionSecret: { apiVersion: 'v1', kind: 'Secret', name: 'primary-external-connection', namespace: 'application' },
              connectionSecretKey: 'uri',
              externalConnection: { kind: 'environment', host: 'postgres.example.test', port: 5432, database: 'application' },
            },
          },
        },
        {
          id: 'model.Note', kind: 'model', name: 'Note', stability: 'stable',
          database: { interface: 'TransactionalDatabase', nodeId: 'provider.database' },
          runtime: {
            name: 'Note', tableName: 'notes', provider: 'postgres', database: 'application',
            clusterName: 'primary-external', secretName: 'primary-external-connection',
            secretNamespace: 'application', secretKey: 'uri',
            connectionEnvName: 'APPLIK8S_TRANSACTIONAL_DATABASE_NOTE_DATABASE_URL',
            constraints: [], indexes: [], retention: { mode: 'retain' },
          },
        },
      ],
      edges: [
        ...base.edges,
        { from: { nodeId: 'provider.database' }, to: { nodeId: 'server.web' }, relationship: 'provides' },
      ],
    } as unknown as ApplicationGraph;
    const generatedSecrets = [{
      id: 'provider.database.external-connection',
      namespace: 'application',
      name: 'primary-external-connection',
      consumers: ['provider.database'],
      referenceMode: 'staticIdentity' as const,
      values: {
        username: { kind: 'hostEnvironment' as const, name: 'POSTGRES_USER' },
        password: { kind: 'hostEnvironment' as const, name: 'POSTGRES_PASSWORD' },
        uri: {
          kind: 'template' as const,
          segments: [
            { kind: 'literal' as const, value: 'postgresql://' },
            { kind: 'value' as const, key: 'username', transform: 'uriComponent' as const },
            { kind: 'literal' as const, value: ':' },
            { kind: 'value' as const, key: 'password', transform: 'uriComponent' as const },
            { kind: 'literal' as const, value: '@postgres.example.test:5432/application' },
          ],
        },
      },
    }];
    const plan = compileLocalSupervisorPlan({
      graph, target: 'local', profile: 'external', projectDigest: 'sha256:project', generatedSecrets,
    });

    expect(validateLocalSupervisorPlan(plan)).toEqual({ valid: true, diagnostics: [] });
    const host = plan.resources.find(({ id }) => id === 'process:server.web');
    expect(host).toMatchObject({
      kind: 'process',
      environment: expect.arrayContaining([
        expect.objectContaining({
          name: 'DATABASE_URL',
          template: expect.arrayContaining([
            expect.objectContaining({ kind: 'binding', transform: 'uriComponent' }),
          ]),
        }),
      ]),
    });
    const serialized = serializeLocalSupervisorPlan(plan);
    expect(serialized).toContain('POSTGRES_USER');
    expect(serialized).toContain('POSTGRES_PASSWORD');
    expect(serialized).not.toContain('resolved-user');
    expect(serialized).not.toContain('resolved-password');
    expect(plan.resources.find(({ id }) => id === 'provider:provider.database')).toMatchObject({
      kind: 'external',
      lifecycle: { ownership: 'external', retention: 'external' },
    });
  });

  it('hydrates only declared generated-runtime endpoints and orders the caller after its receiver', () => {
    const graph = applicationGraph();
    const endpointEnvironmentName = applicationRuntimeEndpointEnvironmentName('gateway.internal');
    const plan = compileLocalSupervisorPlan({
      graph,
      target: 'local',
      profile: 'starter',
      projectDigest: 'sha256:project',
      runtimeArtifacts: [
        {
          nodeId: 'processor.events', name: 'events', role: 'processor', source: '/workspace/processor.mjs', digest: `sha256:${'a'.repeat(64)}`,
          runtimeEndpoints: [{ nodeId: 'gateway.internal', environmentName: endpointEnvironmentName }],
        },
        { nodeId: 'gateway.internal', name: 'internal', role: 'reactive', source: '/workspace/gateway.mjs', digest: `sha256:${'b'.repeat(64)}` },
        { nodeId: 'gateway.unrelated', name: 'unrelated', role: 'reactive', source: '/workspace/unrelated.mjs', digest: `sha256:${'c'.repeat(64)}` },
      ],
    });
    expect(validateLocalSupervisorPlan(plan)).toEqual({ valid: true, diagnostics: [] });
    const caller = plan.resources.find(({ id }) => id === 'runtime:processor:processor.events');
    expect(caller).toMatchObject({
      kind: 'process',
      dependsOn: expect.arrayContaining(['runtime:reactive:gateway.internal']),
      environment: expect.arrayContaining([{
        name: endpointEnvironmentName,
        binding: 'endpoint:runtime:reactive:gateway.internal:http',
      }]),
    });
    expect(JSON.stringify(caller)).not.toContain(applicationRuntimeEndpointEnvironmentName('gateway.unrelated'));
  });

  it('projects exact framework credentials to their declaring runtime and denies sibling credentials', () => {
    const plan = compileLocalSupervisorPlan({
      graph: applicationGraph(),
      target: 'local',
      profile: 'starter',
      projectDigest: 'sha256:project',
      applicationHostFrameworkCredentials: [
        { kind: 'cursor', environmentName: 'APPLIK8S_CURSOR_SECRET' },
      ],
      runtimeArtifacts: [
        {
          nodeId: 'agent.writer', name: 'writer', role: 'agent', source: '/workspace/agent.mjs', digest: `sha256:${'a'.repeat(64)}`,
          frameworkCredentials: [
            { kind: 'agent-query-context', environmentName: 'APPLIK8S_AGENT_QUERY_CONTEXT_SECRET' },
            { kind: 'internal-operation', environmentName: 'APPLIK8S_INTERNAL_OPERATION_SECRET' },
          ],
        },
        {
          nodeId: 'server.api', name: 'api', role: 'http', source: '/workspace/http.mjs', digest: `sha256:${'b'.repeat(64)}`,
          frameworkCredentials: [
            { kind: 'http-context', environmentName: 'APPLIK8S_HTTP_CONTEXT_SECRET' },
            { kind: 'internal-operation', environmentName: 'APPLIK8S_INTERNAL_OPERATION_SECRET' },
          ],
        },
      ],
    });
    expect(validateLocalSupervisorPlan(plan)).toEqual({ valid: true, diagnostics: [] });
    const agent = plan.resources.find(({ id }) => id === 'runtime:agent:agent.writer');
    const http = plan.resources.find(({ id }) => id === 'runtime:http:server.api');
    const host = plan.resources.find(({ id }) => id === 'process:server.web');
    const serializedPlan = serializeLocalSupervisorPlan(plan);
    expect(agent).toMatchObject({
      kind: 'process',
      environment: expect.arrayContaining([
        { name: 'APPLIK8S_AGENT_QUERY_CONTEXT_SECRET', binding: 'credential:framework:agent-query-context' },
        { name: 'APPLIK8S_INTERNAL_OPERATION_SECRET', binding: 'credential:framework:internal-operation' },
      ]),
    });
    expect(http).toMatchObject({
      kind: 'process',
      environment: expect.arrayContaining([
        { name: 'APPLIK8S_HTTP_CONTEXT_SECRET', binding: 'credential:framework:http-context' },
        { name: 'APPLIK8S_INTERNAL_OPERATION_SECRET', binding: 'credential:framework:internal-operation' },
      ]),
    });
    expect(JSON.stringify(agent)).not.toContain('APPLIK8S_HTTP_CONTEXT_SECRET');
    expect(JSON.stringify(http)).not.toContain('APPLIK8S_AGENT_QUERY_CONTEXT_SECRET');
    expect(host).toMatchObject({
      kind: 'process',
      environment: expect.arrayContaining([
        { name: 'APPLIK8S_CURSOR_SECRET', binding: 'credential:framework:cursor' },
      ]),
    });
    expect(JSON.stringify(host)).not.toContain('APPLIK8S_AGENT_QUERY_CONTEXT_SECRET');
    expect(JSON.stringify(host)).not.toContain('APPLIK8S_HTTP_CONTEXT_SECRET');
    expect(serializedPlan).not.toContain('task-query-context');
    expect(serializedPlan).not.toContain('task-operation-context');
  });

  it('routes durable workflow actor calls through the one local application host', () => {
    const base = applicationGraph();
    const graph = {
      ...base,
      nodes: [
        ...base.nodes,
        { id: 'provider.actor-runtime', kind: 'provider', name: 'ActorRuntime', stability: 'stable', interface: 'ActorRuntime', implementation: 'local-actors', config: { kind: 'local-actors' } },
        { id: 'actor.activity.v1', kind: 'actor', name: 'activity.v1', stability: 'experimental', runtime: { interface: 'ActorRuntime', nodeId: 'provider.actor-runtime' } },
        { id: 'task.activity', kind: 'task', name: 'activity', stability: 'stable' },
        { id: 'task-handler.activity', kind: 'taskHandler', name: 'activity', stability: 'stable', task: { nodeId: 'task.activity' }, workflowEngine: { interface: 'WorkflowEngine', nodeId: 'provider.workflow-engine' }, actors: [{ alias: 'Activity.snapshot', actor: { nodeId: 'actor.activity.v1' }, member: 'snapshot', memberKind: 'command' }] },
        { id: 'workflow-worker.activity', kind: 'workflowWorker', name: 'activity', stability: 'stable', handlers: [{ nodeId: 'task-handler.activity' }], workflowEngine: { interface: 'WorkflowEngine', nodeId: 'provider.workflow-engine' } },
      ],
      edges: [
        ...base.edges,
        { from: { nodeId: 'task-handler.activity' }, to: { nodeId: 'actor.activity.v1' }, relationship: 'dependsOn' },
      ],
    } as unknown as ApplicationGraph;
    const plan = compileLocalSupervisorPlan({
      graph,
      target: 'local',
      profile: 'starter',
      projectDigest: 'sha256:project',
      runtimeArtifacts: [{
        nodeId: 'workflow-worker.activity', name: 'activity', role: 'workflow', source: '/workspace/workflow.mjs', digest: `sha256:${'a'.repeat(64)}`,
        frameworkCredentials: [{ kind: 'internal-operation', environmentName: 'APPLIK8S_INTERNAL_OPERATION_SECRET' }],
      }],
    });
    const worker = plan.resources.find(({ id }) => id === 'runtime:workflow:workflow-worker.activity');
    expect(worker).toMatchObject({
      kind: 'process',
      dependsOn: expect.arrayContaining(['process:server.web']),
      environment: expect.arrayContaining([
        { name: 'APPLIK8S_ACTOR_APPLICATION_ENDPOINT', binding: 'endpoint:server.web:http' },
        { name: 'APPLIK8S_INTERNAL_OPERATION_SECRET', binding: 'credential:framework:internal-operation' },
      ]),
    });
  });

  it('keeps AWS-local target outputs scoped to the workload that declared the provider', () => {
    const server = applicationGraph().nodes.find((node) => node.id === 'server.web')!;
    const graph: ApplicationGraph = {
      ...applicationGraph(),
      nodes: [
        server,
        { id: 'provider.documents', kind: 'provider', name: 'documents', stability: 'stable', interface: 'ObjectStorage', implementation: 's3', config: { prefix: 'documents/' } },
        { id: 'provider.unrelated', kind: 'provider', name: 'unrelated', stability: 'stable', interface: 'ObjectStorage', implementation: 's3', config: { prefix: 'unrelated/' } },
      ],
      edges: [{ from: { nodeId: 'server.web' }, to: { nodeId: 'provider.documents' }, relationship: 'writes' }],
    };
    const plan = compileLocalSupervisorPlan({
      graph,
      target: 'aws-local',
      profile: 'starter',
      projectDigest: 'sha256:project',
    });
    expect(validateLocalSupervisorPlan(plan)).toEqual({ valid: true, diagnostics: [] });
    const host = plan.resources.find(({ id }) => id === 'process:server.web');
    expect(host?.kind).toBe('process');
    expect(plan.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'AWS_RUNTIME_ACCESS_UNRESOLVED' }),
    ]));
    const serialized = JSON.stringify(host);
    expect(serialized).toContain('APPLIK8S_OBJECT_STORAGE_BUCKET');
    expect(serialized).toContain('aws-output:provider.provider.documents:bucketName');
    expect(serialized).not.toContain('aws-output:provider.provider.unrelated:bucketName');
    expect(serialized).not.toContain('APPLIK8S_PROVIDER_UNRELATED_BUCKET_NAME');
  });
});

function applicationGraph(): ApplicationGraph {
  return {
    apiVersion: 'applik8s.appGraph/v1alpha1',
    kind: 'ApplicationGraph',
    metadata: { name: 'local-demo' },
    nodes: [
      {
        id: 'provider.database', kind: 'provider', name: 'database', stability: 'stable', interface: 'TransactionalDatabase', implementation: 'application-provider-selection',
        config: { profile: { branches: [{ variant: 'starter', implementation: 'postgres/local', config: { ignoredSecret: 'password-value' } }] } },
      },
      { id: 'provider.events', kind: 'provider', name: 'events', stability: 'stable', interface: 'EventLog', implementation: 'nats-jetstream', config: { ignoredSecret: 'secret-value' } },
      { id: 'provider.observability', kind: 'provider', name: 'observability', stability: 'stable', interface: 'Observability', implementation: 'local-otel' },
      {
        id: 'processor.events', kind: 'processor', name: 'events', stability: 'stable', handlers: [], runtime: 'node',
        deployment: { replicas: 1, concurrency: 1, maxAckPending: 16, resources: { requests: { cpu: '100m', memory: '128Mi' }, limits: { cpu: '500m', memory: '512Mi' } }, disruption: { maxUnavailable: 1 } },
        inference: 'generated', lifecycle: 'longLived', eventLog: { interface: 'EventLog', nodeId: 'provider.events' },
      },
      {
        id: 'server.web', kind: 'server', name: 'web', stability: 'stable', routes: [], resources: [], indexes: [],
        observability: {
          health: { mode: 'http', readinessPath: '/-/healthz', livenessPath: '/-/healthz' },
          logs: { format: 'json', component: 'web', failureEvents: [] },
          metrics: { mode: 'none', names: [] },
          events: [], sourceMaps: 'required', replayArtifacts: [],
          diagnosticsArtifact: { kind: 'routeDiagnostics', path: 'diagnostics.json' },
        },
      },
    ],
    edges: [
      { from: { nodeId: 'provider.events' }, to: { nodeId: 'processor.events' }, relationship: 'provides' },
      { from: { nodeId: 'provider.observability' }, to: { nodeId: 'server.web' }, relationship: 'provides' },
    ], providerRequirements: [], providerBindings: [],
    compatibility: { stablePublicApis: [], documentedInternalContracts: [], experimentalSurfaces: [], postV3Surfaces: [], labels: [] },
  };
}
