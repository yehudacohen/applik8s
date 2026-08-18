import type { ApplicationRelationalModel } from '@applik8s/applik8s';
import {
  authenticatedPrincipalId,
  field,
  model,
  pgEnum,
} from '@applik8s/applik8s/drizzle';

export const applicationDataLifecycleState = pgEnum('data_lifecycle_state', [
  'queued',
  'running',
  'actionRequired',
  'completed',
  'failed',
]);

export interface ApplicationDataLifecycleProgress {
  /** Completed work units in the application-defined lifecycle plan. */
  readonly completed: number;
  /** Optional bounded total when the application can determine it. */
  readonly total?: number;
  /** Application-facing unit label such as records, objects, or resources. */
  readonly unit?: string;
  /** Typed application policy is serialized here without entering this package. */
  readonly details: Readonly<Record<string, unknown>>;
}

const dataLifecycleRequestTable = model('data_lifecycle_requests', {
  id: field.uuid('id').defaultRandom().primaryKey(),
  scope: field.text('scope').notNull(),
  targetId: field.text('target_id').notNull(),
  requestedByPrincipalId: field.text('requested_by_principal_id')
    .notNull()
    .default(authenticatedPrincipalId),
  principalScope: field.text('principal_scope').notNull().default('pending'),
  state: applicationDataLifecycleState('state').notNull().default('queued'),
  progress: field.jsonb('progress')
    .$type<ApplicationDataLifecycleProgress>()
    .notNull()
    .default({ completed: 0, details: {} }),
  consequence: field.text('consequence'),
  requestedAt: field.timestamp('requested_at', {
    withTimezone: true,
    mode: 'string',
  }).notNull().defaultNow(),
  startedAt: field.timestamp('started_at', {
    withTimezone: true,
    mode: 'string',
  }),
  completedAt: field.timestamp('completed_at', {
    withTimezone: true,
    mode: 'string',
  }),
}, () => [], { name: 'DataLifecycleRequest', revision: false });

export const applicationDataLifecycleRequests: ApplicationRelationalModel<typeof dataLifecycleRequestTable> = dataLifecycleRequestTable;
export const applicationDataLifecycleSchema = Object.freeze({
  applicationDataLifecycleRequests,
});
