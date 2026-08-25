// typecast-file-boundary: Runtime-access fixtures assemble exact graph discriminants to exercise ambiguity and least-privilege lowering.
import { type ApplicationGraph, applicationRuntimeAccessRequirement, deriveApplicationGraphFoundation } from '@applik8s/core';
import type { ApplicationAwsPlanResource, DeploymentJsonObject } from '@applik8s/deployment-contract';
import { describe, expect, it } from 'vitest';
import {
  type ApplicationDeploymentContributor,
  compileApplicationDeploymentGraph,
  compileApplicationRuntimeAccessPlan,
  validateAwsRuntimeAccessParity,
  validateKubernetesRuntimeAccessParity,
} from '../src/index.js';

describe('v0.8 runtime-access lowering', () => {
  it('preserves an embedding compiler source identity without changing policy semantics', () => {
    const graph = accessGraph();
    const sourceGraphDigest = `sha256:${'f'.repeat(64)}` as const;
    const embedded = compileApplicationRuntimeAccessPlan({
      graph,
      target: 'kubernetes',
      namespace: 'notes',
      sourceGraphDigest,
    });
    const standalone = compileApplicationRuntimeAccessPlan({ graph, target: 'kubernetes', namespace: 'notes' });
    expect(embedded.sourceGraphDigest).toBe(sourceGraphDigest);
    expect(embedded.executions).toEqual(standalone.executions);
    expect(embedded.digest).not.toBe(standalone.digest);
  });

  it('keeps projected Kubernetes credentials out of API RBAC while retaining their exact Secret identity', () => {
    const graph = accessGraph();
    const local = compileApplicationRuntimeAccessPlan({ graph, target: 'local' });
    expect(local.diagnostics).toEqual([]);
    expect(local.executions).toHaveLength(1);
    expect(local.executions[0]).toMatchObject({
      nodeId: 'operator.notes',
      local: { grants: expect.arrayContaining([expect.objectContaining({ operation: 'secret.read', scope: { kind: 'resource', resourceId: 'secret.signing', keys: ['key'] } })]) },
    });
    const kubernetes = compileApplicationRuntimeAccessPlan({ graph, target: 'kubernetes', namespace: 'notes' });
    expect(kubernetes.diagnostics).toEqual([]);
    expect(kubernetes.executions[0]?.kubernetes).toMatchObject({
      serviceAccountName: expect.stringMatching(/^notes-operator-notes-[a-f0-9]{10}$/u),
      bindings: [],
      credentialProjections: [{ resourceId: 'secret.signing', keys: ['key'] }],
      networkConnections: [],
    });
    expect(kubernetes.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it('records the actual workload identity and deliberate execution-policy union', () => {
    const graph = accessGraph();
    const plan = compileApplicationRuntimeAccessPlan({
      graph,
      target: 'kubernetes',
      namespace: 'notes',
      workloadPlacements: [{
        workloadIdentity: 'apps/v1:Deployment:notes:notes-operator',
        artifactIds: ['artifact.operator.notes'],
        executionNodeIds: ['operator.notes'],
        kubernetes: {
          resource: { apiVersion: 'apps/v1', kind: 'Deployment', namespace: 'notes', name: 'notes-operator' },
          materialization: { authority: 'application-root' },
          podSelector: { 'app.kubernetes.io/name': 'notes-operator' },
          serviceAccountName: 'notes-runtime',
        },
      }],
    });
    expect(plan.workloads).toEqual([expect.objectContaining({
      workloadIdentity: 'apps/v1:Deployment:notes:notes-operator',
      artifactIds: ['artifact.operator.notes'],
      executionIdentities: [plan.executions[0]?.executionIdentity],
      requirementIds: plan.executions[0]?.requirementIds,
      kubernetes: expect.objectContaining({
        serviceAccountName: 'notes-runtime',
        bindings: plan.executions[0]?.kubernetes?.bindings,
        credentialProjections: [{ resourceId: 'secret.signing', keys: ['key'] }],
      }),
    })]);
    expect(plan.workloads[0]?.policyDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it('lowers object access to an exact AWS bucket prefix and fails closed when the bucket is unresolved', () => {
    const graph = awsObjectAccessGraph('application-objects');
    const aws = compileApplicationRuntimeAccessPlan({ graph, target: 'aws' });
    expect(aws.diagnostics).toEqual([]);
    expect(aws.executions[0]?.aws).toMatchObject({
      roleName: expect.stringMatching(/^objects-operator\.objects-[a-f0-9]{10}$/u),
      statements: [
        {
          effect: 'Allow',
          actions: ['s3:AbortMultipartUpload', 's3:PutObject'],
          resources: ['arn:aws:s3:::application-objects/tenants/*'],
        },
      ],
      serviceEndpoints: [expect.objectContaining({
        service: 's3',
        endpointType: 'gateway',
        purpose: 'runtime',
        protocol: 'TCP',
        port: 443,
        requirementIds: expect.arrayContaining([
          expect.stringContaining('object.write'),
        ]),
      })],
    });
    expect(JSON.stringify(aws.executions[0]?.aws)).not.toContain('"Resource":"*"');

    const unresolved = compileApplicationRuntimeAccessPlan({ graph: awsObjectAccessGraph(undefined), target: 'aws' });
    expect(unresolved.diagnostics).toEqual([
      expect.objectContaining({ severity: 'error', code: 'RUNTIME_ACCESS_TARGET_UNRESOLVED' }),
    ]);
  });

  it('resolves a processor event requirement through its exact bound EventLog', () => {
    const graph = eventAccessGraph(['provider.events']);
    const aws = compileApplicationRuntimeAccessPlan({
      graph,
      target: 'aws',
      targetResources: {
        'provider.events': { streamArn: 'arn:aws:kinesis:us-east-1:123456789012:stream/events' },
        'framework.processor-checkpoints': { tableArn: 'arn:aws:dynamodb:us-east-1:123456789012:table/checkpoints' },
      },
    });
    expect(aws.diagnostics).toEqual([]);
    expect(aws.executions[0]?.aws?.statements).toEqual(expect.arrayContaining([
      {
        effect: 'Allow',
        actions: ['kinesis:DescribeStreamSummary', 'kinesis:GetRecords', 'kinesis:GetShardIterator', 'kinesis:ListShards', 'kinesis:PutRecord', 'kinesis:PutRecords'],
        resources: ['arn:aws:kinesis:us-east-1:123456789012:stream/events'],
      },
      {
        effect: 'Allow',
        actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:UpdateItem'],
        resources: ['arn:aws:dynamodb:us-east-1:123456789012:table/checkpoints'],
      },
    ]));
    expect(aws.executions[0]?.aws?.serviceEndpoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ service: 'kinesis-streams', endpointType: 'interface', purpose: 'runtime' }),
      expect.objectContaining({ service: 'dynamodb', endpointType: 'gateway', purpose: 'runtime' }),
    ]));
  });

  it('does not invent Kinesis authority for a database-backed application stream', () => {
    const graph: ApplicationGraph = {
      ...emptyGraph('outbox-stream'),
      nodes: [
        { id: 'event.changed', kind: 'stream', name: 'changed', version: 'v1', stability: 'stable', payload: declaredSchema(), authority: 'postgres-outbox', delivery: 'at-least-once', replay: 'supported', retention: { maxAgeSeconds: 3_600 }, partitioning: 'declared', compatibility: 'versioned-schema', authorization: 'application-defined', database: { name: 'application', connectionEnvName: 'APPLIK8S_DATABASE_APPLICATION_URL', secretName: 'application-app', secretKey: 'uri' }, partitionSource: '() => "all"', authorizationSource: '() => true' },
        { id: 'subscription.changed', kind: 'subscription', name: 'changed', stability: 'stable', source: { nodeId: 'event.changed' }, delivery: 'sse', cursor: 'opaque-scoped', authorization: 'application-defined', authorizationSource: '() => true', retry: { mode: 'boundedExponentialBackoff', maxAttempts: 3 }, suspension: 'bounded-failures' },
      ],
    };
    const aws = compileApplicationRuntimeAccessPlan({ graph, target: 'aws' });
    expect(aws.diagnostics).toEqual([]);
    expect(aws.executions[0]?.aws?.statements).toEqual([]);
  });

  it('fails closed rather than selecting an arbitrary event provider', () => {
    const graph = eventAccessGraph(['provider.events-a', 'provider.events-b']);
    const aws = compileApplicationRuntimeAccessPlan({
      graph,
      target: 'aws',
      targetResources: {
        'provider.events-a': { streamArn: 'arn:aws:kinesis:us-east-1:123456789012:stream/a' },
        'provider.events-b': { streamArn: 'arn:aws:kinesis:us-east-1:123456789012:stream/b' },
      },
    });
    expect(aws.diagnostics).toHaveLength(3);
    expect(aws.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'error', code: 'RUNTIME_ACCESS_TARGET_UNRESOLVED' }),
    ]));
    expect(aws.executions[0]?.aws?.statements).toEqual([]);
  });

  it('classifies only an explicit provider-owned external endpoint as non-private egress', () => {
    const graph = externalPaymentAccessGraph();
    const plan = compileApplicationRuntimeAccessPlan({
      graph,
      target: 'kubernetes',
      targetResources: {
        'provider.payments': {
          networkKind: 'external',
          networkProtocol: 'TCP',
          networkPort: 443,
          networkExternalDestination: { kind: 'dnsName', hostname: 'api.stripe.com' },
          networkExternalFidelity: 'port-only',
        },
      },
    });
    const externalRequirementIds = plan.executions[0]?.requirements
      .filter(({ target }) => target.operation === 'network.connect' || target.operation === 'connection.use')
      .map(({ id }) => id)
      .sort();
    expect(plan.executions[0]?.kubernetes).toMatchObject({
      privatePeers: [],
      bootstrapEgress: [],
      externalEgress: [{
        capabilityId: 'provider.payments',
        protocol: 'TCP',
        port: 443,
        destination: { kind: 'dnsName', hostname: 'api.stripe.com' },
        fidelity: 'port-only',
        requirementIds: externalRequirementIds,
      }],
      networkConnections: [],
    });
    expect(plan.executions[0]?.lowerings).toContainEqual(expect.objectContaining({
      operation: 'network.connect',
      fidelity: 'external',
      mechanisms: ['external-contract'],
    }));

    const opaque = compileApplicationRuntimeAccessPlan({
      graph,
      target: 'kubernetes',
      targetResources: {
        'provider.payments': {
          networkKind: 'external',
          networkProtocol: 'TCP',
          networkExternalDestination: { kind: 'externalContract', responsibility: 'adapter-owned endpoint' },
          networkExternalFidelity: 'not-introspectable',
        },
      },
    });
    expect(opaque.executions[0]?.kubernetes?.externalEgress).toEqual([
      expect.objectContaining({
        destination: { kind: 'externalContract', responsibility: 'adapter-owned endpoint' },
        fidelity: 'not-introspectable',
      }),
    ]);
    expect(JSON.stringify(opaque)).not.toContain('0.0.0.0/0');
  });

  it('derives Stripe external egress from the reviewed provider adapter rather than provider-config scanning', () => {
    const graph = externalPaymentAccessGraph();
    const request = {
      graph,
      sourceGraphDigest: `sha256:${'a'.repeat(64)}`,
      compilerVersion: '0.8.0',
      identity: {
        connection: { provider: 'kubernetes', cluster: 'orbstack', digest: `sha256:${'b'.repeat(64)}` },
        application: 'payments',
        controlPlaneNamespace: 'applik8s-system',
        instance: 'payments',
        profile: 'dedicated',
      },
      strategy: 'kro',
      installationSpec: { name: 'payments', profile: 'dedicated', providers: { payments: { secretName: 'payments' } } },
      artifacts: [{
        id: 'artifact.billing',
        artifactType: 'containerImage',
        name: 'billing',
        sourceDigest: `sha256:${'c'.repeat(64)}`,
        sourceDescriptor: { context: './billing' },
        logicalReference: 'applik8s/payments-billing:source',
        executionNodeIds: ['server.billing'],
      }],
      materializedComposition: {
        resources: [{
          apiVersion: 'apps/v1',
          kind: 'Deployment',
          metadata: { name: 'billing', namespace: 'payments' },
          spec: { template: {
            metadata: { labels: { 'app.kubernetes.io/name': 'billing' } },
            spec: { containers: [{
              name: 'billing',
              image: 'applik8s/payments-billing:source',
              env: [{ name: 'APPLIK8S_CONTEXT_KEY', valueFrom: { secretKeyRef: { name: 'payments-context', key: 'key' } } }],
            }] },
          } },
        }],
        status: {},
      },
    } as const;
    const result = compileApplicationDeploymentGraph(request);
    expect(result.runtimeAccess.executions[0]?.kubernetes?.externalEgress).toEqual([
      expect.objectContaining({
        capabilityId: 'provider.payments',
        destination: { kind: 'dnsName', hostname: 'api.stripe.com' },
        protocol: 'TCP',
        port: 443,
        fidelity: 'port-only',
      }),
    ]);
    expect(result.runtimeAccess.executions[0]?.kubernetes?.bootstrapEgress).toEqual([
      expect.objectContaining({ purpose: 'dns', protocol: 'TCP', port: 53 }),
      expect.objectContaining({ purpose: 'dns', protocol: 'UDP', port: 53 }),
    ]);
    expect(result.runtimeAccess.workloads[0]?.kubernetes?.networkEnforcement).toEqual({
      kind: 'unqualified',
      reason: 'fqdn-provider-unavailable',
    });

    const cilium = compileApplicationDeploymentGraph({
      ...request,
      runtimeAccessKubernetesNetworkPolicyProvider: 'cilium',
    });
    const root = cilium.graph.nodes.find((node) => node.id === 'kubernetes.application');
    if (root?.kind !== 'kubernetesComposition') throw new Error('Expected root composition.');
    const policyResource = root.spec.materialized?.resources.find((resource) =>
      materializedManifest(resource).kind === 'CiliumNetworkPolicy');
    const policy = policyResource ? materializedManifest(policyResource) : undefined;
    expect(policyResource).toMatchObject({
      id: expect.stringMatching(/^runtimeAccessEgress[0-9a-f]{12}$/),
      template: { kind: 'CiliumNetworkPolicy' },
    });
    expect(cilium.runtimeAccess.workloads[0]?.kubernetes?.networkEnforcement).toEqual({
      kind: 'cilium-network-policy',
      apiVersion: 'cilium.io/v2',
      fidelity: 'exact',
    });
    expect(policy).toMatchObject({
      apiVersion: 'cilium.io/v2',
      metadata: { namespace: 'payments' },
      spec: {
        endpointSelector: { matchLabels: { 'app.kubernetes.io/name': 'billing' } },
        egress: expect.arrayContaining([
          {
            toFQDNs: [{ matchName: 'api.stripe.com' }],
            toPorts: [{ ports: [{ protocol: 'TCP', port: '443' }] }],
          },
          expect.objectContaining({
            toEndpoints: [{ matchLabels: expect.objectContaining({ 'k8s-app': 'kube-dns' }) }],
            toPorts: [{ ports: [{ protocol: 'TCP', port: '53' }], rules: { dns: [{ matchPattern: '*' }] } }],
          }),
          expect.objectContaining({
            toEndpoints: [{ matchLabels: expect.objectContaining({ 'k8s-app': 'kube-dns' }) }],
            toPorts: [{ ports: [{ protocol: 'UDP', port: '53' }], rules: { dns: [{ matchPattern: '*' }] } }],
          }),
        ]),
      },
    });
    expect(validateKubernetesRuntimeAccessParity(
      cilium.runtimeAccess,
      root.spec.materialized?.resources ?? [],
    )).toEqual([]);
    const policyWithoutDnsProxy = JSON.parse(
      JSON.stringify(policy),
      (key, value) => key === 'rules' ? undefined : value,
    ) as DeploymentJsonObject;
    expect(validateKubernetesRuntimeAccessParity(
      cilium.runtimeAccess,
      (root.spec.materialized?.resources ?? []).map((resource) =>
        resource === policyResource ? { ...resource, template: policyWithoutDnsProxy } : resource),
    )).toEqual([expect.objectContaining({ code: 'RUNTIME_ACCESS_NETWORK_MISSING' })]);
    expect(validateKubernetesRuntimeAccessParity(
      cilium.runtimeAccess,
      (root.spec.materialized?.resources ?? []).filter((resource) =>
        materializedManifest(resource).kind !== 'CiliumNetworkPolicy'),
    )).toEqual([expect.objectContaining({ code: 'RUNTIME_ACCESS_NETWORK_MISSING' })]);
  });

  it('materializes an exact private-peer and DNS NetworkPolicy into the root composition', () => {
    const graph = privateCallableProviderGraph();
    const contributor: ApplicationDeploymentContributor = {
      interface: 'AcquisitionProvider',
      implementation: 'private-acquisition',
      version: 1,
      contribute(provider) {
        return {
          nodes: [],
          edges: [],
          compositionFragments: [],
          runtimeAccessTargets: [{
            capabilityId: provider.id,
            target: 'kubernetes',
            namespace: 'acquisition-system',
            serviceName: 'acquisition-api',
            podSelector: { 'app.kubernetes.io/name': 'acquisition-api' },
            protocol: 'TCP',
            port: 8443,
          }],
        };
      },
    };
    const result = compileApplicationDeploymentGraph({
      graph,
      sourceGraphDigest: `sha256:${'d'.repeat(64)}`,
      compilerVersion: '0.8.0',
      identity: {
        connection: { provider: 'kubernetes', cluster: 'orbstack', digest: `sha256:${'e'.repeat(64)}` },
        application: 'acquisition',
        controlPlaneNamespace: 'applik8s-system',
        instance: 'acquisition',
        profile: 'dedicated',
      },
      strategy: 'kro',
      installationSpec: { name: 'acquisition', profile: 'dedicated' },
      artifacts: [{
        id: 'artifact.api',
        artifactType: 'containerImage',
        name: 'api',
        sourceDigest: `sha256:${'f'.repeat(64)}`,
        sourceDescriptor: { context: './api' },
        logicalReference: 'applik8s/acquisition-api:source',
        executionNodeIds: ['server.api'],
      }],
      materializedComposition: {
        resources: [{
          apiVersion: 'apps/v1',
          kind: 'Deployment',
          metadata: { name: 'api', namespace: 'acquisition' },
          spec: { template: {
            metadata: { labels: { 'app.kubernetes.io/name': 'api' } },
            spec: { containers: [{
              name: 'api',
              image: 'applik8s/acquisition-api:source',
              env: [{ name: 'APPLIK8S_CONTEXT_KEY', valueFrom: { secretKeyRef: { name: 'acquisition-context', key: 'key' } } }],
            }] },
          } },
        }],
        status: {},
      },
      contributors: [contributor],
    });
    const root = result.graph.nodes.find((node) => node.id === 'kubernetes.application');
    if (root?.kind !== 'kubernetesComposition') throw new Error('Expected root composition.');
    const networkPolicyResource = root.spec.materialized?.resources.find((resource) =>
      materializedManifest(resource).kind === 'NetworkPolicy');
    const networkPolicy = networkPolicyResource
      ? materializedManifest(networkPolicyResource)
      : undefined;
    expect(networkPolicyResource).toMatchObject({
      id: expect.stringMatching(/^runtimeAccessEgress[0-9a-f]{12}$/),
      template: { kind: 'NetworkPolicy' },
    });
    expect(networkPolicy).toMatchObject({
      apiVersion: 'networking.k8s.io/v1',
      metadata: {
        namespace: 'acquisition',
        annotations: {
          'applik8s.io/runtime-access-workload': 'apps/v1:Deployment:acquisition:api',
        },
      },
      spec: {
        podSelector: { matchLabels: { 'app.kubernetes.io/name': 'api' } },
        policyTypes: ['Egress'],
        egress: expect.arrayContaining([
          {
            to: [{
              namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'acquisition-system' } },
              podSelector: { matchLabels: { 'app.kubernetes.io/name': 'acquisition-api' } },
            }],
            ports: [{ protocol: 'TCP', port: 8443 }],
          },
          expect.objectContaining({ ports: [{ protocol: 'TCP', port: 53 }] }),
          expect.objectContaining({ ports: [{ protocol: 'UDP', port: 53 }] }),
        ]),
      },
    });
    expect(validateKubernetesRuntimeAccessParity(
      result.runtimeAccess,
      root.spec.materialized?.resources ?? [],
    )).toEqual([]);
    const resources = root.spec.materialized?.resources ?? [];
    expect(validateKubernetesRuntimeAccessParity(
      result.runtimeAccess,
      resources.filter((resource) => materializedManifest(resource).kind !== 'NetworkPolicy'),
    )).toEqual([expect.objectContaining({ code: 'RUNTIME_ACCESS_NETWORK_MISSING' })]);
    expect(validateKubernetesRuntimeAccessParity(result.runtimeAccess, mutateNetworkPolicy(resources, (policy) => {
      const egress = policy.spec.egress as Array<{ ports: Array<{ protocol: string; port: number }> }>;
      const peer = egress.find((rule) => rule.ports[0]?.port === 8443);
      if (peer?.ports[0]) peer.ports[0].port = 9443;
    }))).toEqual([expect.objectContaining({ code: 'RUNTIME_ACCESS_NETWORK_WRONG_PORT' })]);
    expect(validateKubernetesRuntimeAccessParity(result.runtimeAccess, mutateNetworkPolicy(resources, (policy) => {
      const egress = policy.spec.egress as Array<{ ports: Array<{ protocol: string; port: number }> }>;
      const peer = egress.find((rule) => rule.ports[0]?.port === 8443);
      if (peer?.ports[0]) peer.ports[0].protocol = 'UDP';
    }))).toEqual([expect.objectContaining({ code: 'RUNTIME_ACCESS_NETWORK_WRONG_PROTOCOL' })]);
    expect(validateKubernetesRuntimeAccessParity(result.runtimeAccess, mutateNetworkPolicy(resources, (policy) => {
      policy.spec.egress = [...policy.spec.egress as unknown[], {}];
    }))).toEqual([expect.objectContaining({ code: 'RUNTIME_ACCESS_NETWORK_WIDENED' })]);
    expect(validateKubernetesRuntimeAccessParity(result.runtimeAccess, mutateNetworkPolicy(resources, (policy) => {
      policy.metadata.namespace = 'wrong';
    }))).toEqual([expect.objectContaining({ code: 'RUNTIME_ACCESS_NETWORK_MISBOUND' })]);
  });

  it('separates cross-namespace Roles from cluster-scoped access without broadening either', () => {
    const plan = compileApplicationRuntimeAccessPlan({
      graph: kubernetesScopeGraph(),
      target: 'kubernetes',
      namespace: 'control-plane',
    });
    expect(plan.diagnostics).toEqual([]);
    expect(plan.executions[0]?.kubernetes?.bindings).toEqual([
      expect.objectContaining({
        kind: 'ClusterRole',
        rules: [{ apiGroups: ['example.dev'], resources: ['clusterwidgets'], verbs: ['get'] }],
      }),
      expect.objectContaining({
        kind: 'Role',
        namespace: 'team-a',
        rules: [{ apiGroups: ['example.dev'], resources: ['widgets'], verbs: ['get', 'list', 'watch'] }],
      }),
      expect.objectContaining({
        kind: 'Role',
        namespace: 'team-b',
        rules: [{ apiGroups: ['example.dev'], resources: ['widgets'], verbs: ['get', 'list', 'watch'] }],
      }),
    ]);
  });

  it('fails pre-mutation parity when Kubernetes RBAC is removed, widened, or bound to the wrong workload', () => {
    const plan = compileApplicationRuntimeAccessPlan({
      graph: kubernetesScopeGraph(),
      target: 'kubernetes',
      namespace: 'control-plane',
      workloadPlacements: [{
        workloadIdentity: 'apps/v1:Deployment:control-plane:scopes',
        artifactIds: ['artifact.operator.scopes'],
        executionNodeIds: ['operator.scopes'],
        kubernetes: {
          resource: { apiVersion: 'apps/v1', kind: 'Deployment', namespace: 'control-plane', name: 'scopes' },
          materialization: { authority: 'application-root' },
          podSelector: { 'app.kubernetes.io/name': 'scopes' },
          serviceAccountName: 'scopes',
        },
      }],
    });
    const resources = kubernetesParityResources();
    expect(validateKubernetesRuntimeAccessParity(plan, resources)).toEqual([]);

    expect(validateKubernetesRuntimeAccessParity(
      plan,
      resources.filter((resource) => resource.kind !== 'ClusterRoleBinding'),
    )).toEqual([expect.objectContaining({
      code: 'RUNTIME_ACCESS_RBAC_MISSING',
      workloadIdentity: 'apps/v1:Deployment:control-plane:scopes',
      executionIdentities: plan.workloads[0]?.executionIdentities,
      requirementIds: plan.workloads[0]?.requirementIds,
    })]);

    const widened = resources.map((resource) => resource.kind === 'ClusterRole'
      ? { ...resource, rules: [{ apiGroups: ['example.dev'], resources: ['clusterwidgets'], verbs: ['get', 'delete'] }] }
      : resource);
    expect(validateKubernetesRuntimeAccessParity(plan, widened)).toEqual([
      expect.objectContaining({ code: 'RUNTIME_ACCESS_RBAC_WIDENED' }),
    ]);

    const misbound = resources.map((resource) => resource.kind === 'RoleBinding'
      ? { ...resource, subjects: [{ kind: 'ServiceAccount', name: 'other', namespace: 'control-plane' }] }
      : resource);
    expect(validateKubernetesRuntimeAccessParity(plan, misbound)).toEqual([
      expect.objectContaining({ code: 'RUNTIME_ACCESS_RBAC_MISSING' }),
    ]);
  });

  it('fails pre-mutation parity when a Kubernetes Secret projection omits or widens an exact key', () => {
    const compiled = compileApplicationRuntimeAccessPlan({
      graph: accessGraph(),
      target: 'kubernetes',
      namespace: 'notes',
      workloadPlacements: [{
        workloadIdentity: 'apps/v1:Deployment:notes:notes',
        artifactIds: ['artifact.operator.notes'],
        executionNodeIds: ['operator.notes'],
        kubernetes: {
          resource: { apiVersion: 'apps/v1', kind: 'Deployment', namespace: 'notes', name: 'notes' },
          materialization: { authority: 'application-root' },
          podSelector: { 'app.kubernetes.io/name': 'notes' },
          serviceAccountName: 'notes',
        },
      }],
    });
    const plan = {
      ...compiled,
      workloads: compiled.workloads.map((workload) => workload.kubernetes
        ? {
            ...workload,
            kubernetes: {
              ...workload.kubernetes,
              credentialProjections: [{ resourceId: 'v1/Secret/notes/signing', keys: ['current'] }],
            },
          }
        : workload),
    };
    const deployment = (key: string) => ({
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: 'notes', namespace: 'notes' },
      spec: { template: { spec: {
        serviceAccountName: 'notes',
        containers: [{ name: 'operator', image: 'operator:test', env: [{ name: 'SIGNING', valueFrom: { secretKeyRef: { name: 'signing', key } } }] }],
      } } },
    });

    expect(validateKubernetesRuntimeAccessParity(plan, [deployment('current')])).toEqual([]);
    expect(validateKubernetesRuntimeAccessParity(plan, [deployment('previous')])).toEqual([
      expect.objectContaining({ code: 'RUNTIME_ACCESS_CREDENTIAL_MISSING' }),
      expect.objectContaining({ code: 'RUNTIME_ACCESS_CREDENTIAL_WIDENED' }),
    ]);
  });

  it('fails pre-mutation parity when an AWS role grant is removed, widened, or attached to the wrong workload', () => {
    const compiled = compileApplicationRuntimeAccessPlan({
      graph: awsObjectAccessGraph('application-objects'),
      target: 'aws',
      workloadPlacements: [{
        workloadIdentity: 'ecs:runtime.objects',
        artifactIds: ['artifact.operator.objects'],
        executionNodeIds: ['operator.objects'],
        aws: { resourceId: 'runtime.objects', roleName: 'objects-runtime' },
      }],
    });
    const workload = compiled.workloads[0];
    if (!workload?.aws) throw new Error('Expected one AWS workload fixture.');
    const runtime = awsParityResource('runtime.objects', 'ecs', 'fargate-worker', {
      runtimeRoleResourceId: 'runtime.role',
    });
    const role = awsParityResource('runtime.role', 'iam', 'role', {
      statements: workload.aws.statements,
      workloadIdentity: workload.workloadIdentity,
      executionIdentities: workload.executionIdentities,
      requirementIds: workload.requirementIds,
    }, workload.aws.roleName);
    const resources = [runtime, role];
    const edges = [{ from: role.id, to: runtime.id, relationship: 'assumesRole' as const }];
    expect(validateAwsRuntimeAccessParity(compiled, resources, edges)).toEqual([]);

    expect(validateAwsRuntimeAccessParity(compiled, [
      runtime,
      awsParityResource('runtime.role', 'iam', 'role', {
        statements: [],
        workloadIdentity: workload.workloadIdentity,
        executionIdentities: workload.executionIdentities,
        requirementIds: workload.requirementIds,
      }, workload.aws.roleName),
    ], edges)).toEqual([expect.objectContaining({
      code: 'RUNTIME_ACCESS_IAM_MISSING',
      workloadIdentity: workload.workloadIdentity,
      executionIdentities: workload.executionIdentities,
      requirementIds: workload.requirementIds,
    })]);

    const widenedStatement = {
      effect: 'Allow' as const,
      actions: ['s3:*'],
      resources: ['arn:aws:s3:::application-objects/*'],
    };
    expect(validateAwsRuntimeAccessParity(compiled, [
      runtime,
      awsParityResource('runtime.role', 'iam', 'role', {
        statements: [...workload.aws.statements, widenedStatement],
        workloadIdentity: workload.workloadIdentity,
        executionIdentities: workload.executionIdentities,
        requirementIds: workload.requirementIds,
      }, workload.aws.roleName),
    ], edges)).toEqual([expect.objectContaining({ code: 'RUNTIME_ACCESS_IAM_WIDENED' })]);

    expect(validateAwsRuntimeAccessParity(compiled, resources, [
      { from: role.id, to: 'another-runtime', relationship: 'assumesRole' },
    ])).toEqual([expect.objectContaining({ code: 'RUNTIME_ACCESS_ROLE_MISBOUND' })]);
  });

  it('fails pre-mutation parity when an AWS private-peer edge is removed or widened', () => {
    const compiled = compileApplicationRuntimeAccessPlan({
      graph: awsObjectAccessGraph('application-objects'),
      target: 'aws',
      workloadPlacements: [{
        workloadIdentity: 'ecs:runtime.objects',
        artifactIds: ['artifact.operator.objects'],
        executionNodeIds: ['operator.objects'],
        aws: { resourceId: 'runtime.objects', roleName: 'objects-runtime' },
      }],
    });
    const original = compiled.workloads[0];
    if (!original?.aws) throw new Error('Expected one AWS workload fixture.');
    const requirementId = original.requirementIds[0];
    if (!requirementId) throw new Error('Expected one AWS requirement fixture.');
    const networkConnections = ['provider.database'];
    const privatePeers = [{
      peerIdentity: 'peer.database',
      capabilityId: 'provider.database',
      requirementIds: [requirementId],
      protocol: 'TCP' as const,
      port: 5432,
      endpoint: { target: 'aws' as const, resourceId: 'provider.database' },
    }];
    const plan = {
      ...compiled,
      workloads: [{
        ...original,
        aws: { ...original.aws, privatePeers, networkConnections },
      }],
    };
    const runtime = awsParityResource('runtime.objects', 'ecs', 'fargate-worker', {
      runtimeRoleResourceId: 'runtime.role',
    });
    const role = awsParityResource('runtime.role', 'iam', 'role', {
      statements: original.aws.statements,
      workloadIdentity: original.workloadIdentity,
      executionIdentities: original.executionIdentities,
      requirementIds: original.requirementIds,
    }, original.aws.roleName);
    const resources = [
      runtime,
      role,
      awsParityResource('provider.database', 'rds', 'postgresql-instance'),
      awsParityResource('provider.unrelated', 'rds', 'postgresql-instance'),
    ];
    const roleEdge = { from: role.id, to: runtime.id, relationship: 'assumesRole' as const };
    const expectedNetwork = { from: 'provider.database', to: runtime.id, relationship: 'networkAccess' as const, output: 'runtime-egress' };
    expect(validateAwsRuntimeAccessParity(plan, resources, [roleEdge, expectedNetwork])).toEqual([]);
    expect(validateAwsRuntimeAccessParity(plan, resources, [roleEdge])).toEqual([
      expect.objectContaining({ code: 'RUNTIME_ACCESS_NETWORK_MISSING' }),
    ]);
    expect(validateAwsRuntimeAccessParity(plan, resources, [
      roleEdge,
      expectedNetwork,
      { from: 'provider.unrelated', to: runtime.id, relationship: 'networkAccess', output: 'runtime-egress' },
    ])).toEqual([
      expect.objectContaining({ code: 'RUNTIME_ACCESS_NETWORK_WIDENED' }),
    ]);
  });

  it('uses collision-resistant workload identities after Kubernetes/AWS normalization', () => {
    const graph = collisionGraph();
    const kubernetes = compileApplicationRuntimeAccessPlan({ graph, target: 'kubernetes' });
    const aws = compileApplicationRuntimeAccessPlan({ graph, target: 'aws' });
    expect(new Set(kubernetes.executions.map(({ kubernetes: plan }) => plan?.serviceAccountName)).size).toBe(2);
    expect(new Set(aws.executions.map(({ aws: plan }) => plan?.roleName)).size).toBe(2);
  });

  it('rejects wildcard Kubernetes resources rather than emitting broad RBAC', () => {
    const graph = kubernetesScopeGraph();
    const permission = graph.nodes.find((node) => node.kind === 'permission');
    if (permission?.kind !== 'permission') throw new Error('Expected permission fixture.');
    const broad: ApplicationGraph = {
      ...graph,
      nodes: graph.nodes.map((node) => node.id === permission.id
        ? { ...permission, rules: [{ apiGroups: ['example.dev'], resources: ['*'], verbs: ['get'] }] }
        : node),
    };
    const plan = compileApplicationRuntimeAccessPlan({ graph: broad, target: 'kubernetes' });
    expect(plan.diagnostics).toContainEqual(expect.objectContaining({ code: 'RUNTIME_ACCESS_WILDCARD_FORBIDDEN' }));
    expect(plan.executions.flatMap(({ kubernetes }) => kubernetes?.bindings ?? [])).toEqual([]);
  });

  it('explains redundant, widened, and unused explicit access without losing source provenance', () => {
    const graph = accessGraph();
    const derived = deriveApplicationGraphFoundation(graph);
    const inferred = derived.runtimeAccess.find(({ target }) => target.operation === 'secret.read');
    if (!inferred) throw new Error('Expected inferred Secret access.');
    const explicit = (operation: typeof inferred.target.operation, scope: typeof inferred.target.scope) => applicationRuntimeAccessRequirement({
      ...inferred,
      target: { ...inferred.target, operation, scope },
      origin: 'explicit',
    });
    const withExplicit: ApplicationGraph = {
      ...graph,
      foundation: {
        ...derived,
        runtimeAccess: [
          explicit('secret.read', inferred.target.scope),
          explicit('secret.read', { kind: 'namespace', namespace: 'other' }),
          explicit('object.delete', { kind: 'external', responsibility: 'security-team' }),
        ],
      },
    };
    const plan = compileApplicationRuntimeAccessPlan({ graph: withExplicit, target: 'local' });
    expect(plan.diagnostics.map(({ code }) => code)).toEqual(expect.arrayContaining([
      'RUNTIME_ACCESS_EXPLICIT_UNUSED',
      'RUNTIME_ACCESS_EXPLICIT_WIDENING',
      'RUNTIME_ACCESS_EXPLICIT_REDUNDANT',
    ]));
    expect(plan.diagnostics).toHaveLength(3);
    expect(plan.executions[0]?.requirements.every(({ provenance }) => provenance.length > 0)).toBe(true);
    expect(plan.sourceGraphDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(plan.executions[0]?.policyDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it('fails closed when the selected provider has no target runtime-access guarantee', () => {
    const graph: ApplicationGraph = {
      ...emptyGraph('provider-access'),
      nodes: [
        {
          id: 'provider.acquisition',
          kind: 'provider',
          name: 'AcquisitionProvider',
          stability: 'stable',
          interface: 'AcquisitionProvider',
          implementation: 'custom-http',
        },
        {
          id: 'server.api',
          kind: 'server',
          name: 'api',
          stability: 'stable',
          routes: [{
            id: 'acquire',
            method: 'POST',
            path: '/acquire',
            diagnostics: routeDiagnostics(),
            functionNative: {
              input: declaredSchema(),
              output: declaredSchema(),
              handler: { source: 'async input => input' },
              providerBindings: [{
                identifier: 'Acquisition.acquire',
                provider: { interface: 'AcquisitionProvider', nodeId: 'provider.acquisition' },
                operation: {
                  member: 'acquire',
                  runtime: {
                    module: '@fixture/acquisition',
                    export: 'acquire',
                    access: { kind: 'provider', operations: ['connection.use'] },
                  },
                },
              }],
              idempotency: { source: 'http-idempotency-key', contextScoped: true },
              requestBoundary: { durableValues: 'schema-normalized-only', rawRequestCapture: 'rejected', principal: 'framework-authenticated' },
            },
          }],
          resources: [],
          indexes: [],
          observability: serverObservability(),
        },
      ],
      providerRequirements: [{
        id: 'requirement.acquisition',
        interface: 'AcquisitionProvider',
        consumer: { nodeId: 'server.api' },
        provider: { interface: 'AcquisitionProvider', nodeId: 'provider.acquisition' },
        required: true,
        purpose: 'acquisition',
        diagnostics: { missing: 'missing', ambiguous: 'ambiguous' },
      }],
      providerBindings: [{
        requirement: 'requirement.acquisition',
        provider: { interface: 'AcquisitionProvider', nodeId: 'provider.acquisition' },
        generatedResources: [],
        runtime: {},
      }],
    };
    const plan = compileApplicationRuntimeAccessPlan({ graph, target: 'local' });
    expect(plan.diagnostics).toContainEqual(expect.objectContaining({
      code: 'RUNTIME_ACCESS_PROVIDER_GUARANTEE_UNSUPPORTED',
    }));
    expect(plan.executions[0]?.lowerings).toContainEqual(expect.objectContaining({
      operation: 'connection.use',
      fidelity: 'unsupported',
      providerGuarantee: {
        providerId: 'provider.acquisition',
        disposition: 'unsupported',
        evidenceLevel: 'none',
      },
    }));
    const kubernetes = compileApplicationRuntimeAccessPlan({
      graph,
      target: 'kubernetes',
      targetResources: {
        'provider.acquisition': {
          networkNamespace: 'acquisition-system',
          networkServiceName: 'acquisition-api',
          networkPodSelector: { 'app.kubernetes.io/name': 'acquisition' },
          networkProtocol: 'TCP',
          networkPort: 8443,
        },
      },
    });
    expect(kubernetes.executions[0]?.kubernetes?.privatePeers).toEqual([
      expect.objectContaining({
        capabilityId: 'provider.acquisition',
        protocol: 'TCP',
        port: 8443,
        endpoint: {
          target: 'kubernetes',
          namespace: 'acquisition-system',
          serviceName: 'acquisition-api',
          podSelector: { 'app.kubernetes.io/name': 'acquisition' },
        },
      }),
    ]);
    expect(kubernetes.executions[0]?.kubernetes?.networkConnections).toEqual([
      'acquisition-system/acquisition-api',
    ]);
  });
});

function routeDiagnostics() {
  return {
    routeFailureEvent: 'applik8s-server-route-failure' as const,
    actionFailureEvent: 'applik8s-route-action-failure' as const,
    failurePolicy: 'failClosed' as const,
    partialEffects: 'unknownAfterActionStarted' as const,
    sourceMaps: 'required' as const,
    includes: ['routeId', 'method', 'path', 'module', 'sourceLocation', 'bundleInputs', 'action', 'diagnostic', 'stack'] as const,
  };
}

function serverObservability() {
  return {
    health: { mode: 'http' as const, readinessPath: '/readyz', livenessPath: '/healthz' },
    logs: { format: 'json' as const, component: 'api', failureEvents: [] },
    metrics: { mode: 'none' as const, names: [] },
    events: [],
    sourceMaps: 'required' as const,
    replayArtifacts: [],
    diagnosticsArtifact: { kind: 'routeDiagnostics' as const, name: 'api-diagnostics' },
  };
}

function externalPaymentAccessGraph(): ApplicationGraph {
  return {
    ...emptyGraph('payments'),
    metadata: { name: 'payments', namespace: 'payments' },
    nodes: [
      {
        id: 'provider.payments',
        kind: 'provider',
        name: 'payments',
        stability: 'stable',
        interface: 'PaymentProvider',
        implementation: 'stripe',
        config: {
          callableRuntime: {
            kind: 'runtime',
            runtime: { module: '@applik8s/billing/runtime', export: 'startPaymentCheckout' },
          },
        },
      },
      {
        id: 'server.billing',
        kind: 'server',
        name: 'billing',
        stability: 'stable',
        routes: [{
          id: 'checkout',
          method: 'POST',
          path: '/checkout',
          diagnostics: routeDiagnostics(),
          functionNative: {
            input: declaredSchema(),
            output: declaredSchema(),
            handler: { source: 'async input => input' },
            providerBindings: [{
              identifier: 'payments.startCheckout',
              provider: { interface: 'PaymentProvider', nodeId: 'provider.payments' },
              operation: {
                member: 'startCheckout',
                runtime: {
                  module: '@applik8s/billing/runtime',
                  export: 'startPaymentCheckout',
                  access: { kind: 'provider', operations: ['network.connect'] },
                },
              },
            }],
            idempotency: { source: 'http-idempotency-key', contextScoped: true },
            requestBoundary: { durableValues: 'schema-normalized-only', rawRequestCapture: 'rejected', principal: 'framework-authenticated' },
          },
        }],
        resources: [],
        indexes: [],
        observability: serverObservability(),
      },
    ],
    providerRequirements: [{
      id: 'requirement.payments',
      interface: 'PaymentProvider',
      consumer: { nodeId: 'server.billing' },
      provider: { interface: 'PaymentProvider', nodeId: 'provider.payments' },
      required: true,
      purpose: 'checkout',
      diagnostics: { missing: 'missing', ambiguous: 'ambiguous' },
    }],
    providerBindings: [{
      requirement: 'requirement.payments',
      provider: { interface: 'PaymentProvider', nodeId: 'provider.payments' },
      generatedResources: [],
      runtime: {},
    }],
  };
}

function privateCallableProviderGraph(): ApplicationGraph {
  return {
    ...emptyGraph('acquisition'),
    metadata: { name: 'acquisition', namespace: 'acquisition' },
    nodes: [
      {
        id: 'provider.acquisition',
        kind: 'provider',
        name: 'acquisition',
        stability: 'stable',
        interface: 'AcquisitionProvider',
        implementation: 'private-acquisition',
        config: {
          callableRuntime: {
            kind: 'runtime',
            runtime: { module: '@fixture/acquisition', export: 'acquire' },
          },
        },
      },
      {
        id: 'server.api',
        kind: 'server',
        name: 'api',
        stability: 'stable',
        routes: [{
          id: 'acquire',
          method: 'POST',
          path: '/acquire',
          diagnostics: routeDiagnostics(),
          functionNative: {
            input: declaredSchema(),
            output: declaredSchema(),
            handler: { source: 'async input => input' },
            providerBindings: [{
              identifier: 'acquisition.acquire',
              provider: { interface: 'AcquisitionProvider', nodeId: 'provider.acquisition' },
              operation: {
                member: 'acquire',
                runtime: {
                  module: '@fixture/acquisition',
                  export: 'acquire',
                  access: { kind: 'provider', operations: ['connection.use'] },
                },
              },
            }],
            idempotency: { source: 'http-idempotency-key', contextScoped: true },
            requestBoundary: { durableValues: 'schema-normalized-only', rawRequestCapture: 'rejected', principal: 'framework-authenticated' },
          },
        }],
        resources: [],
        indexes: [],
        observability: serverObservability(),
      },
    ],
    providerRequirements: [{
      id: 'requirement.acquisition',
      interface: 'AcquisitionProvider',
      consumer: { nodeId: 'server.api' },
      provider: { interface: 'AcquisitionProvider', nodeId: 'provider.acquisition' },
      required: true,
      purpose: 'acquisition',
      diagnostics: { missing: 'missing', ambiguous: 'ambiguous' },
    }],
    providerBindings: [{
      requirement: 'requirement.acquisition',
      provider: { interface: 'AcquisitionProvider', nodeId: 'provider.acquisition' },
      generatedResources: [],
      runtime: {},
    }],
  };
}

function mutateNetworkPolicy(
  resources: readonly DeploymentJsonObject[],
  mutate: (policy: { metadata: Record<string, unknown>; spec: Record<string, unknown> }) => void,
): readonly DeploymentJsonObject[] {
  const cloned = JSON.parse(JSON.stringify(resources)) as DeploymentJsonObject[];
  const resource = cloned.find((candidate) => materializedManifest(candidate).kind === 'NetworkPolicy');
  const policy = resource ? materializedManifest(resource) : undefined;
  if (!policy?.metadata || !policy.spec) throw new Error('Expected generated NetworkPolicy fixture.');
  mutate(policy as unknown as { metadata: Record<string, unknown>; spec: Record<string, unknown> });
  return cloned;
}

function materializedManifest(resource: DeploymentJsonObject): DeploymentJsonObject {
  const template = resource.template;
  return template && typeof template === 'object' && !Array.isArray(template)
    ? template as DeploymentJsonObject
    : resource;
}

function kubernetesScopeGraph(): ApplicationGraph {
  return {
    ...emptyGraph('scopes'),
    nodes: [
      { id: 'operator.scopes', kind: 'operator', name: 'scopes', stability: 'stable', resources: [], watches: [] },
      { id: 'crd.widgets', kind: 'crd', name: 'Widget', stability: 'stable', materialization: 'kubernetes-crd', resource: { apiVersion: 'example.dev/v1', kind: 'Widget', plural: 'widgets', scope: 'Namespaced' } },
      { id: 'crd.clusterwidgets', kind: 'crd', name: 'ClusterWidget', stability: 'stable', materialization: 'kubernetes-crd', resource: { apiVersion: 'example.dev/v1', kind: 'ClusterWidget', plural: 'clusterwidgets', scope: 'Cluster' } },
      {
        id: 'permission.scopes', kind: 'permission', name: 'scopes', stability: 'stable', owner: { nodeId: 'operator.scopes' }, mode: 'inferred',
        rules: [
          { apiGroups: ['example.dev'], resources: ['widgets'], verbs: ['get', 'list', 'watch'], namespaces: ['team-b', 'team-a'] },
          { apiGroups: ['example.dev'], resources: ['clusterwidgets'], verbs: ['get'] },
        ],
      },
    ],
  };
}

function kubernetesParityResources(): readonly Readonly<Record<string, unknown>>[] {
  const role = (namespace: string) => ({
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'Role',
    metadata: { name: 'scopes', namespace },
    rules: [{ apiGroups: ['example.dev'], resources: ['widgets'], verbs: ['get', 'list', 'watch'] }],
  });
  const roleBinding = (namespace: string) => ({
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'RoleBinding',
    metadata: { name: 'scopes', namespace },
    roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name: 'scopes' },
    subjects: [{ kind: 'ServiceAccount', name: 'scopes', namespace: 'control-plane' }],
  });
  return [
    {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: 'scopes', namespace: 'control-plane' },
      spec: { template: { spec: { serviceAccountName: 'scopes', containers: [{ name: 'operator', image: 'operator:test' }] } } },
    },
    role('team-a'),
    role('team-b'),
    roleBinding('team-a'),
    roleBinding('team-b'),
    {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'ClusterRole',
      metadata: { name: 'scopes' },
      rules: [{ apiGroups: ['example.dev'], resources: ['clusterwidgets'], verbs: ['get'] }],
    },
    {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'ClusterRoleBinding',
      metadata: { name: 'scopes' },
      roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'ClusterRole', name: 'scopes' },
      subjects: [{ kind: 'ServiceAccount', name: 'scopes', namespace: 'control-plane' }],
    },
  ];
}

