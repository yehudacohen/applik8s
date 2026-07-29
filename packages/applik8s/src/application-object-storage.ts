// typecast-file-boundary: provider implementations are discriminator-checked before being restored to their typed object-storage contracts.
import type {
	ApplicationObjectStoreNode,
	ApplicationProviderRef,
} from "@applik8s/core";
import {
	createApplicationRuntimeOperation,
	type ApplicationOperation,
} from "@applik8s/client";
import type { ApplicationGraphState } from "./application-graph-state.js";
import {
	addApplicationGraphEdge,
	addApplicationGraphNode,
	addApplicationProviderBinding,
	addApplicationProviderRequirement,
} from "./application-graph-state.js";
import type {
	ApplicationObjectStorageProvider,
	ApplicationProviderBinding,
	ApplicationProviderState,
} from "./application-providers.js";
import {
	ObjectStorage,
	isApplicationObjectStorageProvider,
} from "./application-providers.js";
import { applicationTypeKroGraphValue } from "./application-typekro-values.js";

export interface ApplicationObjectStoreOptions {
	/** Installation-derived feature condition. Disabled stores fail closed at the server gateway. */
	readonly enabled?: boolean;
	readonly provider?:
		| ApplicationObjectStorageProvider
		| ApplicationProviderBinding<ApplicationObjectStorageProvider>;
	readonly mode?: "immutable" | "mutable";
	readonly maxObjectBytes: number;
	readonly contentTypes: readonly string[];
	readonly browser?: {
		readonly upload?: "none" | "signed";
		readonly download?:
			| "none"
			| "signed"
			| {
					readonly mode: "signed";
					/**
					 * `owner` requires the server-generated key to belong to the admitted principal.
					 * `authenticated` is for public/read-authorized objects whose opaque keys are
					 * disclosed only through an independently authorized model/query.
					 */
					readonly access: "owner" | "authenticated";
			  };
		readonly ttlSeconds?: number;
	};
	readonly deletion?: "explicit" | "retained";
}

export interface ApplicationObjectReference {
	readonly store: string;
	readonly key: string;
	readonly size: number;
	readonly contentType: string;
	readonly sha256: string;
	readonly etag?: string;
	readonly version?: string;
}

export interface ApplicationObjectMetadata extends ApplicationObjectReference {
	readonly updatedAt?: string;
	readonly custom?: Readonly<Record<string, string>>;
}

/** Provider-verified metadata plus a short-lived proof suitable for a durable model command. */
export interface ApplicationVerifiedObjectCompletion
	extends ApplicationObjectMetadata {
	/** Stable logical identity derived from the server-generated object key. */
	readonly objectId: string;
	/** HMAC-authenticated, principal-scoped proof; never an object-store credential. */
	readonly receipt: string;
}

export interface ApplicationSignedObjectIntent {
	readonly method: "GET" | "PUT";
	readonly url: string;
	readonly expiresAt: string;
	readonly headers: Readonly<Record<string, string>>;
	readonly object: { readonly store: string; readonly key: string };
}

export interface ApplicationObjectPutRequest {
	readonly key: string;
	readonly body: Uint8Array | string;
	readonly contentType: string;
	readonly sha256?: string;
	readonly metadata?: Readonly<Record<string, string>>;
	readonly ifAbsent?: boolean;
}

export interface ApplicationObjectUploadRequest {
	readonly contentType: string;
	readonly size: number;
	readonly sha256: string;
}

export interface ApplicationObjectUploadCompletionRequest
	extends ApplicationObjectUploadRequest {
	readonly key: string;
}

export interface ApplicationObjectDownloadRequest {
	readonly key: string;
}

export interface ApplicationObjectStorageRuntime {
	put(
		request: ApplicationObjectPutRequest,
	): Promise<ApplicationObjectReference>;
	get(key: string): Promise<Uint8Array | undefined>;
	head(key: string): Promise<ApplicationObjectMetadata | undefined>;
	delete(key: string, options?: { readonly ifVersion?: string }): Promise<void>;
	signUpload(request: {
		readonly key: string;
		readonly contentType: string;
		readonly size: number;
		readonly sha256: string;
		readonly ttlSeconds: number;
	}): Promise<ApplicationSignedObjectIntent>;
	signDownload(request: {
		readonly key: string;
		readonly ttlSeconds: number;
	}): Promise<ApplicationSignedObjectIntent>;
}

