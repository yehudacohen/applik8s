import {
	app,
	applicationGraphFor,
	ObjectStorage,
	setApplicationObjectStorageRuntimeFactory,
} from "@applik8s/applik8s";
import { afterEach, describe, expect, it } from "vitest";

describe("provider-neutral application object stores", () => {
	afterEach(() => setApplicationObjectStorageRuntimeFactory(undefined));

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
