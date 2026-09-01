// typecast-file-boundary: Maintained profile inputs are validated before provider-specific option records are assembled.
import {
  AI,
  AIBackend,
  type ApplicationAIDeterministicProvider,
  type ApplicationAIProvider,
} from '@applik8s/ai';
import {
  AnalyticalDatabase,
  Analytics,
  ApplicationHost,
  ActorRuntime,
  type ApplicationIdentityInfrastructure,
  type ApplicationIdentityProvider,
  type ApplicationProviderBinding,
  type ApplicationTransactionalDatabaseProvider,
  applicationValueDefault,
  Database,
  defineApplicationCapabilityImplementation,
  EventLog,
  IdentityProvider,
  type KubernetesApplicationBuilder,
  type KubernetesApplicationScope,
  Lakehouse,
  LakehouseDataset,
  LakehouseQuery,
  module,
  ObjectStorage,
  Observability,
  postgres,
  Search,
  Scheduler,
  TransactionalDatabase,
  trustedContext,
  WorkflowEngine,
} from '@applik8s/applik8s';
import {
  type ApplicationPaymentProvider,
  LocalPayments,
  PaymentProvider,
} from '@applik8s/billing';
import { StripePayments } from '@applik8s/billing-stripe';
import {
  canonicalJsonCompatibleV1Policy,
  canonicalJsonV1Value,
  type JsonValue,
} from '@applik8s/core';
import {
  type ApplicationNotificationDeliveryProvider,
  LocalNotificationDelivery,
  NotificationDelivery,
} from '@applik8s/notifications';
import { SmtpNotificationDelivery } from '@applik8s/notifications-smtp';
import {
  type ApplicationResearchEvidenceProvider,
  LocalResearchEvidence,
  PostgresResearchEvidence,
  ResearchEvidence,
} from '@applik8s/research';
import {
  type ApplicationSourceRetrieverProvider,
  type ApplicationWebSearchProvider,
  LocalSourceRetriever,
  LocalWebSearch,
  SourceRetriever,
  WebSearch,
} from '@applik8s/web-search';
import { BoundedHttpSourceRetriever } from '@applik8s/web-retrieval-http';
import { SearxngWebSearch } from '@applik8s/web-search-searxng';
import { type } from 'arktype';

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
  /** Secret data key containing the provider credential; defaults to `apiKey`. */
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

export interface AgenticManagedWebSearch {
  readonly secretName: string;
  readonly secretKey?: string;
  readonly name?: string;
  readonly namespace?: string;
  readonly replicas?: number;
  readonly redisUrl?: string;
}

export interface AgenticExternalWebSearch {
  readonly endpoint: string;
  readonly allowInsecureHttp?: boolean;
}

export interface AgenticDeveloperProviders {
  readonly inference: AgenticDedicatedInference;
  /**
   * Optional live payment adapter. Applications that do not consume billing
   * remain credential-free; omitted payments use the simulated provider.
   */
  readonly payments?: AgenticManagedStripePayments;
  readonly notifications?: AgenticManagedSmtpNotifications;
  /** Kubernetes live retrieval; non-Kubernetes developer targets stay deterministic. */
  readonly webSearch?: AgenticManagedWebSearch;
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
  readonly webSearch: AgenticExternalWebSearch;
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
        readonly webSearch?: AgenticManagedWebSearch;
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
  /**
   * Provider-neutral external-profile inference adapter. The application may
   * place a managed gateway in front of an externally hosted model without
   * exposing the upstream credential to generated task workers.
   */
  readonly externalInference?: (
    spec: Extract<AgenticInstallationSpec, { readonly profile: 'external' }>,
    context: AgenticProfileContext,
  ) => ApplicationAIProvider;
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
  readonly developerWebSearch?: (
    spec: Extract<AgenticInstallationSpec, { readonly profile: 'developer' }>,
  ) => ApplicationWebSearchProvider;
  readonly dedicatedWebSearch?: (
    spec: Extract<AgenticInstallationSpec, { readonly profile: 'dedicated' }>,
  ) => ApplicationWebSearchProvider;
  readonly externalWebSearch?: (
    spec: Extract<AgenticInstallationSpec, { readonly profile: 'external' }>,
  ) => ApplicationWebSearchProvider;
  readonly developerSourceRetriever?: (
    spec: Extract<AgenticInstallationSpec, { readonly profile: 'developer' }>,
  ) => ApplicationSourceRetrieverProvider;
  readonly dedicatedSourceRetriever?: (
    spec: Extract<AgenticInstallationSpec, { readonly profile: 'dedicated' }>,
  ) => ApplicationSourceRetrieverProvider;
  readonly externalSourceRetriever?: (
    spec: Extract<AgenticInstallationSpec, { readonly profile: 'external' }>,
  ) => ApplicationSourceRetrieverProvider;
  readonly developerResearchEvidence?: (
    spec: Extract<AgenticInstallationSpec, { readonly profile: 'developer' }>,
  ) => ApplicationResearchEvidenceProvider;
  readonly dedicatedResearchEvidence?: (
    spec: Extract<AgenticInstallationSpec, { readonly profile: 'dedicated' }>,
  ) => ApplicationResearchEvidenceProvider;
  readonly externalResearchEvidence?: (
    spec: Extract<AgenticInstallationSpec, { readonly profile: 'external' }>,
  ) => ApplicationResearchEvidenceProvider;
}

