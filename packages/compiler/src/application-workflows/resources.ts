// typecast-file-boundary: Workflow resource lowering maps validated contracts and installation expressions into Kubernetes manifest shapes.
import { createHash } from 'node:crypto';
import { applicationGraphAllConditions, applicationGraphBooleanCondition, applicationGraphJsonStringArray, applicationGraphStringValue } from '../application-installation-values.js';
import { structuredGenerationSelectedScalar, structuredGenerationSelection, type WorkflowContract, type WorkflowTaskProjectionContract } from './contracts.js';
import { uniqueWorkflowObjectEffects, uniqueWorkflowProjectionEffects } from './source.js';
import type { GeneratedApplicationWorkflowResource } from './types.js';
import { kubernetesName, objectConfig, stringConfig, workflowObjectEnabledEnvironment } from './utilities.js';

const workflowTokenMountPath = '/var/run/secrets/applik8s/workflow-token';
const workflowTokenFile = `${workflowTokenMountPath}/token`;

function workflowCapabilityEnvironment(contract: WorkflowContract): readonly Record<string, unknown>[] {
  return contract.capabilities.flatMap((provider) => {
    if (provider.interface !== 'StructuredGeneration') return [];
    const config = provider.config ?? {};
    const selection = structuredGenerationSelection(config);
    if (selection) {
      const candidates = [...Object.values(selection.cases), selection.default];
      const httpCandidates = candidates.filter((candidate) => stringConfig(candidate.kind) === 'structured-generation-http');
      const credentials = httpCandidates.map((candidate) => objectConfig(candidate.credentialSecret)).filter((secret) => stringConfig(secret.name));
      return [
        { name: 'APPLIK8S_STRUCTURED_GENERATION_SELECTION', value: `\${${selection.selector}}` },
        { name: 'APPLIK8S_STRUCTURED_GENERATION_ENDPOINT', value: structuredGenerationSelectedScalar(selection, (candidate) => candidate.endpoint, '') },
        { name: 'APPLIK8S_STRUCTURED_GENERATION_AUTHORIZATION', value: structuredGenerationSelectedScalar(selection, (candidate) => candidate.authorization, 'bearer') },
        { name: 'APPLIK8S_STRUCTURED_GENERATION_DEFAULT_PROFILE', value: structuredGenerationSelectedScalar(selection, (candidate) => candidate.defaultProfile, '') },
        ...(credentials.length > 0 ? [{
          name: 'APPLIK8S_STRUCTURED_GENERATION_API_KEY',
          valueFrom: { secretKeyRef: {
            name: structuredGenerationSelectedScalar(selection, (candidate) => objectConfig(candidate.credentialSecret).name, 'applik8s-structured-generation-unused'),
            key: structuredGenerationSelectedScalar(selection, (candidate) => objectConfig(candidate.credentialSecret).credentialKey ?? candidate.credentialKey, 'apiKey'),
            // A non-HTTP branch has no Secret by design. The generated worker
            // still fails closed at startup whenever the selected HTTP branch
            // declares credentials and Kubernetes did not resolve them.
            optional: true,
          } },
        }] : []),
      ];
    }
    if (provider.implementation !== 'structured-generation-http') return [];
    const secret = objectConfig(config.credentialSecret);
    const secretName = stringConfig(secret.name);
    return [
      { name: 'APPLIK8S_STRUCTURED_GENERATION_ENDPOINT', value: applicationGraphStringValue(config.endpoint) },
      { name: 'APPLIK8S_STRUCTURED_GENERATION_AUTHORIZATION', value: applicationGraphStringValue(config.authorization) || 'bearer' },
      ...(config.defaultProfile !== undefined ? [{ name: 'APPLIK8S_STRUCTURED_GENERATION_DEFAULT_PROFILE', value: applicationGraphStringValue(config.defaultProfile) }] : []),
      ...(secretName ? [{ name: 'APPLIK8S_STRUCTURED_GENERATION_API_KEY', valueFrom: { secretKeyRef: { name: secretName, key: stringConfig(config.credentialKey) || 'apiKey', optional: false } } }] : []),
    ];
  });
}

