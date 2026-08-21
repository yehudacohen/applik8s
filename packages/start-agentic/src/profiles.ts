// typecast-file-boundary: Maintained profile inputs are validated before provider-specific option records are assembled.
import {
  AI,
  AIBackend,
  type ApplicationAIDeterministicProvider,
} from '@applik8s/ai';
import {
  AnalyticalDatabase,
  Analytics,
  ApplicationHost,
  type ApplicationIdentityInfrastructure,
  type ApplicationIdentityProvider,
  type ApplicationProviderBinding,
  type ApplicationTransactionalDatabaseProvider,
  Database,
  EventLog,
  IdentityProvider,
  Lakehouse,
  LakehouseDataset,
  LakehouseQuery,
  type KubernetesApplicationBuilder,
  type KubernetesApplicationScope,
  module,
  ObjectStorage,
  Observability,
  postgres,
  Search,
  TransactionalDatabase,
  trustedContext,
  WorkflowEngine,
} from '@applik8s/applik8s';
import type { JsonValue } from '@applik8s/core';
import { type } from 'arktype';
import {
  type ApplicationPaymentProvider,
  type BillingUsageReportInput,
  LocalPayments,
  type PaymentCheckoutInput,
  type PaymentPortalInput,
  PaymentProvider,
  type PaymentWebhookInput,
  type SubscriptionCancellationInput,
  type SubscriptionChangeInput,
} from '@applik8s/billing';
import { StripePayments } from '@applik8s/billing-stripe';
import {
  type ApplicationNotificationDeliveryProvider,
  LocalNotificationDelivery,
  NotificationDelivery,
} from '@applik8s/notifications';
import { SmtpNotificationDelivery } from '@applik8s/notifications-smtp';

export interface AgenticExternalDatabase {
  readonly clusterName: string;
  readonly namespace: string;
  readonly database: string;
  readonly connectionSecretName: string;
  readonly connectionSecretKey?: string;
}

export interface AgenticExternalAnalytics {
  readonly endpoint: string;
  readonly database?: string;
  readonly credentialsSecretName?: string;
}

export interface AgenticExternalEvents {
  readonly server: string;
  readonly stream?: string;
  readonly subjectPrefix?: string;
  readonly connectionSecretName?: string;
}

export interface AgenticExternalObjects {
  readonly endpoint: string;
  readonly bucket: string;
  readonly region: string;
  readonly credentialsSecretName: string;
  readonly forcePathStyle?: boolean;
}

export interface AgenticExternalWorkflows {
  /** Hatchet gRPC dispatcher endpoint, for example hatchet.example.test:7070. */
  readonly hostPort: string;
  /** Hatchet HTTP API endpoint used for observation and administration. */
  readonly apiUrl: string;
  readonly tokenSecretName: string;
  readonly tokenKey?: string;
}

export interface AgenticExternalSearch {
  readonly endpoint: string;
  readonly namespace?: string;
  readonly credentialsSecretName?: string;
}

export interface AgenticExternalInference {
  readonly endpoint: string;
  readonly model: string;
  readonly credentialSecretName: string;
  readonly credentialKey?: string;
  /** Explicit local-test escape hatch; production external inference must use HTTPS. */
  readonly allowInsecureHttp?: boolean;
}

export interface AgenticExternalIdentity {
  readonly kind: 'ory';
  readonly issuer: string;
  readonly publicUrl: string;
  readonly adminUrl: string;
}

export interface AgenticStripePayments {
  readonly secretName: string;
  readonly apiKeyKey?: string;
  readonly webhookSecretKey?: string;
  readonly endpoint?: string;
}

export interface AgenticManagedCredentialSource {
  readonly kind: 'hostEnvironment' | 'existingSecret';
  /** Canonical default: OPENROUTER_API_KEY. */
  readonly variable?: string;
}

export interface AgenticManagedPaymentCredentialSource {
  readonly kind: 'hostEnvironment' | 'existingSecret';
  /** Canonical default: STRIPE_SECRET_KEY. */
  readonly apiKeyVariable?: string;
  /** Canonical default: STRIPE_WEBHOOK_SECRET. */
  readonly webhookSecretVariable?: string;
}

export interface AgenticDedicatedInference extends AgenticExternalInference {
  readonly credentialSource?: AgenticManagedCredentialSource;
}

export interface AgenticManagedStripePayments extends AgenticStripePayments {
  readonly credentialSource?: AgenticManagedPaymentCredentialSource;
}

export interface AgenticSmtpNotifications {
  readonly host: string;
  readonly port?: number;
  readonly secure?: boolean;
  readonly secretName: string;
  readonly usernameKey?: string;
  readonly passwordKey?: string;
  readonly senderEmail: string;
  readonly senderName?: string;
}

export interface AgenticManagedSmtpNotifications
  extends AgenticSmtpNotifications {
  readonly credentialSource?: {
    readonly kind: 'hostEnvironment' | 'existingSecret';
    readonly usernameVariable?: string;
    readonly passwordVariable?: string;
  };
}

export interface AgenticDeveloperProviders {
  readonly inference: AgenticDedicatedInference;
  /**
   * Optional live payment adapter. Applications that do not consume billing
   * remain credential-free; omitted payments use the simulated provider.
   */
  readonly payments?: AgenticManagedStripePayments;
  readonly notifications?: AgenticManagedSmtpNotifications;
}

/**
 * Cluster capability required by the Rook/Ceph development platform.
 *
 * Rook OSD PVCs require a real block-capable StorageClass. The Start never
 * guesses that a cluster's default filesystem provisioner can satisfy it.
 */
export interface AgenticDedicatedObjects {
  readonly deviceStorageClassName: string;
  /** Explicitly permit loop-backed devices in local development only. */
  readonly allowLoopDevices?: boolean;
}

export interface AgenticExternalProviders {
  readonly database: AgenticExternalDatabase;
  readonly analytics: AgenticExternalAnalytics;
  readonly events: AgenticExternalEvents;
  readonly objects: AgenticExternalObjects;
  readonly workflows: AgenticExternalWorkflows;
  readonly search: AgenticExternalSearch;
  readonly inference: AgenticExternalInference;
  readonly identity: AgenticExternalIdentity;
  readonly payments: AgenticStripePayments;
  readonly notifications: AgenticSmtpNotifications;
}

