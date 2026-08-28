// typecast-file-boundary: This opt-in live fixture constructs one validated
// application graph and narrows kubectl observations only after exact resource
// identity checks. It never reads or prints generated Secret values.
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApplicationGraph } from '@applik8s/core';
import {
  type ApplicationAlchemyDeployment,
  createApplicationAlchemyGraphDeployment,
} from '@applik8s/deployment-alchemy';
import {
  clickStackCredentialsSecretName,
  compileApplicationDeploymentGraph,
} from '@applik8s/deployment-compiler';
import {
  applicationDeploymentOutputReference,
  type DeploymentJsonObject,
  digestApplicationDeploymentValue,
} from '@applik8s/deployment-contract';
import type { ApplicationTypeKroCompositionSource } from '@applik8s/deployment-typekro';
import { type } from 'arktype';
import { kubernetesComposition } from 'typekro';
import { describe, expect, it } from 'vitest';
import {
  assertExpectedKubectlContext,
  kubectl,
  sleep,
} from './live-e2e-helpers.js';

const live = process.env.APPLIK8S_E2E_LIVE === '1'
  && process.env.APPLIK8S_E2E_CLICKSTACK === '1';

describe('v0.8 ClickStack application observability provider', () => {
  (live ? it : it.skip)(
    'installs, ingests and queries all signals across an emitter restart, then deletes through Alchemy',
    async () => {
      await assertExpectedKubectlContext();
      const suffix = process.env.APPLIK8S_CLICKSTACK_RUN_SUFFIX
        ?? randomUUID().replaceAll('-', '').slice(0, 10);
      const cleanupOnly = process.env.APPLIK8S_CLICKSTACK_CLEANUP_ONLY === '1';
      const recoveryProviderName = process.env.APPLIK8S_CLICKSTACK_RECOVERY_PROVIDER_NAME;
      if (recoveryProviderName && !cleanupOnly) {
        throw new Error('APPLIK8S_CLICKSTACK_RECOVERY_PROVIDER_NAME is valid only with cleanup-only recovery.');
      }
      const application = `v08-clickstack-${suffix}`;
      const namespace = application;
      const instance = 'qualification';
      const configuredStateRoot = process.env.APPLIK8S_CLICKSTACK_STATE_ROOT;
      const stateRoot = configuredStateRoot
        ?? await mkdtemp(join(tmpdir(), `${application}-alchemy-`));
      let deployment: ApplicationAlchemyDeployment | undefined;
      let applied = false;
      const cleanupErrors: string[] = [];

      try {
        if (!cleanupOnly) await preflight(namespace);
        const graph = observabilityApplicationGraph(application, namespace);
        const sourceGraphDigest = digestApplicationDeploymentValue(graph);
        const compiled = compileApplicationDeploymentGraph({
          graph,
          workspaceRoot: process.cwd(),
          target: 'kubernetes',
          sourceGraphDigest,
          compilerVersion: '0.8.0-clickstack-live',
          identity: {
            connection: {
              provider: 'kubernetes',
              cluster: process.env.APPLIK8S_E2E_CONTEXT ?? 'orbstack',
              digest: digestApplicationDeploymentValue({
                provider: 'kubernetes',
                context: process.env.APPLIK8S_E2E_CONTEXT ?? 'orbstack',
              }),
            },
            application,
            controlPlaneNamespace: 'default',
            instance,
            profile: 'qualification',
          },
          strategy: 'direct',
          installationSpec: { name: instance, namespace },
          artifacts: [],
          materializedComposition: {
            resources: [{
              id: 'observabilityContract',
              template: {
                apiVersion: 'v1',
                kind: 'ConfigMap',
                metadata: {
                  name: `${application}-contract`,
                  namespace,
                  annotations: {
                    'applik8s.dev/otlp-endpoint': applicationDeploymentOutputReference(
                      'direct.provider.observability.clickstack',
                      'otlpHttpEndpoint',
                    ),
                  },
                },
                data: { provider: 'clickstack' },
              },
            }, ...(['initial', 'restarted'] as const).map((phase) => ({
              id: `telemetryEmitter${phase}`,
              template: clickStackTelemetryEmitterJob({
                application,
                namespace,
                credentialsName: clickStackCredentialsSecretName(application),
                endpoint: applicationDeploymentOutputReference(
                  'direct.provider.observability.clickstack',
                  'otlpHttpEndpoint',
                ),
                canary: suffix,
                phase,
              }),
            }))],
            status: { ready: true },
          },
        });
        expect(compiled.runtimeAccess.diagnostics).toEqual([]);
        const plannedClickstackName = requiredGraphString(
          compiled.graph.nodes.find(({ id }) => id === 'direct.provider.observability.clickstack')?.spec,
          ['configuration', 'instance', 'name'],
        );
        // A failed live run from an older compiler may need to be adopted with
        // its historical provider identity before TypeKro can converge it to
        // absence. This is opt-in, cleanup-only, and changes only the
        // run-scoped test graph; ordinary qualification always uses the exact
        // compiler output.
        const deploymentGraph = recoveryProviderName
          ? replaceDeploymentGraphString(compiled.graph, plannedClickstackName, recoveryProviderName)
          : compiled.graph;
        expect(JSON.stringify(deploymentGraph)).not.toContain('CLICKHOUSE_PASSWORD":"');
        expect(JSON.stringify(deploymentGraph)).not.toContain('HYPERDX_API_KEY":"');
        // Read controller-facing identities from the compiled graph. Provider
        // planning deliberately bounds these names before Altinity derives
        // child Service and StatefulSet names, so the live fixture must verify
        // the deployed plan rather than duplicate that private naming policy.
        const clickhouseName = requiredGraphString(
          deploymentGraph.nodes.find(({ id }) => id === 'direct.provider.observability.clickhouse')?.spec,
          ['configuration', 'name'],
        );
        const clickstackName = requiredGraphString(
          deploymentGraph.nodes.find(({ id }) => id === 'direct.provider.observability.clickstack')?.spec,
          ['configuration', 'instance', 'name'],
        );

        deployment = await createApplicationAlchemyGraphDeployment({
          graph: deploymentGraph,
          source: observabilitySource(application),
          spec: { name: instance, namespace },
          stateRoot,
          stage: 'qualification',
          owner: `v08-clickstack-live-${suffix}`,
          factory: {
            namespace: 'default',
            waitForReady: recoveryProviderName ? false : true,
            timeout: 1_200_000,
          },
        });
        if (cleanupOnly) {
          if (recoveryProviderName) {
            await deployment.apply();
          }
          await deployment.destroy();
          deployment = undefined;
          await waitForNamespaceAbsent(namespace, 600_000);
          return;
        }
        try {
          await expect(deployment.apply()).resolves.toMatchObject({ transaction: 'applied' });
        } catch (cause) {
          const logs = await Promise.all((['initial', 'restarted'] as const).map(async (phase) => {
            const result = await kubectl([
              'logs', `job/${application}-telemetry-${phase}`, '--namespace', namespace,
            ]).catch((logCause) => ({ stdout: `unavailable: ${message(logCause)}`, stderr: '' }));
            return `${phase}:\n${result.stdout}${result.stderr}`;
          }));
          const collector = await clickStackCollectorDiagnostics(namespace);
          throw new Error(
            `ClickStack emitter deployment failed: ${message(cause)}\n${logs.join('\n')}\n${collector}`,
          );
        }
        applied = true;
        await expectReadyHelmRelease(namespace, clickstackName);
        await expectReadyClickHouse(namespace, clickhouseName);
        await expectContractEndpoint(namespace, application, clickstackName);

        for (const phase of ['initial', 'restarted'] as const) {
          const output = await kubectl([
            'logs', `job/${application}-telemetry-${phase}`, '--namespace', namespace,
          ]);
          expect(output.stdout).toContain(`clickstack-canary.${suffix}.${phase}`);
        }

        const pod = await clickHousePod(namespace, clickhouseName);
        for (const phase of ['initial', 'restarted'] as const) {
          const operation = `clickstack-canary.${suffix}.${phase}`;
          const event = `clickstack-canary-${suffix}-${phase}`;
          await waitForClickHouseCount(
            namespace,
            pod,
            `SELECT count() FROM default.otel_traces WHERE SpanName = ${sqlString(`applik8s.operation.${operation}`)}`,
          );
          await waitForClickHouseCount(
            namespace,
            pod,
            `SELECT count() FROM default.otel_logs WHERE Body = ${sqlString(event)}`,
          );
          await waitForClickHouseCount(
            namespace,
            pod,
            [
              'SELECT count() FROM default.otel_metrics_sum',
              `WHERE MetricName = 'applik8s.operation.count'`,
              `AND Attributes['applik8s.operation'] = ${sqlString(operation)}`,
            ].join(' '),
          );
        }
        const redactionCount = await clickHouseCount(
          namespace,
          pod,
          "SELECT count() FROM default.otel_logs WHERE Body LIKE '%redaction-canary-must-not-reach-clickstack%' OR toString(LogAttributes) LIKE '%redaction-canary-must-not-reach-clickstack%'",
        );
        expect(redactionCount).toBe(0);
      } finally {
        if (deployment) {
          await deployment.destroy().catch((cause) => cleanupErrors.push(message(cause)));
        }
        await waitForNamespaceAbsent(namespace, applied ? 600_000 : 180_000)
          .catch((cause) => cleanupErrors.push(message(cause)));
        if (!configuredStateRoot || cleanupOnly) {
          await rm(stateRoot, { recursive: true, force: true });
        }
      }

      expect(cleanupErrors).toEqual([]);
      await expectRetainedOperatorReady();
    },
    2_400_000,
  );
});

