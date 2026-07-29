// typecast-file-boundary: Persisted rebuild artifacts are schema-checked and integrity-verified before their generic runtime conversion.
import { createHash, randomUUID } from "node:crypto";
import type {
	ApplicationObjectReference,
	ApplicationObjectStorageRuntime,
} from "./application-object-storage.js";
import type {
	ApplicationReplayableStream,
	ApplicationStreamEnvelope,
} from "./projection-runtime-clickhouse.js";
import { ApplicationProjectionRetentionGapError } from "./projection-runtime-clickhouse.js";
import type {
	ApplicationOnlineProjectionWrite,
	ApplicationValkeyOnlineProjectionStore,
} from "./projection-runtime-valkey.js";
import type { ApplicationProjectionSnapshotSource } from "./projection-snapshot-postgres-runtime.js";

const segmentProtocol = "applik8s.online-projection-segment/v1alpha1";
const manifestProtocol = "applik8s.online-projection-rebuild/v1alpha1";
const segmentContentType = "application/vnd.applik8s.projection-segment+json";
const manifestContentType = "application/vnd.applik8s.projection-rebuild+json";

export interface ApplicationOnlineProjectionRebuildOptions<
	TPayload extends object,
	TRow extends object,
	TValue extends object,
> {
	readonly projection: string;
	readonly streamName: string;
	readonly generation: string;
	readonly source: ApplicationReplayableStream<TPayload>;
	/** Optional canonical snapshot authority used before retained stream catch-up. */
	readonly snapshot?: ApplicationProjectionSnapshotSource<TPayload>;
	readonly snapshotPartition?: (payload: TPayload) => string;
	readonly store: ApplicationValkeyOnlineProjectionStore<TRow, TValue>;
	readonly artifacts: ApplicationObjectStorageRuntime;
	readonly artifactPrefix?: string;
	readonly project: (
		payload: TPayload,
		event: {
			readonly id: string;
			readonly recordedAt: string;
			readonly partitionKey: string;
		},
	) => TRow | readonly TRow[] | Promise<TRow | readonly TRow[]>;
	readonly batchSize?: number;
	readonly maxSegments?: number;
	readonly maxSegmentBytes?: number;
	readonly maxEvents?: number;
	readonly maxCatchUpRounds?: number;
	/** Stable only for test/replay diagnostics; production attempts use a fresh random identity. */
	readonly attemptId?: string;
	/** Exclusive rebuild-attempt lease. A crashed worker can be replaced after this bounded interval. */
	readonly attemptLeaseMs?: number;
}

export interface ApplicationOnlineProjectionRebuildResult {
	readonly projection: string;
	readonly stream: string;
	readonly generation: string;
	readonly previousGeneration: string;
	readonly sourceWatermark: number;
	readonly publishedWatermark: number;
	readonly segments: readonly ApplicationObjectReference[];
	readonly manifest: ApplicationObjectReference;
	readonly events: number;
	readonly rows: number;
}

interface ProjectionSegment<TRow extends object> {
	readonly protocol: typeof segmentProtocol;
	readonly projection: string;
	readonly stream: string;
	readonly generation: string;
	readonly attemptId: string;
	readonly ordinal: number;
	readonly afterSequence: number;
	readonly throughSequence: number;
	readonly events: readonly ApplicationOnlineProjectionWrite<TRow>[];
}

interface ProjectionRebuildManifest {
	readonly protocol: typeof manifestProtocol;
	readonly projection: string;
	readonly stream: string;
	readonly generation: string;
	readonly attemptId: string;
	readonly definitionDigest: string;
	readonly previousGeneration: string;
	readonly capturedProjectionWatermark: number;
	readonly sourceWatermark: number;
	readonly sourceKind: "model-snapshot" | "stream-replay";
	readonly snapshotRecordedAt?: string;
	readonly events: number;
	readonly rows: number;
	readonly partitions: Readonly<Record<string, number>>;
	readonly segments: readonly ApplicationObjectReference[];
}

/**
 * Reconstructs one inactive online-projection generation from its replayable
 * source, persists immutable evidence, catches up concurrent writes, and only
 * then publishes the generation through the store's atomic high-water guard.
 */
export async function runApplicationOnlineProjectionRebuild<
	TPayload extends object,
	TRow extends object,
	TValue extends object,
