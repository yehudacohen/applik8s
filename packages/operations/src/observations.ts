// typecast-file-boundary: PostgreSQL observation rows are validated and normalized before restoring the provider-neutral administrative contract.
import type {
  ApplicationAuthorityPostgresSql,
  ApplicationAuthorityPostgresTransaction,
} from './postgres.js';

export type ApplicationOperationalDomain =
  | 'installation'
  | 'provider'
  | 'workflow'
  | 'eventConsumer'
  | 'projection'
  | 'ai'
  | 'mcp'
  | 'authority'
  | 'identity'
  | 'objectStore'
  | 'database'
  | 'gateway';

export type ApplicationOperationalAuthority =
  | 'canonical'
  | 'delivery'
  | 'provider'
  | 'inferred';

export type ApplicationOperationalState =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'ready'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'degraded'
  | 'unknown';

export interface ApplicationOperationalObservation {
  readonly application: string;
  readonly id: string;
  readonly domain: ApplicationOperationalDomain;
  readonly subject: string;
  readonly authority: ApplicationOperationalAuthority;
  readonly state: ApplicationOperationalState;
  readonly reason?: string;
  readonly source: string;
  readonly causalId?: string;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly observedAt: string;
  readonly expiresAt?: string;
}

export type ApplicationOperationalObservationInput =
  Omit<ApplicationOperationalObservation, 'application'>;

export const applicationOperationalObservationPostgresSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS applik8s_operational_observations (
    application text NOT NULL,
    id text NOT NULL,
    domain text NOT NULL,
    subject text NOT NULL,
    authority text NOT NULL,
    state text NOT NULL,
    reason text,
    source text NOT NULL,
    causal_id text,
    evidence jsonb NOT NULL,
    observed_at timestamptz NOT NULL,
    expires_at timestamptz,
    PRIMARY KEY (application, id)
  )`,
  `CREATE INDEX IF NOT EXISTS applik8s_operational_observations_domain_state_idx
   ON applik8s_operational_observations (application, domain, state, observed_at)`,
  `CREATE INDEX IF NOT EXISTS applik8s_operational_observations_subject_idx
   ON applik8s_operational_observations (application, subject, observed_at)`,
] as const;

export async function prepareApplicationOperationalObservationPostgres(
  sql: ApplicationAuthorityPostgresTransaction,
): Promise<void> {
  for (const statement of applicationOperationalObservationPostgresSchemaStatements) {
    await sql.unsafe(statement);
  }
}

/**
 * Canonical, provider-neutral operational observation store.
 *
 * The application name is fixed at construction so a runtime cannot
 * accidentally write into another application's administrative view. The
 * maintained browser query exposes only a separate redacted projection of
 * these rows.
 */
export class PostgresApplicationOperationalObservationRepository {
  readonly #sql: ApplicationAuthorityPostgresSql;
  readonly #application: string;

  constructor(sql: ApplicationAuthorityPostgresSql, application: string) {
    if (!application.trim()) {
      throw new Error(
        'PostgreSQL operational observation repository requires a non-empty application name.',
      );
    }
    this.#sql = sql;
    this.#application = application;
  }

  prepare(): Promise<void> {
    return prepareApplicationOperationalObservationPostgres(this.#sql);
  }

  async upsert(
    observation: ApplicationOperationalObservationInput,
    transaction: ApplicationAuthorityPostgresTransaction = this.#sql,
  ): Promise<ApplicationOperationalObservation> {
    validateObservation(observation);
    const value: ApplicationOperationalObservation = Object.freeze({
      application: this.#application,
      ...observation,
      evidence: Object.freeze({ ...observation.evidence }),
    });
    await transaction.unsafe(
      `INSERT INTO applik8s_operational_observations
       (application, id, domain, subject, authority, state, reason, source, causal_id, evidence, observed_at, expires_at)
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9,
         $10::text::jsonb, $11::timestamptz, $12::timestamptz
       )
       ON CONFLICT (application, id)
       DO UPDATE SET
         domain = EXCLUDED.domain,
         subject = EXCLUDED.subject,
         authority = EXCLUDED.authority,
         state = EXCLUDED.state,
         reason = EXCLUDED.reason,
         source = EXCLUDED.source,
         causal_id = EXCLUDED.causal_id,
         evidence = EXCLUDED.evidence,
         observed_at = EXCLUDED.observed_at,
         expires_at = EXCLUDED.expires_at`,
      [
        value.application,
        value.id,
        value.domain,
        value.subject,
        value.authority,
        value.state,
        value.reason ?? null,
        value.source,
        value.causalId ?? null,
        JSON.stringify(value.evidence),
        value.observedAt,
        value.expiresAt ?? null,
      ],
    );
    return value;
  }

  async list(options: {
    readonly domain?: ApplicationOperationalDomain;
    readonly limit?: number;
  } = {}): Promise<readonly ApplicationOperationalObservation[]> {
    const limit = options.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new Error('Operational observation list limit must be an integer from 1 through 1000.');
    }
    const rows = await this.#sql.unsafe(
      options.domain
        ? `SELECT application, id, domain, subject, authority, state, reason, source, causal_id, evidence, observed_at, expires_at
           FROM applik8s_operational_observations
           WHERE application = $1 AND domain = $2
           ORDER BY observed_at DESC, id
           LIMIT $3`
        : `SELECT application, id, domain, subject, authority, state, reason, source, causal_id, evidence, observed_at, expires_at
           FROM applik8s_operational_observations
           WHERE application = $1
           ORDER BY observed_at DESC, id
           LIMIT $2`,
      options.domain
        ? [this.#application, options.domain, limit]
        : [this.#application, limit],
    );
    return rows.map(decodeObservation);
  }
}

function validateObservation(
  observation: ApplicationOperationalObservationInput,
): void {
  for (const [field, value] of [
    ['id', observation.id],
    ['subject', observation.subject],
    ['source', observation.source],
    ['observedAt', observation.observedAt],
  ] as const) {
    if (!value.trim()) {
      throw new Error(`Operational observation ${field} must be non-empty.`);
    }
  }
  if (Number.isNaN(new Date(observation.observedAt).getTime())) {
    throw new Error('Operational observation observedAt must be an ISO timestamp.');
  }
  if (
    observation.expiresAt
    && Number.isNaN(new Date(observation.expiresAt).getTime())
  ) {
    throw new Error('Operational observation expiresAt must be an ISO timestamp.');
  }
}

function decodeObservation(
  row: Readonly<Record<string, unknown>>,
): ApplicationOperationalObservation {
  const evidence = typeof row.evidence === 'string'
    ? JSON.parse(row.evidence) as unknown
    : row.evidence;
  return {
    application: String(row.application),
    id: String(row.id),
    domain: String(row.domain) as ApplicationOperationalDomain,
    subject: String(row.subject),
    authority: String(row.authority) as ApplicationOperationalAuthority,
    state: String(row.state) as ApplicationOperationalState,
    ...(row.reason ? { reason: String(row.reason) } : {}),
    source: String(row.source),
    ...(row.causal_id ? { causalId: String(row.causal_id) } : {}),
    evidence:
      evidence && typeof evidence === 'object' && !Array.isArray(evidence)
        ? evidence as Readonly<Record<string, unknown>>
        : {},
    observedAt: timestampString(row.observed_at),
    ...(row.expires_at ? { expiresAt: timestampString(row.expires_at) } : {}),
  };
}

function timestampString(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