function observabilityApplicationGraph(application: string, namespace: string): ApplicationGraph {
  return {
    apiVersion: 'applik8s.appGraph/v1alpha1',
    kind: 'ApplicationGraph',
    metadata: { name: application, namespace },
    nodes: [{
      id: 'provider.observability',
      kind: 'provider',
      name: 'observability',
      stability: 'stable',
      interface: 'Observability',
      implementation: 'clickstack',
      config: {
        observability: {
          kind: 'clickstack',
          namespace,
          storageSize: '1Gi',
          metadataStorageSize: '1Gi',
          storageClassName: 'local-path',
          policy: {},
          retention: { logs: '1d', traces: '1d', metrics: '1d' },
        },
      },
    }],
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
}

function clickStackTelemetryEmitterJob(options: {
  readonly application: string;
  readonly namespace: string;
  readonly credentialsName: string;
  readonly endpoint: string;
  readonly canary: string;
  readonly phase: 'initial' | 'restarted';
}): DeploymentJsonObject {
  const operation = `clickstack-canary.${options.canary}.${options.phase}`;
  const event = `clickstack-canary-${options.canary}-${options.phase}`;
  const identity = digestApplicationDeploymentValue({ operation, event }).slice('sha256:'.length);
  const traceId = identity.slice(0, 32);
  const spanId = identity.slice(32, 48);
  const timestamp = String(BigInt(Date.now()) * 1_000_000n);
  const attribute = (key: string, value: string) => ({ key, value: { stringValue: value } });
  const resource = {
    attributes: [
      attribute('service.name', 'v08-clickstack-emitter'),
      attribute('applik8s.application', options.application),
    ],
  };
  const attributes = [attribute('applik8s.operation', operation)];
  const payloads = {
    traces: {
      resourceSpans: [{
        resource,
        scopeSpans: [{
          scope: { name: '@applik8s/runtime-otel' },
          spans: [{
            traceId,
            spanId,
            name: `applik8s.operation.${operation}`,
            kind: 1,
            startTimeUnixNano: timestamp,
            endTimeUnixNano: String(BigInt(timestamp) + 1_000_000n),
            attributes,
            status: { code: 1 },
          }],
        }],
      }],
    },
    logs: {
      resourceLogs: [{
        resource,
        scopeLogs: [{
          scope: { name: '@applik8s/runtime-otel' },
          logRecords: [{
            timeUnixNano: timestamp,
            severityNumber: 9,
            severityText: 'INFO',
            body: { stringValue: event },
            attributes,
          }],
        }],
      }],
    },
    metrics: {
      resourceMetrics: [{
        resource,
        scopeMetrics: [{
          scope: { name: '@applik8s/runtime-otel' },
          metrics: [{
            name: 'applik8s.operation.count',
            sum: {
              aggregationTemporality: 2,
              isMonotonic: true,
              dataPoints: [{ timeUnixNano: timestamp, asInt: '1', attributes }],
            },
          }],
        }],
      }],
    },
  };
  const source = [
    `const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;`,
    `const headerName = process.env.APPLIK8S_OTLP_HEADER_NAME;`,
    `const headerValue = process.env.APPLIK8S_OTLP_HEADER_VALUE;`,
    `if (!endpoint || !headerName || !headerValue) throw new Error('ClickStack runtime binding is incomplete.');`,
    `const payloads = ${JSON.stringify(payloads)};`,
    `const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));`,
    `async function exportSignal(signal, payload) {`,
    `  const deadline = Date.now() + 180_000;`,
    `  let failure = 'collector did not accept the request';`,
    `  while (Date.now() < deadline) {`,
    `    try {`,
    `      const response = await fetch(new URL('/v1/' + signal, endpoint), { method: 'POST', headers: { 'content-type': 'application/json', [headerName]: headerValue }, body: JSON.stringify(payload) });`,
    `      if (response.ok) return;`,
    `      failure = signal + ' export returned ' + response.status + ': ' + await response.text();`,
    `      if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) throw new Error(failure);`,
    `    } catch (cause) {`,
    `      const nested = cause && typeof cause === 'object' && 'cause' in cause ? cause.cause : undefined;`,
    `      const details = nested && typeof nested === 'object' ? JSON.stringify({ name: nested.name, code: nested.code, syscall: nested.syscall, hostname: nested.hostname, address: nested.address, port: nested.port, message: nested.message }) : String(nested ?? '');`,
    `      failure = (cause instanceof Error ? cause.message : String(cause)) + (details && details !== 'undefined' ? ' (' + details + ')' : '');`,
    `      if (/returned 4\\d\\d:/u.test(failure)) throw cause;`,
    `    }`,
    `    await delay(1_000);`,
    `  }`,
    `  throw new Error(signal + ' export timed out: ' + failure);`,
    `}`,
    `for (const [signal, payload] of Object.entries(payloads)) {`,
    `  await exportSignal(signal, payload);`,
    `}`,
    `process.stdout.write(${JSON.stringify(operation)});`,
  ].join('\n');
  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: {
      name: `${options.application}-telemetry-${options.phase}`,
      namespace: options.namespace,
      labels: { 'app.kubernetes.io/component': 'qualification-emitter' },
    },
    spec: {
      backoffLimit: 0,
      ttlSecondsAfterFinished: 600,
      template: {
        metadata: { labels: { 'app.kubernetes.io/component': 'qualification-emitter' } },
        spec: {
          restartPolicy: 'Never',
          containers: [{
            name: 'emitter',
            image: 'node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2',
            command: ['node', '--input-type=module', '--eval', source],
            env: [
              { name: 'OTEL_EXPORTER_OTLP_ENDPOINT', value: options.endpoint },
              { name: 'APPLIK8S_OTLP_HEADER_NAME', value: 'authorization' },
              {
                name: 'APPLIK8S_OTLP_HEADER_VALUE',
                valueFrom: {
                  secretKeyRef: {
                    name: options.credentialsName,
                    key: 'hyperdx-api-key',
                  },
                },
              },
            ],
          }],
        },
      },
    },
  };
}