>(
	options: ApplicationOnlineProjectionRebuildOptions<TPayload, TRow, TValue>,
): Promise<ApplicationOnlineProjectionRebuildResult> {
	const batchSize = boundedInteger(
		options.batchSize ?? 500,
		1,
		1_000,
		"batchSize",
	);
	const maxSegments = boundedInteger(
		options.maxSegments ?? 10_000,
		1,
		100_000,
		"maxSegments",
	);
	const maxSegmentBytes = boundedInteger(
		options.maxSegmentBytes ?? 8_000_000,
		1_024,
		100_000_000,
		"maxSegmentBytes",
	);
	const maxEvents = boundedInteger(
		options.maxEvents ?? 10_000_000,
		1,
		100_000_000,
		"maxEvents",
	);
	const maxCatchUpRounds = boundedInteger(
		options.maxCatchUpRounds ?? 16,
		1,
		1_000,
		"maxCatchUpRounds",
	);
	const attemptLeaseMs = boundedInteger(
		options.attemptLeaseMs ?? 120_000,
		30_000,
		30 * 60_000,
		"attemptLeaseMs",
	);
	const attemptId = options.attemptId ?? randomUUID();
	validateGeneration(attemptId);
	validateGeneration(options.generation);
	const artifactPrefix = safePrefix(
		options.artifactPrefix ?? `projection-rebuilds/${options.projection}`,
	);
	if (
		(options.snapshot === undefined) !==
		(options.snapshotPartition === undefined)
	)
		throw new Error(
			`Projection rebuild ${options.projection} snapshot and snapshotPartition must be configured together.`,
		);
	const sourceKind: ProjectionRebuildManifest["sourceKind"] = options.snapshot
		? "model-snapshot"
		: "stream-replay";
	const definitionDigest = rebuildDefinitionDigest(options, {
		sourceKind,
		artifactPrefix,
		batchSize,
		maxSegments,
		maxSegmentBytes,
		maxEvents,
	});
	const manifestKey = `${artifactPrefix}/${options.generation}/manifest.json`;
	await options.store.prepare();
	const captured = await options.store.rebuildState();
	const recovered = await readRebuildManifest(
		options.artifacts,
		manifestKey,
		maxSegmentBytes,
		{
			projection: options.projection,
			stream: options.streamName,
			generation: options.generation,
			definitionDigest,
			sourceKind,
			artifactPrefix,
			maxSegments,
		},
	);
	const recoveredSegments = recovered
		? await validateManifestSegments<TRow, TPayload, TValue>(
				options.artifacts,
				recovered.value,
				options,
				artifactPrefix,
				maxSegments,
			)
		: undefined;
	if (captured.activeGeneration === options.generation) {
		if (!recovered)
			throw new Error(
				`Projection rebuild ${options.projection} generation ${options.generation} is active but its immutable manifest is missing.`,
			);
		if (captured.eventWatermark < recovered.value.sourceWatermark)
			throw new Error(
				`Projection rebuild ${options.projection} active generation ${options.generation} is behind its immutable source watermark.`,
			);
		return rebuildResult(
			recovered.value,
			recovered.reference,
			captured.eventWatermark,
		);
	}
	if (
		recovered &&
		recovered.value.previousGeneration !== captured.activeGeneration
	) {
		throw new Error(
			`Projection rebuild ${options.projection} generation ${options.generation} was prepared from active generation ${recovered.value.previousGeneration}, but ${captured.activeGeneration} is active now.`,
		);
	}
	if (
		recovered &&
		recovered.value.capturedProjectionWatermark > captured.eventWatermark
	) {
		throw new Error(
			`Projection rebuild ${options.projection} durable manifest is ahead of the active projection watermark.`,
		);
	}
	if (
		captured.rebuildingGeneration &&
		captured.rebuildingGeneration !== options.generation
	) {
		throw new Error(
			`Projection rebuild ${options.projection} already has generation ${captured.rebuildingGeneration} in progress.`,
		);
	}
	await options.store.beginGeneration(
		options.generation,
		attemptId,
		attemptLeaseMs,
	);
	const heartbeat = startGenerationAttemptHeartbeat(
		options.store,
		options.generation,
		attemptId,
		attemptLeaseMs,
		options.projection,
	);
	let completed = false;
	try {
		// Always reconstruct an inactive generation from an empty store. A
		// previous process may have crashed after writing only part of a snapshot;
		// immutable segment evidence can be replayed, but partial Valkey rows can
		// never be trusted to represent deletions that happened before retry.
		await options.store.resetGeneration(options.generation, attemptId);
		heartbeat.assertHealthy();

		const segments: ApplicationObjectReference[] = recovered
			? [...recovered.value.segments]
			: [];
		const partitions = new Map<string, number>(
			recovered ? Object.entries(recovered.value.partitions) : [],
		);
		let afterSequence = recovered?.value.sourceWatermark ?? 0;
		let eventCount = recovered?.value.events ?? 0;
		let rowCount = recovered?.value.rows ?? 0;
		let snapshotRecordedAt = recovered?.value.snapshotRecordedAt;
		const persistSegment = async (
			envelopes: readonly ApplicationStreamEnvelope<TPayload>[],
			segmentAfter: number,
			throughSequence: number,
			ordinal: number,
		) => {
			const events = await projectEvents(envelopes, options.project);
			heartbeat.assertHealthy();
			eventCount += events.length;
			rowCount += events.reduce((total, event) => total + event.rows.length, 0);
			if (eventCount > maxEvents)
				throw new Error(
					`Projection rebuild ${options.projection} exceeded its ${maxEvents}-event bound.`,
				);
			for (const event of events)
				partitions.set(
					event.envelope.partitionKey,
					(partitions.get(event.envelope.partitionKey) ?? 0) + 1,
				);
			if (events.length > 0) {
				const segment: ProjectionSegment<TRow> = {
					protocol: segmentProtocol,
					projection: options.projection,
					stream: options.streamName,
					generation: options.generation,
					attemptId,
					ordinal,
					afterSequence: segmentAfter,
					throughSequence,
					events,
				};
				const bytes = encodeArtifact(
					segment,
					maxSegmentBytes,
					`${options.projection} segment ${ordinal}`,
				);
				const key = `${artifactPrefix}/${options.generation}/attempts/${attemptId}/segment-${String(ordinal).padStart(8, "0")}.json`;
				segments.push(
					await putOrVerifyArtifact(
						options.artifacts,
						key,
						segmentContentType,
						bytes,
					),
				);
				heartbeat.assertHealthy();
			}
		};
		if (!recovered) {
			if (options.snapshot && options.snapshotPartition) {
				const snapshot = await options.snapshot.scan({
					batchSize,
					maxItems: maxEvents,
					visit: async (page) => {
						if (page.ordinal >= maxSegments)
							throw new Error(
								`Projection rebuild ${options.projection} exceeded its ${maxSegments}-segment bound while scanning authority.`,
							);
						const envelopes = page.items.map(
							({ id, payload }) =>
								({
									id: `snapshot:${options.projection}:${id}`,
									stream: streamIdentity(options.streamName),
									sequence: page.watermark,
									partitionKey: requiredPartition(
										options.snapshotPartition?.(payload),
										options.projection,
									),
									recordedAt: page.recordedAt,
									payload,
								}) satisfies ApplicationStreamEnvelope<TPayload>,
						);
						await persistSegment(
							envelopes,
							page.watermark,
							page.watermark,
							page.ordinal,
						);
					},
				});
				heartbeat.assertHealthy();
				afterSequence = snapshot.watermark;
				snapshotRecordedAt = snapshot.recordedAt;
			} else {
				let exhausted = false;
				for (let ordinal = 0; ordinal < maxSegments; ordinal += 1) {
					const page = await options.source.read(afterSequence, batchSize);
					heartbeat.assertHealthy();
					assertRetention(options, afterSequence, page.retentionFloor);
					await persistSegment(
						page.items,
						afterSequence,
						page.nextSequence,
						ordinal,
					);
					afterSequence = page.nextSequence;
					if (page.exhausted) {
						exhausted = true;
						break;
					}
				}
				if (!exhausted)
					throw new Error(
						`Projection rebuild ${options.projection} exceeded its ${maxSegments}-segment bound before reaching the source watermark.`,
					);
			}
		}

		for (const [index, reference] of segments.entries()) {
			const segment =
				recoveredSegments?.[index] ??
				(await readSegment<TRow, TPayload, TValue>(
					options.artifacts,
					reference,
					options,
					artifactPrefix,
					maxSegments,
				));
			heartbeat.assertHealthy();
			await options.store.writeGeneration(
				options.generation,
				attemptId,
				segment.events,
			);
		}
		// A valid snapshot may contain no projected rows. Advance the inactive
		// generation explicitly so publication still proves it represents the
		// captured committed stream frontier.
		if (options.snapshot) {
			if (!snapshotRecordedAt)
				throw new Error(
					`Projection rebuild ${options.projection} authoritative snapshot did not report its captured timestamp.`,
				);
			await options.store.writeGeneration(options.generation, attemptId, [
				{
					envelope: {
						id: `snapshot-watermark:${options.projection}:${options.generation}`,
						stream: streamIdentity(options.streamName),
						sequence: afterSequence,
						partitionKey: "__snapshot__",
						recordedAt: snapshotRecordedAt,
						// The store consumes only envelope ordering for an empty write.
						payload: {} as TPayload,
					},
					rows: [],
				},
			]);
		}
		const sourceWatermark = afterSequence;
		const manifestValue: ProjectionRebuildManifest = recovered?.value ?? {
			protocol: manifestProtocol,
			projection: options.projection,
			stream: options.streamName,
			generation: options.generation,
			attemptId,
			definitionDigest,
			previousGeneration: captured.activeGeneration,
			capturedProjectionWatermark: captured.eventWatermark,
			sourceWatermark,
			sourceKind,
			...(snapshotRecordedAt ? { snapshotRecordedAt } : {}),
			events: eventCount,
			rows: rowCount,
			partitions: Object.fromEntries(
				[...partitions].sort(([left], [right]) => left.localeCompare(right)),
			),
			segments,
		};
		const manifest =
			recovered?.reference ??
			(await putOrVerifyArtifact(
				options.artifacts,
				manifestKey,
				manifestContentType,
				encodeArtifact(
					manifestValue,
					maxSegmentBytes,
					`${options.projection} rebuild manifest`,
				),
			));
		heartbeat.assertHealthy();

		let published = false;
		for (let round = 0; round < maxCatchUpRounds && !published; round += 1) {
			afterSequence = await options.store.generationHighwater(
				options.generation,
			);
			const page = await options.source.read(afterSequence, batchSize);
			heartbeat.assertHealthy();
			assertRetention(options, afterSequence, page.retentionFloor);
			const events = await projectEvents(page.items, options.project);
			heartbeat.assertHealthy();
			await options.store.writeGeneration(
				options.generation,
				attemptId,
				events,
			);
			if (!page.exhausted) continue;
			published = await options.store.publishGeneration(
				options.generation,
				manifestValue.previousGeneration,
				attemptId,
			);
			if (!published) {
				const raced = await options.store.rebuildState();
				if (raced.activeGeneration === options.generation) published = true;
				else if (raced.activeGeneration !== manifestValue.previousGeneration) {
					throw new Error(
						`Projection rebuild ${options.projection} active generation changed from ${manifestValue.previousGeneration} to ${raced.activeGeneration} while publishing ${options.generation}.`,
					);
				}
			}
		}
		if (!published)
			throw new Error(
				`Projection rebuild ${options.projection} could not catch generation ${options.generation} up to the moving live watermark in ${maxCatchUpRounds} bounded rounds.`,
			);
		const publishedState = await options.store.rebuildState();
		if (publishedState.activeGeneration !== options.generation)
			throw new Error(
				`Projection rebuild ${options.projection} published without observing generation ${options.generation} as active.`,
			);
		const result = {
			projection: options.projection,
			stream: options.streamName,
			generation: options.generation,
			previousGeneration: manifestValue.previousGeneration,
			sourceWatermark,
			publishedWatermark: publishedState.eventWatermark,
			segments,
			manifest,
			events: eventCount,
			rows: rowCount,
		};
		completed = true;
		return result;
	} finally {
		await heartbeat.stop();
		if (!completed) {
			// A normal failure releases promptly. A hard process crash leaves only
			// the expiring lease, so another worker cannot overlap it and can safely
			// reset the incomplete generation after the lease expires.
			await options.store
				.abandonGeneration(options.generation, attemptId)
				.catch(() => undefined);
		}
	}
}

