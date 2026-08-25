// typecast-file-boundary: This live gate constructs one validated portable
// application graph and narrows Kubernetes observations only after exact GVK,
// namespace, identity, and readiness checks.
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { type } from '@applik8s/applik8s';
import type { ApplicationGraph } from '@applik8s/core';
import {
  type ApplicationAlchemyDeployment,
  createApplicationAlchemyGraphDeployment,
} from '@applik8s/deployment-alchemy';
import {
  type ApplicationDeploymentContributor,
  compileApplicationDeploymentGraph,
} from '@applik8s/deployment-compiler';
import type { DeploymentJsonObject } from '@applik8s/deployment-contract';
import type { ApplicationTypeKroCompositionSource } from '@applik8s/deployment-typekro';
import { kubernetesComposition } from 'typekro';
import { expect, it } from 'vitest';
import {
  assertExpectedKubectlContext,
  describeLive,
  docker,
  kubectl,
  sleep,
} from './live-e2e-helpers.js';

const execFileAsync = promisify(execFile);
const nodeImage = 'node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2';
const allowedFqdn = 'example.com';
const deniedFqdn = 'example.org';

describeLive('v0.8 Kubernetes runtime-access enforcement on OrbStack', () => {
  it('enforces exact RBAC, Secret, private-peer, and FQDN access through the compiler-owned TypeKro/Alchemy lifecycle', async () => {
    await assertExpectedKubectlContext();
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
    const application = `v08-access-${suffix}`;
    const namespace = application;
    const instance = 'qualification';
    const serviceAccount = 'runtime-probe';
    const credentialSecret = `${application}-credential`;
    const siblingSecret = `${application}-sibling`;
    const allowedConfigMap = `${application}-allowed`;
    const siblingConfigMap = `${application}-sibling`;
    const privateService = `${application}-private`;
    const probeDeployment = `${application}-probe`;
    const projectRoot = await mkdtemp(join(tmpdir(), 'applik8s-v08-runtime-access-'));
    const stateRoot = join(projectRoot, '.alchemy-state');
    const builtImages = new Set<string>();
    let deployment: ApplicationAlchemyDeployment | undefined;
    let destroyed = false;
    let testFailure: unknown;
    const cleanupErrors: string[] = [];

    try {
      await preflightRuntimeAccess(namespace);
      const artifact = await writeProbeArtifact(projectRoot, application);
      const graph = runtimeAccessApplicationGraph({
        application,
        namespace,
        credentialSecret,
        allowedConfigMap,
      });
      const compiled = compileApplicationDeploymentGraph({
        graph,
        workspaceRoot: projectRoot,
        target: 'kubernetes',
        sourceGraphDigest: `sha256:${'8'.repeat(64)}`,
        compilerVersion: '0.8.0',
        identity: {
          connection: {
            provider: 'kubernetes',
            cluster: process.env.APPLIK8S_E2E_CONTEXT ?? 'orbstack',
            digest: `sha256:${'9'.repeat(64)}`,
          },
          application,
          // Direct-mode application resources live in the owned workload
          // namespace. Keep compiler control-plane state in the protected,
          // pre-existing namespace so the fixture's namespace has delete
          // rather than retain lifecycle semantics.
          controlPlaneNamespace: 'default',
          instance,
          profile: 'starter',
        },
        strategy: 'direct',
        installationSpec: { name: instance, namespace },
        artifacts: [{
          id: 'artifact.runtime-probe',
          artifactType: 'containerImage',
          name: `${application}-probe`,
          sourceDigest: artifact.digest,
          sourceDescriptor: {
            contextPath: artifact.context,
            dockerfilePath: artifact.dockerfile,
          },
          logicalReference: artifact.logicalReference,
          semanticNodeId: 'server.probe',
          executionNodeIds: ['server.probe'],
        }],
        generatedSecrets: [
          {
            id: 'runtime-access.credential',
            namespace,
            name: credentialSecret,
            values: {
              allowed: { kind: 'random', bytes: 32, encoding: 'base64url' },
              sibling: { kind: 'random', bytes: 32, encoding: 'base64url' },
            },
            consumers: [],
            referenceMode: 'staticIdentity',
          },
          {
            id: 'runtime-access.sibling',
            namespace,
            name: siblingSecret,
            values: {
              value: { kind: 'random', bytes: 32, encoding: 'base64url' },
            },
            consumers: [],
            referenceMode: 'staticIdentity',
          },
        ],
        materializedComposition: {
          resources: runtimeAccessResources({
            application,
            namespace,
            serviceAccount,
            credentialSecret,
            siblingSecret,
            allowedConfigMap,
            siblingConfigMap,
            privateService,
            probeDeployment,
            probeImage: artifact.logicalReference,
          }),
          status: { ready: true },
        },
        runtimeAccessKubernetesNetworkPolicyProvider: 'cilium',
        contributors: runtimeAccessContributors({ namespace, privateService }),
      });

      expect(compiled.runtimeAccess.diagnostics).toEqual([]);
      expect(compiled.runtimeAccess.workloads).toHaveLength(1);
      expect(compiled.graph.nodes.find((node) => node.id === 'direct.namespace.workload'))
        .toMatchObject({ lifecycle: { deletion: 'delete' } });
      expect(compiled.graph.nodes.some((node) => node.id === 'direct.namespace.control-plane'))
        .toBe(false);
      for (const generatedSecretId of [
        'external.generated-secret.runtime-access.credential',
        'external.generated-secret.runtime-access.sibling',
      ]) {
        expect(compiled.graph.edges.filter((edge) =>
          edge.from === generatedSecretId && edge.to === 'kubernetes.application'))
          .toEqual([{ from: generatedSecretId, to: 'kubernetes.application', relationship: 'requiresReady' }]);
      }
      expect(compiled.runtimeAccess.workloads[0]?.kubernetes).toMatchObject({
        resource: { kind: 'Deployment', namespace, name: probeDeployment },
        serviceAccountName: serviceAccount,
        credentialProjections: expect.arrayContaining([
          {
            resourceId: `v1/Secret/${namespace}/${credentialSecret}`,
            keys: ['allowed'],
          },
          {
            resourceId: `v1/Secret/${namespace}/${application}-context`,
            keys: ['key'],
          },
        ]),
        privatePeers: [expect.objectContaining({
          endpoint: expect.objectContaining({
            target: 'kubernetes', namespace, serviceName: privateService,
          }),
          protocol: 'TCP',
          port: 8080,
        })],
        externalEgress: [expect.objectContaining({
          destination: { kind: 'dnsName', hostname: allowedFqdn },
          protocol: 'TCP',
          port: 443,
        })],
        networkEnforcement: {
          kind: 'cilium-network-policy',
          apiVersion: 'cilium.io/v2',
          fidelity: 'exact',
        },
      });
      expect(generatedPolicy(compiled.graph)).toMatchObject({
        spec: {
          endpointSelector: { matchLabels: { 'app.kubernetes.io/name': probeDeployment } },
          egress: expect.arrayContaining([{
            toEndpoints: [{
              matchLabels: {
                'k8s:io.kubernetes.pod.namespace': namespace,
                'app.kubernetes.io/name': privateService,
              },
            }],
            toPorts: [{ ports: [{ protocol: 'TCP', port: '8080' }] }],
          }]),
        },
      });
      const policyName = generatedPolicyName(compiled.graph);
      const source = runtimeAccessCompositionSource(application);
      deployment = await createApplicationAlchemyGraphDeployment({
        graph: compiled.graph,
        source,
        spec: { name: instance, namespace },
        stateRoot,
        stage: 'qualification',
        owner: `v08-runtime-access-${process.pid}`,
        artifactRegistry: { type: 'orbstack' },
        factory: {
          namespace,
          waitForReady: true,
          timeout: 300_000,
        },
      });

      const applied = await deployment.apply();
      for (const built of applied.artifacts) builtImages.add(built.taggedReference);
      await waitForDeploymentReady(namespace, privateService, 180_000);
      const initialProbeUid = await waitForDeploymentReady(namespace, probeDeployment, 240_000);
      await waitForCiliumPolicy(namespace, policyName, 60_000);

      await waitForRuntimeAccess({
        namespace,
        serviceAccount,
        probeDeployment,
        privateService,
        credentialSecret,
        siblingSecret,
        allowedConfigMap,
        siblingConfigMap,
      }, 60_000);

      // Pod loss is a bounded lifecycle failure injection. The owning
      // Deployment, policy, and application graph remain untouched.
      await kubectl([
        'delete', 'pod', '--namespace', namespace,
        '--selector', `app.kubernetes.io/name=${probeDeployment}`,
        '--wait=true', '--timeout=120s',
      ]);
      const restartedProbeUid = await waitForDeploymentReady(
        namespace,
        probeDeployment,
        180_000,
        initialProbeUid,
      );
      expect(restartedProbeUid).not.toBe(initialProbeUid);
      await waitForRuntimeAccess({
        namespace,
        serviceAccount,
        probeDeployment,
        privateService,
        credentialSecret,
        siblingSecret,
        allowedConfigMap,
        siblingConfigMap,
      }, 60_000);

      // Policy removal is the only out-of-band desired-state mutation. The
      // subsequent repair must be planned and applied by the owning graph.
      await kubectl([
        'delete', `ciliumnetworkpolicy/${policyName}`, '--namespace', namespace,
        '--wait=true', '--timeout=120s',
      ]);
      const driftPlan = await deployment.plan();
      expect(driftPlan.changes).toContainEqual(expect.objectContaining({
        action: expect.stringMatching(/^(?:create|update)$/u),
      }));
      await deployment.apply();
      await waitForCiliumPolicy(namespace, policyName, 60_000);
      await waitForRuntimeAccess({
        namespace,
        serviceAccount,
        probeDeployment,
        privateService,
        credentialSecret,
        siblingSecret,
        allowedConfigMap,
        siblingConfigMap,
      }, 60_000);

      await deployment.destroy();
      await waitForAbsent('namespace', namespace, 300_000);
      destroyed = true;
      expect((await kubectl([
        'get', 'deployment,service,serviceaccount,role,rolebinding,secret,configmap,ciliumnetworkpolicy',
        '--namespace', namespace, '--ignore-not-found=true', '--output=name',
      ])).stdout.trim()).toBe('');
    } catch (cause) {
      testFailure = cause;
    } finally {
      if (deployment && !destroyed) {
        try {
          await deployment.destroy();
          await waitForAbsent('namespace', namespace, 300_000);
          destroyed = true;
        } catch (cause) {
          cleanupErrors.push(`deployment destroy: ${errorMessage(cause)}`);
        }
      }
      try {
        const localImages = await docker([
          'image', 'ls', '--format', '{{.Repository}}:{{.Tag}}', `${application}-probe:*`,
        ], projectRoot);
        for (const image of localImages.stdout.split('\n').map((value) => value.trim()).filter(Boolean)) {
          builtImages.add(image);
        }
      } catch (cause) {
        cleanupErrors.push(`image inventory: ${errorMessage(cause)}`);
      }
      for (const image of builtImages) {
        try {
          await docker(['image', 'rm', '--force', image], projectRoot);
        } catch (cause) {
          cleanupErrors.push(`image ${image}: ${errorMessage(cause)}`);
        }
      }
      if (cleanupErrors.length === 0) {
        try {
          await rm(projectRoot, { recursive: true, force: true });
        } catch (cause) {
          cleanupErrors.push(`temporary directory: ${errorMessage(cause)}`);
        }
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [
          ...(testFailure === undefined ? [] : [testFailure]),
          ...cleanupErrors.map((message) => new Error(message)),
        ],
        `Runtime-access cleanup failed; recovery state remains at ${projectRoot}:\n${cleanupErrors.join('\n')}`,
      );
    }
    if (testFailure !== undefined) throw testFailure;
  }, 1_200_000);
});

