// typecast-file-boundary: Coordinator commands cross process and journal boundaries and are discriminated before use.
import { createHash, randomUUID } from 'node:crypto';
import type {
  DevelopmentApprovalClass,
  DevelopmentChangePlan,
  DevelopmentContextAttachment,
  DevelopmentConversationReferent,
  DevelopmentValidationEvidence,
  DevelopmentVisualSelection,
} from './contracts.js';
import type { DevelopmentJournal } from './journal.js';
import { assertDevelopmentValueHasNoSecrets, redactDevelopmentValue } from './redaction.js';
import type { DevelopmentAppliedChange } from './workspace.js';
import { applyDevelopmentChange, undoDevelopmentChange } from './workspace.js';
import type { DevelopmentValidationCommands } from './validation.js';
import { runDevelopmentValidation } from './validation.js';

export interface DevelopmentCoordinatorOptions {
  readonly workspaceRoot: string;
  readonly projectId: string;
  readonly revision: () => string;
  readonly journal: DevelopmentJournal;
  readonly validationCommands?: DevelopmentValidationCommands;
  readonly knownSecretValues?: readonly string[];
}

export interface DevelopmentApplyOutcome {
  readonly change: DevelopmentAppliedChange;
  readonly evidence: readonly DevelopmentValidationEvidence[];
  readonly state: 'complete' | 'validation-failed';
}

/** Durable reviewed-change state machine. Provider output cannot bypass it. */
export class DevelopmentCoordinator {
  readonly #plans = new Map<string, DevelopmentChangePlan>();
  readonly #approvals = new Map<string, ReadonlySet<DevelopmentApprovalClass>>();
  readonly #applied = new Map<string, DevelopmentAppliedChange>();
  readonly #attachments = new Map<string, DevelopmentContextAttachment>();
  readonly #referents = new Map<string, DevelopmentConversationReferent>();
  #mutation: Promise<unknown> = Promise.resolve();

  private constructor(readonly options: DevelopmentCoordinatorOptions) {}

  static async open(options: DevelopmentCoordinatorOptions): Promise<DevelopmentCoordinator> {
    const coordinator = new DevelopmentCoordinator(options);
    const verification = await options.journal.verify();
    if (!verification.valid) throw new Error(verification.error ?? 'Development journal failed verification.');
    for (const event of await options.journal.events()) coordinator.#recover(event.kind, event.payload);
    return coordinator;
  }

  snapshot(): Readonly<Record<string, unknown>> {
    return {
      plans: [...this.#plans.values()].map((plan) => ({
        id: plan.id,
        summary: plan.summary,
        requestedOutcome: plan.requestedOutcome,
        approved: this.#approvals.has(plan.id),
        applied: this.#applied.has(plan.id),
        requiredApprovals: requiredApprovalClasses(plan),
        files: plan.files.map(({ path, classification }) => ({ path, classification })),
        semanticChanges: {
          graph: plan.graphChanges.length,
          schema: plan.schemaChanges.length,
          authority: plan.authorityChanges.length,
          infrastructure: plan.infrastructureChanges.length,
          dependencies: plan.dependencies.length,
        },
        risks: plan.risks,
        validation: plan.validation.map(({ id, commandClass }) => ({ id, commandClass })),
      })),
      attachments: [...this.#attachments.values()],
      referents: [...this.#referents.values()],
    };
  }