export type AgenticInstallationSpec =
  | {
      readonly name: string;
      readonly profile: 'starter';
    }
  | {
      readonly name: string;
      /** Explicit non-production profile backed by operation-host .env credentials. */
      readonly profile: 'developer';
      readonly providers: AgenticDeveloperProviders;
    }
  | {
      readonly name: string;
      readonly profile: 'dedicated';
      readonly providers: {
        readonly inference: AgenticDedicatedInference;
        readonly identity: {
          readonly issuer: string;
        };
        readonly objects: AgenticDedicatedObjects;
        readonly payments: AgenticManagedStripePayments;
        readonly notifications: AgenticManagedSmtpNotifications;
      };
    }
  | {
      readonly name: string;
      readonly profile: 'external';
      readonly providers: AgenticExternalProviders;
    };

export interface AgenticProfileContext {
  readonly application: string;
  readonly namespace: string;
}

export interface ConfigureAgenticProfilesOptions<
  TSchema extends Readonly<Record<string, unknown>> = Record<string, never>,
> extends Partial<AgenticProfileContext> {
  readonly schema?: TSchema;
  readonly migrations?: string | {
    readonly path: string;
    readonly digest?: string;
  };
  readonly databaseName?: string;
  readonly processor?: {
    readonly group?: string;
    readonly deployment?: {
      readonly replicas?: number;
      readonly concurrency?: number;
      readonly maxInFlight?: number;
    };
  };
  /** Provider-neutral identity adapter for the production-shaped dedicated profile. */
  readonly dedicatedIdentity?: () => ApplicationIdentityProvider;
  /**
   * Optional non-production deterministic inference fixture for a maintained
   * Starter acceptance application. Production profiles cannot select it.
   */
  readonly starterInference?: () => ApplicationAIDeterministicProvider;
  /** Provider-neutral identity adapter for externally managed identity. */
  readonly externalIdentity?: (
    spec: Extract<AgenticInstallationSpec, { readonly profile: 'external' }>,
  ) => ApplicationIdentityProvider;
  /**
   * Optional provider-neutral payment adapters. The maintained installation
   * schema ships a Stripe implementation, while applications may replace any
   * live profile without changing billing feature code.
   */
  readonly developerPayments?: (
    spec: Extract<AgenticInstallationSpec, { readonly profile: 'developer' }>,
  ) => ApplicationPaymentProvider;
  readonly dedicatedPayments?: (
    spec: Extract<AgenticInstallationSpec, { readonly profile: 'dedicated' }>,
  ) => ApplicationPaymentProvider;
  readonly externalPayments?: (
    spec: Extract<AgenticInstallationSpec, { readonly profile: 'external' }>,
  ) => ApplicationPaymentProvider;
  readonly developerNotifications?: (
    spec: Extract<AgenticInstallationSpec, { readonly profile: 'developer' }>,
  ) => ApplicationNotificationDeliveryProvider;
  readonly dedicatedNotifications?: (
    spec: Extract<AgenticInstallationSpec, { readonly profile: 'dedicated' }>,
  ) => ApplicationNotificationDeliveryProvider;
  readonly externalNotifications?: (
    spec: Extract<AgenticInstallationSpec, { readonly profile: 'external' }>,
  ) => ApplicationNotificationDeliveryProvider;
}

export type AgenticProfilesOptions = Pick<
  ConfigureAgenticProfilesOptions,
  | 'starterInference'
  | 'dedicatedIdentity'
  | 'externalIdentity'
  | 'developerPayments'
  | 'dedicatedPayments'
  | 'externalPayments'
  | 'developerNotifications'
  | 'dedicatedNotifications'
  | 'externalNotifications'
>;

type DatabaseBinding =
  ApplicationProviderBinding<ApplicationTransactionalDatabaseProvider>;

export type AgenticProfileName =
  | 'starter'
  | 'developer'
  | 'dedicated'
  | 'external';

/** Canonical server-admitted workspace boundary shared by profiles and models. */
export const AgenticWorkspaceId = trustedContext('workspaceId', {
  schema: type('string'),
});

/**
 * Canonical data-isolation boundary for both personal and shared work.
 *
 * Identity admission always supplies this value. It is the authenticated
 * principal for personal work and the proven workspace ID after a workspace
 * has been selected. Keeping it distinct from AgenticWorkspaceId prevents a
 * personal scope from masquerading as a selected tenant.
 */
export const AgenticPrincipalScope = trustedContext('principalScope', {
  schema: type('string'),
});

export interface AgenticPrincipalScopeContext {
  readonly trustedContext: Readonly<Record<string, JsonValue>>;
}

/**
 * Returns the principal or workspace boundary admitted by the maintained
 * identity adapter. Callers never derive this database/RLS key from browser
 * input or reuse a domain-specific conversation hash for tenant ownership.
 */
export function agenticPrincipalScope(
  context: AgenticPrincipalScopeContext,
): string {
  const scope = context.trustedContext[AgenticPrincipalScope.name];
  if (typeof scope !== 'string' || !scope.trim()) {
    throw new Error('Agentic work requires an admitted principal scope.');
  }
  return scope;
}

/**
 * Reviewed workload and stateful-capacity defaults for the maintained Start.
 *
 * Applications choose only a profile. Individual provider/workload options
 * remain overrideable at their normal typed declaration sites, while the
 * repetitive cross-profile selection table stays maintained by the Start.
 */
export function agenticCapacity(
  application: Pick<KubernetesApplicationScope, 'select'>,
  profile: AgenticProfileName,
) {
  const chooseNumber = (
    starter: number,
    developer: number,
    dedicated: number,
    external: number,
  ): number => application.select(profile, {
    starter,
    developer,
    dedicated,
    external,
    default: starter,
  });
  const chooseString = (
    starter: string,
    developer: string,
    dedicated: string,
    external: string,
  ): string => application.select(profile, {
    starter,
    developer,
    dedicated,
    external,
    default: starter,
  });
  return Object.freeze({
    webReplicas: chooseNumber(1, 1, 3, 2),
    webCpuRequest: chooseString('150m', '150m', '500m', '250m'),
    webMemoryRequest: chooseString('192Mi', '192Mi', '512Mi', '256Mi'),
    webCpuLimit: chooseString('1', '1', '2', '1'),
    webMemoryLimit: chooseString('512Mi', '512Mi', '1Gi', '768Mi'),
    gatewayReplicas: chooseNumber(1, 1, 3, 2),
    commandReplicas: chooseNumber(1, 1, 3, 2),
    commandConcurrency: chooseNumber(16, 16, 48, 32),
    commandCpuRequest: chooseString('100m', '100m', '500m', '250m'),
    commandMemoryRequest: chooseString('192Mi', '192Mi', '512Mi', '256Mi'),
    commandCpuLimit: chooseString('1', '1', '2', '1'),
    commandMemoryLimit: chooseString('512Mi', '512Mi', '1Gi', '768Mi'),
    postgresInstances: chooseNumber(1, 1, 3, 1),
    postgresStorage: chooseString('1Gi', '1Gi', '200Gi', '1Gi'),
    postgresStorageClass: chooseString('local-path', 'local-path', 'ceph-block', 'local-path'),
    eventLogReplicas: chooseNumber(1, 1, 3, 1),
    eventLogStorage: chooseString('8Gi', '8Gi', '100Gi', '8Gi'),
    eventLogStorageClass: chooseString('', '', 'ceph-block', ''),
    workflowDatabaseInstances: chooseNumber(1, 1, 3, 1),
    workflowDatabaseStorage: chooseString('8Gi', '8Gi', '100Gi', '8Gi'),
    workflowDatabaseStorageClass: chooseString('local-path', 'local-path', 'ceph-block', 'local-path'),
    workflowReplicas: chooseNumber(1, 1, 3, 2),
    analyticsStorage: chooseString('16Gi', '16Gi', '250Gi', '16Gi'),
    analyticsStorageClass: chooseString('local-path', 'local-path', 'ceph-block', 'local-path'),
    indexShards: chooseNumber(1, 1, 3, 1),
    indexReplicas: chooseNumber(0, 0, 1, 0),
    indexStorage: chooseString('8Gi', '8Gi', '100Gi', '8Gi'),
    indexStorageClass: chooseString('local-path', 'local-path', 'ceph-block', 'local-path'),
  });
}

