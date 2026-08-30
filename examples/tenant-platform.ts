import { createHash } from 'node:crypto';
import { type ApplicationModelBinding, type ApplicationV03PressureTestContract, app, applicationGraphFor, DnsPublication, type KubernetesApplicationBuilder, sdk, WorkflowEngine } from '@applik8s/applik8s';
import { dns, externalDnsPublicationMetadata, externalDnsPublicationName } from '@applik8s/applik8s/dns';
import { command, entity, event, type, workflow } from '@applik8s/applik8s/dsl';
import { createApplicationMutationOperation, type ApplicationMutationOperation } from '@applik8s/client';
import { type ApplicationDurableStatusOwnershipContract, type ApplicationProviderCompatibilityMatrixContract, type ApplicationProviderInterfaceContract, type ResourceDefinition, serializeApplicationGraph } from '@applik8s/core';
import * as k8s from '@kubernetes/client-node';
// Historical-character-fixture exception: v0.4 evidence intentionally uses
// the compiler's retained lowering seam without restoring it to the root API.
import { applicationModelCommandRegistrar } from '@applik8s/applik8s/internal/historical-model-commands';

export interface TenantPlatformExampleOptions {
  readonly apiGroup?: string;
  readonly namespace?: string;
  readonly stackName?: string;
  readonly stackKind?: string;
  readonly databaseName?: string;
  readonly databaseClusterName?: string;
  readonly adminServerName?: string;
  readonly durableBehavior?: boolean;
  readonly durableWorkflows?: boolean;
}

const defaultOptions: Required<TenantPlatformExampleOptions> = {
  apiGroup: process.env.APPLIK8S_TENANT_PLATFORM_API_GROUP ?? 'platform.applik8s.dev',
  namespace: process.env.APPLIK8S_TENANT_PLATFORM_NAMESPACE ?? 'platform',
  stackName: process.env.APPLIK8S_TENANT_PLATFORM_STACK_NAME ?? 'tenant-platform',
  stackKind: process.env.APPLIK8S_TENANT_PLATFORM_STACK_KIND ?? 'TenantPlatform',
  databaseName: process.env.APPLIK8S_TENANT_PLATFORM_DATABASE ?? 'tenant_platform',
  databaseClusterName: process.env.APPLIK8S_TENANT_PLATFORM_DATABASE_CLUSTER ?? 'tenant-platform-db',
  adminServerName: process.env.APPLIK8S_TENANT_PLATFORM_ADMIN_SERVER ?? 'tenant-admin',
  durableBehavior: false,
  durableWorkflows: false,
};

export const TenantEntity = entity('Tenant', {
  spec: type({
    plan: "'free' | 'team' | 'enterprise'",
    namespace: 'string',
    ownerEmail: 'string',
  }),
  status: type({
    phase: "('Pending' | 'Provisioning' | 'Ready' | 'Failed')?",
    observedGeneration: 'number?',
    url: 'string?',
    message: 'string?',
  }),
});

export type TenantSpec = typeof TenantEntity.spec.infer;
export type TenantStatus = NonNullable<typeof TenantEntity.status>['infer'];

export const TenantLifecycleEntity = entity('TenantLifecycle', {
  spec: type({
    phase: "'Ready' | 'Decommissioned' | 'NeedsIntervention'",
    endpoint: 'string?',
    lastRequestId: 'string',
    updatedAt: 'string',
  }),
});

export type TenantLifecycleSpec = typeof TenantLifecycleEntity.spec.infer;

export const EnvironmentEntity = entity('Environment', {
  spec: type({
    tenant: 'string',
    name: 'string',
    cluster: 'string',
    namespace: 'string',
  }),
  status: type({
    phase: "('Pending' | 'Ready' | 'Failed')?",
    message: 'string?',
  }),
});

export type EnvironmentSpec = typeof EnvironmentEntity.spec.infer;
export type EnvironmentStatus = NonNullable<typeof EnvironmentEntity.status>['infer'];

export const AppInstallationEntity = entity('AppInstallation', {
  spec: type({
    tenant: 'string',
    environment: 'string',
    image: 'string',
    replicas: 'number = 1',
  }),
  status: type({
    phase: "('Pending' | 'Applying' | 'Ready' | 'Failed')?",
    url: 'string?',
    message: 'string?',
  }),
});

export type AppInstallationSpec = typeof AppInstallationEntity.spec.infer;
export type AppInstallationStatus = NonNullable<typeof AppInstallationEntity.status>['infer'];

export const MaintenanceWindowEntity = entity('MaintenanceWindow', {
  spec: type({
    tenant: 'string',
    cron: 'string',
    task: "'cleanup' | 'repair' | 'backfill'",
  }),
  status: type({
    lastRunAt: 'string?',
    phase: "('Idle' | 'Running' | 'Failed')?",
  }),
});

export type MaintenanceWindowSpec = typeof MaintenanceWindowEntity.spec.infer;
export type MaintenanceWindowStatus = NonNullable<typeof MaintenanceWindowEntity.status>['infer'];

export const AccountEntity = entity('Account', {
  spec: type({
    tenant: 'string',
    email: 'string',
    displayName: 'string',
    role: "'owner' | 'admin' | 'viewer'",
  }),
  status: type({ active: 'boolean?' }),
});


export type AccountSpec = typeof AccountEntity.spec.infer;
export type AccountStatus = NonNullable<typeof AccountEntity.status>['infer'];

export const RenameTenantAccount = command('tenant-account.rename.v1', {
  input: type({ tenant: 'string', accountId: 'string', displayName: 'string', requestId: 'string' }),
  output: type({ changed: 'boolean', displayName: 'string' }),
  errors: { accountNotFound: type({ accountId: 'string' }) },
});

export const TenantAccountChanged = event('tenant-account.changed.v1', {
  payload: type({ tenant: 'string', accountId: 'string', displayName: 'string' }),
});