interface GenerationAttemptHeartbeat {
	assertHealthy(): void;
	stop(): Promise<void>;
}

/**
 * Keeps a rebuild attempt alive while authority scans, user projection code,
 * and object-storage calls are awaiting I/O. Store mutations still renew and
 * validate ownership themselves; this background heartbeat closes the gaps
 * between those mutations without weakening the atomic publish guard.
 */
function startGenerationAttemptHeartbeat<
	TRow extends object,
	TValue extends object,
>(
	store: ApplicationValkeyOnlineProjectionStore<TRow, TValue>,
	generation: string,
	attemptId: string,
	leaseMs: number,
	projection: string,
): GenerationAttemptHeartbeat {
	const intervalMs = Math.max(1_000, Math.floor(leaseMs / 3));
	let stopped = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let inFlight: Promise<void> | undefined;
	let failure: unknown;

	const schedule = (): void => {
		if (stopped || failure !== undefined) return;
		timer = setTimeout(() => {
			timer = undefined;
			inFlight = store
				.renewGenerationAttempt(generation, attemptId)
				.catch((cause) => {
					failure = cause;
				})
				.finally(() => {
					inFlight = undefined;
					schedule();
				});
		}, intervalMs);
		timer.unref?.();
	};
	schedule();

	return {
		assertHealthy() {
			if (failure !== undefined) {
				throw new Error(
					`Projection rebuild ${projection} lost its generation-attempt heartbeat for ${generation}.`,
					{ cause: failure },
				);
			}
		},
		async stop() {
			stopped = true;
			if (timer !== undefined) clearTimeout(timer);
			await inFlight;
		},
	};
}