function requiredGraphString(value: unknown, path: readonly string[]): string {
  let candidate = value;
  for (const segment of path) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error(`Compiled deployment graph omitted ${path.join('.')}.`);
    }
    candidate = (candidate as Readonly<Record<string, unknown>>)[segment];
  }
  if (typeof candidate !== 'string' || candidate.length === 0) {
    throw new Error(`Compiled deployment graph did not provide a non-empty ${path.join('.')}.`);
  }
  return candidate;
}

function replaceDeploymentGraphString<T>(value: T, source: string, replacement: string): T {
  return JSON.parse(JSON.stringify(value).replaceAll(source, replacement)) as T;
}

function observabilitySource(application: string): ApplicationTypeKroCompositionSource<
  { readonly name: string; readonly namespace: string },
  { readonly ready: boolean }
> {
  const definition = {
    name: application,
    apiVersion: 'qualification.applik8s.dev/v1alpha1',
    kind: `V08ClickStack${digestApplicationDeploymentValue(application).slice(7, 23)}`,
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

async function preflight(namespace: string): Promise<void> {
  const [node, storage, definitions, existingNamespace, controllers] = await Promise.all([
    kubectl(['get', 'node/orbstack', '--output=json']),
    kubectl(['get', 'storageclass/local-path', '--output=name']),
    kubectl(['get', 'crd/helmreleases.helm.toolkit.fluxcd.io', 'crd/helmrepositories.source.toolkit.fluxcd.io', 'crd/clickhouseinstallations.clickhouse.altinity.com', '--output=name']),
    kubectl(['get', `namespace/${namespace}`, '--ignore-not-found=true', '--output=name']),
    kubectl(['get', 'deployment/source-controller', 'deployment/helm-controller', '--namespace=flux-system', '--output=json']),
  ]);
  const observedNode = JSON.parse(node.stdout) as { readonly status?: { readonly conditions?: readonly { readonly type?: string; readonly status?: string }[]; readonly allocatable?: { readonly memory?: string } } };
  expect(observedNode.status?.conditions?.some(({ type: condition, status }) => condition === 'Ready' && status === 'True')).toBe(true);
  expect(Number.parseInt(observedNode.status?.allocatable?.memory ?? '0', 10)).toBeGreaterThanOrEqual(12 * 1024 * 1024);
  expect(storage.stdout.trim()).toBe('storageclass.storage.k8s.io/local-path');
  expect(definitions.stdout.trim().split('\n')).toHaveLength(3);
  expect(existingNamespace.stdout.trim()).toBe('');
  const deployments = JSON.parse(controllers.stdout) as { readonly items?: readonly { readonly metadata?: { readonly name?: string }; readonly status?: { readonly availableReplicas?: number } }[] };
  expect(deployments.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ metadata: expect.objectContaining({ name: 'source-controller' }), status: expect.objectContaining({ availableReplicas: expect.any(Number) }) }),
    expect.objectContaining({ metadata: expect.objectContaining({ name: 'helm-controller' }), status: expect.objectContaining({ availableReplicas: expect.any(Number) }) }),
  ]));
  await expectRetainedOperatorReady();
}