export type AgenticProfilesOptions = Pick<
  ConfigureAgenticProfilesOptions,
  | 'starterInference'
  | 'externalInference'
  | 'dedicatedIdentity'
  | 'externalIdentity'
  | 'developerPayments'
  | 'dedicatedPayments'
  | 'externalPayments'
  | 'developerNotifications'
  | 'dedicatedNotifications'
  | 'externalNotifications'
  | 'developerWebSearch'
  | 'dedicatedWebSearch'
  | 'externalWebSearch'
  | 'developerSourceRetriever'
  | 'dedicatedSourceRetriever'
  | 'externalSourceRetriever'
  | 'developerResearchEvidence'
  | 'dedicatedResearchEvidence'
  | 'externalResearchEvidence'
>;

type DatabaseBinding =
  ApplicationProviderBinding<ApplicationTransactionalDatabaseProvider>;

export type AgenticProfileName =
  | 'starter'
  | 'developer'
  | 'dedicated'
  | 'external';

/** Stable qualifications consumed by maintained research specializations. */
export const AgenticResearch = Object.freeze({
  search: WebSearch.named('research'),
  retrieve: SourceRetriever.named('research'),
  evidence: ResearchEvidence.named('research'),
});

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

const starterResearchUrl = 'https://docs.applik8s.dev/research/starter-evidence';
const starterResearchText = [
  'Maintained research agents separate web discovery, bounded source retrieval,',
  'durable evidence, and application-owned publication. Retrieved text is',
  'untrusted data and completed deliverables cite committed evidence.',
].join(' ');
const starterResearchDigest =
  'sha256:e8419574064727e90ee29c44a127ecc797908f3dec6789ee4482c48843cc8eb7' as const;

/** Credential-free constructors backed by the same production-shaped contracts. */
export const AgenticStarter = Object.freeze({
  database(context: AgenticProfileContext) {
    return Database.postgres({
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
    return EventLog.jetStream({
      name: `${context.application}-events`,
      namespace: context.namespace,
      provision: true,
      replicas: 1,
      storageSize: '2Gi',
      servers: [
        `nats://${context.application}-events.${context.namespace}.svc:4222`,
      ],
    });
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
        structuredResponse: {
          body: 'Primary-source evidence supports a bounded, observable rollout with an explicit owner, acceptance criteria, and rollback decision.',
        },
        tool: {
          index: 0,
          required: false,
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
  webSearch() {
    return LocalWebSearch.deterministic({
      responsesByQuery: {
        'Applik8s Agentic Start': [{
          title: 'Maintained research-agent evidence fixture',
          url: starterResearchUrl,
          snippet: starterResearchText,
          source: 'Applik8s Starter',
          score: 1,
        }],
      },
    });
  },
  sourceRetriever() {
    return LocalSourceRetriever.deterministic({
      sources: [{
        requestedUrl: starterResearchUrl,
        canonicalUrl: starterResearchUrl,
        mediaType: 'text/plain',
        title: 'Maintained research-agent evidence fixture',
        text: starterResearchText,
        contentDigest: starterResearchDigest,
        sizeBytes: new TextEncoder().encode(starterResearchText).byteLength,
        retrievedAt: new Date(0).toISOString(),
        provider: 'agentic-starter',
        receipt: {
          retrievalId: 'starter-research-source',
          idempotencyKey: 'starter-research-source',
          redirects: [],
          networkPolicy: 'deterministic-fixture',
          contentPolicy: 'text-only',
        },
      }],
      provider: 'agentic-starter',
    });
  },
  researchEvidence() {
    return LocalResearchEvidence.deterministic({
      storeIdentity: 'agentic-starter-research',
    });
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
  webSearch(spec: AgenticManagedWebSearch, context: AgenticProfileContext) {
    return agenticManagedWebSearch(spec, context);
  },
});

/** Reviewed application-owned dedicated topology constructors. */
export const AgenticDedicated = Object.freeze({
  database(context: AgenticProfileContext) {
    return Database.postgres({
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
              capabilities: ['chat', 'tools', 'streaming', 'text-input', 'text-output'],
            }),
          ],
        },
        'interactive-assistant': {
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
              capabilities: ['chat', 'tools', 'streaming', 'text-input', 'text-output'],
            }),
          ],
        },
        'research-specialist': {
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
              capabilities: ['chat', 'tools', 'streaming', 'text-input', 'text-output'],
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
  webSearch(spec: AgenticManagedWebSearch, context: AgenticProfileContext) {
    return agenticManagedWebSearch(spec, context);
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
              capabilities: ['chat', 'tools', 'streaming', 'text-input', 'text-output'],
            }),
          ],
        },
        'interactive-assistant': {
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
              capabilities: ['chat', 'tools', 'streaming', 'text-input', 'text-output'],
            }),
          ],
        },
        'research-specialist': {
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
              capabilities: ['chat', 'tools', 'streaming', 'text-input', 'text-output'],
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
  webSearch(spec: AgenticExternalWebSearch) {
    return SearxngWebSearch.external(spec);
  },
});