interface RebuildManifestExpectation {
	readonly projection: string;
	readonly stream: string;
	readonly generation: string;
	readonly definitionDigest: string;
	readonly sourceKind: ProjectionRebuildManifest["sourceKind"];
	readonly artifactPrefix: string;
	readonly maxSegments: number;
}

async function readRebuildManifest(
	artifacts: ApplicationObjectStorageRuntime,
	key: string,
	maximumBytes: number,
	expected: RebuildManifestExpectation,
): Promise<
	| {
			readonly value: ProjectionRebuildManifest;
			readonly reference: ApplicationObjectReference;
	  }
	| undefined
> {
	const reference = await artifacts.head(key);
	if (!reference) return undefined;
	if (
		reference.key !== key ||
		reference.contentType !== manifestContentType ||
		!Number.isSafeInteger(reference.size) ||
		reference.size < 1 ||
		reference.size > maximumBytes ||
		!isSha256(reference.sha256)
	) {
		throw new Error(
			`Projection rebuild manifest ${key} has invalid integrity metadata.`,
		);
	}
	const bytes = await artifacts.get(key);
	if (!bytes)
		throw new Error(
			`Projection rebuild manifest ${key} is missing after its metadata was observed.`,
		);
	if (
		bytes.byteLength !== reference.size ||
		createHash("sha256").update(bytes).digest("hex") !==
			normalizeDigest(reference.sha256)
	) {
		throw new Error(
			`Projection rebuild manifest ${key} failed SHA-256 validation.`,
		);
	}
	let decoded: unknown;
	try {
		decoded = JSON.parse(new TextDecoder().decode(bytes));
	} catch (cause) {
		throw new Error(`Projection rebuild manifest ${key} is not valid JSON.`, {
			cause,
		});
	}
	const value = projectionRebuildManifest(decoded, expected, maximumBytes);
	return { value, reference };
}

