// typecast-file-boundary: profile fixtures retain literal discriminants so their qualified provider topology can be asserted exactly.
import {
  AgenticDedicated,
  AgenticExternal,
  AgenticStarter,
  agenticCapacity,
} from '@applik8s/start-agentic';
import { describe, expect, it } from 'vitest';

const context = {
  application: 'research',
  namespace: 'research-system',
} as const;

describe('maintained Agentic Start profiles', () => {
  it('keeps the starter credential-free while using real provider contracts', () => {
    expect(AgenticStarter.database(context)).toMatchObject({
      kind: 'postgres',
      clusterName: 'research-db',
      database: 'research',
      instances: 1,
    });
    expect(AgenticStarter.events(context)).toMatchObject({
      kind: 'nats-jetstream',
      provision: true,
      replicas: 1,
      servers: ['nats://research-events.research-system.svc:4222'],
    });
    expect(AgenticStarter.objects(context)).toMatchObject({
      kind: 's3',
      endpoint: 'http://research-objects.research-system.svc:8333',
      bucket: 'research-objects',
      ownership: 'direct-provisioned',
      credentialsSecret: {
        name: 'research-objects-credentials',
        namespace: 'research-system',
      },
      provisioning: {
        kind: 'local-s3',
        enabled: true,
        name: 'research-objects',
        storageSize: '2Gi',
        storageClassName: 'local-path',
      },
    });
    expect(AgenticStarter.workflows(context)).toMatchObject({
      kind: 'hatchet',
      provision: true,
      mode: 'stack',
      apiUrl: 'http://hatchet-api.research-system.svc:8080',
      tokenKey: 'HATCHET_CLIENT_TOKEN',
      worker: {
        replicas: 1,
        scaling: { mode: 'fixed' },
      },
    });
    expect(AgenticStarter.inference()).toMatchObject({
      kind: 'ai-deterministic',
    });
    expect(AgenticStarter.payments()).toMatchObject({
      kind: 'local-simulated',
      mode: 'simulated',
    });
  });

  it('keeps dedicated state retained, redundant, and production-shaped', () => {
    expect(AgenticDedicated.database(context)).toMatchObject({
      kind: 'postgres',
      instances: 3,
      lifecycle: { deletionPolicy: 'retain' },
      ownership: 'direct-provisioned',
    });
    expect(AgenticDedicated.events(context)).toMatchObject({
      kind: 'nats-jetstream',
      provision: true,
      replicas: 3,
    });
    expect(AgenticDedicated.objects(context, {
      deviceStorageClassName: 'dedicated-block',
      allowLoopDevices: true,
    })).toMatchObject({
      kind: 's3',
      ownership: 'direct-provisioned',
      provisioning: {
        kind: 'object-bucket-claim',
        claimName: 'research-objects',
        storageClassName: 'applik8s-rook-buckets',
        platform: {
          kind: 'rook-ceph-single-node-development',
          name: 'applik8s-rook',
          namespace: 'applik8s-rook-ceph',
          operatorNamespace: 'applik8s-rook-ceph-operator',
          deviceStorageClassName: 'dedicated-block',
          allowLoopDevices: true,
          storageSize: '16Gi',
          objectStoreName: 'applik8s-object-store',
        },
      },
    });
    expect(AgenticDedicated.workflows(context)).toMatchObject({
      kind: 'hatchet',
      provision: true,
      mode: 'ha',
      apiUrl: 'http://hatchet-api.research-system.svc:8080',
      tokenKey: 'HATCHET_CLIENT_TOKEN',
      worker: { replicas: 2 },
    });
    expect(AgenticDedicated.search(context)).toMatchObject({
      kind: 'opensearch',
      provision: true,
      profile: 'production',
      topology: { nodes: 3 },
      storage: { deletionPolicy: 'retain' },
      networkPolicy: {
        enabled: true,
        operatorNamespace: 'opensearch-operator-system',
      },
    });
    expect(
      AgenticDedicated.inference(
        {
          endpoint: 'https://inference.example.test',
          model: 'frontier',
          credentialSecretName: 'inference-credentials',
        },
        context,
      ),
    ).toMatchObject({
      kind: 'envoy-ai-gateway',
      provision: true,
      models: {
        fast: {
          backends: [{
            model: 'frontier',
            credentials: {
              name: 'inference-credentials',
              namespace: 'research-system',
            },
          }],
        },
      },
    });
    expect(
      AgenticDedicated.identity(
        { issuer: 'https://identity.example.test' },
        context,
      ),
    ).toMatchObject({
      kind: 'identity-provider',
      infrastructure: {
        kind: 'ory',
        stack: 'platform',
        provision: true,
        deletionPolicy: 'retain',
        spec: {
          name: 'research-identity',
          namespace: 'research-system',
          shared: true,
          managed: {
            databases: true,
            secrets: true,
            routes: false,
          },
          hydra: {
            issuerUrl: 'https://identity.example.test',
          },
        },
      },
    });
    expect(
      AgenticDedicated.payments(
        { secretName: 'stripe-payments' },
        context,
      ),
    ).toMatchObject({
      kind: 'stripe',
      mode: 'live',
    });
  });

  it('never takes ownership of externally supplied providers and selects reviewed capacity exhaustively', () => {
    expect(
      AgenticExternal.events(
        { server: 'nats://events.example.test:4222' },
        context,
      ),
    ).toMatchObject({
      kind: 'nats-jetstream',
      provision: false,
      servers: ['nats://events.example.test:4222'],
    });
    expect(
      AgenticExternal.objects(
        {
          endpoint: 'https://objects.example.test',
          bucket: 'research',
          region: 'us-east-1',
          credentialsSecretName: 'object-credentials',
        },
        context,
      ),
    ).toMatchObject({
      kind: 's3',
      ownership: 'external',
      credentialsSecret: {
        name: 'object-credentials',
        namespace: 'research-system',
      },
    });
    expect(
      AgenticExternal.workflows(
        {
          hostPort: 'workflows.example.test:7070',
          apiUrl: 'https://workflows.example.test',
          tokenSecretName: 'workflow-token',
        },
        context,
      ),
    ).toMatchObject({
      kind: 'hatchet',
      provision: false,
      hostPort: 'workflows.example.test:7070',
      workerTokenSecret: {
        name: 'workflow-token',
        namespace: 'research-system',
      },
    });
    expect(
      AgenticExternal.search(
        { endpoint: 'https://search.example.test' },
        context,
      ),
    ).toMatchObject({
      kind: 'opensearch',
      provision: false,
      endpoint: 'https://search.example.test',
    });
    expect(
      AgenticExternal.identity({
        kind: 'ory',
        issuer: 'https://identity.example.test',
        publicUrl: 'https://identity.example.test',
        adminUrl: 'https://identity-admin.example.test',
      }),
    ).toMatchObject({
      kind: 'identity-provider',
    });
    expect(
      AgenticExternal.payments(
        { secretName: 'stripe-payments' },
        context,
      ),
    ).toMatchObject({
      kind: 'stripe',
      mode: 'live',
    });

    const selected: string[] = [];
    const capacity = agenticCapacity(
      {
        select(profile, variants) {
          selected.push(profile);
          const value = variants[profile];
          return value === undefined ? variants.default : value;
        },
      },
      'dedicated',
    );
    expect(capacity).toMatchObject({
      webReplicas: 3,
      postgresInstances: 3,
      eventLogReplicas: 3,
      indexReplicas: 1,
    });
    expect(selected).not.toContain('default');
    expect(selected.length).toBeGreaterThan(10);
  });
});
