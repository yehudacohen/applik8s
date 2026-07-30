import type {
  ApplicationDatabaseBinding,
  KubernetesApplicationBuilder,
} from '@applik8s/applik8s';
import { relations } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const applicationApprovalState = pgEnum('applik8s_approval_state', [
  'pending',
  'approved',
  'denied',
  'cancelled',
  'expired',
]);

export const applicationOutcomeObservationState = pgEnum(
  'applik8s_outcome_observation_state',
  ['pending', 'satisfied', 'failed', 'unprovable'],
);

export const applicationApprovalReviews = pgTable(
  'applik8s_approval_reviews',
  {
    id: text('id').primaryKey(),
    grantRequestId: text('grant_request_id').notNull(),
    principalScope: text('principal_scope').notNull(),
    requestedByIdentityId: text('requested_by_identity_id').notNull(),
    operationId: text('operation_id').notNull(),
    target: jsonb('target').notNull(),
    requestedScope: jsonb('requested_scope').notNull(),
    evidence: jsonb('evidence').notNull(),
    intendedOutcomeId: text('intended_outcome_id'),
    status: applicationApprovalState('status').notNull().default('pending'),
    reviewerIdentityId: text('reviewer_identity_id'),
    decisionReason: text('decision_reason'),
    authorityRevision: text('authority_revision').notNull(),
    createdAt: timestamp('created_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', {
      withTimezone: true,
      mode: 'string',
    }),
    expiresAt: timestamp('expires_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull(),
  },
  (table) => [
    uniqueIndex('applik8s_approval_reviews_request_uidx').on(
      table.grantRequestId,
    ),
    index('applik8s_approval_reviews_queue_idx').on(
      table.principalScope,
      table.status,
      table.createdAt,
    ),
  ],
);

export const applicationOutcomeObservations = pgTable(
  'applik8s_outcome_observations',
  {
    id: text('id').primaryKey(),
    reviewId: text('review_id')
      .notNull()
      .references(() => applicationApprovalReviews.id, {
        onDelete: 'cascade',
      }),
    grantId: text('grant_id').notNull(),
    outcomeId: text('outcome_id').notNull(),
    status: applicationOutcomeObservationState('status')
      .notNull()
      .default('pending'),
    evidence: jsonb('evidence').notNull(),
    observedBy: text('observed_by').notNull(),
    observedAt: timestamp('observed_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('applik8s_outcome_observations_grant_uidx').on(
      table.grantId,
      table.outcomeId,
    ),
  ],
);

export const applicationApprovalReviewRelations = relations(
  applicationApprovalReviews,
  ({ many }) => ({
    outcomes: many(applicationOutcomeObservations),
  }),
);

export const applicationOutcomeObservationRelations = relations(
  applicationOutcomeObservations,
  ({ one }) => ({
    review: one(applicationApprovalReviews, {
      fields: [applicationOutcomeObservations.reviewId],
      references: [applicationApprovalReviews.id],
    }),
  }),
);

export const applicationApprovalSchema = Object.freeze({
  applicationApprovalReviews,
  applicationOutcomeObservations,
  applicationApprovalReviewRelations,
  applicationOutcomeObservationRelations,
});

export interface ApplicationApprovalsModuleOptions {
  readonly database?: ApplicationDatabaseBinding;
}

/**
 * Adds product-facing review and outcome-observation models. Canonical grant
 * request, grant issuance, consumption, and revocation remain owned by
 * @applik8s/operations.
 */
export function approvals(
  application: Pick<KubernetesApplicationBuilder, 'model'>,
  options: ApplicationApprovalsModuleOptions = {},
) {
  const modelOptions = options.database
    ? { database: options.database }
    : undefined;
  const ApprovalReview = application.model(applicationApprovalReviews, {
    ...modelOptions,
    name: 'ApprovalReview',
    revision: false,
  });
  const OutcomeObservation = application.model(
    applicationOutcomeObservations,
    {
      ...modelOptions,
      name: 'OutcomeObservation',
      revision: false,
    },
  );
  return Object.freeze({ ApprovalReview, OutcomeObservation });
}