async function expectRetainedOperatorReady(): Promise<void> {
  const result = await kubectl(['get', 'helmrelease/clickhouse-operator', '--namespace=clickhouse-system', '--output=json']);
  const release = JSON.parse(result.stdout) as { readonly status?: { readonly conditions?: readonly { readonly type?: string; readonly status?: string; readonly observedGeneration?: number }[] }; readonly metadata?: { readonly generation?: number } };
  expect(release.status?.conditions?.some(({ type: condition, status, observedGeneration }) =>
    condition === 'Ready' && status === 'True' && observedGeneration === release.metadata?.generation)).toBe(true);
}

async function expectReadyHelmRelease(namespace: string, name: string): Promise<void> {
  const result = await kubectl(['get', `helmrelease/${name}`, '--namespace', namespace, '--output=json']);
  const release = JSON.parse(result.stdout) as { readonly status?: { readonly conditions?: readonly { readonly type?: string; readonly status?: string; readonly observedGeneration?: number }[] }; readonly metadata?: { readonly generation?: number } };
  expect(release.status?.conditions?.some(({ type: condition, status, observedGeneration }) =>
    condition === 'Ready' && status === 'True' && observedGeneration === release.metadata?.generation)).toBe(true);
}

async function expectReadyClickHouse(namespace: string, name: string): Promise<void> {
  const result = await kubectl(['get', `clickhouseinstallation/${name}`, '--namespace', namespace, '--output=json']);
  const cluster = JSON.parse(result.stdout) as { readonly status?: { readonly status?: string } };
  expect(cluster.status?.status).toBe('Completed');
}

