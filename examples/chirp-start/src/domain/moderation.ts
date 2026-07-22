// typecast-file-boundary: validated model payloads are narrowed to the declared moderation states before domain decisions.
import { entity, type } from '@applik8s/applik8s/dsl';
import { desc, eq } from 'drizzle-orm';
import { app, namespace } from '../app';
import { moderationCases, reports } from '../schema/moderation';
import { ChirpCommandProcessor, Database } from '../providers/database';
import { ModerationCaseChanged, ReportSubmitted } from './events';

const ReportBase = app.model(reports, { name: 'Report', database: Database, processor: ChirpCommandProcessor });
const ModerationCaseBase = app.model(moderationCases, { name: 'ModerationCase', database: Database, processor: ChirpCommandProcessor });

ReportBase.create.beforeCommit({
  events: [ReportSubmitted], history: true,
}, async (report, input, context) => {
  if (!context.principal) throw new Error('A report requires an authenticated reporter.');
  if (input.reporterId !== undefined || input.state !== undefined || input.createdAt !== undefined || input.revision !== undefined) throw new Error('Report ownership, state, timestamps, and revisions are server-owned.');
  if (report.value.reporterId !== context.principal.id) throw new Error('The PostgreSQL actor default did not match the authenticated reporter.');
  report.patch({ spec: { createdAt: context.now } });
  const targetType = input.postId ? 'post' as const : 'account' as const;
  const targetId = input.postId ?? input.accountId;
  if (!targetId || Boolean(input.postId) === Boolean(input.accountId)) throw new Error('A report must target exactly one post or account.');
  if (report.value.state !== 'open' || !input.reason.trim() || input.detail.length > 2_000) throw new Error('A new report must be open and include a reason and bounded detail.');
  context.emit(ReportSubmitted, { reportId: report.id, reporterId: report.value.reporterId, targetType, targetId, createdAt: context.now });
});
ReportBase.update.beforeCommit({ history: true }, async (report, input, context) => {
  if (context.principal?.claims?.role !== 'moderator') throw new Error('Only a moderator can triage or resolve a report.');
  if ('id' in input.patch || 'reporterId' in input.patch || 'postId' in input.patch || 'accountId' in input.patch
    || 'reason' in input.patch || 'detail' in input.patch || 'createdAt' in input.patch || 'revision' in input.patch) {
    throw new Error('Report identity, participants, content, timestamps, and revisions are immutable.');
  }
  if (!['triaged', 'resolved'].includes(report.value.state)) throw new Error('A moderator report update must mark it triaged or resolved.');
});
ReportBase.delete.beforeCommit({ history: true }, async (report, _input, context) => {
  if (!context.principal || (context.principal.id !== report.value.reporterId && context.principal.claims?.role !== 'moderator')) throw new Error('Only the reporter or a moderator can delete this report.');
});
const UpdateReport = ReportBase.update;
export const Report = ReportBase.view('openQueue', {
  input: type({ 'limit?': 'number.integer >= 1' }),
  output: type({ id: 'string', reporterId: 'string', 'postId': 'string | null', 'accountId': 'string | null', reason: 'string', detail: 'string', createdAt: 'string' }).array(),
  database: Database,
  authorize: ({ principal }) => principal.claims?.role === 'moderator',
  run: async ({ context, input }) => context.database(Database).select({
    id: ReportBase.id, reporterId: ReportBase.reporterId, postId: ReportBase.postId,
    accountId: ReportBase.accountId, reason: ReportBase.reason, detail: ReportBase.detail, createdAt: ReportBase.createdAt,
  }).from(ReportBase).where(eq(ReportBase.state, 'open')).orderBy(desc(ReportBase.createdAt)).limit(Math.min(input.limit ?? 50, 100)),
  budgets: { maxRows: 100, maxResultBytes: 512_000, timeoutMs: 2_000 },
});