export const AgenticProfiles = Object.freeze({
  capacity: agenticCapacity,
});

/** Credential-free constructors backed by the same production-shaped contracts. */
export const AgenticStarter = Object.freeze({
  database(context: AgenticProfileContext) {
    return TransactionalDatabase.postgres({
      name: 'primary',
      clusterName: `${context.application}-db`,
      namespace: context.namespace,
      database: context.application,
      instances: 1,
      storage: { size: '2Gi' },
    });
  },
  analytics(database: DatabaseBinding) {
    return Analytics.postgres({ database, schema: 'agentic_analytics' });
  },
  events(context: AgenticProfileContext) {
    return {
      kind: 'nats-jetstream' as const,
      name: `${context.application}-events`,
      namespace: context.namespace,
      provision: true,
      replicas: 1,
      storageSize: '2Gi',
      servers: [
        `nats://${context.application}-events.${context.namespace}.svc:4222`,
      ],
    };
  },
  objects(context: AgenticProfileContext) {
    const name = `${context.application}-objects`;
    return ObjectStorage.s3({
      name: 'objects',
      endpoint: `http://${name}.${context.namespace}.svc:8333`,
      bucket: name,
      region: 'us-east-1',
      forcePathStyle: true,
      ownership: 'direct-provisioned',
      credentialsSecret: {
        apiVersion: 'v1',
        kind: 'Secret',
        name: `${name}-credentials`,
        namespace: context.namespace,
      },
      provisioning: {
        kind: 'local-s3',
        enabled: true,
        name,
        storageSize: '2Gi',
        storageClassName: 'local-path',
      },
    });
  },
  workflows(context: AgenticProfileContext) {
    return WorkflowEngine.hatchet({
      name: `${context.application}-workflows`,
      namespace: context.namespace,
      provision: true,
      mode: 'stack',
      hostPort: `hatchet-engine.${context.namespace}.svc:7070`,
      apiUrl: `http://hatchet-api.${context.namespace}.svc:8080`,
      tokenKey: 'HATCHET_CLIENT_TOKEN',
      dashboard: 'internal',
      worker: {
        replicas: 1,
        taskSlots: 8,
        durableSlots: 8,
        scaling: { mode: 'fixed' },
      },
    });
  },
  search(database: DatabaseBinding) {
    return Search.postgres({
      database,
      schema: 'agentic_search',
      maximumCandidateRows: 10_000,
    });
  },
  inference() {
    return AI.deterministic({
      fixture: {
        response: 'I created a launch-readiness brief with an objective, execution plan, success measures, risks, and a concrete next action. The saved Document is the authoritative result.',
        tool: {
          index: 0,
          inputFromLatestUser: 'document',
          input: {
            title: 'Launch readiness brief',
            body: [
              '# Launch readiness brief',
              '',
              '## Objective',
              'Ship the first customer-ready release with a clear owner, measurable success criteria, and a reversible rollout.',
              '',
              '## Assumptions',
              '- The product journey has passed the Starter acceptance suite.',
              '- One product owner can make the final go/no-go decision.',
              '- Deployment and rollback are both exercised before launch.',
              '',
              '## Execution plan',
              '- [ ] Assign an owner and launch window.',
              '- [ ] Verify the critical user journey in the target environment.',
              '- [ ] Confirm support, monitoring, and incident escalation coverage.',
              '- [ ] Publish the release notes and customer communication.',
              '',
              '## Success measures',
              '- A new customer completes the primary workflow without assistance.',
              '- No critical errors or unresolved provider failures appear after deployment.',
              '- The team can identify the exact release, owner, and rollback action.',
              '',
              '## Risks and rollback',
              'Pause the rollout if the primary workflow fails, provider health degrades, or data integrity cannot be verified. Restore the previous known-good deployment and retain the incident evidence for review.',
              '',
              '## Next action',
              'Name the launch owner, choose the target date, and request review of this brief.',
            ].join('\n'),
            summary: 'A customer-ready launch plan with ownership, acceptance checks, measurable outcomes, and rollback criteria.',
            tags: ['launch', 'readiness', 'agent-created'],
          },
        },
      },
    });
  },
  payments() {
    return LocalPayments.simulated();
  },
  notifications() {
    return LocalNotificationDelivery.inspectable();
  },
});

/**
 * Local developer profile: Starter-sized stateful dependencies with real
 * inference and payment adapters backed by operation-host environment
 * bindings. It is intentionally non-production.
 */
export const AgenticDeveloper = Object.freeze({
  inference(
    spec: AgenticDedicatedInference,
    context: AgenticProfileContext,
  ) {
    return AgenticDedicated.inference(spec, context);
  },
  payments(spec: AgenticManagedStripePayments, context: AgenticProfileContext) {
    return agenticStripePayments(spec, context);
  },
  notifications(spec: AgenticManagedSmtpNotifications, context: AgenticProfileContext) {
    return agenticSmtpNotifications(spec, context);
  },
});