export const ProvisionTenantInfrastructure = workflow('tenant.infrastructure.provision.v1', {
  input: type({ tenantId: 'string', namespace: 'string', requestId: 'string' }),
  output: type({ namespace: 'string', endpoint: 'string' }),
  errors: { provisioningFailed: type({ message: 'string', retryable: 'boolean' }) },
});

export const RemoveTenantInfrastructure = workflow('tenant.infrastructure.remove.v1', {
  input: type({ tenantId: 'string', namespace: 'string', requestId: 'string' }),
  output: type({ removed: 'boolean' }),
});

export const CommitTenantTransition = workflow('tenant.transition.commit.v1', {
  input: type({ tenantId: 'string', requestId: 'string', adminEndpoint: 'string', phase: "'Ready' | 'Decommissioned' | 'NeedsIntervention'", endpoint: 'string?' }),
  output: type({ committed: 'boolean' }),
});

export const OnboardTenant = workflow('tenant.onboard.v1', {
  input: type({ tenantId: 'string', namespace: 'string', requestId: 'string', adminEndpoint: 'string' }),
  output: type({ phase: "'Ready' | 'Compensated' | 'NeedsIntervention'", endpoint: 'string?' }),
  signals: { approval: type({ approved: 'boolean', reviewer: 'string' }) },
});

export const DecommissionTenant = workflow('tenant.decommission.v1', {
  input: type({ tenantId: 'string', namespace: 'string', requestId: 'string', adminEndpoint: 'string' }),
  output: type({ phase: "'Decommissioned' | 'NeedsIntervention'" }),
  signals: { confirm: type({ approved: 'boolean', reviewer: 'string' }) },
});

function tenantDnsEndpointResource(namespaces?: readonly string[]) {
  return dns.externalDns.resource({ access: 'local', ...(namespaces ? { namespaces } : {}) });
}

function tenantDnsRuntimeCapabilities(namespace: string) {
  return dns.externalDns.capabilities({
    crdSource: 'enabled',
    configuredRecordTypes: ['A', 'AAAA', 'CNAME'],
    managedDomainPatterns: ['example.test'],
    watchedNamespaces: [namespace],
    controllerObservation: 'supported',
    mutationPolicy: 'sync',
    registry: 'txt',
    providerRecordOwnership: 'configured',
    targetUpdates: 'supported',
    recordDeletion: 'supported',
    dryRun: false,
    propagationVerification: 'unavailable',
    configurationEvidenceRefs: [{ apiVersion: 'apps/v1', kind: 'Deployment', name: 'external-dns', namespace }],
  });
}

type TenantReconcileHandler = Parameters<
  ResourceDefinition<TenantSpec, TenantStatus>['on']['reconcile']
>[0];
type TenantReconcileScope = Parameters<TenantReconcileHandler>[0];

async function reconcileTenantKubernetesStatus(
  tenant: TenantReconcileScope,
): Promise<void> {
  const kubeConfig = new k8s.KubeConfig();
  kubeConfig.loadFromOptions({
    clusters: [{ name: 'cluster', server: 'https://kubernetes.default.svc' }],
    users: [{ name: 'runtime' }],
    contexts: [
      {
        name: 'runtime',
        cluster: 'cluster',
        user: 'runtime',
      },
    ],
    currentContext: 'runtime',
  });
  const namespaces = await kubeConfig
    .makeApiClient(k8s.CoreV1Api)
    .listNamespace({ limit: 1 });
  tenant.status.phase = 'Ready';
  tenant.status.observedGeneration = tenant.metadata.generation ?? 0;
  tenant.status.url =
    `https://${tenant.metadata.name}.${tenant.spec.namespace}.example.test`;
  tenant.status.message =
    `Kubernetes SDK observed ${namespaces.items.length} namespace`;
}

function reconcileTenantBasicStatus(tenant: TenantReconcileScope): void {
  tenant.status.phase = 'Ready';
  tenant.status.observedGeneration = tenant.metadata.generation ?? 0;
  tenant.status.url =
    `https://${tenant.metadata.name}.${tenant.spec.namespace}.example.test`;
}

async function reconcileTenantDns(tenant: TenantReconcileScope): Promise<void> {
  const endpointResource = tenantDnsEndpointResource();
  const namespace = tenant.metadata.namespace;
  const capabilities = tenantDnsRuntimeCapabilities(namespace);
  const intent = dns.normalize({
    publicationId: tenant.metadata.name,
    dnsName: `${tenant.metadata.name}.example.test`,
    record: {
      type: 'CNAME',
      target: `gateway.${tenant.spec.namespace}.example.test`,
    },
    ttlSeconds: 60,
  });
  if (!intent.ok) throw new Error(intent.error.message);
  const ownership = {
    controllerId: tenantDnsRuntimeControllerId(tenant.object.apiVersion),
    publicationId: intent.value.publicationId,
    source: {
      apiVersion: tenant.object.apiVersion,
      kind: tenant.object.kind,
      namespace: tenant.metadata.namespace,
      name: tenant.metadata.name,
      uid: tenant.metadata.uid,
    },
  };
  // typecast: retain the local-placement discriminant while deriving only its namespace at runtime.
  const placement = { mode: 'local' as const, namespace };
  const endpointName = externalDnsPublicationName(
    ownership.controllerId,
    ownership.publicationId,
  );
  const current = await tenant.read
    .resource(endpointResource)
    .get({ name: endpointName, namespace });
  const decision = dns.externalDns.decide({
    intent: intent.value,
    ownership,
    placement,
    capabilities,
    ...(current ? { current } : {}),
  });
  if (decision.kind === 'apply') {
    tenant.resources.apply(decision.resource, { ownership: { mode: 'none' } });
    tenant.requeue({ afterSeconds: 5, reason: 'Tenant DNS object applied' });
  } else if (decision.kind === 'patch') {
    tenant.resources.patch(decision.ref, decision.patch);
    tenant.requeue({ afterSeconds: 5, reason: 'Tenant DNS object updated' });
  } else if (
    decision.kind === 'noop'
    && decision.observation.controller.state !== 'observed'
  ) {
    tenant.requeue({
      afterSeconds: 5,
      reason: 'ExternalDNS observation pending',
    });
  } else if (
    decision.kind === 'conflict'
    || decision.kind === 'unsupported'
  ) {
    throw new Error(decision.diagnostic.message);
  }
}