function agenticManagedWebSearch(
  spec: AgenticManagedWebSearch | undefined,
  context: AgenticProfileContext,
): ReturnType<typeof SearxngWebSearch.managed> {
  if (!spec) {
    throw new Error(
      'Kubernetes Agentic Start profiles require providers.webSearch with a reference to an existing SearXNG secret.',
    );
  }
  const name = applicationValueDefault(
    spec.name,
    `${context.application}-web-search`,
  );
  return SearxngWebSearch.managed({
    name,
    namespace: applicationValueDefault(
      spec.namespace,
      `${context.application}-web-search-system`,
    ),
    secretKeyRef: {
      name: spec.secretName,
      key: applicationValueDefault(spec.secretKey, 'secret_key'),
    },
    ...(spec.replicas !== undefined ? { replicas: spec.replicas } : {}),
    ...(spec.redisUrl ? { redisUrl: spec.redisUrl } : {}),
  });
}

function agenticManagedResearchEvidence(
  context: AgenticProfileContext,
): ApplicationResearchEvidenceProvider {
  return PostgresResearchEvidence.create({
    connectionEnvName: 'APPLIK8S_RESEARCH_DATABASE_URL',
    schema: 'applik8s_research',
    storeIdentity: `postgres:${context.application}:research`,
    connectionSecret: {
      name: `${context.application}-db-app`,
      namespace: context.namespace,
      key: 'uri',
    },
  });
}

