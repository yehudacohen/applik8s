// typecast-file-boundary: Rebuild tests use intentionally malformed serialized artifacts and controlled generic fakes to verify fail-closed validation.
import { createHash } from "node:crypto";
import { describe, expect, test, vi } from "vitest";
import type {
	ApplicationObjectMetadata,
	ApplicationObjectReference,
	ApplicationObjectStorageRuntime,
} from "../src/application-object-storage.js";
import {
	retireApplicationOnlineProjectionGeneration,
	runApplicationOnlineProjectionRebuild,
} from "../src/projection-rebuild-runtime.js";
import type {
	ApplicationReplayableStream,
	ApplicationStreamEnvelope,
} from "../src/projection-runtime-clickhouse.js";
import type {
	ApplicationOnlineProjectionWrite,
	ApplicationValkeyOnlineProjectionWriter,
} from "../src/projection-runtime-valkey.js";
import type { ApplicationProjectionSnapshotSource } from "../src/projection-snapshot-postgres-runtime.js";

interface Payload {
	readonly id: string;
	readonly partition: string;
	readonly score: number;
	readonly removed?: boolean;
}
interface Row extends Payload {}

describe("online projection rebuild runtime", () => {
	test("writes immutable evidence, catches a moving watermark, publishes atomically, and retires explicitly", async () => {
		const events = [envelope(1), envelope(2)];
		const source = replaySource(events);
		const projection = analyticalDatabase(events, source);
		const objects = memoryObjects();

		const result = await runApplicationOnlineProjectionRebuild({
			projection: "home-timeline",
			streamName: "PostTimelineChanged.v1",
			generation: "rebuild-20260720",
			source,
			store: projection.store,
			artifacts: objects.runtime,
			project: (payload) => payload,
			batchSize: 2,
			maxSegments: 4,
			maxCatchUpRounds: 4,
			attemptId: "attempt-main",
		});

		expect(result).toMatchObject({
			generation: "rebuild-20260720",
			previousGeneration: "live",
			sourceWatermark: 2,
			publishedWatermark: 3,
			events: 2,
			rows: 2,
		});
		expect(projection.writes.map((write) => write.envelope.sequence)).toEqual([
			1, 2, 3,
		]);
		expect(projection.active()).toBe("rebuild-20260720");
		expect(result.segments).toHaveLength(1);
		expect(objects.values.has(result.manifest.key)).toBe(true);

		const writesAfterPublication = projection.writes.length;
		const repeated = await runApplicationOnlineProjectionRebuild({
			projection: "home-timeline",
			streamName: "PostTimelineChanged.v1",
			generation: "rebuild-20260720",
			source,
			store: projection.store,
			artifacts: objects.runtime,
			project: (payload) => payload,
			batchSize: 2,
			maxSegments: 4,
			maxCatchUpRounds: 4,
			attemptId: "attempt-repeat",
		});
		expect(repeated).toEqual(result);
		expect(projection.writes).toHaveLength(writesAfterPublication);
		await expect(
			runApplicationOnlineProjectionRebuild({
				projection: "home-timeline",
				streamName: "PostTimelineChanged.v1",
				generation: "rebuild-20260720",
				source,
				store: projection.store,
				artifacts: objects.runtime,
				project: (payload) => ({ ...payload, score: payload.score + 1 }),
				batchSize: 2,
				maxSegments: 4,
				maxCatchUpRounds: 4,
				attemptId: "attempt-definition-mismatch",
			}),
		).rejects.toThrow(/different projection definition/);

		await expect(
			retireApplicationOnlineProjectionGeneration({
				projection: "home-timeline",
				generation: "live",
				store: projection.store,
				artifacts: objects.runtime,
				references: [...result.segments, result.manifest],
			}),
		).rejects.toThrow(/another scope/);
		const oldEvidence = objects.seed(
			"projection-rebuilds/home-timeline/live/manifest.json",
			"old-generation-evidence",
		);
		await retireApplicationOnlineProjectionGeneration({
			projection: "home-timeline",
			generation: "live",
			store: projection.store,
			artifacts: objects.runtime,
			references: [oldEvidence],
		});
		expect(projection.retired).toEqual(["live"]);
		expect(objects.values.has(oldEvidence.key)).toBe(false);
		expect(objects.values.has(result.manifest.key)).toBe(true);
	});

	test("fails closed when retry evidence exists with different content or replay has a retention gap", async () => {
		const events = [envelope(1)];
		const source = replaySource(events);
		const projection = analyticalDatabase(events, source);
		const objects = memoryObjects();
		objects.seed(
			"projection-rebuilds/home-timeline/rebuild-1/attempts/attempt-conflict/segment-00000000.json",
			"different",
		);
		await expect(
			runApplicationOnlineProjectionRebuild({
				projection: "home-timeline",
				streamName: "PostTimelineChanged.v1",
				generation: "rebuild-1",
				source,
				store: projection.store,
				artifacts: objects.runtime,
				project: (payload) => payload,
				attemptId: "attempt-conflict",
			}),
		).rejects.toThrow(/already exists with different content/);

		const retainedSource: ApplicationReplayableStream<Payload> = {
			read: async () => ({
				items: [],
				nextSequence: 0,
				exhausted: true,
				retentionFloor: 9,
			}),
		};
		const retainedProjection = analyticalDatabase([], retainedSource);
		await expect(
			runApplicationOnlineProjectionRebuild({
				projection: "home-timeline",
				streamName: "PostTimelineChanged.v1",
				generation: "rebuild-gap",
				source: retainedSource,
				store: retainedProjection.store,
				artifacts: memoryObjects().runtime,
				project: (payload) => payload,
				attemptId: "attempt-gap",
			}),
		).rejects.toThrow(/behind retained stream/);
	});

	test("reconstructs from an authoritative snapshot after old stream history has expired, then catches up", async () => {
		const events = [envelope(1), envelope(2)];
		const source: ApplicationReplayableStream<Payload> = {
			async read(afterSequence, limit) {
				const items = events
					.filter((event) => event.sequence > afterSequence)
					.slice(0, limit);
				return {
					items,
					nextSequence: items.at(-1)?.sequence ?? afterSequence,
					exhausted:
						events.filter((event) => event.sequence > afterSequence).length <=
						limit,
					retentionFloor: 2,
				};
			},
		};
		const snapshot: ApplicationProjectionSnapshotSource<Payload> = {
			definitionDigest: "snapshot-posts-v1",
			async scan({ visit }) {
				await visit({
					ordinal: 0,
					watermark: 2,
					recordedAt: "2026-07-20T00:00:02.000Z",
					items: [
						{
							id: "post-current-1:0",
							payload: {
								id: "post-current-1",
								partition: "author-1",
								score: 10,
							},
						},
						{
							id: "post-current-2:0",
							payload: {
								id: "post-current-2",
								partition: "author-2",
								score: 20,
							},
						},
					],
				});
				return {
					watermark: 2,
					recordedAt: "2026-07-20T00:00:02.000Z",
					items: 2,
					pages: 1,
				};
			},
			async close() {},
		};
		const projection = analyticalDatabase(events, source);
		const objects = memoryObjects();
		const result = await runApplicationOnlineProjectionRebuild({
			projection: "home-timeline",
			streamName: "PostTimelineChanged.v1",
			generation: "snapshot-1",
			source,
			snapshot,
			snapshotPartition: (payload) => payload.partition,
			store: projection.store,
			artifacts: objects.runtime,
			project: (payload) => payload,
			batchSize: 2,
			maxCatchUpRounds: 4,
			attemptId: "attempt-snapshot",
		});

		expect(result).toMatchObject({
			sourceWatermark: 2,
			publishedWatermark: 3,
			events: 2,
			rows: 2,
		});
		const manifest = JSON.parse(
			new TextDecoder().decode(await objects.runtime.get(result.manifest.key)),
		) as { sourceKind: string; sourceWatermark: number };
		expect(manifest).toMatchObject({
			sourceKind: "model-snapshot",
			sourceWatermark: 2,
		});
		expect(
			projection.writes.map((write) => ({
				sequence: write.envelope.sequence,
				rows: write.rows.length,
			})),
		).toEqual([
			{ sequence: 2, rows: 1 },
			{ sequence: 2, rows: 1 },
			{ sequence: 2, rows: 0 },
			{ sequence: 3, rows: 1 },
		]);
	});

	test("resumes from a validated immutable manifest after interruption without rescanning authority", async () => {
		const events = [envelope(1), envelope(2)];
		const source = replaySource(events);
		const projection = analyticalDatabase(events, source);
		const objects = memoryObjects();
		let scans = 0;
		const snapshot: ApplicationProjectionSnapshotSource<Payload> = {
			definitionDigest: "authoritative-post-snapshot-v1",
			async scan({ visit }) {
				scans += 1;
				await visit({
					ordinal: 0,
					watermark: 2,
					recordedAt: "2026-07-20T00:00:02.000Z",
					items: [
						{
							id: "post-current-1:0",
							payload: {
								id: "post-current-1",
								partition: "author-1",
								score: 10,
							},
						},
					],
				});
				return {
					watermark: 2,
					recordedAt: "2026-07-20T00:00:02.000Z",
					items: 1,
					pages: 1,
				};
			},
			async close() {},
		};
		const rebuild = (maxCatchUpRounds: number) =>
			runApplicationOnlineProjectionRebuild({
				projection: "home-timeline",
				streamName: "PostTimelineChanged.v1",
				generation: "resumable-1",
				source,
				snapshot,
				snapshotPartition: (payload) => payload.partition,
				store: projection.store,
				artifacts: objects.runtime,
				project: (payload) => payload,
				batchSize: 2,
				maxSegments: 4,
				maxCatchUpRounds,
				attemptId: `attempt-resume-${maxCatchUpRounds}`,
			});

		await expect(rebuild(1)).rejects.toThrow(/could not catch generation/);
		expect(scans).toBe(1);
		const resumed = await rebuild(4);
		expect(resumed).toMatchObject({
			generation: "resumable-1",
			sourceWatermark: 2,
			publishedWatermark: 3,
		});
		expect(scans).toBe(1);

		objects.corrupt(resumed.segments[0]?.key ?? "", "corrupted");
		await expect(rebuild(4)).rejects.toThrow(/SHA-256 validation/);
	});

	test("resets a crashed partial generation before rescanning authority and rejects overlapping workers", async () => {
		const events: ApplicationStreamEnvelope<Payload>[] = [];
		const source = replaySource(events);
		const projection = analyticalDatabase(events, source, {
			failAfterFirstWrite: true,
			raceOnFirstPublish: false,
		});
		const objects = memoryObjects();
		let snapshotRows: Payload[] = [
			{ id: "deleted-before-retry", partition: "author-1", score: 1 },
		];
		let releaseScan: (() => void) | undefined;
		const scanStarted = new Promise<void>((resolve) => {
			releaseScan = resolve;
		});
		let blockScan = false;
		const snapshot: ApplicationProjectionSnapshotSource<Payload> = {
			definitionDigest: "crash-recovery-snapshot-v1",
			async scan({ visit }) {
				if (blockScan) await scanStarted;
				await visit({
					ordinal: 0,
					watermark: 0,
					recordedAt: "2026-07-20T00:00:00.000Z",
					items: snapshotRows.map((payload) => ({ id: payload.id, payload })),
				});
				return {
					watermark: 0,
					recordedAt: "2026-07-20T00:00:00.000Z",
					items: snapshotRows.length,
					pages: 1,
				};
			},
			async close() {},
		};
		const rebuild = (attemptId: string) =>
			runApplicationOnlineProjectionRebuild({
				projection: "home-timeline",
				streamName: "PostTimelineChanged.v1",
				generation: "crash-safe-1",
				source,
				snapshot,
				snapshotPartition: (payload) => payload.partition,
				store: projection.store,
				artifacts: objects.runtime,
				project: (payload) => payload,
				attemptId,
				attemptLeaseMs: 30_000,
				maxCatchUpRounds: 2,
			});

		await expect(rebuild("attempt-crashed")).rejects.toThrow(
			/injected rebuild crash/,
		);
		expect(projection.rowIds()).toEqual(["deleted-before-retry"]);
		snapshotRows = [{ id: "survives-retry", partition: "author-1", score: 2 }];
		await expect(rebuild("attempt-retry")).resolves.toMatchObject({
			generation: "crash-safe-1",
		});
		expect(projection.rowIds()).toEqual(["survives-retry"]);

		const overlappingProjection = analyticalDatabase([], replaySource([]), {
			raceOnFirstPublish: false,
		});
		blockScan = true;
		let entered!: () => void;
		const enteredScan = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const blockedSnapshot: ApplicationProjectionSnapshotSource<Payload> = {
			...snapshot,
			async scan({ visit }) {
				entered();
				await scanStarted;
				await visit({
					ordinal: 0,
					watermark: 0,
					recordedAt: "2026-07-20T00:00:00.000Z",
					items: [],
				});
				return {
					watermark: 0,
					recordedAt: "2026-07-20T00:00:00.000Z",
					items: 0,
					pages: 1,
				};
			},
		};
		const overlapping = (attemptId: string) =>
			runApplicationOnlineProjectionRebuild({
				projection: "overlap",
				streamName: "PostTimelineChanged.v1",
				generation: "overlap-1",
				source: replaySource([]),
				snapshot: blockedSnapshot,
				snapshotPartition: (payload) => payload.partition,
				store: overlappingProjection.store,
				artifacts: memoryObjects().runtime,
				project: (payload) => payload,
				attemptId,
				attemptLeaseMs: 30_000,
			});
		const first = overlapping("attempt-one");
		await enteredScan;
		await expect(overlapping("attempt-two")).rejects.toThrow(
			/another rebuild attempt/,
		);
		releaseScan?.();
		await expect(first).resolves.toMatchObject({ generation: "overlap-1" });
	});

	test("renews the exclusive attempt throughout a snapshot scan longer than its lease", async () => {
		vi.useFakeTimers();
		try {
			const projection = analyticalDatabase([], replaySource([]), {
				raceOnFirstPublish: false,
			});
			let releaseScan!: () => void;
			const blocked = new Promise<void>((resolve) => {
				releaseScan = resolve;
			});
			let entered!: () => void;
			const scanEntered = new Promise<void>((resolve) => {
				entered = resolve;
			});
			const snapshot: ApplicationProjectionSnapshotSource<Payload> = {
				definitionDigest: "slow-authority-snapshot-v1",
				async scan({ visit }) {
					entered();
					await blocked;
					await visit({
						ordinal: 0,
						watermark: 0,
						recordedAt: "2026-07-20T00:00:00.000Z",
						items: [],
					});
					return {
						watermark: 0,
						recordedAt: "2026-07-20T00:00:00.000Z",
						items: 0,
						pages: 1,
					};
				},
				async close() {},
			};
			const rebuild = runApplicationOnlineProjectionRebuild({
				projection: "slow-snapshot",
				streamName: "PostTimelineChanged.v1",
				generation: "slow-1",
				source: replaySource([]),
				snapshot,
				snapshotPartition: (payload) => payload.partition,
				store: projection.store,
				artifacts: memoryObjects().runtime,
				project: (payload) => payload,
				attemptId: "attempt-slow",
				attemptLeaseMs: 30_000,
			});
			await scanEntered;
			for (let interval = 0; interval < 7; interval += 1) {
				vi.advanceTimersByTime(10_000);
				// The heartbeat schedules its next timer after the asynchronous renewal
				// settles. Flush that continuation between clock advances so this test
				// exercises every lease interval in Vitest and Bun's compatible runner.
				await Promise.resolve();
				await Promise.resolve();
			}
			expect(projection.renewals()).toBeGreaterThanOrEqual(6);
			releaseScan();
			await expect(rebuild).resolves.toMatchObject({ generation: "slow-1" });
		} finally {
			vi.useRealTimers();
		}
	});
});

