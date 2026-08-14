// typecast-file-boundary: Operations UI adapters validate result discriminants before exposing typed presentation records.
import type {
  ApplicationDatabaseBinding,
  ApplicationModelViewContext,
  ApplicationModelViewSchemaContract,
  ApplicationModelViewOptions,
  ApplicationQueryPrincipal,
  ApplicationQuerySourceBinding,
  KubernetesApplicationBuilder,
} from '@applik8s/applik8s';
import {
  applicationGraphFor,
  defineApplicationModule,
} from '@applik8s/applik8s';
import { approvals } from '@applik8s/approvals';
import { artifacts } from '@applik8s/artifacts';
import { conversations } from '@applik8s/conversations';
import { evaluations } from '@applik8s/evals';
import { usage } from '@applik8s/usage';
import type {
  ApplicationGraph,
  ApplicationGraphNode,
  ApplicationProviderInterfaceKind,
} from '@applik8s/core';
import type { ApplicationQueryOperation } from '@applik8s/client';
import { type } from 'arktype';
import { eq } from 'drizzle-orm';
import type { AnyPgTable } from 'drizzle-orm/pg-core';
import {
  applicationAuthorityAudit,
  applicationOperationalObservations,
  applicationOperationsSchema,
} from './schema.js';
import {
  applicationOperationsMergeObservedAndInferredDomainRecords,
  applicationOperationsOverviewSnapshot,
  applicationOperationsRedactedAuditRecords,
  applicationOperationsRedactedRecords,
} from './redaction.js';
import type {
  ApplicationOperationsCategory,
  ApplicationOperationsPublicRecord,
} from './redaction.js';

export * from './schema.js';
export * from './redaction.js';

export const applicationOperationsSnapshotInput = type({
  'limit?': '1 <= number.integer <= 100',
  'auditSearch?': 'string',
});

export const applicationOperationsPublicRecord = type({
  category: 'string',
  id: 'string',
  'label?': 'string',
  'state?': 'string',
  'authority?': "'canonical' | 'delivery' | 'provider' | 'inferred'",
  'observedAt?': 'string',
});

const applicationOperationsPublicRecords =
  applicationOperationsPublicRecord.array();

/**
 * The browser receives a deliberately narrow presentation record. Raw model
 * rows can contain message content, evidence, credentials, grants, targets,
 * provider diagnostics, or other application data and never cross this
 * maintained query boundary merely because an operator can see the route.
 */
export const applicationOperationsSnapshot = type({
  conversations: applicationOperationsPublicRecords,
  messages: applicationOperationsPublicRecords,
  runs: applicationOperationsPublicRecords,
  runEvents: applicationOperationsPublicRecords,
  memory: applicationOperationsPublicRecords,
  approvals: applicationOperationsPublicRecords,
  outcomes: applicationOperationsPublicRecords,
  artifacts: applicationOperationsPublicRecords,
  evaluationDatasets: applicationOperationsPublicRecords,
  evaluationCases: applicationOperationsPublicRecords,
  evaluationScorers: applicationOperationsPublicRecords,
  evaluations: applicationOperationsPublicRecords,
  evaluationResults: applicationOperationsPublicRecords,
  usage: applicationOperationsPublicRecords,
  entitlements: applicationOperationsPublicRecords,
  installations: applicationOperationsPublicRecords,
  providers: applicationOperationsPublicRecords,
  workflows: applicationOperationsPublicRecords,
  eventConsumers: applicationOperationsPublicRecords,
  projections: applicationOperationsPublicRecords,
  ai: applicationOperationsPublicRecords,
  mcp: applicationOperationsPublicRecords,
  authority: applicationOperationsPublicRecords,
  identity: applicationOperationsPublicRecords,
  objectStores: applicationOperationsPublicRecords,
  databases: applicationOperationsPublicRecords,
  gateways: applicationOperationsPublicRecords,
  audit: applicationOperationsPublicRecords,
  goLive: applicationOperationsPublicRecords,
  operational: applicationOperationsPublicRecords,
});

export type ApplicationOperationsSnapshot =
  typeof applicationOperationsSnapshot.infer;