function collisionGraph(): ApplicationGraph {
  return {
    ...emptyGraph('collisions'),
    nodes: [
      { id: 'operator.a_b', kind: 'operator', name: 'a_b', stability: 'stable', resources: [], watches: [] },
      { id: 'operator.a-b', kind: 'operator', name: 'a-b', stability: 'stable', resources: [], watches: [] },
      { id: 'secret.one', kind: 'secret', name: 'one', stability: 'stable', provider: 'Secret', ownership: 'external', key: 'value', redaction: 'required', generatedResources: [] },
      { id: 'secret.two', kind: 'secret', name: 'two', stability: 'stable', provider: 'Secret', ownership: 'external', key: 'value', redaction: 'required', generatedResources: [] },
    ],
    edges: [
      { from: { nodeId: 'operator.a_b' }, to: { nodeId: 'secret.one' }, relationship: 'reads' },
      { from: { nodeId: 'operator.a-b' }, to: { nodeId: 'secret.two' }, relationship: 'reads' },
    ],
  };
}

function eventAccessGraph(providerIds: readonly string[]): ApplicationGraph {
  return {
    ...emptyGraph('event-access'),
    nodes: [
      ...providerIds.map((id) => ({ id, kind: 'provider' as const, name: id, stability: 'stable' as const, interface: 'EventLog', implementation: 'nats-jetstream' })),
      { id: 'handler.changed', kind: 'commandHandler', name: 'changed', stability: 'stable', model: { nodeId: 'model.record' }, command: { nodeId: 'command.change' }, key: { kind: 'field', source: 'input.id' }, ordering: 'serial', missing: 'reject', transaction: { models: [], history: [], outbox: [] }, retry: { mode: 'boundedExponentialBackoff', maxAttempts: 3 }, retention: { replayWindowSeconds: 3_600, auditWindowSeconds: 7_200, publishedOutboxWindowSeconds: 3_600, cleanupIntervalSeconds: 60, cleanupBatchSize: 100 }, effectBoundary: 'transactionSafeOnly', effectEnforcement: { sourceAnalysis: 'closedStructuralAllowlist', runtimeMembrane: 'asyncContextAmbientIo', externalEffects: 'outboxOrTaskOnly' }, handlerSource: 'async () => ({})', projectionReadiness: { submissionAcknowledgement: 'transportOnly', durableResultAuthority: 'postgresCommandResults', duplicateRecovery: 'idempotentRedelivery', correlation: 'commandCorrelationCausation', resultRevisionAuthority: 'postgresCommandResults', stateRevisionAuthority: 'modelRevision', reconciliationLink: 'modelRevisionWhenPresent' } },
      { id: 'processor.events', kind: 'processor', name: 'events', stability: 'stable', handlers: [{ nodeId: 'handler.changed' }], runtime: 'node', deployment: { replicas: 1, concurrency: 1, maxAckPending: 1, resources: { requests: { cpu: '100m', memory: '128Mi' }, limits: { cpu: '500m', memory: '512Mi' } }, disruption: { maxUnavailable: 1 } }, inference: 'generated', lifecycle: 'longLived' },
    ],
    edges: [{ from: { nodeId: 'processor.events' }, to: { nodeId: 'handler.changed' }, relationship: 'owns' }],
    providerRequirements: providerIds.map((providerId, index) => ({ id: `requirement.events.${index}`, consumer: { nodeId: 'processor.events' }, interface: 'EventLog', provider: { interface: 'EventLog', nodeId: providerId }, required: true, purpose: 'event processing', diagnostics: { missing: 'missing event provider', ambiguous: 'ambiguous event provider' } })),
    providerBindings: providerIds.map((providerId, index) => ({ requirement: `requirement.events.${index}`, provider: { interface: 'EventLog', nodeId: providerId }, generatedResources: [], runtime: {} })),
  };
}

