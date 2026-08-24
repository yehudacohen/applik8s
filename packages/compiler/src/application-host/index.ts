// typecast-file-boundary: Compiler lowering converts validated normalized graph nodes into Kubernetes resource records at this emission boundary.
import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  type ApplicationGraph,
  type ApplicationProviderNode,
  exactFiveFieldCronForInterval,
  type JsonObject,
  normalizeApplicationGraph,
} from '@applik8s/core';
import { applicationCallableProviderEnvironment } from '../application-callable-provider-runtime.js';
import { applicationGraphNumberValue, applicationGraphStringValue } from '../application-installation-values.js';
import { applicationObjectStorageEnvironment } from '../application-object-storage-environment.js';
import { applicationHatchetScheduleBindings } from '../application-schedule-hatchet.js';

export interface GeneratedApplicationHostResource {
  readonly apiVersion: string;
  readonly kind: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly spec?: Readonly<Record<string, unknown>>;
  readonly data?: Readonly<Record<string, string>>;
  readonly binaryData?: Readonly<Record<string, string>>;
  readonly rules?: readonly Readonly<Record<string, unknown>>[];
  readonly roleRef?: Readonly<Record<string, unknown>>;
  readonly subjects?: readonly Readonly<Record<string, unknown>>[];
}

export interface ApplicationWebArtifactManifest {
  readonly apiVersion: 'applik8s.webArtifact/v1alpha1';
  readonly application: string;
  readonly output: string;
  readonly target: 'browser' | 'server';
  readonly digest: string;
  readonly entrypoint?: string;
  readonly artifacts: readonly { readonly path: string; readonly bytes: number; readonly digest: string }[];
}

/**
 * A successful Vite/Start server build is itself the user's request to run
 * that web application. Preserve the authored graph while contributing the
 * compiler-owned host provider only when no advanced host was selected.
 */
export async function applicationGraphWithInferredApplicationHost(
  graph: ApplicationGraph,
  entrypoint: string,
): Promise<ApplicationGraph> {
  if (
    graph.nodes.some(
      (node) =>
        node.kind === 'provider'
        && node.interface === 'ApplicationHost',
    )
  ) {
    return graph;
  }
  const manifestPath = await findStartArtifactManifest(
    dirname(resolve(entrypoint)),
  );
  if (!manifestPath) return graph;
  const manifest = validateWebArtifactManifest(
    JSON.parse(await readFile(manifestPath, 'utf8')),
  );
  if (manifest.target !== 'server' || !manifest.entrypoint) {
    throw new Error(
      'Inferred ApplicationHost requires the executable server artifact emitted by the Applik8s Vite adapter.',
    );
  }
  const name = `${graph.metadata.name}-app`;
  const provider: ApplicationProviderNode<'ApplicationHost'> = {
    id: 'provider.ApplicationHost',
    kind: 'provider',
    name: 'ApplicationHost',
    stability: 'stable',
    interface: 'ApplicationHost',
    implementation: 'managed-application-host',
    config: {
      host: {
        kind: 'managed-application-host',
        name,
        namespace: graph.metadata.namespace ?? 'default',
        replicas: 1,
        port: 3000,
      },
    },
  };
  return normalizeApplicationGraph({
    ...graph,
    nodes: [...graph.nodes, provider],
  });
}