export interface ApplicationObjectStoreBinding {
	readonly kind: "applicationObjectStore";
	readonly name: string;
	readonly provider: ApplicationObjectStorageProvider;
	readonly mode: "immutable" | "mutable";
	readonly maxObjectBytes: number;
	readonly contentTypes: readonly string[];
	readonly browser: {
		readonly upload: "none" | "signed";
		readonly download: "none" | "signed";
		readonly downloadAccess: "owner" | "authenticated";
		readonly ttlSeconds: number;
	};
	/** Browser/SSR-safe authenticated intent; the facade routes it through the application gateway. */
	readonly createUpload: ApplicationOperation<
		ApplicationObjectUploadRequest,
		ApplicationSignedObjectIntent
	>;
	/** Verifies provider-authoritative length, type, and digest before metadata may be committed. */
	readonly completeUpload: ApplicationOperation<
		ApplicationObjectUploadCompletionRequest,
		ApplicationVerifiedObjectCompletion
	>;
	/** Creates a short-lived principal-scoped read intent. */
	readonly createDownload: ApplicationOperation<
		ApplicationObjectDownloadRequest,
		ApplicationSignedObjectIntent
	>;
	put(
		request: ApplicationObjectPutRequest,
	): Promise<ApplicationObjectReference>;
	get(key: string): Promise<Uint8Array | undefined>;
	head(key: string): Promise<ApplicationObjectMetadata | undefined>;
	delete(key: string, options?: { readonly ifVersion?: string }): Promise<void>;
	signUpload(request: {
		readonly key: string;
		readonly contentType: string;
		readonly size: number;
		readonly sha256: string;
	}): Promise<ApplicationSignedObjectIntent>;
	signDownload(request: {
		readonly key: string;
	}): Promise<ApplicationSignedObjectIntent>;
}

type ApplicationObjectStorageRuntimeFactory = (
	binding: ApplicationObjectStoreBinding,
) => ApplicationObjectStorageRuntime;

let runtimeFactory: ApplicationObjectStorageRuntimeFactory | undefined;

/** Runtime adapters install one provider client factory; discovery remains pure and credential-free. */
export function setApplicationObjectStorageRuntimeFactory(
	factory: ApplicationObjectStorageRuntimeFactory | undefined,
): void {
	runtimeFactory = factory;
}

interface ApplicationObjectStoreState
	extends ApplicationGraphState,
		ApplicationProviderState {}