async function finalizeTenantDns(tenant: TenantReconcileScope): Promise<void> {
  const endpointResource = tenantDnsEndpointResource();
  const namespace = tenant.metadata.namespace;
  const capabilities = tenantDnsRuntimeCapabilities(namespace);
  const publicationId = tenant.metadata.name;
  const ownership = {
    controllerId: tenantDnsRuntimeControllerId(tenant.object.apiVersion),
    publicationId,
    source: {
      apiVersion: tenant.object.apiVersion,
      kind: tenant.object.kind,
      namespace: tenant.metadata.namespace,
      name: tenant.metadata.name,
      uid: tenant.metadata.uid,
    },
  };
  // typecast: retain the local-placement discriminant while deriving only its namespace at runtime.
  const placement = { mode: 'local' as const, namespace };
  const endpointName = externalDnsPublicationName(
    ownership.controllerId,
    publicationId,
  );
  const current = await tenant.read
    .resource(endpointResource)
    .get({ name: endpointName, namespace });
  const decision = dns.externalDns.decideDelete({
    ownership,
    placement,
    capabilities,
    ...(current ? { current } : {}),
  });
  if (decision.kind === 'delete') {
    tenant.resources.delete(decision.ref, {
      preconditions: decision.precondition,
    });
  } else if (
    decision.kind === 'conflict'
    || decision.kind === 'unsupported'
  ) {
    throw new Error(decision.diagnostic.message);
  }
}

function tenantDnsRuntimeControllerId(apiVersion: string): string {
  return `${apiVersion.split('/')[0] ?? apiVersion}/tenant-dns/v1`;
}

export type RenameTenantAccountInput = typeof RenameTenantAccount.input.infer;
export type RenameTenantAccountOutput = typeof RenameTenantAccount.output.infer;

export const AuditRecordEntity = entity('AuditRecord', {
  spec: type({
    tenant: 'string',
    actor: 'string',
    action: 'string',
    subject: 'string',
    createdAt: 'string',
  }),
  status: type({ archived: 'boolean?' }),
});

export type AuditRecordSpec = typeof AuditRecordEntity.spec.infer;
export type AuditRecordStatus = NonNullable<typeof AuditRecordEntity.status>['infer'];

export const InvitationEntity = entity('Invitation', {
  spec: type({
    tenant: 'string',
    email: 'string',
    role: "'admin' | 'viewer'",
    expiresAt: 'string',
  }),
  status: type({
    phase: "('Pending' | 'Accepted' | 'Expired')?",
    acceptedAt: 'string?',
  }),
});

export type InvitationSpec = typeof InvitationEntity.spec.infer;
export type InvitationStatus = NonNullable<typeof InvitationEntity.status>['infer'];

export const UsageSampleEntity = entity('UsageSample', {
  spec: type({
    tenant: 'string',
    metric: 'string',
    value: 'number',
    sampledAt: 'string',
  }),
  status: type({ processed: 'boolean?' }),
});

export type UsageSampleSpec = typeof UsageSampleEntity.spec.infer;
export type UsageSampleStatus = NonNullable<typeof UsageSampleEntity.status>['infer'];

export interface TenantPlatformExample {
  readonly composition: KubernetesApplicationBuilder['composition'];
  readonly models: {
    readonly TenantLifecycle: ApplicationModelBinding<TenantLifecycleSpec>;
    readonly Account: ApplicationModelBinding<AccountSpec, AccountStatus>;
    readonly AuditRecord: ApplicationModelBinding<AuditRecordSpec, AuditRecordStatus>;
    readonly Invitation: ApplicationModelBinding<InvitationSpec, InvitationStatus>;
    readonly UsageSample: ApplicationModelBinding<UsageSampleSpec, UsageSampleStatus>;
  };
  /** Historical v0.4 custom-operation fixture; current examples prefer direct model operations. */
  readonly commands?: {
    readonly renameAccount: ApplicationMutationOperation<RenameTenantAccountInput, RenameTenantAccountOutput>;
  };
}