async function expectContractEndpoint(namespace: string, application: string, clickstackName: string): Promise<void> {
  const result = await kubectl(['get', `configmap/${application}-contract`, '--namespace', namespace, '--output=json']);
  const contract = JSON.parse(result.stdout) as { readonly metadata?: { readonly annotations?: Readonly<Record<string, string>> } };
  expect(contract.metadata?.annotations?.['applik8s.dev/otlp-endpoint'])
    .toBe(`http://${clickstackName}-otel-collector.${namespace}.svc.cluster.local:4318`);
}

async function clickHousePod(namespace: string, clickhouseName: string): Promise<string> {
  const service = `clickhouse-${clickhouseName}`;
  const result = await kubectl(['get', `endpoints/${service}`, '--namespace', namespace, '--output=json']);
  const endpoints = JSON.parse(result.stdout) as { readonly subsets?: readonly { readonly addresses?: readonly { readonly targetRef?: { readonly name?: string } }[] }[] };
  const pod = endpoints.subsets?.flatMap(({ addresses }) => addresses ?? [])
    .map(({ targetRef }) => targetRef?.name)
    .find((name): name is string => Boolean(name));
  if (!pod) throw new Error(`ClickHouse Service ${namespace}/${service} has no ready Pod endpoint.`);
  return pod;
}

