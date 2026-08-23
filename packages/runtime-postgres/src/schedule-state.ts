// typecast-file-boundary: PostgreSQL JSONB rows are validated by schema version and identity before provider hydration.
import {
	applicationScheduleDesiredStateDigest,
	applicationScheduleDesiredStateRecord,
	type ApplicationScheduleConvergenceResult,
	type ApplicationScheduleManagementReceipt,
	type ApplicationScheduleStateAuthority,
	type ApplicationScheduleStateRecord,
} from '@applik8s/applik8s/schedule-state-runtime';
import postgres, { type Sql, type TransactionSql } from 'postgres';

export interface PostgresApplicationScheduleStateAuthorityOptions {
	readonly databaseUrl: string;
	readonly applicationId: string;
	readonly environmentId: string;
}

export interface PostgresApplicationScheduleStateAuthority
	extends ApplicationScheduleStateAuthority {
	close(): Promise<void>;
}

/**
 * PostgreSQL authority for schedule desired state and management evidence.
 * Provider resources are projections: this record is committed first so a
 * failed provider mutation is safely retryable after process restart.
 */
export function createPostgresApplicationScheduleStateAuthority(
	options: PostgresApplicationScheduleStateAuthorityOptions,
): PostgresApplicationScheduleStateAuthority {
	for (const [name, value] of Object.entries(options)) {
		if (!value.trim()) {
			throw new Error(
				`PostgreSQL schedule state authority ${name} is required.`,
			);
		}
	}
	const sql = postgres(options.databaseUrl, { max: 2 });
	let initialized: Promise<void> | undefined;
	const ensure = () => (initialized ??= ensureScheduleStateAuthority(sql));

	return {
		async reconcile(request) {
			await ensure();
			const digest = applicationScheduleDesiredStateDigest(
				request.definition,
				request.instance,
			);
			const desired = applicationScheduleDesiredStateRecord(
				request.definition,
				request.instance,
			);
			return sql.begin(async (transaction) => {
				await lockScheduleState(
					transaction,
					options,
					request.definition.id,
					request.instance.id,
				);
				const prior = await readScheduleState(
					transaction,
					options,
					request.definition.id,
					request.instance.id,
				);
				if (
					prior?.state === 'active' &&
					prior.revision === request.instance.revision
				) {
					if (prior.digest !== digest) {
						throw new Error(
							`Schedule ${request.definition.id}:${request.instance.id} revision ${request.instance.revision} conflicts with different desired state.`,
						);
					}
          if (request.management) {
            await transaction`
              UPDATE applik8s_schedule_instances
              SET management = ${transaction.json(jsonValue(request.management))},
                  projection_state = 'pending',
                  updated_at = now()
              WHERE application_id = ${options.applicationId}
                AND environment_id = ${options.environmentId}
                AND definition_id = ${request.definition.id}
                AND instance_id = ${request.instance.id}
            `;
					}
					return convergence(
						request.definition.id,
						request.instance.id,
						request.instance.revision,
						'unchanged',
						request.management,
					);
				}
				if (
					prior?.state === 'active' &&
					compareRevision(request.instance.revision, prior.revision) < 0
				) {
					throw new Error(
						`Schedule ${request.definition.id}:${request.instance.id} revision ${request.instance.revision} is stale; current revision is ${prior.revision}.`,
					);
				}
				await transaction`
          INSERT INTO applik8s_schedule_instances (
            application_id, environment_id, definition_id, instance_id,
            revision, digest, state, desired, management, updated_at
          ) VALUES (
            ${options.applicationId}, ${options.environmentId},
            ${request.definition.id}, ${request.instance.id},
            ${request.instance.revision}, ${digest}, 'active',
            ${transaction.json(jsonValue(desired))},
            ${
							request.management
								? transaction.json(jsonValue(request.management))
								: null
						},
            now()
          )
          ON CONFLICT (application_id, environment_id, definition_id, instance_id)
          DO UPDATE SET
            revision = EXCLUDED.revision,
            digest = EXCLUDED.digest,
            state = 'active',
            projection_state = 'pending',
            desired = EXCLUDED.desired,
            management = EXCLUDED.management,
            updated_at = now()
        `;
				return convergence(
					request.definition.id,
					request.instance.id,
					request.instance.revision,
					prior?.state === 'active' ? 'updated' : 'created',
					request.management,
				);
			});
		},

		async remove(definitionId, instanceId, management) {
			await ensure();
			return sql.begin(async (transaction) => {
				await lockScheduleState(transaction, options, definitionId, instanceId);
				const prior = await readScheduleState(
					transaction,
					options,
					definitionId,
					instanceId,
				);
				const revision = prior?.revision ?? management?.revision ?? 'removed';
				await transaction`
          INSERT INTO applik8s_schedule_instances (
            application_id, environment_id, definition_id, instance_id,
            revision, digest, state, desired, management, updated_at
          ) VALUES (
            ${options.applicationId}, ${options.environmentId},
            ${definitionId}, ${instanceId}, ${revision},
            ${prior?.digest ?? ''}, 'removed', NULL,
            ${management ? transaction.json(jsonValue(management)) : null},
            now()
          )
          ON CONFLICT (application_id, environment_id, definition_id, instance_id)
          DO UPDATE SET
            state = 'removed',
            projection_state = 'pending',
            desired = NULL,
            management = EXCLUDED.management,
            updated_at = now()
        `;
				return convergence(
					definitionId,
					instanceId,
					revision,
					prior?.state === 'active' ? 'removed' : 'unchanged',
					management,
				);
			});
		},

		async pending() {
			await ensure();
			const rows = await sql<ScheduleStateRecordRow[]>`
        SELECT definition_id, instance_id, revision, digest, state,
               projection_state, desired, management, updated_at
        FROM applik8s_schedule_instances
        WHERE application_id = ${options.applicationId}
          AND environment_id = ${options.environmentId}
          AND projection_state = 'pending'
        ORDER BY definition_id, instance_id
      `;
			return rows.map(scheduleStateRecord);
		},

		async markProjected(definitionId, instanceId, revision, state) {
			await ensure();
			const rows = await sql<{ readonly definition_id: string }[]>`
        UPDATE applik8s_schedule_instances
        SET projection_state = 'applied', updated_at = now()
        WHERE application_id = ${options.applicationId}
          AND environment_id = ${options.environmentId}
          AND definition_id = ${definitionId}
          AND instance_id = ${instanceId}
          AND revision = ${revision}
          AND state = ${state}
        RETURNING definition_id
      `;
			if (rows.length !== 1) {
				await sql`
          UPDATE applik8s_schedule_instances
          SET projection_state = 'pending', updated_at = now()
          WHERE application_id = ${options.applicationId}
            AND environment_id = ${options.environmentId}
            AND definition_id = ${definitionId}
            AND instance_id = ${instanceId}
        `;
				return false;
			}
			return true;
		},
		async close() {
			await sql.end({ timeout: 5 });
		},
	};
}

