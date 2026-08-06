import { module } from '@applik8s/applik8s';
import {
  applicationApprovalReviews,
  applicationApprovalSchema,
  applicationOutcomeObservations,
} from './schema.js';

export * from './schema.js';

/**
 * Adds product-facing review and outcome-observation models. Canonical grant
 * request, grant issuance, consumption, and revocation remain owned by
 * @applik8s/operations.
 */
function installApprovals() {
  return {
    ApprovalReview: applicationApprovalReviews,
    OutcomeObservation: applicationOutcomeObservations,
  };
}

export const approvals = module(
  'approvals',
  { schema: applicationApprovalSchema },
  installApprovals,
);
