// typecast-file-boundary: validated model payloads are narrowed to the declared moderation states before domain decisions.
import { ManagedModelStore, OperatorRuntime, Scheduler } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { desc, eq } from 'drizzle-orm';
import { app, workflow } from '../domain-app';
import { AutomationPostReview } from '../automation/workflow';
import { Database } from '../providers/database';
import { databaseProvider } from '../providers';
import { moderationCases, moderationPolicies, reports } from '../schema/moderation';
import { ModerationCaseChanged, ReportSubmitted } from './events';

const ReportBase = reports;
const ModerationCaseBase = moderationCases;

ReportBase.create.beforeCommit(
  { history: true },
  async (report, input, context) => {
    if (!context.principal) throw new Error('A report requires an authenticated reporter.');
    if (
      input.reporterId !== undefined ||
      input.state !== undefined ||
      input.createdAt !== undefined ||
      input.revision !== undefined
    )
      throw new Error('Report ownership, state, timestamps, and revisions are server-owned.');
    if (report.value.reporterId !== context.principal.id)
      throw new Error('The PostgreSQL actor default did not match the authenticated reporter.');
    report.patch({ spec: { createdAt: context.now } });
    const targetType = input.postId ? ('post' as const) : ('account' as const);
    const targetId = input.postId ?? input.accountId;
    if (!targetId || Boolean(input.postId) === Boolean(input.accountId))
      throw new Error('A report must target exactly one post or account.');
    if (report.value.state !== 'open' || !input.reason.trim() || input.detail.length > 2_000)
      throw new Error('A new report must be open and include a reason and bounded detail.');
    ReportSubmitted.emit({
      reportId: report.id,
      reporterId: report.value.reporterId,
      targetType,
      targetId,
      createdAt: context.now,
    });
  },
);
ReportBase.update.beforeCommit({ history: true }, async (report, input, context) => {
  if (!context.principal?.roles?.includes('moderator'))
    throw new Error('Only a moderator can triage or resolve a report.');
  if (
    'id' in input.patch ||
    'reporterId' in input.patch ||
    'postId' in input.patch ||
    'accountId' in input.patch ||
    'reason' in input.patch ||
    'detail' in input.patch ||
    'createdAt' in input.patch ||
    'revision' in input.patch
  ) {
    throw new Error('Report identity, participants, content, timestamps, and revisions are immutable.');
  }
  if (!['triaged', 'resolved'].includes(report.value.state))
    throw new Error('A moderator report update must mark it triaged or resolved.');
});
ReportBase.delete.beforeCommit({ history: true }, async (report, _input, context) => {
  if (
    !context.principal ||
    (context.principal.id !== report.value.reporterId && !context.principal.roles?.includes('moderator'))
  )
    throw new Error('Only the reporter or a moderator can delete this report.');
});
const UpdateReport = ReportBase.update;
export const Report = ReportBase;
export const ReportOpenQueue = Report.view(
  {
    input: type({ 'limit?': 'number.integer >= 1' }),
    output: type({
      id: 'string',
      reporterId: 'string',
      postId: 'string | null',
      accountId: 'string | null',
      reason: 'string',
      detail: 'string',
      createdAt: 'string',
    }).array(),
    database: Database,
    authorize: ({ principal }) => principal.roles?.includes('moderator') === true,
    budgets: { maxRows: 100, maxResultBytes: 512_000, timeoutMs: 2_000 },
  },
  async function openQueue(input, _context) {
    return Database
      .select({
        id: ReportBase.id,
        reporterId: ReportBase.reporterId,
        postId: ReportBase.postId,
        accountId: ReportBase.accountId,
        reason: ReportBase.reason,
        detail: ReportBase.detail,
        createdAt: ReportBase.createdAt,
      })
      .from(ReportBase)
      .where(eq(ReportBase.state, 'open'))
      .orderBy(desc(ReportBase.createdAt))
      .limit(Math.min(input.limit ?? 50, 100));
  },
);