interface RuntimeAccessFixture {
  readonly namespace: string;
  readonly serviceAccount: string;
  readonly probeDeployment: string;
  readonly privateService: string;
  readonly credentialSecret: string;
  readonly siblingSecret: string;
  readonly allowedConfigMap: string;
  readonly siblingConfigMap: string;
}

async function assertRuntimeAccess(fixture: RuntimeAccessFixture): Promise<void> {
  expect(await kubectlCanI([
    'get', `configmaps/${fixture.allowedConfigMap}`,
    '--namespace', fixture.namespace,
    '--as', `system:serviceaccount:${fixture.namespace}:${fixture.serviceAccount}`,
  ])).toBe(true);
  expect(await kubectlCanI([
    'get', `configmaps/${fixture.siblingConfigMap}`,
    '--namespace', fixture.namespace,
    '--as', `system:serviceaccount:${fixture.namespace}:${fixture.serviceAccount}`,
  ])).toBe(false);
  expect(await kubectlCanI([
    'get', `secrets/${fixture.credentialSecret}`,
    '--namespace', fixture.namespace,
    '--as', `system:serviceaccount:${fixture.namespace}:${fixture.serviceAccount}`,
  ])).toBe(false);

  const env = await probeExec(fixture, ['env', 'RUNTIME_SECRET_ALLOWED']);
  expect(env.stdout.trim()).toMatch(/^[A-Za-z0-9_-]{20,}$/u);
  await expect(probeExec(fixture, ['env', 'RUNTIME_SECRET_SIBLING'])).rejects.toThrow();
  await expect(probeExec(fixture, ['env', 'SIBLING_SECRET_VALUE'])).rejects.toThrow();

  await expect(probeExec(fixture, [
    'request', `http://${fixture.privateService}.${fixture.namespace}.svc.cluster.local:8080/`,
  ])).resolves.toMatchObject({ stdout: expect.stringContaining('status=200') });
  await expect(probeExec(fixture, [
    'request', `http://${fixture.privateService}.${fixture.namespace}.svc.cluster.local:8081/`,
  ])).rejects.toThrow();
  await expect(probeExec(fixture, [
    'request', `https://${allowedFqdn}/`,
  ])).resolves.toMatchObject({ stdout: expect.stringMatching(/status=\d+/u) });
  await expect(probeExec(fixture, [
    'request', `https://${deniedFqdn}/`,
  ])).rejects.toThrow();
}