export function createTenantPlatformExample(options: TenantPlatformExampleOptions = {}): TenantPlatformExample {
  const config = { ...defaultOptions, ...options };

  const tenantPlatform = app(config.stackName, {
    namespace: config.namespace,
    apiVersion: `${config.apiGroup}/v1alpha1`,
    kind: config.stackKind,
    spec: type({}),
    status: type({ ready: 'boolean', phase: 'string?' }),
  });

  const TenantDnsEndpoint = config.durableWorkflows
    ? tenantDnsEndpointResource([config.namespace])
    : undefined;
  const Tenant = tenantPlatform.resource('Tenant', {
    spec: TenantEntity.spec,
    status: TenantEntity.status,
    ...(config.durableBehavior || TenantDnsEndpoint ? {
      controller: {
        // typecast: preserve SDK deployment and RBAC literal unions across conditional option assembly.
        ...(config.durableBehavior ? { scope: 'Cluster' as const } : {}),
        permissions: [
          ...(config.durableBehavior
            // typecast: keep the core-v1 verb tuple literal through conditional array spreading.
            ? [{ apiGroups: [''], resources: ['namespaces'], verbs: ['get', 'list'] as const }]
            : []),
          ...(TenantDnsEndpoint
            // typecast: keep the ExternalDNS verb tuple literal through conditional array spreading.
            ? [{ apiGroups: ['externaldns.k8s.io'], resources: ['dnsendpoints'], verbs: ['create', 'patch', 'delete'] as const }]
            : []),
        ],
        ...(TenantDnsEndpoint
          ? {
              reads: { TenantDnsEndpoint },
              secondaryWatches: (resource) => [
                sdk.watch(TenantDnsEndpoint).enqueue(resource, {
                  namespace: 'source',
                  map: {
                    mode: 'targetNameFromSourceField',
                    source: {
                      kind: 'annotation',
                      key: externalDnsPublicationMetadata.sourceNameAnnotation,
                    },
                  },
                }),
              ],
            }
          : {}),
      },
    } : {}),
  });
  tenantPlatform.resource('Environment', {
    spec: EnvironmentEntity.spec,
    status: EnvironmentEntity.status,
  });
  tenantPlatform.resource('AppInstallation', {
    spec: AppInstallationEntity.spec,
    status: AppInstallationEntity.status,
  });
  tenantPlatform.resource('MaintenanceWindow', {
    spec: MaintenanceWindowEntity.spec,
    status: MaintenanceWindowEntity.status,
  });

  tenantPlatform.storage.postgres(config.databaseClusterName, {
    database: config.databaseName,
    migrations: 'generated-job',
  });

  tenantPlatform.defaults({ indexes: 'valkey' });

  const Account = tenantPlatform.model(AccountEntity, {
    schema: {
      identity: ['id'],
      constraints: [{ name: 'account-tenant-email-unique', kind: 'unique', fields: ['tenant', 'email'] }],
      indexes: [
        { name: 'accounts-by-tenant', partitionBy: 'tenant', orderBy: ['email'] },
        { name: 'accounts-by-email', partitionBy: 'email', unique: true },
      ],
      transactions: 'required',
      retention: { mode: 'retain' },
    },
  });
  const TenantLifecycle = tenantPlatform.model(TenantLifecycleEntity, {
    schema: {
      identity: ['id'],
      transactions: 'required',
      retention: { mode: 'retain' },
    },
  });
  const AuditRecord = tenantPlatform.model(AuditRecordEntity, {
    schema: {
      identity: ['id'],
      indexes: [{ name: 'audit-by-tenant-time', partitionBy: 'tenant', orderBy: ['createdAt'] }],
      transactions: 'supported',
      retention: { mode: 'ttl', ttlSeconds: 60 * 60 * 24 * 90 },
    },
  });
  const Invitation = tenantPlatform.model(InvitationEntity, {
    schema: {
      identity: ['id'],
      constraints: [{ name: 'invitation-tenant-email-unique', kind: 'unique', fields: ['tenant', 'email'] }],
      indexes: [{ name: 'invitations-by-tenant', partitionBy: 'tenant', orderBy: ['expiresAt'] }],
      transactions: 'required',
      retention: { mode: 'ttl', ttlSeconds: 60 * 60 * 24 * 30 },
    },
  });
  const UsageSample = tenantPlatform.model(UsageSampleEntity, {
    schema: {
      identity: ['id'],
      indexes: [{ name: 'usage-by-tenant-metric', partitionBy: 'tenant', orderBy: ['sampledAt'] }],
      transactions: 'supported',
      retention: { mode: 'ttl', ttlSeconds: 60 * 60 * 24 * 14 },
    },
  });
  const accountCommandRegistrar = applicationModelCommandRegistrar(Account);
  if (config.durableBehavior && !accountCommandRegistrar) {
    throw new Error('The historical v0.4 Account fixture is missing its internal command-lowering registrar.');
  }
  const renameAccountBinding = config.durableBehavior ? accountCommandRegistrar?.(RenameTenantAccount, {
    key: ({ accountId }) => accountId,
    ordering: 'serial',
    processor: { replicas: 2, concurrency: 4 },
    idempotencyKey: ({ requestId }) => requestId,
    missing: 'reject',
    transaction: { history: [Account], outbox: [TenantAccountChanged] },
  }, async (account, input, context) => {
    const changed = account.spec.displayName !== input.displayName;
    account.patch({ spec: { displayName: input.displayName } });
    context.emit(TenantAccountChanged, { tenant: input.tenant, accountId: input.accountId, displayName: input.displayName });
    return { changed, displayName: input.displayName };
  }) : undefined;
  const renameAccount = renameAccountBinding
    ? createApplicationMutationOperation<RenameTenantAccountInput, RenameTenantAccountOutput>({
        apiVersion: 'applik8s.operation/v1alpha1',
        kind: 'applicationOperation',
        id: 'tenant-account.rename.v1',
        model: 'Account',
        name: 'rename',
        operation: 'custom',
        transport: 'command',
      }, undefined, {
        input: RenameTenantAccount.input,
        output: RenameTenantAccount.output,
      })
    : undefined;
  if (config.durableWorkflows) {
    tenantPlatform.provide(DnsPublication, DnsPublication.externalDns());
    tenantPlatform.provide(WorkflowEngine, WorkflowEngine.hatchet({
      name: `${config.stackName}-workflows`,
      namespace: config.namespace,
      adminCredentialsSecret: { apiVersion: 'v1', kind: 'Secret', name: `${config.stackName}-hatchet-admin`, namespace: config.namespace },
      database: { clusterName: `${config.stackName}-hatchet-db`, database: 'hatchet', instances: 1, storageSize: '8Gi' },
      worker: { replicas: 1, taskSlots: 8, durableSlots: 32, gracefulShutdownSeconds: 45, scaling: { mode: 'fixed' } },
    }));
    const provisionInfrastructure = tenantPlatform.workflow(ProvisionTenantInfrastructure, { retries: 5, retryBackoff: { factor: 2, maxSeconds: 120 }, executionTimeoutSeconds: 300, idempotencyKey: (input) => input.requestId }, async (input) => {
      const response = await fetch(`http://tenant-infrastructure-api.platform.svc/tenants/${encodeURIComponent(input.tenantId)}`, { method: 'PUT', headers: { 'content-type': 'application/json', 'idempotency-key': input.requestId }, body: JSON.stringify({ namespace: input.namespace }) });
      if (!response.ok) throw new Error(`Tenant infrastructure provisioning failed with HTTP ${response.status}.`);
      return { namespace: input.namespace, endpoint: `https://${input.tenantId}.example.test` };
    });
    const removeInfrastructure = tenantPlatform.workflow(RemoveTenantInfrastructure, { retries: 5, executionTimeoutSeconds: 300, idempotencyKey: (input) => input.requestId }, async (input) => {
      const response = await fetch(`http://tenant-infrastructure-api.platform.svc/tenants/${encodeURIComponent(input.tenantId)}`, { method: 'DELETE', headers: { 'idempotency-key': input.requestId } });
      if (!response.ok && response.status !== 404) throw new Error(`Tenant infrastructure removal failed with HTTP ${response.status}.`);
      return { removed: true };
    });
    const commitTransition = tenantPlatform.workflow(CommitTenantTransition, { retries: 8, executionTimeoutSeconds: 60, idempotencyKey: (input) => input.requestId }, async (input) => {
      const body = new URLSearchParams({ requestId: input.requestId, phase: input.phase, ...(input.endpoint ? { endpoint: input.endpoint } : {}) });
      const response = await fetch(`${input.adminEndpoint}/tenants/${encodeURIComponent(input.tenantId)}/transition`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'idempotency-key': input.requestId }, body });
      if (!response.ok) throw new Error(`Canonical tenant transition failed with HTTP ${response.status}.`);
      return { committed: true };
    });
    // typecast: literal phases retain the workflow output discriminant across compensation and intervention branches.
    tenantPlatform.workflow(OnboardTenant, { worker: { group: `${config.stackName}-onboarding`, replicas: 1, taskSlots: 8, durableSlots: 32 } }, async (input, context) => {
      let provisioned: { namespace: string; endpoint: string } | undefined;
      try {
        provisioned = await provisionInfrastructure(input, { idempotencyKey: `${input.requestId}:provision` });
        const approval = await context.waitFor('approval', { lookback: '24h' });
        if (!approval.approved) {
          await removeInfrastructure(input, { idempotencyKey: `${input.requestId}:compensate` });
          // typecast: preserve the declared workflow output phase discriminant.
          return { phase: 'Compensated' as const };
        }
        await commitTransition({ tenantId: input.tenantId, requestId: `${input.requestId}:ready`, adminEndpoint: input.adminEndpoint, phase: 'Ready', endpoint: provisioned.endpoint }, { idempotencyKey: `${input.requestId}:ready` });
        // typecast: preserve the declared workflow output phase discriminant.
        return { phase: 'Ready' as const, endpoint: provisioned.endpoint };
      } catch (error) {
        context.rethrowIfCancelled(error);
        if (provisioned) {
          try {
            await removeInfrastructure(input, { idempotencyKey: `${input.requestId}:compensate` });
          } catch {
            await commitTransition({ tenantId: input.tenantId, requestId: `${input.requestId}:intervention`, adminEndpoint: input.adminEndpoint, phase: 'NeedsIntervention' }, { idempotencyKey: `${input.requestId}:intervention` });
            // typecast: preserve the declared workflow output phase discriminant.
            return { phase: 'NeedsIntervention' as const };
          }
        }
        throw error;
      }
    });
    // typecast: the decommissioning branches retain the declared literal workflow phase union.
    tenantPlatform.workflow(DecommissionTenant, { worker: { group: `${config.stackName}-decommissioning`, replicas: 1, taskSlots: 8, durableSlots: 32 } }, async (input, context) => {
      const confirmation = await context.waitFor('confirm', { lookback: '7d' });
      // typecast: preserve the declared workflow output phase discriminant.
      if (!confirmation.approved) return { phase: 'NeedsIntervention' as const };
      await removeInfrastructure(input, { idempotencyKey: `${input.requestId}:remove` });
      await commitTransition({ tenantId: input.tenantId, requestId: `${input.requestId}:decommissioned`, adminEndpoint: input.adminEndpoint, phase: 'Decommissioned' }, { idempotencyKey: `${input.requestId}:decommissioned` });
      // typecast: preserve the declared workflow output phase discriminant.
      return { phase: 'Decommissioned' as const };
    });

  }
  tenantPlatform.server(config.adminServerName, {
    service: { port: 80 },
    env: { TENANT_PLATFORM_NAMESPACE: config.namespace },
  }, (http) => {
    http.post('transition-tenant', '/tenants/:tenant/transition', async ({ params, form }) => {
      const tenantId = params.tenant ?? 'default';
      const requestId = form.string('requestId');
      const phase = form.enum('phase', ['Ready', 'Decommissioned', 'NeedsIntervention']);
      const endpoint = form.string('endpoint') || undefined;
      return TenantLifecycle.transaction(async (models) => {
        const existing = await models.get({ id: tenantId });
        if (existing?.spec.lastRequestId === requestId) return existing;
        const spec = { phase, ...(endpoint ? { endpoint } : {}), lastRequestId: requestId, updatedAt: new Date().toISOString() };
        return existing ? models.patch({ id: tenantId }, { spec }) : models.create({ id: tenantId, spec });
      });
    });
    http.post('create-account', '/tenants/:tenant/accounts', async ({ params, form }) => Account.create({
      tenant: params.tenant ?? 'default',
      email: form.string('email').trim().toLowerCase(),
      displayName: form.string('displayName'),
      role: form.enum('role', ['owner', 'admin', 'viewer']),
    }));
    http.get('list-accounts', '/tenants/:tenant/accounts', async ({ params }) => Account.index('accounts-by-tenant', { partitionBy: 'tenant', orderBy: ['email'] }).query(params.tenant ?? 'default', { limit: 50 }));
    http.get('list-audit', '/tenants/:tenant/audit', async ({ params, query }) => AuditRecord.index('audit-by-tenant-time', { partitionBy: 'tenant', orderBy: ['createdAt'] }).query(params.tenant ?? 'default', { limit: 100, cursor: query.cursor }));
    http.post('create-invitation', '/tenants/:tenant/invitations', async ({ params, form }) => {
      const tenant = params.tenant ?? 'default';
      const email = form.string('email').trim().toLowerCase();
      const role = form.enum('role', ['admin', 'viewer']);
      const invitation = await Invitation.create({ tenant, email, role, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() });
      await AuditRecord.create({ tenant, actor: 'tenant-admin-api', action: 'invitation.created', subject: invitation.id, createdAt: new Date().toISOString() });
      return invitation;
    });
    http.get('list-invitations', '/tenants/:tenant/invitations', async ({ params }) => Invitation.index('invitations-by-tenant', { partitionBy: 'tenant', orderBy: ['expiresAt'] }).query(params.tenant ?? 'default', { limit: 50 }));
    http.get('list-usage', '/tenants/:tenant/usage', async ({ params, query }) => UsageSample.index('usage-by-tenant-metric', { partitionBy: 'tenant', orderBy: ['sampledAt'] }).query(params.tenant ?? 'default', { limit: 100, cursor: query.cursor }));
  });

  Tenant.on.reconcile(
    config.durableWorkflows
      ? config.durableBehavior
        ? async (tenant) => {
            await reconcileTenantKubernetesStatus(tenant);
            await reconcileTenantDns(tenant);
          }
        : async (tenant) => {
            reconcileTenantBasicStatus(tenant);
            await reconcileTenantDns(tenant);
          }
      : config.durableBehavior
        ? reconcileTenantKubernetesStatus
        : reconcileTenantBasicStatus,
  );
  if (config.durableWorkflows) {
    Tenant.on.finalize(finalizeTenantDns, {
      finalizer: `${config.apiGroup}/tenant-dns-cleanup`,
    });
  }

  tenantPlatform.workload.job('tenant-platform-repair', { taskKind: 'repair', image: 'postgres:16-alpine', command: ['sh', '-c'], args: ['echo repair tenant platform status'] });
  tenantPlatform.workload.cronJob('tenant-platform-cleanup', { taskKind: 'cleanup', cron: '*/15 * * * *', image: 'postgres:16-alpine', concurrencyPolicy: 'forbid', missedRunPolicy: 'failClosed' });

  return {
    composition: tenantPlatform.composition,
    models: { TenantLifecycle, Account, AuditRecord, Invitation, UsageSample },
    ...(renameAccount ? { commands: { renameAccount } } : {}),
  };
}

