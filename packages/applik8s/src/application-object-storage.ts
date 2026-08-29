// typecast-file-boundary: provider implementations are discriminator-checked before being restored to their typed object-storage contracts.

import {
	type ApplicationOperation,
	createApplicationRuntimeOperation,
} from "@applik8s/client";
import type {
	ApplicationObjectStoreNode,
	ApplicationProviderRef,
} from "@applik8s/core";
import type { ApplicationGraphState } from "./application-graph-state.js";
import {
	addApplicationGraphEdge,
	addApplicationGraphNode,
	addApplicationProviderBinding,
	addApplicationProviderRequirement,
} from "./application-graph-state.js";
import {
	installApplicationObjectStorageRuntimeResolver,
	setApplicationObjectStorageRuntimeFactory,
} from "./application-object-storage-runtime-resolver.js";
import type {
	ApplicationObjectMetadata,
	ApplicationObjectPutRequest,
	ApplicationObjectReference,
	ApplicationSignedObjectIntent,
} from "./application-object-storage-runtime-contract.js";
import { createApplicationObjectStoreRuntimeHandle } from "./application-object-storage-runtime-handle.js";
import type {
	ApplicationObjectStorageProvider,
	ApplicationProviderBinding,
	ApplicationProviderState,
} from "./application-providers.js";
import {
	applicationObjectStorageImplementation,
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

export type {
	ApplicationObjectMetadata,
	ApplicationObjectPutRequest,
	ApplicationObjectReference,
	ApplicationObjectStorageRuntime,
	ApplicationSignedObjectIntent,
} from "./application-object-storage-runtime-contract.js";
export type {
	ApplicationObjectStoreRuntimeContract,
	ApplicationObjectStoreRuntimeHandle,
} from "./application-object-storage-runtime-handle.js";
export { createApplicationObjectStoreRuntimeHandle } from "./application-object-storage-runtime-handle.js";

/** Provider-verified metadata plus a short-lived proof suitable for a durable model command. */
export interface ApplicationVerifiedObjectCompletion
	extends ApplicationObjectMetadata {
	/** Stable logical identity derived from the server-generated object key. */
	readonly objectId: string;
	/** HMAC-authenticated, principal-scoped proof; never an object-store credential. */
	readonly receipt: string;
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

export {
	installApplicationObjectStorageRuntimeResolver,
	setApplicationObjectStorageRuntimeFactory,
};

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

	const binding: ApplicationObjectStoreBinding = {
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
		...createApplicationObjectStoreRuntimeHandle(node),
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

function objectStorageImplementation(
	value: unknown,
): ApplicationObjectStorageProvider | undefined {
	return applicationObjectStorageImplementation(value);
}