function declaredSchema() {
  return { kind: 'declared' as const, runtime: 'arktype' as const, jsonSchema: { type: 'object', properties: {}, required: [] } };
}

function emptyGraph(name: string): ApplicationGraph {
  return {
    apiVersion: 'applik8s.appGraph/v1alpha1', kind: 'ApplicationGraph', metadata: { name }, nodes: [], edges: [], providerRequirements: [], providerBindings: [],
    compatibility: { stablePublicApis: [], documentedInternalContracts: [], experimentalSurfaces: [], postV3Surfaces: [], labels: [] },
  };
}

function accessGraph(): ApplicationGraph {
  return {
    apiVersion: 'applik8s.appGraph/v1alpha1', kind: 'ApplicationGraph', metadata: { name: 'notes', namespace: 'notes' },
    nodes: [
      { id: 'operator.notes', kind: 'operator', name: 'notes', stability: 'stable', resources: [], watches: [], sourceLocation: { file: 'src/operator.ts', line: 1, column: 1 } },
      { id: 'secret.signing', kind: 'secret', name: 'signing', stability: 'stable', provider: 'Secret', ownership: 'external', key: 'key', redaction: 'required', generatedResources: [] },
    ],
    edges: [{ from: { nodeId: 'operator.notes' }, to: { nodeId: 'secret.signing' }, relationship: 'reads' }],
    providerRequirements: [], providerBindings: [],
    compatibility: { stablePublicApis: [], documentedInternalContracts: [], experimentalSurfaces: [], postV3Surfaces: [], labels: [] },
  };
}