/** Reviewed application-owned dedicated topology constructors. */
export const AgenticDedicated = Object.freeze({
  database(context: AgenticProfileContext) {
    return TransactionalDatabase.postgres({
      name: 'primary',
      clusterName: `${context.application}-db`,
      namespace: context.namespace,
      database: context.application,
      instances: 3,
      storage: { size: '20Gi' },
      lifecycle: { deletionPolicy: 'retain' },
      ownership: 'direct-provisioned',
    });
  },
  analytics(context: AgenticProfileContext) {
    return Analytics.clickHouse({
      name: `${context.application}-analytics`,
      namespace: context.namespace,
      provision: true,
      storageSize: '50Gi',
    });
  },
  events(context: AgenticProfileContext) {
    return {
      kind: 'nats-jetstream' as const,
      name: `${context.application}-events`,
      namespace: context.namespace,
      provision: true,
      replicas: 3,
      storageSize: '20Gi',
      servers: [
        `nats://${context.application}-events.${context.namespace}.svc:4222`,
      ],
    };
  },
  objects(
    context: AgenticProfileContext,
    options: AgenticDedicatedObjects,
  ) {
    const claim = `${context.application}-objects`;
    return ObjectStorage.s3({
      name: 'objects',
      bucket: `${context.application}-objects`,
      region: 'us-east-1',
      forcePathStyle: true,
      ownership: 'direct-provisioned',
      credentialsSecret: {
        apiVersion: 'v1',
        kind: 'Secret',
        name: claim,
        namespace: context.namespace,
      },
      provisioning: {
        kind: 'object-bucket-claim',
        enabled: true,
        claimName: claim,
        storageClassName: 'applik8s-rook-buckets',
        claimLifecycle: 'application',
        platform: {
          kind: 'rook-ceph-single-node-development',
          name: 'applik8s-rook',
          namespace: 'applik8s-rook-ceph',
          operatorNamespace: 'applik8s-rook-ceph-operator',
          deviceStorageClassName: options.deviceStorageClassName,
          ...(options.allowLoopDevices !== undefined
            ? { allowLoopDevices: options.allowLoopDevices }
            : {}),
          storageSize: '16Gi',
          objectStoreName: 'applik8s-object-store',
        },
      },
    });
  },
  workflows(context: AgenticProfileContext) {
    return WorkflowEngine.hatchet({
      name: `${context.application}-workflows`,
      namespace: context.namespace,
      provision: true,
      mode: 'ha',
      hostPort: `hatchet-engine.${context.namespace}.svc:7070`,
      apiUrl: `http://hatchet-api.${context.namespace}.svc:8080`,
      tokenKey: 'HATCHET_CLIENT_TOKEN',
      dashboard: 'internal',
      worker: {
        replicas: 2,
        taskSlots: 32,
        durableSlots: 32,
        scaling: { mode: 'fixed' },
      },
    });
  },
  search(context: AgenticProfileContext) {
    return Search.openSearch({
      name: `${context.application}-search`,
      namespace: context.namespace,
      provision: true,
      profile: 'production',
      topology: { nodes: 3, roles: ['clusterManager', 'data', 'ingest'] },
      storage: { size: '50Gi', deletionPolicy: 'retain' },
      networkPolicy: {
        enabled: true,
        operatorNamespace: 'opensearch-operator-system',
        ingressNamespaceLabels: {
          'kubernetes.io/metadata.name': context.namespace,
        },
      },
    });
  },
  inference(
    spec: AgenticDedicatedInference,
    context: AgenticProfileContext,
  ) {
    return AI.envoy({
      name: `${context.application}-inference`,
      namespace: context.namespace,
      provision: true,
      versions: {
        envoyGateway: 'v1.6.0',
        aiGateway: 'v0.6.0',
        gatewayApi: 'v1.4.1',
      },
      models: {
        fast: {
          fallback: 'disabled',
          backends: [
            AIBackend.openAICompatible('primary', {
              model: spec.model,
              endpoint: spec.endpoint,
              credentials: {
                apiVersion: 'v1',
                kind: 'Secret',
                name: spec.credentialSecretName,
                namespace: context.namespace,
                key: spec.credentialKey ?? 'apiKey',
              },
              capabilities: ['chat', 'tools', 'streaming'],
            }),
          ],
        },
      },
    });
  },
  identity(
    spec: Extract<
      AgenticInstallationSpec,
      { readonly profile: 'dedicated' }
    >['providers']['identity'],
    context: AgenticProfileContext,
  ) {
    const name = `${context.application}-identity`;
    const infrastructure: ApplicationIdentityInfrastructure = {
      kind: 'ory',
      stack: 'platform',
      provision: true,
      spec: {
        name,
        namespace: context.namespace,
        shared: true,
        managed: {
          databases: true,
          secrets: true,
          routes: false,
          sampleUpstream: false,
          courierSes: false,
        },
        hydra: {
          issuerUrl: spec.issuer,
        },
      },
      deletionPolicy: 'retain',
      timeoutMs: 15 * 60_000,
    };
    return IdentityProvider.from(
      authenticateAgenticDedicatedRequest,
      {
        infrastructure,
        handle: handleAgenticDedicatedIdentityRequest,
        ready: readyAgenticDedicatedIdentity,
      },
    );
  },
  payments(spec: AgenticStripePayments, context: AgenticProfileContext) {
    return agenticStripePayments(spec, context);
  },
  notifications(spec: AgenticSmtpNotifications, context: AgenticProfileContext) {
    return agenticSmtpNotifications(spec, context);
  },
});