function projectionRebuildManifest(
	value: unknown,
	expected: RebuildManifestExpectation,
	maximumBytes: number,
): ProjectionRebuildManifest {
	if (
		!isRecord(value) ||
		value.protocol !== manifestProtocol ||
		value.projection !== expected.projection ||
		value.stream !== expected.stream ||
		value.generation !== expected.generation
	) {
		throw new Error(
			`Projection rebuild manifest for ${expected.projection} does not match its declared projection scope.`,
		);
	}
	if (value.definitionDigest !== expected.definitionDigest) {
		throw new Error(
			`Projection rebuild ${expected.projection} generation ${expected.generation} was created by a different projection definition.`,
		);
	}
	if (value.sourceKind !== expected.sourceKind)
		throw new Error(
			`Projection rebuild ${expected.projection} manifest has a different authoritative source kind.`,
		);
	const previousGeneration = requiredManifestString(
		value.previousGeneration,
		"previousGeneration",
	);
	const attemptId = requiredManifestString(value.attemptId, "attemptId");
	validateGeneration(attemptId);
	const capturedProjectionWatermark = manifestInteger(
		value.capturedProjectionWatermark,
		"capturedProjectionWatermark",
	);
	const sourceWatermark = manifestInteger(
		value.sourceWatermark,
		"sourceWatermark",
	);
	const events = manifestInteger(value.events, "events");
	const rows = manifestInteger(value.rows, "rows");
	if (
		!Array.isArray(value.segments) ||
		value.segments.length > expected.maxSegments
	)
		throw new Error(
			`Projection rebuild ${expected.projection} manifest has an invalid segment list.`,
		);
	const segments = value.segments.map((candidate, index) =>
		manifestObjectReference(
			candidate,
			expected,
			maximumBytes,
			attemptId,
			index,
		),
	);
	if (!isRecord(value.partitions))
		throw new Error(
			`Projection rebuild ${expected.projection} manifest has invalid partition evidence.`,
		);
	const partitions: Record<string, number> = {};
	for (const [partition, count] of Object.entries(value.partitions)) {
		if (!partition || Buffer.byteLength(partition) > 1_024)
			throw new Error(
				`Projection rebuild ${expected.projection} manifest contains an invalid partition key.`,
			);
		partitions[partition] = manifestInteger(count, `partition ${partition}`);
	}
	const snapshotRecordedAt =
		typeof value.snapshotRecordedAt === "string" &&
		Number.isFinite(Date.parse(value.snapshotRecordedAt))
			? new Date(value.snapshotRecordedAt).toISOString()
			: undefined;
	if (expected.sourceKind === "model-snapshot" && !snapshotRecordedAt)
		throw new Error(
			`Projection rebuild ${expected.projection} manifest has no valid authoritative snapshot timestamp.`,
		);
	if (
		expected.sourceKind === "stream-replay" &&
		value.snapshotRecordedAt !== undefined
	)
		throw new Error(
			`Projection rebuild ${expected.projection} stream-replay manifest unexpectedly contains a snapshot timestamp.`,
		);
	return {
		protocol: manifestProtocol,
		projection: expected.projection,
		stream: expected.stream,
		generation: expected.generation,
		attemptId,
		definitionDigest: expected.definitionDigest,
		previousGeneration,
		capturedProjectionWatermark,
		sourceWatermark,
		sourceKind: expected.sourceKind,
		...(snapshotRecordedAt ? { snapshotRecordedAt } : {}),
		events,
		rows,
		partitions,
		segments,
	};
}

