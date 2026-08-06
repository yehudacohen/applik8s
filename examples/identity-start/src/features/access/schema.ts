import {
  authenticatedPrincipalId,
  field,
  index,
  model,
} from '@applik8s/applik8s/drizzle';

/**
 * The acceptance application keeps product state relational. Identity,
 * authority, durable review, and audit are framework concerns layered over
 * this one ordinary model.
 */
export const AccessRequest = model(
  'access_requests',
  {
    id: field.uuid('id').defaultRandom().primaryKey(),
    requestedBy: field
      .text('requested_by')
      .notNull()
      .default(authenticatedPrincipalId),
    operation: field.text('operation').notNull(),
    target: field.text('target').notNull(),
    evidence: field.text('evidence').notNull(),
    intendedOutcome: field.text('intended_outcome').notNull(),
    state: field.text('state').notNull().default('pending'),
    approvedBy: field.text('approved_by'),
    decisionReceipt: field.text('decision_receipt'),
    createdAt: field.text('created_at').notNull().default(''),
    decidedAt: field.text('decided_at'),
    revision: field.text('revision').notNull().default(''),
  },
  (table) => [
    index('access_requests_state_created').on(table.state, table.createdAt),
    index('access_requests_requester').on(table.requestedBy, table.createdAt),
  ],
);
