// typecast-file-boundary: Valkey protocol replies and schema-normalized projection rows are decoded before restoring declared projection generics.
import type { JsonValue } from "@applik8s/core";
import type { SchemaInput } from "@applik8s/sdk";
import { normalizeSchema } from "@applik8s/sdk/schema-runtime";
import type { ApplicationProjectionWriter } from "./projection-runtime-clickhouse.js";
import {
	type ApplicationValkeyCommand,
	createApplicationValkeyCommand,
	type ValkeyResponse,
} from "./valkey-protocol.js";

export interface ApplicationOnlineProjectionPage<TValue extends object> {
	readonly items: readonly TValue[];
	readonly cursor?: string;
	readonly projection: {
		readonly generation: string;
		readonly eventWatermark: string;
		readonly rebuilding: boolean;
		readonly degraded: boolean;
	};
}

export type ApplicationOnlineProjectionPageOptions =
	| {
			readonly partition: string;
			readonly partitions?: never;
			readonly limit: number;
			readonly cursor?: string;
	  }
	| {
			readonly partition?: never;
			readonly partitions: readonly string[];
			readonly limit: number;
			readonly cursor?: string;
	  };

export interface ValkeyOnlineProjectionWriterOptions<
	TRow extends object,
	TValue extends object,
> {
	readonly host?: string;
	readonly port?: number;
	readonly password?: string;
	readonly timeoutMs?: number;
	readonly command?: ApplicationValkeyCommand;
	readonly prefix: string;
	readonly projection: string;
	readonly stream: string;
	/** Optional intermediate-row schema. Final stored values are always validated. */
	readonly schema?: SchemaInput<TRow>;
	readonly valueSchema: SchemaInput<TValue>;
	readonly initialGeneration?: string;
	readonly partitionBy: (row: TRow) => string;
	readonly key: (row: TRow) => string;
	readonly score: (row: TRow) => number;
	readonly scoreUnit?: "arbitrary" | "epochMilliseconds";
	readonly value: (row: TRow) => TValue;
	readonly removeWhen?: (row: TRow) => boolean;
	readonly retention: {
		readonly maxItemsPerPartition: number;
		readonly maxPartitions?: number;
		readonly maxAgeSeconds?: number;
	};
}

export interface ApplicationValkeyOnlineProjectionWriter<
	TRow extends object,
	TValue extends object,
> extends ApplicationProjectionWriter<TRow> {
	page(
		options: ApplicationOnlineProjectionPageOptions,
	): Promise<ApplicationOnlineProjectionPage<TValue>>;
	activeGeneration(): Promise<string>;
	rebuildState(): Promise<ApplicationOnlineProjectionRebuildState>;
	beginGeneration(
		generation: string,
		attemptId: string,
		leaseMs: number,
	): Promise<void>;
	renewGenerationAttempt(generation: string, attemptId: string): Promise<void>;
	writeGeneration(
		generation: string,
		attemptId: string,
		events: readonly ApplicationOnlineProjectionWrite<TRow>[],
	): Promise<void>;
	generationHighwater(generation: string): Promise<number>;
	publishGeneration(
		generation: string,
		expectedGeneration: string,
		attemptId: string,
	): Promise<boolean>;
	resetGeneration(generation: string, attemptId?: string): Promise<void>;
	abandonGeneration(generation: string, attemptId: string): Promise<void>;
}

export interface ApplicationOnlineProjectionWrite<TRow extends object> {
	readonly envelope: import("./projection-runtime-clickhouse.js").ApplicationStreamEnvelope;
	readonly rows: readonly TRow[];
}

export interface ApplicationOnlineProjectionRebuildState {
	readonly activeGeneration: string;
	readonly eventWatermark: number;
	readonly rebuildingGeneration?: string;
}

export interface ApplicationValkeyOnlineProjectionReader<
	TValue extends object,
> {
	page(
		options: ApplicationOnlineProjectionPageOptions,
	): Promise<ApplicationOnlineProjectionPage<TValue>>;
	revision(): Promise<string>;
	snapshot<TResult>(
		operation: (
			source: ApplicationValkeyOnlineProjectionReader<TValue>,
		) => Promise<TResult>,
	): Promise<{ readonly value: TResult; readonly revision: string }>;
}

