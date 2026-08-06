import {
  field,
  index,
  model,
  pgEnum,
  relations,
  uniqueIndex,
} from '@applik8s/applik8s/drizzle';

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

export const applicationApprovalReviews = model(
  'applik8s_approval_reviews',
  {
    id: field.text('id').primaryKey(),
    grantRequestId: field.text('grant_request_id').notNull(),
    principalScope: field.text('principal_scope').notNull(),
    requestedByIdentityId: field.text('requested_by_identity_id').notNull(),
    operationId: field.text('operation_id').notNull(),
    target: field.jsonb('target').notNull(),
    requestedScope: field.jsonb('requested_scope').notNull(),
    evidence: field.jsonb('evidence').notNull(),
    intendedOutcomeId: field.text('intended_outcome_id'),
    status: applicationApprovalState('status').notNull().default('pending'),
    reviewerIdentityId: field.text('reviewer_identity_id'),
    decisionReason: field.text('decision_reason'),
    authorityRevision: field.text('authority_revision').notNull(),
    createdAt: field.timestamp('created_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull().defaultNow(),
    decidedAt: field.timestamp('decided_at', {
      withTimezone: true,
      mode: 'string',
    }),
    expiresAt: field.timestamp('expires_at', {
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
  { name: 'ApprovalReview', revision: false },
);

export const applicationOutcomeObservations = model(
  'applik8s_outcome_observations',
  {
    id: field.text('id').primaryKey(),
    reviewId: field.text('review_id')
      .notNull()
      .references(() => applicationApprovalReviews.id, {
        onDelete: 'cascade',
      }),
    grantId: field.text('grant_id').notNull(),
    outcomeId: field.text('outcome_id').notNull(),
    status: applicationOutcomeObservationState('status')
      .notNull()
      .default('pending'),
    evidence: field.jsonb('evidence').notNull(),
    observedBy: field.text('observed_by').notNull(),
    observedAt: field.timestamp('observed_at', {
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
  { name: 'OutcomeObservation', revision: false },
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
