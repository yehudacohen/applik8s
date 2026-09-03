// typecast-file-boundary: migration phase tables preserve literal protocol identities while the state machine validates persisted transitions before use.
import {
  type ApplicationDeploymentMigrationMapping,
  type ApplicationDeploymentMigrationProposal,
  type ApplicationPhysicalIdentity,
  applicationPhysicalIdentityKey,
} from './application-deployment-migration-proposal.js';
import { canonicalJsonV1String } from './canonical-json.js';

export const applicationDeploymentMigrationRunVersion = 'applik8s.deploymentMigrationRun/v1alpha1' as const;

export type ApplicationDeploymentMigrationPhase =
  | 'proposed'
  | 'sourceVerified'
  | 'mapped'
  | 'targetPrepared'
  | 'authorityPending'
  | 'sourceFenced'
  | 'targetAuthorized'
  | 'targetReady'
  | 'committed'
  | 'legacyRetired'
  | 'completed'
  | 'rollbackRequested'
  | 'rolledBack'
  | 'rollbackBlocked'
  | 'blocked'
  | 'failedUnknown';

export type ApplicationDeploymentMigrationOperation =
  | 'verifySource'
  | 'prepareTarget'
  | 'fenceSource'
  | 'activateTarget'
  | 'observeTargetReady'
  | 'retireLegacy'
  | 'rollbackTarget'
  | 'reactivateSource';

export interface ApplicationDeploymentMigrationLease {
  readonly owner: string;
  readonly epoch: number;
  readonly expiresAt: string;
}