function manifestObjectReference(
	value: unknown,
	expected: RebuildManifestExpectation,
	maximumBytes: number,
	attemptId: string,
	index: number,
): ApplicationObjectReference {
	if (!isRecord(value))
		throw new Error(
			`Projection rebuild ${expected.projection} manifest segment ${index} is invalid.`,
		);
	const store = requiredManifestString(value.store, `segments[${index}].store`);
	const key = requiredManifestString(value.key, `segments[${index}].key`);
	const prefix = `${expected.artifactPrefix}/${expected.generation}/attempts/`;
	const scoped = key.startsWith(prefix) ? key.slice(prefix.length) : "";
	const match =
		/^([A-Za-z0-9][A-Za-z0-9._:-]{0,199})\/segment-([0-9]{8})\.json$/.exec(
			scoped,
		);
	if (!match || match[1] !== attemptId) {
		throw new Error(
			`Projection rebuild ${expected.projection} manifest segment ${index} escapes its generation scope.`,
		);
	}
	const size = manifestInteger(value.size, `segments[${index}].size`);
	if (
		size < 1 ||
		size > maximumBytes ||
		value.contentType !== segmentContentType ||
		typeof value.sha256 !== "string" ||
		!isSha256(value.sha256)
	) {
		throw new Error(
			`Projection rebuild ${expected.projection} manifest segment ${index} has invalid integrity metadata.`,
		);
	}
	const etag =
		value.etag === undefined
			? undefined
			: requiredManifestString(value.etag, `segments[${index}].etag`);
	const version =
		value.version === undefined
			? undefined
			: requiredManifestString(value.version, `segments[${index}].version`);
	return {
		store,
		key,
		size,
		contentType: segmentContentType,
		sha256: value.sha256,
		...(etag ? { etag } : {}),
		...(version ? { version } : {}),
	};
}

async function validateManifestSegments<
	TRow extends object,
	TPayload extends object,
	TValue extends object,
>(
	artifacts: ApplicationObjectStorageRuntime,
	manifest: ProjectionRebuildManifest,
	options: ApplicationOnlineProjectionRebuildOptions<TPayload, TRow, TValue>,
	artifactPrefix: string,
	maxSegments: number,
): Promise<readonly ProjectionSegment<TRow>[]> {
	const segments: ProjectionSegment<TRow>[] = [];
	const ordinals = new Set<number>();
	const partitions = new Map<string, number>();
	let events = 0;
	let rows = 0;
	for (const reference of manifest.segments) {
		const segment = await readSegment<TRow, TPayload, TValue>(
			artifacts,
			reference,
			options,
			artifactPrefix,
			maxSegments,
		);
		if (ordinals.has(segment.ordinal))
			throw new Error(
				`Projection rebuild ${manifest.projection} manifest repeats segment ordinal ${segment.ordinal}.`,
			);
		ordinals.add(segment.ordinal);
		segments.push(segment);
		events += segment.events.length;
		rows += segment.events.reduce(
			(total, event) => total + event.rows.length,
			0,
		);
		for (const event of segment.events)
			partitions.set(
				event.envelope.partitionKey,
				(partitions.get(event.envelope.partitionKey) ?? 0) + 1,
			);
	}
	const normalizedPartitions = Object.fromEntries(
		[...partitions].sort(([left], [right]) => left.localeCompare(right)),
	);
	if (
		events !== manifest.events ||
		rows !== manifest.rows ||
		JSON.stringify(normalizedPartitions) !== JSON.stringify(manifest.partitions)
	) {
		throw new Error(
			`Projection rebuild ${manifest.projection} manifest totals do not match its immutable segments.`,
		);
	}
	return segments;
}

function rebuildResult(
	manifest: ProjectionRebuildManifest,
	reference: ApplicationObjectReference,
	publishedWatermark: number,
): ApplicationOnlineProjectionRebuildResult {
	return {
		projection: manifest.projection,
		stream: manifest.stream,
		generation: manifest.generation,
		previousGeneration: manifest.previousGeneration,
		sourceWatermark: manifest.sourceWatermark,
		publishedWatermark,
		segments: manifest.segments,
		manifest: reference,
		events: manifest.events,
		rows: manifest.rows,
	};
}

function rebuildDefinitionDigest<
	TPayload extends object,
	TRow extends object,
	TValue extends object,
>(
	options: ApplicationOnlineProjectionRebuildOptions<TPayload, TRow, TValue>,
	bounds: {
		readonly sourceKind: ProjectionRebuildManifest["sourceKind"];
		readonly artifactPrefix: string;
		readonly batchSize: number;
		readonly maxSegments: number;
		readonly maxSegmentBytes: number;
		readonly maxEvents: number;
	},
): string {
	return createHash("sha256")
		.update(
			JSON.stringify({
				protocol: manifestProtocol,
				projection: options.projection,
				stream: options.streamName,
				...bounds,
				project: options.project.toString(),
				snapshot: options.snapshot?.definitionDigest,
				snapshotPartition: options.snapshotPartition?.toString(),
			}),
		)
		.digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function isSha256(value: string): boolean {
	return /^[0-9a-f]{64}$/i.test(normalizeDigest(value));
}
function manifestInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0)
		throw new Error(
			`Projection rebuild manifest ${name} must be a non-negative safe integer.`,
		);
	return value as number;
}
function requiredManifestString(value: unknown, name: string): string {
	if (typeof value !== "string" || !value || Buffer.byteLength(value) > 2_048)
		throw new Error(`Projection rebuild manifest ${name} is invalid.`);
	return value;
}

