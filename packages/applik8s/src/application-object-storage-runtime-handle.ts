import type { ApplicationObjectStoreNode } from "@applik8s/core";
import type {
	ApplicationObjectMetadata,
	ApplicationObjectPutRequest,
	ApplicationObjectReference,
	ApplicationSignedObjectIntent,
} from "./application-object-storage-runtime-contract.js";
import {
	applicationObjectStorageRuntime,
	type ApplicationObjectStorageRuntimeIdentity,
} from "./application-object-storage-runtime-resolver.js";

export type ApplicationObjectStoreRuntimeContract = Pick<
	ApplicationObjectStoreNode,
	"name" | "objectMode" | "maxObjectBytes" | "contentTypes" | "browserAccess" | "deletion"
>;

export interface ApplicationObjectStoreRuntimeHandle {
	put(request: ApplicationObjectPutRequest): Promise<ApplicationObjectReference>;
	get(key: string): Promise<Uint8Array | undefined>;
	head(key: string): Promise<ApplicationObjectMetadata | undefined>;
	delete(key: string, options?: { readonly ifVersion?: string }): Promise<void>;
	signUpload(request: {
		readonly key: string;
		readonly contentType: string;
		readonly size: number;
		readonly sha256: string;
	}): Promise<ApplicationSignedObjectIntent>;
	signDownload(request: { readonly key: string }): Promise<ApplicationSignedObjectIntent>;
}

/**
 * Rehydrates the bounded authored object-store surface inside generated
 * workers without importing application authoring or deployment providers.
 */
export function createApplicationObjectStoreRuntimeHandle(
	contract: ApplicationObjectStoreRuntimeContract,
): ApplicationObjectStoreRuntimeHandle {
	const identity: ApplicationObjectStorageRuntimeIdentity = Object.freeze({
		kind: "applicationObjectStore",
		name: contract.name,
	});
	const runtime = () => applicationObjectStorageRuntime(identity);
	const assertKey = (key: string) => {
		if (!key || key.startsWith("/") || key.includes("..") || key.length > 1_024) {
			throw new Error(`Application object store ${contract.name} received an unsafe object key.`);
		}
	};
	const assertContentType = (contentType: string) => {
		const normalized = contentType.trim().toLowerCase();
		if (!contract.contentTypes.includes(normalized)) {
			throw new Error(`Application object store ${contract.name} does not allow ${contentType}.`);
		}
		return normalized;
	};
	const handle: ApplicationObjectStoreRuntimeHandle = {
		async put(request) {
			assertKey(request.key);
			const contentType = assertContentType(request.contentType);
			const size = typeof request.body === "string"
				? new TextEncoder().encode(request.body).byteLength
				: request.body.byteLength;
			if (size > contract.maxObjectBytes) {
				throw new Error(`Application object store ${contract.name} object ${request.key} exceeds the ${contract.maxObjectBytes}-byte limit.`);
			}
			return runtime().put({
				...request,
				contentType,
				...(contract.objectMode === "immutable" ? { ifAbsent: true } : {}),
			});
		},
		async get(key) {
			assertKey(key);
			return runtime().get(key);
		},
		async head(key) {
			assertKey(key);
			return runtime().head(key);
		},
		async delete(key, options) {
			assertKey(key);
			return runtime().delete(key, options);
		},
		async signUpload(request) {
			assertKey(request.key);
			const contentType = assertContentType(request.contentType);
			if (contract.browserAccess.upload !== "signed") {
				throw new Error(`Application object store ${contract.name} does not allow signed browser uploads.`);
			}
			if (!Number.isSafeInteger(request.size) || request.size < 1 || request.size > contract.maxObjectBytes) {
				throw new Error(`Application object store ${contract.name} upload size must be between 1 and ${contract.maxObjectBytes} bytes.`);
			}
			return runtime().signUpload({
				...request,
				contentType,
				sha256: normalizeSha256(request.sha256, `Application object store ${contract.name} upload`),
				ttlSeconds: contract.browserAccess.ttlSeconds,
			});
		},
		async signDownload(request) {
			assertKey(request.key);
			if (contract.browserAccess.download !== "signed") {
				throw new Error(`Application object store ${contract.name} does not allow signed browser downloads.`);
			}
			return runtime().signDownload({
				key: request.key,
				ttlSeconds: contract.browserAccess.ttlSeconds,
			});
		},
	};
	return Object.freeze(handle);
}

function normalizeSha256(value: string, label: string): string {
	const normalized = value.trim().replace(/^sha256:/iu, "").toLowerCase();
	if (!/^[a-f0-9]{64}$/u.test(normalized))
		throw new Error(`${label} requires a SHA-256 checksum.`);
	return normalized;
}