export interface ApplicationDeploymentMigrationReceipt {
  readonly id: string;
  readonly operation: ApplicationDeploymentMigrationOperation;
  readonly mapping: string;
  readonly operationId: string;
  readonly recordedAt: string;
  readonly outcome: 'succeeded' | 'absent' | 'unknown';
  readonly observedPhysicalIdentity?: ApplicationPhysicalIdentity;
  readonly providerReceipt?: string;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface ApplicationDeploymentMigrationHandoff {
  readonly mapping: string;
  readonly revision: number;
  readonly epoch: number;
  readonly active: 'source' | 'migration' | 'target' | 'none';
  readonly sourceFenceReceipt?: string;
  readonly targetActivationReceipt?: string;
}

export interface ApplicationDeploymentMigrationFailure {
  readonly code:
    | 'MIGRATION_CONCURRENT_OPERATION'
    | 'MIGRATION_PROVIDER_INCOMPATIBLE'
    | 'MIGRATION_LIFECYCLE_TRANSFER_UNSAFE'
    | 'MIGRATION_ROLLBACK_UNAVAILABLE'
    | 'MIGRATION_FORWARD_RECOVERY_REQUIRED';
  readonly message: string;
  readonly operation?: ApplicationDeploymentMigrationOperation;
  readonly mapping?: string;
}

export interface ApplicationDeploymentMigrationRun {
  readonly schemaVersion: typeof applicationDeploymentMigrationRunVersion;
  readonly id: string;
  readonly deployment: string;
  readonly proposalDigest: string;
  readonly proposal: ApplicationDeploymentMigrationProposal;
  readonly phase: ApplicationDeploymentMigrationPhase;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lease?: ApplicationDeploymentMigrationLease;
  readonly receipts: readonly ApplicationDeploymentMigrationReceipt[];
  readonly handoffs: readonly ApplicationDeploymentMigrationHandoff[];
  readonly rollbackFrom?: ApplicationDeploymentMigrationPhase;
  readonly failure?: ApplicationDeploymentMigrationFailure;
}

type ApplicationDeploymentMigrationRunUpdate = Omit<
  Partial<ApplicationDeploymentMigrationRun>,
  'lease' | 'failure' | 'rollbackFrom'
> & {
  readonly lease?: ApplicationDeploymentMigrationLease | undefined;
  readonly failure?: ApplicationDeploymentMigrationFailure | undefined;
  readonly rollbackFrom?: ApplicationDeploymentMigrationPhase | undefined;
};

export interface ApplicationDeploymentMigrationRunStore {
  read(id: string): Promise<ApplicationDeploymentMigrationRun | undefined>;
  create(run: ApplicationDeploymentMigrationRun): Promise<ApplicationDeploymentMigrationRun>;
  compareAndSwap(input: {
    readonly id: string;
    readonly expectedRevision: number;
    readonly next: ApplicationDeploymentMigrationRun;
  }): Promise<ApplicationDeploymentMigrationRun | undefined>;
}

export interface ApplicationDeploymentMigrationProviderContext {
  readonly run: ApplicationDeploymentMigrationRun;
  readonly mapping: ApplicationDeploymentMigrationMapping;
  readonly operationId: string;
  readonly expectedPhysicalIdentity?: ApplicationPhysicalIdentity;
}

export interface ApplicationDeploymentMigrationProvider {
  verifySource(context: ApplicationDeploymentMigrationProviderContext): Promise<ApplicationDeploymentMigrationReceipt>;
  prepareTarget(context: ApplicationDeploymentMigrationProviderContext): Promise<ApplicationDeploymentMigrationReceipt>;
  fenceSource(context: ApplicationDeploymentMigrationProviderContext): Promise<ApplicationDeploymentMigrationReceipt>;
  activateTarget(context: ApplicationDeploymentMigrationProviderContext): Promise<ApplicationDeploymentMigrationReceipt>;
  observeTargetReady(context: ApplicationDeploymentMigrationProviderContext): Promise<ApplicationDeploymentMigrationReceipt>;
  retireLegacy(context: ApplicationDeploymentMigrationProviderContext): Promise<ApplicationDeploymentMigrationReceipt>;
  rollbackTarget(context: ApplicationDeploymentMigrationProviderContext): Promise<ApplicationDeploymentMigrationReceipt>;
  reactivateSource(context: ApplicationDeploymentMigrationProviderContext): Promise<ApplicationDeploymentMigrationReceipt>;
}

export class ApplicationDeploymentMigrationRunError extends Error {
  constructor(
    readonly code: ApplicationDeploymentMigrationFailure['code'],
    message: string,
    readonly run?: ApplicationDeploymentMigrationRun,
  ) {
    super(message);
    this.name = 'ApplicationDeploymentMigrationRunError';
  }
}

export class ApplicationDeploymentMigrationUnknownOutcomeError extends Error {
  constructor(
    message: string,
    readonly receipt: ApplicationDeploymentMigrationReceipt,
  ) {
    super(message);
    this.name = 'ApplicationDeploymentMigrationUnknownOutcomeError';
  }
}

export function createApplicationDeploymentMigrationRun(input: {
  readonly id: string;
  readonly deployment: string;
  readonly proposalDigest: string;
  readonly proposal: ApplicationDeploymentMigrationProposal;
  readonly now?: string;
}): ApplicationDeploymentMigrationRun {
  requireText(input.id, 'migration run ID');
  requireText(input.deployment, 'migration deployment identity');
  if (!/^sha256:[a-f0-9]{64}$/u.test(input.proposalDigest)) {
    throw new TypeError('migration proposalDigest must be a full lowercase sha256 digest.');
  }
  if (input.proposal.status !== 'ready' || input.proposal.diagnostics.some(({ severity }) => severity === 'error')) {
    throw new ApplicationDeploymentMigrationRunError(
      'MIGRATION_PROVIDER_INCOMPATIBLE',
      'A migration run cannot begin from a blocked read-only proposal.',
    );
  }
  const now = input.now ?? new Date().toISOString();
  return Object.freeze({
    schemaVersion: applicationDeploymentMigrationRunVersion,
    id: input.id,
    deployment: input.deployment,
    proposalDigest: input.proposalDigest,
    proposal: input.proposal,
    phase: 'proposed',
    revision: 0,
    createdAt: now,
    updatedAt: now,
    receipts: Object.freeze([]),
    handoffs: Object.freeze(input.proposal.mappings.map((mapping) => ({
      mapping: mapping.id,
      revision: 0,
      epoch: 0,
      active: initialAuthority(mapping),
    }))),
  });
}

export async function startApplicationDeploymentMigration(input: {
  readonly store: ApplicationDeploymentMigrationRunStore;
  readonly run: ApplicationDeploymentMigrationRun;
}): Promise<ApplicationDeploymentMigrationRun> {
  const existing = await input.store.read(input.run.id);
  if (existing) {
    if (existing.proposalDigest !== input.run.proposalDigest || existing.deployment !== input.run.deployment) {
      throw new ApplicationDeploymentMigrationRunError(
        'MIGRATION_CONCURRENT_OPERATION',
        `Migration run ${input.run.id} already exists for a different deployment or proposal.`,
        existing,
      );
    }
    return existing;
  }
  return input.store.create(input.run);
}

export async function advanceApplicationDeploymentMigration(input: {
  readonly store: ApplicationDeploymentMigrationRunStore;
  readonly provider: ApplicationDeploymentMigrationProvider;
  readonly runId: string;
  readonly owner: string;
  readonly leaseDurationMs?: number;
  readonly now?: () => Date;
  readonly stopAfterPhase?: ApplicationDeploymentMigrationPhase;
}): Promise<ApplicationDeploymentMigrationRun> {
  requireText(input.owner, 'migration owner');
  const now = input.now ?? (() => new Date());
  const leaseDurationMs = input.leaseDurationMs ?? 30_000;
  if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs < 1) {
    throw new TypeError('Migration leaseDurationMs must be a positive safe integer.');
  }
  let run = await acquireLease(input.store, input.runId, input.owner, now(), leaseDurationMs);
  while (!terminalPhases.has(run.phase)) {
    if (input.stopAfterPhase === run.phase) return run;
    run = await advanceOne({ ...input, run, now: now(), leaseDurationMs });
    if (input.stopAfterPhase === run.phase) return run;
  }
  return run;
}