export async function emitGeneratedApplicationHost(options: {
  readonly graph: ApplicationGraph;
  readonly entrypoint: string;
  readonly outDir: string;
}): Promise<readonly GeneratedApplicationHostResource[]> {
  const host = options.graph.nodes.find(
    (node): node is ApplicationProviderNode => node.kind === 'provider' && node.interface === 'ApplicationHost',
  );
  if (!host) return [];
  const config = objectValue(host.config?.host);
  if (!['managed-application-host', 'kubernetes-application-host'].includes(stringValue(config.kind) ?? '')) {
    throw new Error(`ApplicationHost provider ${host.id} uses unsupported implementation ${JSON.stringify(config.kind)}.`);
  }
  const manifestPath = await findStartArtifactManifest(dirname(resolve(options.entrypoint)));
  if (!manifestPath) {
    throw new Error('ApplicationHost requires a Vite web artifact manifest. Run the browser/server build with the Applik8s Vite adapter before compiling the application graph.');
  }
  const manifest = validateWebArtifactManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
  if (manifest.target !== 'server' || !manifest.entrypoint) {
    throw new Error('ApplicationHost requires the server Start build artifact manifest with an executable entrypoint.');
  }
  const name = stringValue(config.name) ?? `${options.graph.metadata.name}-web`;
  const namespace = applicationGraphStringValue(config.namespace) ?? applicationGraphStringValue(options.graph.metadata.namespace) ?? 'default';
  assertApplicationHostKubernetesNamespaces(options.graph, namespace);
  const port = positiveInteger(config.port) ?? 3000;
  const replicas = applicationGraphNumberValue(config.replicas) ?? 1;
  const serviceAccountName = stringValue(config.serviceAccountName) ?? name;
  const image = stringValue(config.image) ?? `applik8s.local/${name}:sha256-${manifest.digest.slice('sha256:'.length, 'sha256:'.length + 16)}`;
  const imagePullPolicy = stringValue(config.imagePullPolicy) ?? (config.image ? 'IfNotPresent' : 'Never');
  const cursorSecret = objectValue(config.cursorSecret);
  const sharedGatewayCursor = applicationSharedGatewayCursorSecret(options.graph, namespace);
  const cursorSecretName = stringValue(cursorSecret.name) ?? sharedGatewayCursor?.name ?? `${name}-gateway-cursor`;
  const cursorSecretKey = stringValue(cursorSecret.key) ?? sharedGatewayCursor?.key ?? 'key';
  const labels = {
    'app.kubernetes.io/name': name,
    'app.kubernetes.io/component': 'application-host',
    'applik8s.dev/graph': options.graph.metadata.name,
  };
  const resources = objectValue(config.resources);
  const resourceRequirements = {
    requests: { cpu: '100m', memory: '128Mi', ...objectValue(resources.requests) },
    limits: { memory: '256Mi', ...objectValue(resources.limits) },
  };
  const objectStorageEnvironment = options.graph.nodes.some(
    (node) => node.kind === 'objectStore',
  )
    ? applicationObjectStorageEnvironment(
        options.graph,
        namespace,
        'ApplicationHost browser object intents',
      )
    : [];
  const identityDatabaseEnvironment =
    applicationHostIdentityDatabaseEnvironment(options.graph, namespace);
  const internalOperationEnvironment = applicationHostInternalOperationEnvironment(
    options.graph,
    namespace,
  );
  const scheduleDatabaseEnvironment = applicationScheduleDatabaseEnvironment(
    options.graph,
    namespace,
  );
  const workflowScheduleAccess = options.graph.nodes.some(
    (node) => node.kind === 'schedule' && node.target?.kind === 'durableStart',
  );
  const hatchetScheduleBindings = applicationHatchetScheduleBindings(options.graph);
  for (const binding of hatchetScheduleBindings) {
    if (binding.namespace !== namespace) {
      throw new Error(
        `ApplicationHost Hatchet Scheduler ${binding.providerId} is in ${binding.namespace}, but the host runs in ${namespace}. Keep the provider token with its execution boundary or configure an explicit host-local credential projection.`,
      );
    }
  }
  const hatchetScheduleEnvironment = hatchetScheduleBindings.flatMap((binding) => [
    { name: binding.hostPortEnvironment, value: binding.hostPort },
    { name: binding.apiUrlEnvironment, value: binding.apiUrl },
    { name: binding.tlsEnvironment, value: binding.tlsStrategy },
  ]);
  const applicationHostVolumeMounts = [
    ...(workflowScheduleAccess
      ? [{
          name: 'workflow-gateway-token',
          mountPath: '/var/run/secrets/applik8s/workflow-gateway',
          readOnly: true,
        }]
      : []),
    ...hatchetScheduleBindings.map((binding) => ({
      name: binding.tokenMountName,
      mountPath: binding.tokenMountPath,
      readOnly: true,
    })),
  ];
  const applicationHostVolumes = [
    ...(workflowScheduleAccess
      ? [{
          name: 'workflow-gateway-token',
          projected: {
            defaultMode: 0o400,
            sources: [{
              serviceAccountToken: {
                path: 'token',
                expirationSeconds: 3_600,
                audience: 'https://kubernetes.default.svc',
              },
            }],
          },
        }]
      : []),
    ...hatchetScheduleBindings.map((binding) => ({
      name: binding.tokenMountName,
      secret: {
        secretName: binding.workerTokenSecret,
        items: [{ key: binding.tokenKey, path: 'token' }],
      },
    })),
  ];
  const callableProviderEnvironment = applicationCallableProviderEnvironment(
    applicationHostCallableProviders(options.graph),
    { target: 'kubernetes', namespace },
  );
  const artifactRoot = resolve(applicationArtifactRoot(manifestPath), manifest.output);
  const contextRoot = resolve(options.outDir, 'context');
  await rm(contextRoot, { recursive: true, force: true });
  await mkdir(contextRoot, { recursive: true });
  await Promise.all(manifest.artifacts.map(async (artifact) => {
    const source = resolve(artifactRoot, artifact.path);
    const content = await readFile(source);
    const actual = createArtifactDigest(content);
    if (actual !== artifact.digest) throw new Error(`ApplicationHost artifact ${artifact.path} digest does not match its Vite manifest.`);
    const target = resolve(contextRoot, artifact.path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
  }));
  await writeFile(resolve(options.outDir, 'Dockerfile.applik8s-host'), [
    'FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2',
    'WORKDIR /app',
    'COPY --chown=node:node context/ /app/',
    'USER node',
    `EXPOSE ${port}`,
    `CMD ["node", ${JSON.stringify(`/app/${manifest.entrypoint}`)}]`,
    '',
  ].join('\n'));
  await writeFile(resolve(options.outDir, 'application-host.json'), `${JSON.stringify({
    apiVersion: 'applik8s.applicationHost/v1alpha1',
    kind: 'ApplicationHostArtifact',
    metadata: { name },
    spec: {
      application: options.graph.metadata.name,
      namespace,
      image,
      imagePullPolicy,
      artifactDigest: manifest.digest,
      dockerfile: 'Dockerfile.applik8s-host',
      context: '.',
      cursorSecret: { name: cursorSecretName, key: cursorSecretKey },
    },
  }, null, 2)}\n`);
  const clusterScopedRbac = requiresClusterScopedHostRbac(options.graph);
  if (clusterScopedRbac && namespace.startsWith('${')) {
    throw new Error('An installation-scoped ApplicationHost cannot own fixed-name cluster RBAC. Move cluster-scoped Kubernetes access into a separately owned shared gateway.');
  }
  const roleKind = clusterScopedRbac ? 'ClusterRole' : 'Role';
  const bindingKind = clusterScopedRbac ? 'ClusterRoleBinding' : 'RoleBinding';
  const emitted: GeneratedApplicationHostResource[] = [
    {
      apiVersion: 'v1',
      kind: 'ServiceAccount',
      metadata: { name: serviceAccountName, namespace, labels },
    },
    {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: roleKind,
      metadata: { name: serviceAccountName, ...(clusterScopedRbac ? {} : { namespace }), labels },
      rules: applicationHostRules(options.graph),
    },
    {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: bindingKind,
      metadata: { name: serviceAccountName, ...(clusterScopedRbac ? {} : { namespace }), labels },
      roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: roleKind, name: serviceAccountName },
      subjects: [{ kind: 'ServiceAccount', name: serviceAccountName, namespace }],
    },
    {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name, namespace, labels, annotations: { 'applik8s.dev/web-artifact-digest': manifest.digest } },
      spec: {
        replicas,
        selector: { matchLabels: labels },
        strategy: { type: 'RollingUpdate', rollingUpdate: { maxUnavailable: 1, maxSurge: 0 } },
        template: {
          metadata: { labels, annotations: { 'applik8s.dev/web-artifact-digest': manifest.digest } },
          spec: {
            serviceAccountName,
            terminationGracePeriodSeconds: 30,
            containers: [{
              name: 'application',
              image,
              imagePullPolicy,
              command: ['node', `/app/${manifest.entrypoint}`],
              env: uniqueApplicationHostEnvironment([
                { name: 'PORT', value: String(port) },
                { name: 'APPLIK8S_APPLICATION_NAME', value: options.graph.metadata.name },
				{ name: 'APPLIK8S_DEPLOYMENT_TARGET', value: 'kubernetes' },
                { name: 'APPLIK8S_NAMESPACE', value: namespace },
                { name: 'APPLIK8S_WEB_ARTIFACT_DIGEST', value: manifest.digest },
                { name: 'APPLIK8S_CURSOR_SECRET', valueFrom: { secretKeyRef: { name: cursorSecretName, key: cursorSecretKey } } },
                ...internalOperationEnvironment,
                ...scheduleDatabaseEnvironment,
                ...applicationWorkflowScheduleEnvironment(options.graph),
                ...hatchetScheduleEnvironment,
                ...identityDatabaseEnvironment,
                ...objectStorageEnvironment,
                ...callableProviderEnvironment,
              ]),
              ...(applicationHostVolumeMounts.length > 0
                ? { volumeMounts: applicationHostVolumeMounts }
                : {}),
              ports: [{ name: 'http', containerPort: port }],
              startupProbe: { httpGet: { path: '/__applik8s/v1/healthz', port: 'http' }, periodSeconds: 2, failureThreshold: 30 },
              readinessProbe: { httpGet: { path: '/__applik8s/v1/readyz', port: 'http' }, periodSeconds: 5, failureThreshold: 6 },
              livenessProbe: { httpGet: { path: '/__applik8s/v1/healthz', port: 'http' }, periodSeconds: 10, failureThreshold: 6 },
              resources: resourceRequirements,
            }],
            ...(applicationHostVolumes.length > 0
              ? { volumes: applicationHostVolumes }
              : {}),
          },
        },
      },
    },
    {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        name,
        namespace,
        labels,
      },
      spec: {
        selector: labels,
        ports: [{ name: 'http', port, targetPort: 'http' }],
      },
    },
    {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'NetworkPolicy',
      metadata: { name, namespace, labels },
      spec: { podSelector: { matchLabels: labels }, policyTypes: ['Ingress'], ingress: [{ ports: [{ protocol: 'TCP', port }] }] },
    },
  ];
  if (typeof replicas === 'number' && replicas > 1) {
    emitted.push({
      apiVersion: 'policy/v1',
      kind: 'PodDisruptionBudget',
      metadata: { name, namespace, labels },
      spec: { minAvailable: 1, selector: { matchLabels: labels } },
    });
  }
  emitted.push(...applicationKubernetesFixedScheduleResources({
    graph: options.graph,
    namespace,
    hostName: name,
    image,
    imagePullPolicy,
    internalOperationSecretName: `${kubernetesName(options.graph.metadata.name)}-internal-operation`,
    port,
  }));
  return emitted;
}