interface ScheduleStateRow {
	readonly revision: string;
	readonly digest: string;
	readonly state: 'active' | 'removed';
	readonly projection_state: 'pending' | 'applied';
}

interface ScheduleStateRecordRow extends ScheduleStateRow {
	readonly definition_id: string;
	readonly instance_id: string;
	readonly desired: Record<string, unknown> | null;
	readonly management: ApplicationScheduleManagementReceipt | null;
	readonly updated_at: Date | string;
}

async function ensureScheduleStateAuthority(sql: Sql): Promise<void> {
	await sql`
    CREATE TABLE IF NOT EXISTS applik8s_schedule_instances (
      application_id text NOT NULL,
      environment_id text NOT NULL,
      definition_id text NOT NULL,
      instance_id text NOT NULL,
      revision text NOT NULL,
      digest text NOT NULL,
      state text NOT NULL CHECK (state IN ('active', 'removed')),
      projection_state text NOT NULL DEFAULT 'pending'
        CHECK (projection_state IN ('pending', 'applied')),
      desired jsonb,
      management jsonb,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (application_id, environment_id, definition_id, instance_id)
    )
  `;
	await sql`
    ALTER TABLE applik8s_schedule_instances
    ADD COLUMN IF NOT EXISTS projection_state text NOT NULL DEFAULT 'pending'
  `;
	await sql`
    CREATE INDEX IF NOT EXISTS applik8s_schedule_instances_state
    ON applik8s_schedule_instances (application_id, environment_id, state)
  `;
}