async function waitForRuntimeAccess(
  fixture: RuntimeAccessFixture,
  timeout: number,
): Promise<void> {
  const deadline = Date.now() + timeout;
  let lastFailure: unknown;
  while (Date.now() < deadline) {
    try {
      await assertRuntimeAccess(fixture);
      return;
    } catch (cause) {
      lastFailure = cause;
      await sleep(1_000);
    }
  }
  throw new Error(
    `Runtime-access enforcement did not converge: ${errorMessage(lastFailure)}`,
    { cause: lastFailure },
  );
}

async function probeExec(
  fixture: Pick<RuntimeAccessFixture, 'namespace' | 'probeDeployment'>,
  args: readonly string[],
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  return kubectl([
    'exec', '--namespace', fixture.namespace, `deployment/${fixture.probeDeployment}`,
    '--', 'node', '/app/probe.mjs', ...args,
  ]);
}

async function kubectlCanI(args: readonly string[]): Promise<boolean> {
  try {
    const result = await execFileAsync('kubectl', ['auth', 'can-i', ...args], {
      cwd: process.cwd(),
      env: process.env,
      maxBuffer: 1024 * 1024,
    });
    return result.stdout.trim() === 'yes';
  } catch (cause) {
    if (isExecError(cause) && cause.stdout?.trim() === 'no') return false;
    throw cause;
  }
}