function applicationHostCallableProviders(
  graph: ApplicationGraph,
): readonly ApplicationProviderNode[] {
  const consumers = new Set(
    graph.nodes.flatMap((node) => {
      if (node.kind === 'actor') return [node.id];
      if (node.kind !== 'schedule') return [];
      const scheduler = graph.nodes.find(
        (candidate) => candidate.id === node.scheduler.nodeId,
      );
      return scheduler?.kind === 'provider' ? [node.id] : [];
    }),
  );
  const providerIds = new Set(
    graph.edges.flatMap((edge) =>
      edge.relationship === 'provides' && consumers.has(edge.to.nodeId)
        ? [edge.from.nodeId]
        : []),
  );
  return graph.nodes.filter(
    (node): node is ApplicationProviderNode =>
      node.kind === 'provider'
      && providerIds.has(node.id)
      && node.config?.callableRuntime !== undefined,
  );
}

function uniqueApplicationHostEnvironment(
  entries: readonly Readonly<Record<string, unknown>>[],
): readonly Readonly<Record<string, unknown>>[] {
  const result = new Map<string, Readonly<Record<string, unknown>>>();
  for (const entry of entries) {
    const name = stringValue(entry.name);
    if (!name) {
      throw new Error('ApplicationHost environment entry has no name.');
    }
    const previous = result.get(name);
    if (previous && JSON.stringify(previous) !== JSON.stringify(entry)) {
      throw new Error(
        `ApplicationHost declares conflicting environment ${name}.`,
      );
    }
    result.set(name, entry);
  }
  return [...result.values()];
}