function envelope(sequence: number): ApplicationStreamEnvelope<Payload> {
	return {
		id: `event-${sequence}`,
		stream: { name: "PostTimelineChanged", version: "v1" },
		sequence,
		partitionKey: `author-${sequence}`,
		recordedAt: `2026-07-20T00:00:0${sequence}.000Z`,
		payload: {
			id: `post-${sequence}`,
			partition: `author-${sequence}`,
			score: sequence,
		},
	};
}

function replaySource(
	events: ApplicationStreamEnvelope<Payload>[],
): ApplicationReplayableStream<Payload> {
	return {
		async read(afterSequence, limit) {
			const items = events
				.filter((event) => event.sequence > afterSequence)
				.slice(0, limit);
			return {
				items,
				nextSequence: items.at(-1)?.sequence ?? afterSequence,
				exhausted:
					events.filter((event) => event.sequence > afterSequence).length <=
					limit,
				retentionFloor: 0,
			};
		},
	};
}

function analyticalDatabase(
	events: ApplicationStreamEnvelope<Payload>[],
	source: ApplicationReplayableStream<Payload>,
	options: {
		readonly failAfterFirstWrite?: boolean;
		readonly raceOnFirstPublish?: boolean;
	} = {},
) {
	let active = "live";
	let watermark = events.at(-1)?.sequence ?? 0;
	let rebuilding: string | undefined;
	let attempt: string | undefined;
	let firstPublish = true;
	const highwaters = new Map<string, number>([["live", watermark]]);
	const writes: ApplicationOnlineProjectionWrite<Row>[] = [];
	const generationRows = new Map<string, Map<string, Row>>();
	let failAfterFirstWrite = options.failAfterFirstWrite ?? false;
	const retired: string[] = [];
	let renewals = 0;
	const store: ApplicationValkeyOnlineProjectionWriter<Row, Row> = {
		async prepare() {},
		async checkpoint(projection, stream) {
			return { projection, stream, sequence: watermark };
		},
		async write() {},
		async advance(checkpoint) {
			watermark = Math.max(watermark, checkpoint.sequence);
		},
		async reset() {},
		async page() {
			return {
				items: [],
				projection: {
					generation: active,
					eventWatermark: String(watermark),
					rebuilding: Boolean(rebuilding),
					degraded: false,
				},
			};
		},
		async activeGeneration() {
			return active;
		},
		async rebuildState() {
			return {
				activeGeneration: active,
				eventWatermark: watermark,
				...(rebuilding ? { rebuildingGeneration: rebuilding } : {}),
			};
		},
		async beginGeneration(generation, attemptId) {
			if (attempt && attempt !== attemptId)
				throw new Error("another rebuild attempt in progress");
			rebuilding = generation;
			attempt = attemptId;
		},
		async renewGenerationAttempt(generation, attemptId) {
			if (rebuilding !== generation || attempt !== attemptId)
				throw new Error("wrong rebuild attempt");
			renewals += 1;
		},
		async writeGeneration(generation, attemptId, batch) {
			if (rebuilding !== generation || attempt !== attemptId)
				throw new Error("wrong rebuild generation");
			writes.push(...batch);
			const rows = generationRows.get(generation) ?? new Map<string, Row>();
			for (const item of batch)
				for (const row of item.rows) {
					if (row.removed) rows.delete(row.id);
					else rows.set(row.id, row);
				}
			generationRows.set(generation, rows);
			for (const item of batch)
				highwaters.set(
					generation,
					Math.max(highwaters.get(generation) ?? 0, item.envelope.sequence),
				);
			if (failAfterFirstWrite) {
				failAfterFirstWrite = false;
				throw new Error(
					"injected rebuild crash after partial generation write",
				);
			}
		},
		async generationHighwater(generation) {
			return highwaters.get(generation) ?? 0;
		},
		async publishGeneration(generation, expected, attemptId) {
			if (firstPublish && options.raceOnFirstPublish !== false) {
				firstPublish = false;
				const third = envelope(
					Math.max(watermark, ...events.map((event) => event.sequence)) + 1,
				);
				events.push(third);
				watermark = third.sequence;
				// Ensure the mutable replay authority observed above is the source the
				// runtime will query in its bounded catch-up round.
				await source.read(third.sequence - 1, 1);
				return false;
			}
			if (
				active !== expected ||
				rebuilding !== generation ||
				attempt !== attemptId ||
				(highwaters.get(generation) ?? 0) < watermark
			)
				return false;
			watermark = Math.max(watermark, highwaters.get(generation) ?? 0);
			active = generation;
			rebuilding = undefined;
			attempt = undefined;
			return true;
		},
		async resetGeneration(generation, attemptId) {
			if (generation === active)
				throw new Error("cannot reset active generation");
			if (attemptId && (rebuilding !== generation || attempt !== attemptId))
				throw new Error("wrong rebuild attempt");
			if (!attemptId) retired.push(generation);
			writes.length = 0;
			highwaters.delete(generation);
			generationRows.delete(generation);
			if (attemptId) highwaters.set(generation, 0);
		},
		async abandonGeneration(generation, attemptId) {
			if (rebuilding === generation && attempt === attemptId) {
				rebuilding = undefined;
				attempt = undefined;
			}
		},
	};
	return {
		store,
		writes,
		retired,
		active: () => active,
		renewals: () => renewals,
		rowIds: () =>
			[
				...new Set(
					[...generationRows.values()].flatMap((rows) => [...rows.keys()]),
				),
			].sort(),
	};
}

