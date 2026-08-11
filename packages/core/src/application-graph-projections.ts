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

/**
 * Compiler-inferred atomic model boundary reached through ordinary callable
 * model helpers. Registration families select the trigger-owned durable
 * identity; application authors never declare this dependency list.
 */
export interface ApplicationFunctionNativeTransactionContract {
	/** Read scopes hydrate bounded reads; write scopes also install the durable edit kernel. */
	readonly mode?: "read" | "write";
	readonly primaryModel: ApplicationGraphNodeRef;
	readonly models: readonly ApplicationGraphNodeRef[];
	readonly modelBindings: readonly {
		readonly identifier: string;
		readonly model: ApplicationGraphNodeRef;
		readonly access: "read" | "write";
	}[];
	/**
	 * Authored callback identifiers that must hydrate to graph-owned event
	 * handles inside the generated runtime. The compiler records these aliases
	 * so workers never import and replay an application authoring module.
	 */
	readonly eventBindings?: readonly {
		readonly identifier: string;
		readonly event: ApplicationGraphNodeRef;
	}[];
	readonly outbox: readonly ApplicationGraphNodeRef[];
	readonly idempotency:
		| "source-event-id"
		| "frozen-batch-id"
		| "durable-task-invocation"
		| "agent-tool-call"
		| "http-idempotency-key";
}

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
	/**
	 * Compiler-inferred transaction boundary reached through ordinary helper
	 * calls. The event or frozen-batch identity supplies durable idempotency;
	 * application code never authors this dependency list.
	 */
	readonly functionNativeTransaction?: ApplicationFunctionNativeTransactionContract;
	/**
	 * Durable model mutations reached through ordinary callback/helper calls.
	 * Generated workers rehydrate these exact leaves through the authorized
	 * command runtime; application authors never declare an operation map.
	 */
	readonly operationBindings?: readonly {
		readonly identifier: string;
		readonly operationId: string;
		readonly runtimeOperationId?: string;
		readonly operation: {
			readonly apiVersion: "applik8s.operation/v1alpha1";
			readonly kind: "applicationOperation";
			readonly id: string;
			readonly model: string;
			readonly name: string;
			readonly operation: "create" | "update" | "delete";
			readonly transport: "command";
		};
		readonly command: ApplicationGraphNodeRef;
		readonly handler: ApplicationGraphNodeRef;
	}[];
	/**
	 * Bounded application views reached through ordinary callback/helper calls.
	 * The generated processor executes only these exact query nodes and retains
	 * their declared authorization, schemas, read authority, and budgets.
	 */
	readonly queryBindings?: readonly {
		readonly identifier: string;
		readonly query: ApplicationGraphNodeRef;
	}[];
	/** Portable package-owned wrappers reconstructed from their admitted operation leaves. */
	readonly callableBindings?: readonly {
		readonly identifier: string;
		readonly runtime: "notifications.request.v1";
		readonly dependencies: readonly string[];
	}[];
	/** Provider capabilities inferred through ordinary maintained-module calls. */
	readonly providerBindings?: readonly {
		readonly identifier: string;
		readonly provider: ApplicationProviderRef;
	}[];
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
	/** One-shot durable workflows (or legacy task bindings) explicitly available to this effect handler. */
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
	readonly invocation: "event" | "batch";
	readonly idempotency: "source-event-id" | "frozen-batch-id";
	readonly batch?: {
		readonly maxItems: number;
		readonly maxBytes: number;
		readonly maxWaitMs: number;
		readonly ordering: "partition";
		readonly acknowledgement: "wholeBatch";
		readonly membership: "durableFrozenManifest";
	};
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
	/**
	 * Explicit capability-bearing output fields. Ordinary projection fields
	 * cannot persist a signal reference merely because their JSON shape fits.
	 */
	readonly capabilityFields?: readonly {
		readonly path: string;
		readonly kind: "signalReference";
		readonly contract: {
			readonly id: string;
			readonly name: string;
			readonly version: string;
		};
		readonly visibility: "same-as-issuance";
		readonly maxAgeSeconds: number;
	}[];
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