function runtimeAccessApplicationGraph(options: {
  readonly application: string;
  readonly namespace: string;
  readonly credentialSecret: string;
  readonly allowedConfigMap: string;
}): ApplicationGraph {
  const privateProvider = 'provider.private-api';
  const externalProvider = 'provider.external-api';
  const privateRequirement = 'requirement.probe.private-api';
  const externalRequirement = 'requirement.probe.external-api';
  return {
    apiVersion: 'applik8s.appGraph/v1alpha1',
    kind: 'ApplicationGraph',
    metadata: { name: options.application, namespace: options.namespace },
    nodes: [
      {
        id: privateProvider,
        kind: 'provider',
        name: 'private-api',
        stability: 'stable',
        interface: 'RuntimeAccessPrivateApi',
        implementation: 'qualification-private-api',
        config: {
          callableRuntime: {
            kind: 'runtime',
            runtime: { module: '@fixture/private-api', export: 'requestPrivateApi' },
          },
        },
      },
      {
        id: externalProvider,
        kind: 'provider',
        name: 'external-api',
        stability: 'stable',
        interface: 'RuntimeAccessExternalApi',
        implementation: 'qualification-external-api',
        config: {
          callableRuntime: {
            kind: 'runtime',
            runtime: { module: '@fixture/external-api', export: 'requestExternalApi' },
          },
        },
      },
      {
        id: 'server.probe',
        kind: 'server',
        name: 'probe',
        stability: 'stable',
        routes: [
          qualificationRoute('private', privateProvider, 'RuntimeAccessPrivateApi'),
          qualificationRoute('external', externalProvider, 'RuntimeAccessExternalApi'),
        ],
        resources: [],
        indexes: [],
        observability: {
          health: { mode: 'http', readinessPath: '/readyz', livenessPath: '/healthz' },
          logs: { format: 'json', component: 'probe', failureEvents: [] },
          metrics: { mode: 'none', names: [] },
          events: [],
          sourceMaps: 'required',
          replayArtifacts: [],
          diagnosticsArtifact: { kind: 'routeDiagnostics', name: 'probe-diagnostics' },
        },
      },
      {
        id: 'permission.probe-configmap',
        kind: 'permission',
        name: 'probe-configmap',
        stability: 'stable',
        owner: { nodeId: 'server.probe' },
        mode: 'inferred',
        rules: [{
          apiGroups: [''],
          resources: ['configmaps'],
          verbs: ['get'],
          resourceNames: [options.allowedConfigMap],
          scope: 'Namespaced',
          namespaces: [options.namespace],
        }],
      },
    ],
    edges: [],
    providerRequirements: [
      providerRequirement(privateRequirement, privateProvider, 'RuntimeAccessPrivateApi'),
      providerRequirement(externalRequirement, externalProvider, 'RuntimeAccessExternalApi'),
    ],
    providerBindings: [
      {
        requirement: privateRequirement,
        provider: { interface: 'RuntimeAccessPrivateApi', nodeId: privateProvider },
        generatedResources: [],
        runtime: {
          secretEnv: {
            RUNTIME_SECRET_ALLOWED: {
              secret: {
                apiVersion: 'v1',
                kind: 'Secret',
                namespace: options.namespace,
                name: options.credentialSecret,
              },
              key: 'allowed',
            },
          },
        },
      },
      {
        requirement: externalRequirement,
        provider: { interface: 'RuntimeAccessExternalApi', nodeId: externalProvider },
        generatedResources: [],
        runtime: {},
      },
    ],
    compatibility: {
      stablePublicApis: [],
      documentedInternalContracts: [],
      experimentalSurfaces: [],
      postV3Surfaces: [],
      labels: [],
    },
  };
}