  context(
    attachmentIds: readonly string[] = [...this.#attachments.keys()],
    referentIds: readonly string[] = [...this.#referents.keys()],
  ): {
    readonly attachments: readonly DevelopmentContextAttachment[];
    readonly referents: readonly DevelopmentConversationReferent[];
  } {
    const attachments = attachmentIds.map((id) => {
      const attachment = this.#attachments.get(id);
      if (!attachment) throw new Error(`Unknown development attachment ${id}.`);
      return attachment;
    });
    const referents = referentIds.map((id) => {
      const referent = this.#referents.get(id);
      if (!referent) throw new Error(`Unknown development referent ${id}.`);
      return referent;
    });
    return { attachments, referents };
  }

  async removeAttachment(id: string): Promise<void> {
    if (!this.#attachments.delete(id)) throw new Error(`Unknown development attachment ${id}.`);
    for (const [referentId, referent] of this.#referents) {
      if (!referent.attachmentIds.includes(id)) continue;
      this.#referents.set(referentId, {
        ...referent,
        attachmentIds: referent.attachmentIds.filter((candidate) => candidate !== id),
        resolution: 'partial',
      });
    }
    await this.options.journal.append('attachment.removed', { attachmentId: id });
  }

  async admitSelection(selection: DevelopmentVisualSelection): Promise<DevelopmentContextAttachment> {
    assertSelection(selection, this.options.revision());
    const payload = redactDevelopmentValue(
      JSON.parse(JSON.stringify(selection)),
      this.options.knownSecretValues ?? [],
    ) as Readonly<Record<string, unknown>>;
    const attachment: DevelopmentContextAttachment = {
      id: `attachment_${randomUUID()}`,
      class: 'visualSelection',
      digest: digest(payload),
      capturedAtRevision: selection.capturedAtRevision,
      resolution: selection.sourceHints.length === 1 && selection.sourceHints[0]?.confidence === 'exact' ? 'exact' : selection.sourceHints.length > 0 ? 'candidate' : 'unresolved',
      redaction: selection.text?.redaction ?? 'none',
      payload,
    };
    this.#attachments.set(attachment.id, attachment);
    await this.options.journal.append('attachment.admitted', { attachment });
    return attachment;
  }

  async saveReferent(referent: DevelopmentConversationReferent): Promise<void> {
    if (!/^referent_[A-Za-z0-9_-]{6,128}$/u.test(referent.id) || !referent.label.trim()) throw new Error('Development referent identity or label is invalid.');
    for (const id of referent.attachmentIds) if (!this.#attachments.has(id)) throw new Error(`Development referent references unknown attachment ${id}.`);
    this.#referents.set(referent.id, Object.freeze({ ...referent, attachmentIds: [...referent.attachmentIds] }));
    await this.options.journal.append('referent.saved', { referent });
  }

  async propose(plan: DevelopmentChangePlan): Promise<void> {
    assertPlan(plan);
    assertDevelopmentValueHasNoSecrets(
      plan,
      this.options.knownSecretValues ?? [],
      `Development plan ${plan.id}`,
    );
    if (this.#plans.has(plan.id)) throw new Error(`Development plan ${plan.id} already exists.`);
    this.#plans.set(plan.id, plan);
    await this.options.journal.append('plan.proposed', { plan });
  }

  async approve(planId: string, classes: readonly DevelopmentApprovalClass[], principal: string): Promise<void> {
    const plan = this.#requiredPlan(planId);
    if (!principal.trim()) throw new Error('Development plan approval requires an authenticated developer identity.');
    const approved = new Set(classes);
    const missing = requiredApprovalClasses(plan).filter((entry) => !approved.has(entry));
    if (missing.length > 0) throw new Error(`Development plan approval is missing scope: ${missing.join(', ')}.`);
    this.#approvals.set(planId, approved);
    await this.options.journal.append('plan.approved', { planId, classes: [...approved].sort(), principal, revision: this.options.revision() });
  }

  apply(planId: string, signal?: AbortSignal): Promise<DevelopmentApplyOutcome> {
    return this.#serializeMutation(async () => {
      const plan = this.#requiredPlan(planId);
      if (!this.#approvals.has(planId)) throw new Error(`Development plan ${planId} has not been approved.`);
      if (this.#applied.has(planId)) throw new Error(`Development plan ${planId} was already applied.`);
      const change = await applyDevelopmentChange(this.options.workspaceRoot, plan);
      this.#applied.set(planId, change);
      await this.options.journal.append('plan.applied', { planId, change, revision: this.options.revision() });
      const evidence: DevelopmentValidationEvidence[] = [];
      for (const validation of plan.validation) {
        const result = await runDevelopmentValidation({
          planId,
          validation,
          revision: this.options.revision(),
          workspaceRoot: this.options.workspaceRoot,
          commands: this.options.validationCommands ?? {},
          ...(this.options.knownSecretValues ? { knownSecretValues: this.options.knownSecretValues } : {}),
          ...(signal ? { signal } : {}),
          onEvidence: async (item) => { await this.options.journal.append('validation.evidence', { evidence: item }); },
        });
        evidence.push(result);
        if (result.state !== 'passed') {
          await this.options.journal.append('plan.validation-failed', { planId, validationId: validation.id, state: result.state });
          return { change, evidence, state: 'validation-failed' as const };
        }
      }
      await this.options.journal.append('plan.completed', { planId, revision: this.options.revision(), evidenceIds: evidence.map(({ id }) => id) });
      return { change, evidence, state: 'complete' as const };
    });
  }

  undo(planId: string): Promise<void> {
    return this.#serializeMutation(async () => {
      const applied = this.#applied.get(planId);
      if (!applied) throw new Error(`Development plan ${planId} has no agent-owned applied change to undo.`);
      await undoDevelopmentChange(this.options.workspaceRoot, applied);
      this.#applied.delete(planId);
      await this.options.journal.append('plan.undone', { planId, changeId: applied.id, revision: this.options.revision() });
    });
  }

  #requiredPlan(id: string): DevelopmentChangePlan {
    const plan = this.#plans.get(id);
    if (!plan) throw new Error(`Unknown development plan ${id}.`);
    return plan;
  }