/** Explicitly externally owned provider constructors. */
export const AgenticExternal = Object.freeze({
  database(spec: AgenticExternalDatabase, context: AgenticProfileContext) {
    return Database.externalPostgres({
      clusterName: spec.clusterName,
      namespace: spec.namespace,
      database: spec.database,
      cluster: {
        apiVersion: 'postgresql.cnpg.io/v1',
        kind: 'Cluster',
        name: spec.clusterName,
        namespace: spec.namespace,
      },
      connection: {
        secretName: spec.connectionSecretName,
        namespace: context.namespace,
        ...(spec.connectionSecretKey
          ? { key: spec.connectionSecretKey }
          : {}),
      },
    });
  },
  analytics(spec: AgenticExternalAnalytics, context: AgenticProfileContext) {
    return Analytics.externalClickHouse({
      endpoint: spec.endpoint,
      ...(spec.database ? { database: spec.database } : {}),
      ...(spec.credentialsSecretName
        ? { credentialsSecretName: spec.credentialsSecretName }
        : {}),
      ...(spec.credentialsSecretName
        ? { credentialsSecretNamespace: context.namespace }
        : {}),
    });
  },
  events(spec: AgenticExternalEvents, context: AgenticProfileContext) {
    return {
      kind: 'nats-jetstream' as const,
      name: spec.stream ?? 'applik8s-events',
      provision: false,
      servers: [spec.server],
      ...(spec.stream ? { stream: spec.stream } : {}),
      ...(spec.subjectPrefix ? { subjectPrefix: spec.subjectPrefix } : {}),
      ...(spec.connectionSecretName
        ? {
            connectionSecret: {
              apiVersion: 'v1',
              kind: 'Secret',
              name: spec.connectionSecretName,
              namespace: context.namespace,
            },
          }
        : {}),
    };
  },
  objects(spec: AgenticExternalObjects, context: AgenticProfileContext) {
    return ObjectStorage.s3({
      endpoint: spec.endpoint,
      bucket: spec.bucket,
      region: spec.region,
      forcePathStyle: spec.forcePathStyle ?? false,
      ownership: 'external',
      credentialsSecret: {
        apiVersion: 'v1',
        kind: 'Secret',
        name: spec.credentialsSecretName,
        namespace: context.namespace,
      },
    });
  },
  workflows(spec: AgenticExternalWorkflows, context: AgenticProfileContext) {
    return WorkflowEngine.hatchet({
      name: `${context.application}-workflows`,
      namespace: context.namespace,
      provision: false,
      hostPort: spec.hostPort,
      apiUrl: spec.apiUrl,
      workerTokenSecret: {
        apiVersion: 'v1',
        kind: 'Secret',
        name: spec.tokenSecretName,
        namespace: context.namespace,
      },
      tokenKey: spec.tokenKey ?? 'token',
    });
  },
  search(spec: AgenticExternalSearch, context: AgenticProfileContext) {
    return Search.externalOpenSearch({
      endpoint: spec.endpoint,
      ...(spec.namespace ? { namespace: spec.namespace } : {}),
      ...(spec.credentialsSecretName
        ? {
            adminCredentialsSecret: {
              apiVersion: 'v1',
              kind: 'Secret',
              name: spec.credentialsSecretName,
              namespace: context.namespace,
            },
          }
        : {}),
    });
  },
  inference(spec: AgenticExternalInference, context: AgenticProfileContext) {
    return AI.envoy({
      provision: false,
      versions: {
        envoyGateway: 'v1.6.0',
        aiGateway: 'v0.6.0',
        gatewayApi: 'v1.4.1',
      },
      models: {
        fast: {
          fallback: 'disabled',
          backends: [
            AIBackend.openAICompatible('external', {
              model: spec.model,
              endpoint: spec.endpoint,
              ...(spec.allowInsecureHttp
                ? { allowInsecureHttp: spec.allowInsecureHttp }
                : {}),
              credentials: {
                apiVersion: 'v1',
                kind: 'Secret',
                name: spec.credentialSecretName,
                namespace: context.namespace,
                key: spec.credentialKey ?? 'apiKey',
              },
              capabilities: ['chat', 'tools', 'streaming'],
            }),
          ],
        },
      },
    });
  },
  identity(_spec: AgenticExternalIdentity) {
    return IdentityProvider.from(
      authenticateAgenticExternalRequest,
      {
        handle: handleAgenticExternalIdentityRequest,
        ready: readyAgenticExternalIdentity,
      },
    );
  },
  payments(spec: AgenticStripePayments, context: AgenticProfileContext) {
    return agenticStripePayments(spec, context);
  },
  notifications(spec: AgenticSmtpNotifications, context: AgenticProfileContext) {
    return agenticSmtpNotifications(spec, context);
  },
});

/**
 * Maintained exhaustive profile wiring for the Agentic Start.
 *
 * Applications provide their logical schema and the two identity adapters
 * whose policy is necessarily application-owned. The Start owns the
 * repetitive provider qualifications, exhaustive branches, defaults, and
 * database promotion boundary.
 */
export function configureAgenticProfiles<
  TSchema extends Readonly<Record<string, unknown>>,