export async function requestApplicationDeploymentMigrationRollback(input: {
  readonly store: ApplicationDeploymentMigrationRunStore;
  readonly provider: ApplicationDeploymentMigrationProvider;
  readonly runId: string;
  readonly owner: string;
  readonly leaseDurationMs?: number;
  readonly now?: () => Date;
}): Promise<ApplicationDeploymentMigrationRun> {
  const now = input.now ?? (() => new Date());
  const leaseDurationMs = input.leaseDurationMs ?? 30_000;
  let run = await acquireLease(input.store, input.runId, input.owner, now(), leaseDurationMs);
  if (hasCrossedCommitFrontier(run, run.phase) || (run.rollbackFrom && hasCrossedCommitFrontier(run, run.rollbackFrom))) {
    throw new ApplicationDeploymentMigrationRunError(
      'MIGRATION_FORWARD_RECOVERY_REQUIRED',
      `Migration ${run.id} crossed the commit frontier at ${run.phase}; recovery must move forward.`,
      run,
    );
  }
  if (run.phase === 'rolledBack') return run;
  if (run.phase === 'rollbackBlocked') {
    throw new ApplicationDeploymentMigrationRunError(
      'MIGRATION_ROLLBACK_UNAVAILABLE',
      run.failure?.message ?? `Migration ${run.id} rollback is blocked.`,
      run,
    );
  }
  if (run.phase !== 'rollbackRequested') {
    run = await persist(input.store, run, {
      phase: 'rollbackRequested',
      rollbackFrom: run.phase,
      failure: undefined,
      lease: renewedLease(run, input.owner, now(), leaseDurationMs),
    }, now());
  }
  try {
    for (const mapping of [...run.proposal.mappings].reverse()) {
      if (targetWasPrepared(run, mapping)) {
        run = await invokeAndPersist(input.store, input.provider, run, mapping, 'rollbackTarget', input.owner, now(), leaseDurationMs);
      }
      if (sourceWasFenced(run, mapping)) {
        run = await invokeAndPersist(input.store, input.provider, run, mapping, 'reactivateSource', input.owner, now(), leaseDurationMs);
      }
    }
    return persist(input.store, run, {
      phase: 'rolledBack',
      handoffs: run.handoffs.map((handoff) => ({
        ...handoff,
        revision: handoff.revision + 1,
        epoch: handoff.epoch + 1,
        active: handoff.active === 'target' || handoff.active === 'migration' || handoff.active === 'none'
          ? 'source'
          : handoff.active,
      })),
      lease: undefined,
    }, now());
  } catch (cause) {
    const blocked = await persist(input.store, run, {
      phase: 'rollbackBlocked',
      failure: failure('MIGRATION_ROLLBACK_UNAVAILABLE', cause),
      lease: undefined,
    }, now());
    throw new ApplicationDeploymentMigrationRunError(
      'MIGRATION_ROLLBACK_UNAVAILABLE',
      blocked.failure?.message ?? 'Migration rollback is blocked.',
      blocked,
    );
  }
}