async function lockScheduleState(
	sql: Sql | TransactionSql,
	options: PostgresApplicationScheduleStateAuthorityOptions,
	definitionId: string,
	instanceId: string,
): Promise<void> {
	const [authorityKey, instanceKey] = applicationScheduleStateLockKeysForTest(
		options,
		definitionId,
		instanceId,
	);
	await sql.unsafe('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [
		authorityKey,
		instanceKey,
	]);
}

/** @internal Exported only for deterministic wire-boundary regression tests. */
export function applicationScheduleStateLockKeysForTest(
	options: Pick<
		PostgresApplicationScheduleStateAuthorityOptions,
		'applicationId' | 'environmentId'
	>,
	definitionId: string,
	instanceId: string,
): readonly [authorityKey: string, instanceKey: string] {
	// PostgreSQL text parameters cannot contain NUL. JSON array encoding is both
	// unambiguous and safe for arbitrary non-NUL PostgreSQL text identities.
	return [
		JSON.stringify([options.applicationId, options.environmentId]),
		JSON.stringify([definitionId, instanceId]),
	];
}

async function readScheduleState(
	sql: Sql | TransactionSql,
	options: PostgresApplicationScheduleStateAuthorityOptions,
	definitionId: string,
	instanceId: string,
): Promise<ScheduleStateRow | undefined> {
	const rows = await sql<ScheduleStateRow[]>`
    SELECT revision, digest, state, projection_state
    FROM applik8s_schedule_instances
    WHERE application_id = ${options.applicationId}
      AND environment_id = ${options.environmentId}
      AND definition_id = ${definitionId}
      AND instance_id = ${instanceId}
    FOR UPDATE
  `;
	return rows[0];
}

function scheduleStateRecord(
	row: ScheduleStateRecordRow,
): ApplicationScheduleStateRecord {
	return Object.freeze({
		schemaVersion: 'applik8s.scheduleState/v1alpha1',
		definitionId: row.definition_id,
		instanceId: row.instance_id,
		revision: row.revision,
		digest: row.digest,
		state: row.state,
		projection: row.projection_state,
		...(row.desired
			? { desired: row.desired as import('@applik8s/core').JsonObject }
			: {}),
		...(row.management ? { management: row.management } : {}),
		updatedAt:
			row.updated_at instanceof Date
				? row.updated_at.toISOString()
				: new Date(row.updated_at).toISOString(),
	});
}

function convergence(
	definitionId: string,
	instanceId: string,
	revision: string,
	state: ApplicationScheduleConvergenceResult['state'],
	management?: ApplicationScheduleManagementReceipt,
): ApplicationScheduleConvergenceResult {
	return {
		definitionId,
		instanceId,
		revision,
		state,
		...(management ? { management } : {}),
	};
}

function compareRevision(left: string, right: string): number {
	if (/^\d+$/u.test(left) && /^\d+$/u.test(right)) {
		return BigInt(left) < BigInt(right)
			? -1
			: BigInt(left) > BigInt(right)
				? 1
				: 0;
	}
	return left.localeCompare(right);
}

function jsonValue(value: unknown): postgres.JSONValue {
	return JSON.parse(JSON.stringify(value)) as postgres.JSONValue;
}