export function registerApplicationObjectStore(
	state: ApplicationObjectStoreState,
	name: string,
	options: ApplicationObjectStoreOptions,
): ApplicationObjectStoreBinding {
	if (!/^[a-z][a-z0-9-]*$/.test(name))
		throw new Error(
			`Application object store ${JSON.stringify(name)} must be a lowercase DNS-style identifier.`,
		);
	if (
		!Number.isSafeInteger(options.maxObjectBytes) ||
		options.maxObjectBytes < 1
	)
		throw new Error(
			`Application object store ${name} maxObjectBytes must be a positive safe integer.`,
		);
	const contentTypes = [
		...new Set(options.contentTypes.map((value) => value.trim().toLowerCase())),
	];
	if (
		contentTypes.length === 0 ||
		contentTypes.some((value) => !value?.includes("/"))
	)
		throw new Error(
			`Application object store ${name} must declare at least one valid content type.`,
		);
	const provider =
		objectStorageImplementation(options.provider) ??
		objectStorageImplementation(state.providers.objects) ??
		objectStorageImplementation(state.defaults.objects);
	if (!provider)
		throw new Error(
			`Application object store ${name} requires exactly one ObjectStorage provider.`,
		);
	const requestedDownload = options.browser?.download ?? "none";
	const browser = {
		upload: options.browser?.upload ?? "none",
		download: requestedDownload === "none" ? "none" : "signed",
		downloadAccess:
			typeof requestedDownload === "object"
				? requestedDownload.access
				: "owner",
		ttlSeconds: options.browser?.ttlSeconds ?? 300,
	} as const;
	if (
		!Number.isSafeInteger(browser.ttlSeconds) ||
		browser.ttlSeconds < 1 ||
		browser.ttlSeconds > 3_600
	)
		throw new Error(
			`Application object store ${name} browser ttlSeconds must be between 1 and 3600.`,
		);
	if (provider.kind === "kubernetes-configmap-objects") {
		const providerLimit = provider.maxObjectBytes ?? 524_288;
		if (options.maxObjectBytes > providerLimit)
			throw new Error(
				`Application object store ${name} requires ${options.maxObjectBytes} bytes, exceeding the ConfigMap provider limit of ${providerLimit}.`,
			);
		if (browser.upload === "signed" || browser.download === "signed")
			throw new Error(
				`Application object store ${name} requires signed browser access, which the bounded ConfigMap provider cannot supply.`,
			);
	}
	const nodeId = `objectStore.${name}`;
	if (state.graphNodes.some((node) => node.id === nodeId))
		throw new Error(`Application object store ${name} is already registered.`);
	const providerRef: ApplicationProviderRef<"ObjectStorage"> = {
		nodeId: "provider.object-storage",
		interface: "ObjectStorage",
	};
	const node: ApplicationObjectStoreNode = {
		id: nodeId,
		kind: "objectStore",
		name,
		stability: "stable",
		...objectStoreEnabled(options.enabled),
		provider: providerRef,
		objectMode: options.mode ?? "immutable",
		maxObjectBytes: options.maxObjectBytes,
		contentTypes,
		browserAccess: browser,
		integrity: "sha256",
		credentials: "server-only",
		deletion: options.deletion ?? "explicit",
	};
	addApplicationGraphNode(state, node);
	addApplicationGraphEdge(state, {
		from: providerRef,
		to: { nodeId },
		relationship: "provides",
	});
	const requirement = `object-storage.${name}`;
	addApplicationProviderRequirement(state, {
		id: requirement,
		interface: "ObjectStorage",
		consumer: { nodeId },
		provider: providerRef,
		required: true,
		purpose: "objectStorage",
		diagnostics: {
			missing: `Object store ${name} requires an ObjectStorage provider.`,
			ambiguous: `Object store ${name} has multiple ObjectStorage providers.`,
		},
	});
	addApplicationProviderBinding(state, {
		requirement,
		provider: providerRef,
		generatedResources: [],
		runtime: {
			secretRefs:
				provider.kind === "s3" && provider.credentialsSecret
					? [provider.credentialsSecret]
					: [],
		},
		metadataLinks: [],
	});

	let binding: ApplicationObjectStoreBinding;
	const runtime = () => {
		if (!runtimeFactory)
			throw new Error(
				`Application object store ${name} has no hydrated runtime adapter. Install the selected ObjectStorage provider runtime before performing object I/O.`,
			);
		return runtimeFactory(binding);
	};
	const assertKey = (key: string) => {
		if (!key || key.startsWith("/") || key.includes("..") || key.length > 1_024)
			throw new Error(
				`Application object store ${name} received an unsafe object key.`,
			);
	};
	const assertContentType = (contentType: string) => {
		const normalized = contentType.trim().toLowerCase();
		if (!contentTypes.includes(normalized))
			throw new Error(
				`Application object store ${name} does not allow content type ${JSON.stringify(contentType)}.`,
			);
		return normalized;
	};
	binding = {
		kind: "applicationObjectStore",
		name,
		provider,
		mode: node.objectMode,
		maxObjectBytes: node.maxObjectBytes,
		contentTypes,
		browser,
		createUpload: createApplicationRuntimeOperation({
			apiVersion: "applik8s.operation/v1alpha1",
			kind: "applicationOperation",
			id: `${nodeId}.createUpload`,
			model: name,
			name: "createUpload",
			operation: "custom",
			transport: "runtime",
		}),
		completeUpload: createApplicationRuntimeOperation({
			apiVersion: "applik8s.operation/v1alpha1",
			kind: "applicationOperation",
			id: `${nodeId}.completeUpload`,
			model: name,
			name: "completeUpload",
			operation: "custom",
			transport: "runtime",
		}),
		createDownload: createApplicationRuntimeOperation({
			apiVersion: "applik8s.operation/v1alpha1",
			kind: "applicationOperation",
			id: `${nodeId}.createDownload`,
			model: name,
			name: "createDownload",
			operation: "custom",
			transport: "runtime",
		}),
		async put(request) {
			assertKey(request.key);
			const contentType = assertContentType(request.contentType);
			const bytes =
				typeof request.body === "string"
					? new TextEncoder().encode(request.body).byteLength
					: request.body.byteLength;
			if (bytes > options.maxObjectBytes)
				throw new Error(
					`Application object store ${name} object ${request.key} exceeds the ${options.maxObjectBytes}-byte limit.`,
				);
			return runtime().put({
				...request,
				contentType,
				...(node.objectMode === "immutable" ? { ifAbsent: true } : {}),
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
		async delete(key, deleteOptions) {
			assertKey(key);
			return runtime().delete(key, deleteOptions);
		},
		async signUpload(request) {
			assertKey(request.key);
			const contentType = assertContentType(request.contentType);
			if (browser.upload !== "signed")
				throw new Error(
					`Application object store ${name} does not allow signed browser uploads.`,
				);
			if (
				!Number.isSafeInteger(request.size) ||
				request.size < 1 ||
				request.size > options.maxObjectBytes
			)
				throw new Error(
					`Application object store ${name} upload size must be between 1 and ${options.maxObjectBytes} bytes.`,
				);
			const sha256 = normalizeSha256(
				request.sha256,
				`Application object store ${name} upload`,
			);
			return runtime().signUpload({
				key: request.key,
				contentType,
				size: request.size,
				sha256,
				ttlSeconds: browser.ttlSeconds,
			});
		},
		async signDownload(request) {
			assertKey(request.key);
			if (browser.download !== "signed")
				throw new Error(
					`Application object store ${name} does not allow signed browser downloads.`,
				);
			return runtime().signDownload({
				key: request.key,
				ttlSeconds: browser.ttlSeconds,
			});
		},
	};
	return binding;
}

function objectStoreEnabled(
	value: boolean | undefined,
): Pick<ApplicationObjectStoreNode, "enabled"> | Record<string, never> {
	if (value === undefined) return {};
	const normalized = applicationTypeKroGraphValue(value);
	if (
		typeof normalized !== "boolean" &&
		!isSerializedBooleanExpression(normalized)
	) {
		throw new Error(
			"Application object store enabled must be a concrete or installation-derived boolean.",
		);
	}
	return { enabled: normalized };
}

function isSerializedBooleanExpression(
	value: unknown,
): value is `\${${string}}` {
	return typeof value === "string" && /^\$\{.+\}$/.test(value);
}

function normalizeSha256(value: string, label: string): string {
	const normalized = value
		.trim()
		.replace(/^sha256:/i, "")
		.toLowerCase();
	if (!/^[a-f0-9]{64}$/.test(normalized))
		throw new Error(`${label} requires a SHA-256 checksum.`);
	return normalized;
}

function objectStorageImplementation(
	value: unknown,
): ApplicationObjectStorageProvider | undefined {
	if (isApplicationObjectStorageProvider(value)) return value;
	if (
		value &&
		typeof value === "object" &&
		Reflect.get(value, "kind") === "applicationProvider" &&
		Reflect.get(value, "token") === ObjectStorage
	) {
		const implementation = Reflect.get(value, "implementation");
		return isApplicationObjectStorageProvider(implementation)
			? implementation
			: undefined;
	}
	return undefined;
}