export function workflowResources(contract: WorkflowContract, name: string, image: string, digest: string, _ownsProvider: boolean): GeneratedApplicationWorkflowResource[] {
  const labels = { 'app.kubernetes.io/name': name, 'app.kubernetes.io/component': 'workflow-worker', 'applik8s.dev/graph': contract.graphName };
  const gatewayEnabled = contract.gatewayCallers.length > 0;
  const gatewayPort = contract.worker.deployment.healthPort + 1;
  const workerServiceAccount = `${name}-runtime`;
  const gatewayRbacName = `applik8s-workflow-gateway-${createHash('sha256')
    .update(`${contract.graphName}\0${contract.namespace}\0${name}`)
    .digest('hex')
    .slice(0, 16)}`;
  const workflowConnectionEnvironment = [
    { name: 'HATCHET_CLIENT_HOST_PORT', value: stringConfig(contract.providerConfig.hostPort) || `hatchet-engine.${contract.namespace}.svc:7070` },
    { name: 'HATCHET_CLIENT_API_URL', value: stringConfig(contract.providerConfig.apiUrl) || `http://hatchet-api.${contract.namespace}.svc:8080` },
    { name: 'HATCHET_CLIENT_TLS_STRATEGY', value: workflowTlsStrategy(contract.providerConfig.tls) },
  ];
  const workloadResources: GeneratedApplicationWorkflowResource[] = [
    {
      apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name, namespace: contract.namespace, labels }, spec: {
        replicas: contract.worker.deployment.replicas,
        selector: { matchLabels: labels },
        strategy: { type: 'RollingUpdate', rollingUpdate: { maxUnavailable: 1, maxSurge: 0 } },
        template: { metadata: { labels, annotations: { 'applik8s.dev/digest': digest } }, spec: {
          ...(gatewayEnabled ? { serviceAccountName: workerServiceAccount } : {}),
          terminationGracePeriodSeconds: contract.worker.deployment.gracefulShutdownSeconds,
          initContainers: [{
            name: 'wait-for-workflow-credentials',
            image,
            imagePullPolicy: 'IfNotPresent',
            command: ['node', '/app/workflow-worker.mjs', '--credential-preflight'],
            env: [
              ...workflowConnectionEnvironment,
              { name: 'APPLIK8S_WORKFLOW_TOKEN_FILE', value: workflowTokenFile },
            ],
            volumeMounts: [{ name: 'workflow-token', mountPath: workflowTokenMountPath, readOnly: true }],
            resources: { requests: { cpu: '25m', memory: '64Mi' }, limits: { cpu: '250m', memory: '256Mi' } },
          }],
          containers: [{
            name: 'worker', image, imagePullPolicy: 'IfNotPresent', command: ['node', '/app/workflow-worker.mjs'],
            env: uniqueWorkflowEnvironment([
              { name: 'HATCHET_CLIENT_TOKEN', valueFrom: { secretKeyRef: { name: contract.workerTokenSecret, key: contract.tokenKey } } },
              ...(gatewayEnabled ? [{
                name: 'APPLIK8S_WORKFLOW_NAMESPACE',
                valueFrom: { fieldRef: { fieldPath: 'metadata.namespace' } },
              }] : []),
              ...workflowConnectionEnvironment,
              ...workflowCapabilityEnvironment(contract),
              ...workflowOperationEnvironment(contract),
              ...workflowQueryEnvironment(contract),
              ...workflowProjectionEnvironment(contract),
							...workflowObjectEnvironment(contract),
              ...workflowActorEnvironment(contract),
              ...workflowSignalEnvironment(contract),
            ]),
            ports: [
              { name: 'health', containerPort: contract.worker.deployment.healthPort },
              ...(gatewayEnabled ? [{ name: 'gateway', containerPort: gatewayPort }] : []),
            ],
            readinessProbe: { httpGet: { path: '/ready', port: 'health' }, periodSeconds: 5, failureThreshold: 6 },
            livenessProbe: { httpGet: { path: '/live', port: 'health' }, periodSeconds: 10, failureThreshold: 6 },
            resources: { requests: { cpu: '100m', memory: '128Mi' }, limits: { cpu: '1', memory: '512Mi' } },
          }],
          volumes: [{
            name: 'workflow-token',
            secret: {
              secretName: contract.workerTokenSecret,
              items: [{ key: contract.tokenKey, path: 'token' }],
            },
          }],
        } },
      },
    },
    { apiVersion: 'policy/v1', kind: 'PodDisruptionBudget', metadata: { name, namespace: contract.namespace, labels }, spec: { maxUnavailable: workflowWorkerMaxUnavailable(contract.worker.deployment.replicas), selector: { matchLabels: labels } } },
    workflowWorkerNetworkPolicy(contract, name, labels),
    ...(gatewayEnabled ? [
      {
        apiVersion: 'v1',
        kind: 'ServiceAccount',
        metadata: { name: workerServiceAccount, namespace: contract.namespace, labels },
        automountServiceAccountToken: true,
      },
      {
        apiVersion: 'rbac.authorization.k8s.io/v1',
        kind: 'ClusterRole',
        metadata: { name: gatewayRbacName, labels },
        rules: [{
          apiGroups: ['authentication.k8s.io'],
          resources: ['tokenreviews'],
          verbs: ['create'],
        }],
      },
      {
        apiVersion: 'rbac.authorization.k8s.io/v1',
        kind: 'ClusterRoleBinding',
        metadata: { name: gatewayRbacName, labels },
        roleRef: {
          apiGroup: 'rbac.authorization.k8s.io',
          kind: 'ClusterRole',
          name: gatewayRbacName,
        },
        subjects: [{
          kind: 'ServiceAccount',
          name: workerServiceAccount,
          namespace: contract.namespace,
        }],
      },
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name, namespace: contract.namespace, labels },
        spec: {
          selector: labels,
          ports: [{ name: 'gateway', port: gatewayPort, targetPort: 'gateway' }],
        },
      },
    ] : []),
  ];
  if (contract.worker.deployment.scaling.mode === 'kedaHatchetSlots') workloadResources.push(...workflowScalingResources(contract, name));
  return [
    ...conditionalWorkflowResources(workloadResources, applicationGraphBooleanCondition(contract.providerConfig.enabled)),
  ];
}

