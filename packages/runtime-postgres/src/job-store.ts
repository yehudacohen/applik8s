// typecast-file-boundary: PostgreSQL JSONB rows cross into the versioned Job
// store contract only after the database constraints and row hydrator validate
// their identity, phase, lease, and terminal invariants.
import { createHash } from 'node:crypto';
import {
  type ApplicationJobClaimRequest,
  ApplicationJobLeaseLostError,
  type ApplicationJobLeaseToken,
  type ApplicationJobPayloadPurgeResult,
  type ApplicationJobStore,
  type ApplicationJobStoreAdmission,
  type ApplicationJobStoreAdmissionResult,
  type ApplicationJobStoredRun,
  ApplicationJobStoreInvariantError,
  applicationJobStoreProtocol,
} from '@applik8s/applik8s/job-store';
import {
  canonicalJsonCompatibleV1Policy,
  canonicalJsonV1String,
} from '@applik8s/core';
import postgres, { type Sql, type TransactionSql } from 'postgres';

export interface PostgresApplicationJobStoreOptions {
  readonly databaseUrl: string;
  readonly applicationId: string;
  readonly deploymentId: string;
  readonly maximumConnections?: number;
}

export interface PostgresApplicationJobStore extends ApplicationJobStore {
  close(): Promise<void>;
}

interface JobRow {
  readonly run_id: string;
  readonly job_id: string;
  readonly admitted_at: Date | string;
  readonly input: object;
  readonly input_digest: string;
  readonly admission: ApplicationJobStoredRun['admission'];
  readonly phase: ApplicationJobStoredRun['phase'];
  readonly attempt: number;
  readonly maximum_attempts: number;
  readonly available_at: Date | string;
  readonly deadline: Date | string | null;
  readonly idempotency_scope: string | null;
  readonly lease_owner: string | null;
  readonly lease_epoch: number;
  readonly lease_expires_at: Date | string | null;
  readonly progress: ApplicationJobStoredRun['progress'] | null;
  readonly progress_digest: string | null;
  readonly progress_expires_at: Date | string | null;
  readonly cancellation: ApplicationJobStoredRun['cancellation'] | null;
  readonly outcome: ApplicationJobStoredRun['outcome'] | null;
  readonly outcome_digest: string | null;
  readonly terminal_at: Date | string | null;
  readonly result_expires_at: Date | string | null;
}