>(
  application: KubernetesApplicationBuilder<
    AgenticInstallationSpec,
    { readonly ready: boolean }
  >,
  options: ConfigureAgenticProfilesOptions<TSchema>,
) {
  const deployment = application.profile(
    application.installation.spec,
    'profile',
    {
      variants: [
        'starter',
        'developer',
        'dedicated',
        'external',
      ] as const,
    },
  );
  const PrimaryDatabase = TransactionalDatabase.named('primary');
  const AnalyticsStore = AnalyticalDatabase.named('primary');
  const EventTransport = EventLog.named('primary');
  const ApplicationObjects = ObjectStorage.named('primary');
  const ApplicationSearch = Search.named('primary');
  const ApplicationWorkflows = WorkflowEngine.named('primary');
  const PrimaryIdentity = IdentityProvider.named('primary');
  const PrimaryPayments = PaymentProvider.named('primary');
  const TransactionalNotifications = NotificationDelivery.named('transactional');
  const Inference = AI.named('inference');
  const HistoricalDataset = LakehouseDataset.named('historical-usage');
  const HistoricalQueries = LakehouseQuery.named('historical-usage');
  const ApplicationObservability = Observability.named('primary');
  const applicationName = options.application ?? application.name;
  const namespace = options.namespace ?? `${application.name}-system`;
  const profileContext = {
    application: applicationName,
    namespace,
  } as const;
  const historyBucket = `${applicationName}-history`;
  const historyCatalog = `${applicationName.replace(/[^a-zA-Z0-9_]+/gu, '_')}_history`;

  // Runtime topology is selected by the deployment target, independently of
  // product profile. Feature source consumes only the qualified capabilities.
  // Kubernetes deliberately uses an externally qualified S3/Athena path until
  // a Kubernetes-native lakehouse provider passes the same beta contract.
  const observability = application
    .provide(ApplicationObservability)
    .local(() => Observability.local())
    .awsLocal(() => Observability.cloudWatch({ region: 'us-east-1' }))
    .aws(() => Observability.cloudWatch({ region: 'us-east-1' }))
    .kubernetes(() => Observability.clickStack({
      namespace: `${applicationName}-observability`,
      storageSize: '20Gi',
    }));

  application
    .provide(HistoricalDataset)
    .local(() => Lakehouse.duckdbDataset({
      root: '.applik8s/state/lakehouse/historical-usage',
      schemaRevision: 'v1',
    }))
    .awsLocal(() => Lakehouse.s3Dataset({
      bucket: historyBucket,
      prefix: 'lakehouse/historical-usage',
      region: 'us-east-1',
      catalog: historyCatalog,
      schemaRevision: 'v1',
    }))
    .aws(() => Lakehouse.s3Dataset({
      bucket: historyBucket,
      prefix: 'lakehouse/historical-usage',
      region: 'us-east-1',
      catalog: historyCatalog,
      schemaRevision: 'v1',
    }))
    .kubernetes(() => Lakehouse.s3Dataset({
      bucket: historyBucket,
      prefix: 'lakehouse/historical-usage',
      region: 'us-east-1',
      catalog: historyCatalog,
      schemaRevision: 'v1',
    }));

  application
    .provide(HistoricalQueries)
    .local(() => Lakehouse.duckdbQueries({
      maximumRows: 1_000,
      maximumScannedBytes: 64 * 1024 * 1024,
    }))
    .awsLocal(() => Lakehouse.athenaQueries({
      workgroup: `${applicationName}-history`,
      region: 'us-east-1',
      resultLocation: `s3://${historyBucket}/queries/`,
    }))
    .aws(() => Lakehouse.athenaQueries({
      workgroup: `${applicationName}-history`,
      region: 'us-east-1',
      resultLocation: `s3://${historyBucket}/queries/`,
    }))
    .kubernetes(() => Lakehouse.athenaQueries({
      workgroup: `${applicationName}-history`,
      region: 'us-east-1',
      resultLocation: `s3://${historyBucket}/queries/`,
    }));

  deployment
    .provide(PrimaryDatabase)
    .starter(() => AgenticStarter.database(profileContext))
    .developer(() => AgenticStarter.database(profileContext))
    .dedicated(() => AgenticDedicated.database(profileContext))
    .external((spec) =>
      AgenticExternal.database(spec.providers.database, profileContext),
    )
    .exhaustive();

  const primaryDatabase = application.inject(PrimaryDatabase);

  deployment
    .provide(AnalyticsStore)
    .starter(() => AgenticStarter.analytics(primaryDatabase))
    .developer(() => AgenticStarter.analytics(primaryDatabase))
    .dedicated(() => AgenticDedicated.analytics(profileContext))
    .external((spec) =>
      AgenticExternal.analytics(spec.providers.analytics, profileContext),
    )
    .exhaustive();

  deployment
    .provide(EventTransport)
    .starter(() => AgenticStarter.events(profileContext))
    .developer(() => AgenticStarter.events(profileContext))
    .dedicated(() => AgenticDedicated.events(profileContext))
    .external((spec) =>
      AgenticExternal.events(spec.providers.events, profileContext),
    )
    .exhaustive();

  deployment
    .provide(ApplicationObjects)
    .starter(() => AgenticStarter.objects(profileContext))
    .developer(() => AgenticStarter.objects(profileContext))
    .dedicated((spec) =>
      AgenticDedicated.objects(profileContext, spec.providers.objects),
    )
    .external((spec) =>
      AgenticExternal.objects(spec.providers.objects, profileContext),
    )
    .exhaustive();

  deployment
    .provide(ApplicationWorkflows)
    .starter(() => AgenticStarter.workflows(profileContext))
    .developer(() => AgenticStarter.workflows(profileContext))
    .dedicated(() => AgenticDedicated.workflows(profileContext))
    .external((spec) =>
      AgenticExternal.workflows(spec.providers.workflows, profileContext),
    )
    .exhaustive();

  deployment
    .provide(ApplicationSearch)
    .starter(() => AgenticStarter.search(primaryDatabase))
    .developer(() => AgenticStarter.search(primaryDatabase))
    .dedicated(() => AgenticDedicated.search(profileContext))
    .external((spec) =>
      AgenticExternal.search(spec.providers.search, profileContext),
    )
    .exhaustive();

  deployment
    .provide(Inference)
    .starter(() =>
      options.starterInference?.() ?? AgenticStarter.inference(),
    )
    .developer((spec) => application.selectTarget({
      local: () => AgenticExternal.inference(spec.providers.inference, profileContext),
      awsLocal: () => AgenticExternal.inference(spec.providers.inference, profileContext),
      aws: () => AgenticExternal.inference(spec.providers.inference, profileContext),
      kubernetes: () => AgenticDeveloper.inference(spec.providers.inference, profileContext),
    }))
    .dedicated((spec) => application.selectTarget({
      local: () => AgenticExternal.inference(spec.providers.inference, profileContext),
      awsLocal: () => AgenticExternal.inference(spec.providers.inference, profileContext),
      aws: () => AgenticExternal.inference(spec.providers.inference, profileContext),
      kubernetes: () => AgenticDedicated.inference(spec.providers.inference, profileContext),
    }))
    .external((spec) =>
      AgenticExternal.inference(spec.providers.inference, profileContext),
    )
    .exhaustive();

  deployment
    .provide(PrimaryIdentity)
    .starter(() =>
      agenticIdentityWithDatabase(
        IdentityProvider.from(authenticateAgenticStarterRequest, {
          handle: handleAgenticStarterIdentityRequest,
        }),
        primaryDatabase,
      ),
    )
    .developer(() =>
      agenticIdentityWithDatabase(
        IdentityProvider.from(authenticateAgenticStarterRequest, {
          handle: handleAgenticStarterIdentityRequest,
        }),
        primaryDatabase,
      ),
    )
    .dedicated((spec) =>
      agenticIdentityWithDatabase(
        options.dedicatedIdentity?.()
          ?? AgenticDedicated.identity(
            spec.providers.identity,
            profileContext,
          ),
        primaryDatabase,
      ),
    )
    .external((spec) =>
      agenticIdentityWithDatabase(
        options.externalIdentity?.(spec)
          ?? AgenticExternal.identity(spec.providers.identity),
        primaryDatabase,
      ),
    )
    .exhaustive();

  deployment
    .provide(PrimaryPayments)
    .starter(() => AgenticStarter.payments())
    .developer((spec) =>
      spec.providers.payments
        ? options.developerPayments?.(spec)
          ?? AgenticDeveloper.payments(spec.providers.payments, profileContext)
        : AgenticStarter.payments(),
    )
    .dedicated((spec) =>
      options.dedicatedPayments?.(spec)
        ?? AgenticDedicated.payments(spec.providers.payments, profileContext),
    )
    .external((spec) =>
      options.externalPayments?.(spec)
        ?? AgenticExternal.payments(spec.providers.payments, profileContext),
    )
    .exhaustive();

  deployment
    .provide(TransactionalNotifications)
    .starter(() => AgenticStarter.notifications())
    .developer((spec) =>
      spec.providers.notifications
        ? options.developerNotifications?.(spec)
          ?? AgenticDeveloper.notifications(
            spec.providers.notifications,
            profileContext,
          )
        : AgenticStarter.notifications(),
    )
    .dedicated((spec) =>
      options.dedicatedNotifications?.(spec)
        ?? AgenticDedicated.notifications(
          spec.providers.notifications,
          profileContext,
        ),
    )
    .external((spec) =>
      options.externalNotifications?.(spec)
        ?? AgenticExternal.notifications(
          spec.providers.notifications,
          profileContext,
        ),
    )
    .exhaustive();

  const analytics = application.inject(AnalyticsStore);
  const eventLog = application.inject(EventTransport);
  const objects = application.inject(ApplicationObjects);
  const search = application.inject(ApplicationSearch);
  const workflows = application.inject(ApplicationWorkflows);
  const inference = application.inject(Inference);
  const identity = application.inject(PrimaryIdentity);
  const payments = application.inject(PrimaryPayments);
  const notifications = application.inject(TransactionalNotifications);
  application.defaults({
    database: primaryDatabase,
    analytics,
    eventLog,
    objects,
    search,
  });
  application.provide(WorkflowEngine, workflows);
  application.provide(IdentityProvider, identity);

  // Install the selected defaults before promoting the model schema. Promotion
  // creates built-in model operations immediately, so deferring defaults until
  // afterwards would permanently capture framework fallback providers in their
  // generated processors.
  const database = application.database.bind(
    options.databaseName ?? 'application',
    {
      provider: primaryDatabase,
      schema: options.schema ?? {},
      access: postgres.rls({
        context: AgenticPrincipalScope,
        column: 'principalScope',
        default: 'global',
      }),
      ...(options.migrations ? { migrations: options.migrations } : {}),
      processor: options.processor ?? {
        group: 'agentic-commands',
        deployment: {
          replicas: 1,
          concurrency: 8,
          maxInFlight: 8,
        },
      },
    },
  );

  return Object.freeze({
    database,
    analytics,
    eventLog,
    objects,
    search,
    workflows,
    inference,
    identity,
    payments,
    notifications,
    observability,
    historicalDataset: HistoricalDataset,
    historicalQueries: HistoricalQueries,
  });
}