export function applicationKubernetesFixedScheduleResources(options: {
  readonly graph: ApplicationGraph;
  readonly namespace: string;
  readonly hostName: string;
  readonly image: string;
  readonly imagePullPolicy: string;
  readonly internalOperationSecretName: string;
  readonly port: number;
}): readonly GeneratedApplicationHostResource[] {
  const schedules = options.graph.nodes.filter((node): node is Extract<ApplicationGraph['nodes'][number], { kind: 'schedule' }> => {
    if (node.kind !== 'schedule' || node.definition.configuration !== 'fixed') return false;
    const provider = options.graph.nodes.find((candidate) => candidate.id === node.scheduler.nodeId);
    return provider?.kind === 'provider'
      && !provider.config?.qualification
      && (provider.implementation === 'target-selected' || provider.implementation === 'kubernetes-cronjob-scheduler');
  });
  return schedules.map((node) => {
    const name = kubernetesName(`schedule-${node.definition.id}-${createHash('sha256').update(node.definition.id).digest('hex').slice(0, 10)}`);
    const labels = {
      'app.kubernetes.io/name': options.graph.metadata.name,
      'app.kubernetes.io/component': 'schedule',
      'applik8s.dev/schedule-definition': kubernetesLabel(node.definition.id),
    };
    const admission = {
      schemaVersion: 'applik8s.scheduleAdmission/v1alpha1',
      applicationId: options.graph.metadata.name,
      environmentId: options.namespace,
      definitionId: node.definition.id,
      instanceId: 'fixed',
      ...(node.definition.at ? { deleteAfterCompletion: true, providerResourceName: name } : {}),
    };
    const source = "const base=JSON.parse(process.env.APPLIK8S_SCHEDULE_ADMISSION);const now=new Date().toISOString();const response=await fetch(process.env.APPLIK8S_SCHEDULE_ENDPOINT,{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+process.env.APPLIK8S_INTERNAL_OPERATION_SECRET},body:JSON.stringify({...base,scheduledAt:now,admittedAt:now,attempt:1,schedulerExecutionId:process.env.APPLIK8S_JOB_NAME})});if(!response.ok){console.error(await response.text());process.exit(1)};console.log(await response.text());";
    return {
      apiVersion: 'batch/v1',
      kind: 'CronJob',
      metadata: { name, namespace: options.namespace, labels, annotations: { 'applik8s.dev/schedule-definition': node.definition.id } },
      spec: {
        schedule: kubernetesScheduleCron(node.definition),
        timeZone: node.definition.cron ? node.definition.timezone : 'UTC',
        concurrencyPolicy: node.definition.overlap === 'skip' ? 'Forbid' : 'Allow',
        startingDeadlineSeconds: Math.min(node.definition.retry.maximumAgeSeconds, 2_147_483_647),
        successfulJobsHistoryLimit: 1,
        failedJobsHistoryLimit: 3,
        jobTemplate: {
          metadata: { labels },
          spec: {
            backoffLimit: Math.max(0, node.definition.retry.maxAttempts - 1),
            ttlSecondsAfterFinished: 3_600,
            template: {
              metadata: { labels },
              spec: {
                restartPolicy: 'Never',
                containers: [{
                  name: 'schedule-admission',
                  image: options.image,
                  imagePullPolicy: options.imagePullPolicy,
                  command: ['node', '--input-type=module', '--eval', source],
                  env: [
                    { name: 'APPLIK8S_SCHEDULE_ENDPOINT', value: `http://${options.hostName}.${options.namespace}.svc:${options.port}/__applik8s/v1/internal/schedules/occurrences` },
                    { name: 'APPLIK8S_SCHEDULE_ADMISSION', value: JSON.stringify(admission) },
                    { name: 'APPLIK8S_JOB_NAME', valueFrom: { fieldRef: { fieldPath: "metadata.labels['batch.kubernetes.io/job-name']" } } },
                    { name: 'APPLIK8S_INTERNAL_OPERATION_SECRET', valueFrom: { secretKeyRef: { name: options.internalOperationSecretName, key: 'key' } } },
                  ],
                  resources: { requests: { cpu: '10m', memory: '32Mi' }, limits: { memory: '64Mi' } },
                  securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, runAsNonRoot: true, capabilities: { drop: ['ALL'] } },
                }],
              },
            },
          },
        },
      },
    };
  });
}