function workflowActorEnvironment(contract: WorkflowContract): readonly Record<string, unknown>[] {
  return [
    ...(contract.actorEffects
      ? [{
          name: 'APPLIK8S_ACTOR_APPLICATION_ENDPOINT',
          value: contract.actorEffects.applicationEndpoint,
        }]
      : []),
    {
      name: 'APPLIK8S_INTERNAL_OPERATION_SECRET',
      valueFrom: {
        secretKeyRef: {
          name: `${kubernetesName(contract.graphName)}-internal-operation`,
          key: 'key',
          optional: false,
        },
      },
    },
  ];
}

function workflowSignalEnvironment(
  contract: WorkflowContract,
): readonly Record<string, unknown>[] {
  const database = contract.signalEffects?.database;
  if (!database) return [];
  return [
    {
      name: 'APPLIK8S_SIGNAL_DATABASE_URL',
      valueFrom: {
        secretKeyRef: {
          name: database.secretName,
          key: database.secretKey,
        },
      },
    },
  ];
}

function workflowObjectEnvironment(contract: WorkflowContract): readonly Record<string, unknown>[] {
	const effects = uniqueWorkflowObjectEffects(contract);
	if (effects.length === 0) return [];
	const first = effects[0];
	if (!first) return [];
	const config = first.config;
	const bucket = applicationGraphStringValue(config.bucket);
	const region = applicationGraphStringValue(config.region);
	if (!bucket || !region) throw new Error(`Workflow worker ${contract.worker.id} task ObjectStorage requires bucket and region values.`);
	const credentials = objectConfig(config.credentialsSecret);
	const credentialsName = applicationGraphStringValue(credentials.name);
	const optionalCredentials = config.enabled !== true;
	const provisionedConnection = workflowObjectBucketConnection(config);
	return uniqueWorkflowEnvironment([
		{ name: 'APPLIK8S_TASK_OBJECT_BUCKET', value: bucket },
		{ name: 'APPLIK8S_TASK_OBJECT_REGION', value: region },
		{ name: 'APPLIK8S_TASK_OBJECT_FORCE_PATH_STYLE', value: workflowEnvironmentScalar(config.forcePathStyle, 'false') },
		...(provisionedConnection && !applicationGraphStringValue(config.endpoint)
			? objectBucketConnectionEnvironment('APPLIK8S_TASK_OBJECT', provisionedConnection)
			: []),
		...(applicationGraphStringValue(config.endpoint) ? [{ name: 'APPLIK8S_TASK_OBJECT_ENDPOINT', value: applicationGraphStringValue(config.endpoint) }] : []),
		...(applicationGraphStringValue(config.prefix) ? [{ name: 'APPLIK8S_TASK_OBJECT_PREFIX', value: applicationGraphStringValue(config.prefix) }] : []),
		...effects.map((effect) => ({
			name: workflowObjectEnabledEnvironment(effect.store.id),
			value: workflowEnvironmentScalar(applicationGraphAllConditions(effect.store.enabled, effect.config.enabled), 'true'),
		})),
		...(credentialsName ? [
			{ name: 'AWS_ACCESS_KEY_ID', valueFrom: { secretKeyRef: { name: credentialsName, key: stringConfig(config.accessKeyIdKey) || 'AWS_ACCESS_KEY_ID', ...(optionalCredentials ? { optional: true } : {}) } } },
			{ name: 'AWS_SECRET_ACCESS_KEY', valueFrom: { secretKeyRef: { name: credentialsName, key: stringConfig(config.secretAccessKeyKey) || 'AWS_SECRET_ACCESS_KEY', ...(optionalCredentials ? { optional: true } : {}) } } },
			...(stringConfig(config.sessionTokenKey) ? [{ name: 'AWS_SESSION_TOKEN', valueFrom: { secretKeyRef: { name: credentialsName, key: stringConfig(config.sessionTokenKey), optional: true } } }] : []),
		] : []),
	]);
}