  #serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.#mutation.then(operation, operation);
    this.#mutation = next.then(() => undefined, () => undefined);
    return next;
  }

  #recover(kind: string, payload: Readonly<Record<string, unknown>>): void {
    if (kind === 'plan.proposed' && isPlan(payload.plan)) this.#plans.set(payload.plan.id, payload.plan);
    if (kind === 'plan.approved' && typeof payload.planId === 'string' && Array.isArray(payload.classes)) this.#approvals.set(payload.planId, new Set(payload.classes.filter(isApprovalClass)));
    if (kind === 'plan.applied' && typeof payload.planId === 'string' && isAppliedChange(payload.change)) this.#applied.set(payload.planId, payload.change);
    if (kind === 'plan.undone' && typeof payload.planId === 'string') this.#applied.delete(payload.planId);
    if (kind === 'attachment.admitted' && isAttachment(payload.attachment)) this.#attachments.set(payload.attachment.id, payload.attachment);
    if (kind === 'attachment.removed' && typeof payload.attachmentId === 'string') {
      this.#attachments.delete(payload.attachmentId);
      for (const [referentId, referent] of this.#referents) {
        if (!referent.attachmentIds.includes(payload.attachmentId)) continue;
        this.#referents.set(referentId, {
          ...referent,
          attachmentIds: referent.attachmentIds.filter((candidate) => candidate !== payload.attachmentId),
          resolution: 'partial',
        });
      }
    }
    if (kind === 'referent.saved' && isReferent(payload.referent)) this.#referents.set(payload.referent.id, payload.referent);
  }
}

function assertPlan(plan: DevelopmentChangePlan): void {
  if (!/^plan_[A-Za-z0-9_-]{6,128}$/u.test(plan.id) || !plan.summary.trim() || !plan.requestedOutcome.trim()) throw new Error('Development change plan identity, summary, and requested outcome are required.');
  const paths = new Set<string>();
  for (const file of plan.files) { if (paths.has(file.path)) throw new Error(`Development plan repeats file ${file.path}.`); paths.add(file.path); }
  const rollback = new Set(plan.rollbackBoundary.files);
  if (plan.files.some(({ path }) => !rollback.has(path))) throw new Error('Development plan rollback boundary must cover every mutated file.');
}

function assertSelection(selection: DevelopmentVisualSelection, revision: string): void {
  if (!/^selection_[A-Za-z0-9_-]{6,128}$/u.test(selection.id)) throw new Error('Development visual selection identity is invalid.');
  if (selection.capturedAtRevision !== revision) throw new Error('Development visual selection is stale for the current project revision.');
  if (!selection.route.pathname.startsWith('/') || selection.route.pathname.length > 2048) throw new Error('Development visual selection route is invalid.');
  if (Buffer.byteLength(JSON.stringify(selection)) > 64 * 1024) throw new Error('Development visual selection exceeds the 64KiB admission limit.');
  if ((selection.element?.boundedText?.length ?? 0) > 2_000 || (selection.text?.boundedValue.length ?? 0) > 4_000) throw new Error('Development visual selection contains unbounded page text.');
}

function requiredApprovalClasses(plan: DevelopmentChangePlan): readonly DevelopmentApprovalClass[] {
  return [...new Set<DevelopmentApprovalClass>([
    ...(plan.files.length > 0 ? ['source-mutation' as const] : []), ...plan.risks.map(({ approvalClass }) => approvalClass),
    ...(plan.dependencies.length > 0 ? ['dependency-change' as const] : []), ...(plan.schemaChanges.length > 0 ? ['schema-migration' as const] : []),
    ...(plan.authorityChanges.length > 0 ? ['authority-change' as const] : []), ...(plan.infrastructureChanges.length > 0 ? ['infrastructure-write' as const] : []),
  ])].sort();
}

function digest(value: unknown): `sha256:${string}` { return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`; }
function isPlan(value: unknown): value is DevelopmentChangePlan { return isRecord(value) && typeof Reflect.get(value, 'id') === 'string' && Array.isArray(Reflect.get(value, 'files')); }
function isAppliedChange(value: unknown): value is DevelopmentAppliedChange { return isRecord(value) && typeof Reflect.get(value, 'id') === 'string' && Array.isArray(Reflect.get(value, 'files')); }
function isAttachment(value: unknown): value is DevelopmentContextAttachment { return isRecord(value) && typeof Reflect.get(value, 'id') === 'string' && typeof Reflect.get(value, 'digest') === 'string'; }
function isReferent(value: unknown): value is DevelopmentConversationReferent { return isRecord(value) && typeof Reflect.get(value, 'id') === 'string' && Array.isArray(Reflect.get(value, 'attachmentIds')); }
function isApprovalClass(value: unknown): value is DevelopmentApprovalClass { return typeof value === 'string' && ['source-mutation', 'dependency-change', 'schema-migration', 'secret-access', 'public-exposure', 'authority-change', 'infrastructure-write', 'destructive-reset', 'workspace-expansion', 'maintainer-mode'].includes(value); }
function isRecord(value: unknown): value is object { return value !== null && typeof value === 'object' && !Array.isArray(value); }
