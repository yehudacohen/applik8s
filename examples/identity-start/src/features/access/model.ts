import type {
  ApplicationModelCreateEvent,
  ApplicationPrincipal,
} from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { and, desc, eq } from 'drizzle-orm';
import { application } from '../../app';
import { database } from '../../providers';
import { AccessRequest as AccessRequestBase } from './schema';

AccessRequestBase.create.beforeCommit(
  { history: true },
  async (request, input, context) => {
    if (!context.principal) {
      throw new Error('A production-sensitive request requires an admitted principal.');
    }
    if (
      input.requestedBy !== undefined
      || input.state !== undefined
      || input.approvedBy !== undefined
      || input.decisionReceipt !== undefined
      || input.createdAt !== undefined
      || input.decidedAt !== undefined
      || input.revision !== undefined
    ) {
      throw new Error('Request identity, lifecycle, and audit fields are server-owned.');
    }
    if (request.value.requestedBy !== context.principal.id) {
      throw new Error('The admitted principal and database actor must agree.');
    }
    if (
      request.value.evidence.trim().length < 8
      || request.value.evidence.length > 4_000
      || request.value.intendedOutcome.trim().length < 8
      || request.value.intendedOutcome.length > 1_000
    ) {
      throw new Error('Requests require bounded evidence and an intended outcome.');
    }
    request.patch({ spec: { createdAt: context.now } });
  },
);

AccessRequestBase.update.beforeCommit(
  { history: true },
  async (request, input, context) => {
    if (
      context.principal?.id !== 'access-review-workflow'
      || !context.principal.roles?.includes('reviewer')
    ) {
      throw new Error('Only the durable review workflow may commit a decision.');
    }
    if (
      'id' in input.patch
      || 'requestedBy' in input.patch
      || 'operation' in input.patch
      || 'target' in input.patch
      || 'evidence' in input.patch
      || 'intendedOutcome' in input.patch
      || 'createdAt' in input.patch
      || 'revision' in input.patch
    ) {
      throw new Error('A review cannot rewrite the request or its evidence.');
    }
    if (!['approved', 'rejected'].includes(request.value.state)) {
      throw new Error('A review must resolve the request exactly once.');
    }
    if (
      !request.value.approvedBy || !request.value.decisionReceipt
    ) {
      throw new Error('The framework-derived actor and decision receipt are required.');
    }
    request.patch({ spec: { decidedAt: context.now } });
  },
);

export const AccessRequest = AccessRequestBase;

export const AccessRequestQueue = AccessRequest.view(
  {
    input: type({
      'state?': "'pending' | 'approved' | 'rejected'",
      'limit?': '1 <= number.integer <= 100',
    }),
    output: type({
      id: 'string',
      requestedBy: 'string',
      operation: 'string',
      target: 'string',
      evidence: 'string',
      intendedOutcome: 'string',
      state: "'pending' | 'approved' | 'rejected'",
      'approvedBy?': 'string',
      'decisionReceipt?': 'string',
      createdAt: 'string',
      'decidedAt?': 'string',
    }).array(),
    database,
    authorize: ({ principal }) => isReviewer(principal),
    budgets: {
      timeoutMs: 2_000,
      maxRows: 100,
      maxResultBytes: 256 * 1_024,
    },
  },
  async function accessRequestQueue(input) {
    const limit = input.limit ?? 50;
    const rows = input.state
      ? await database
          .select()
          .from(AccessRequestBase)
          .where(and(eq(AccessRequestBase.state, input.state)))
          .orderBy(desc(AccessRequestBase.createdAt))
          .limit(limit)
      : await database
          .select()
          .from(AccessRequestBase)
          .orderBy(desc(AccessRequestBase.createdAt))
          .limit(limit);
    return rows.map((row) => ({
      id: row.id,
      requestedBy: row.requestedBy,
      operation: row.operation,
      target: row.target,
      evidence: row.evidence,
      intendedOutcome: row.intendedOutcome,
      state: accessRequestState(row.state),
      ...(row.approvedBy ? { approvedBy: row.approvedBy } : {}),
      ...(row.decisionReceipt
        ? { decisionReceipt: row.decisionReceipt }
        : {}),
      createdAt: row.createdAt,
      ...(row.decidedAt ? { decidedAt: row.decidedAt } : {}),
    }));
  },
);

export const Reviewer = application.role('reviewer');
Reviewer.can(AccessRequestQueue);

export const Administrator = application.role('administrator');
Administrator.can(
  AccessRequest.create.all(),
  AccessRequest.delete.all(),
  AccessRequestQueue,
);

/**
 * A provider-issued client-credentials token for this exact issuer and client
 * ID may invoke the same typed operation through MCP. No Ory-specific
 * authority leaks into the application model.
 */
export const ReleaseAutomation = application.oauthClient(
  'identity-start-release-automation',
  { issuer: 'https://identity.example.test' },
);
ReleaseAutomation.can(AccessRequest.create.all());

function isReviewer(principal: ApplicationPrincipal | undefined): boolean {
  return principal?.roles?.some((role) =>
    role === 'reviewer' || role === 'administrator',
  ) === true;
}

function accessRequestState(
  value: string,
): 'pending' | 'approved' | 'rejected' {
  if (value === 'pending' || value === 'approved' || value === 'rejected') {
    return value;
  }
  throw new Error(`Access request has unsupported state ${JSON.stringify(value)}.`);
}

export type AccessRequestCreated =
  ApplicationModelCreateEvent<typeof AccessRequest.$inferSelect>;