function qualificationRoute(
  id: string,
  providerId: string,
  providerInterface: string,
) {
  const schema = {
    kind: 'declared' as const,
    runtime: 'arktype' as const,
    jsonSchema: { type: 'object', properties: {}, required: [] },
  };
  return {
    id,
    method: 'POST' as const,
    path: `/${id}`,
    diagnostics: {
      routeFailureEvent: 'applik8s-server-route-failure' as const,
      actionFailureEvent: 'applik8s-route-action-failure' as const,
      failurePolicy: 'failClosed' as const,
      partialEffects: 'unknownAfterActionStarted' as const,
      sourceMaps: 'required' as const,
      includes: ['routeId', 'method', 'path', 'module', 'sourceLocation', 'bundleInputs', 'action', 'diagnostic', 'stack'] as const,
    },
    functionNative: {
      input: schema,
      output: schema,
      handler: { source: 'async input => input' },
      providerBindings: [{
        identifier: `${id}.request`,
        provider: { interface: providerInterface, nodeId: providerId },
        operation: {
          member: 'request',
          runtime: {
            module: `@fixture/${id}-api`,
            export: 'request',
            access: { kind: 'provider' as const, operations: ['connection.use' as const] },
          },
        },
      }],
      idempotency: { source: 'http-idempotency-key' as const, contextScoped: true as const },
      requestBoundary: {
        durableValues: 'schema-normalized-only' as const,
        rawRequestCapture: 'rejected' as const,
        principal: 'framework-authenticated' as const,
      },
    },
  };
}

function providerRequirement(id: string, providerId: string, providerInterface: string) {
  return {
    id,
    interface: providerInterface,
    consumer: { nodeId: 'server.probe' },
    provider: { interface: providerInterface, nodeId: providerId },
    required: true as const,
    purpose: 'runtime-access qualification',
    diagnostics: { missing: 'provider missing', ambiguous: 'provider ambiguous' },
  };
}

function runtimeAccessContributors(options: {
  readonly namespace: string;
  readonly privateService: string;
}): readonly ApplicationDeploymentContributor[] {
  return [
    {
      interface: 'RuntimeAccessPrivateApi',
      implementation: 'qualification-private-api',
      version: 1,
      contribute(provider) {
        return {
          nodes: [],
          edges: [],
          compositionFragments: [],
          runtimeAccessTargets: [{
            capabilityId: provider.id,
            target: 'kubernetes',
            namespace: options.namespace,
            serviceName: options.privateService,
            podSelector: { 'app.kubernetes.io/name': options.privateService },
            protocol: 'TCP',
            port: 8080,
          }],
        };
      },
    },
    {
      interface: 'RuntimeAccessExternalApi',
      implementation: 'qualification-external-api',
      version: 1,
      contribute(provider) {
        return {
          nodes: [],
          edges: [],
          compositionFragments: [],
          runtimeAccessTargets: [{
            capabilityId: provider.id,
            target: 'external',
            protocol: 'TCP',
            port: 443,
            destination: { kind: 'dnsName', hostname: allowedFqdn },
            fidelity: 'port-only',
          }],
        };
      },
    },
  ];
}