/**
 * Records a conclusive observation for an earlier unknown outcome and restores
 * the exact persisted phase so normal forward recovery can resume.
 */
export async function resolveApplicationDeploymentMigrationUnknownOutcome(input: {
  readonly store: ApplicationDeploymentMigrationRunStore;
  readonly runId: string;
  readonly owner: string;
  readonly resolution: ApplicationDeploymentMigrationReceipt;
  readonly now?: Date;
  readonly leaseDurationMs?: number;
}): Promise<ApplicationDeploymentMigrationRun> {
  requireText(input.owner, 'migration resolution owner');
  const now = input.now ?? new Date();
  const run = await acquireLease(
    input.store,
    input.runId,
    input.owner,
    now,
    input.leaseDurationMs ?? 30_000,
    true,
  );
  if (run.phase !== 'failedUnknown' || !run.rollbackFrom) {
    throw new ApplicationDeploymentMigrationRunError(
      'MIGRATION_FORWARD_RECOVERY_REQUIRED',
      `Migration ${run.id} has no unresolved provider outcome.`,
      run,
    );
  }
  const unknown = run.receipts.find((receipt) =>
    receipt.outcome === 'unknown' && receipt.operationId === input.resolution.operationId);
  if (!unknown || input.resolution.outcome === 'unknown') {
    throw new ApplicationDeploymentMigrationRunError(
      'MIGRATION_FORWARD_RECOVERY_REQUIRED',
      `Migration ${run.id} has no conclusive resolution for ${input.resolution.operationId}.`,
      run,
    );
  }
  if (
    input.resolution.operation !== unknown.operation
    || input.resolution.mapping !== unknown.mapping
    || !input.resolution.id.trim()
    || !Number.isFinite(Date.parse(input.resolution.recordedAt))
  ) {
    throw new ApplicationDeploymentMigrationRunError(
      'MIGRATION_FORWARD_RECOVERY_REQUIRED',
      `Migration resolution does not match unknown operation ${unknown.operationId}.`,
      run,
    );
  }
  return persist(input.store, run, {
    phase: run.rollbackFrom,
    rollbackFrom: undefined,
    failure: undefined,
    lease: undefined,
    receipts: run.receipts.map((receipt) =>
      receipt.operationId === unknown.operationId ? Object.freeze({ ...input.resolution }) : receipt),
  }, now);
}

/** Selects the last durably recorded lifecycle authority for deletion. */
export function applicationDeploymentMigrationDeletionAuthority(
  run: ApplicationDeploymentMigrationRun,
): 'source' | 'migration' | 'target' | 'external' | 'blocked' {
  const authorities = new Set(run.handoffs.map(({ active }) => active));
  if (authorities.has('migration')) return 'migration';
  if (authorities.has('target')) return 'target';
  if (authorities.has('source')) return 'source';
  if (run.proposal.mappings.every(({ disposition }) => disposition === 'external')) return 'external';
  return 'blocked';
}

export function createMemoryApplicationDeploymentMigrationRunStore(
  initial: readonly ApplicationDeploymentMigrationRun[] = [],
): ApplicationDeploymentMigrationRunStore {
  const records = new Map(initial.map((run) => [run.id, run]));
  return {
    async read(id) { return records.get(id); },
    async create(run) {
      if (records.has(run.id)) {
        throw new ApplicationDeploymentMigrationRunError(
          'MIGRATION_CONCURRENT_OPERATION',
          `Migration run ${run.id} already exists.`,
          records.get(run.id),
        );
      }
      records.set(run.id, run);
      return run;
    },
    async compareAndSwap({ id, expectedRevision, next }) {
      const current = records.get(id);
      if (!current || current.revision !== expectedRevision) return undefined;
      records.set(id, next);
      return next;
    },
  };
}