function agenticIdentityWithDatabase(
  provider: ApplicationIdentityProvider,
  database: ApplicationProviderBinding<ApplicationTransactionalDatabaseProvider>,
): ApplicationIdentityProvider {
  return IdentityProvider.from(provider.authenticate, {
    ...(provider.infrastructure
      ? { infrastructure: provider.infrastructure }
      : {}),
    ...(provider.ready ? { ready: provider.ready } : {}),
    ...(provider.handle ? { handle: provider.handle } : {}),
    dependencies: { database },
  });
}

function agenticStripePayments(
  spec: AgenticStripePayments,
  context: AgenticProfileContext,
): ApplicationPaymentProvider {
  if (typeof spec.secretName !== 'string') {
    return agenticRuntimeStripePayments(context.namespace);
  }
  const namespace = context.namespace;
  return StripePayments.fromSecret({
    ...(spec.endpoint ? { endpoint: spec.endpoint } : {}),
    secrets: {
      apiKey: {
        name: spec.secretName,
        namespace,
        key: spec.apiKeyKey ?? 'apiKey',
      },
      webhookSecret: {
        name: spec.secretName,
        namespace,
        key: spec.webhookSecretKey ?? 'webhookSecret',
      },
    },
    async resolveSecret(reference) {
      // Payment credentials are resolved only inside admitted server execution
      // and never enter the shared authoring graph.
      // static-import-exception: the runtime boundary must remain out of application discovery.
      const runtime = await import('@applik8s/start-agentic/payments-runtime');
      return runtime.resolveAgenticPaymentSecret(reference);
    },
  });
}

function agenticRuntimeStripePayments(
  namespace: string,
): ApplicationPaymentProvider {
  const runtime = async (): Promise<ApplicationPaymentProvider> => {
    // Payment configuration is concrete only inside admitted server execution.
    // static-import-exception: this server-only boundary must stay out of application discovery.
    const module = await import('@applik8s/start-agentic/payments-runtime');
    return module.loadAgenticRuntimeStripePayments(namespace);
  };
  return Object.freeze({
    provider: 'stripe',
    kind: 'stripe',
    mode: 'live',
    capabilities: {
      checkout: true,
      portal: true,
      subscriptionChanges: true,
      scheduledChanges: false,
      meteredUsage: true,
    },
    async startCheckout(input: PaymentCheckoutInput) {
      return (await runtime()).startCheckout(input);
    },
    async openPortal(input: PaymentPortalInput) {
      return (await runtime()).openPortal(input);
    },
    async previewSubscriptionChange(input: SubscriptionChangeInput) {
      const provider = await runtime();
      if (!provider.previewSubscriptionChange) {
        throw new Error('Stripe payment provider cannot preview subscription changes.');
      }
      return provider.previewSubscriptionChange(input);
    },
    async changeSubscription(input: SubscriptionChangeInput) {
      const provider = await runtime();
      if (!provider.changeSubscription) {
        throw new Error('Stripe payment provider cannot change subscriptions.');
      }
      return provider.changeSubscription(input);
    },
    async cancelSubscription(input: SubscriptionCancellationInput) {
      const provider = await runtime();
      if (!provider.cancelSubscription) {
        throw new Error('Stripe payment provider cannot cancel subscriptions.');
      }
      return provider.cancelSubscription(input);
    },
    async resumeSubscription(
      input: Omit<SubscriptionCancellationInput, 'timing'>,
    ) {
      const provider = await runtime();
      if (!provider.resumeSubscription) {
        throw new Error('Stripe payment provider cannot resume subscriptions.');
      }
      return provider.resumeSubscription(input);
    },
    async reportUsage(input: BillingUsageReportInput) {
      const provider = await runtime();
      if (!provider.reportUsage) {
        throw new Error('Stripe payment provider cannot report metered usage.');
      }
      return provider.reportUsage(input);
    },
    async verifyWebhook(input: PaymentWebhookInput) {
      const provider = await runtime();
      if (!provider.verifyWebhook) {
        throw new Error('Stripe payment provider cannot verify webhooks.');
      }
      return provider.verifyWebhook(input);
    },
  });
}

function agenticSmtpNotifications(
  spec: AgenticSmtpNotifications,
  context: AgenticProfileContext,
): ApplicationNotificationDeliveryProvider {
  return SmtpNotificationDelivery.fromSecret({
    host: spec.host,
    port: spec.port ?? (spec.secure ? 465 : 587),
    ...(spec.secure !== undefined ? { secure: spec.secure } : {}),
    sender: {
      email: spec.senderEmail,
      ...(spec.senderName ? { name: spec.senderName } : {}),
    },
    username: {
      name: spec.secretName,
      namespace: context.namespace,
      key: spec.usernameKey ?? 'username',
    },
    password: {
      name: spec.secretName,
      namespace: context.namespace,
      key: spec.passwordKey ?? 'password',
    },
    async resolveSecret(reference) {
      // static-import-exception: load credentials only inside the admitted server workload selected by dependency capture.
      const runtime = await import('@applik8s/start-agentic/notifications-runtime');
      return runtime.resolveAgenticNotificationSecret(reference);
    },
  });
}

