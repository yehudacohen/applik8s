import type {
	ApplicationGeneratedResourceContract,
	ApplicationGraphNodeBase,
	ApplicationGraphNodeRef,
	ApplicationMessageContractSchema,
	ApplicationProcessorDeploymentContract,
	ApplicationProviderRef,
	ApplicationReactiveDatabaseRuntimeContract,
	ApplicationRetryPolicy,
} from "./application-graph.js";
import type { ApplicationHandlerDependencies } from "./application-graph-gateway.js";
import type { SourceLocation } from "./common.js";

export interface ApplicationStreamProcessorNode
	extends ApplicationGraphNodeBase<"streamProcessor"> {
	/** Installation-derived condition controlling whether this processor exists. */
	readonly enabled?: boolean | `\${${string}}`;
	readonly source: ApplicationGraphNodeRef;
	readonly database: ApplicationReactiveDatabaseRuntimeContract;
	readonly handlerSource: string;
	readonly handlerDependencies?: ApplicationHandlerDependencies;
	readonly handlerLocation?: SourceLocation;
	readonly handlerUnresolved?: readonly string[];
	/** Recurring workflow/task schedules explicitly available to this effect handler. */
	readonly schedules?: readonly {
		readonly alias: string;
		readonly target: ApplicationGraphNodeRef;
		readonly contract: {
			readonly name: string;
			readonly version: string;
			readonly input: ApplicationMessageContractSchema;
		};
	}[];
	/** One-shot durable tasks explicitly available to this effect handler. */
	readonly tasks?: readonly {
		readonly alias: string;
		readonly target: ApplicationGraphNodeRef;
		readonly contract: {
			readonly name: string;
			readonly version: string;
			readonly input: ApplicationMessageContractSchema;
			readonly output: ApplicationMessageContractSchema;
		};
	}[];
	readonly workflowEngine?: ApplicationProviderRef<"WorkflowEngine">;
	readonly delivery: "at-least-once";
	readonly idempotency: "source-event-id";
	readonly checkpoint: "postgres";
	readonly failure: "pause" | "deadLetter";
	readonly retry: Required<
		Pick<
			ApplicationRetryPolicy,
			"maxAttempts" | "initialDelayMs" | "maxDelayMs"
		>
	> & { readonly mode: "boundedExponentialBackoff"; readonly factor: number };
	readonly deployment: ApplicationProcessorDeploymentContract;
	readonly budgets: {
		readonly timeoutMs: number;
		readonly maxInputBytes: number;
	};
}

export interface ApplicationProjectionNode
	extends ApplicationGraphNodeBase<"projection"> {
	readonly source: ApplicationGraphNodeRef;
	readonly provider: ApplicationProviderRef;
	readonly storage?: "analytical" | "online";
	readonly rebuildable: boolean;
	readonly checkpoint: "transactional" | "idempotent" | "external";
	readonly output: ApplicationMessageContractSchema;
	readonly eventIdentity: "stable-source-event-id";
	readonly duplicateHandling: "idempotent";
	readonly rebuild: "full-replay";
	readonly handlerSource: string;
	readonly handlerDependencies?: ApplicationHandlerDependencies;
	readonly handlerLocation?: SourceLocation;
	readonly handlerUnresolved?: readonly string[];
	readonly online?: {
		readonly generationScoped: true;
		readonly retention: {
			readonly maxItemsPerPartition: number;
			readonly maxPartitions: number;
			readonly maxAgeSeconds?: number;
		};
		readonly scoreUnit: "arbitrary" | "epochMilliseconds";
		readonly rebuild: {
			readonly checkpoint: "durable";
			/** Optional canonical model snapshot used before retained stream catch-up. */
			readonly source?: ApplicationGraphNodeRef;
			readonly mapSource?: string;
			readonly mapDependencies?: ApplicationHandlerDependencies;
			readonly mapLocation?: SourceLocation;
			readonly mapUnresolved?: readonly string[];
		};
		readonly partitionSource: string;
		readonly partitionDependencies?: ApplicationHandlerDependencies;
		readonly partitionLocation?: SourceLocation;
		readonly partitionUnresolved?: readonly string[];
		readonly keySource: string;
		readonly keyDependencies?: ApplicationHandlerDependencies;
		readonly keyLocation?: SourceLocation;
		readonly keyUnresolved?: readonly string[];
		readonly scoreSource: string;
		readonly scoreDependencies?: ApplicationHandlerDependencies;
		readonly scoreLocation?: SourceLocation;
		readonly scoreUnresolved?: readonly string[];
		readonly valueSource: string;
		readonly valueDependencies?: ApplicationHandlerDependencies;
		readonly valueLocation?: SourceLocation;
		readonly valueUnresolved?: readonly string[];
		readonly removeSource?: string;
		readonly removeDependencies?: ApplicationHandlerDependencies;
		readonly removeLocation?: SourceLocation;
		readonly removeUnresolved?: readonly string[];
	};
}