export interface ApplicationOperationsConversationModel extends AnyPgTable {
    view<
      TInputSchema extends import('arktype').Type,
      TOutputSchema extends import('arktype').Type,
      TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
      TSource extends ApplicationQuerySourceBinding | undefined = undefined,
    >(
      contract: ApplicationModelViewSchemaContract<
        TInputSchema,
        TOutputSchema,
        TPrincipal,
        TSource
      >,
      implementation: (
        input: TInputSchema['infer'],
        context: ApplicationModelViewContext<TPrincipal, TSource>,
      ) => unknown | Promise<unknown>,
    ): ApplicationQueryOperation<TInputSchema['infer'], TOutputSchema['infer']>;
    view<
      const TName extends string,
      TInput extends object,
      TOutput extends object,
      TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
      TSource extends ApplicationQuerySourceBinding | undefined = undefined,
    >(
      name: TName,
      options: ApplicationModelViewOptions<TInput, TOutput, TPrincipal, TSource>,
    ): this & Readonly<Record<TName, ApplicationQueryOperation<TInput, TOutput>>>;
}

export interface ApplicationOperationsConversationsModule {
  readonly Conversation: ApplicationOperationsConversationModel;
  readonly Message: AnyPgTable;
  readonly ProtocolRun: AnyPgTable;
  readonly RunEvent: AnyPgTable;
  readonly Memory: AnyPgTable;
}

export interface ApplicationOperationsApprovalsModule {
  readonly ApprovalReview: AnyPgTable;
  readonly OutcomeObservation: AnyPgTable;
}

export interface ApplicationOperationsArtifactsModule {
  readonly Artifact: AnyPgTable;
}

export interface ApplicationOperationsEvaluationsModule {
  readonly Dataset: AnyPgTable;
  readonly Case: AnyPgTable;
  readonly Scorer: AnyPgTable;
  readonly EvaluationRun: AnyPgTable;
  readonly EvaluationResult: AnyPgTable;
}

export interface ApplicationOperationsUsageModule {
  readonly UsageFact: AnyPgTable;
  readonly Entitlement: AnyPgTable;
}

export interface ApplicationOperationsModuleOptions {
  readonly database: ApplicationDatabaseBinding;
  /** Provider-admitted role allowed to read the maintained control center. */
  readonly operatorRole?: string;
  readonly conversations: ApplicationOperationsConversationsModule;
  readonly approvals: ApplicationOperationsApprovalsModule;
  readonly artifacts: ApplicationOperationsArtifactsModule;
  readonly evaluations: ApplicationOperationsEvaluationsModule;
  readonly usage: ApplicationOperationsUsageModule;
}

export interface ApplicationOperationsModule {
  readonly snapshot: ApplicationOperationsSnapshotOperation;
  /**
   * Browser-safe model facade that owns the snapshot operation. Maintained
   * applications can export this one deliberate facade symbol from their
   * dual-runtime entrypoint without enumerating the module's internal models.
   */
  readonly Conversation: ApplicationOperationsConversationModel &
    Readonly<{
      operationsSnapshot: ApplicationOperationsSnapshotOperation;
    }>;
}

export type ApplicationOperationsSnapshotOperation = ApplicationQueryOperation<
  typeof applicationOperationsSnapshotInput.infer,
  ApplicationOperationsSnapshot
>;

export interface ApplicationOperationsOverviewModule {
  readonly snapshot: ApplicationOperationsSnapshotOperation;
}

/**
 * Builds the small product-start snapshot without implicitly installing every
 * maintained product domain. Full applications can opt into
 * `operationsControlCenter`; a new product gets provider, workflow, delivery,
 * authority, and graph visibility without inheriting conversations, billing,
 * approvals, evaluations, artifacts, or usage models.
 */
/**
 * Produces the framework-known half of the operations model directly from the
 * canonical application graph. These records deliberately remain
 * `authority: inferred` and `state: unknown`: graph presence proves intended
 * topology, never provider readiness. Canonical/provider observations from the
 * database are shown alongside them rather than being overwritten.
 */
export function applicationOperationsInferredRecords(
  graph: ApplicationGraph | undefined,
): readonly ApplicationOperationsPublicRecord[] {
  if (!graph) return [];
  return [
    ...graph.nodes.flatMap((node) => {
    if (node.kind === 'provider' && node.config?.qualification) return [];
    const domain = operationsDomainForNode(node);
    if (!domain) return [];
    return [Object.freeze({
      category: domain,
      id: `graph:${node.id}`,
      label: node.name,
      state: 'unknown',
      authority: 'inferred',
    } satisfies ApplicationOperationsPublicRecord)];
    }),
    ...applicationGoLiveObligations(graph),
  ];
}