function kubernetesScheduleCron(definition: Extract<ApplicationGraph['nodes'][number], { kind: 'schedule' }>['definition']): string {
  if (definition.cron) return definition.cron;
  if (definition.every) {
    return exactFiveFieldCronForInterval(definition.every);
  }
  if (!definition.at) throw new Error(`Kubernetes schedule ${definition.id} has no cadence.`);
  const at = new Date(definition.at);
  if (!Number.isFinite(at.getTime())) throw new Error(`Kubernetes schedule ${definition.id} has invalid timestamp ${definition.at}.`);
  return `${at.getUTCMinutes()} ${at.getUTCHours()} ${at.getUTCDate()} ${at.getUTCMonth() + 1} *`;
}

function kubernetesLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/gu, '-').replace(/^[^a-z0-9]+|[^a-z0-9]+$/gu, '').slice(0, 63) || 'schedule';
}

function applicationHostIdentityDatabaseEnvironment(
  graph: ApplicationGraph,
  hostNamespace: string,
): readonly Readonly<Record<string, unknown>>[] {
  const providerIds = new Set<string>();
  for (const node of graph.nodes) {
    if (node.kind !== 'provider' || node.interface !== 'IdentityProvider') {
      continue;
    }
    const runtime = objectValue(node.config?.identityRuntime);
    const database = objectValue(runtime.databaseProvider);
    const nodeId = stringValue(database.nodeId);
    if (nodeId) providerIds.add(nodeId);
  }
  if (providerIds.size === 0) return [];
  if (providerIds.size !== 1) {
    throw new Error(
      `ApplicationHost identity admission resolves ${providerIds.size} TransactionalDatabase dependencies; exactly one is required.`,
    );
  }
  const providerId = [...providerIds][0]!;
  const consumerIds = new Set(
    graph.providerRequirements
      .filter(
        (requirement) =>
          requirement.interface === 'TransactionalDatabase'
          && requirement.provider?.nodeId === providerId,
      )
      .map((requirement) => requirement.consumer.nodeId),
  );
  const runtimes = new Map<
    string,
    {
      readonly connectionEnvName: string;
      readonly secretName: string;
      readonly secretNamespace?: string;
      readonly secretKey: string;
    }
  >();
  for (const node of graph.nodes) {
    if (node.kind !== 'model' || !consumerIds.has(node.id) || !node.runtime) {
      continue;
    }
    const runtime = node.runtime;
    const current = {
      connectionEnvName: runtime.connectionEnvName,
      secretName: runtime.secretName,
      ...(runtime.secretNamespace
        ? { secretNamespace: runtime.secretNamespace }
        : {}),
      secretKey: runtime.secretKey,
    };
    const previous = runtimes.get(current.connectionEnvName);
    if (previous && JSON.stringify(previous) !== JSON.stringify(current)) {
      throw new Error(
        `ApplicationHost identity admission resolves incompatible database bindings for ${current.connectionEnvName}.`,
      );
    }
    runtimes.set(current.connectionEnvName, current);
  }
  if (runtimes.size === 0) {
    throw new Error(
      `ApplicationHost identity admission depends on ${providerId}, but no bound model exposes its runtime connection.`,
    );
  }
  return [...runtimes.values()]
    .sort((left, right) =>
      left.connectionEnvName.localeCompare(right.connectionEnvName))
    .map((runtime) => {
      const secretNamespace = runtime.secretNamespace ?? hostNamespace;
      if (secretNamespace !== hostNamespace) {
        throw new Error(
          `ApplicationHost identity admission Secret ${runtime.secretName} is in ${secretNamespace}, but the host runs in ${hostNamespace}.`,
        );
      }
      return {
        name: runtime.connectionEnvName,
        valueFrom: {
          secretKeyRef: {
            name: runtime.secretName,
            key: runtime.secretKey,
            optional: false,
          },
        },
      };
    });
}