function runtimeAccessResources(options: {
  readonly application: string;
  readonly namespace: string;
  readonly serviceAccount: string;
  readonly credentialSecret: string;
  readonly siblingSecret: string;
  readonly allowedConfigMap: string;
  readonly siblingConfigMap: string;
  readonly privateService: string;
  readonly probeDeployment: string;
  readonly probeImage: string;
}): readonly DeploymentJsonObject[] {
  const template = (id: string, resource: DeploymentJsonObject): DeploymentJsonObject => ({ id, template: resource });
  return [
    template('runtimeProbeServiceAccount', {
      apiVersion: 'v1', kind: 'ServiceAccount',
      metadata: { name: options.serviceAccount, namespace: options.namespace },
    }),
    template('runtimeProbeRole', {
      apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'Role',
      metadata: { name: `${options.application}-reader`, namespace: options.namespace },
      rules: [{
        apiGroups: [''], resources: ['configmaps'], verbs: ['get'],
        resourceNames: [options.allowedConfigMap],
      }],
    }),
    template('runtimeProbeRoleBinding', {
      apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'RoleBinding',
      metadata: { name: `${options.application}-reader`, namespace: options.namespace },
      subjects: [{ kind: 'ServiceAccount', name: options.serviceAccount, namespace: options.namespace }],
      roleRef: {
        apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name: `${options.application}-reader`,
      },
    }),
    template('runtimeAllowedConfig', {
      apiVersion: 'v1', kind: 'ConfigMap',
      metadata: { name: options.allowedConfigMap, namespace: options.namespace },
      data: { value: 'allowed' },
    }),
    template('runtimeSiblingConfig', {
      apiVersion: 'v1', kind: 'ConfigMap',
      metadata: { name: options.siblingConfigMap, namespace: options.namespace },
      data: { value: 'sibling' },
    }),
    template('runtimePrivateDeployment', {
      apiVersion: 'apps/v1', kind: 'Deployment',
      metadata: { name: options.privateService, namespace: options.namespace },
      spec: {
        replicas: 1,
        selector: { matchLabels: { 'app.kubernetes.io/name': options.privateService } },
        template: {
          metadata: { labels: { 'app.kubernetes.io/name': options.privateService } },
          spec: {
            containers: [{
              name: 'server', image: nodeImage,
              command: ['node', '-e', privateServerSource()],
              ports: [{ name: 'allowed', containerPort: 8080 }, { name: 'denied', containerPort: 8081 }],
              readinessProbe: { httpGet: { path: '/', port: 8080 }, initialDelaySeconds: 1, periodSeconds: 1 },
            }],
          },
        },
      },
    }),
    template('runtimePrivateService', {
      apiVersion: 'v1', kind: 'Service',
      metadata: { name: options.privateService, namespace: options.namespace },
      spec: {
        selector: { 'app.kubernetes.io/name': options.privateService },
        ports: [
          { name: 'allowed', port: 8080, targetPort: 8080 },
          { name: 'denied', port: 8081, targetPort: 8081 },
        ],
      },
    }),
    template('runtimeProbeDeployment', {
      apiVersion: 'apps/v1', kind: 'Deployment',
      metadata: { name: options.probeDeployment, namespace: options.namespace },
      spec: {
        replicas: 1,
        selector: { matchLabels: { 'app.kubernetes.io/name': options.probeDeployment } },
        template: {
          metadata: { labels: { 'app.kubernetes.io/name': options.probeDeployment } },
          spec: {
            serviceAccountName: options.serviceAccount,
            containers: [{
              name: 'probe', image: options.probeImage,
              env: [
                {
                  name: 'RUNTIME_SECRET_ALLOWED',
                  valueFrom: { secretKeyRef: { name: options.credentialSecret, key: 'allowed' } },
                },
                {
                  name: 'APPLIK8S_CONTEXT_KEY',
                  valueFrom: { secretKeyRef: { name: `${options.application}-context`, key: 'key' } },
                },
              ],
              ports: [{ name: 'health', containerPort: 9090 }],
              readinessProbe: { httpGet: { path: '/readyz', port: 9090 }, initialDelaySeconds: 1, periodSeconds: 1 },
            }],
          },
        },
      },
    }),
  ];
}

function runtimeAccessCompositionSource(application: string): ApplicationTypeKroCompositionSource<
  { readonly name: string; readonly namespace: string },
  { readonly ready: boolean }
> {
  const definition = {
    name: application,
    apiVersion: 'qualification.applik8s.dev/v1alpha1',
    kind: applicationKind(application),
    spec: type({ name: 'string', namespace: 'string' }),
    status: type({ ready: 'boolean' }),
  };
  const source = kubernetesComposition(definition, () => ({ ready: true }));
  Object.defineProperty(source, '__applik8sTypeKroDefinition', {
    value: definition,
    enumerable: false,
  });
  return source;
}

