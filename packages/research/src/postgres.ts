// typecast-file-boundary: PostgreSQL rows cross into typed research contracts only after complete identity, scope, enum, digest, and JSON validation.
import postgres, { type Sql } from 'postgres';
import { canonicalJsonV1String, type JsonObject } from '@applik8s/core';
import {
  ApplicationResearchEvidenceConflictError,
  type ApplicationResearchArtifactLink,
  type ApplicationResearchArtifactLinkInput,
  type ApplicationResearchEvidenceCommit,
  type ApplicationResearchEvidenceListInput,
  type ApplicationResearchEvidenceProvider,
  type ApplicationResearchEvidenceRecord,
} from './contracts.js';
import {
  artifactLinkRecord,
  normalizeResearchArtifactLinkInput,
  normalizeResearchEvidenceCommit,
  normalizeResearchEvidenceListInput,
  researchArtifactLinkId,
  researchEvidenceId,
} from './validation.js';

export interface PostgresResearchEvidenceOptions {
  readonly connectionEnvName?: string;
  /**
   * Kubernetes Secret projection for managed workers. The value never enters
   * the application graph; only Secret identity and key metadata are stored.
   */
  readonly connectionSecret?: {
    readonly name: string;
    readonly namespace?: string;
    readonly key?: string;
  };
  readonly schema?: string;
  readonly provider?: string;
  readonly storeIdentity?: string;
  /** Focused tests may inject an already-owned SQL client. It is never serialized into deployment configuration. */
  readonly sql?: Sql;
}