function applicationHostInternalOperationEnvironment(
  graph: ApplicationGraph,
  hostNamespace: string,
): readonly Readonly<Record<string, unknown>>[] {
  const needsInternalOperations = graph.nodes.some(
    (node) => node.kind === 'aiAgent'
      || node.kind === 'mcpServer'
      || node.kind === 'schedule'
      || node.kind === 'actor'
      || node.kind === 'lakehousePublication',
  );
  if (!needsInternalOperations) return [];
  const applicationNamespace = applicationGraphStringValue(graph.metadata.namespace) ?? 'default';
  if (applicationNamespace !== hostNamespace) {
    throw new Error(
      `ApplicationHost internal operations use namespace ${applicationNamespace}, but the host is deployed to ${hostNamespace}. Keep the host with its application or move internal operations behind an explicit gateway.`,
    );
  }
  return [{
    name: 'APPLIK8S_INTERNAL_OPERATION_SECRET',
    valueFrom: {
      secretKeyRef: {
        name: `${graph.metadata.name}-internal-operation`,
        key: 'key',
      },
    },
  }];
}

export function applicationWorkflowScheduleEnvironment(
  graph: ApplicationGraph,
): readonly Readonly<Record<string, unknown>>[] {
  return graph.nodes.some(
    (node) => node.kind === 'schedule' && node.target?.kind === 'durableStart',
  )
    ? [{
        name: 'APPLIK8S_WORKFLOW_GATEWAY_TOKEN_FILE',
        value: '/var/run/secrets/applik8s/workflow-gateway/token',
      }]
    : [];
}