export function serializeApplicationDeploymentMigrationRun(run: ApplicationDeploymentMigrationRun): string {
  return canonicalJsonV1String(run);
}

async function advanceOne(input: {
  readonly store: ApplicationDeploymentMigrationRunStore;
  readonly provider: ApplicationDeploymentMigrationProvider;
  readonly run: ApplicationDeploymentMigrationRun;
  readonly owner: string;
  readonly now: Date;
  readonly leaseDurationMs: number;
}): Promise<ApplicationDeploymentMigrationRun> {
  let run = input.run;
  assertLease(run, input.owner, input.now);
  try {
    switch (run.phase) {
      case 'proposed':
        run = await invokeForMappings(input, run, 'verifySource', sourceMappings(run));
        return persist(input.store, run, phaseUpdate(run, 'sourceVerified', input), input.now);
      case 'sourceVerified':
        return persist(input.store, run, phaseUpdate(run, 'mapped', input), input.now);
      case 'mapped':
        run = await invokeForMappings(input, run, 'prepareTarget', targetMappings(run));
        return persist(input.store, run, phaseUpdate(run, 'targetPrepared', input), input.now);
      case 'targetPrepared':
        return persist(input.store, run, {
          ...phaseUpdate(run, 'authorityPending', input),
        }, input.now);
      case 'authorityPending':
        run = await invokeForMappings(input, run, 'fenceSource', authorityMappings(run));
        return persist(input.store, run, {
          ...phaseUpdate(run, 'sourceFenced', input),
          handoffs: receiptsToHandoffs(run, 'fenceSource', 'none'),
        }, input.now);
      case 'sourceFenced':
        run = await invokeForMappings(input, run, 'activateTarget', targetMappings(run));
        return persist(input.store, run, {
          ...phaseUpdate(run, 'targetAuthorized', input),
          handoffs: receiptsToHandoffs(run, 'activateTarget', 'target'),
        }, input.now);
      case 'targetAuthorized':
        run = await invokeForMappings(input, run, 'observeTargetReady', targetMappings(run));
        return persist(input.store, run, phaseUpdate(run, 'targetReady', input), input.now);
      case 'targetReady':
        return persist(input.store, run, phaseUpdate(run, 'committed', input), input.now);
      case 'committed':
        run = await invokeForMappings(input, run, 'retireLegacy', retirementMappings(run));
        return persist(input.store, run, phaseUpdate(run, 'legacyRetired', input), input.now);
      case 'legacyRetired':
        return persist(input.store, run, { phase: 'completed', lease: undefined }, input.now);
      case 'rollbackRequested':
      case 'rolledBack':
      case 'rollbackBlocked':
      case 'blocked':
      case 'failedUnknown':
      case 'completed':
        return run;
    }
  } catch (cause) {
    const unknown = cause instanceof ApplicationDeploymentMigrationUnknownOutcomeError;
    const failed = await persist(input.store, run, {
      phase: unknown ? 'failedUnknown' : 'blocked',
      failure: failure(
        unknown ? 'MIGRATION_FORWARD_RECOVERY_REQUIRED' : 'MIGRATION_PROVIDER_INCOMPATIBLE',
        cause,
      ),
      rollbackFrom: run.phase,
      ...(unknown ? { receipts: appendReceipt(run.receipts, cause.receipt) } : {}),
      lease: undefined,
    }, input.now);
    throw new ApplicationDeploymentMigrationRunError(
      failed.failure?.code ?? 'MIGRATION_PROVIDER_INCOMPATIBLE',
      failed.failure?.message ?? 'Migration failed.',
      failed,
    );
  }
}

async function invokeForMappings(
  input: Parameters<typeof advanceOne>[0],
  startingRun: ApplicationDeploymentMigrationRun,
  operation: ApplicationDeploymentMigrationOperation,
  mappings: readonly ApplicationDeploymentMigrationMapping[],
): Promise<ApplicationDeploymentMigrationRun> {
  let run = startingRun;
  for (const mapping of mappings) {
    run = await invokeAndPersist(
      input.store,
      input.provider,
      run,
      mapping,
      operation,
      input.owner,
      input.now,
      input.leaseDurationMs,
    );
  }
  return run;
}

