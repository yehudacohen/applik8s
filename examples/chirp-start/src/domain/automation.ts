// typecast-file-boundary: validated Drizzle lifecycle snapshots are re-exposed as their declared row shapes for automation policy handling.
import { type } from '@applik8s/applik8s/dsl';
import { desc, eq } from 'drizzle-orm';
import { app } from '../app';
import { automationControls, automationRuns, automations } from '../schema/automation';
import { Account } from './accounts';
import { ChirpCommandProcessor, Database } from '../providers/database';
import { AutomationRunChanged, AutomationScheduleChanged } from './events';

const AutomationBase = app.model(automations, { name: 'Automation', database: Database, processor: ChirpCommandProcessor });
const AutomationRunBase = app.model(automationRuns, { name: 'AutomationRun', database: Database, processor: ChirpCommandProcessor });
const AutomationControlBase = app.model(automationControls, { name: 'AutomationControl', database: Database, processor: ChirpCommandProcessor });

AutomationControlBase.create.beforeCommit({ history: true }, async (control, input, context) => {
  if (context.principal?.claims?.role !== 'moderator' && context.principal?.claims?.role !== 'installation-administrator') throw new Error('The global automation safety control requires an administrator.');
  if (input.id !== 'global' || input.changedAt !== undefined || input.revision !== undefined) throw new Error('The automation safety control has one server-timestamped global identity.');
  if (!['true', 'false'].includes(control.value.enabled) || (control.value.enabled === 'false' && !control.value.reason.trim())) throw new Error('Disabling automation requires a reason.');
  control.patch({ spec: { changedAt: context.now } });
});

AutomationControlBase.update.beforeCommit({ history: true }, async (control, input, context) => {
  if (context.principal?.claims?.role !== 'moderator' && context.principal?.claims?.role !== 'installation-administrator') throw new Error('The global automation safety control requires an administrator.');
  if ('id' in input.patch || 'changedAt' in input.patch || 'revision' in input.patch) throw new Error('Automation safety identity, timestamp, and revision are server-owned.');
  if (!['true', 'false'].includes(control.value.enabled) || (control.value.enabled === 'false' && !control.value.reason.trim())) throw new Error('Disabling automation requires a reason.');
  control.patch({ spec: { changedAt: context.now } });
});

AutomationControlBase.delete.beforeCommit({ history: true }, async (_control, _input, context) => {
  if (context.principal?.claims?.role !== 'installation-administrator') throw new Error('Only an installation administrator may remove the global automation safety control.');
});

export const AutomationControl = AutomationControlBase.view('current', {
  input: type({}),
  output: type({ id: 'string', configured: 'boolean', enabled: 'boolean', reason: 'string', changedAt: 'string' }),
  database: Database,
  authorize: ({ principal }) => ['automation-worker', 'moderator', 'installation-administrator'].includes(String(principal.claims?.role ?? '')),
  run: async ({ context }) => {
    const rows = await context.database(Database).select({
      id: AutomationControlBase.id,
      enabled: AutomationControlBase.enabled,
      reason: AutomationControlBase.reason,
      changedAt: AutomationControlBase.changedAt,
    }).from(AutomationControlBase).where(eq(AutomationControlBase.id, 'global')).limit(1);
    const current = rows[0];
    return current
      ? { id: current.id, configured: true, enabled: current.enabled === 'true', reason: current.reason, changedAt: current.changedAt }
      : { id: 'global', configured: false, enabled: true, reason: '', changedAt: '' };
  },
  budgets: { maxRows: 1, maxResultBytes: 8_000, timeoutMs: 2_000 },
});