async function writeProbeArtifact(projectRoot: string, application: string): Promise<{
  readonly context: string;
  readonly dockerfile: string;
  readonly digest: `sha256:${string}`;
  readonly logicalReference: string;
}> {
  const context = join(projectRoot, 'probe-container');
  const dockerfile = join(context, 'Dockerfile');
  const sourcePath = join(context, 'probe.mjs');
  const source = probeSource();
  const docker = `FROM ${nodeImage}\nWORKDIR /app\nCOPY probe.mjs /app/probe.mjs\nCMD ["node", "/app/probe.mjs", "serve"]\n`;
  await mkdir(context, { recursive: true });
  await writeFile(sourcePath, source);
  await writeFile(dockerfile, docker);
  return {
    context,
    dockerfile,
    digest: `sha256:${createHash('sha256').update(docker).update(source).digest('hex')}`,
    logicalReference: `applik8s/${application}-probe:source`,
  };
}

function probeSource(): string {
  return `import http from 'node:http';
import https from 'node:https';

const [command, argument] = process.argv.slice(2);
if (command === 'serve') {
  http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('ready');
  }).listen(9090, '0.0.0.0');
} else if (command === 'env') {
  const value = process.env[argument];
  if (value === undefined) process.exit(4);
  process.stdout.write(value + '\\n');
} else if (command === 'request') {
  const url = new URL(argument);
  const client = url.protocol === 'https:' ? https : http;
  const request = client.get(url, { headers: { connection: 'close' } }, response => {
    response.resume();
    response.once('end', () => {
      process.stdout.write('status=' + String(response.statusCode ?? 0) + '\\n');
      process.exit(0);
    });
  });
  request.setTimeout(5_000, () => request.destroy(new Error('request timeout')));
  request.once('error', error => {
    process.stderr.write(String(error?.message ?? error) + '\\n');
    process.exit(5);
  });
  setTimeout(() => {
    process.stderr.write('request deadline exceeded\\n');
    process.exit(6);
  }, 7_000).unref();
} else {
  process.stderr.write('unknown probe command\\n');
  process.exit(2);
}
`;
}

function privateServerSource(): string {
  return "const h=require('http'); for (const p of [8080,8081]) h.createServer((_q,r)=>{r.writeHead(200);r.end('ok')}).listen(p,'0.0.0.0');";
}

function generatedPolicyName(graph: ReturnType<typeof compileApplicationDeploymentGraph>['graph']): string {
  const policy = generatedPolicy(graph);
  const name = stringValue(recordValue(policy.metadata)?.name);
  if (!name) throw new Error('Compiled graph has no generated CiliumNetworkPolicy name.');
  return name;
}

function generatedPolicy(
  graph: ReturnType<typeof compileApplicationDeploymentGraph>['graph'],
): Readonly<Record<string, unknown>> {
  const root = graph.nodes.find((node) => node.id === 'kubernetes.application');
  if (root?.kind !== 'kubernetesComposition') throw new Error('Compiled graph has no Kubernetes application root.');
  const policy = root.spec.materialized?.resources
    .map((resource) => recordValue(resource.template) ?? resource)
    .find((resource) => resource.kind === 'CiliumNetworkPolicy');
  if (!policy) throw new Error('Compiled graph has no generated CiliumNetworkPolicy.');
  return policy;
}