export function createPostgresResearchEvidenceProvider(
  options: PostgresResearchEvidenceOptions = {},
): ApplicationResearchEvidenceProvider & {
  readonly connectionEnvName: string;
  readonly schema: string;
  readonly close: () => Promise<void>;
} {
  const connectionEnvName = environmentName(options.connectionEnvName ?? 'DATABASE_URL');
  const schema = sqlIdentifier(options.schema ?? 'public', 'schema');
  const table = `"${schema}"."applik8s_research_evidence"`;
  const linkTable = `"${schema}"."applik8s_research_artifact_evidence"`;
  let ownedSql: Sql | undefined;
  let prepared: Promise<void> | undefined;
  const client = () => {
    if (options.sql) return options.sql;
    if (ownedSql) return ownedSql;
    const url = process.env[connectionEnvName];
    if (!url?.trim()) throw new Error(`ResearchEvidence PostgreSQL provider requires ${connectionEnvName}.`);
    ownedSql = postgres(url, { max: 4, idle_timeout: 20, connect_timeout: 10, prepare: false });
    return ownedSql;
  };
  const prepare = async () => {
    prepared ??= prepareStore(client(), schema, table, linkTable).catch((error) => {
      prepared = undefined;
      throw error;
    });
    await prepared;
  };
  return Object.freeze({
    provider: options.provider ?? 'postgres',
    kind: 'research-evidence-postgres',
    mode: 'durable',
    storeIdentity: options.storeIdentity ?? `postgres:${schema}`,
    connectionEnvName,
    schema,
    async commit(value: ApplicationResearchEvidenceCommit) {
      const input = normalizeResearchEvidenceCommit(value);
      await prepare();
      const sql = client();
      const id = researchEvidenceId(input);
      const rows = await sql.unsafe(
        `INSERT INTO ${table}
          (id, principal_scope, run_id, query_id, retrieval_id, canonical_url,
           search_receipt, retrieved_at, content_digest, snapshot_policy,
           snapshot_artifact_id, citations, visibility, causal_artifact_ids)
         VALUES ($1, $2, $3, $4, $5, $6, $7::text::jsonb, $8::timestamptz, $9,
                 $10, $11, $12::text::jsonb, $13::text::jsonb, $14::text::jsonb)
         ON CONFLICT (id) DO NOTHING
         RETURNING *, search_receipt::text AS search_receipt_json,
                   citations::text AS citations_json,
                   visibility::text AS visibility_json,
                   causal_artifact_ids::text AS causal_artifact_ids_json`,
        [id, input.principalScope, input.runId, input.queryId, input.retrievalId,
          input.canonicalUrl, JSON.stringify(input.searchReceipt), input.retrievedAt,
          input.contentDigest, input.snapshotPolicy, input.snapshotArtifactId ?? null,
          JSON.stringify(input.citations), JSON.stringify(input.visibility),
          JSON.stringify(input.causalArtifactIds ?? [])],
      );
      const created = researchEvidenceRow(rows[0]);
      if (created) return created;
      const existingRows = await sql.unsafe(
        `SELECT *, search_receipt::text AS search_receipt_json,
                  citations::text AS citations_json,
                  visibility::text AS visibility_json,
                  causal_artifact_ids::text AS causal_artifact_ids_json
         FROM ${table} WHERE id = $1 AND principal_scope = $2`,
        [id, input.principalScope],
      );
      const existing = researchEvidenceRow(existingRows[0]);
      if (!existing || canonicalJsonV1String(withoutCommitMetadata(existing)) !== canonicalJsonV1String(input)) {
        throw new ApplicationResearchEvidenceConflictError(`Research evidence ${id} already exists with different immutable content or scope.`);
      }
      return existing;
    },
    async list(value: ApplicationResearchEvidenceListInput) {
      const input = normalizeResearchEvidenceListInput(value);
      await prepare();
      const rows = await client().unsafe(
        `SELECT *, search_receipt::text AS search_receipt_json,
                  citations::text AS citations_json,
                  visibility::text AS visibility_json,
                  causal_artifact_ids::text AS causal_artifact_ids_json
         FROM ${table}
         WHERE principal_scope = $1 AND run_id = $2 AND version > $3
         ORDER BY version ASC LIMIT $4`,
        [input.principalScope, input.runId, input.afterVersion, input.limit],
      );
      const values = Object.freeze(rows.map((row) => required(researchEvidenceRow(row), 'research evidence')));
      return Object.freeze({
        values,
        ...(values.length === input.limit ? { nextVersion: values.at(-1)!.version } : {}),
      });
    },
    async linkArtifact(value: ApplicationResearchArtifactLinkInput) {
      const input = normalizeResearchArtifactLinkInput(value);
      await prepare();
      const sql = client();
      return sql.begin(async (transaction) => {
        const evidenceRows = await transaction.unsafe(
          `SELECT id FROM ${table}
           WHERE principal_scope = $1 AND run_id = $2 AND id = ANY($3::text[])
           FOR SHARE`,
          [input.principalScope, input.runId, input.evidenceIds],
        );
        if (evidenceRows.length !== input.evidenceIds.length) {
          throw new ApplicationResearchEvidenceConflictError(`Artifact ${input.artifactId} references absent or inaccessible evidence.`);
        }
        const id = researchArtifactLinkId(input);
        const rows = await transaction.unsafe(
          `INSERT INTO ${linkTable}
            (id, principal_scope, run_id, artifact_id, evidence_ids, claims)
           VALUES ($1, $2, $3, $4, $5::text::jsonb, $6::text::jsonb)
           ON CONFLICT (id) DO NOTHING
           RETURNING *, evidence_ids::text AS evidence_ids_json,
                     claims::text AS claims_json`,
          [id, input.principalScope, input.runId, input.artifactId,
            JSON.stringify(input.evidenceIds), JSON.stringify(input.claims)],
        );
        const created = researchArtifactLinkRow(rows[0]);
        if (created) return created;
        const existingRows = await transaction.unsafe(
          `SELECT *, evidence_ids::text AS evidence_ids_json,
                    claims::text AS claims_json
           FROM ${linkTable} WHERE id = $1 AND principal_scope = $2`,
          [id, input.principalScope],
        );
        const existing = researchArtifactLinkRow(existingRows[0]);
        if (!existing || canonicalJsonV1String(withoutLinkMetadata(existing)) !== canonicalJsonV1String(input)) {
          throw new ApplicationResearchEvidenceConflictError(`Research artifact link ${id} already exists with different immutable content or scope.`);
        }
        return existing;
      });
    },
    async close() {
      if (ownedSql) await ownedSql.end({ timeout: 5 });
      ownedSql = undefined;
      prepared = undefined;
    },
  });
}

async function prepareStore(sql: Sql, schema: string, table: string, linkTable: string): Promise<void> {
  if (schema !== 'public') await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  await sql.unsafe(
    `CREATE TABLE IF NOT EXISTS ${table} (
       version BIGSERIAL UNIQUE NOT NULL,
       id TEXT PRIMARY KEY,
       principal_scope TEXT NOT NULL,
       run_id TEXT NOT NULL,
       query_id TEXT NOT NULL,
       retrieval_id TEXT NOT NULL,
       canonical_url TEXT NOT NULL,
       search_receipt JSONB NOT NULL,
       retrieved_at TIMESTAMPTZ NOT NULL,
       content_digest TEXT NOT NULL CHECK (content_digest ~ '^sha256:[a-f0-9]{64}$'),
       snapshot_policy TEXT NOT NULL CHECK (snapshot_policy IN ('digest-only', 'licensed-reference', 'retained-snapshot')),
       snapshot_artifact_id TEXT,
       citations JSONB NOT NULL,
       visibility JSONB NOT NULL,
       causal_artifact_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
       committed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
       CONSTRAINT retained_snapshot_requires_artifact CHECK (snapshot_policy <> 'retained-snapshot' OR snapshot_artifact_id IS NOT NULL)
     );
     CREATE INDEX IF NOT EXISTS applik8s_research_evidence_scope_run_version_idx
       ON ${table} (principal_scope, run_id, version);`,
  );
  await sql.unsafe(
    `CREATE TABLE IF NOT EXISTS ${linkTable} (
       id TEXT PRIMARY KEY,
       principal_scope TEXT NOT NULL,
       run_id TEXT NOT NULL,
       artifact_id TEXT NOT NULL,
       evidence_ids JSONB NOT NULL,
       claims JSONB NOT NULL,
       linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
     );
     CREATE INDEX IF NOT EXISTS applik8s_research_artifact_scope_run_idx
       ON ${linkTable} (principal_scope, run_id, linked_at);`,
  );
}

