// typecast-file-boundary: PostgreSQL JSON receipts are validated by the schedule contract before they are returned.
import { randomUUID } from 'node:crypto';
import {
  type ApplicationScheduleAdmission,
  type ApplicationScheduleAdmissionRunner,
  type ApplicationScheduleHandle,
  type ApplicationScheduleOccurrenceReceipt,
  applicationScheduleOccurrenceId,
  executeApplicationScheduleAdmission,
} from '@applik8s/applik8s';
import postgres, { type Sql } from 'postgres';

export interface PostgresScheduleAdmissionAuthorityOptions<TInput extends object, TResult> {
  readonly databaseUrl: string;
  readonly handle: ApplicationScheduleHandle<TInput, TResult>;
  readonly admission: ApplicationScheduleAdmission;
  readonly signal?: AbortSignal;
  readonly afterCompletion?: () => Promise<void>;
  readonly admissionRunner?: ApplicationScheduleAdmissionRunner;
}

/**
 * Admits one provider-delivered occurrence under the canonical PostgreSQL
 * lease. Provider adapters supply transport evidence; this authority owns
 * deduplication, overlap fencing, prior receipts, and callback admission.
 */
export async function executePostgresApplicationScheduleAdmission<
  TInput extends object,
  TResult,
>(
  options: PostgresScheduleAdmissionAuthorityOptions<TInput, TResult>,
): Promise<ApplicationScheduleOccurrenceReceipt<TResult>> {
  const sql = postgres(required(options.databaseUrl, 'Schedule PostgreSQL occurrence authority'), { max: 2 });
  try {
    await ensureAuthority(sql);
    const occurrenceId = applicationScheduleOccurrenceId({
      applicationId: options.admission.applicationId,
      environmentId: options.admission.environmentId,
      definitionId: options.admission.definitionId,
      instanceId: options.admission.instanceId,
      scheduledAt: options.admission.scheduledAt,
      ...(options.admission.schedulerExecutionId
        ? { schedulerExecutionId: options.admission.schedulerExecutionId }
        : {}),
    });
    const overlapKey = options.handle.definition.overlapBy
      ? options.handle.definition.overlapBy((options.admission.input ?? {}) as TInput)
      : options.admission.instanceId;
    const claim = await claimOccurrence(sql, {
      occurrenceId,
      definitionId: options.admission.definitionId,
      instanceId: options.admission.instanceId,
      scheduledAt: options.admission.scheduledAt,
      overlapKey,
      overlap: options.handle.definition.overlap,
    });
    if (claim.state === 'complete') {
      return claim.receipt as ApplicationScheduleOccurrenceReceipt<TResult>;
    }
    if (claim.state === 'busy') {
      throw new ApplicationScheduleOccurrenceBusyError(occurrenceId);
    }
    if (claim.state === 'skipped') {
      return claim.receipt as ApplicationScheduleOccurrenceReceipt<TResult>;
    }
    const receipt = await executeApplicationScheduleAdmission(
      options.handle,
      options.admission,
      options.signal,
      options.admissionRunner,
    );
    if (receipt.state === 'succeeded' || receipt.state === 'skipped') {
      if (!await completeOccurrence(sql, occurrenceId, claim.owner, receipt)) {
        throw new Error(`Schedule occurrence ${occurrenceId} lost its durable execution lease.`);
      }
      await options.afterCompletion?.();
      return receipt;
    }
    const terminalFailure = admissionFailureIsTerminal(options);
    if (terminalFailure) {
      if (!await completeOccurrence(sql, occurrenceId, claim.owner, receipt)) {
        throw new Error(`Schedule occurrence ${occurrenceId} lost its durable execution lease.`);
      }
      return receipt;
    }
    await releaseOccurrence(sql, occurrenceId, claim.owner, receipt);
    return receipt;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export class ApplicationScheduleOccurrenceBusyError extends Error {
  readonly code = 'SCHEDULE_OCCURRENCE_BUSY';

  constructor(readonly occurrenceId: string) {
    super(`Schedule occurrence ${occurrenceId} is already executing under another lease.`);
    this.name = 'ApplicationScheduleOccurrenceBusyError';
  }
}

async function ensureAuthority(sql: Sql): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS applik8s_schedule_occurrences (
    occurrence_id text PRIMARY KEY,
    definition_id text NOT NULL,
    overlap_key text NOT NULL,
    state text NOT NULL CHECK (state IN ('running', 'succeeded', 'skipped')),
    lease_owner text,
    lease_until timestamptz,
    receipt jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS applik8s_schedule_occurrences_overlap ON applik8s_schedule_occurrences (definition_id, overlap_key, state, lease_until)`;
}

type Claim =
  | { readonly state: 'claimed'; readonly owner: string }
  | { readonly state: 'complete'; readonly receipt: unknown }
  | { readonly state: 'skipped'; readonly receipt: unknown }
  | { readonly state: 'busy' };

async function claimOccurrence(sql: Sql, options: {
  readonly occurrenceId: string;
  readonly definitionId: string;
  readonly instanceId: string;
  readonly scheduledAt: string;
  readonly overlapKey: string;
  readonly overlap: 'allow' | 'skip';
}): Promise<Claim> {
  return sql.begin(async (transaction) => {
    await transaction.unsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      [options.definitionId, options.overlapKey],
    );
    const prior = await transaction<{ state: string; receipt: unknown }[]>`
      SELECT state, receipt
      FROM applik8s_schedule_occurrences
      WHERE occurrence_id = ${options.occurrenceId}
    `;
    if (prior[0]?.state === 'succeeded' || prior[0]?.state === 'skipped') {
      return { state: 'complete', receipt: prior[0].receipt };
    }
    if (prior[0]?.state === 'running') {
      const reclaimed = await transaction<{ occurrence_id: string }[]>`
        UPDATE applik8s_schedule_occurrences
        SET lease_owner = ${randomUUID()},
            lease_until = now() + interval '5 minutes',
            updated_at = now()
        WHERE occurrence_id = ${options.occurrenceId}
          AND lease_until < now()
        RETURNING occurrence_id
      `;
      if (reclaimed.length === 0) return { state: 'busy' };
    }
    if (options.overlap === 'skip') {
      const active = await transaction<{ occurrence_id: string }[]>`
        SELECT occurrence_id
        FROM applik8s_schedule_occurrences
        WHERE definition_id = ${options.definitionId}
          AND overlap_key = ${options.overlapKey}
          AND state = 'running'
          AND lease_until >= now()
          AND occurrence_id <> ${options.occurrenceId}
        LIMIT 1
      `;
      if (active.length > 0) {
        const receipt = {
          occurrenceId: options.occurrenceId,
          definitionId: options.definitionId,
          instanceId: options.instanceId,
          scheduledAt: options.scheduledAt,
          state: 'skipped' as const,
          attempts: 0,
        };
        await transaction`
          INSERT INTO applik8s_schedule_occurrences
            (occurrence_id, definition_id, overlap_key, state, receipt)
          VALUES
            (${options.occurrenceId}, ${options.definitionId}, ${options.overlapKey}, 'skipped', ${transaction.json(receipt)})
          ON CONFLICT (occurrence_id) DO NOTHING
        `;
        return { state: 'skipped', receipt };
      }
    }
    const owner = randomUUID();
    await transaction`
      INSERT INTO applik8s_schedule_occurrences
        (occurrence_id, definition_id, overlap_key, state, lease_owner, lease_until)
      VALUES
        (${options.occurrenceId}, ${options.definitionId}, ${options.overlapKey}, 'running', ${owner}, now() + interval '5 minutes')
      ON CONFLICT (occurrence_id) DO UPDATE
      SET lease_owner = ${owner},
          lease_until = now() + interval '5 minutes',
          updated_at = now()
      WHERE applik8s_schedule_occurrences.state = 'running'
    `;
    return { state: 'claimed', owner };
  });
}

async function completeOccurrence(
  sql: Sql,
  id: string,
  owner: string,
  receipt: ApplicationScheduleOccurrenceReceipt,
): Promise<boolean> {
  // The released lease schema admits `succeeded` and `skipped` as terminal
  // states. Until its rolling format migration completes, a terminal failure
  // uses the latter storage sentinel while the canonical receipt retains
  // `state: failed`. Older readers already treat this row as terminal and
  // return the receipt instead of executing the effect again.
  const persistedState = receipt.state === 'failed' ? 'skipped' : receipt.state;
  const rows = await sql<{ occurrence_id: string }[]>`
    UPDATE applik8s_schedule_occurrences
    SET state = ${persistedState},
        receipt = ${sql.json(JSON.parse(JSON.stringify(receipt)))},
        lease_owner = NULL,
        lease_until = NULL,
        updated_at = now()
    WHERE occurrence_id = ${id}
      AND state = 'running'
      AND lease_owner = ${owner}
    RETURNING occurrence_id
  `;
  return rows.length === 1;
}

function admissionFailureIsTerminal<TInput extends object, TResult>(
  options: PostgresScheduleAdmissionAuthorityOptions<TInput, TResult>,
): boolean {
  if (options.admission.attempt >= options.handle.definition.retry.maxAttempts) return true;
  const scheduledAt = Date.parse(options.admission.scheduledAt);
  return Number.isFinite(scheduledAt)
    && Date.now() - scheduledAt >= options.handle.definition.retry.maximumAgeSeconds * 1_000;
}

async function releaseOccurrence(
  sql: Sql,
  id: string,
  owner: string,
  receipt: ApplicationScheduleOccurrenceReceipt,
): Promise<void> {
  await sql`
    UPDATE applik8s_schedule_occurrences
    SET receipt = ${sql.json(JSON.parse(JSON.stringify(receipt)))},
        lease_owner = NULL,
        lease_until = now(),
        updated_at = now()
    WHERE occurrence_id = ${id}
      AND state = 'running'
      AND lease_owner = ${owner}
  `;
}

function required(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} is required.`);
  return value;
}