async function preflightRuntimeAccess(namespace: string): Promise<void> {
  const absent = (await kubectl([
    'get', `namespace/${namespace}`, '--ignore-not-found=true', '--output=name',
  ])).stdout.trim();
  if (absent) throw new Error(`Runtime-access namespace ${namespace} already exists.`);
  const version = JSON.parse((await kubectl(['version', '--output=json'])).stdout) as {
    readonly serverVersion?: { readonly major?: string; readonly minor?: string };
  };
  if (!version.serverVersion?.major || !version.serverVersion.minor) {
    throw new Error('Kubernetes server version is unavailable.');
  }
  const crd = JSON.parse((await kubectl([
    'get', 'customresourcedefinition/ciliumnetworkpolicies.cilium.io', '--output=json',
  ])).stdout) as { readonly status?: { readonly conditions?: readonly { readonly type?: string; readonly status?: string }[] } };
  if (!crd.status?.conditions?.some((condition) => condition.type === 'Established' && condition.status === 'True')) {
    throw new Error('CiliumNetworkPolicy v2 CRD is not established.');
  }
  const daemonSet = JSON.parse((await kubectl([
    'get', 'daemonset/cilium', '--namespace', 'kube-system', '--output=json',
  ])).stdout) as { readonly status?: { readonly desiredNumberScheduled?: number; readonly numberReady?: number } };
  if (!daemonSet.status?.desiredNumberScheduled || daemonSet.status.numberReady !== daemonSet.status.desiredNumberScheduled) {
    throw new Error('Cilium agents are not fully ready.');
  }
  const ciliumPods = JSON.parse((await kubectl([
    'get', 'pods', '--namespace', 'kube-system', '--selector', 'k8s-app=cilium', '--output=json',
  ])).stdout) as {
    readonly items?: readonly {
      readonly metadata?: { readonly name?: string };
      readonly status?: { readonly conditions?: readonly { readonly type?: string; readonly status?: string }[] };
    }[];
  };
  const ciliumPod = ciliumPods.items?.find((pod) =>
    pod.metadata?.name
    && pod.status?.conditions?.some((condition) => condition.type === 'Ready' && condition.status === 'True'))
    ?.metadata?.name;
  if (!ciliumPod) throw new Error('No ready Cilium agent pod is available for endpoint preflight.');
  const endpoints = JSON.parse((await kubectl([
    'exec', '--namespace', 'kube-system', ciliumPod, '--',
    'cilium-dbg', 'endpoint', 'list', '--output=json',
  ])).stdout) as readonly {
    readonly status?: {
      readonly identity?: { readonly labels?: readonly string[] };
    };
  }[];
  const managedPodEndpoint = endpoints.find((endpoint) =>
    endpoint.status?.identity?.labels?.some((label) =>
      label.startsWith('k8s:io.kubernetes.pod.namespace=')));
  if (!managedPodEndpoint) {
    throw new Error(
      'Cilium has no Kubernetes pod endpoints. The CRD and agent are present, but Cilium is not the active pod CNI, so CiliumNetworkPolicy would be admission-only and cannot qualify enforcement.',
    );
  }
  const l7 = (await kubectl([
    'get', 'configmap/cilium-config', '--namespace', 'kube-system',
    '--output=jsonpath={.data.enable-l7-proxy}',
  ])).stdout.trim();
  if (l7 !== 'true') throw new Error(`Cilium L7 proxy must be enabled; observed ${l7 || '<empty>'}.`);
  await docker(['info', '--format', '{{.ServerVersion}}'], process.cwd());
  await docker(['pull', nodeImage], process.cwd());
  await requestFromHost(`https://${allowedFqdn}/`);
}

async function requestFromHost(url: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = (url.startsWith('https:') ? https : http).get(url, (response) => {
      response.resume();
      response.once('end', resolve);
    });
    request.setTimeout(8_000, () => request.destroy(new Error(`Preflight request to ${url} timed out.`)));
    request.once('error', reject);
  });
}

async function waitForDeploymentReady(
  namespace: string,
  name: string,
  timeout: number,
  previousUid?: string,
): Promise<string> {
  const deadline = Date.now() + timeout;
  let last = '';
  while (Date.now() < deadline) {
    const raw = (await kubectl([
      'get', 'pods', '--namespace', namespace,
      '--selector', `app.kubernetes.io/name=${name}`, '--output=json',
    ])).stdout;
    last = raw;
    const value = JSON.parse(raw) as {
      readonly items?: readonly {
        readonly metadata?: { readonly uid?: string; readonly deletionTimestamp?: string };
        readonly status?: { readonly conditions?: readonly { readonly type?: string; readonly status?: string }[] };
      }[];
    };
    const ready = value.items?.find((pod) =>
      pod.metadata?.uid
      && !pod.metadata.deletionTimestamp
      && pod.metadata.uid !== previousUid
      && pod.status?.conditions?.some((condition) => condition.type === 'Ready' && condition.status === 'True'));
    if (ready?.metadata?.uid) return ready.metadata.uid;
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for Deployment/${name} in ${namespace}. Last pods: ${last}`);
}

async function waitForCiliumPolicy(namespace: string, name: string, timeout: number): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = (await kubectl([
      'get', `ciliumnetworkpolicy/${name}`, '--namespace', namespace,
      '--ignore-not-found=true', '--output=name',
    ])).stdout.trim();
    if (value) return;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for CiliumNetworkPolicy/${name} in ${namespace}.`);
}

async function waitForAbsent(kind: string, name: string, timeout: number): Promise<void> {
  const deadline = Date.now() + timeout;
  let last = '';
  while (Date.now() < deadline) {
    last = (await kubectl([
      'get', `${kind}/${name}`, '--ignore-not-found=true', '--output=name',
    ])).stdout.trim();
    if (!last) return;
    await sleep(2_000);
  }
  throw new Error(`Timed out waiting for ${kind}/${name} to disappear. Last value: ${last}`);
}

function applicationKind(application: string): string {
  return application.split(/[^a-zA-Z0-9]+/u)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join('');
}

function recordValue(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isExecError(cause: unknown): cause is Error & { readonly stdout?: string } {
  return cause instanceof Error && 'stdout' in cause;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