function workflowOperationEnvironment(contract: WorkflowContract): readonly Record<string, unknown>[] {
  const effects = contract.operationEffects;
  if (!effects) return [];
  const config = effects.eventLog.config ?? {};
  const connectionSecret = objectConfig(config.connectionSecret);
  const connectionSecretName = stringConfig(connectionSecret.name);
  const authMode = stringConfig(config.authMode) || 'token';
  if (authMode !== 'token' && authMode !== 'userPassword') throw new Error(`Workflow worker ${contract.worker.id} EventLog authMode must be token or userPassword.`);
  const databases = new Map(effects.operations.map(({ model }) => [model.runtime.connectionEnvName, model.runtime]));
  const environment: Record<string, unknown>[] = [
    { name: 'APPLIK8S_TASK_OPERATION_CONTEXT_SECRET', valueFrom: { secretKeyRef: { name: effects.contextSecret.name, key: effects.contextSecret.key } } },
    { name: 'APPLIK8S_NATS_SERVERS', value: applicationGraphJsonStringArray(workflowEventLogServers(config)) },
    { name: 'APPLIK8S_NATS_STREAM', value: applicationGraphStringValue(config.stream) || 'APPLIK8S_EVENTS' },
    { name: 'APPLIK8S_NATS_SUBJECT_PREFIX', value: applicationGraphStringValue(config.subjectPrefix) || 'applik8s' },
    ...[...databases.values()].map((database) => ({ name: database.connectionEnvName, valueFrom: { secretKeyRef: { name: database.secretName, key: database.secretKey } } })),
  ];
  if (!connectionSecretName) return environment;
  if (authMode === 'userPassword') {
    environment.push(
      { name: 'APPLIK8S_NATS_USER', valueFrom: { secretKeyRef: { name: connectionSecretName, key: stringConfig(config.userKey) || 'user' } } },
      { name: 'APPLIK8S_NATS_PASSWORD', valueFrom: { secretKeyRef: { name: connectionSecretName, key: stringConfig(config.passwordKey) || 'password' } } },
    );
  } else {
    environment.push({ name: 'APPLIK8S_NATS_TOKEN', valueFrom: { secretKeyRef: { name: connectionSecretName, key: stringConfig(config.tokenKey) || 'token' } } });
  }
  return environment;
}

function workflowQueryEnvironment(contract: WorkflowContract): readonly Record<string, unknown>[] {
  const effects = contract.queryEffects;
  if (!effects) return [];
  return [{ name: 'APPLIK8S_TASK_QUERY_CONTEXT_SECRET', valueFrom: { secretKeyRef: { name: effects.cursorSecret.name, key: effects.cursorSecret.key } } }];
}