AutomationBase.create.beforeCommit({
  transaction: { models: [Account] },
  events: [AutomationScheduleChanged],
  history: true,
}, async (automation, input, context) => {
  if (!context.principal) throw new Error('An automation requires an authenticated owner.');
  if (input.ownerId !== undefined || input.state !== undefined || input.createdAt !== undefined || input.revision !== undefined) throw new Error('Automation ownership, state, timestamps, and revisions are server-owned.');
  if (automation.value.ownerId !== context.principal.id) throw new Error('The PostgreSQL actor default did not match the authenticated automation owner.');
  automation.patch({ spec: { createdAt: context.now } });
  if (input.persona.trim().length < 1 || input.persona.length > 160) throw new Error('Automation persona must contain between 1 and 160 characters.');
  if (input.instructions.length < 1 || input.instructions.length > 4_000) throw new Error('Automation instructions must contain between 1 and 4,000 characters.');
  if (!/^([-0-9*/,]+\s+){4}[-0-9*/,]+$/.test(input.schedule)) throw new Error('Automation schedule must be a bounded five-field cron expression.');
  const maxPosts = Number(input.maxPostsPerDay);
  const maxUnits = Number(input.maxUnitsPerDay);
  if (!Number.isSafeInteger(maxPosts) || maxPosts < 1 || maxPosts > 24 || !Number.isSafeInteger(maxUnits) || maxUnits < 1 || maxUnits > 1_000_000) throw new Error('Automation daily budgets are outside the site bounds.');
  if (automation.value.state !== 'active') throw new Error('A new automation must begin active.');
  const automatedAccount = await context.models.Account?.get({ id: input.accountId });
  if (automatedAccount?.spec.kind !== 'automation' || automatedAccount.spec.state !== 'active') throw new Error('An automation must target an active disclosed automation account.');
  context.emit(AutomationScheduleChanged, {
    automationId: automation.id, ownerId: automation.value.ownerId, accountId: input.accountId,
    schedule: input.schedule, state: 'active', changedAt: context.now,
    persona: input.persona, instructions: input.instructions, generationProfile: input.generationProfile,
    maxPostsPerDay: input.maxPostsPerDay, maxUnitsPerDay: input.maxUnitsPerDay,
  });
});

AutomationBase.update.beforeCommit({
  events: [AutomationScheduleChanged],
  history: true,
}, async (automation, input, context) => {
  if (!context.principal || automation.value.ownerId !== context.principal.id) throw new Error('Only the automation owner can update it.');
  if ('id' in input.patch || 'ownerId' in input.patch || 'accountId' in input.patch || 'createdAt' in input.patch || 'revision' in input.patch) throw new Error('Automation identity, ownership, timestamps, and revisions are server-owned.');
  if (!['active', 'suspended'].includes(automation.value.state)) throw new Error('Automation state is invalid.');
  if (automation.value.persona.trim().length < 1 || automation.value.persona.length > 160) throw new Error('Automation persona must contain between 1 and 160 characters.');
  if (automation.value.instructions.length < 1 || automation.value.instructions.length > 4_000) throw new Error('Automation instructions must contain between 1 and 4,000 characters.');
  if (!/^([-0-9*/,]+\s+){4}[-0-9*/,]+$/.test(automation.value.schedule)) throw new Error('Automation schedule must be a bounded five-field cron expression.');
  const maxPosts = Number(automation.value.maxPostsPerDay);
  const maxUnits = Number(automation.value.maxUnitsPerDay);
  if (!Number.isSafeInteger(maxPosts) || maxPosts < 1 || maxPosts > 24 || !Number.isSafeInteger(maxUnits) || maxUnits < 1 || maxUnits > 1_000_000) throw new Error('Automation daily budgets are outside the site bounds.');
  context.emit(AutomationScheduleChanged, {
    automationId: automation.id, ownerId: automation.value.ownerId, accountId: automation.value.accountId,
    schedule: automation.value.schedule, state: automation.value.state as 'active' | 'suspended', changedAt: context.now,
    persona: automation.value.persona, instructions: automation.value.instructions, generationProfile: automation.value.generationProfile,
    maxPostsPerDay: automation.value.maxPostsPerDay, maxUnitsPerDay: automation.value.maxUnitsPerDay,
  });
});