export interface ValkeyOnlineProjectionReaderOptions<TValue extends object> {
	readonly host?: string;
	readonly port?: number;
	readonly password?: string;
	readonly timeoutMs?: number;
	readonly command?: ApplicationValkeyCommand;
	readonly prefix: string;
	readonly projection: string;
	readonly stream: string;
	readonly valueSchema: SchemaInput<TValue>;
	readonly snapshotAttempts?: number;
}

/**
 * The online projection has no readable published generation. This is a
 * recoverable provider-state failure (for example, before initial projection
 * hydration or after disposable projection data is lost), not an invalid
 * public query request.
 */
export class ApplicationOnlineProjectionUnavailableError extends Error {
	readonly code = "APPLIK8S_ONLINE_PROJECTION_UNAVAILABLE";

	constructor(readonly projection: string) {
		super(
			`Online projection ${projection} is unavailable because it has no active generation. Initialize or rebuild the projection and retry.`,
		);
		this.name = "ApplicationOnlineProjectionUnavailableError";
	}
}

const RESERVE_PARTITION_SCRIPT = `
if redis.call('SISMEMBER', KEYS[1], ARGV[1]) == 0 and redis.call('SCARD', KEYS[1]) >= tonumber(ARGV[2]) then
  return redis.error_reply('APPLIK8S_PROJECTION_PARTITION_LIMIT')
end
return redis.call('SADD', KEYS[1], ARGV[1])
`;

const APPLY_ROW_SCRIPT = `
local sequence = tonumber(ARGV[1])
local previous = tonumber(redis.call('HGET', KEYS[3], ARGV[2]) or '-1')
if previous > sequence then return 0 end
redis.call('HSET', KEYS[3], ARGV[2], sequence)
if ARGV[4] == '1' then
  redis.call('ZREM', KEYS[1], ARGV[2])
  redis.call('HDEL', KEYS[2], ARGV[2])
else
  redis.call('ZADD', KEYS[1], ARGV[3], ARGV[2])
  redis.call('HSET', KEYS[2], ARGV[2], ARGV[5])
end
local maximum = tonumber(ARGV[6])
local count = redis.call('ZCARD', KEYS[1])
if count > maximum then
  local removed = redis.call('ZRANGE', KEYS[1], 0, count - maximum - 1)
  if #removed > 0 then
    redis.call('ZREM', KEYS[1], unpack(removed))
    redis.call('HDEL', KEYS[2], unpack(removed))
    redis.call('HDEL', KEYS[3], unpack(removed))
  end
end
if ARGV[7] ~= '' then
  local expired = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[7])
  if #expired > 0 then
    redis.call('ZREM', KEYS[1], unpack(expired))
    redis.call('HDEL', KEYS[2], unpack(expired))
    redis.call('HDEL', KEYS[3], unpack(expired))
  end
end
return 1
`;

const ADVANCE_HIGHWATER_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local candidate = tonumber(ARGV[1])
if candidate > current then redis.call('SET', KEYS[1], candidate) end
return 1
`;

const ADVANCE_ACTIVE_CHECKPOINT_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
local current = tonumber(redis.call('GET', KEYS[2]) or '0')
local candidate = tonumber(ARGV[2])
if candidate > current then redis.call('SET', KEYS[2], candidate) end
return 1
`;

const BEGIN_GENERATION_SCRIPT = `
local rebuilding = redis.call('GET', KEYS[3])
local attempt = redis.call('GET', KEYS[4])
if rebuilding and rebuilding ~= ARGV[1] then return 0 end
if attempt and attempt ~= ARGV[2] then return 0 end
if attempt == ARGV[2] then
  redis.call('PEXPIRE', KEYS[4], ARGV[3])
else
  local acquired = redis.call('SET', KEYS[4], ARGV[2], 'NX', 'PX', ARGV[3])
  if not acquired then return 0 end
end
redis.call('SET', KEYS[3], ARGV[1])
return 1
`;

const RENEW_GENERATION_ATTEMPT_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
if redis.call('GET', KEYS[2]) ~= ARGV[2] then return 0 end
redis.call('PEXPIRE', KEYS[2], ARGV[3])
return 1
`;

const RESET_REBUILD_GENERATION_SCRIPT = `
if redis.call('GET', KEYS[4]) ~= ARGV[1] then return 0 end
if redis.call('GET', KEYS[5]) ~= ARGV[2] then return 0 end
redis.call('DEL', KEYS[1], KEYS[2], KEYS[3])
redis.call('SET', KEYS[1], 1)
redis.call('SET', KEYS[2], 0)
redis.call('PEXPIRE', KEYS[5], ARGV[3])
return 1
`;

const ABANDON_GENERATION_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
if redis.call('GET', KEYS[2]) ~= ARGV[2] then return 0 end
redis.call('DEL', KEYS[1], KEYS[2])
return 1
`;