function workflowProjectionEnvironment(contract: WorkflowContract): readonly Record<string, unknown>[] {
  const effects = uniqueWorkflowProjectionEffects(contract);
  if (effects.length === 0) return [];
  const indexProviders = new Set(effects.map((effect) => effect.indexProvider.id));
  const objectProviders = new Set(effects.map((effect) => effect.objectProvider.id));
  if (indexProviders.size !== 1 || objectProviders.size !== 1) throw new Error(`Workflow worker ${contract.worker.id} projection rebuilds require one IndexStore and one ObjectStorage provider.`);
  const first = effects[0] as WorkflowTaskProjectionContract;
  const index = first.indexConfig;
  const authentication = objectConfig(index.authentication);
  const indexSecret = objectConfig(authentication.secret);
  const indexSecretName = applicationGraphStringValue(indexSecret.name);
  const authenticationMode = applicationGraphStringValue(authentication.mode);
  const dynamicAuthentication = applicationGraphBooleanCondition(authentication.mode);
  const object = first.objectConfig;
  const bucket = applicationGraphStringValue(object.bucket);
  const region = applicationGraphStringValue(object.region);
  if (!bucket || !region) throw new Error(`Workflow worker ${contract.worker.id} projection rebuild ObjectStorage requires bucket and region values.`);
  const credentials = objectConfig(object.credentialsSecret);
  const credentialsName = applicationGraphStringValue(credentials.name);
  const objectEnabled = workflowEnvironmentScalar(object.enabled, 'true');
  const optionalObjectCredentials = object.enabled !== true;
  const provisionedConnection = workflowObjectBucketConnection(object);
  return uniqueWorkflowEnvironment([
    ...effects.map((effect) => ({ name: effect.stream.database.connectionEnvName, valueFrom: { secretKeyRef: { name: effect.stream.database.secretName, key: effect.stream.database.secretKey } } })),
    { name: 'APPLIK8S_REBUILD_VALKEY_HOST', value: applicationGraphStringValue(index.host) || `${stringConfig(index.name) || 'valkey'}.${contract.namespace}.svc` },
    { name: 'APPLIK8S_REBUILD_VALKEY_PORT', value: workflowEnvironmentScalar(index.port, '6379') },
    ...((authenticationMode === 'password' || dynamicAuthentication) && indexSecretName ? [{ name: 'APPLIK8S_REBUILD_VALKEY_PASSWORD', valueFrom: { secretKeyRef: { name: indexSecretName, key: stringConfig(authentication.key) || 'password', ...(dynamicAuthentication ? { optional: true } : {}) } } }] : []),
    { name: 'APPLIK8S_REBUILD_OBJECT_ENABLED', value: objectEnabled },
    { name: 'APPLIK8S_REBUILD_OBJECT_BUCKET', value: bucket },
    { name: 'APPLIK8S_REBUILD_OBJECT_REGION', value: region },
    { name: 'APPLIK8S_REBUILD_OBJECT_FORCE_PATH_STYLE', value: workflowEnvironmentScalar(object.forcePathStyle, 'false') },
    ...(provisionedConnection && !applicationGraphStringValue(object.endpoint)
      ? objectBucketConnectionEnvironment('APPLIK8S_REBUILD_OBJECT', provisionedConnection)
      : []),
    ...(applicationGraphStringValue(object.endpoint) ? [{ name: 'APPLIK8S_REBUILD_OBJECT_ENDPOINT', value: applicationGraphStringValue(object.endpoint) }] : []),
    ...(applicationGraphStringValue(object.prefix) ? [{ name: 'APPLIK8S_REBUILD_OBJECT_PREFIX', value: applicationGraphStringValue(object.prefix) }] : []),
    ...(credentialsName ? [
      { name: 'AWS_ACCESS_KEY_ID', valueFrom: { secretKeyRef: { name: credentialsName, key: stringConfig(object.accessKeyIdKey) || 'AWS_ACCESS_KEY_ID', ...(optionalObjectCredentials ? { optional: true } : {}) } } },
      { name: 'AWS_SECRET_ACCESS_KEY', valueFrom: { secretKeyRef: { name: credentialsName, key: stringConfig(object.secretAccessKeyKey) || 'AWS_SECRET_ACCESS_KEY', ...(optionalObjectCredentials ? { optional: true } : {}) } } },
      ...(stringConfig(object.sessionTokenKey) ? [{ name: 'AWS_SESSION_TOKEN', valueFrom: { secretKeyRef: { name: credentialsName, key: stringConfig(object.sessionTokenKey), optional: true } } }] : []),
    ] : []),
  ]);
}

