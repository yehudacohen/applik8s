import type {
  ApplicationDatabaseBinding,
  ApplicationModelViewOptions,
  ApplicationQueryPrincipal,
  ApplicationQuerySourceBinding,
  KubernetesApplicationBuilder,
} from '@applik8s/applik8s';
import type { ApplicationQueryOperation } from '@applik8s/client';
import { type } from 'arktype';
import type { AnyPgTable } from 'drizzle-orm/pg-core';

export const applicationOperationsSnapshotInput = type({
  'limit?': '1 <= number.integer <= 100',
});

/**
 * The control center intentionally preserves source records instead of
 * flattening distinct product, delivery, provider, and authority states into
 * one misleading "healthy" bit.
 */
export const applicationOperationsSnapshot = type({
  conversations: 'unknown[]',
  runs: 'unknown[]',
  approvals: 'unknown[]',
  artifacts: 'unknown[]',
  evaluations: 'unknown[]',
  usage: 'unknown[]',
});

export type ApplicationOperationsSnapshot =
  typeof applicationOperationsSnapshot.infer;

export interface ApplicationOperationsConversationModel extends AnyPgTable {
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

export interface ApplicationOperationsModels {
  readonly Conversation: ApplicationOperationsConversationModel;
  readonly ProtocolRun: AnyPgTable;
  readonly ApprovalReview: AnyPgTable;
  readonly Artifact: AnyPgTable;
  readonly EvaluationRun: AnyPgTable;
  readonly UsageFact: AnyPgTable;
}

export interface ApplicationOperationsModuleOptions {
  readonly database: ApplicationDatabaseBinding;
  readonly models: ApplicationOperationsModels;
}

export interface ApplicationOperationsModule {
  readonly snapshot: ApplicationQueryOperation<
    typeof applicationOperationsSnapshotInput.infer,
    ApplicationOperationsSnapshot
  >;
}

/**
 * Adds the maintained control-center read model to the ordinary application
 * graph. It uses the canonical query gateway, application principal, declared
 * model reads, and bounded database authority; it is not a privileged admin
 * endpoint.
 */
export function operationsControlCenter(
  _application: Pick<KubernetesApplicationBuilder, 'query'>,
  options: ApplicationOperationsModuleOptions,
): ApplicationOperationsModule {
  const database = options.database;
  const {
    Conversation,
    ProtocolRun,
    ApprovalReview,
    Artifact,
    EvaluationRun,
    UsageFact,
  } = options.models;
  const conversation = options.models.Conversation.view('operationsSnapshot', {
    input: applicationOperationsSnapshotInput,
    output: applicationOperationsSnapshot,
    database: options.database,
    reads: [
      options.models.ProtocolRun,
      options.models.ApprovalReview,
      options.models.Artifact,
      options.models.EvaluationRun,
      options.models.UsageFact,
    ],
    budgets: {
      timeoutMs: 3_000,
      maxRows: 600,
      maxResultBytes: 512 * 1_024,
    },
    authorize: ({ principal }) => principal.id.length > 0,
    run: async ({ context, input }) => {
      const limit = input.limit ?? 25;
      const client = context.database(database);
      const [
        conversations,
        runs,
        approvals,
        artifacts,
        evaluations,
        usage,
      ] = await Promise.all([
        client.select().from(Conversation).limit(limit),
        client.select().from(ProtocolRun).limit(limit),
        client.select().from(ApprovalReview).limit(limit),
        client.select().from(Artifact).limit(limit),
        client.select().from(EvaluationRun).limit(limit),
        client.select().from(UsageFact).limit(limit),
      ]);
      return {
        conversations,
        runs,
        approvals,
        artifacts,
        evaluations,
        usage,
      };
    },
  });
  return Object.freeze({ snapshot: conversation.operationsSnapshot });
}

export const applicationOperationsRouteContribution = Object.freeze({
  id: 'operations',
  path: '/operations',
  authority: 'application-operation',
  operation: 'Conversation.operationsSnapshot',
} as const);