export function createTenantPlatformV04Example(options: TenantPlatformExampleOptions = {}): TenantPlatformExample {
  return createTenantPlatformExample({ ...options, durableBehavior: true });
}

export function createTenantPlatformV05Example(options: TenantPlatformExampleOptions = {}): TenantPlatformExample {
  return createTenantPlatformExample({ ...options, durableBehavior: true, durableWorkflows: true });
}

export function createTenantPlatformPressureTestContract(example = createTenantPlatformExample()): ApplicationV03PressureTestContract {
  const graph = applicationGraphFor(example.composition);
  if (!graph) {
    throw new Error('tenant platform pressure-test graph is missing');
  }
  const digest = `sha256:${createHash('sha256').update(serializeApplicationGraph(graph)).digest('hex')}`;
  return {
    name: 'tenant-platform-control-plane-pressure-test',
    graph: { apiVersion: graph.apiVersion, path: 'application-graph.json', digest },
    requiredNodes: [...new Set(graph.nodes.map((node) => node.kind))],
    requiredProviders: ['TransactionalDatabase', 'IndexStore', 'CounterStore', 'Secret', 'HttpExposure', 'CredentialStore', 'Queue', 'ObjectStorage', 'EventSource'],
    requiredRuntimeModules: ['serverRuntime', 'modelRuntime', 'jobRunnerRuntime', 'kubernetesClient', 'diagnostics', 'providerAdapter'],
    requiredOperationTargets: [{ id: 'operation-target.tenant-stack', target: { nodeId: 'typeKroResource.tenant-stack' }, operations: ['apply', 'delete'], execution: { contexts: ['handler', 'generatedServer', 'generatedJob', 'typeKro'], ordering: 'dependencyAware', runtimeValidation: 'beforeEffects', failurePolicy: 'failClosed' }, lowering: { mode: 'typeKroResource', artifact: { kind: 'typeKroResource', path: 'plans/tenant-stack.apply.json' }, failurePolicy: 'failClosed' }, dryRun: { supported: true, artifact: { kind: 'typeKroResource', path: 'plans/tenant-stack.dry-run.json' }, failurePolicy: 'failClosed' }, ownership: { ownerReferences: 'required', orphanPolicy: 'retain' }, finalizers: { required: true, finalizer: 'platform.applik8s.dev/tenant-stack', cleanupOperation: 'deleteTarget' }, permissions: [{ apiGroups: ['platform.applik8s.dev'], resources: ['tenantstacks'], verbs: ['create', 'patch', 'delete'] }], diagnostics: [] }],
    requiredWatchScopes: [
      { scope: { kind: 'labelSelector', apiVersion: 'apps/v1', resourceKind: 'Deployment', namespace: defaultOptions.namespace, labels: { 'platform.applik8s.dev/tenant': 'tenant-a' } }, lowering: 'labelSelector', runtime: { mode: 'sharedInformer', resyncPolicy: 'bounded', cancellation: 'onScopeRemoved' }, permissions: [{ apiGroups: ['apps'], resources: ['deployments'], verbs: ['list', 'watch'] }], failurePolicy: 'failClosed', diagnostics: [] },
      { scope: { kind: 'labelSelector', apiVersion: 'apps/v1', resourceKind: 'Deployment', namespace: defaultOptions.namespace, labels: {} }, lowering: 'labelSelector', permissions: [], failurePolicy: 'failClosed', diagnostics: [{ event: 'applik8s-watch-scope-unlowerable', severity: 'error', subject: { apiVersion: 'apps/v1', kind: 'Deployment', namespace: defaultOptions.namespace }, reason: 'UnsupportedLabelSelectorExpression', message: 'Unsupported watch predicate fails closed instead of broadening tenant platform watches.', retryable: false }] },
    ],
    requiredMigrationDriftChecks: [{ model: { nodeId: 'model.account' }, provider: { interface: 'TransactionalDatabase', nodeId: 'provider.transactional-database' }, observedSchemaSource: { apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', name: defaultOptions.databaseClusterName, namespace: defaultOptions.namespace }, expectedRevision: 'sha256:tenant-platform-schema-v1', policy: { mode: 'explicitPlanRequired', destructiveChangePolicy: 'reject', driftPolicy: 'failClosed', dataBackfillPolicy: 'generatedJob' }, enforcement: { stage: 'preMigration', historyTable: 'applik8s_model_migrations', lock: 'providerNative', failurePolicy: 'failClosed' }, failureModes: ['missingHistoryTable', 'incompatibleIndex', 'destructiveChange'], diagnostics: [{ event: 'applik8s-model-migration-drift-detected', severity: 'error', subject: { nodeId: 'model.account' }, reason: 'SchemaDriftDetected', message: 'Tenant platform schema drift must fail closed before applying migrations.', retryable: false }] }],
    requiredTransactionalDatabaseSemantics: [tenantPlatformTransactionalDatabaseSemantics()],
    requiredRuntimeModuleInterfaces: [tenantPlatformRuntimeModuleInterface([{ kind: 'modelRuntime', name: 'tenant-platform-models' }, { kind: 'diagnostics', name: 'diagnostics' }], [{ name: 'createServerRuntime', kind: 'function', stability: 'stable' }], 'required')],
    requiredProviderInterfaces: tenantPlatformProviderInterfaces(),
    providerCompatibility: tenantPlatformProviderCompatibilityMatrix(),
    requiredStatusOwnership: [{ primary: 'applicationStatus', durableAuthority: 'generatedStatusConfigMap', releasePolicy: 'kroStatusProjectionRequired', applicationStatusProjection: 'requiredAuthoritative', appStatusSchema: 'required', appStatusSchemaContract: tenantPlatformAppStatusSchemaContract(), durableStore: { apiVersion: 'v1', kind: 'ConfigMap', name: `${defaultOptions.stackName}-status-reconciler-status`, namespace: defaultOptions.namespace }, fallbackStore: tenantPlatformGeneratedStatusConfigMapContract(), concurrency: tenantPlatformGeneratedStatusConcurrencyContract(), observability: tenantPlatformGeneratedStatusObservabilityContract(), conflictPolicy: 'mergePatch', diagnostics: [{ event: 'applik8s-status-projection-unavailable', severity: 'error', subject: { nodeId: 'job.tenant-platform-model-migration' }, reason: 'KroStatusProjectionRequired', message: 'KRO-owned status.applik8s.jobs hydration is required for the Tenant Platform app resource.', retryable: false }] }],
    requiredStatusEvidence: tenantPlatformStatusEvidence(),
    requiredTransactionalDatabaseEvidence: tenantPlatformTransactionalDatabaseEvidence(),
    requiredOperationTargetEvidence: tenantPlatformOperationTargetEvidence(),
    requiredWatchScopeEvidence: tenantPlatformWatchScopeEvidence(),
    runtimeReleasePolicy: tenantPlatformRuntimeReleasePolicy(),
    liveValidation: { contextEnv: 'APPLIK8S_E2E_CONTEXT', requiredResources: [{ apiVersion: 'batch/v1', kind: 'Job', name: 'tenant-platform-model-migration', namespace: defaultOptions.namespace }, { apiVersion: 'apps/v1', kind: 'Deployment', name: defaultOptions.adminServerName, namespace: defaultOptions.namespace }, { apiVersion: 'v1', kind: 'ConfigMap', name: `${defaultOptions.stackName}-status-reconciler-status`, namespace: defaultOptions.namespace }], requiredAssertions: ['migration job completes', 'server becomes ready', 'model create/query works', 'duplicate key returns 409', 'durable job status is persisted', 'migration drift fails closed', 'operation-target dry-run is artifact-backed', 'scoped listener routes watched objects', 'unsupported watch predicates fail closed'], additionalAssertions: ['generated job status history is retained', 'tenant stack operation target dry-run is inspectable'] },
  };
}

function tenantPlatformProviderInterfaces(): readonly ApplicationProviderInterfaceContract[] {
  return [
      { interface: 'TransactionalDatabase', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
      { interface: 'HttpExposure', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
      { interface: 'IndexStore', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
      { interface: 'Search', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
      { interface: 'CounterStore', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
      { interface: 'Secret', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
      { interface: 'CredentialStore', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
      { interface: 'Queue', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
      { interface: 'ObjectStorage', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
      { interface: 'EventSource', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
      { interface: 'EventLog', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
      { interface: 'Certificate', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
      { interface: 'DnsPublication', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
      { interface: 'WorkflowEngine', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
      { interface: 'Scheduler', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
      { interface: 'Observability', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
      { interface: 'LakehouseDataset', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
      { interface: 'LakehouseQuery', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
      { interface: 'ActorRuntime', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
      { interface: 'StructuredGeneration', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
      { interface: 'AI', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
      { interface: 'AnalyticalDatabase', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
      { interface: 'ApplicationHost', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
      { interface: 'ContainerRegistry', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
      { interface: 'IdentityProvider', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
      { interface: 'OAuthAuthorizationServer', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
      { interface: 'Authorization', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
    ];
}

function tenantPlatformProviderCompatibilityMatrix(): ApplicationProviderCompatibilityMatrixContract {
  return { apiVersion: 'applik8s.providerCompatibility/v1alpha1', providers: tenantPlatformProviderInterfaces(), requiredForV03: ['TransactionalDatabase', 'IndexStore', 'CounterStore', 'EventSource', 'Secret', 'Queue', 'ObjectStorage', 'HttpExposure', 'CredentialStore'] };
}

function tenantPlatformTransactionalDatabaseSemantics(): NonNullable<ApplicationV03PressureTestContract['requiredTransactionalDatabaseSemantics']>[number] {
  return {
    generatedRuntimeParity: 'required',
    scriptRuntimeParity: 'required',
    query: { defaultLimit: 50, maxLimit: 500, cursor: 'offset', unsupportedFilters: 'failClosed' },
    indexes: { partitionRequired: true, uniqueEnforcedBy: 'databaseConstraint', orderBy: 'declaredIndexFieldsOnly', unsupportedOrderBy: 'failClosed' },
    constraints: { duplicateKeyDiagnostic: 'applik8s-model-duplicate-key', enforcement: 'databaseConstraint' },
    migrationHistory: { tableName: 'applik8s_model_migrations', revisionColumn: 'revision', appliedAtColumn: 'applied_at' },
    transactions: { declaration: 'supported', singleOperationAtomicity: 'databaseStatement', multiOperationApi: 'implemented', multiOperationBehavior: 'runtimeTransaction' },
    retention: { mode: 'retain', deletionPolicy: 'explicitOnly', enforcement: 'runtimeEnforced' },
  };
}

function tenantPlatformRuntimeModuleInterface(imports: NonNullable<ApplicationV03PressureTestContract['requiredRuntimeModuleInterfaces']>[number]['imports'], exports: NonNullable<ApplicationV03PressureTestContract['requiredRuntimeModuleInterfaces']>[number]['exports'], sourceMaps: NonNullable<ApplicationV03PressureTestContract['requiredRuntimeModuleInterfaces']>[number]['sourceMaps']): NonNullable<ApplicationV03PressureTestContract['requiredRuntimeModuleInterfaces']>[number] {
  return { apiVersion: 'applik8s.runtime/v1alpha1', imports, exports, diagnostics: 'structured', sourceMaps, failurePolicy: 'failClosed' };
}

function tenantPlatformStatusEvidence(): ApplicationV03PressureTestContract['requiredStatusEvidence'] {
  return { authoritativeStore: 'applicationStatus', appStatusProjection: 'requiredAuthoritative', history: 'boundedRetained', conflictBehavior: 'resourceVersionRetryAndExhaustionDiagnostics', restartSafety: 'required', multiJobCronJobCoverage: 'required', metrics: ['acceptedUpdates', 'rejectedUpdates', 'conflictUpdates', 'observedJobs', 'retainedJobs'], liveGate: 'requiredBeforeAnnouncement', failurePolicy: 'failClosed' };
}

function tenantPlatformTransactionalDatabaseEvidence(): ApplicationV03PressureTestContract['requiredTransactionalDatabaseEvidence'] {
  return { generatedRuntimeParity: 'localGeneratedArtifactGate', scriptRuntimeParity: 'localAndOptInLiveGate', liveGate: 'requiredBeforeAnnouncement', queryIndexConstraintCoverage: 'required', transactionCoverage: 'required', migrationDriftCoverage: 'required', unsupportedSemantics: 'failClosed' };
}

function tenantPlatformOperationTargetEvidence(): ApplicationV03PressureTestContract['requiredOperationTargetEvidence'] {
  return { contexts: ['handler', 'generatedServer', 'generatedJob', 'typeKro'], dryRunPlans: 'artifactBackedRequired', generatedServerJobExecution: 'required', typeKroExecution: 'required', rbacAndFinalizerCoverage: 'required', failurePolicy: 'failClosed' };
}

function tenantPlatformWatchScopeEvidence(): ApplicationV03PressureTestContract['requiredWatchScopeEvidence'] {
  return { lowerings: ['exact', 'finite', 'labelSelector', 'fieldSelector', 'mixed'], unsupportedPredicateDiagnostics: 'generatedArtifactAndLiveGateRequired', runtimeRouting: 'required', broadWatchFallback: 'forbidden', failurePolicy: 'failClosed' };
}

function tenantPlatformRuntimeReleasePolicy(): ApplicationV03PressureTestContract['runtimeReleasePolicy'] {
  return { startupPackageManager: false, dependencyInstallation: 'buildTimeOnly', runtimeImage: 'explicitImageOrGeneratedRecipe', supplyChain: 'metadataOnlyUntilSignedArtifacts', signedArtifacts: 'postV03', failurePolicy: 'failClosed' };
}

function tenantPlatformAppStatusSchemaContract(): NonNullable<ApplicationDurableStatusOwnershipContract['appStatusSchemaContract']> {
  return { statusRoot: 'status.applik8s', jobsPath: 'status.applik8s.jobs', schema: 'generatedJobStatusMap', ownership: 'kroStatusProjection', pruningBehavior: 'failClosed' };
}

function tenantPlatformGeneratedStatusConfigMapContract(): NonNullable<ApplicationDurableStatusOwnershipContract['fallbackStore']> {
  return { objectOwnership: 'runtimeCreatedResource', dataOwnership: 'runtime', dataKeys: ['status.json', 'applik8s-jobs.json', 'history.json', 'conflicts.json', 'updatedAt'], updateStrategy: 'resourceVersionMergePatch', history: { key: 'history.json', maxEntries: 20, terminalRetention: 'retain' }, conflicts: { key: 'conflicts.json', maxEntries: 20 } };
}

function tenantPlatformGeneratedStatusConcurrencyContract(): NonNullable<ApplicationDurableStatusOwnershipContract['concurrency']> {
  return { updateStrategy: 'resourceVersionRetry', maxAttempts: 5, retryDiagnostic: 'applik8s-job-status-reconciler-status-store-conflict-retry', retryExhaustedDiagnostic: 'applik8s-job-status-reconciler-status-store-conflict-exhausted', failurePolicy: 'failClosed' };
}

function tenantPlatformGeneratedStatusObservabilityContract(): NonNullable<ApplicationDurableStatusOwnershipContract['observability']> {
  return { mergeEvent: 'applik8s-job-status-reconciler-status-store-merged', conflictRetryEvent: 'applik8s-job-status-reconciler-status-store-conflict-retry', metrics: ['acceptedUpdates', 'rejectedUpdates', 'conflictUpdates', 'observedJobs', 'retainedJobs'] };
}

export const tenantPlatform = createTenantPlatformExample().composition;
export const tenantPlatformV04 = createTenantPlatformV04Example().composition;