/** Explicitly retires a non-active generation and its immutable evidence. */
export async function retireApplicationOnlineProjectionGeneration<
	TRow extends object,
	TValue extends object,
>(options: {
	readonly projection: string;
	readonly generation: string;
	readonly store: ApplicationValkeyOnlineProjectionStore<TRow, TValue>;
	readonly artifacts: ApplicationObjectStorageRuntime;
	readonly references: readonly ApplicationObjectReference[];
	readonly artifactPrefix?: string;
}): Promise<void> {
	validateGeneration(options.generation);
	const artifactPrefix = safePrefix(
		options.artifactPrefix ?? `projection-rebuilds/${options.projection}`,
	);
	const generationPrefix = `${artifactPrefix}/${options.generation}/`;
	const seen = new Set<string>();
	for (const reference of options.references) {
		const suffix = reference.key.startsWith(generationPrefix)
			? reference.key.slice(generationPrefix.length)
			: "";
		if (
			(!/^attempts\/[A-Za-z0-9][A-Za-z0-9._:-]{0,199}\/segment-[0-9]{8}\.json$/.test(
				suffix,
			) &&
				suffix !== "manifest.json") ||
			seen.has(reference.key)
		) {
			throw new Error(
				`Projection ${options.projection} generation ${options.generation} cannot retire artifact evidence owned by another scope.`,
			);
		}
		seen.add(reference.key);
	}
	await options.store.resetGeneration(options.generation);
	for (const reference of options.references)
		await options.artifacts.delete(
			reference.key,
			reference.version ? { ifVersion: reference.version } : undefined,
		);
}

async function projectEvents<TPayload extends object, TRow extends object>(
	envelopes: readonly ApplicationStreamEnvelope<TPayload>[],
	project: ApplicationOnlineProjectionRebuildOptions<
		TPayload,
		TRow,
		object
	>["project"],
): Promise<readonly ApplicationOnlineProjectionWrite<TRow>[]> {
	return Promise.all(
		envelopes.map(async (envelope) => {
			const value = await project(envelope.payload, {
				id: envelope.id,
				recordedAt: envelope.recordedAt,
				partitionKey: envelope.partitionKey,
			});
			return {
				envelope,
				rows: Array.isArray(value)
					? (value as readonly TRow[])
					: [value as TRow],
			};
		}),
	);
}

async function readSegment<
	TRow extends object,
	TPayload extends object,
	TValue extends object,
>(
	artifacts: ApplicationObjectStorageRuntime,
	reference: ApplicationObjectReference,
	options: Pick<
		ApplicationOnlineProjectionRebuildOptions<TPayload, TRow, TValue>,
		"projection" | "streamName" | "generation"
	>,
	artifactPrefix: string,
	maxSegments: number,
): Promise<ProjectionSegment<TRow>> {
	if (
		reference.contentType !== segmentContentType ||
		!Number.isSafeInteger(reference.size) ||
		reference.size < 1 ||
		!isSha256(reference.sha256)
	) {
		throw new Error(
			`Projection rebuild artifact ${reference.key} has invalid integrity metadata.`,
		);
	}
	const bytes = await artifacts.get(reference.key);
	if (!bytes)
		throw new Error(`Projection rebuild artifact ${reference.key} is missing.`);
	const digest = createHash("sha256").update(bytes).digest("hex");
	if (
		bytes.byteLength !== reference.size ||
		digest !== normalizeDigest(reference.sha256)
	)
		throw new Error(
			`Projection rebuild artifact ${reference.key} failed SHA-256 validation.`,
		);
	let value: unknown;
	try {
		value = JSON.parse(new TextDecoder().decode(bytes));
	} catch (cause) {
		throw new Error(
			`Projection rebuild artifact ${reference.key} is not valid JSON.`,
			{ cause },
		);
	}
	if (
		!isRecord(value) ||
		value.protocol !== segmentProtocol ||
		value.projection !== options.projection ||
		value.stream !== options.streamName ||
		value.generation !== options.generation ||
		!Array.isArray(value.events)
	) {
		throw new Error(
			`Projection rebuild artifact ${reference.key} does not match its declared projection scope.`,
		);
	}
	const ordinal = manifestInteger(value.ordinal, `${reference.key}.ordinal`);
	const attemptId = requiredManifestString(
		value.attemptId,
		`${reference.key}.attemptId`,
	);
	validateGeneration(attemptId);
	const afterSequence = manifestInteger(
		value.afterSequence,
		`${reference.key}.afterSequence`,
	);
	const throughSequence = manifestInteger(
		value.throughSequence,
		`${reference.key}.throughSequence`,
	);
	const expectedKey = `${artifactPrefix}/${options.generation}/attempts/${attemptId}/segment-${String(ordinal).padStart(8, "0")}.json`;
	if (
		ordinal >= maxSegments ||
		reference.key !== expectedKey ||
		throughSequence < afterSequence
	) {
		throw new Error(
			`Projection rebuild artifact ${reference.key} has invalid sequence or ordinal evidence.`,
		);
	}
	for (const [index, event] of value.events.entries()) {
		if (
			!isRecord(event) ||
			!Array.isArray(event.rows) ||
			event.rows.some((row) => !isRecord(row)) ||
			!isRecord(event.envelope)
		) {
			throw new Error(
				`Projection rebuild artifact ${reference.key} event ${index} is invalid.`,
			);
		}
		const sequence = manifestInteger(
			event.envelope.sequence,
			`${reference.key}.events[${index}].sequence`,
		);
		if (
			sequence < afterSequence ||
			sequence > throughSequence ||
			typeof event.envelope.id !== "string" ||
			!event.envelope.id ||
			typeof event.envelope.partitionKey !== "string" ||
			!event.envelope.partitionKey ||
			Buffer.byteLength(event.envelope.partitionKey) > 1_024 ||
			typeof event.envelope.recordedAt !== "string" ||
			!Number.isFinite(Date.parse(event.envelope.recordedAt)) ||
			!isRecord(event.envelope.stream) ||
			typeof event.envelope.stream.name !== "string" ||
			typeof event.envelope.stream.version !== "string" ||
			!isRecord(event.envelope.payload)
		) {
			throw new Error(
				`Projection rebuild artifact ${reference.key} event ${index} has invalid envelope evidence.`,
			);
		}
	}
	return value as unknown as ProjectionSegment<TRow>;
}

