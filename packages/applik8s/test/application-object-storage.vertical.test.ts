// typecast-file-boundary: Negative public-API fixtures deliberately erase callable overload types to exercise runtime validation failures.
import {
	app,
	applicationGraphFor,
	installApplicationObjectStorageRuntimeResolver,
	ObjectStorage,
	setApplicationObjectStorageRuntimeFactory,
} from "@applik8s/applik8s";
import { createApplicationObjectStoreRuntimeHandle } from "@applik8s/applik8s/workflow-runtime-resolvers";
import { afterEach, describe, expect, it } from "vitest";
import { applicationCallableProviderDependencies } from "../src/application-provider-dependencies.js";

describe("provider-neutral application object stores", () => {
	afterEach(() => setApplicationObjectStorageRuntimeFactory(undefined));

	it("derives database backup coordinates from one typed object-storage binding", () => {
		const application = app("backup-binding");
		const media = application.provide(
			ObjectStorage,
			ObjectStorage.s3({
				bucket: "application-media",
				prefix: "site",
				region: "us-east-1",
				endpoint: "https://objects.example.test",
				ownership: "external",
				credentialsSecret: {
					apiVersion: "v1",
					kind: "Secret",
					name: "application-media",
					namespace: "application",
				},
				accessKeyIdKey: "ACCESS_KEY",
				secretAccessKeyKey: "SECRET_KEY",
			}),
		);

		expect(
			ObjectStorage.backup(media, { prefix: "/database-backups/" }),
		).toEqual({
			kind: "s3",
			destinationPath: "s3://application-media/database-backups",
			endpoint: "https://objects.example.test",
			credentialsSecret: {
				apiVersion: "v1",
				kind: "Secret",
				name: "application-media",
				namespace: "application",
			},
			accessKeyIdKey: "ACCESS_KEY",
			secretAccessKeyKey: "SECRET_KEY",
		});
	});

	it("prefers an execution-scoped runtime for direct store handles", async () => {
		const application = app("scoped-objects");
		application.provide(ObjectStorage, ObjectStorage.configMap());
		const records = application.objectStore("records", {
			mode: "immutable",
			maxObjectBytes: 1_000,
			contentTypes: ["application/json"],
		});
		const uninstall = installApplicationObjectStorageRuntimeResolver((binding) =>
			binding.name === "records"
				? {
					async put() { throw new Error("unused"); },
					async get() { return new Uint8Array([4, 2]); },
					async head() { return undefined; },
					async delete() {},
					async signUpload() { throw new Error("unused"); },
					async signDownload() { throw new Error("unused"); },
				}
				: undefined,
		);
		try {
			await expect(records.get("proof.json")).resolves.toEqual(new Uint8Array([4, 2]));
		} finally {
			uninstall();
		}
	});

	it("exposes direct store handles as compiler-hydrated ObjectStorage dependencies", () => {
		const application = app("compiled-objects");
		application.provide(
			ObjectStorage,
			ObjectStorage.s3({
				bucket: "compiled-objects",
				region: "us-east-1",
				ownership: "external",
			}),
		);
		const artifacts = application.objectStore("artifacts", {
			mode: "immutable",
			maxObjectBytes: 1_000,
			contentTypes: ["text/plain"],
		});

		expect(
			applicationCallableProviderDependencies({ ArtifactObjects: artifacts }),
		).toEqual([{
			identifier: "ArtifactObjects",
			provider: {
				interface: "ObjectStorage",
				nodeId: "provider.object-storage",
			},
			placement: "objectStore",
			objectStore: { nodeId: "objectStore.artifacts" },
		}]);
	});

	it("projects exact task methods and validates task-local credentials", () => {
		const application = app("scoped-task-objects");
		application.provide(ObjectStorage, ObjectStorage.s3({
			bucket: "scoped-task-objects",
			region: "us-east-1",
			ownership: "external",
		}));
		const retained = application.objectStore("evidence", {
			mode: "immutable",
			maxObjectBytes: 1_000,
			contentTypes: ["application/json"],
			deletion: "retained",
		});

		const reader = retained.allow("get", "head").usingCredentials({
			apiVersion: "v1",
			kind: "Secret",
			name: "evidence-reader",
			namespace: "workers",
		});
		expect(reader).toMatchObject({
			kind: "applicationTaskObjectStore",
			operations: ["get", "head"],
			credentialsSecret: { name: "evidence-reader" },
		});
		expect(() => (retained.allow as (...operations: never[]) => unknown)()).toThrow("at least one operation");
		expect(() => retained.allow("get", "get")).toThrow("must not repeat");
		expect(() => retained.allow("delete")).toThrow("retains objects");
	});

	it("rehydrates a bounded handler-safe store handle from the graph contract", async () => {
		const requests: unknown[] = [];
		const uninstall = installApplicationObjectStorageRuntimeResolver((identity) =>
			identity.name === "artifacts"
				? {
					async put(request) {
						requests.push(request);
						return {
							store: identity.name,
							key: request.key,
							size: 5,
							contentType: request.contentType,
							sha256: "sha256:test",
						};
					},
					async get() { return new Uint8Array(); },
					async head() { return undefined; },
					async delete() {},
					async signUpload() { throw new Error("unused"); },
					async signDownload() { throw new Error("unused"); },
				}
				: undefined,
		);
		try {
			const handle = createApplicationObjectStoreRuntimeHandle({
				name: "artifacts",
				objectMode: "immutable",
				maxObjectBytes: 16,
				contentTypes: ["text/plain"],
				browserAccess: {
					upload: "none",
					download: "none",
					downloadAccess: "owner",
					ttlSeconds: 300,
				},
				deletion: "explicit",
			});
			await expect(handle.put({
				key: "documents/one.txt",
				body: "hello",
				contentType: "text/plain",
			})).resolves.toMatchObject({ store: "artifacts" });
			expect(requests).toEqual([expect.objectContaining({
				key: "documents/one.txt",
				ifAbsent: true,
			})]);
			await expect(handle.put({
				key: "../escape",
				body: "hello",
				contentType: "text/plain",
			})).rejects.toThrow("unsafe object key");
			const retained = createApplicationObjectStoreRuntimeHandle({
				name: "artifacts",
				objectMode: "immutable",
				maxObjectBytes: 16,
				contentTypes: ["text/plain"],
				browserAccess: {
					upload: "none",
					download: "none",
					downloadAccess: "owner",
					ttlSeconds: 300,
				},
				deletion: "retained",
			});
			await expect(retained.delete("documents/one.txt")).rejects.toThrow(
				"retains objects",
			);
		} finally {
			uninstall();
		}
	});

	it("records a bounded S3-compatible logical store and hydrates runtime I/O without exposing credentials", async () => {
		const chirp = app("chirp-objects");
		chirp.provide(
			ObjectStorage,
			ObjectStorage.s3({
				bucket: "chirp-media",
				region: "us-east-1",
				endpoint: "https://objects.example.test",
				ownership: "external",
				credentialsSecret: {
					apiVersion: "v1",
					kind: "Secret",
					name: "chirp-s3",
				},
			}),
		);
		const media = chirp.objectStore("media", {
			enabled: false,
			mode: "immutable",
			maxObjectBytes: 5_000_000,
			contentTypes: ["image/png", "image/jpeg"],
			browser: { upload: "signed", download: "signed", ttlSeconds: 120 },
		});
		let observedIfAbsent = false;
		setApplicationObjectStorageRuntimeFactory((binding) => ({
			async put(request) {
				observedIfAbsent = request.ifAbsent === true;
				return {
					store: binding.name,
					key: request.key,
					size: 3,
					contentType: request.contentType,
					sha256: "sha256:test",
				};
			},
			async get() {
				return new Uint8Array([1, 2, 3]);
			},
			async head() {
				return undefined;
			},
			async delete() {},
			async signUpload(request) {
				return {
					method: "PUT",
					url: "https://upload.example.test",
					expiresAt: "2030-01-01T00:00:00.000Z",
					headers: {
						"content-type": request.contentType,
						"x-amz-meta-applik8s-sha256": request.sha256,
					},
					object: { store: binding.name, key: request.key },
				};
			},
			async signDownload(request) {
				return {
					method: "GET",
					url: "https://download.example.test",
					expiresAt: "2030-01-01T00:00:00.000Z",
					headers: {},
					object: { store: binding.name, key: request.key },
				};
			},
		}));

		await expect(
			media.put({
				key: "users/u1/avatar.png",
				body: new Uint8Array([1, 2, 3]),
				contentType: "image/png",
			}),
		).resolves.toMatchObject({ store: "media", key: "users/u1/avatar.png" });
		expect(observedIfAbsent).toBe(true);
		await expect(
			media.signUpload({
				key: "users/u1/next.png",
				contentType: "image/png",
				size: 3,
				sha256: "a".repeat(64),
			}),
		).resolves.toMatchObject({
			method: "PUT",
			headers: { "x-amz-meta-applik8s-sha256": "a".repeat(64) },
		});
		await expect(
			media.signUpload({
				key: "users/u1/next.png",
				contentType: "image/png",
				size: 3,
				sha256: "not-a-digest",
			}),
		).rejects.toThrow("requires a SHA-256 checksum");
		expect(
			applicationGraphFor(chirp.composition)?.nodes.find(
				(node) => node.kind === "objectStore",
			),
		).toMatchObject({
			name: "media",
			enabled: false,
			objectMode: "immutable",
			maxObjectBytes: 5_000_000,
			browserAccess: {
				upload: "signed",
				download: "signed",
				downloadAccess: "owner",
				ttlSeconds: 120,
			},
			credentials: "server-only",
		});
	});

	it("fails closed when the bounded ConfigMap provider cannot satisfy media semantics", () => {
		const appWithDefaults = app("bounded-objects");
		expect(() =>
			appWithDefaults.objectStore("media", {
				maxObjectBytes: 5_000_000,
				contentTypes: ["image/png"],
				browser: { upload: "signed" },
			}),
		).toThrow(/ConfigMap provider/);
	});
});