/**
 * Maintained provider/profile pack. Application identity, namespace, schema
 * registry, and processor placement are derived by the framework; modules add
 * their tables and relations to the bound database when included.
 */
export function agenticProfilesWith(
  options: AgenticProfilesOptions = {},
) {
  return module(
    'agenticProfiles',
    (
      application: KubernetesApplicationBuilder<
        AgenticInstallationSpec,
        { readonly ready: boolean }
      >,
    ) => {
    const capacity = agenticCapacity(
      application,
      application.installation.spec.profile,
    );
    const configured = configureAgenticProfiles(application, {
      ...options,
      migrations: { path: '../drizzle' },
      processor: {
        group: 'agentic-commands',
        deployment: {
          replicas: capacity.commandReplicas,
          concurrency: capacity.commandConcurrency,
          maxInFlight: capacity.commandConcurrency,
        },
      },
    });
    const host = application.provide(
      ApplicationHost,
      ApplicationHost.managed({
        name: `${application.name}-app`,
        namespace: `${application.name}-system`,
        replicas: capacity.webReplicas,
        resources: {
          requests: {
            cpu: capacity.webCpuRequest,
            memory: capacity.webMemoryRequest,
          },
          limits: {
            cpu: capacity.webCpuLimit,
            memory: capacity.webMemoryLimit,
          },
        },
      }),
    );
    return { ...configured, capacity, host };
    },
  );
}

export const agenticProfiles = agenticProfilesWith();

async function authenticateAgenticDedicatedRequest(
  request: Request,
): Promise<import('@applik8s/core').ApplicationRequestAdmission> {
  // static-import-exception: load the server-only identity adapter only at request admission so the profile declaration remains browser-safe and serializable.
  const runtime = await import('@applik8s/start-agentic/identity-runtime');
  return runtime.authenticateAgenticProfileRequest(request, 'dedicated');
}

async function handleAgenticDedicatedIdentityRequest(
  request: Request,
): Promise<Response> {
  // static-import-exception: the provider-neutral identity HTTP boundary is server-only.
  const runtime = await import('@applik8s/start-agentic/identity-runtime');
  return runtime.handleAgenticProfileIdentityRequest(request, 'dedicated');
}

async function authenticateAgenticStarterRequest(
  request: Request,
): Promise<import('@applik8s/core').ApplicationRequestAdmission> {
  // static-import-exception: the maintained Starter identity is credential-free, but workspace admission still executes only on the server and validates its browser selector against PostgreSQL.
  const runtime = await import('@applik8s/start-agentic/identity-runtime');
  return runtime.authenticateAgenticStarterRequest(request);
}

async function handleAgenticStarterIdentityRequest(
  request: Request,
): Promise<Response> {
  // static-import-exception: the deterministic identity HTTP boundary remains server-only.
  const runtime = await import('@applik8s/start-agentic/identity-runtime');
  return runtime.handleAgenticStarterIdentityRequest(request);
}

async function authenticateAgenticExternalRequest(
  request: Request,
): Promise<import('@applik8s/core').ApplicationRequestAdmission> {
  // static-import-exception: load the server-only identity adapter only at request admission so the profile declaration remains browser-safe and serializable.
  const runtime = await import('@applik8s/start-agentic/identity-runtime');
  return runtime.authenticateAgenticProfileRequest(request, 'external');
}

async function handleAgenticExternalIdentityRequest(
  request: Request,
): Promise<Response> {
  // static-import-exception: the provider-neutral identity HTTP boundary is server-only.
  const runtime = await import('@applik8s/start-agentic/identity-runtime');
  return runtime.handleAgenticProfileIdentityRequest(request, 'external');
}

async function readyAgenticDedicatedIdentity(): Promise<void> {
  // static-import-exception: provider readiness executes only in the server deployment host and must not pull identity clients into the shared profile module.
  const runtime = await import('@applik8s/start-agentic/identity-runtime');
  await runtime.readyAgenticProfileIdentity('dedicated');
}

async function readyAgenticExternalIdentity(): Promise<void> {
  // static-import-exception: provider readiness executes only in the server deployment host and must not pull identity clients into the shared profile module.
  const runtime = await import('@applik8s/start-agentic/identity-runtime');
  await runtime.readyAgenticProfileIdentity('external');
}

function preserveAgenticIdentityCallbackSource<
  TArgs extends readonly unknown[],
  TResult,
>(
  callback: (...args: TArgs) => TResult,
  source: string,
): void {
  Object.defineProperty(
    callback,
    Symbol.for('applik8s.applicationCallbackSource'),
    {
      configurable: false,
      value: Object.freeze({
        file: import.meta.url,
        line: 1,
        column: 1,
        source,
        generated: true,
      }),
    },
  );
}

// Maintained profile callbacks cross a publish/bundle boundary before the
// application compiler serializes them. Preserve their authored, closure-free
// dynamic-import source instead of relying on bundler-generated helper names.
preserveAgenticIdentityCallbackSource(
  authenticateAgenticDedicatedRequest,
  `async request => (await import('@applik8s/start-agentic/identity-runtime')).authenticateAgenticProfileRequest(request, 'dedicated')`,
);
preserveAgenticIdentityCallbackSource(
  handleAgenticDedicatedIdentityRequest,
  `async request => (await import('@applik8s/start-agentic/identity-runtime')).handleAgenticProfileIdentityRequest(request, 'dedicated')`,
);
preserveAgenticIdentityCallbackSource(
  authenticateAgenticStarterRequest,
  `async request => (await import('@applik8s/start-agentic/identity-runtime')).authenticateAgenticStarterRequest(request)`,
);
preserveAgenticIdentityCallbackSource(
  handleAgenticStarterIdentityRequest,
  `async request => (await import('@applik8s/start-agentic/identity-runtime')).handleAgenticStarterIdentityRequest(request)`,
);
preserveAgenticIdentityCallbackSource(
  authenticateAgenticExternalRequest,
  `async request => (await import('@applik8s/start-agentic/identity-runtime')).authenticateAgenticProfileRequest(request, 'external')`,
);
preserveAgenticIdentityCallbackSource(
  handleAgenticExternalIdentityRequest,
  `async request => (await import('@applik8s/start-agentic/identity-runtime')).handleAgenticProfileIdentityRequest(request, 'external')`,
);
preserveAgenticIdentityCallbackSource(
  readyAgenticDedicatedIdentity,
  `async () => (await import('@applik8s/start-agentic/identity-runtime')).readyAgenticProfileIdentity('dedicated')`,
);
preserveAgenticIdentityCallbackSource(
  readyAgenticExternalIdentity,
  `async () => (await import('@applik8s/start-agentic/identity-runtime')).readyAgenticProfileIdentity('external')`,
);
