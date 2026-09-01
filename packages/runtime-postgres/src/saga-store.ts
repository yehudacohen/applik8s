// typecast-file-boundary: PostgreSQL JSONB Saga records are hydrated only
// after their versioned identity, lease, step, and terminal invariants pass.
import {
  type ApplicationSagaDurableLease,
  type ApplicationSagaDurableRecord,
  type ApplicationSagaDurableStore,
} from '@applik8s/applik8s';
import postgres, { type Sql } from 'postgres';

export interface PostgresApplicationSagaStoreOptions {
  readonly databaseUrl: string;
  readonly applicationId: string;
  readonly deploymentId: string;
  readonly maximumConnections?: number;
}

export interface PostgresApplicationSagaStore extends ApplicationSagaDurableStore {
  close(): Promise<void>;
}

interface SagaRow {
  readonly invocation_id: string;
  readonly saga: string;
  readonly input_digest: string;
  readonly definition_digest: string;
  readonly admission: object | null;
  readonly outcome: ApplicationSagaDurableRecord['outcome'];
  readonly steps: ApplicationSagaDurableRecord['steps'];
  readonly output: object | null;
  readonly updated_at: Date | string;
  readonly lease_owner: string | null;
  readonly lease_epoch: number;
  readonly lease_expires_at: Date | string | null;
}

export class PostgresApplicationSagaLeaseBusyError extends Error {
  readonly code = 'SAGA_LEASE_BUSY' as const;
  constructor(readonly invocationId: string) {
    super(`Saga ${invocationId} is owned by another live worker lease.`);
    this.name = 'PostgresApplicationSagaLeaseBusyError';
  }
}

export class PostgresApplicationSagaLeaseLostError extends Error {
  readonly code = 'SAGA_LEASE_LOST' as const;
  constructor(readonly invocationId: string, readonly owner: string, readonly epoch: number) {
    super(`Saga ${invocationId} lease ${owner}/${epoch} is no longer authoritative.`);
    this.name = 'PostgresApplicationSagaLeaseLostError';
  }
}