async function putOrVerifyArtifact(
	runtime: ApplicationObjectStorageRuntime,
	key: string,
	contentType: string,
	body: Uint8Array,
): Promise<ApplicationObjectReference> {
	const digest = createHash("sha256").update(body).digest("hex");
	const existing = await runtime.head(key);
	if (existing) {
		if (
			normalizeDigest(existing.sha256) !== digest ||
			existing.size !== body.byteLength ||
			existing.contentType !== contentType
		) {
			throw new Error(
				`Projection rebuild artifact ${key} already exists with different content.`,
			);
		}
		return existing;
	}
	const written = await runtime.put({
		key,
		body,
		contentType,
		sha256: digest,
		ifAbsent: true,
	});
	if (
		normalizeDigest(written.sha256) !== digest ||
		written.size !== body.byteLength
	)
		throw new Error(
			`Projection rebuild artifact ${key} was not stored with its declared integrity metadata.`,
		);
	return written;
}

function encodeArtifact(
	value: object,
	maximumBytes: number,
	label: string,
): Uint8Array {
	const bytes = new TextEncoder().encode(JSON.stringify(value));
	if (bytes.byteLength > maximumBytes)
		throw new Error(
			`Projection rebuild ${label} is ${bytes.byteLength} bytes and exceeds the ${maximumBytes}-byte artifact bound.`,
		);
	return bytes;
}

function assertRetention<
	TPayload extends object,
	TRow extends object,
	TValue extends object,
>(
	options: Pick<
		ApplicationOnlineProjectionRebuildOptions<TPayload, TRow, TValue>,
		"projection" | "streamName"
	>,
	checkpoint: number,
	retentionFloor: number,
): void {
	if (retentionFloor > checkpoint)
		throw new ApplicationProjectionRetentionGapError(
			options.projection,
			options.streamName,
			checkpoint,
			retentionFloor,
		);
}

function boundedInteger(
	value: number,
	minimum: number,
	maximum: number,
	name: string,
): number {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
		throw new Error(
			`Projection rebuild ${name} must be between ${minimum} and ${maximum}.`,
		);
	return value;
}

function safePrefix(value: string): string {
	const normalized = value.replace(/^\/+|\/+$/g, "");
	if (!normalized || normalized.includes("..") || normalized.length > 800)
		throw new Error("Projection rebuild artifactPrefix is unsafe.");
	return normalized;
}

function validateGeneration(value: string): void {
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value))
		throw new Error(
			`Projection rebuild generation ${JSON.stringify(value)} is invalid.`,
		);
}

function normalizeDigest(value: string): string {
	return value.replace(/^sha256:/, "").toLowerCase();
}

function streamIdentity(value: string): {
	readonly name: string;
	readonly version: string;
} {
	const separator = value.lastIndexOf(".");
	return separator > 0 && /^v[1-9][0-9]*$/.test(value.slice(separator + 1))
		? { name: value.slice(0, separator), version: value.slice(separator + 1) }
		: { name: value, version: "v1" };
}

function requiredPartition(
	value: string | undefined,
	projection: string,
): string {
	if (!value?.trim() || Buffer.byteLength(value) > 1_024)
		throw new Error(
			`Projection rebuild ${projection} snapshot partition is empty or exceeds 1024 bytes.`,
		);
	return value;
}