export interface ApplicationObjectStoreNode
	extends ApplicationGraphNodeBase<"objectStore"> {
	/** Installation-derived condition controlling whether this logical store accepts operations. */
	readonly enabled?: boolean | `\${${string}}`;
	readonly provider: ApplicationProviderRef<"ObjectStorage">;
	readonly objectMode: "immutable" | "mutable";
	readonly maxObjectBytes: number;
	readonly contentTypes: readonly string[];
	readonly browserAccess: {
		readonly upload: "none" | "signed";
		readonly download: "none" | "signed";
		/** Owner-scoped by default; authenticated access is appropriate only for objects disclosed by an authorized public model/query. */
		readonly downloadAccess: "owner" | "authenticated";
		readonly ttlSeconds: number;
	};
	readonly integrity: "sha256";
	readonly credentials: "server-only";
	readonly deletion: "explicit" | "retained";
}

export interface ApplicationExposureNode
	extends ApplicationGraphNodeBase<"exposure"> {
	/** Serialized installation condition controlling whether this exposure exists. */
	readonly enabled?: boolean | `\${${string}}`;
	readonly provider: ApplicationProviderRef<"HttpExposure">;
	readonly certificate?: ApplicationProviderRef<"Certificate">;
	readonly dnsPublication?: ApplicationProviderRef<"DnsPublication">;
	readonly service: string;
	readonly hostnames: readonly string[];
	readonly tlsIntent: ApplicationTlsIntentContract;
	readonly dnsIntent?: ApplicationDnsIntentContract;
	readonly publicUrl: string;
	readonly transport: ApplicationExposureTransportContract;
	readonly readiness: ApplicationExposureReadinessContract;
	readonly generatedResources: readonly ApplicationGeneratedResourceContract[];
}

export type ApplicationExposureTransportContract =
	| { readonly kind: "ingress"; readonly ingressClassName?: string }
	| {
			readonly kind: "node-port";
			readonly host: string;
			readonly nodePort: number | `\${${string}}`;
	  };

export type ApplicationTlsIntentContract =
	| { readonly mode: "disabled" }
	| { readonly mode: "external"; readonly secretName: string }
	| {
			readonly mode: "managed";
			readonly secretName: string;
			readonly issuerRef: {
				readonly name: string;
				readonly kind: "Issuer" | "ClusterIssuer";
			};
	  };

export type ApplicationDnsIntentContract =
	| { readonly mode: "disabled" }
	| { readonly mode: "managed"; readonly ttlSeconds?: number };

export interface ApplicationExposureReadinessContract {
	readonly ingress: "notRequested" | "resourceApplied";
	readonly service: "notRequested" | "resourceApplied";
	readonly loadBalancer: "notRequested" | "statusObserved";
	readonly certificate: "notRequested" | "external" | "readyCondition";
	readonly dns: "notRequested" | "intentApplied" | "propagationUnverified";
	readonly publicUrl: "derived";
}