function researchEvidenceRow(row: unknown): ApplicationResearchEvidenceRecord | undefined {
  if (!row || typeof row !== 'object') return undefined;
  const value = row as Record<string, unknown>;
  const causalArtifactIds = jsonArray(
    value.causal_artifact_ids_json ?? value.causal_artifact_ids,
  ).map(String);
  const input = normalizeResearchEvidenceCommit({
    principalScope: stringValue(value.principal_scope),
    runId: stringValue(value.run_id),
    queryId: stringValue(value.query_id),
    retrievalId: stringValue(value.retrieval_id),
    canonicalUrl: stringValue(value.canonical_url),
    searchReceipt: jsonObject(value.search_receipt_json ?? value.search_receipt),
    retrievedAt: timestampValue(value.retrieved_at),
    contentDigest: stringValue(value.content_digest) as `sha256:${string}`,
    snapshotPolicy: stringValue(value.snapshot_policy) as ApplicationResearchEvidenceRecord['snapshotPolicy'],
    ...(value.snapshot_artifact_id ? { snapshotArtifactId: stringValue(value.snapshot_artifact_id) } : {}),
    citations: jsonArray(value.citations_json ?? value.citations) as ApplicationResearchEvidenceRecord['citations'],
    visibility: jsonObject(value.visibility_json ?? value.visibility),
    ...(causalArtifactIds.length > 0 ? { causalArtifactIds } : {}),
  });
  const version = Number(value.version);
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('PostgreSQL research evidence version is invalid.');
  return Object.freeze({
    apiVersion: 'applik8s.researchEvidence/v1alpha1',
    id: stringValue(value.id),
    ...input,
    version,
    committedAt: timestampValue(value.committed_at),
  });
}

function researchArtifactLinkRow(row: unknown): ApplicationResearchArtifactLink | undefined {
  if (!row || typeof row !== 'object') return undefined;
  const value = row as Record<string, unknown>;
  return artifactLinkRecord(normalizeResearchArtifactLinkInput({
    principalScope: stringValue(value.principal_scope),
    runId: stringValue(value.run_id),
    artifactId: stringValue(value.artifact_id),
    evidenceIds: jsonArray(value.evidence_ids_json ?? value.evidence_ids).map(String),
    claims: jsonArray(value.claims_json ?? value.claims) as ApplicationResearchArtifactLink['claims'],
  }), timestampValue(value.linked_at));
}

function jsonObject(value: unknown): JsonObject {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('PostgreSQL research evidence JSON object is invalid.');
  return parsed as JsonObject;
}

function jsonArray(value: unknown): unknown[] {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) throw new Error('PostgreSQL research evidence JSON array is invalid.');
  return parsed;
}

function stringValue(value: unknown): string {
  if (typeof value !== 'string') throw new Error('PostgreSQL research evidence string is invalid.');
  return value;
}

function timestampValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(stringValue(value)).toISOString();
}

function withoutCommitMetadata(record: ApplicationResearchEvidenceRecord) {
  const { apiVersion: _apiVersion, id: _id, version: _version, committedAt: _committedAt, ...input } = record;
  return input;
}

function withoutLinkMetadata(record: ApplicationResearchArtifactLink) {
  const { apiVersion: _apiVersion, id: _id, linkedAt: _linkedAt, ...input } = record;
  return input;
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`PostgreSQL ${label} row is invalid.`);
  return value;
}

function environmentName(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Z_][A-Z0-9_]*$/u.test(normalized)) throw new Error('ResearchEvidence connectionEnvName must be an uppercase environment identifier.');
  return normalized;
}

function sqlIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!/^[a-z_][a-z0-9_]*$/u.test(normalized)) throw new Error(`ResearchEvidence ${label} must be a safe lowercase SQL identifier.`);
  return normalized;
}