AutomationBase.delete.beforeCommit({ events: [AutomationScheduleChanged], history: true }, async (automation, _input, context) => {
  if (!context.principal || automation.value.ownerId !== context.principal.id) throw new Error('Only the automation owner can delete it.');
  context.emit(AutomationScheduleChanged, {
    automationId: automation.id, ownerId: automation.value.ownerId, accountId: automation.value.accountId,
    schedule: automation.value.schedule, state: 'suspended', changedAt: context.now,
    persona: automation.value.persona, instructions: automation.value.instructions, generationProfile: automation.value.generationProfile,
    maxPostsPerDay: automation.value.maxPostsPerDay, maxUnitsPerDay: automation.value.maxUnitsPerDay,
  });
});
export const Automation = AutomationBase.view('mine', {
  input: type({ 'limit?': 'number.integer >= 1' }),
  output: type({
    id: 'string',
    accountId: 'string',
    persona: 'string',
    instructions: 'string',
    schedule: 'string',
    generationProfile: 'string',
    maxPostsPerDay: 'string',
    maxUnitsPerDay: 'string',
    state: 'string',
  }).array(),
  database: Database,
  authorize: ({ principal }) => principal.id.length > 0,
  run: async ({ context, input, principal }) => context.database(Database).select({
    id: AutomationBase.id, accountId: AutomationBase.accountId, persona: AutomationBase.persona,
    instructions: AutomationBase.instructions, schedule: AutomationBase.schedule,
    generationProfile: AutomationBase.generationProfile, maxPostsPerDay: AutomationBase.maxPostsPerDay,
    maxUnitsPerDay: AutomationBase.maxUnitsPerDay, state: AutomationBase.state,
  }).from(AutomationBase).where(eq(AutomationBase.ownerId, principal.id)).orderBy(desc(AutomationBase.createdAt)).limit(Math.min(input.limit ?? 25, 50)),
  budgets: { maxRows: 50, maxResultBytes: 256_000, timeoutMs: 2_000 },
});

AutomationRunBase.create.beforeCommit({
  transaction: { models: [AutomationBase, AutomationRunBase] },
  events: [AutomationRunChanged], history: true,
}, async (run, input, context) => {
  if (context.principal?.claims?.role !== 'automation-worker' || context.principal.claims.automationId !== input.automationId) throw new Error('Automation runs require an Applik8s-issued automation execution principal bound to the target automation.');
  if (input.quotaWindow !== undefined || input.state !== undefined || input.publishedPostId !== undefined || input.usageUnits !== undefined || input.reservedUnits !== undefined || input.resultReference !== undefined || input.startedAt !== undefined || input.finishedAt !== undefined || input.revision !== undefined) throw new Error('Automation run quota window, state, usage, results, timestamps, and revisions are server-owned.');
  // Command policies are deterministic closures: the scheduler supplies the
  // canonical UTC instant and the policy derives its quota partition without
  // ambient wall-clock access.
  if (!/^\d{4}-(0[1-9]|1[0-2])-([012]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{3})?Z$/.test(input.scheduledFor)) throw new Error('Automation run scheduledFor must be a canonical UTC ISO timestamp.');
  const quotaWindow = input.scheduledFor.slice(0, 10);
  const configurationObject = await context.models.Automation?.get({ id: input.automationId });
  const configuration = configurationObject?.spec;
  if (configuration?.state !== 'active' || configuration.accountId !== context.principal.id) throw new Error('Automation is suspended, missing, or not bound to the execution principal.');
  const existing = (await context.models.AutomationRun?.query({ where: { automationId: input.automationId, quotaWindow }, limit: 25 }))?.items ?? [];
  const maxPosts = Number(configuration.maxPostsPerDay);
  const maxUnits = Number(configuration.maxUnitsPerDay);
  if (!Number.isSafeInteger(maxPosts) || !Number.isSafeInteger(maxUnits)) throw new Error('Automation budget configuration is invalid.');
  if (existing.length >= maxPosts) throw new Error('Automation daily post quota is exhausted.');
  const committedOrReservedUnits = existing.reduce((total, candidate) => total + Number(candidate.spec.state === 'running' ? candidate.spec.reservedUnits : candidate.spec.usageUnits), 0);
  const reservation = Math.max(1, Math.floor(maxUnits / maxPosts));
  if (!Number.isSafeInteger(committedOrReservedUnits) || committedOrReservedUnits + reservation > maxUnits) throw new Error('Automation daily generation-unit quota is exhausted.');
  run.patch({ spec: { quotaWindow, state: 'running', startedAt: context.now, usageUnits: '0', reservedUnits: String(reservation) } });
  context.emit(AutomationRunChanged, { runId: run.id, automationId: input.automationId, state: 'running', changedAt: context.now });
});