ModerationCaseBase.create.beforeCommit(
  { history: true },
  async (moderationCase, input, context) => {
    if (!context.principal?.roles?.includes('moderator'))
      throw new Error('Only an authenticated moderator can open this case.');
    if (
      input.assigneeId !== undefined ||
      input.state !== undefined ||
      input.openedAt !== undefined ||
      input.revision !== undefined ||
      input.resolution != null ||
      input.resolvedAt != null
    )
      throw new Error('Moderation ownership, state, timestamps, and revisions are server-owned.');
    if (moderationCase.value.assigneeId !== context.principal.id)
      throw new Error('The PostgreSQL actor default did not match the authenticated moderator.');
    moderationCase.patch({ spec: { openedAt: context.now } });
    ModerationCaseChanged.emit({
      caseId: moderationCase.id,
      reportId: input.reportId,
      state: 'open',
      changedAt: context.now,
    });
    void UpdateReport({ identity: input.reportId, patch: { state: 'triaged' } });
  },
);
ModerationCaseBase.update.beforeCommit(
  { history: true },
  async (moderationCase, input, context) => {
    if (!context.principal?.roles?.includes('moderator'))
      throw new Error('Only a moderator can update a moderation case.');
    if (
      'id' in input.patch ||
      'reportId' in input.patch ||
      'targetType' in input.patch ||
      'targetId' in input.patch ||
      'openedAt' in input.patch ||
      'resolvedAt' in input.patch ||
      'assigneeId' in input.patch ||
      'revision' in input.patch
    )
      throw new Error('Moderation identity, ownership, target, timestamps, and revisions are server-owned.');
    if (moderationCase.value.state !== 'resolved' || !moderationCase.value.resolution?.trim())
      throw new Error('Resolving a moderation case requires a resolution.');
    moderationCase.patch({ spec: { resolvedAt: context.now } });
    ModerationCaseChanged.emit({
      caseId: moderationCase.id,
      reportId: moderationCase.value.reportId,
      state: 'resolved',
      changedAt: context.now,
      resolution: moderationCase.value.resolution,
    });
    void UpdateReport({
      identity: moderationCase.value.reportId,
      patch: { state: 'resolved' },
    });
  },
);
ModerationCaseBase.delete.beforeCommit({ history: true }, async (_moderationCase, _input, context) => {
  if (!context.principal?.roles?.includes('moderator'))
    throw new Error('Only a moderator can delete a moderation case.');
});
export const ModerationCase = ModerationCaseBase;
export const ModerationCaseQueue = ModerationCase.view(
  {
    input: type({ 'limit?': 'number.integer >= 1' }),
    output: type({
      id: 'string',
      reportId: 'string',
      targetType: 'string',
      targetId: 'string',
      state: 'string',
      openedAt: 'string',
      assigneeId: 'string | null',
    }).array(),
    database: Database,
    authorize: ({ principal }) => principal.roles?.includes('moderator') === true,
    budgets: { maxRows: 100, maxResultBytes: 512_000, timeoutMs: 2_000 },
  },
  async function queue(input, _context) {
    return Database
      .select({
        id: ModerationCaseBase.id,
        reportId: ModerationCaseBase.reportId,
        targetType: ModerationCaseBase.targetType,
        targetId: ModerationCaseBase.targetId,
        state: ModerationCaseBase.state,
        openedAt: ModerationCaseBase.openedAt,
        assigneeId: ModerationCaseBase.assigneeId,
      })
      .from(ModerationCaseBase)
      .where(eq(ModerationCaseBase.state, 'open'))
      .orderBy(desc(ModerationCaseBase.openedAt))
      .limit(Math.min(input.limit ?? 50, 100));
  },
);

const ModerationPolicy = moderationPolicies.managed({
  status: type({
    phase: "'Applying' | 'Ready' | 'Invalid'",
    message: 'string',
  }),
  initialStatus: {
    phase: 'Applying',
    message: 'Policy has not reconciled yet.',
  },
  resync: { interval: '2m', maximumItems: 100 },
  lease: { duration: '45s' },
});