async function clickStackCollectorDiagnostics(namespace: string): Promise<string> {
  try {
    const [result, services, endpoints] = await Promise.all([kubectl([
      'get', 'pods', '--namespace', namespace,
      '--selector', 'app.kubernetes.io/name=otel-collector',
      '--output=json',
    ]), kubectl(['get', 'services', '--namespace', namespace, '--output=json']),
    kubectl(['get', 'endpoints', '--namespace', namespace, '--output=json'])]);
    const pods = JSON.parse(result.stdout) as {
      readonly items?: readonly {
        readonly metadata?: { readonly name?: string };
        readonly status?: {
          readonly phase?: string;
          readonly containerStatuses?: readonly {
            readonly name?: string;
            readonly ready?: boolean;
            readonly restartCount?: number;
            readonly state?: unknown;
          }[];
        };
      }[];
    };
    const observations = await Promise.all((pods.items ?? []).map(async (pod) => {
      const name = pod.metadata?.name;
      if (!name) return `collector pod with no name: ${JSON.stringify(pod.status ?? {})}`;
      const logs = await kubectl([
        'logs', name, '--namespace', namespace, '--all-containers=true', '--tail=300',
      ]).catch((cause) => ({ stdout: '', stderr: `unavailable: ${message(cause)}` }));
      return [
        `collector pod ${name}: ${JSON.stringify(pod.status ?? {})}`,
        `${logs.stdout}${logs.stderr}`,
      ].join('\n');
    }));
    return [
      observations.length > 0
        ? observations.join('\n')
        : 'No ClickStack collector pod matched app.kubernetes.io/name=otel-collector.',
      `services: ${services.stdout}`,
      `endpoints: ${endpoints.stdout}`,
    ].join('\n');
  } catch (cause) {
    return `ClickStack collector diagnostics unavailable: ${message(cause)}`;
  }
}

async function clickHouseCount(namespace: string, pod: string, query: string): Promise<number> {
  const result = await kubectl(['exec', '--namespace', namespace, pod, '--', 'clickhouse-client', '--format=TabSeparatedRaw', '--query', query]);
  const count = Number.parseInt(result.stdout.trim(), 10);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('ClickHouse count query returned a non-integer result.');
  return count;
}

async function waitForClickHouseCount(namespace: string, pod: string, query: string): Promise<void> {
  const deadline = Date.now() + 180_000;
  let observed = 0;
  while (Date.now() < deadline) {
    observed = await clickHouseCount(namespace, pod, query).catch(() => 0);
    if (observed > 0) return;
    await sleep(3_000);
  }
  throw new Error(`ClickHouse did not return the expected telemetry row; last count was ${observed}.`);
}

function sqlString(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

async function waitForNamespaceAbsent(namespace: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await kubectl(['get', `namespace/${namespace}`, '--ignore-not-found=true', '--output=name']);
    if (!result.stdout.trim()) return;
    await sleep(2_000);
  }
  throw new Error(`Namespace ${namespace} still exists after deployment.destroy().`);
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