function workflowObjectBucketConnection(
  config: Readonly<Record<string, unknown>>,
): string | undefined {
  const provisioning = objectConfig(config.provisioning);
  const kind = applicationGraphStringValue(provisioning.kind);
  if (kind && kind !== 'object-bucket-claim') return undefined;
  return (
    applicationGraphStringValue(provisioning.claimName)
    || applicationGraphStringValue(config.name)
    || applicationGraphStringValue(objectConfig(config.credentialsSecret).name)
    || applicationGraphStringValue(config.bucket)
  );
}

function objectBucketConnectionEnvironment(
  prefix: string,
  configMapName: string,
): readonly Record<string, unknown>[] {
  return [
    {
      name: `${prefix}_HOST`,
      valueFrom: {
        configMapKeyRef: {
          name: configMapName,
          key: 'BUCKET_HOST',
        },
      },
    },
    {
      name: `${prefix}_PORT`,
      valueFrom: {
        configMapKeyRef: {
          name: configMapName,
          key: 'BUCKET_PORT',
        },
      },
    },
    {
      name: `${prefix}_ENDPOINT`,
      value: `http://$(${prefix}_HOST):$(${prefix}_PORT)`,
    },
  ];
}

function workflowEnvironmentScalar(value: unknown, fallback: string): string {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  const scalar = applicationGraphStringValue(value);
  if (!scalar) return fallback;
  const expression = /^\$\{([\s\S]+)\}$/.exec(scalar)?.[1];
  return expression ? `\${string(${expression})}` : scalar;
}

function uniqueWorkflowEnvironment(values: readonly Record<string, unknown>[]): readonly Record<string, unknown>[] {
  const result = new Map<string, Record<string, unknown>>();
  for (const value of values) {
    const name = stringConfig(value.name);
    const previous = result.get(name);
    if (previous && JSON.stringify(previous) !== JSON.stringify(value)) throw new Error(`Workflow worker has conflicting environment contracts for ${name}.`);
    result.set(name, value);
  }
  return [...result.values()];
}

function workflowEventLogServers(config: Readonly<Record<string, unknown>>): readonly string[] {
  const configured = Array.isArray(config.servers) ? config.servers.map(applicationGraphStringValue).filter((value): value is string => Boolean(value)) : [];
  if (configured.length > 0) return configured;
  const name = applicationGraphStringValue(config.name) || 'applik8s-events';
  const namespace = applicationGraphStringValue(config.namespace);
  return [`nats://${name}${namespace ? `.${namespace}` : ''}.svc:4222`];
}

function conditionalWorkflowResources(
  resources: readonly GeneratedApplicationWorkflowResource[],
  includeWhen: string | undefined,
): GeneratedApplicationWorkflowResource[] {
  if (includeWhen === undefined || includeWhen === 'true') return [...resources];
  return resources.map((resource) => ({
    ...resource,
    metadata: {
      ...resource.metadata,
      annotations: {
        ...(objectConfig(resource.metadata.annotations)),
        'applik8s.dev/include-when': includeWhen,
      },
    },
  }));
}

function workflowTlsStrategy(value: unknown): string {
  if (value === true) return 'tls';
  if (value === false || value === undefined) return 'none';
  const condition = applicationGraphBooleanCondition(value);
  if (!condition) throw new Error('WorkflowEngine tls must be a boolean or typed installation condition.');
  const expression = condition.startsWith('${') && condition.endsWith('}') ? condition.slice(2, -1) : condition;
  return `\${(${expression}) ? "tls" : "none"}`;
}

function workflowWorkerMaxUnavailable(replicas: number | string): number | string {
  if (typeof replicas === 'number') return replicas > 1 ? 1 : 0;
  const match = /^\$\{(.+)\}$/.exec(replicas);
  if (!match?.[1]) throw new Error(`Workflow worker replicas must be a finite number or serialized installation expression, received ${JSON.stringify(replicas)}.`);
  return `\${(${match[1]}) > 1 ? 1 : 0}`;
}