async function invokeAndPersist(
  store: ApplicationDeploymentMigrationRunStore,
  provider: ApplicationDeploymentMigrationProvider,
  run: ApplicationDeploymentMigrationRun,
  mapping: ApplicationDeploymentMigrationMapping,
  operation: ApplicationDeploymentMigrationOperation,
  owner: string,
  now: Date,
  leaseDurationMs: number,
): Promise<ApplicationDeploymentMigrationRun> {
  const operationId = `${run.id}:${operation}:${mapping.id}`;
  const existing = run.receipts.find((receipt) => receipt.operationId === operationId);
  if (existing?.outcome === 'succeeded' || existing?.outcome === 'absent') return run;
  const expectedPhysicalIdentity = operation === 'verifySource' || operation === 'fenceSource' || operation === 'retireLegacy' || operation === 'reactivateSource'
    ? mapping.sourcePhysicalIdentity
    : mapping.targetPhysicalIdentity;
  const receipt = await provider[operation]({
    run,
    mapping,
    operationId,
    ...(expectedPhysicalIdentity ? { expectedPhysicalIdentity } : {}),
  });
  validateReceipt(receipt, operation, mapping, operationId, expectedPhysicalIdentity);
  if (receipt.outcome === 'unknown') {
    throw new ApplicationDeploymentMigrationUnknownOutcomeError(
      `Migration operation ${operationId} has an unknown provider outcome.`,
      receipt,
    );
  }
  return persist(store, run, {
    receipts: appendReceipt(run.receipts, receipt),
    lease: renewedLease(run, owner, now, leaseDurationMs),
  }, now);
}

async function acquireLease(
  store: ApplicationDeploymentMigrationRunStore,
  runId: string,
  owner: string,
  now: Date,
  leaseDurationMs: number,
  allowUnknownRecovery = false,
): Promise<ApplicationDeploymentMigrationRun> {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const run = await store.read(runId);
    if (!run) throw new Error(`Migration run ${runId} does not exist.`);
    if (terminalPhases.has(run.phase) && !(allowUnknownRecovery && run.phase === 'failedUnknown')) return run;
    const currentLease = run.lease;
    if (currentLease && currentLease.owner !== owner && Date.parse(currentLease.expiresAt) > now.getTime()) {
      throw new ApplicationDeploymentMigrationRunError(
        'MIGRATION_CONCURRENT_OPERATION',
        `Migration ${runId} is leased by ${currentLease.owner} until ${currentLease.expiresAt}.`,
        run,
      );
    }
    const next = snapshotRun(run, {
      lease: {
        owner,
        epoch: currentLease?.owner === owner ? currentLease.epoch : (currentLease?.epoch ?? 0) + 1,
        expiresAt: new Date(now.getTime() + leaseDurationMs).toISOString(),
      },
      revision: run.revision + 1,
      updatedAt: now.toISOString(),
    });
    const acquired = await store.compareAndSwap({ id: runId, expectedRevision: run.revision, next });
    if (acquired) return acquired;
  }
  throw new ApplicationDeploymentMigrationRunError(
    'MIGRATION_CONCURRENT_OPERATION',
    `Migration ${runId} lease could not be acquired after concurrent updates.`,
  );
}

async function persist(
  store: ApplicationDeploymentMigrationRunStore,
  run: ApplicationDeploymentMigrationRun,
  update: ApplicationDeploymentMigrationRunUpdate,
  now: Date,
): Promise<ApplicationDeploymentMigrationRun> {
  const next = snapshotRun(run, {
    ...update,
    revision: run.revision + 1,
    updatedAt: now.toISOString(),
  });
  const persisted = await store.compareAndSwap({ id: run.id, expectedRevision: run.revision, next });
  if (!persisted) {
    throw new ApplicationDeploymentMigrationRunError(
      'MIGRATION_CONCURRENT_OPERATION',
      `Migration ${run.id} changed at revision ${run.revision}; the stale owner cannot commit.`,
      await store.read(run.id),
    );
  }
  return persisted;
}