/**
 * Public graph-derived production obligations. These records prove that an
 * obligation exists, not that it is satisfied; provider and receipt evidence
 * must independently move the relevant capability out of Unknown.
 */
export function applicationGoLiveObligations(
  graph: ApplicationGraph,
): readonly ApplicationOperationsPublicRecord[] {
  const has = (predicate: (node: ApplicationGraphNode) => boolean) =>
    graph.nodes.some(predicate);
  const modelNames = new Set(
    graph.nodes
      .filter((node) => node.kind === 'model')
      .map((node) => node.name.toLowerCase()),
  );
  const obligations: { readonly id: string; readonly label: string; readonly required: boolean }[] = [
    {
      id: 'observability',
      label: 'Operational evidence, alerting, and redacted causal diagnostics',
      required: true,
    },
    {
      id: 'rollback-destruction',
      label: 'Rollback, recovery, retained-resource policy, and graph-backed destruction',
      required: true,
    },
    {
      id: 'database-migrations',
      label: 'Database migrations and schema compatibility',
      required: has((node) => node.kind === 'model'),
    },
    {
      id: 'backup-restore',
      label: 'Backup, restore, and retained-data recovery',
      required: has((node) =>
        node.kind === 'provider'
        && (node.interface === 'TransactionalDatabase'
          || node.interface === 'AnalyticalDatabase')),
    },
    {
      id: 'dns-tls',
      label: 'Public exposure, DNS, TLS issuance, and renewal',
      required: has((node) =>
        node.kind === 'exposure'
        || (node.kind === 'provider'
          && (node.interface === 'Certificate'
            || node.interface === 'DnsPublication'))),
    },
    {
      id: 'notification-courier',
      label: 'Transactional notification courier, retries, and delivery visibility',
      required: [...modelNames].some((name) =>
        name.includes('notification') || name.includes('delivery')),
    },
    {
      id: 'billing-webhooks',
      label: 'Billing webhook authentication, replay safety, and provider reconciliation',
      required: [...modelNames].some((name) =>
        name.includes('billing') || name.includes('subscription') || name.includes('payment')),
    },
    {
      id: 'quotas-budgets',
      label: 'Usage quotas, entitlements, concurrency, and cost budgets',
      required: has((node) => node.kind === 'aiAgent')
        || [...modelNames].some((name) =>
          name.includes('usage') || name.includes('entitlement')),
    },
    {
      id: 'ai-trust',
      label: 'AI provider/data/tool authority, approval, budget, cancellation, and uncertain-completion quarantine',
      required: has((node) => node.kind === 'aiAgent'),
    },
  ];
  return obligations
    .filter((obligation) => obligation.required)
    .map((obligation) => Object.freeze({
      category: 'goLive' as const,
      id: `obligation:${obligation.id}`,
      label: obligation.label,
      state: 'unknown',
      authority: 'inferred' as const,
    }));
}

function operationsDomainForNode(
  node: ApplicationGraphNode,
): Exclude<ApplicationOperationsCategory, 'operational'> | undefined {
  switch (node.kind) {
    case 'installation':
      return 'installation';
    case 'workflow':
    case 'workflowHandler':
    case 'workflowWorker':
    case 'task':
    case 'taskHandler':
      return 'workflow';
    case 'stream':
    case 'streamProcessor':
    case 'subscription':
    case 'processor':
      return 'eventConsumer';
    case 'projection':
    case 'index':
    case 'aggregate':
      return 'projection';
    case 'aiAgent':
      return 'ai';
    case 'mcpServer':
    case 'mcpClient':
      return 'mcp';
    case 'permission':
    case 'authorityManifest':
      return 'authority';
    case 'objectStore':
      return 'objectStore';
    case 'gateway':
    case 'server':
    case 'exposure':
      return 'gateway';
    case 'provider':
      return operationsDomainForProvider(node.interface);
    default:
      return undefined;
  }
}