/** PostgreSQL transactional authority for finite Job admission and attempt leases. */
export function createPostgresApplicationJobStore(
  options: PostgresApplicationJobStoreOptions,
): PostgresApplicationJobStore {
  const databaseUrl = nonEmpty(options.databaseUrl, 'PostgreSQL Job store databaseUrl');
  const applicationId = nonEmpty(options.applicationId, 'PostgreSQL Job store applicationId');
  const deploymentId = nonEmpty(options.deploymentId, 'PostgreSQL Job store deploymentId');
  const maximumConnections = positiveInteger(options.maximumConnections ?? 4, 'PostgreSQL Job store maximumConnections');
  const sql = postgres(databaseUrl, { max: maximumConnections });
  let initialized: Promise<void> | undefined;
  const ensure = () => (initialized ??= ensureJobStore(sql));

  const read = async (runId: string, executor: Sql | TransactionSql = sql): Promise<ApplicationJobStoredRun | undefined> => {
    const rows = await executor<JobRow[]>`
      SELECT ${executor.unsafe(jobColumns)}
      FROM applik8s_job_runs
      WHERE application_id = ${applicationId}
        AND deployment_id = ${deploymentId}
        AND run_id = ${runId}
    `;
    return rows[0] ? storedRun(rows[0]) : undefined;
  };

  const terminalOrLeaseLost = async (
    runId: string,
    lease: ApplicationJobLeaseToken,
    executor: Sql | TransactionSql = sql,
  ): Promise<ApplicationJobStoredRun> => {
    const current = await read(runId, executor);
    if (!current) throw new ApplicationJobStoreInvariantError(`Job run ${runId} does not exist.`);
    if (current.phase === 'terminal') return current;
    throw new ApplicationJobLeaseLostError(runId, lease.owner, lease.epoch);
  };

  return {
    protocol: applicationJobStoreProtocol,
    async admit(admission): Promise<ApplicationJobStoreAdmissionResult> {
      await ensure();
      validateAdmission(admission);
      return sql.begin(async (transaction) => {
        if (admission.idempotencyScope) {
          await lockIdempotency(transaction, applicationId, deploymentId, admission.idempotencyScope);
          const existing = await readByIdempotency(transaction, applicationId, deploymentId, admission.idempotencyScope);
          if (existing) {
            return {
              status: existing.inputDigest === digestInput(admission) ? 'existing' : 'conflict',
              run: existing,
            };
          }
        }
        const rows = await transaction<JobRow[]>`
          INSERT INTO applik8s_job_runs (
            application_id, deployment_id, run_id, job_id, admitted_at,
            input, input_digest, admission, phase, attempt, maximum_attempts,
            available_at, deadline, idempotency_scope
          ) VALUES (
            ${applicationId}, ${deploymentId}, ${admission.reference.runId},
            ${admission.reference.job}, ${admission.reference.admittedAt},
            ${transaction.json(jsonValue(admission.input))}, ${digestInput(admission)},
            ${transaction.json(jsonValue(admission.admission))}, 'queued', 0,
            ${admission.maximumAttempts}, ${admission.availableAt},
            ${admission.deadline ?? null}, ${admission.idempotencyScope ?? null}
          )
          RETURNING ${transaction.unsafe(jobColumns)}
        `;
        const row = rows[0];
        if (!row) throw new ApplicationJobStoreInvariantError('PostgreSQL did not return the admitted Job run.');
        return { status: 'admitted', run: storedRun(row) };
      });
    },
    async claim(request) {
      await ensure();
      validateClaim(request);
      return sql.begin(async (transaction) => {
        const rows = request.runId && request.jobs
          ? await transaction<{ readonly run_id: string }[]>`
              SELECT run_id
              FROM applik8s_job_runs
              WHERE application_id = ${applicationId}
                AND deployment_id = ${deploymentId}
                AND run_id = ${request.runId}
                AND job_id = ANY(${transaction.array([...request.jobs])}::text[])
                AND phase <> 'terminal'
                AND available_at <= ${request.now}
                AND (phase = 'queued' OR lease_expires_at IS NULL OR lease_expires_at <= ${request.now})
              FOR UPDATE SKIP LOCKED
              LIMIT 1
            `
          : request.runId
          ? await transaction<{ readonly run_id: string }[]>`
              SELECT run_id
              FROM applik8s_job_runs
              WHERE application_id = ${applicationId}
                AND deployment_id = ${deploymentId}
                AND run_id = ${request.runId}
                AND phase <> 'terminal'
                AND available_at <= ${request.now}
                AND (phase = 'queued' OR lease_expires_at IS NULL OR lease_expires_at <= ${request.now})
              FOR UPDATE SKIP LOCKED
              LIMIT 1
            `
          : request.jobs
          ? await transaction<{ readonly run_id: string }[]>`
              SELECT run_id
              FROM applik8s_job_runs
              WHERE application_id = ${applicationId}
                AND deployment_id = ${deploymentId}
                AND phase <> 'terminal'
                AND available_at <= ${request.now}
                AND (phase = 'queued' OR lease_expires_at IS NULL OR lease_expires_at <= ${request.now})
                AND job_id = ANY(${transaction.array([...request.jobs])}::text[])
              ORDER BY admitted_at, run_id
              FOR UPDATE SKIP LOCKED
              LIMIT 1
            `
          : await transaction<{ readonly run_id: string }[]>`
              SELECT run_id
              FROM applik8s_job_runs
              WHERE application_id = ${applicationId}
                AND deployment_id = ${deploymentId}
                AND phase <> 'terminal'
                AND available_at <= ${request.now}
                AND (phase = 'queued' OR lease_expires_at IS NULL OR lease_expires_at <= ${request.now})
              ORDER BY admitted_at, run_id
              FOR UPDATE SKIP LOCKED
              LIMIT 1
            `;
        const candidate = rows[0];
        if (!candidate) return undefined;
        const claimed = await transaction<JobRow[]>`
          UPDATE applik8s_job_runs
          SET phase = 'running',
              attempt = attempt + 1,
              lease_owner = ${request.owner},
              lease_epoch = lease_epoch + 1,
              lease_expires_at = (${request.now}::timestamptz + (${request.leaseSeconds} * interval '1 second')),
              updated_at = now()
          WHERE application_id = ${applicationId}
            AND deployment_id = ${deploymentId}
            AND run_id = ${candidate.run_id}
          RETURNING ${transaction.unsafe(jobColumns)}
        `;
        return claimed[0] ? storedRun(claimed[0]) : undefined;
      });
    },
    async heartbeat(runId, lease, now, leaseSeconds) {
      await ensure();
      positiveInteger(leaseSeconds, 'Job leaseSeconds');
      timestamp(now, 'Job heartbeat time');
      const rows = await sql<JobRow[]>`
        UPDATE applik8s_job_runs
        SET lease_expires_at = (${now}::timestamptz + (${leaseSeconds} * interval '1 second')),
            updated_at = now()
        WHERE application_id = ${applicationId}
          AND deployment_id = ${deploymentId}
          AND run_id = ${runId}
          AND phase <> 'terminal'
          AND lease_owner = ${lease.owner}
          AND lease_epoch = ${lease.epoch}
        RETURNING ${sql.unsafe(jobColumns)}
      `;
      return rows[0] ? storedRun(rows[0]) : terminalOrLeaseLost(runId, lease);
    },
    async recordProgress(write) {
      await ensure();
      assertChronology(write.recordedAt, write.expiresAt, 'Job progress expiry');
      const rows = await sql<JobRow[]>`
        UPDATE applik8s_job_runs
        SET progress = jsonb_build_object(
              'run', jsonb_build_object(
                'protocol', 'applik8s.jobRuntime/v1alpha1',
                'job', job_id,
                'runId', run_id,
                'admittedAt', to_char(admitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
              ),
              'sequence', COALESCE((progress->>'sequence')::int, 0) + 1,
              'recordedAt', ${write.recordedAt}::text,
              'value', ${sql.json(jsonValue(write.value))}
            ),
            progress_digest = ${digestValue(write.value)},
            progress_expires_at = ${write.expiresAt},
            updated_at = now()
        WHERE application_id = ${applicationId}
          AND deployment_id = ${deploymentId}
          AND run_id = ${write.runId}
          AND phase <> 'terminal'
          AND lease_owner = ${write.lease.owner}
          AND lease_epoch = ${write.lease.epoch}
        RETURNING ${sql.unsafe(jobColumns)}
      `;
      return rows[0] ? storedRun(rows[0]) : terminalOrLeaseLost(write.runId, write.lease);
    },
    async retry(write) {
      await ensure();
      timestamp(write.availableAt, 'Job retry availability');
      const rows = await sql<JobRow[]>`
        UPDATE applik8s_job_runs
        SET phase = 'queued', available_at = ${write.availableAt},
            lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
        WHERE application_id = ${applicationId}
          AND deployment_id = ${deploymentId}
          AND run_id = ${write.runId}
          AND phase <> 'terminal'
          AND attempt < maximum_attempts
          AND lease_owner = ${write.lease.owner}
          AND lease_epoch = ${write.lease.epoch}
        RETURNING ${sql.unsafe(jobColumns)}
      `;
      return rows[0] ? storedRun(rows[0]) : terminalOrLeaseLost(write.runId, write.lease);
    },
    async terminalize(write) {
      await ensure();
      assertChronology(write.terminalAt, write.resultExpiresAt, 'Job result expiry');
      const rows = await sql<JobRow[]>`
        UPDATE applik8s_job_runs
        SET phase = 'terminal', outcome = ${sql.json(jsonValue(write.outcome))},
            outcome_digest = ${digestValue(write.outcome)}, terminal_at = ${write.terminalAt},
            result_expires_at = ${write.resultExpiresAt}, lease_owner = NULL,
            lease_expires_at = NULL, updated_at = now()
        WHERE application_id = ${applicationId}
          AND deployment_id = ${deploymentId}
          AND run_id = ${write.runId}
          AND phase <> 'terminal'
          AND lease_owner = ${write.lease.owner}
          AND lease_epoch = ${write.lease.epoch}
        RETURNING ${sql.unsafe(jobColumns)}
      `;
      return rows[0] ? storedRun(rows[0]) : terminalOrLeaseLost(write.runId, write.lease);
    },
    async cancel(write) {
      await ensure();
      assertChronology(write.requestedAt, write.resultExpiresAt, 'Cancelled Job result expiry');
      return sql.begin(async (transaction) => {
        const currentRows = await transaction<JobRow[]>`
          SELECT ${transaction.unsafe(jobColumns)}
          FROM applik8s_job_runs
          WHERE application_id = ${applicationId}
            AND deployment_id = ${deploymentId}
            AND run_id = ${write.runId}
          FOR UPDATE
        `;
        const currentRow = currentRows[0];
        if (!currentRow) throw new ApplicationJobStoreInvariantError(`Job run ${write.runId} does not exist.`);
        const current = storedRun(currentRow);
        if (current.phase === 'terminal') return current;
        const cancellation = current.cancellation ?? {
          run: current.reference,
          requestedAt: write.requestedAt,
          ...(write.reason?.trim() ? { reason: write.reason.trim() } : {}),
        };
        const queuedOutcome = current.phase === 'queued'
          ? { status: 'cancelled' as const, ...(cancellation.reason ? { reason: cancellation.reason } : {}) }
          : undefined;
        const rows = await transaction<JobRow[]>`
          UPDATE applik8s_job_runs
          SET cancellation = ${transaction.json(jsonValue(cancellation))},
              phase = ${queuedOutcome ? 'terminal' : current.phase},
              outcome = ${queuedOutcome ? transaction.json(jsonValue(queuedOutcome)) : current.outcome ? transaction.json(jsonValue(current.outcome)) : null},
              outcome_digest = ${queuedOutcome ? digestValue(queuedOutcome) : current.outcomeDigest ?? null},
              terminal_at = ${queuedOutcome ? write.requestedAt : current.terminalAt ?? null},
              result_expires_at = ${queuedOutcome ? write.resultExpiresAt : current.resultExpiresAt ?? null},
              lease_owner = ${queuedOutcome ? null : current.lease?.owner ?? null},
              lease_expires_at = ${queuedOutcome ? null : current.lease?.expiresAt ?? null},
              updated_at = now()
          WHERE application_id = ${applicationId}
            AND deployment_id = ${deploymentId}
            AND run_id = ${write.runId}
          RETURNING ${transaction.unsafe(jobColumns)}
        `;
        const row = rows[0];
        if (!row) throw new ApplicationJobStoreInvariantError(`Job run ${write.runId} disappeared during cancellation.`);
        return storedRun(row);
      });
    },
    async read(runId) {
      await ensure();
      return read(runId);
    },
    async purge({ now }): Promise<ApplicationJobPayloadPurgeResult> {
      await ensure();
      return sql.begin(async (transaction) => {
        const outcomes = await transaction<{ readonly run_id: string }[]>`
          UPDATE applik8s_job_runs
          SET outcome = NULL, updated_at = now()
          WHERE application_id = ${applicationId}
            AND deployment_id = ${deploymentId}
            AND outcome IS NOT NULL
            AND result_expires_at <= ${now}
          RETURNING run_id
        `;
        const progress = await transaction<{ readonly run_id: string }[]>`
          UPDATE applik8s_job_runs
          SET progress = NULL, updated_at = now()
          WHERE application_id = ${applicationId}
            AND deployment_id = ${deploymentId}
            AND progress IS NOT NULL
            AND progress_expires_at <= ${now}
          RETURNING run_id
        `;
        return { outcomes: outcomes.length, progress: progress.length };
      });
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}

const jobColumns = `
  run_id, job_id, admitted_at, input, input_digest, admission, phase,
  attempt, maximum_attempts, available_at, deadline, idempotency_scope,
  lease_owner, lease_epoch, lease_expires_at, progress, progress_digest,
  progress_expires_at, cancellation, outcome, outcome_digest, terminal_at,
  result_expires_at
`;

async function ensureJobStore(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS applik8s_job_runs (
      application_id text NOT NULL,
      deployment_id text NOT NULL,
      run_id text NOT NULL,
      job_id text NOT NULL,
      admitted_at timestamptz NOT NULL,
      input jsonb NOT NULL,
      input_digest text NOT NULL,
      admission jsonb NOT NULL,
      phase text NOT NULL CHECK (phase IN ('queued', 'running', 'terminal')),
      attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
      maximum_attempts integer NOT NULL CHECK (maximum_attempts >= 1),
      available_at timestamptz NOT NULL,
      deadline timestamptz,
      idempotency_scope text,
      lease_owner text,
      lease_epoch integer NOT NULL DEFAULT 0 CHECK (lease_epoch >= 0),
      lease_expires_at timestamptz,
      progress jsonb,
      progress_digest text,
      progress_expires_at timestamptz,
      cancellation jsonb,
      outcome jsonb,
      outcome_digest text,
      terminal_at timestamptz,
      result_expires_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (application_id, deployment_id, run_id),
      UNIQUE (application_id, deployment_id, idempotency_scope),
      CHECK ((phase = 'terminal') = (terminal_at IS NOT NULL)),
      CHECK (phase = 'terminal' OR outcome IS NULL)
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS applik8s_job_runs_claim
    ON applik8s_job_runs (application_id, deployment_id, phase, available_at, lease_expires_at, admitted_at)
  `;
}

async function lockIdempotency(
  sql: TransactionSql,
  applicationId: string,
  deploymentId: string,
  scope: string,
): Promise<void> {
  await sql.unsafe('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [
    JSON.stringify([applicationId, deploymentId]),
    scope,
  ]);
}

async function readByIdempotency(
  sql: TransactionSql,
  applicationId: string,
  deploymentId: string,
  scope: string,
): Promise<ApplicationJobStoredRun | undefined> {
  const rows = await sql<JobRow[]>`
    SELECT ${sql.unsafe(jobColumns)}
    FROM applik8s_job_runs
    WHERE application_id = ${applicationId}
      AND deployment_id = ${deploymentId}
      AND idempotency_scope = ${scope}
    FOR UPDATE
  `;
  return rows[0] ? storedRun(rows[0]) : undefined;
}

function storedRun(row: JobRow): ApplicationJobStoredRun {
  const reference: ApplicationJobStoredRun['reference'] = {
    protocol: 'applik8s.jobRuntime/v1alpha1',
    job: row.job_id,
    runId: row.run_id,
    admittedAt: iso(row.admitted_at),
  };
  return {
    reference,
    input: row.input,
    inputDigest: row.input_digest,
    admission: row.admission,
    phase: row.phase,
    attempt: Number(row.attempt),
    maximumAttempts: Number(row.maximum_attempts),
    admittedAt: reference.admittedAt,
    availableAt: iso(row.available_at),
    ...(row.deadline ? { deadline: iso(row.deadline) } : {}),
    ...(row.idempotency_scope ? { idempotencyScope: row.idempotency_scope } : {}),
    ...(row.lease_owner && row.lease_expires_at ? {
      lease: { owner: row.lease_owner, epoch: Number(row.lease_epoch), expiresAt: iso(row.lease_expires_at) },
    } : {}),
    ...(row.progress ? { progress: row.progress } : {}),
    ...(row.progress_digest ? { progressDigest: row.progress_digest } : {}),
    ...(row.progress_expires_at ? { progressExpiresAt: iso(row.progress_expires_at) } : {}),
    ...(row.cancellation ? { cancellation: row.cancellation } : {}),
    ...(row.outcome ? { outcome: row.outcome } : {}),
    ...(row.outcome_digest ? { outcomeDigest: row.outcome_digest } : {}),
    ...(row.terminal_at ? { terminalAt: iso(row.terminal_at) } : {}),
    ...(row.result_expires_at ? { resultExpiresAt: iso(row.result_expires_at) } : {}),
  };
}

function digestInput(admission: ApplicationJobStoreAdmission): string {
  return digestValue(admission.input);
}

function digestValue(value: unknown): string {
  return `sha256:${createHash('sha256')
    .update(canonicalJsonV1String(value, canonicalJsonCompatibleV1Policy))
    .digest('hex')}`;
}

function jsonValue(value: unknown): never {
  // typecast: postgres-js accepts JSON-compatible data while its generic JSON
  // helper declaration is narrower than the validated framework payloads.
  return value as never;
}

function validateClaim(request: ApplicationJobClaimRequest): void {
  nonEmpty(request.owner, 'Job lease owner');
  if (request.runId !== undefined) nonEmpty(request.runId, 'Job run ID');
  positiveInteger(request.leaseSeconds, 'Job leaseSeconds');
  if (!Number.isFinite(Date.parse(request.now))) throw new TypeError('Job claim time must be an ISO timestamp.');
}

function validateAdmission(admission: ApplicationJobStoreAdmission): void {
  positiveInteger(admission.maximumAttempts, 'Job maximumAttempts');
  const admittedAt = timestamp(admission.reference.admittedAt, 'Job admission time');
  timestamp(admission.availableAt, 'Job availability time');
  if (admission.deadline && timestamp(admission.deadline, 'Job deadline') < admittedAt) {
    throw new TypeError('Job deadline precedes admission.');
  }
}

function assertChronology(start: string, end: string, label: string): void {
  if (timestamp(end, label) <= timestamp(start, label)) {
    throw new TypeError(`${label} must be later than its source transition.`);
  }
}

function timestamp(value: string, label: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new TypeError(`${label} must be an ISO timestamp.`);
  return milliseconds;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nonEmpty(value: string, label: string): string {
  if (!value.trim()) throw new TypeError(`${label} is required.`);
  return value.trim();
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive integer.`);
  return value;
}