function snapshotRun(
  run: ApplicationDeploymentMigrationRun,
  update: ApplicationDeploymentMigrationRunUpdate,
): ApplicationDeploymentMigrationRun {
  const {
    lease: currentLease,
    failure: currentFailure,
    rollbackFrom: currentRollbackFrom,
    ...current
  } = run;
  const {
    lease: nextLease,
    failure: nextFailure,
    rollbackFrom: nextRollbackFrom,
    ...next
  } = update;
  const lease = Object.hasOwn(update, 'lease') ? nextLease : currentLease;
  const failureValue = Object.hasOwn(update, 'failure') ? nextFailure : currentFailure;
  const rollbackFrom = Object.hasOwn(update, 'rollbackFrom') ? nextRollbackFrom : currentRollbackFrom;
  return Object.freeze({
    ...current,
    ...next,
    receipts: Object.freeze([...(update.receipts ?? run.receipts)]),
    handoffs: Object.freeze([...(update.handoffs ?? run.handoffs)]),
    ...(lease ? { lease } : {}),
    ...(failureValue ? { failure: failureValue } : {}),
    ...(rollbackFrom ? { rollbackFrom } : {}),
  });
}

function phaseUpdate(
  run: ApplicationDeploymentMigrationRun,
  phase: ApplicationDeploymentMigrationPhase,
  input: { readonly owner: string; readonly now: Date; readonly leaseDurationMs: number },
): ApplicationDeploymentMigrationRunUpdate {
  return {
    phase,
    lease: phase === 'completed' ? undefined : renewedLease(run, input.owner, input.now, input.leaseDurationMs),
    failure: undefined,
  };
}

function renewedLease(run: ApplicationDeploymentMigrationRun, owner: string, now: Date, leaseDurationMs: number) {
  return {
    owner,
    epoch: run.lease?.epoch ?? 1,
    expiresAt: new Date(now.getTime() + leaseDurationMs).toISOString(),
  };
}

function assertLease(run: ApplicationDeploymentMigrationRun, owner: string, now: Date): void {
  if (!run.lease || run.lease.owner !== owner || Date.parse(run.lease.expiresAt) <= now.getTime()) {
    throw new ApplicationDeploymentMigrationRunError(
      'MIGRATION_CONCURRENT_OPERATION',
      `Migration ${run.id} does not have a current lease for ${owner}.`,
      run,
    );
  }
}

function validateReceipt(
  receipt: ApplicationDeploymentMigrationReceipt,
  operation: ApplicationDeploymentMigrationOperation,
  mapping: ApplicationDeploymentMigrationMapping,
  operationId: string,
  expectedPhysicalIdentity?: ApplicationPhysicalIdentity,
): void {
  if (receipt.operation !== operation || receipt.mapping !== mapping.id || receipt.operationId !== operationId) {
    throw new Error(`Provider returned a receipt for the wrong migration operation ${operationId}.`);
  }
  if (!receipt.id.trim() || !Number.isFinite(Date.parse(receipt.recordedAt))) {
    throw new Error(`Provider returned an invalid receipt for migration operation ${operationId}.`);
  }
  if (expectedPhysicalIdentity && receipt.outcome === 'succeeded') {
    if (!receipt.observedPhysicalIdentity) {
      throw new Error(`Provider receipt ${receipt.id} did not prove the expected physical identity.`);
    }
    if (applicationPhysicalIdentityKey(receipt.observedPhysicalIdentity) !== applicationPhysicalIdentityKey(expectedPhysicalIdentity)) {
      throw new Error(`Provider receipt ${receipt.id} observed a different physical identity.`);
    }
  }
}

function appendReceipt(
  receipts: readonly ApplicationDeploymentMigrationReceipt[],
  receipt: ApplicationDeploymentMigrationReceipt,
): readonly ApplicationDeploymentMigrationReceipt[] {
  const sameOperation = receipts.find((candidate) => candidate.operationId === receipt.operationId);
  if (sameOperation && canonicalJsonV1String(sameOperation) !== canonicalJsonV1String(receipt)) {
    throw new Error(`Provider returned conflicting receipts for ${receipt.operationId}.`);
  }
  return sameOperation ? receipts : [...receipts, Object.freeze({ ...receipt })];
}

