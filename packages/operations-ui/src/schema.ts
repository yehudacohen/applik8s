import {
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

/**
 * Normalized operational observations retain their authority classification
 * and source evidence. This is intentionally not a generic health bit:
 * canonical, delivery, provider, and inferred observations remain distinct.
 */
export const applicationOperationalObservations = pgTable(
  'applik8s_operational_observations',
  {
    application: text('application').notNull(),
    id: text('id').notNull(),
    domain: text('domain', {
      enum: [
        'installation',
        'provider',
        'workflow',
        'eventConsumer',
        'projection',
        'ai',
        'mcp',
        'authority',
        'identity',
        'objectStore',
        'database',
        'gateway',
      ],
    }).notNull(),
    subject: text('subject').notNull(),
    authority: text('authority', {
      enum: ['canonical', 'delivery', 'provider', 'inferred'],
    }).notNull(),
    state: text('state', {
      enum: [
        'pending',
        'running',
        'waiting',
        'ready',
        'succeeded',
        'failed',
        'cancelled',
        'degraded',
        'unknown',
      ],
    }).notNull(),
    reason: text('reason'),
    source: text('source').notNull(),
    causalId: text('causal_id'),
    evidence: jsonb('evidence').notNull(),
    observedAt: timestamp('observed_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull(),
    expiresAt: timestamp('expires_at', {
      withTimezone: true,
      mode: 'string',
    }),
  },
  (table) => [
    primaryKey({
      name: 'applik8s_operational_observations_application_id_pk',
      columns: [table.application, table.id],
    }),
    index('applik8s_operational_observations_domain_state_idx').on(
      table.application,
      table.domain,
      table.state,
      table.observedAt,
    ),
    index('applik8s_operational_observations_subject_idx').on(
      table.application,
      table.subject,
      table.observedAt,
    ),
  ],
);

/** Canonical authority audit log written by the operation-authority service. */
export const applicationAuthorityAudit = pgTable(
  'applik8s_authority_audit',
  {
    application: text('application').notNull(),
    id: text('id').notNull(),
    document: jsonb('document').notNull(),
    occurredAt: timestamp('occurred_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull(),
  },
  (table) => [
    primaryKey({
      name: 'applik8s_authority_audit_application_id_pk',
      columns: [table.application, table.id],
    }),
    index('applik8s_authority_audit_occurred_at_idx').on(
      table.application,
      table.occurredAt,
    ),
  ],
);

export const applicationOperationsSchema = Object.freeze({
  applicationOperationalObservations,
  applicationAuthorityAudit,
});