function operationsDomainForProvider(
  provider: ApplicationProviderInterfaceKind,
): Exclude<ApplicationOperationsCategory, 'operational'> {
  switch (provider) {
    case 'TransactionalDatabase':
    case 'AnalyticalDatabase':
      return 'database';
    case 'ObjectStorage':
      return 'objectStore';
    case 'IdentityProvider':
    case 'OAuthAuthorizationServer':
      return 'identity';
    case 'Authorization':
    case 'CredentialStore':
      return 'authority';
    case 'WorkflowEngine':
      return 'workflow';
    case 'Search':
    case 'IndexStore':
      return 'projection';
    case 'StructuredGeneration':
      return 'ai';
    case 'EventSource':
    case 'EventLog':
    case 'Queue':
      return 'eventConsumer';
    case 'HttpExposure':
    case 'Certificate':
    case 'DnsPublication':
      return 'gateway';
    default:
      return 'provider';
  }
}

/**
 * Adds the maintained control-center read model to the ordinary application
 * graph. It uses the canonical query gateway, application principal, declared
 * model reads, and bounded database authority; it is not a privileged admin
 * endpoint.
 */
function installOperationsControlCenter(
  application: Pick<KubernetesApplicationBuilder, 'model' | 'name' | 'role'>,
  options: ApplicationOperationsModuleOptions,
): ApplicationOperationsModule {
  const inferred = applicationOperationsInferredRecords(
    applicationGraphFor(application),
  );
  const inferredSource = JSON.stringify(inferred);
  const applicationName = application.name;
  const operatorRole = options.operatorRole ?? 'application-operator';
  const database = options.database;
  const {
    Conversation,
    Message,
    ProtocolRun,
    RunEvent,
    Memory,
  } = options.conversations;
  const { ApprovalReview, OutcomeObservation } = options.approvals;
  const { Artifact } = options.artifacts;
  const {
    Dataset: EvaluationDataset,
    Case: EvaluationCase,
    Scorer: EvaluationScorer,
    EvaluationRun,
    EvaluationResult,
  } = options.evaluations;
  const { UsageFact, Entitlement } = options.usage;
  const snapshot = Conversation.view({
    input: applicationOperationsSnapshotInput,
    output: applicationOperationsSnapshot,
    database: options.database,
    reads: [
      ProtocolRun,
      Message,
      RunEvent,
      Memory,
      ApprovalReview,
      OutcomeObservation,
      Artifact,
      EvaluationDataset,
      EvaluationCase,
      EvaluationScorer,
      EvaluationRun,
      EvaluationResult,
      UsageFact,
      Entitlement,
    ],
    budgets: {
      timeoutMs: 3_000,
      maxRows: 600,
      maxResultBytes: 512 * 1_024,
    },
    authorize: ({ principal }) =>
      principal.roles?.includes(operatorRole) === true,
    __generatedSources: {
      authorize: {
        source: `({ principal }) => principal.roles?.includes(${JSON.stringify(operatorRole)}) === true`,
      },
      run: {
        invocation: 'request',
        source: `async ({ context, input, database }) => {
  const limit = input.limit ?? 25;
  const inferred = ${inferredSource};
  const applicationName = ${JSON.stringify(applicationName)};
  const client = context.database(database);
  const [conversations, messages, runs, runEvents, memory, approvals, outcomes, artifacts, evaluationDatasets, evaluationCases, evaluationScorers, evaluations, evaluationResults, usage, entitlements, operational, audit] = await Promise.all([
    client.select().from(applicationConversations).limit(limit),
    client.select().from(applicationConversationMessages).limit(limit),
    client.select().from(applicationConversationRuns).limit(limit),
    client.select().from(applicationConversationRunEvents).limit(limit),
    client.select().from(applicationConversationMemory).limit(limit),
    client.select().from(applicationApprovalReviews).limit(limit),
    client.select().from(applicationOutcomeObservations).limit(limit),
    client.select().from(applicationArtifacts).limit(limit),
    client.select().from(applicationEvaluationDatasets).limit(limit),
    client.select().from(applicationEvaluationCases).limit(limit),
    client.select().from(applicationEvaluationScorers).limit(limit),
    client.select().from(applicationEvaluationRuns).limit(limit),
    client.select().from(applicationEvaluationResults).limit(limit),
    client.select().from(applicationUsageFacts).limit(limit),
    client.select().from(applicationEntitlements).limit(limit),
    client.select().from(applicationOperationalObservations).where(eq(applicationOperationalObservations.application, applicationName)).limit(limit),
    client.select().from(applicationAuthorityAudit).where(eq(applicationAuthorityAudit.application, applicationName)).limit(limit),
  ]);
  return {
    conversations: applicationOperationsRedactedRecords("conversation", conversations),
    messages: applicationOperationsRedactedRecords("message", messages),
    runs: applicationOperationsRedactedRecords("run", runs),
    runEvents: applicationOperationsRedactedRecords("runEvent", runEvents),
    memory: applicationOperationsRedactedRecords("memory", memory),
    approvals: applicationOperationsRedactedRecords("approval", approvals),
    outcomes: applicationOperationsRedactedRecords("outcome", outcomes),
    artifacts: applicationOperationsRedactedRecords("artifact", artifacts),
    evaluationDatasets: applicationOperationsRedactedRecords("evaluationDataset", evaluationDatasets),
    evaluationCases: applicationOperationsRedactedRecords("evaluationCase", evaluationCases),
    evaluationScorers: applicationOperationsRedactedRecords("evaluationScorer", evaluationScorers),
    evaluations: applicationOperationsRedactedRecords("evaluation", evaluations),
    evaluationResults: applicationOperationsRedactedRecords("evaluationResult", evaluationResults),
    usage: applicationOperationsRedactedRecords("usage", usage),
    entitlements: applicationOperationsRedactedRecords("entitlement", entitlements),
    installations: applicationOperationsMergeObservedAndInferredDomainRecords("installation", "installation", operational, inferred),
    providers: applicationOperationsMergeObservedAndInferredDomainRecords("provider", "provider", operational, inferred),
    workflows: applicationOperationsMergeObservedAndInferredDomainRecords("workflow", "workflow", operational, inferred),
    eventConsumers: applicationOperationsMergeObservedAndInferredDomainRecords("eventConsumer", "eventConsumer", operational, inferred),
    projections: applicationOperationsMergeObservedAndInferredDomainRecords("projection", "projection", operational, inferred),
    ai: applicationOperationsMergeObservedAndInferredDomainRecords("ai", "ai", operational, inferred),
    mcp: applicationOperationsMergeObservedAndInferredDomainRecords("mcp", "mcp", operational, inferred),
    authority: applicationOperationsMergeObservedAndInferredDomainRecords("authority", "authority", operational, inferred),
    identity: applicationOperationsMergeObservedAndInferredDomainRecords("identity", "identity", operational, inferred),
    objectStores: applicationOperationsMergeObservedAndInferredDomainRecords("objectStore", "objectStore", operational, inferred),
    databases: applicationOperationsMergeObservedAndInferredDomainRecords("database", "database", operational, inferred),
    gateways: applicationOperationsMergeObservedAndInferredDomainRecords("gateway", "gateway", operational, inferred),
    audit: applicationOperationsRedactedAuditRecords(audit, input.auditSearch),
    goLive: inferred.filter(record => record.category === "goLive"),
    operational: applicationOperationsRedactedRecords("operational", operational),
  };
}`,
        dependencies: {
          source: `import { applicationApprovalReviews, applicationOutcomeObservations } from '@applik8s/approvals';
import { applicationArtifacts } from '@applik8s/artifacts';
import { applicationConversationMemory, applicationConversationMessages, applicationConversationRunEvents, applicationConversationRuns, applicationConversations } from '@applik8s/conversations';
import { applicationEvaluationCases, applicationEvaluationDatasets, applicationEvaluationResults, applicationEvaluationRuns, applicationEvaluationScorers } from '@applik8s/evals';
import { applicationAuthorityAudit, applicationOperationalObservations } from '@applik8s/operations-ui/schema';
import { applicationOperationsMergeObservedAndInferredDomainRecords, applicationOperationsRedactedAuditRecords, applicationOperationsRedactedRecords } from '@applik8s/operations-ui/redaction';
import { applicationEntitlements, applicationUsageFacts } from '@applik8s/usage';
import { eq } from 'drizzle-orm';`,
          resolveDir: process.cwd(),
        },
      },
    },
  }, async function operationsSnapshot(input, context) {
    const limit = input.limit ?? 25;
    const client = context.database(database);
    const [
      conversations,
      messages,
      runs,
      runEvents,
      memory,
      approvals,
      outcomes,
      artifacts,
      evaluationDatasets,
      evaluationCases,
      evaluationScorers,
      evaluations,
      evaluationResults,
      usage,
      entitlements,
      operational,
      audit,
    ] = await Promise.all([
      client.select().from(Conversation).limit(limit),
      client.select().from(Message).limit(limit),
      client.select().from(ProtocolRun).limit(limit),
      client.select().from(RunEvent).limit(limit),
      client.select().from(Memory).limit(limit),
      client.select().from(ApprovalReview).limit(limit),
      client.select().from(OutcomeObservation).limit(limit),
      client.select().from(Artifact).limit(limit),
      client.select().from(EvaluationDataset).limit(limit),
      client.select().from(EvaluationCase).limit(limit),
      client.select().from(EvaluationScorer).limit(limit),
      client.select().from(EvaluationRun).limit(limit),
      client.select().from(EvaluationResult).limit(limit),
      client.select().from(UsageFact).limit(limit),
      client.select().from(Entitlement).limit(limit),
      client
        .select()
        .from(applicationOperationalObservations)
        .where(eq(applicationOperationalObservations.application, applicationName))
        .limit(limit),
      client
        .select()
        .from(applicationAuthorityAudit)
        .where(eq(applicationAuthorityAudit.application, applicationName))
        .limit(limit),
    ]);
    return {
      conversations: applicationOperationsRedactedRecords('conversation', conversations),
      messages: applicationOperationsRedactedRecords('message', messages),
      runs: applicationOperationsRedactedRecords('run', runs),
      runEvents: applicationOperationsRedactedRecords('runEvent', runEvents),
      memory: applicationOperationsRedactedRecords('memory', memory),
      approvals: applicationOperationsRedactedRecords('approval', approvals),
      outcomes: applicationOperationsRedactedRecords('outcome', outcomes),
      artifacts: applicationOperationsRedactedRecords('artifact', artifacts),
      evaluationDatasets: applicationOperationsRedactedRecords('evaluationDataset', evaluationDatasets),
      evaluationCases: applicationOperationsRedactedRecords('evaluationCase', evaluationCases),
      evaluationScorers: applicationOperationsRedactedRecords('evaluationScorer', evaluationScorers),
      evaluations: applicationOperationsRedactedRecords('evaluation', evaluations),
      evaluationResults: applicationOperationsRedactedRecords('evaluationResult', evaluationResults),
      usage: applicationOperationsRedactedRecords('usage', usage),
      entitlements: applicationOperationsRedactedRecords('entitlement', entitlements),
      installations: applicationOperationsMergeObservedAndInferredDomainRecords('installation', 'installation', operational, inferred),
      providers: applicationOperationsMergeObservedAndInferredDomainRecords('provider', 'provider', operational, inferred),
      workflows: applicationOperationsMergeObservedAndInferredDomainRecords('workflow', 'workflow', operational, inferred),
      eventConsumers: applicationOperationsMergeObservedAndInferredDomainRecords('eventConsumer', 'eventConsumer', operational, inferred),
      projections: applicationOperationsMergeObservedAndInferredDomainRecords('projection', 'projection', operational, inferred),
      ai: applicationOperationsMergeObservedAndInferredDomainRecords('ai', 'ai', operational, inferred),
      mcp: applicationOperationsMergeObservedAndInferredDomainRecords('mcp', 'mcp', operational, inferred),
      authority: applicationOperationsMergeObservedAndInferredDomainRecords('authority', 'authority', operational, inferred),
      identity: applicationOperationsMergeObservedAndInferredDomainRecords('identity', 'identity', operational, inferred),
      objectStores: applicationOperationsMergeObservedAndInferredDomainRecords('objectStore', 'objectStore', operational, inferred),
      databases: applicationOperationsMergeObservedAndInferredDomainRecords('database', 'database', operational, inferred),
      gateways: applicationOperationsMergeObservedAndInferredDomainRecords('gateway', 'gateway', operational, inferred),
      audit: applicationOperationsRedactedAuditRecords(audit, input.auditSearch),
      goLive: inferred.filter((record) => record.category === 'goLive'),
      operational: applicationOperationsRedactedRecords('operational', operational),
    };
  });
  application.role(operatorRole).can(snapshot);
  return Object.freeze({
    snapshot,
    Conversation: Conversation as ApplicationOperationsModule['Conversation'],
  });
}