function receiptsToHandoffs(
  run: ApplicationDeploymentMigrationRun,
  operation: 'fenceSource' | 'activateTarget',
  active: 'none' | 'target',
): readonly ApplicationDeploymentMigrationHandoff[] {
  return run.handoffs.map((handoff) => {
    const receipt = [...run.receipts].reverse().find((candidate) =>
      candidate.mapping === handoff.mapping && candidate.operation === operation);
    if (!receipt) return handoff;
    return {
      ...handoff,
      revision: handoff.revision + 1,
      epoch: handoff.epoch + 1,
      active,
      ...(operation === 'fenceSource'
        ? { sourceFenceReceipt: receipt.id }
        : { targetActivationReceipt: receipt.id }),
    };
  });
}

function sourceMappings(run: ApplicationDeploymentMigrationRun) {
  return run.proposal.mappings.filter((mapping) => mapping.disposition !== 'external');
}

function targetMappings(run: ApplicationDeploymentMigrationRun) {
  return run.proposal.mappings.filter((mapping) =>
    mapping.targetNode !== undefined && mapping.disposition !== 'retain' && mapping.disposition !== 'external');
}

function authorityMappings(run: ApplicationDeploymentMigrationRun) {
  return run.proposal.mappings.filter((mapping) => mapping.lifecycleTransfer.requiresSourceFence);
}

function retirementMappings(run: ApplicationDeploymentMigrationRun) {
  return run.proposal.mappings.filter((mapping) =>
    mapping.disposition === 'replace' || mapping.disposition === 'retire' || mapping.disposition === 'preserve');
}

function initialAuthority(mapping: ApplicationDeploymentMigrationMapping): ApplicationDeploymentMigrationHandoff['active'] {
  if (mapping.disposition === 'external') return 'none';
  return mapping.lifecycleTransfer.sourceAuthority === 'legacy-deployment' ? 'source' : 'none';
}

function targetWasPrepared(run: ApplicationDeploymentMigrationRun, mapping: ApplicationDeploymentMigrationMapping): boolean {
  return run.receipts.some((receipt) => receipt.mapping === mapping.id && receipt.operation === 'prepareTarget' && receipt.outcome === 'succeeded');
}

function sourceWasFenced(run: ApplicationDeploymentMigrationRun, mapping: ApplicationDeploymentMigrationMapping): boolean {
  return run.receipts.some((receipt) => receipt.mapping === mapping.id && receipt.operation === 'fenceSource' && receipt.outcome === 'succeeded');
}

function failure(
  code: ApplicationDeploymentMigrationFailure['code'],
  cause: unknown,
): ApplicationDeploymentMigrationFailure {
  return {
    code,
    message: cause instanceof Error ? cause.message : String(cause),
    ...(cause instanceof ApplicationDeploymentMigrationUnknownOutcomeError
      ? { operation: cause.receipt.operation, mapping: cause.receipt.mapping }
      : {}),
  };
}

function requireText(value: string, label: string): void {
  if (!value.trim()) throw new TypeError(`${label} must not be empty.`);
}

const terminalPhases = new Set<ApplicationDeploymentMigrationPhase>([
  'completed',
  'rolledBack',
  'rollbackBlocked',
  'blocked',
  'failedUnknown',
]);

function hasCrossedCommitFrontier(
  run: ApplicationDeploymentMigrationRun,
  phase: ApplicationDeploymentMigrationPhase,
): boolean {
  const order: readonly ApplicationDeploymentMigrationPhase[] = [
    'proposed',
    'sourceVerified',
    'mapped',
    'targetPrepared',
    'authorityPending',
    'sourceFenced',
    'targetAuthorized',
    'targetReady',
    'committed',
    'legacyRetired',
    'completed',
  ];
  const observed = order.indexOf(phase);
  if (observed < 0) return false;
  return run.proposal.mappings.some(({ lifecycleTransfer }) => {
    const frontier = lifecycleTransfer.commitFrontier === 'target-authorized'
      ? 'targetAuthorized'
      : lifecycleTransfer.commitFrontier === 'target-ready'
        ? 'targetReady'
        : lifecycleTransfer.commitFrontier === 'retirement-complete'
          ? 'legacyRetired'
          : undefined;
    return frontier ? observed >= order.indexOf(frontier) : false;
  });
}
