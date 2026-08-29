/** Handler-safe object-storage value and provider contracts. */

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

export interface ApplicationObjectStorageRuntime {
	put(request: ApplicationObjectPutRequest): Promise<ApplicationObjectReference>;
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