AutomationRunBase.update.beforeCommit({ transaction: { models: [AutomationBase] }, events: [AutomationRunChanged], history: true }, async (run, input, context) => {
  if (context.principal?.claims?.role !== 'automation-worker' || context.principal.claims.automationId !== run.value.automationId) throw new Error('Automation runs require an Applik8s-issued automation execution principal bound to the target automation.');
  if ('id' in input.patch || 'automationId' in input.patch || 'scheduledFor' in input.patch || 'quotaWindow' in input.patch || 'reservedUnits' in input.patch || 'startedAt' in input.patch || 'finishedAt' in input.patch || 'revision' in input.patch) throw new Error('Automation run identity, schedule, quota window, reservation, timestamps, and revision are server-owned.');
  if (!['published', 'rejected', 'failed'].includes(run.value.state)) throw new Error('A running automation may transition only to a terminal state.');
  const usageUnits = Number(run.value.usageUnits);
  const reservedUnits = Number(run.value.reservedUnits);
  if (!Number.isSafeInteger(usageUnits) || usageUnits < 0 || !Number.isSafeInteger(reservedUnits) || reservedUnits < 1 || (usageUnits > reservedUnits && run.value.state !== 'rejected')) throw new Error('A publishable automation run may not exceed its transactionally reserved unit budget.');
  if (run.value.state === 'published' && (!run.value.publishedPostId || run.value.resultReference !== `post:${run.value.publishedPostId}`)) throw new Error('A published automation run requires its durable post reference.');
  if (run.value.state !== 'published' && run.value.publishedPostId) throw new Error('Only a published automation run may reference a post.');
  run.patch({ spec: { finishedAt: context.now } });
  context.emit(AutomationRunChanged, { runId: run.id, automationId: run.value.automationId, state: run.value.state as 'scheduled' | 'running' | 'published' | 'rejected' | 'failed', changedAt: context.now, ...(run.value.publishedPostId ? { postId: run.value.publishedPostId } : {}) });
});

AutomationRunBase.delete.beforeCommit({ history: true }, async (run, _input, context) => {
  if (!context.principal || (context.principal.id !== `automation:${run.value.automationId}` && context.principal.claims?.role !== 'automation-worker')) throw new Error('Automation runs require an Applik8s-issued automation execution principal.');
});

export const AutomationRun = AutomationRunBase.view('recent', {
  input: type({ 'limit?': 'number.integer >= 1' }),
  output: type({
    id: 'string', automationId: 'string', scheduledFor: 'string', quotaWindow: 'string',
    state: 'string', publishedPostId: 'string | null', usageUnits: 'string', reservedUnits: 'string',
    resultReference: 'string | null', startedAt: 'string | null', finishedAt: 'string | null',
  }).array(),
  database: Database,
  reads: [AutomationBase],
  authorize: ({ principal }) => principal.id.length > 0,
  run: async ({ context, input, principal }) => context.database(Database).select({
    id: AutomationRunBase.id,
    automationId: AutomationRunBase.automationId,
    scheduledFor: AutomationRunBase.scheduledFor,
    quotaWindow: AutomationRunBase.quotaWindow,
    state: AutomationRunBase.state,
    publishedPostId: AutomationRunBase.publishedPostId,
    usageUnits: AutomationRunBase.usageUnits,
    reservedUnits: AutomationRunBase.reservedUnits,
    resultReference: AutomationRunBase.resultReference,
    startedAt: AutomationRunBase.startedAt,
    finishedAt: AutomationRunBase.finishedAt,
  }).from(AutomationRunBase)
    .innerJoin(AutomationBase, eq(AutomationRunBase.automationId, AutomationBase.id))
    .where(eq(AutomationBase.ownerId, principal.id))
    .orderBy(desc(AutomationRunBase.scheduledFor))
    .limit(Math.min(input.limit ?? 25, 50)),
  budgets: { maxRows: 50, maxResultBytes: 256_000, timeoutMs: 2_000 },
});