export const operationsControlCenter = defineApplicationModule(
  installOperationsControlCenter,
  {
    name: 'operationsControlCenter',
    schema: applicationOperationsSchema,
    install(application, context) {
      return installOperationsControlCenter(application, {
        database: context.database,
        conversations: context.include(conversations),
        approvals: context.include(approvals),
        artifacts: context.include(artifacts),
        evaluations: context.include(evaluations),
        usage: context.include(usage),
      });
    },
  },
);

function installOperationsOverview(
  application: Pick<
    KubernetesApplicationBuilder,
    'model' | 'name' | 'role'
  >,
  options: {
    readonly database: ApplicationDatabaseBinding;
    readonly operatorRole?: string;
  },
): ApplicationOperationsOverviewModule {
  const applicationName = application.name;
  const operatorRole = options.operatorRole ?? 'application-operator';
  const inferred = applicationOperationsInferredRecords(
    applicationGraphFor(application),
  );
  const inferredSource = JSON.stringify(inferred);
  const OperationalObservation = application.model(
    applicationOperationalObservations,
    {
      name: 'OperationalObservation',
      database: options.database,
      identity: ['id'],
      revision: false,
    },
  );
  const AuthorityAudit = application.model(applicationAuthorityAudit, {
    name: 'AuthorityAudit',
    database: options.database,
    identity: ['id'],
    revision: false,
  });
  const snapshot = (
    OperationalObservation as ApplicationOperationsConversationModel
  ).view(
    {
      input: applicationOperationsSnapshotInput,
      output: applicationOperationsSnapshot,
      database: options.database,
      reads: [
        OperationalObservation,
        AuthorityAudit,
      ],
      budgets: {
        timeoutMs: 3_000,
        maxRows: 200,
        maxResultBytes: 256 * 1_024,
      },
      authorize: ({ principal }) =>
        principal.roles?.includes(operatorRole) === true,
      __generatedSources: {
        authorize: {
          source: `({ principal }) => principal.roles?.includes(${JSON.stringify(operatorRole)}) === true`,
        },
        run: {
          invocation: 'request',
          source: `async ({ context, input, database }) => {
  const limit = input.limit ?? 25;
  const applicationName = ${JSON.stringify(applicationName)};
  const inferred = ${inferredSource};
  const client = context.database(database);
  const [operational, audit] = await Promise.all([
    client.select().from(applicationOperationalObservations).where(eq(applicationOperationalObservations.application, applicationName)).limit(limit),
    client.select().from(applicationAuthorityAudit).where(eq(applicationAuthorityAudit.application, applicationName)).limit(limit),
  ]);
  return applicationOperationsOverviewSnapshot(operational, audit, inferred, input.auditSearch);
}`,
          dependencies: {
            source: `import { applicationAuthorityAudit, applicationOperationalObservations } from '@applik8s/operations-ui/schema';
import { applicationOperationsOverviewSnapshot } from '@applik8s/operations-ui/redaction';
import { eq } from 'drizzle-orm';`,
            resolveDir: process.cwd(),
          },
        },
      },
    },
    async function operationsSnapshot(input, context) {
      const limit = input.limit ?? 25;
      const client = context.database(options.database);
      const [operational, audit] = await Promise.all([
        client
          .select()
          .from(applicationOperationalObservations)
          .where(
            eq(
              applicationOperationalObservations.application,
              applicationName,
            ),
          )
          .limit(limit),
        client
          .select()
          .from(applicationAuthorityAudit)
          .where(eq(applicationAuthorityAudit.application, applicationName))
          .limit(limit),
      ]);
      return applicationOperationsOverviewSnapshot(
        operational,
        audit,
        inferred,
        input.auditSearch,
      );
    },
  );
  application.role(operatorRole).can(snapshot);
  return Object.freeze({ snapshot });
}

/**
 * Lightweight operations visibility for a fresh product. It intentionally
 * does not make unrelated maintained product modules part of the application.
 */
export const operationsOverview = defineApplicationModule(
  installOperationsOverview,
  {
    name: 'operationsOverview',
    schema: applicationOperationsSchema,
    install(application, context) {
      return installOperationsOverview(application, {
        database: context.database,
      });
    },
  },
);

export const applicationOperationsRouteContribution = Object.freeze({
  id: 'operations',
  path: '/operations',
  authority: 'application-operation',
  operation: 'Conversation.operationsSnapshot',
} as const);