/** PostgreSQL receipt authority used by the workflow-backed Saga coordinator. */
export function createPostgresApplicationSagaStore(
  options: PostgresApplicationSagaStoreOptions,
): PostgresApplicationSagaStore {
  const databaseUrl = required(options.databaseUrl, 'Saga store databaseUrl');
  const applicationId = required(options.applicationId, 'Saga store applicationId');
  const deploymentId = required(options.deploymentId, 'Saga store deploymentId');
  const maximumConnections = positiveInteger(options.maximumConnections ?? 4, 'Saga store maximumConnections');
  const sql = postgres(databaseUrl, { max: maximumConnections });
  let initialized: Promise<void> | undefined;
  const ensure = () => (initialized ??= ensureSagaStore(sql));

  return {
    async claim(initial, request) {
      await ensure();
      validateRecord(initial);
      required(request.owner, 'Saga lease owner');
      timestamp(request.now, 'Saga lease claim time');
      positiveInteger(request.leaseSeconds, 'Saga lease duration');
      return sql.begin(async (transaction) => {
        await transaction`
          INSERT INTO applik8s_saga_runs (
            application_id, deployment_id, invocation_id, saga,
            input_digest, definition_digest, admission, outcome, steps,
            output, updated_at
          ) VALUES (
            ${applicationId}, ${deploymentId}, ${initial.invocationId}, ${initial.saga},
            ${initial.inputDigest}, ${initial.definitionDigest},
            ${initial.admission ? transaction.json(jsonValue(initial.admission)) : null},
            ${initial.outcome}, ${transaction.json(jsonValue(initial.steps))},
            ${initial.output ? transaction.json(jsonValue(initial.output)) : null},
            ${initial.updatedAt}
          )
          ON CONFLICT (application_id, deployment_id, invocation_id) DO NOTHING
        `;
        const rows = await transaction<SagaRow[]>`
          UPDATE applik8s_saga_runs
          SET lease_owner = ${request.owner},
              lease_epoch = lease_epoch + 1,
              lease_expires_at = (${request.now}::timestamptz + (${request.leaseSeconds} * interval '1 second'))
          WHERE application_id = ${applicationId}
            AND deployment_id = ${deploymentId}
            AND invocation_id = ${initial.invocationId}
            AND (
              lease_owner IS NULL
              OR lease_expires_at IS NULL
              OR lease_expires_at <= ${request.now}
              OR lease_owner = ${request.owner}
            )
          RETURNING ${transaction.unsafe(sagaColumns)}
        `;
        const row = rows[0];
        if (!row) throw new PostgresApplicationSagaLeaseBusyError(initial.invocationId);
        return { record: sagaRecord(row), lease: sagaLease(row) };
      });
    },

    async write(record, lease) {
      await ensure();
      validateRecord(record);
      validateLease(lease);
      const rows = await sql<SagaRow[]>`
        UPDATE applik8s_saga_runs
        SET saga = ${record.saga},
            input_digest = ${record.inputDigest},
            definition_digest = ${record.definitionDigest},
            admission = ${record.admission ? sql.json(jsonValue(record.admission)) : null},
            outcome = ${record.outcome},
            steps = ${sql.json(jsonValue(record.steps))},
            output = ${record.output ? sql.json(jsonValue(record.output)) : null},
            updated_at = ${record.updatedAt}
        WHERE application_id = ${applicationId}
          AND deployment_id = ${deploymentId}
          AND invocation_id = ${record.invocationId}
          AND lease_owner = ${lease.owner}
          AND lease_epoch = ${lease.epoch}
          AND lease_expires_at > now()
        RETURNING ${sql.unsafe(sagaColumns)}
      `;
      const row = rows[0];
      if (!row) throw new PostgresApplicationSagaLeaseLostError(record.invocationId, lease.owner, lease.epoch);
      return sagaLease(row);
    },

    async heartbeat(lease, invocationId, now, leaseSeconds) {
      await ensure();
      validateLease(lease);
      timestamp(now, 'Saga heartbeat time');
      positiveInteger(leaseSeconds, 'Saga heartbeat lease duration');
      const rows = await sql<SagaRow[]>`
        UPDATE applik8s_saga_runs
        SET lease_expires_at = (${now}::timestamptz + (${leaseSeconds} * interval '1 second'))
        WHERE application_id = ${applicationId}
          AND deployment_id = ${deploymentId}
          AND invocation_id = ${invocationId}
          AND lease_owner = ${lease.owner}
          AND lease_epoch = ${lease.epoch}
          AND lease_expires_at > ${now}
        RETURNING ${sql.unsafe(sagaColumns)}
      `;
      const row = rows[0];
      if (!row) throw new PostgresApplicationSagaLeaseLostError(invocationId, lease.owner, lease.epoch);
      return sagaLease(row);
    },

    async release(invocationId, lease) {
      await ensure();
      validateLease(lease);
      await sql`
        UPDATE applik8s_saga_runs
        SET lease_owner = NULL, lease_expires_at = NULL
        WHERE application_id = ${applicationId}
          AND deployment_id = ${deploymentId}
          AND invocation_id = ${invocationId}
          AND lease_owner = ${lease.owner}
          AND lease_epoch = ${lease.epoch}
      `;
    },

    async inspect(invocationId) {
      await ensure();
      const rows = await sql<SagaRow[]>`
        SELECT ${sql.unsafe(sagaColumns)}
        FROM applik8s_saga_runs
        WHERE application_id = ${applicationId}
          AND deployment_id = ${deploymentId}
          AND invocation_id = ${invocationId}
      `;
      return rows[0] ? sagaRecord(rows[0]) : undefined;
    },

    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}

const sagaColumns = `
  invocation_id, saga, input_digest, definition_digest, admission,
  outcome, steps, output, updated_at, lease_owner, lease_epoch,
  lease_expires_at
`;

async function ensureSagaStore(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS applik8s_saga_runs (
      application_id text NOT NULL,
      deployment_id text NOT NULL,
      invocation_id text NOT NULL,
      saga text NOT NULL,
      input_digest text NOT NULL CHECK (input_digest ~ '^sha256:[a-f0-9]{64}$'),
      definition_digest text NOT NULL CHECK (definition_digest ~ '^sha256:[a-f0-9]{64}$'),
      admission jsonb,
      outcome text NOT NULL CHECK (outcome IN ('running', 'committed', 'compensated', 'compensationFailed', 'outcomeUnknown')),
      steps jsonb NOT NULL DEFAULT '[]'::jsonb,
      output jsonb,
      updated_at timestamptz NOT NULL,
      lease_owner text,
      lease_epoch integer NOT NULL DEFAULT 0 CHECK (lease_epoch >= 0),
      lease_expires_at timestamptz,
      PRIMARY KEY (application_id, deployment_id, invocation_id),
      CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL))
    )
  `;
}

function sagaRecord(row: SagaRow): ApplicationSagaDurableRecord {
  const record: ApplicationSagaDurableRecord = {
    schemaVersion: 'applik8s.sagaRecord/v1alpha1',
    invocationId: required(row.invocation_id, 'Saga invocation identity'),
    saga: required(row.saga, 'Saga identity'),
    inputDigest: digest(row.input_digest, 'Saga input digest'),
    definitionDigest: digest(row.definition_digest, 'Saga definition digest'),
    ...(row.admission ? { admission: row.admission } : {}),
    outcome: row.outcome,
    steps: row.steps,
    ...(row.output ? { output: row.output } : {}),
    updatedAt: date(row.updated_at, 'Saga updatedAt'),
  };
  validateRecord(record);
  return record;
}

function sagaLease(row: SagaRow): ApplicationSagaDurableLease {
  if (!row.lease_owner || row.lease_expires_at === null) {
    throw new Error(`Saga ${row.invocation_id} did not return a complete lease.`);
  }
  const lease = {
    owner: row.lease_owner,
    epoch: positiveInteger(row.lease_epoch, 'Saga lease epoch'),
    expiresAt: date(row.lease_expires_at, 'Saga lease expiry'),
  };
  validateLease(lease);
  return lease;
}

function validateRecord(record: ApplicationSagaDurableRecord): void {
  if (record.schemaVersion !== 'applik8s.sagaRecord/v1alpha1') throw new Error('Saga record schema version is unsupported.');
  required(record.invocationId, 'Saga record invocationId');
  required(record.saga, 'Saga record saga');
  digest(record.inputDigest, 'Saga record inputDigest');
  digest(record.definitionDigest, 'Saga record definitionDigest');
  timestamp(record.updatedAt, 'Saga record updatedAt');
  if (!['running', 'committed', 'compensated', 'compensationFailed', 'outcomeUnknown'].includes(record.outcome)) throw new Error('Saga record outcome is invalid.');
  if (!Array.isArray(record.steps)) throw new Error('Saga record steps must be an array.');
  const ids = new Set<string>();
  for (const step of record.steps) {
    required(step.id, 'Saga step id');
    if (ids.has(step.id)) throw new Error(`Saga record repeats step ${step.id}.`);
    ids.add(step.id);
    if (!['step', 'commit', 'irreversible'].includes(step.kind)) throw new Error(`Saga step ${step.id} kind is invalid.`);
    if (!['declared', 'prepared', 'invoked', 'observed', 'committed', 'failed', 'unknown', 'compensating', 'compensated', 'compensationFailed'].includes(step.phase)) throw new Error(`Saga step ${step.id} phase is invalid.`);
    if (!Number.isSafeInteger(step.compensationAttempts) || step.compensationAttempts < 0) throw new Error(`Saga step ${step.id} compensationAttempts is invalid.`);
  }
}

function validateLease(lease: ApplicationSagaDurableLease): void {
  required(lease.owner, 'Saga lease owner');
  positiveInteger(lease.epoch, 'Saga lease epoch');
  timestamp(lease.expiresAt, 'Saga lease expiry');
}

function required(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} is required.`);
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive safe integer.`);
  return value;
}

function timestamp(value: string, label: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp.`);
  return value;
}

function date(value: Date | string, label: string): string {
  const result = value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  return timestamp(result, label);
}

function digest(value: string, label: string): `sha256:${string}` {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) throw new Error(`${label} is invalid.`);
  return value as `sha256:${string}`;
}

function jsonValue(value: unknown): never {
  return value as never;
}