export function applicationScheduleDatabaseEnvironment(
  graph: ApplicationGraph,
  hostNamespace: string,
): readonly Readonly<Record<string, unknown>>[] {
  const schedules = graph.nodes.filter((node): node is Extract<ApplicationGraph['nodes'][number], { readonly kind: 'schedule' }> => node.kind === 'schedule');
  if (schedules.length === 0) return [];
  const providerIds = new Set(schedules.map((schedule) => schedule.state.nodeId));
  if (providerIds.size !== 1) {
    throw new Error(`ApplicationHost schedules resolve ${providerIds.size} TransactionalDatabase state authorities; exactly one is required.`);
  }
  const providerId = [...providerIds][0]!;
  const stateProvider = graph.nodes.find((node) => node.id === providerId);
  if (stateProvider?.kind !== 'provider' || stateProvider.interface !== 'TransactionalDatabase') {
    throw new Error(`ApplicationHost schedule state authority ${providerId} is not a TransactionalDatabase provider.`);
  }
  const aliasOf = applicationGraphStringValue(stateProvider.config?.aliasOf);
  const authorityIds = new Set([providerId, ...(aliasOf ? [aliasOf] : [])]);
  const runtimes = new Map<string, { readonly secretName: string; readonly secretNamespace?: string; readonly secretKey: string }>();
  for (const node of graph.nodes) {
    if (node.kind !== 'model' || !node.database || !authorityIds.has(node.database.nodeId) || !node.runtime) continue;
    const runtime = {
      secretName: node.runtime.secretName,
      ...(node.runtime.secretNamespace ? { secretNamespace: node.runtime.secretNamespace } : {}),
      secretKey: node.runtime.secretKey,
    };
    runtimes.set(JSON.stringify(runtime), runtime);
  }
  if (runtimes.size === 0) {
    const aliasedProvider = aliasOf
      ? graph.nodes.find((node) => node.id === aliasOf)
      : undefined;
    const provider = aliasedProvider?.kind === 'provider'
      && aliasedProvider.interface === 'TransactionalDatabase'
      ? aliasedProvider
      : stateProvider;
    const config = objectValue(provider.config?.transactionalDatabase);
    const connectionSecret = objectValue(config.connectionSecret);
    const cluster = objectValue(config.cluster);
    const secretName = applicationGraphStringValue(connectionSecret.name)
      ?? `${applicationGraphStringValue(config.clusterName)
        ?? applicationGraphStringValue(cluster.name)
        ?? applicationGraphStringValue(config.name)
        ?? `${graph.metadata.name}-db`}-app`;
    const secretKey = applicationGraphStringValue(config.connectionSecretKey) ?? 'uri';
    const secretNamespace = applicationGraphStringValue(connectionSecret.namespace)
      ?? applicationGraphStringValue(config.namespace);
    if (provider.implementation === 'target-selected' && Object.keys(config).length === 0) {
      throw new Error(`ApplicationHost Kubernetes Scheduler requires a concrete PostgreSQL TransactionalDatabase binding for ${providerId}; target-selected state has no Kubernetes credential source.`);
    }
    runtimes.set(JSON.stringify({ secretName, secretNamespace, secretKey }), {
      secretName,
      ...(secretNamespace ? { secretNamespace } : {}),
      secretKey,
    });
  }
  if (runtimes.size !== 1) {
    throw new Error(`ApplicationHost Kubernetes Scheduler requires exactly one PostgreSQL credential for state authority ${providerId}; found ${runtimes.size}.`);
  }
  const runtime = [...runtimes.values()][0]!;
  const secretNamespace = runtime.secretNamespace ?? hostNamespace;
  if (secretNamespace !== hostNamespace) {
    throw new Error(`ApplicationHost Kubernetes Scheduler Secret ${runtime.secretName} is in ${secretNamespace}, but the host runs in ${hostNamespace}.`);
  }
  return [{
    name: 'APPLIK8S_SCHEDULE_DATABASE_URL',
    valueFrom: { secretKeyRef: { name: runtime.secretName, key: runtime.secretKey, optional: false } },
  }];
}

/**
 * Browser runtime operations can issue evidence (for example an object-upload
 * completion receipt) that a generated command gateway verifies. When every
 * gateway in the host namespace deliberately shares one signing Secret, make
 * that application authority the host default as well. Explicit host config
 * still wins, and ambiguous gateway authorities are never guessed.
 */
function applicationSharedGatewayCursorSecret(graph: ApplicationGraph, namespace: string): { readonly name: string; readonly key: string } | undefined {
  const candidates = new Map<string, { readonly name: string; readonly key: string }>();
  for (const node of graph.nodes) {
    if (
      node.kind !== 'gateway'
      || (node.materialization !== 'generatedDeployment'
        && node.materialization !== 'runtimeOnly')
      || !node.deployment
      || !node.cursorSecret
    ) continue;
    // Internal placement/tool receivers are separate workload authorities,
    // not browser context authorities. Counting them makes a host with one
    // public gateway appear ambiguous and gives agent invocations a different
    // durable principal scope from browser queries.
    if (node.visibility === 'internal') continue;
    const gatewayNamespace = applicationGraphStringValue(node.cursorSecret.namespace ?? node.deployment.namespace);
    const name = applicationGraphStringValue(node.cursorSecret.name);
    const key = applicationGraphStringValue(node.cursorSecret.key);
    if (gatewayNamespace !== namespace || !name || !key) continue;
    candidates.set(`${name}\0${key}`, { name, key });
  }
  return candidates.size === 1 ? [...candidates.values()][0] : undefined;
}

function applicationArtifactRoot(manifestPath: string): string {
  const manifestDirectory = dirname(manifestPath);
  return manifestDirectory.endsWith(`${join('.applik8s', 'web-artifacts')}`)
    ? dirname(dirname(manifestDirectory))
    : dirname(manifestDirectory);
}