function workflowWorkerNetworkPolicy(contract: WorkflowContract, name: string, labels: Readonly<Record<string, string>>): GeneratedApplicationWorkflowResource {
  const sameNamespaceEgress = contract.worker.deployment.egress === 'sameNamespace';
  if (sameNamespaceEgress && contract.gatewayCallers.length > 0) {
    throw new Error(
      `Workflow worker ${contract.worker.id} uses the private workflow gateway and must allow Kubernetes API egress for TokenReview; deployment.egress sameNamespace cannot express that authority without an installation-specific API CIDR.`,
    );
  }
  const gatewayPort = contract.worker.deployment.healthPort + 1;
  const gatewayIngress = contract.gatewayCallers.map((caller) => ({
    from: [{
      namespaceSelector: {
        matchLabels: { 'kubernetes.io/metadata.name': caller.namespace },
      },
      podSelector: {
        matchLabels: { 'app.kubernetes.io/name': caller.operator },
      },
    }],
    ports: [{ protocol: 'TCP', port: gatewayPort }],
  }));
  return {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'NetworkPolicy',
    metadata: { name, namespace: contract.namespace, labels },
    spec: {
      podSelector: { matchLabels: labels },
      policyTypes: sameNamespaceEgress ? ['Ingress', 'Egress'] : ['Ingress'],
      ingress: [
        { ports: [{ protocol: 'TCP', port: contract.worker.deployment.healthPort }] },
        ...gatewayIngress,
      ],
      ...(sameNamespaceEgress ? {
        egress: [
          { to: [{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': contract.namespace } } }] },
          { to: [{ namespaceSelector: {}, podSelector: { matchLabels: { 'k8s-app': 'kube-dns' } } }], ports: [{ protocol: 'UDP', port: 53 }, { protocol: 'TCP', port: 53 }] },
        ],
      } : {}),
    },
  };
}

function workflowScalingResources(contract: WorkflowContract, name: string): GeneratedApplicationWorkflowResource[] {
  const scaling = contract.worker.deployment.scaling;
  if (scaling.mode !== 'kedaHatchetSlots') return [];
  const authName = `${name}-hatchet-metrics`;
  const tenantId = stringConfig(contract.providerConfig.tenantId);
  const apiUrl = stringConfig(contract.providerConfig.apiUrl) || `http://${contract.engineName}-api.${contract.namespace}.svc:8080`;
  const triggers = [...contract.tasks.map(({ task }) => task.name), ...contract.workflows.map(({ workflow }) => workflow.name)].map((contractName) => ({
    type: 'metrics-api',
    metadata: { targetValue: String(contract.worker.deployment.taskSlots), activationTargetValue: '1', url: `${apiUrl}/api/v1/tenants/${tenantId}/task-stats`, valueLocation: `${contractName}.queued.total`, authMode: 'bearer', timeout: '3000' },
    authenticationRef: { name: authName },
  }));
  return [
    { apiVersion: 'keda.sh/v1alpha1', kind: 'TriggerAuthentication', metadata: { name: authName, namespace: contract.namespace }, spec: { secretTargetRef: [{ parameter: 'token', name: contract.workerTokenSecret, key: contract.tokenKey }] } },
    { apiVersion: 'keda.sh/v1alpha1', kind: 'ScaledObject', metadata: { name, namespace: contract.namespace }, spec: { scaleTargetRef: { name }, pollingInterval: scaling.pollingIntervalSeconds, cooldownPeriod: 60, minReplicaCount: scaling.minReplicas, maxReplicaCount: scaling.maxReplicas, advanced: { horizontalPodAutoscalerConfig: { behavior: { scaleDown: { stabilizationWindowSeconds: 300 }, scaleUp: { stabilizationWindowSeconds: 0 } } } }, triggers } },
  ];
}

/**
 * Hatchet 1.24.3 starts heartbeats from a sibling worker-thread file resolved
 * through CommonJS __dirname. Generated workers are intentionally one
 * build-time-complete ESM artifact, so preserve the heartbeat protocol in the
 * main process instead of leaving a runtime filesystem/package dependency.
 */