function memoryObjects() {
	const values = new Map<
		string,
		{ readonly body: Uint8Array; readonly metadata: ApplicationObjectMetadata }
	>();
	const runtime: ApplicationObjectStorageRuntime = {
		async put(request) {
			if (request.ifAbsent && values.has(request.key))
				throw new Error("already exists");
			const body =
				typeof request.body === "string"
					? new TextEncoder().encode(request.body)
					: request.body;
			const sha256 = createHash("sha256").update(body).digest("hex");
			const metadata: ApplicationObjectMetadata = {
				store: "rebuilds",
				key: request.key,
				size: body.byteLength,
				contentType: request.contentType,
				sha256,
			};
			values.set(request.key, { body, metadata });
			return metadata;
		},
		async get(key) {
			return values.get(key)?.body;
		},
		async head(key) {
			return values.get(key)?.metadata;
		},
		async delete(key) {
			values.delete(key);
		},
		async signUpload() {
			throw new Error("not supported");
		},
		async signDownload() {
			throw new Error("not supported");
		},
	};
	return {
		runtime,
		values,
		seed(key: string, bodyValue: string): ApplicationObjectReference {
			const body = new TextEncoder().encode(bodyValue);
			const metadata = {
				store: "rebuilds",
				key,
				size: body.byteLength,
				contentType: "application/vnd.applik8s.projection-segment+json",
				sha256: createHash("sha256").update(body).digest("hex"),
			};
			values.set(key, { body, metadata });
			return metadata;
		},
		corrupt(key: string, bodyValue: string): void {
			const current = values.get(key);
			if (!current) throw new Error(`missing object ${key}`);
			values.set(key, {
				body: new TextEncoder().encode(bodyValue),
				metadata: current.metadata,
			});
		},
	};
}