app.provide(
  ModerationPolicy.store,
  ManagedModelStore.postgres({ database: databaseProvider }),
);
app.provide(
  OperatorRuntime,
  OperatorRuntime.distributed({
    database: databaseProvider,
    scheduler: Scheduler.postgres({ database: databaseProvider }),
  }),
);

export { ModerationPolicy };
export const ModerationPolicyCurrent = ModerationPolicy.view({
  input: type({}),
  output: type({
    name: 'string',
    maxRisk: 'number',
    blockedTerms: 'string[]',
  }).array(),
  database: Database,
  authorize: ({ principal }) => principal.roles?.includes('moderator') === true,
  budgets: { maxRows: 1, maxResultBytes: 16_000, timeoutMs: 2_000 },
}, async function currentPolicy() {
  return Database
    .select({
      name: ModerationPolicy.id,
      maxRisk: ModerationPolicy.maxRisk,
      blockedTerms: ModerationPolicy.blockedTerms,
    })
    .from(ModerationPolicy)
    .where(eq(ModerationPolicy.id, 'default'))
    .limit(1);
});

ModerationPolicy.create.beforeCommit({ history: true }, async (policy, input, context) => {
  if (!context.principal?.roles?.includes('moderator')) {
    throw new Error('Only a moderator can create a moderation policy.');
  }
  if (input.revision !== undefined) {
    throw new Error('Moderation policy revisions are server-owned.');
  }
  if (policy.value.maxRisk < 0 || policy.value.maxRisk > 1) {
    throw new Error('maxRisk must be between zero and one.');
  }
});
ModerationPolicy.update.beforeCommit({ history: true }, async (policy, input, context) => {
  if (!context.principal?.roles?.includes('moderator')) {
    throw new Error('Only a moderator can update a moderation policy.');
  }
  if ('id' in input.patch || 'revision' in input.patch) {
    throw new Error('Moderation policy identity and revisions are server-owned.');
  }
  if (policy.value.maxRisk < 0 || policy.value.maxRisk > 1) {
    throw new Error('maxRisk must be between zero and one.');
  }
});

const ApplyModerationPolicy = workflow(
  'moderation.apply-policy.v1',
  {
    input: type({ name: 'string', maxRisk: 'number', blockedTerms: 'string[]' }),
    output: type({ phase: "'Ready' | 'Invalid'", message: 'string' }),
  },
  async function applyModerationPolicy(input) {
    if (input.maxRisk < 0 || input.maxRisk > 1) {
      return { phase: 'Invalid' as const, message: 'maxRisk must be between zero and one.' };
    }
    return {
      phase: 'Ready' as const,
      message: `Policy applied with ${input.blockedTerms.length} blocked term${input.blockedTerms.length === 1 ? '' : 's'}.`,
    };
  },
);

ModerationPolicy.on.reconcile(async function reconcileModerationPolicy(policy) {
  const result = await ApplyModerationPolicy({
    name: policy.id,
    maxRisk: policy.value.maxRisk,
    blockedTerms: [...policy.value.blockedTerms],
  }, {
    idempotencyKey: `${policy.metadata.uid}:${policy.metadata.generation}`,
  });
  await policy.status.update(result);
  await policy.conditions.set({
    type: 'Ready',
    status: result.phase === 'Ready' ? 'True' : 'False',
    reason: result.phase === 'Ready' ? 'PolicyApplied' : 'PolicyInvalid',
    message: result.message,
  });
});

/**
 * The identity provider admits the typed role; the application owns what that
 * role means. No browser-authored role string is trusted as authority.
 */
export const Moderator = app.role('moderator');
Moderator.can(
  AutomationPostReview.read,
  AutomationPostReview.approve,
  AutomationPostReview.reject,
  Report.update.all(),
  Report.delete.all(),
  ReportOpenQueue,
  ModerationCase.create.all(),
  ModerationCase.update.all(),
  ModerationCase.delete.all(),
  ModerationCaseQueue,
  ModerationPolicy.create.all(),
  ModerationPolicyCurrent,
);