function agenticExternalResearchEvidence(
  spec: Extract<AgenticInstallationSpec, { readonly profile: 'external' }>,
  context: AgenticProfileContext,
): ApplicationResearchEvidenceProvider {
  return PostgresResearchEvidence.create({
    connectionEnvName: 'APPLIK8S_RESEARCH_DATABASE_URL',
    schema: 'applik8s_research',
    storeIdentity: `postgres:${context.application}:research`,
    connectionSecret: {
      name: spec.providers.database.connectionSecretName,
      namespace: context.namespace,
      key: applicationValueDefault(
        spec.providers.database.connectionSecretKey,
        'uri',
      ),
    },
  });
}

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
  const ResearchWeb = AgenticResearch.search;
  const ResearchSources = AgenticResearch.retrieve;
  const ResearchRecords = AgenticResearch.evidence;
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
  // Kubernetes deliberately has no implicit lakehouse branch. The v0.8 target
  // contract requires an individually qualified external engine; selecting an
  // AWS-shaped provider without endpoint and credential authority would only
  // defer an unsupported topology into runtime failures.
  const observability = application
    .provide(ApplicationObservability)
    .local(() => Observability.local())
    .awsLocal(() => Observability.cloudWatch({ region: 'us-east-1' }))
    .aws(() => Observability.cloudWatch({ region: 'us-east-1' }))
    .kubernetes(() => Observability.clickStack({
      // ClickStack's API key is consumed by the application workloads as a
      // kubelet Secret projection. Kubernetes cannot mount a Secret across
      // namespaces, so the maintained starter deliberately co-locates this
      // application-owned provider with those workloads. Applications that
      // isolate observability must supply an explicit Secret replication
      // authority instead of receiving a silently broken deployment.
      namespace,
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
    .kubernetes(() => Lakehouse.datasetProviderRequired({
      reason: 'Kubernetes historical usage requires an individually qualified external lakehouse provider.',
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
    .kubernetes(() => Lakehouse.queryProviderRequired({
      reason: 'Kubernetes historical queries require an individually qualified external lakehouse provider.',
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
      options.externalInference?.(spec, profileContext)
        ?? AgenticExternal.inference(spec.providers.inference, profileContext),
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

  deployment
    .provide(ResearchWeb)
    .starter(() => AgenticStarter.webSearch())
    .developer((spec) =>
      options.developerWebSearch?.(spec)
        ?? application.selectTarget({
          local: () => AgenticStarter.webSearch(),
          awsLocal: () => AgenticStarter.webSearch(),
          aws: () => AgenticStarter.webSearch(),
          kubernetes: () => agenticManagedWebSearch(spec.providers.webSearch, profileContext),
        }),
    )
    .dedicated((spec) =>
      options.dedicatedWebSearch?.(spec)
        ?? application.selectTarget({
          local: () => AgenticStarter.webSearch(),
          awsLocal: () => AgenticStarter.webSearch(),
          aws: () => AgenticStarter.webSearch(),
          kubernetes: () => agenticManagedWebSearch(spec.providers.webSearch, profileContext),
        }),
    )
    .external((spec) =>
      options.externalWebSearch?.(spec)
        ?? AgenticExternal.webSearch(spec.providers.webSearch),
    )
    .exhaustive();

  deployment
    .provide(ResearchSources)
    .starter(() => AgenticStarter.sourceRetriever())
    .developer((spec) =>
      options.developerSourceRetriever?.(spec)
        ?? application.selectTarget({
          local: () => AgenticStarter.sourceRetriever(),
          awsLocal: () => AgenticStarter.sourceRetriever(),
          aws: () => AgenticStarter.sourceRetriever(),
          kubernetes: () => BoundedHttpSourceRetriever.create(),
        }),
    )
    .dedicated((spec) =>
      options.dedicatedSourceRetriever?.(spec)
        ?? application.selectTarget({
          local: () => AgenticStarter.sourceRetriever(),
          awsLocal: () => AgenticStarter.sourceRetriever(),
          aws: () => AgenticStarter.sourceRetriever(),
          kubernetes: () => BoundedHttpSourceRetriever.create(),
        }),
    )
    .external((spec) =>
      options.externalSourceRetriever?.(spec)
        ?? BoundedHttpSourceRetriever.create(),
    )
    .exhaustive();

  deployment
    .provide(ResearchRecords)
    .starter(() => AgenticStarter.researchEvidence())
    .developer((spec) =>
      options.developerResearchEvidence?.(spec)
        ?? application.selectTarget({
          local: () => AgenticStarter.researchEvidence(),
          awsLocal: () => AgenticStarter.researchEvidence(),
          aws: () => AgenticStarter.researchEvidence(),
          kubernetes: () => agenticManagedResearchEvidence(profileContext),
        }),
    )
    .dedicated((spec) =>
      options.dedicatedResearchEvidence?.(spec)
        ?? application.selectTarget({
          local: () => AgenticStarter.researchEvidence(),
          awsLocal: () => AgenticStarter.researchEvidence(),
          aws: () => AgenticStarter.researchEvidence(),
          kubernetes: () => agenticManagedResearchEvidence(profileContext),
        }),
    )
    .external((spec) =>
      options.externalResearchEvidence?.(spec)
        ?? agenticExternalResearchEvidence(spec, profileContext),
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
  const webSearch = application.inject(ResearchWeb);
  const sourceRetriever = application.inject(ResearchSources);
  const researchEvidence = application.inject(ResearchRecords);
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
    webSearch,
    sourceRetriever,
    researchEvidence,
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
  const namespace = context.namespace;
  return StripePayments.fromSecret({
    ...(spec.endpoint ? { endpoint: spec.endpoint } : {}),
    secrets: {
      apiKey: {
        name: spec.secretName,
        namespace,
        key: applicationValueDefault(spec.apiKeyKey, 'apiKey'),
      },
      webhookSecret: {
        name: spec.secretName,
        namespace,
        key: applicationValueDefault(spec.webhookSecretKey, 'webhookSecret'),
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
      key: applicationValueDefault(spec.usernameKey, 'username'),
    },
    password: {
      name: spec.secretName,
      namespace: context.namespace,
      key: applicationValueDefault(spec.passwordKey, 'password'),
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
    const assemblyContext = {
      application: application.name,
      namespace: `${application.name}-system`,
    } as const;
    const developerDatabase = AgenticStarter.database(assemblyContext);
    const developerAnalytics = Analytics.postgres({
      database: developerDatabase,
      schema: 'agentic_analytics',
    });
    const developerEvents = AgenticStarter.events(assemblyContext);
    const developerObjects = AgenticStarter.objects(assemblyContext);
    const developerWorkflows = AgenticStarter.workflows(assemblyContext);
    const developerScheduler = Scheduler.hatchet();
    const developerSearch = Search.postgres({
      database: developerDatabase,
      schema: 'agentic_search',
      maximumCandidateRows: 10_000,
    });
    const starterInferenceValue = AgenticStarter.inference();
    const starterInference = defineApplicationCapabilityImplementation(
      AI,
      {
        provider: {
          package: '@applik8s/ai',
          export: 'AI.deterministic',
          version: '0.9.0-alpha.1',
        },
        runtimeAdapter: '@applik8s/runtime-ai',
        readiness: 'applik8s.ai.deterministic.readiness/v1alpha1',
        lifecycle: 'application',
        migration: 'applik8s.ai.deterministic.migration/v1alpha1',
        evidence: ['AI.deterministic.conformance'],
        maturity: 'stable',
        configuration: {
          kind: starterInferenceValue.kind,
          production: starterInferenceValue.production,
          ...(starterInferenceValue.fixture === undefined
            ? {}
            : {
                fixture: canonicalJsonV1Value(
                  starterInferenceValue.fixture,
                  canonicalJsonCompatibleV1Policy,
                ),
              }),
        },
        value: starterInferenceValue,
      },
    );
    const developerInference = defineApplicationCapabilityImplementation(
      AI,
      {
        provider: {
          package: '@applik8s/ai',
          export: 'AI.envoy',
          version: '0.9.0-alpha.1',
        },
        runtimeAdapter: '@applik8s/runtime-ai',
        deploymentContributor: '@applik8s/deployment-typekro/providers/envoy-ai-gateway',
        readiness: 'applik8s.ai.envoy-ai-gateway.readiness/v1alpha1',
        lifecycle: 'application',
        migration: 'applik8s.ai.envoy-ai-gateway.migration/v1alpha1',
        evidence: ['AI.envoy.conformance'],
        maturity: 'beta',
        value: AgenticDeveloper.inference(
          {
            endpoint: 'https://openrouter.ai/api/v1',
            model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
            credentialSecretName: `${assemblyContext.application}-inference`,
            credentialKey: 'apiKey',
          },
          assemblyContext,
        ),
      },
    );
    const developerIdentity = defineApplicationCapabilityImplementation(
      IdentityProvider,
      {
        provider: {
          package: '@applik8s/applik8s',
          export: 'IdentityProvider.from',
          version: '0.9.0-alpha.1',
        },
        runtimeAdapter: '@applik8s/start-agentic/identity-runtime',
        readiness: 'applik8s.identity.agentic-starter.readiness/v1alpha1',
        lifecycle: 'application',
        migration: 'applik8s.identity.agentic-starter.migration/v1alpha1',
        evidence: ['AgenticStarter.identity.conformance'],
        maturity: 'beta',
        configuration: { kind: 'identity-provider' },
        dependencies: [{
          slot: 'database',
          requirement: TransactionalDatabase,
          requiredGuarantees: ['transactions', 'strongReads'],
          operations: ['database.read', 'database.write'],
          input: developerDatabase,
        }],
        value: IdentityProvider.from(authenticateAgenticStarterRequest, {
          handle: handleAgenticStarterIdentityRequest,
        }),
      },
    );
    const developerPayments = defineApplicationCapabilityImplementation(
      PaymentProvider,
      {
        provider: {
          package: '@applik8s/billing',
          export: 'LocalPayments.simulated',
          version: '0.9.0-alpha.1',
        },
        runtimeAdapter: '@applik8s/billing/runtime',
        readiness: 'applik8s.billing.local.readiness/v1alpha1',
        lifecycle: 'application',
        migration: 'applik8s.billing.local.migration/v1alpha1',
        evidence: ['LocalPayments.simulated.conformance'],
        maturity: 'stable',
        configuration: {
          provider: 'local',
          kind: 'local-simulated',
          mode: 'simulated',
          capabilities: {
            checkout: true,
            portal: true,
            subscriptionChanges: true,
            scheduledChanges: true,
            meteredUsage: true,
          },
        },
        value: AgenticStarter.payments(),
      },
    );
    const developerNotifications = defineApplicationCapabilityImplementation(
      NotificationDelivery,
      {
        provider: {
          package: '@applik8s/notifications',
          export: 'LocalNotificationDelivery.inspectable',
          version: '0.9.0-alpha.1',
        },
        runtimeAdapter: '@applik8s/notifications/runtime',
        readiness: 'applik8s.notifications.local.readiness/v1alpha1',
        lifecycle: 'application',
        migration: 'applik8s.notifications.local.migration/v1alpha1',
        evidence: ['LocalNotificationDelivery.inspectable.conformance'],
        maturity: 'stable',
        configuration: {
          provider: 'local',
          kind: 'local-inspectable',
          mode: 'inspectable',
        },
        value: AgenticStarter.notifications(),
      },
    );
    const developerWebSearchValue = agenticManagedWebSearch(
      {
        secretName: `${assemblyContext.application}-web-search`,
        secretKey: 'secret_key',
      },
      assemblyContext,
    );
    const developerWebSearch = defineApplicationCapabilityImplementation(
      AgenticResearch.search,
      {
        provider: {
          package: '@applik8s/web-search-searxng',
          export: 'SearxngWebSearch.managed',
          version: '0.9.0-alpha.1',
        },
        runtimeAdapter: '@applik8s/web-search-searxng/runtime',
        deploymentContributor: '@applik8s/deployment-typekro/providers/searxng',
        readiness: 'applik8s.web-search.searxng.readiness/v1alpha1',
        lifecycle: 'application',
        migration: 'applik8s.web-search.searxng.migration/v1alpha1',
        evidence: ['SearxngWebSearch.managed.conformance'],
        maturity: 'beta',
        configuration: {
          provider: developerWebSearchValue.provider,
          kind: developerWebSearchValue.kind,
          mode: developerWebSearchValue.mode,
          deployment: {
            management: 'typekro',
            name: `${assemblyContext.application}-web-search`,
            namespace: `${assemblyContext.application}-web-search-system`,
            secretKeyRef: {
              name: `${assemblyContext.application}-web-search`,
              key: 'secret_key',
            },
          },
        },
        value: developerWebSearchValue,
      },
    );
    const starterWebSearchValue = AgenticStarter.webSearch();
    const starterWebSearch = defineApplicationCapabilityImplementation(
      AgenticResearch.search,
      {
        provider: {
          package: '@applik8s/web-search',
          export: 'LocalWebSearch.deterministic',
          version: '0.9.0-alpha.1',
        },
        runtimeAdapter: '@applik8s/web-search/runtime',
        readiness: 'applik8s.web-search.deterministic.readiness/v1alpha1',
        lifecycle: 'application',
        migration: 'applik8s.web-search.deterministic.migration/v1alpha1',
        evidence: ['LocalWebSearch.deterministic.conformance'],
        maturity: 'stable',
        configuration: {
          provider: starterWebSearchValue.provider,
          kind: starterWebSearchValue.kind,
          mode: starterWebSearchValue.mode,
        },
        value: starterWebSearchValue,
      },
    );
    const developerSourceRetrieverValue = BoundedHttpSourceRetriever.create();
    const developerSourceRetriever = defineApplicationCapabilityImplementation(
      AgenticResearch.retrieve,
      {
        provider: {
          package: '@applik8s/web-retrieval-http',
          export: 'BoundedHttpSourceRetriever.create',
          version: '0.9.0-alpha.1',
        },
        runtimeAdapter: '@applik8s/web-retrieval-http/runtime',
        readiness: 'applik8s.source-retriever.http.readiness/v1alpha1',
        lifecycle: 'application',
        migration: 'applik8s.source-retriever.http.migration/v1alpha1',
        evidence: ['BoundedHttpSourceRetriever.create.conformance'],
        maturity: 'beta',
        configuration: {
          provider: developerSourceRetrieverValue.provider,
          kind: developerSourceRetrieverValue.kind,
          mode: developerSourceRetrieverValue.mode,
          policy: developerSourceRetrieverValue.policy,
        },
        value: developerSourceRetrieverValue,
      },
    );
    const starterSourceRetrieverValue = AgenticStarter.sourceRetriever();
    const starterSourceRetriever = defineApplicationCapabilityImplementation(
      AgenticResearch.retrieve,
      {
        provider: {
          package: '@applik8s/web-search',
          export: 'LocalSourceRetriever.deterministic',
          version: '0.9.0-alpha.1',
        },
        runtimeAdapter: '@applik8s/web-search/source-runtime',
        readiness: 'applik8s.source-retriever.deterministic.readiness/v1alpha1',
        lifecycle: 'application',
        migration: 'applik8s.source-retriever.deterministic.migration/v1alpha1',
        evidence: ['LocalSourceRetriever.deterministic.conformance'],
        maturity: 'stable',
        configuration: {
          provider: starterSourceRetrieverValue.provider,
          kind: starterSourceRetrieverValue.kind,
          mode: starterSourceRetrieverValue.mode,
        },
        value: starterSourceRetrieverValue,
      },
    );
    const developerResearchEvidenceValue = PostgresResearchEvidence.create({
      connectionEnvName: 'APPLIK8S_RESEARCH_DATABASE_URL',
      schema: 'applik8s_research',
      storeIdentity: `postgres:${assemblyContext.application}:research`,
      connectionSecret: {
        name: `${assemblyContext.application}-db-app`,
        namespace: assemblyContext.namespace,
        key: 'uri',
      },
    });
    const developerResearchEvidence = defineApplicationCapabilityImplementation(
      AgenticResearch.evidence,
      {
        provider: {
          package: '@applik8s/research',
          export: 'PostgresResearchEvidence.create',
          version: '0.9.0-alpha.1',
        },
        runtimeAdapter: '@applik8s/research/postgres-runtime',
        readiness: 'applik8s.research-evidence.postgres.readiness/v1alpha1',
        lifecycle: 'application',
        migration: 'applik8s.research-evidence.postgres.migration/v1alpha1',
        evidence: ['PostgresResearchEvidence.create.conformance'],
        maturity: 'beta',
        configuration: {
          provider: developerResearchEvidenceValue.provider,
          kind: developerResearchEvidenceValue.kind,
          mode: developerResearchEvidenceValue.mode,
          storeIdentity: developerResearchEvidenceValue.storeIdentity,
          connectionEnvName: developerResearchEvidenceValue.connectionEnvName,
          schema: developerResearchEvidenceValue.schema,
          connectionSecret: {
            name: `${assemblyContext.application}-db-app`,
            namespace: assemblyContext.namespace,
            key: 'uri',
          },
        },
        dependencies: [{
          slot: 'database',
          requirement: TransactionalDatabase,
          requiredGuarantees: ['transactions', 'strongReads'],
          operations: ['database.read', 'database.write'],
          input: developerDatabase,
        }],
        value: developerResearchEvidenceValue,
      },
    );
    const starterResearchEvidenceValue = AgenticStarter.researchEvidence();
    const starterResearchEvidence = defineApplicationCapabilityImplementation(
      AgenticResearch.evidence,
      {
        provider: {
          package: '@applik8s/research',
          export: 'LocalResearchEvidence.deterministic',
          version: '0.9.0-alpha.1',
        },
        runtimeAdapter: '@applik8s/research/runtime',
        readiness: 'applik8s.research-evidence.deterministic.readiness/v1alpha1',
        lifecycle: 'application',
        migration: 'applik8s.research-evidence.deterministic.migration/v1alpha1',
        evidence: ['LocalResearchEvidence.deterministic.conformance'],
        maturity: 'stable',
        configuration: {
          provider: starterResearchEvidenceValue.provider,
          kind: starterResearchEvidenceValue.kind,
          mode: starterResearchEvidenceValue.mode,
          storeIdentity: starterResearchEvidenceValue.storeIdentity,
        },
        value: starterResearchEvidenceValue,
      },
    );
    const developerObservabilityValue = Observability.clickStack({
      namespace: assemblyContext.namespace,
      storageSize: '20Gi',
    });
    const developerObservability = defineApplicationCapabilityImplementation(
      Observability.named('primary'),
      {
        provider: {
          package: '@applik8s/applik8s',
          export: 'Observability.clickStack',
          version: '0.9.0-alpha.1',
        },
        runtimeAdapter: '@applik8s/runtime-otel',
        deploymentContributor: '@applik8s/deployment-typekro/providers/clickstack',
        readiness: 'applik8s.observability.clickstack.readiness/v1alpha1',
        lifecycle: 'application',
        migration: 'applik8s.observability.clickstack.migration/v1alpha1',
        evidence: ['Observability.clickStack.conformance'],
        maturity: 'beta',
        value: developerObservabilityValue,
      },
    );
    // The developer assembly runs on Kubernetes. DuckDB is intentionally a
    // process-local provider and cannot provide one shared snapshot authority
    // across the web host and publisher workload. Keep the product explicit:
    // history renders its typed unavailable-provider boundary until the user
    // supplies a qualified Kubernetes lakehouse.
    const developerHistoryDataset = Lakehouse.datasetProviderRequired({
      reason: 'The Kubernetes developer profile requires an individually qualified external lakehouse dataset.',
    });
    const developerHistoryQueries = Lakehouse.queryProviderRequired({
      reason: 'The Kubernetes developer profile requires an individually qualified external lakehouse query provider.',
    });
    const developerActorRuntime = ActorRuntime.celld({
      namespace: assemblyContext.namespace,
      stateStore: developerObjects,
      replicas: 1,
    });
    const developerHost = ApplicationHost.kubernetes({
      name: `${application.name}-app`,
      namespace: assemblyContext.namespace,
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
    });

    application.profile('starter', (profile) => {
      profile.defaults({ retention: 'retain', deletionApproval: 'required' });
      profile.qualify({ id: 'agentic-start-starter-kubernetes' });
      profile.provide(TransactionalDatabase.named('primary'), developerDatabase);
      profile.provide(TransactionalDatabase, developerDatabase);
      profile.provide(AnalyticalDatabase.named('primary'), developerAnalytics);
      profile.provide(AnalyticalDatabase, developerAnalytics);
      profile.provide(EventLog.named('primary'), developerEvents);
      profile.provide(EventLog, developerEvents);
      profile.provide(ObjectStorage.named('primary'), developerObjects);
      profile.provide(ObjectStorage, developerObjects);
      profile.provide(WorkflowEngine.named('primary'), developerWorkflows);
      profile.provide(WorkflowEngine, developerWorkflows);
      profile.provide(Scheduler, developerScheduler);
      profile.provide(Search.named('primary'), developerSearch);
      profile.provide(Search, developerSearch);
      profile.provide(AI.named('inference'), starterInference);
      profile.provide(AI, starterInference);
      profile.provide(IdentityProvider.named('primary'), developerIdentity);
      profile.provide(IdentityProvider, developerIdentity);
      profile.provide(PaymentProvider.named('primary'), developerPayments);
      profile.provide(NotificationDelivery.named('transactional'), developerNotifications);
      profile.provide(AgenticResearch.search, starterWebSearch);
      profile.provide(AgenticResearch.retrieve, starterSourceRetriever);
      profile.provide(AgenticResearch.evidence, starterResearchEvidence);
      profile.provide(Observability.named('primary'), developerObservability);
      profile.provide(LakehouseDataset.named('historical-usage'), developerHistoryDataset);
      profile.provide(LakehouseQuery.named('historical-usage'), developerHistoryQueries);
      profile.provide(ActorRuntime, developerActorRuntime);
      profile.provide(ApplicationHost, developerHost);
    });

    application.profile('developer', (profile) => {
      profile.defaults({ retention: 'retain', deletionApproval: 'required' });
      profile.qualify({ id: 'agentic-start-developer-kubernetes' });
      profile.provide(TransactionalDatabase.named('primary'), developerDatabase);
      profile.provide(TransactionalDatabase, developerDatabase);
      profile.provide(AnalyticalDatabase.named('primary'), developerAnalytics);
      profile.provide(AnalyticalDatabase, developerAnalytics);
      profile.provide(EventLog.named('primary'), developerEvents);
      profile.provide(EventLog, developerEvents);
      profile.provide(ObjectStorage.named('primary'), developerObjects);
      profile.provide(ObjectStorage, developerObjects);
      profile.provide(WorkflowEngine.named('primary'), developerWorkflows);
      profile.provide(WorkflowEngine, developerWorkflows);
      profile.provide(Scheduler, developerScheduler);
      profile.provide(Search.named('primary'), developerSearch);
      profile.provide(Search, developerSearch);
      profile.provide(AI.named('inference'), developerInference);
      profile.provide(AI, developerInference);
      profile.provide(IdentityProvider.named('primary'), developerIdentity);
      profile.provide(IdentityProvider, developerIdentity);
      profile.provide(PaymentProvider.named('primary'), developerPayments);
      profile.provide(NotificationDelivery.named('transactional'), developerNotifications);
      profile.provide(AgenticResearch.search, developerWebSearch);
      profile.provide(AgenticResearch.retrieve, developerSourceRetriever);
      profile.provide(AgenticResearch.evidence, developerResearchEvidence);
      profile.provide(Observability.named('primary'), developerObservability);
      profile.provide(LakehouseDataset.named('historical-usage'), developerHistoryDataset);
      profile.provide(LakehouseQuery.named('historical-usage'), developerHistoryQueries);
      profile.provide(ActorRuntime, developerActorRuntime);
      profile.provide(ApplicationHost, developerHost);
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