function awsObjectAccessGraph(bucket: string | undefined): ApplicationGraph {
  return {
    apiVersion: 'applik8s.appGraph/v1alpha1', kind: 'ApplicationGraph', metadata: { name: 'objects' },
    nodes: [
      { id: 'operator.objects', kind: 'operator', name: 'objects', stability: 'stable', resources: [], watches: [], sourceLocation: { file: 'src/operator.ts', line: 1, column: 1 } },
      {
        id: 'provider.ObjectStorage', kind: 'provider', name: 'ObjectStorage', stability: 'stable', interface: 'ObjectStorage', implementation: 's3',
        config: { objectStorage: { kind: 's3', prefix: 'tenants', ...(bucket ? { bucket } : {}) } },
      },
      {
        id: 'objectStore.attachments', kind: 'objectStore', name: 'attachments', stability: 'stable',
        provider: { interface: 'ObjectStorage', nodeId: 'provider.ObjectStorage' }, objectMode: 'immutable', maxObjectBytes: 1024,
        contentTypes: ['application/octet-stream'],
        browserAccess: { upload: 'signed', download: 'signed', downloadAccess: 'owner', ttlSeconds: 60 }, integrity: 'sha256', credentials: 'server-only', deletion: 'explicit',
      },
    ],
    edges: [{ from: { nodeId: 'operator.objects' }, to: { nodeId: 'objectStore.attachments' }, relationship: 'writes' }],
    providerRequirements: [], providerBindings: [],
    compatibility: { stablePublicApis: [], documentedInternalContracts: [], experimentalSurfaces: [], postV3Surfaces: [], labels: [] },
  };
}

function awsParityResource(
  id: string,
  service: 'ecs' | 'iam' | 'rds',
  resourceType: string,
  configuration: Readonly<Record<string, unknown>> = {},
  physicalName = id.replace(/[^a-z0-9-]/gu, '-'),
): ApplicationAwsPlanResource {
  return {
    id,
    service,
    resourceType,
    physicalName,
    lifecycle: { ownership: 'application' as const, deletion: 'delete' as const, adoption: 'createOnly' as const },
    network: service === 'iam' ? 'control-plane' as const : 'private' as const,
    configuration: configuration as DeploymentJsonObject,
    outputs: [],
    provenance: {},
  };
}