ModerationCaseBase.create.beforeCommit({
  transaction: { commands: [UpdateReport] }, events: [ModerationCaseChanged], history: true,
}, async (moderationCase, input, context) => {
  if (context.principal?.claims?.role !== 'moderator') throw new Error('Only an authenticated moderator can open this case.');
  if (input.assigneeId !== undefined || input.state !== undefined || input.openedAt !== undefined || input.revision !== undefined || input.resolution != null || input.resolvedAt != null) throw new Error('Moderation ownership, state, timestamps, and revisions are server-owned.');
  if (moderationCase.value.assigneeId !== context.principal.id) throw new Error('The PostgreSQL actor default did not match the authenticated moderator.');
  moderationCase.patch({ spec: { openedAt: context.now } });
  context.emit(ModerationCaseChanged, { caseId: moderationCase.id, reportId: input.reportId, state: 'open', changedAt: context.now });
  context.send(UpdateReport, { identity: input.reportId, patch: { state: 'triaged' } }, {
    targetKey: input.reportId,
    idempotencyKey: context.id('triage-report'),
  });
});
ModerationCaseBase.update.beforeCommit({
  transaction: { commands: [UpdateReport] }, events: [ModerationCaseChanged], history: true,
}, async (moderationCase, input, context) => {
  if (context.principal?.claims?.role !== 'moderator') throw new Error('Only a moderator can update a moderation case.');
  if ('id' in input.patch || 'reportId' in input.patch || 'targetType' in input.patch || 'targetId' in input.patch || 'openedAt' in input.patch || 'resolvedAt' in input.patch || 'assigneeId' in input.patch || 'revision' in input.patch) throw new Error('Moderation identity, ownership, target, timestamps, and revisions are server-owned.');
  if (moderationCase.value.state !== 'resolved' || !moderationCase.value.resolution?.trim()) throw new Error('Resolving a moderation case requires a resolution.');
  moderationCase.patch({ spec: { resolvedAt: context.now } });
  context.emit(ModerationCaseChanged, { caseId: moderationCase.id, reportId: moderationCase.value.reportId, state: 'resolved', changedAt: context.now, resolution: moderationCase.value.resolution });
  context.send(UpdateReport, { identity: moderationCase.value.reportId, patch: { state: 'resolved' } }, {
    targetKey: moderationCase.value.reportId,
    idempotencyKey: context.id('resolve-report'),
  });
});
ModerationCaseBase.delete.beforeCommit({ history: true }, async (_moderationCase, _input, context) => {
  if (context.principal?.claims?.role !== 'moderator') throw new Error('Only a moderator can delete a moderation case.');
});
export const ModerationCase = ModerationCaseBase.view('queue', {
  input: type({ 'limit?': 'number.integer >= 1' }),
  output: type({ id: 'string', reportId: 'string', targetType: 'string', targetId: 'string', state: 'string', openedAt: 'string', 'assigneeId': 'string | null' }).array(),
  database: Database,
  authorize: ({ principal }) => principal.claims?.role === 'moderator',
  run: async ({ context, input }) => context.database(Database).select({
    id: ModerationCaseBase.id, reportId: ModerationCaseBase.reportId, targetType: ModerationCaseBase.targetType,
    targetId: ModerationCaseBase.targetId, state: ModerationCaseBase.state, openedAt: ModerationCaseBase.openedAt, assigneeId: ModerationCaseBase.assigneeId,
  }).from(ModerationCaseBase).where(eq(ModerationCaseBase.state, 'open')).orderBy(desc(ModerationCaseBase.openedAt)).limit(Math.min(input.limit ?? 50, 100)),
  budgets: { maxRows: 100, maxResultBytes: 512_000, timeoutMs: 2_000 },
});

export const moderationPolicyApiVersion = 'chirp.applik8s.dev/v1alpha1';
export const moderationPolicyKind = 'ModerationPolicy';

const ModerationPolicyResource = app.crd(entity(moderationPolicyKind, {
  spec: type({ maxRisk: 'number', blockedTerms: 'string[]' }),
  status: type({ "phase?": "'Ready' | 'Invalid'", 'message?': 'string' }),
}), { apiVersion: moderationPolicyApiVersion });

export const ModerationPolicy = ModerationPolicyResource.view('current', {
  input: type({}),
  output: type({
    name: 'string', maxRisk: 'number', blockedTerms: 'string[]',
    phase: "'Ready' | 'Invalid'", message: 'string',
  }).array(),
  authorize: ({ principal }) => principal.claims?.role === 'moderator',
  kubernetes: {
    namespace,
    fieldSelector: () => 'metadata.name=default',
    project: ({ value }) => ({
      name: value.metadata.name,
      maxRisk: value.spec.maxRisk,
      blockedTerms: value.spec.blockedTerms,
      phase: value.status?.phase ?? 'Invalid',
      message: value.status?.message ?? 'Policy has not reconciled yet.',
    }),
    limit: () => 1,
    pageSize: 10,
    maxPages: 2,
    maxItems: 10,
  },
  budgets: { maxRows: 1, maxResultBytes: 16_000, timeoutMs: 2_000 },
});

ModerationPolicy.on.create('initialize-moderation-policy', { namespace }, async (policy) => {
  policy.status.phase = policy.spec.maxRisk >= 0 && policy.spec.maxRisk <= 1 ? 'Ready' : 'Invalid';
  policy.status.message = policy.status.phase === 'Ready' ? 'Policy accepted.' : 'maxRisk must be between zero and one.';
});

ModerationPolicy.on.update('apply-moderation-policy', { namespace }, async (policy) => {
  policy.status.phase = policy.spec.maxRisk >= 0 && policy.spec.maxRisk <= 1 ? 'Ready' : 'Invalid';
  policy.status.message = policy.status.phase === 'Ready' ? 'Policy updated.' : 'maxRisk must be between zero and one.';
});