const PUBLISH_GENERATION_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
if redis.call('GET', KEYS[4]) ~= ARGV[2] then return 0 end
if redis.call('GET', KEYS[5]) ~= ARGV[3] then return 0 end
if not redis.call('GET', KEYS[3]) then return 0 end
local checkpoint = tonumber(redis.call('GET', KEYS[2]) or '0')
local highwater = tonumber(redis.call('GET', KEYS[3]) or '0')
if highwater < checkpoint then return 0 end
redis.call('SET', KEYS[2], highwater)
redis.call('SET', KEYS[1], ARGV[2])
redis.call('DEL', KEYS[4], KEYS[5])
return 1
`;

export function createValkeyOnlineProjectionWriter<
	TRow extends object,
	TValue extends object,
>(
	options: ValkeyOnlineProjectionWriterOptions<TRow, TValue>,
): ApplicationValkeyOnlineProjectionWriter<TRow, TValue> {
	validateIdentifier(options.prefix, "prefix");
	validateIdentifier(options.projection, "projection");
	validateIdentifier(options.stream, "stream");
	const initialGeneration = options.initialGeneration ?? "live";
	validateIdentifier(initialGeneration, "initial generation");
	if (
		!Number.isSafeInteger(options.retention.maxItemsPerPartition) ||
		options.retention.maxItemsPerPartition < 1 ||
		options.retention.maxItemsPerPartition > 1_000_000
	) {
		throw new Error(
			"Valkey online projection maxItemsPerPartition must be between 1 and 1000000.",
		);
	}
	if (
		options.retention.maxAgeSeconds !== undefined &&
		(!Number.isSafeInteger(options.retention.maxAgeSeconds) ||
			options.retention.maxAgeSeconds < 1)
	) {
		throw new Error(
			"Valkey online projection maxAgeSeconds must be a positive safe integer.",
		);
	}
	const maxPartitions = options.retention.maxPartitions ?? 100_000;
	if (
		!Number.isSafeInteger(maxPartitions) ||
		maxPartitions < 1 ||
		maxPartitions > 1_000_000
	) {
		throw new Error(
			"Valkey online projection maxPartitions must be between 1 and 1000000.",
		);
	}
	const scoreUnit = options.scoreUnit ?? "arbitrary";
	if (
		options.retention.maxAgeSeconds !== undefined &&
		scoreUnit !== "epochMilliseconds"
	) {
		throw new Error(
			"Valkey online projection requires scoreUnit: 'epochMilliseconds' when maxAgeSeconds is enabled.",
		);
	}
	const command =
		options.command ??
		createApplicationValkeyCommand({
			host: requiredHost(options.host),
			...(options.port === undefined ? {} : { port: options.port }),
			...(options.password === undefined ? {} : { password: options.password }),
			...(options.timeoutMs === undefined
				? {}
				: { timeoutMs: options.timeoutMs }),
		});
	const root = `${options.prefix}:projection:${options.projection}`;
	const metadataTag = `{${root}:metadata}`;
	const activeKey = `${metadataTag}:active-generation`;
	const checkpointKey = `${metadataTag}:checkpoint:${options.stream}`;
	const rebuildingKey = `${metadataTag}:rebuilding-generation`;
	const rebuildAttemptKey = `${metadataTag}:rebuild-attempt`;
	const rowSchema = options.schema
		? normalizeSchema<TRow>(options.schema, `${options.projection}.row`)
		: undefined;
	const valueSchema = normalizeSchema<TValue>(
		options.valueSchema,
		`${options.projection}.value`,
	);
	const reader = valkeyOnlineProjectionReader({
		command,
		root,
		activeKey,
		checkpointKey,
		rebuildingKey,
		projection: options.projection,
		stream: options.stream,
		valueSchema,
		snapshotAttempts: 3,
	});

	const store: ApplicationValkeyOnlineProjectionWriter<TRow, TValue> = {
		async prepare() {
			await command(["SETNX", activeKey, initialGeneration]);
			await command(["SETNX", checkpointKey, 0]);
		},
		async checkpoint(projection, stream) {
			assertScope(projection, stream, options);
			const raw = await command(["GET", checkpointKey]);
			return {
				projection,
				stream,
				sequence: nonNegativeInteger(raw, "checkpoint"),
			};
		},
		async write(events) {
			for (const event of events) {
				let committed = false;
				for (let attempt = 0; attempt < 4 && !committed; attempt += 1) {
					const generation = await store.activeGeneration();
					await writeToGeneration(generation, [event]);
					committed =
						(await command([
							"EVAL",
							ADVANCE_ACTIVE_CHECKPOINT_SCRIPT,
							2,
							activeKey,
							checkpointKey,
							generation,
							event.envelope.sequence,
						])) === 1;
				}
				if (!committed)
					throw new Error(
						`Valkey online projection ${options.projection} active generation changed repeatedly while applying event ${event.envelope.id}.`,
					);
			}
		},
		async advance(checkpoint) {
			assertScope(checkpoint.projection, checkpoint.stream, options);
			if (!Number.isSafeInteger(checkpoint.sequence) || checkpoint.sequence < 0)
				throw new Error(
					"Valkey online projection checkpoint must be a non-negative safe integer.",
				);
			// A processor batch that started before a generation publication can
			// finish after the atomic generation switch. Checkpoints are durable
			// watermarks, so that stale completion must never move the published
			// generation backwards.
			await command([
				"EVAL",
				ADVANCE_HIGHWATER_SCRIPT,
				1,
				checkpointKey,
				checkpoint.sequence,
			]);
		},
		async reset(projection, stream) {
			assertScope(projection, stream, options);
			const generation = await store.activeGeneration();
			await store.resetGeneration(generation);
			await command(["SET", checkpointKey, 0]);
		},
		async page(pageOptions) {
			return reader.page(pageOptions);
		},
		async activeGeneration() {
			const generation = await command(["GET", activeKey]);
			if (typeof generation !== "string" || !generation)
				throw new Error(
					`Valkey online projection ${options.projection} has no active generation.`,
				);
			return generation;
		},
		async rebuildState() {
			const values = await command([
				"MGET",
				activeKey,
				checkpointKey,
				rebuildingKey,
			]);
			if (!Array.isArray(values) || values.length !== 3)
				throw new Error(
					`Valkey online projection ${options.projection} returned invalid rebuild state.`,
				);
			const [active, checkpoint, rebuilding] = values;
			if (typeof active !== "string" || !active)
				throw new Error(
					`Valkey online projection ${options.projection} has no active generation.`,
				);
			if (rebuilding !== null && typeof rebuilding !== "string")
				throw new Error(
					`Valkey online projection ${options.projection} returned an invalid rebuilding generation.`,
				);
			return {
				activeGeneration: active,
				eventWatermark: nonNegativeInteger(checkpoint ?? null, "checkpoint"),
				...(rebuilding ? { rebuildingGeneration: rebuilding } : {}),
			};
		},
		async beginGeneration(generation, attemptId, leaseMs) {
			validateIdentifier(generation, "generation");
			validateAttempt(attemptId, leaseMs);
			const keys = generationKeys(root, generation, "_");
			if (generation === (await store.activeGeneration()))
				throw new Error(
					`Valkey online projection ${options.projection} cannot rebuild its active generation ${generation}.`,
				);
			const admitted = await command([
				"EVAL",
				BEGIN_GENERATION_SCRIPT,
				4,
				keys.marker,
				keys.highwater,
				rebuildingKey,
				rebuildAttemptKey,
				generation,
				attemptId,
				leaseMs,
			]);
			if (admitted !== 1)
				throw new Error(
					`Valkey online projection ${options.projection} already has another rebuild attempt in progress.`,
				);
			rebuildLeaseMs = leaseMs;
		},
		async renewGenerationAttempt(generation, attemptId) {
			validateIdentifier(generation, "generation");
			await renewGenerationAttempt(generation, attemptId);
		},
		async writeGeneration(generation, attemptId, events) {
			validateIdentifier(generation, "generation");
			await renewGenerationAttempt(generation, attemptId);
			await writeToGeneration(generation, events, attemptId);
		},
		async generationHighwater(generation) {
			validateIdentifier(generation, "generation");
			return nonNegativeInteger(
				await command(["GET", generationKeys(root, generation, "_").highwater]),
				"generation highwater",
			);
		},
		async publishGeneration(generation, expectedGeneration, attemptId) {
			validateIdentifier(generation, "generation");
			validateIdentifier(expectedGeneration, "expected generation");
			validateAttemptId(attemptId);
			const keys = generationKeys(root, generation, "_");
			return (
				(await command([
					"EVAL",
					PUBLISH_GENERATION_SCRIPT,
					5,
					activeKey,
					checkpointKey,
					keys.highwater,
					rebuildingKey,
					rebuildAttemptKey,
					expectedGeneration,
					generation,
					attemptId,
				])) === 1
			);
		},
		async resetGeneration(generation, attemptId) {
			validateIdentifier(generation, "generation");
			if (generation === (await store.activeGeneration()))
				throw new Error(
					`Valkey online projection ${options.projection} cannot reset active generation ${generation}.`,
				);
			if (attemptId) await renewGenerationAttempt(generation, attemptId);
			const keys = generationKeys(root, generation, "_");
			const partitions = stringArray(
				await command(["SMEMBERS", keys.partitions]),
			);
			for (const partition of partitions) {
				if (attemptId) await renewGenerationAttempt(generation, attemptId);
				const partitionKeys = generationKeys(root, generation, partition);
				await command([
					"DEL",
					partitionKeys.order,
					partitionKeys.values,
					partitionKeys.versions,
				]);
			}
			if (attemptId) {
				const reset = await command([
					"EVAL",
					RESET_REBUILD_GENERATION_SCRIPT,
					5,
					keys.marker,
					keys.highwater,
					keys.partitions,
					rebuildingKey,
					rebuildAttemptKey,
					generation,
					attemptId,
					rebuildLeaseMs,
				]);
				if (reset !== 1)
					throw new Error(
						`Valkey online projection ${options.projection} rebuild attempt ${attemptId} lost its lease while resetting generation ${generation}.`,
					);
			} else {
				await command(["DEL", keys.partitions, keys.highwater, keys.marker]);
				const rebuilding = await command(["GET", rebuildingKey]);
				if (rebuilding === generation)
					await command(["DEL", rebuildingKey, rebuildAttemptKey]);
			}
		},
		async abandonGeneration(generation, attemptId) {
			validateIdentifier(generation, "generation");
			validateAttemptId(attemptId);
			await command([
				"EVAL",
				ABANDON_GENERATION_SCRIPT,
				2,
				rebuildingKey,
				rebuildAttemptKey,
				generation,
				attemptId,
			]);
		},
	};

	let rebuildLeaseMs = 120_000;

	async function renewGenerationAttempt(
		generation: string,
		attemptId: string,
	): Promise<void> {
		validateAttemptId(attemptId);
		const renewed = await command([
			"EVAL",
			RENEW_GENERATION_ATTEMPT_SCRIPT,
			2,
			rebuildingKey,
			rebuildAttemptKey,
			generation,
			attemptId,
			rebuildLeaseMs,
		]);
		if (renewed !== 1)
			throw new Error(
				`Valkey online projection ${options.projection} rebuild attempt ${attemptId} does not own generation ${generation}.`,
			);
	}

	async function writeToGeneration(
		generation: string,
		events: readonly ApplicationOnlineProjectionWrite<TRow>[],
		attemptId?: string,
	): Promise<void> {
		const metadataKeys = generationKeys(root, generation, "_");
		for (const event of events) {
			if (attemptId) await renewGenerationAttempt(generation, attemptId);
			const highwater = nonNegativeInteger(
				await command(["GET", metadataKeys.highwater]),
				"generation highwater",
			);
			if (event.envelope.sequence < highwater) continue;
			for (const raw of event.rows) {
				if (attemptId) await renewGenerationAttempt(generation, attemptId);
				// typecast: map callbacks are compiler-owned and final provider values are schema-validated below;
				// callers may additionally supply an intermediate row schema for a stricter standalone boundary.
				const row = rowSchema
					? validate(rowSchema, raw, `${options.projection}.row`)
					: (raw as TRow);
				const partition = nonEmpty(options.partitionBy(row), "partition");
				const member = nonEmpty(options.key(row), "key");
				const score = options.score(row);
				if (!Number.isFinite(score))
					throw new Error(
						`Valkey online projection ${options.projection} score must be finite.`,
					);
				if (
					scoreUnit === "epochMilliseconds" &&
					(!Number.isSafeInteger(score) || score < 0)
				)
					throw new Error(
						`Valkey online projection ${options.projection} epoch-millisecond score must be a non-negative safe integer.`,
					);
				const value = validate(
					valueSchema,
					options.value(row),
					`${options.projection}.value`,
				);
				const keys = generationKeys(root, generation, partition);
				const minimumScore =
					options.retention.maxAgeSeconds === undefined
						? ""
						: String(
								Date.parse(event.envelope.recordedAt) -
									options.retention.maxAgeSeconds * 1_000,
							);
				await command([
					"EVAL",
					RESERVE_PARTITION_SCRIPT,
					1,
					keys.partitions,
					partition,
					maxPartitions,
				]);
				await command([
					"EVAL",
					APPLY_ROW_SCRIPT,
					3,
					keys.order,
					keys.values,
					keys.versions,
					event.envelope.sequence,
					member,
					score,
					options.removeWhen?.(row) ? 1 : 0,
					JSON.stringify(value),
					options.retention.maxItemsPerPartition,
					minimumScore,
				]);
			}
			await command([
				"EVAL",
				ADVANCE_HIGHWATER_SCRIPT,
				1,
				metadataKeys.highwater,
				event.envelope.sequence,
			]);
		}
	}
	return store;
}

export function createValkeyOnlineProjectionReader<TValue extends object>(
	options: ValkeyOnlineProjectionReaderOptions<TValue>,
): ApplicationValkeyOnlineProjectionReader<TValue> {
	validateIdentifier(options.prefix, "prefix");
	validateIdentifier(options.projection, "projection");
	validateIdentifier(options.stream, "stream");
	const command =
		options.command ??
		createApplicationValkeyCommand({
			host: requiredHost(options.host),
			...(options.port === undefined ? {} : { port: options.port }),
			...(options.password === undefined ? {} : { password: options.password }),
			...(options.timeoutMs === undefined
				? {}
				: { timeoutMs: options.timeoutMs }),
		});
	const root = `${options.prefix}:projection:${options.projection}`;
	const metadataTag = `{${root}:metadata}`;
	return valkeyOnlineProjectionReader({
		command,
		root,
		activeKey: `${metadataTag}:active-generation`,
		checkpointKey: `${metadataTag}:checkpoint:${options.stream}`,
		rebuildingKey: `${metadataTag}:rebuilding-generation`,
		projection: options.projection,
		stream: options.stream,
		valueSchema: normalizeSchema<TValue>(
			options.valueSchema,
			`${options.projection}.value`,
		),
		snapshotAttempts: options.snapshotAttempts ?? 3,
	});
}

function valkeyOnlineProjectionReader<TValue extends object>(options: {
	readonly command: ApplicationValkeyCommand;
	readonly root: string;
	readonly activeKey: string;
	readonly checkpointKey: string;
	readonly rebuildingKey: string;
	readonly projection: string;
	readonly stream: string;
	readonly valueSchema: ReturnType<typeof normalizeSchema<TValue>>;
	readonly snapshotAttempts: number;
}): ApplicationValkeyOnlineProjectionReader<TValue> {
	if (
		!Number.isSafeInteger(options.snapshotAttempts) ||
		options.snapshotAttempts < 1 ||
		options.snapshotAttempts > 10
	)
		throw new Error(
			"Valkey online projection snapshotAttempts must be between 1 and 10.",
		);
	const revision = async () => {
		const [generation, checkpoint] = await Promise.all([
			options.command(["GET", options.activeKey]),
			options.command(["GET", options.checkpointKey]),
		]);
		if (typeof generation !== "string" || !generation)
			throw new ApplicationOnlineProjectionUnavailableError(options.projection);
		return `${generation}:${nonNegativeInteger(checkpoint, "checkpoint")}`;
	};
	const reader: ApplicationValkeyOnlineProjectionReader<TValue> = {
		async page(pageOptions) {
			const partitions = normalizePagePartitions(pageOptions);
			const { limit, cursor } = pageOptions;
			if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)
				throw new Error(
					"Valkey online projection page limit must be between 1 and 500.",
				);
			const currentRevision = await revision();
			const offsets = decodeCursor(cursor, currentRevision, partitions);
			const separator = currentRevision.lastIndexOf(":");
			const generation = currentRevision.slice(0, separator);
			const checkpoint = currentRevision.slice(separator + 1);
			const rebuilding = await options.command(["GET", options.rebuildingKey]);
			const candidates = (
				await Promise.all(
					partitions.map(async (partition, index) => {
						const keys = generationKeys(options.root, generation, partition);
						const response = await options.command([
							"ZREVRANGE",
							keys.order,
							offsets[index] ?? 0,
							(offsets[index] ?? 0) + limit,
							"WITHSCORES",
						]);
						return scoredMembers(response).map(({ member, score }) => ({
							partition,
							partitionIndex: index,
							member,
							score,
							valuesKey: keys.values,
						}));
					}),
				)
			)
				.flat()
				.sort(
					(left, right) =>
						right.score - left.score ||
						right.member.localeCompare(left.member) ||
						left.partition.localeCompare(right.partition),
				);
			const selected = candidates.slice(0, limit);
			const nextOffsets = [...offsets];
			for (const candidate of selected)
				nextOffsets[candidate.partitionIndex] =
					(nextOffsets[candidate.partitionIndex] ?? 0) + 1;
			const values = await Promise.all(
				selected.map((candidate) =>
					options.command(["HGET", candidate.valuesKey, candidate.member]),
				),
			);
			const items = values.map((value, index) => {
				const candidate = selected[index];
				if (typeof value !== "string" || !candidate)
					throw new Error(
						`Valkey online projection ${options.projection} lost a selected projection value.`,
					);
				return validate(
					options.valueSchema,
					parseJson(value, `${options.projection}.value`),
					`${options.projection}.value`,
				);
			});
			return {
				items,
				...(candidates.length > limit
					? { cursor: encodeCursor(currentRevision, partitions, nextOffsets) }
					: {}),
				projection: {
					generation,
					eventWatermark: checkpoint,
					rebuilding: typeof rebuilding === "string" && rebuilding.length > 0,
					degraded: false,
				},
			};
		},
		revision,
		async snapshot(operation) {
			for (let attempt = 1; attempt <= options.snapshotAttempts; attempt += 1) {
				const before = await revision();
				const value = await operation(reader);
				const after = await revision();
				if (before === after) return { value, revision: after };
			}
			throw new Error(
				`Valkey online projection ${options.projection} changed during ${options.snapshotAttempts} bounded snapshot attempts.`,
			);
		},
	};
	return reader;
}

function generationKeys(root: string, generation: string, partition: string) {
	const generationRoot = `${root}:generation:${generation}`;
	const metadataTag = `{${root}:metadata}`;
	const encodedPartition = Buffer.from(partition).toString("base64url");
	const partitionTag = `{${generationRoot}:partition:${encodedPartition}}`;
	return {
		order: `${partitionTag}:order`,
		values: `${partitionTag}:values`,
		versions: `${partitionTag}:versions`,
		partitions: `${metadataTag}:generation:${generation}:partitions`,
		highwater: `${metadataTag}:generation:${generation}:highwater`,
		marker: `${metadataTag}:generation:${generation}:marker`,
	};
}

function requiredHost(value: string | undefined): string {
	if (!value?.trim())
		throw new Error(
			"Valkey online projection requires host when command is not supplied.",
		);
	return value;
}

function assertScope(
	projection: string,
	stream: string,
	options: { readonly projection: string; readonly stream: string },
): void {
	if (projection !== options.projection || stream !== options.stream)
		throw new Error(
			"Valkey online projection operation is outside its configured projection and stream scope.",
		);
}

function validateIdentifier(value: string, name: string): void {
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value))
		throw new Error(
			`Valkey online projection ${name} ${JSON.stringify(value)} is invalid.`,
		);
}

function validateAttempt(attemptId: string, leaseMs: number): void {
	validateAttemptId(attemptId);
	if (
		!Number.isSafeInteger(leaseMs) ||
		leaseMs < 30_000 ||
		leaseMs > 30 * 60_000
	) {
		throw new Error(
			"Valkey online projection rebuild leaseMs must be between 30000 and 1800000 milliseconds.",
		);
	}
}

function validateAttemptId(attemptId: string): void {
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(attemptId)) {
		throw new Error(
			`Valkey online projection rebuild attempt ${JSON.stringify(attemptId)} is invalid.`,
		);
	}
}

function nonEmpty(value: string, name: string): string {
	if (!value.trim())
		throw new Error(`Valkey online projection ${name} must not be empty.`);
	if (Buffer.byteLength(value) > 1_024)
		throw new Error(`Valkey online projection ${name} exceeds 1024 bytes.`);
	return value;
}

function nonNegativeInteger(value: ValkeyResponse, name: string): number {
	const parsed = Number(value ?? 0);
	if (!Number.isSafeInteger(parsed) || parsed < 0)
		throw new Error(`Valkey online projection ${name} is invalid.`);
	return parsed;
}

function normalizePagePartitions(
	options: ApplicationOnlineProjectionPageOptions,
): readonly string[] {
	const raw =
		"partition" in options && options.partition !== undefined
			? [options.partition]
			: options.partitions;
	if (!raw || raw.length < 1 || raw.length > 250)
		throw new Error(
			"Valkey online projection page must select between 1 and 250 partitions.",
		);
	const partitions = raw.map((partition) => nonEmpty(partition, "partition"));
	if (new Set(partitions).size !== partitions.length)
		throw new Error("Valkey online projection page partitions must be unique.");
	return partitions;
}

function encodeCursor(
	revision: string,
	partitions: readonly string[],
	offsets: readonly number[],
): string {
	const encoded = Buffer.from(
		JSON.stringify({ version: 1, revision, partitions, offsets }),
	).toString("base64url");
	if (encoded.length > 64_000)
		throw new Error(
			"Valkey online projection cursor exceeds its 64000-character bound.",
		);
	return encoded;
}

function decodeCursor(
	cursor: string | undefined,
	currentRevision: string,
	partitions: readonly string[],
): readonly number[] {
	if (cursor === undefined) return partitions.map(() => 0);
	if (cursor.length > 64_000)
		throw new Error(
			"Valkey online projection cursor exceeds its 64000-character bound.",
		);
	let payload: {
		readonly version?: unknown;
		readonly revision?: unknown;
		readonly partitions?: unknown;
		readonly offsets?: unknown;
	};
	try {
		payload = JSON.parse(
			Buffer.from(cursor, "base64url").toString("utf8"),
		) as typeof payload;
	} catch {
		throw new Error("Valkey online projection cursor is invalid.");
	}
	if (
		payload.version !== 1 ||
		typeof payload.revision !== "string" ||
		!Array.isArray(payload.partitions) ||
		!Array.isArray(payload.offsets) ||
		payload.partitions.some((partition) => typeof partition !== "string") ||
		payload.offsets.some(
			(offset) =>
				!Number.isSafeInteger(offset) || offset < 0 || offset > 10_000_000,
		)
	) {
		throw new Error(
			"Valkey online projection cursor is invalid or outside its bounded range.",
		);
	}
	if (payload.revision !== currentRevision)
		throw new Error(
			"Valkey online projection cursor is stale because the projection revision changed; restart from the first page.",
		);
	if (
		JSON.stringify(payload.partitions) !== JSON.stringify(partitions) ||
		payload.offsets.length !== partitions.length
	)
		throw new Error(
			"Valkey online projection cursor does not belong to the requested partitions.",
		);
	return payload.offsets as number[];
}

function scoredMembers(
	value: ValkeyResponse,
): readonly { readonly member: string; readonly score: number }[] {
	if (!Array.isArray(value) || value.length % 2 !== 0)
		throw new Error("Valkey online projection expected member/score pairs.");
	const result: { member: string; score: number }[] = [];
	for (let index = 0; index < value.length; index += 2) {
		const member = value[index];
		const score = Number(value[index + 1]);
		if (typeof member !== "string" || !Number.isFinite(score))
			throw new Error(
				"Valkey online projection received an invalid member/score pair.",
			);
		result.push({ member, score });
	}
	return result;
}

function stringArray(value: ValkeyResponse): string[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
		throw new Error(
			"Valkey online projection expected a string array response.",
		);
	return [...value] as string[];
}

function parseJson(value: string, name: string): JsonValue {
	try {
		return JSON.parse(value) as JsonValue;
	} catch (error) {
		throw new Error(
			`Valkey online projection ${name} contains invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function validate<TValue extends object>(
	schema: ReturnType<typeof normalizeSchema<TValue>>,
	value: unknown,
	name: string,
): TValue {
	const result = schema.validate(value as never);
	if (!result.ok)
		throw new Error(
			`Valkey online projection ${name} validation failed: ${result.error.message}`,
		);
	return result.value;
}