function applicationHostRules(graph: ApplicationGraph): readonly Readonly<Record<string, unknown>>[] {
  const groups = new Map<string, Map<string, Set<string>>>();
  const remoteQueries = generatedGatewayQueryIds(graph);
  for (const node of graph.nodes) {
    if (node.kind === 'crd' && node.create) addRule(node.resource.apiVersion, node.resource.plural, ['create', 'get']);
    if (node.kind === 'query' && node.kubernetes && !remoteQueries.has(node.id)) addRule(node.kubernetes.resource.apiVersion, node.kubernetes.resource.plural, ['get', 'list', 'watch']);
    if (node.kind === 'schedule') {
      const provider = graph.nodes.find((candidate) => candidate.id === node.scheduler.nodeId);
      if (provider?.kind === 'provider' && (provider.implementation === 'target-selected' || provider.implementation === 'kubernetes-cronjob-scheduler')) {
        addRule('batch/v1', 'cronjobs', ['create', 'delete', 'get', 'update']);
      }
    }
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([group, resources]) => [...resources.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([resource, verbs]) => ({
        apiGroups: [group],
        resources: [resource],
        verbs: [...verbs].sort(),
      })));

  function addRule(apiVersion: string, resource: string, verbs: readonly string[]): void {
    const group = apiVersion.split('/')[0] ?? '';
    const resources = groups.get(group) ?? new Map<string, Set<string>>();
    const resourceVerbs = resources.get(resource) ?? new Set<string>();
    for (const verb of verbs) resourceVerbs.add(verb);
    resources.set(resource, resourceVerbs);
    groups.set(group, resources);
  }
}

function requiresClusterScopedHostRbac(graph: ApplicationGraph): boolean {
  const remoteQueries = generatedGatewayQueryIds(graph);
  return graph.nodes.some((node) =>
    (node.kind === 'crd' && Boolean(node.create) && node.resource.scope === 'Cluster')
    || (node.kind === 'query' && !remoteQueries.has(node.id) && node.kubernetes?.resource.scope === 'Cluster'));
}

function assertApplicationHostKubernetesNamespaces(graph: ApplicationGraph, hostNamespace: string): void {
  const remoteQueries = generatedGatewayQueryIds(graph);
  for (const node of graph.nodes) {
    if (node.kind !== 'query' || !node.kubernetes || remoteQueries.has(node.id) || node.kubernetes.resource.scope !== 'Namespaced') continue;
    const namespace = node.kubernetes.namespace;
    if (namespace && namespace !== hostNamespace) {
      throw new Error(`ApplicationHost query ${node.id} reads namespace ${namespace}, but the host is bounded to ${hostNamespace}. Use a generated gateway for explicit cross-namespace access.`);
    }
  }
}

function generatedGatewayQueryIds(graph: ApplicationGraph): ReadonlySet<string> {
  return new Set(graph.nodes.flatMap((node) => node.kind === 'gateway' && node.materialization === 'generatedDeployment'
    ? node.queries.map((query) => query.nodeId)
    : []));
}

function createArtifactDigest(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

async function findStartArtifactManifest(start: string): Promise<string | undefined> {
  let directory = start;
  while (true) {
    for (const candidate of [
      join(directory, '.applik8s', 'web-artifacts', 'server.json'),
      join(directory, '.applik8s', 'web-artifact.json'),
    ]) {
      if (await access(candidate).then(() => true).catch(() => false)) return candidate;
    }
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function validateWebArtifactManifest(value: unknown): ApplicationWebArtifactManifest {
  if (!value || typeof value !== 'object') throw new Error('Applik8s web artifact manifest must be an object.');
  if (Reflect.get(value, 'apiVersion') !== 'applik8s.webArtifact/v1alpha1') throw new Error('Applik8s web artifact manifest has an unsupported apiVersion.');
  const digest = Reflect.get(value, 'digest');
  if (typeof digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error('Applik8s web artifact manifest has an invalid digest.');
  const target = Reflect.get(value, 'target');
  if (target !== 'browser' && target !== 'server') throw new Error('Applik8s web artifact manifest has an invalid target.');
  // typecast: the preceding structural and discriminant checks establish the manifest contract consumed below.
  return value as ApplicationWebArtifactManifest;
}

function objectValue(value: unknown): JsonObject {
  // typecast: the object/array guard narrows provider configuration to the JSON-object surface used by graph lowering.
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function kubernetesName(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 63).replace(/-+$/gu, '');
  if (!normalized) throw new Error(`Kubernetes resource name ${JSON.stringify(value)} is invalid.`);
  return normalized;
}
