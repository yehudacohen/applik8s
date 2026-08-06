import { type } from '@applik8s/applik8s/dsl';
import { application } from '../../app';
import {
  AccessRequest,
  Administrator,
  Reviewer,
  type AccessRequestCreated,
} from './model';

const workflow = application.workflow;

interface AccessReviewResult {
  readonly requestId: string;
  readonly state: 'approved' | 'rejected' | 'expired';
  readonly receipt: string;
}

export const AccessReview = workflow.signal('access.review.v1', {
  input: type({
    requestId: 'string',
    operation: 'string',
    target: 'string',
    evidence: 'string',
    intendedOutcome: 'string',
  }),
  actions: {
    approve: type({ 'comment?': 'string' }),
    reject: type({ reason: 'string' }),
  },
});

export const AccessReviewRequests = AccessReview.subscribe(
  'access-review-requests',
  {
    delivery: 'sse',
    authorize: ({ principal }) =>
      principal.roles?.some((role) =>
        role === 'reviewer' || role === 'administrator',
      ) === true,
  },
);

Reviewer.can(
  AccessReview.read,
  AccessReview.approve,
  AccessReview.reject,
);
Administrator.can(
  AccessReview.read,
  AccessReview.approve,
  AccessReview.reject,
);

function reviewWorkerPrincipal() {
  return {
    id: 'access-review-workflow',
    roles: ['reviewer'],
    attributes: { kind: 'workflow' },
    authorizationVersion: 'identity-start-review-v1',
    trustedContext: { executionAuthority: 'applik8s-workflow' },
  };
}

export const reviewAccessRequest = workflow(
  'access.review-request.v1',
  {
    input: type({
      requestId: 'string',
      operation: 'string',
      target: 'string',
      evidence: 'string',
      intendedOutcome: 'string',
    }),
    output: type({
      requestId: 'string',
      state: "'approved' | 'rejected' | 'expired'",
      receipt: 'string',
    }),
  },
  {
    authority: [AccessRequest.update.all()],
    principal: reviewWorkerPrincipal,
    retries: 3,
    idempotencyKey: ({ requestId }) => requestId,
  },
  async (input) => {
    const review = await workflow.emitSignal(AccessReview, {
      input,
      expiresIn: '24h',
      target: { requestId: input.requestId, operation: input.operation },
      authorize: [{ role: 'reviewer' }, { role: 'administrator' }],
    });
    const decision = await review();
    return decision.match({
      approve: async ({ actor, receipt }) => {
        await AccessRequest.update({
          identity: input.requestId,
          patch: {
            state: 'approved',
            approvedBy: actor.id,
            decisionReceipt: receipt.id,
          },
        });
        return accessReviewResult(input.requestId, 'approved', receipt.id);
      },
      reject: async ({ actor, receipt }) => {
        await AccessRequest.update({
          identity: input.requestId,
          patch: {
            state: 'rejected',
            approvedBy: actor.id,
            decisionReceipt: receipt.id,
          },
        });
        return accessReviewResult(input.requestId, 'rejected', receipt.id);
      },
      expired: async () =>
        accessReviewResult(
          input.requestId,
          'expired',
          `signal:${review.issuance.id}:expired`,
        ),
    });
  },
);

async function beginAccessReview(created: AccessRequestCreated) {
  await reviewAccessRequest.start(
    {
      requestId: created.value.id,
      operation: created.value.operation,
      target: created.value.target,
      evidence: created.value.evidence,
      intendedOutcome: created.value.intendedOutcome,
    },
    { idempotencyKey: created.value.id },
  );
}

export const AccessReviewCoordinator = AccessRequest.on.create(
  {
    processor: { replicas: 1, concurrency: 8 },
    retry: {
      maxAttempts: 5,
      initialDelayMs: 250,
      maxDelayMs: 5_000,
      deadLetter: true,
    },
    budgets: { timeoutMs: 15_000, maxInputBytes: 32_000 },
  },
  beginAccessReview,
);

function accessReviewResult(
  requestId: string,
  state: AccessReviewResult['state'],
  receipt: string,
): AccessReviewResult {
  return { requestId, state, receipt };
}
