import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AnyResourceDefinition, ApplicationDiagnosticContract, ApplicationExposureReadinessContract, ApplicationGeneratedResourceContract, ApplicationGraph, ApplicationObservabilityContract, ApplicationProviderInterfaceKind, ApplicationWatchScope, ApplicationWatchScopeLoweringContract, HandlerRegistration, JsonValue, NormalizedOperationPlan, OperationTarget, OperatorDeploymentOptions, PermissionRule, PlanTargetOptions, ResourceDefinition, ResourceIndex, ResourceWatchAddress, Result } from '@applik8s/core';
import { applicationGraphMetadataProperty, normalizeApplicationGraph } from '@applik8s/core';
import type { CrdOptions, SchemaInput } from '@applik8s/sdk';
import { sdk as baseSdk, setOperatorDeploymentInterceptor } from '@applik8s/sdk';
import type { TypeKroListenerComposition, TypeKroListenerCompositionDefinition } from '@applik8s/typekro-adapter';
import { typeKro } from '@applik8s/typekro-adapter';
import { type as arkType } from 'arktype';
import { buildSync, transformSync } from 'esbuild';
import type { Enhanced, KroCompatibleType, MagicAssignableShape, SerializationOptions } from 'typekro';
import { Cel } from 'typekro';
import { certificate as typeKroCertificate } from 'typekro/cert-manager';
import { cluster as typeKroCnpgCluster } from 'typekro/cnpg';
import { configMap as typeKroConfigMap, cronJob as typeKroCronJob, deployment as typeKroDeployment, ingress as typeKroIngress, job as typeKroJob, role as typeKroRole, roleBinding as typeKroRoleBinding, secret as typeKroSecret, service as typeKroService, serviceAccount as typeKroServiceAccount } from 'typekro/kubernetes';
import { valkey as typeKroValkey } from 'typekro/valkey';
import type { ApplicationServerRuntimeIndex, ApplicationServerRuntimeResource } from './application-generated-runtime-sources.js';
import { generatedApplicationAggregateSource, generatedValkeyIndexerSource } from './application-generated-runtime-sources.js';
import { type ApplicationGraphState, addApplicationGraphEdge, addApplicationGraphNode, applicationGraphFromState, isApplicationGraph } from './application-graph-state.js';
import { applicationGeneratedJobDurableStatus, applicationGeneratedJobObservability, applicationGeneratedJobPhase, applicationGeneratedJobPhaseStatusContract, applicationGeneratedJobRetry, applicationGeneratedJobRuntime, applicationGeneratedJobStatusLifecycle, applicationGeneratedJobStatusUpdater } from './application-jobs.js';
import type { ApplicationModelBinding, ApplicationModelOptions, ApplicationModelRuntimeBinding, ApplicationModelSchemaIndexOptions, ApplicationRuntimeModelContract } from './application-models.js';
import { applicationModelBinding, applicationModelMigrationPlan, applicationModelMigrationPreflightSql, applicationModelMigrationSql, applicationRuntimeModelContract, recordApplicationModelCommandGraph, recordApplicationModelGraph, resolveApplicationModelStore } from './application-models.js';
import type { ApplicationDefaults, ApplicationDefaultsBinding, ApplicationDnsPublicationProvider, ApplicationHttpExposureProvider, ApplicationIndexBackend, ApplicationModelStoreProvider, ApplicationPostgresModelStoreOptions, ApplicationProviderBinding, ApplicationProviderState, ApplicationProviderToken, ApplicationTypedProviderContract, ApplicationValkeyIndexBackend } from './application-providers.js';
import { applicationCertificateImplementation, applicationDnsPublicationImplementation, applicationHttpExposureImplementation, applicationModelStoreImplementation, applicationProviderImplementationName, applicationProviderInterface, applicationProviderTokenName, applicationTypedProviderContract, applyApplicationProvider, defaultApplicationEventLogProvider, defaultApplicationIndexBackend, defaultApplicationIndexProvider, defaultApplicationProviders, isIngressHttpExposureProvider, isValkeyIndexDefault, ModelStore } from './application-providers.js';
import type { ApplicationRouteSourceLocation, ApplicationServerRouteSourceAnalysis, SerializedApplicationServerRouteWithDependencies } from './application-route-source.js';
import { analyzeApplicationServerRouteSource, applicationRouteSourceDependencies, extractApplicationRouteHandlerSource, normalizeSerializableFunctionSource, routeAnalysisCallsMethod, routeDynamicBindingAccesses, serializedCallbackClosureMessage, unsupportedRouteFreeIdentifiers } from './application-route-source.js';
import { generatedApplicationRuntimeModuleBundle, generatedJobStatusRuntimeBundle } from './application-runtime-modules.js';
import { generatedApplicationServerRuntimeSource, runtimeIndexTable } from './application-server-runtime.js';
import { generatedServerRuntimeBundleContract } from './application-server-runtime-bundle.js';
import type { ApplicationGeneratedJobStatusProjectionStore, ApplicationGeneratedJobStatusTarget, ApplicationStatusReconcilerAppResourceTarget } from './application-status-reconciler.js';
import { applicationStatusReconcilerName, emitApplicationGeneratedJobStatusReconcilers } from './application-status-reconciler.js';
import type { ApplicationTaskBinding, ApplicationTaskHandler, ApplicationTaskOptions, ApplicationWorkflowBinding, ApplicationWorkflowHandler, ApplicationWorkflowOptions } from './application-workflows.js';
import { type ApplicationWorkflowState, registerApplicationTask, registerApplicationWorkflow } from './application-workflows.js';
import type { EntityDefinition, TaskDefinition, WorkflowDefinition } from './dsl.js';

export type { ApplicationCommandDomainError, ApplicationCommandKey, ApplicationCommandSubmissionAcknowledgement, ApplicationModelBackendContract, ApplicationModelBinding, ApplicationModelCommandBinding, ApplicationModelCommandContext, ApplicationModelCommandHandler, ApplicationModelCommandOptions, ApplicationModelCommandParticipantClient, ApplicationModelCommandTarget, ApplicationModelConstraintOptions, ApplicationModelCreateInput, ApplicationModelEventBinding, ApplicationModelEventHandler, ApplicationModelEventRegistrar, ApplicationModelIndexBinding, ApplicationModelIndexOptions, ApplicationModelObject, ApplicationModelOptions, ApplicationModelPatch, ApplicationModelQueryOptions, ApplicationModelQueryPage, ApplicationModelRef, ApplicationModelRuntimeBinding, ApplicationModelSchemaIndexOptions, ApplicationModelSchemaOptions, ApplicationRuntimeModelContract } from './application-models.js';
export type { ApplicationProcessorOptions } from './application-processor-policy.js';
export type { ApplicationCertificateProvider, ApplicationCertificateProviderToken, ApplicationCertManagerCertificateProvider, ApplicationCounterStoreProvider, ApplicationCredentialStoreProvider, ApplicationDefaults, ApplicationDefaultsBinding, ApplicationDnsPublicationProvider, ApplicationDnsPublicationProviderToken, ApplicationEventLogProvider, ApplicationEventSourceProvider, ApplicationExternalDnsPublicationProvider, ApplicationGeneratedModelStoreMigrationJobOptions, ApplicationHatchetWorkflowEngineProvider, ApplicationHttpExposureProvider, ApplicationIndexBackend, ApplicationIngressHttpExposureProvider, ApplicationKubernetesConfigMapObjectStorageProvider, ApplicationKubernetesConfigMapQueueProvider, ApplicationKubernetesCredentialStoreProvider, ApplicationKubernetesResourceCounterStoreProvider, ApplicationKubernetesSecretProvider, ApplicationKubernetesWatchEventSourceProvider, ApplicationModelStoreMigrationPolicy, ApplicationModelStoreProvider, ApplicationModelStoreProviderToken, ApplicationNatsJetStreamEventLogProvider, ApplicationObjectStorageProvider, ApplicationPostgresModelStoreOptions, ApplicationPostgresModelStoreProvider, ApplicationPostgresReadinessPolicy, ApplicationProviderBinding, ApplicationProviderToken, ApplicationQueueProvider, ApplicationSecretProvider, ApplicationTypedProviderContract, ApplicationValkeyIndexBackend, ApplicationWorkflowEngineProvider, ApplicationWorkflowEngineProviderToken } from './application-providers.js';
export { Certificate, CounterStore, CredentialStore, DnsPublication, defaultApplicationEventLogProvider, defaultApplicationProviders, defaultApplicationWorkflowEngineProvider, defineApplicationProvider, EventLog, EventSource, HttpExposure, IndexStore, ModelStore, ObjectStorage, providers, Queue, Secret, WorkflowEngine } from './application-providers.js';
export type { ApplicationTaskBinding, ApplicationTaskContext, ApplicationTaskHandler, ApplicationTaskOptions, ApplicationWorkflowBinding, ApplicationWorkflowContext, ApplicationWorkflowHandler, ApplicationWorkflowOptions, ApplicationWorkflowWorkerOptions } from './application-workflows.js';

export interface KubernetesApplicationScope {
  readonly api: ApplicationServerRegistrar & Record<string, ApplicationServerBinding>;
  readonly http: ApplicationServerRegistrar & Record<string, ApplicationServerBinding>;
  readonly server: ApplicationServerRegistrar & Record<string, ApplicationServerBinding>;
  readonly storage: ApplicationStorageRegistrar;
  operator<TBinding>(operator: (options: OperatorDeploymentOptions) => TBinding, options: OperatorDeploymentOptions): TBinding;
  resource<TSpec extends object, TStatus extends object = Record<string, never>>(name: string, options: ApplicationResourceOptions<TSpec, TStatus>): ResourceDefinition<TSpec, TStatus>;
  crd<TSpec extends object, TStatus extends object = Record<string, never>>(entity: EntityDefinition<TSpec, TStatus>, options: ApplicationCrdOptions<TSpec, TStatus>): ResourceDefinition<TSpec, TStatus>;
  model<TSpec extends object, TStatus extends object = Record<string, never>>(name: string, options: ApplicationNamedModelOptions<TSpec, TStatus>): ApplicationModelBinding<TSpec, TStatus>;
  model<TSpec extends object, TStatus extends object = Record<string, never>>(entity: EntityDefinition<TSpec, TStatus>, options?: ApplicationModelOptions<TSpec, TStatus>): ApplicationModelBinding<TSpec, TStatus>;
  reconcile<TSpec extends object, TStatus extends object = Record<string, never>>(resource: ResourceDefinition<TSpec, TStatus>, handler: ApplicationReconcileHandler<TSpec, TStatus>, options?: ApplicationReconcileOptions): unknown;
  infra<TResource extends object>(resource: TResource): TResource;
  config(name: string, options: ApplicationConfigOptions): ApplicationConfigBinding;
  secret(name: string, options: ApplicationSecretOptions): ApplicationSecretBinding;
  expose(name: string, options: ApplicationExposureOptions): ApplicationExposureBinding;
  job(name: string, options?: ApplicationJobOptions): ApplicationJobBinding;
  schedule(name: string, options?: ApplicationScheduleOptions): ApplicationJobBinding;
  defaults(defaults: ApplicationDefaults): ApplicationDefaultsBinding;
  provide<TImplementation>(token: ApplicationProviderToken<TImplementation>, implementation: TImplementation): ApplicationProviderBinding<TImplementation>;
  aggregate<TStats extends object, TEvent extends object>(name: string, options: ApplicationAggregateOptions<TStats, TEvent>): ApplicationAggregateBinding<TStats, TEvent>;
  task<TInput extends object, TOutput extends object>(definition: TaskDefinition<TInput, TOutput>, options: ApplicationTaskOptions<TInput>, handler: ApplicationTaskHandler<TInput, TOutput>): ApplicationTaskBinding<TInput, TOutput>;
  workflow<TInput extends object, TOutput extends object>(definition: WorkflowDefinition<TInput, TOutput>, options: ApplicationWorkflowOptions, handler: ApplicationWorkflowHandler<TInput, TOutput>): ApplicationWorkflowBinding<TInput, TOutput>;
}

export interface ApplicationServerRegistrar {
  (name: string, configure: (server: ApplicationServer) => void): ApplicationServerBinding;
  (name: string, options: ApplicationServerOptions, configure: (server: ApplicationServer) => void): ApplicationServerBinding;
}

export interface ApplicationStorageRegistrar {
  postgres(name: string, options?: ApplicationStoragePostgresOptions): ApplicationDefaultsBinding;
}

export type ApplicationStoragePostgresOptions = Omit<ApplicationPostgresModelStoreOptions, 'name' | 'migrations'> & {
  readonly migrations?: ApplicationPostgresModelStoreOptions['migrations'] | 'generated-job' | 'generatedJob';
};

export type ApplicationResourceOptions<TSpec extends object, TStatus extends object> = Omit<CrdOptions<TSpec, TStatus>, 'apiVersion' | 'kind'> & {
  readonly apiVersion?: string;
  readonly kind?: string;
};

export interface ApplicationNamedModelOptions<TSpec extends object = object, TStatus extends object = Record<string, never>> extends ApplicationModelOptions<TSpec, TStatus> {
  readonly spec: SchemaInput<TSpec>;
  readonly status?: SchemaInput<TStatus>;
  readonly indexes?: Readonly<Record<string, readonly string[] | ApplicationNamedModelIndexOptions<TSpec, TStatus>>>;
}

export interface ApplicationNamedModelIndexOptions<TSpec extends object = object, TStatus extends object = Record<string, never>> {
  readonly fields?: readonly string[];
  readonly partitionBy?: string;
  readonly filter?: Partial<TSpec> | Partial<TStatus>;
  readonly orderBy?: readonly string[];
  readonly unique?: boolean;
}

export type ApplicationReconcileHandler<TSpec extends object, TStatus extends object> = Parameters<ResourceDefinition<TSpec, TStatus>['on']['reconcile']>[0];

export interface ApplicationReconcileOptions extends OperatorDeploymentOptions {
  readonly name?: string;
  /** Explicit RBAC required by direct Kubernetes SDK calls in this handler. */
  readonly permissions?: readonly PermissionRule[];
}

export type ApplicationCrdOptions<TSpec extends object, TStatus extends object> = Omit<CrdOptions<TSpec, TStatus>, 'kind' | 'spec' | 'status'> & {
  readonly kind?: string;
};

export interface ApplicationJobOptions {
  readonly taskKind?: 'preflight' | 'migration' | 'cleanup' | 'repair' | 'maintenance' | 'custom';
  readonly namespace?: string;
  readonly image?: string;
  readonly command?: readonly string[];
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

export interface ApplicationConfigOptions {
  readonly namespace?: string;
  readonly env?: string;
  readonly configMapName?: string;
  readonly key?: string;
  readonly mountPath?: string;
  readonly value?: string;
}

export interface ApplicationConfigBinding {
  readonly kind: 'applicationConfig';
  readonly name: string;
  readonly provider: 'ConfigMap';
  readonly resourceName: string;
  readonly namespace?: string;
  readonly key: string;
  readonly env?: string;
  readonly mountPath?: string;
  readonly diagnosticsPath: string;
}

export interface ApplicationSecretOptions {
  readonly namespace?: string;
  readonly env?: string;
  readonly secretName?: string;
  readonly key?: string;
  readonly mountPath?: string;
  readonly redaction?: 'required' | 'none';
  /**
   * Controls whether applik8s emits the Secret object or only references an
   * externally managed Secret. When omitted, an explicit secretName is treated
   * as external and an implicit generated name is treated as generated.
   */
  readonly ownership?: 'generated' | 'external';
}

export interface ApplicationSecretBinding {
  readonly kind: 'applicationSecret';
  readonly name: string;
  readonly provider: 'Secret';
  readonly resourceName: string;
  readonly namespace?: string;
  readonly key: string;
  readonly ownership: 'generated' | 'external';
  readonly env?: string;
  readonly mountPath?: string;
  readonly redaction: 'required' | 'none';
  readonly diagnosticsPath: string;
}

export interface ApplicationExposureOptions {
  readonly namespace?: string;
  readonly service?: string | ApplicationServerBinding;
  readonly servicePort?: number;
  readonly hostnames?: readonly string[];
  readonly tls?: 'required' | 'optional' | 'disabled' | ApplicationTlsIntent;
  readonly tlsSecretName?: string;
  readonly dns?: ApplicationDnsIntent;
  readonly gateway?: string;
  readonly ingressClassName?: string;
  readonly path?: string;
}

export type ApplicationTlsIntent =
  | { readonly mode: 'disabled' }
  | { readonly mode: 'external'; readonly secretName: string }
  | { readonly mode: 'managed'; readonly secretName?: string };

export type ApplicationDnsIntent =
  | { readonly mode: 'disabled' }
  | { readonly mode: 'managed'; readonly ttlSeconds?: number };

type NormalizedApplicationTlsIntent =
  | { readonly mode: 'disabled' }
  | { readonly mode: 'external'; readonly secretName: string }
  | { readonly mode: 'managed'; readonly secretName: string };

export interface ApplicationExposureBinding {
  readonly kind: 'applicationExposure';
  readonly name: string;
  readonly provider: 'HttpExposure';
  readonly resourceName: string;
  readonly namespace?: string;
  readonly hostnames: readonly string[];
  readonly tls: 'required' | 'optional' | 'disabled';
  readonly tlsIntent: ApplicationTlsIntent & { readonly secretName?: string };
  readonly dnsIntent: ApplicationDnsIntent;
  readonly publicUrl: string;
  readonly readiness: {
    readonly ingress: 'resourceApplied';
    readonly loadBalancer: 'statusObserved';
    readonly certificate: 'notRequested' | 'external' | 'readyCondition';
    readonly dns: 'notRequested' | 'intentApplied' | 'propagationUnverified';
    readonly publicUrl: 'derived';
  };
  readonly statusPath: string;
}

export interface ApplicationScheduleOptions extends ApplicationJobOptions {
  readonly cron?: string;
  readonly timezone?: string;
  readonly concurrencyPolicy?: 'allow' | 'forbid' | 'replace';
  readonly missedRunPolicy?: 'skip' | 'startLate' | 'failClosed';
  readonly startingDeadlineSeconds?: number;
}

export interface ApplicationJobBinding {
  readonly kind: 'applicationJob';
  readonly name: string;
  readonly resourceName: string;
  readonly diagnosticsConfigMapName: string;
  readonly statusPath: string;
  plan<TStatus extends object>(target: OperationTarget<TStatus>, options?: PlanTargetOptions): Result<NormalizedOperationPlan<TStatus>>;
}

export interface ApplicationServerOptions {
  readonly namespace?: string;
  readonly resourceName?: string;
  readonly serviceName?: string;
  readonly serviceAccountName?: string;
  readonly sourceConfigMapName?: string;
  readonly source?: string;
  readonly sourceFileName?: string;
  readonly image?: string;
  readonly command?: readonly string[];
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly config?: readonly ApplicationConfigBinding[] | Readonly<Record<string, ApplicationConfigBinding>>;
  readonly secrets?: readonly ApplicationSecretBinding[] | Readonly<Record<string, ApplicationSecretBinding>>;
  readonly labels?: Readonly<Record<string, string>>;
  readonly permissions?: readonly ApplicationPermissionRule[];
  readonly volumes?: readonly ApplicationServerVolume[];
  readonly volumeMounts?: readonly ApplicationServerVolumeMount[];
  readonly replicas?: number;
  readonly service?: { readonly port: number };
  /** Maximum accepted request body size. Defaults to 1 MiB. */
  readonly maxRequestBodyBytes?: number;
  /** Fixed-window limit for non-GET requests, keyed by remote address and path. */
  readonly mutationRateLimit?: { readonly maxRequests: number; readonly windowSeconds: number };
  readonly resources?: Readonly<Record<string, AnyResourceDefinition>>;
  readonly indexes?: Readonly<Record<string, ResourceIndex<object, object>>>;
  readonly models?: Readonly<Record<string, ApplicationServerModelBinding>>;
  readonly captures?: Readonly<Record<string, ApplicationServerCaptureValue>>;
  readonly cache?: readonly ResourceIndex<object, object>[];
  readonly indexBackend?: ApplicationIndexBackend;
}

export type ApplicationServerModelBinding = ApplicationRuntimeModelContract | ApplicationModelRuntimeBinding;

export interface ApplicationPermissionRule {
  readonly apiGroups: readonly string[];
  readonly resources: readonly string[];
  readonly verbs: readonly string[];
  readonly resourceNames?: readonly string[];
}

export interface ApplicationServerVolume {
  readonly name: string;
  readonly configMap?: { readonly name: string };
  readonly secret?: { readonly secretName: string };
  readonly emptyDir?: Record<string, never>;
}

export interface ApplicationServerVolumeMount {
  readonly name: string;
  readonly mountPath: string;
  readonly readOnly?: boolean;
}

export interface ApplicationServerBinding {
  readonly name: string;
  readonly resourceName: string;
  readonly serviceName: string;
  readonly namespace?: string;
  readonly url: string;
  readonly routes: readonly ApplicationServerRoute[];
  readonly deployment: Enhanced<ApplicationDeploymentSpecProjection, ApplicationDeploymentStatusProjection>;
  plan<TStatus extends object>(target: OperationTarget<TStatus>, options?: PlanTargetOptions): Result<NormalizedOperationPlan<TStatus>>;
}

export interface ApplicationServerRoute {
  readonly id: string;
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly handlerSource: string;
  readonly handlerSourceKind?: 'source' | 'functionToString';
  readonly handlerSourceLocation?: ApplicationRouteSourceLocation;
}

interface GeneratedApplicationServerRouteModule {
  readonly route: SerializedApplicationServerRouteWithDependencies;
  readonly fileName: string;
  readonly exportName: string;
}

export type ApplicationServerCaptureValue = JsonValue | ApplicationServerCaptureFunction;

export interface ApplicationServerCaptureFunction {
  readonly name: string;
  toString(): string;
}

type SerializedApplicationServerCaptures = Readonly<Record<string, SerializedApplicationServerCapture>>;

type SerializedApplicationServerCapture = SerializedApplicationServerJsonCapture | SerializedApplicationServerFunctionCapture;

interface SerializedApplicationServerJsonCapture {
  readonly kind: 'json';
  readonly value: JsonValue;
}

interface SerializedApplicationServerFunctionCapture {
  readonly kind: 'function';
  readonly source: string;
  readonly aliasName?: string;
}

interface ApplicationRuntimeIndexBackend {
  readonly kind: 'valkey';
  readonly host: string;
  readonly port: number;
}

interface ApplicationServerPermissionInferenceRequest {
  readonly routes: readonly ApplicationServerRoute[];
  readonly resources: Readonly<Record<string, AnyResourceDefinition>>;
  readonly indexes: Readonly<Record<string, ResourceIndex<object, object>>>;
  readonly indexBackend: ApplicationRuntimeIndexBackend | undefined;
  readonly cache: readonly ResourceIndex<object, object>[];
  readonly explicit: readonly ApplicationPermissionRule[];
}

interface ApplicationScopeState extends ApplicationGraphState, ApplicationProviderState, ApplicationWorkflowState {
  readonly resources: Record<string, AnyResourceDefinition>;
  readonly indexes: Record<string, ResourceIndex<object, object>>;
  readonly models: Record<string, ApplicationRuntimeModelContract>;
  readonly emittedModelStores: Set<string>;
  readonly appResource: ApplicationCompositionResourceTarget;
  readonly generatedJobStatusTargets: ApplicationGeneratedJobStatusTarget[];
}

interface ApplicationCompositionResourceTarget extends ApplicationStatusReconcilerAppResourceTarget {}

interface ApplicationContext {
  readonly scope: KubernetesApplicationScope;
  readonly state: ApplicationScopeState;
}

interface ApplicationGeneratedWorkloadBinding {
  readonly deployment: Enhanced<ApplicationDeploymentSpecProjection, ApplicationDeploymentStatusProjection>;
}

interface ApplicationDeploymentSpecProjection {
  readonly replicas: number;
  readonly selector: unknown;
  readonly template: unknown;
}

interface ApplicationDeploymentStatusProjection {
  readonly availableReplicas: number;
}


interface ApplicationRouteModuleBundle {
  readonly source: string;
  readonly inputs: readonly string[];
}

export interface ApplicationServer {
  get(path: string, handler: ApplicationRouteHandler): void;
  post(path: string, handler: ApplicationRouteHandler): void;
}

export type ApplicationRouteHandler = (request: ApplicationRequest) => unknown | Promise<unknown>;

export interface ApplicationRequest {
  readonly params: Readonly<Record<string, string | undefined>>;
  readonly query: Readonly<Record<string, string | undefined>>;
  readonly form: ApplicationFormData;
  formData(): Promise<ApplicationFormData>;
}

export interface ApplicationFormData {
  string(name: string): string;
  enum<TValue extends string>(name: string, values: readonly TValue[]): TValue;
}

export interface ApplicationAggregateOptions<TStats extends object, TEvent extends object> {
  readonly source: ResourceIndex<object, object>;
  readonly target: ApplicationAggregateStatusTarget<TStats>;
  readonly initial: TStats;
  readonly flush?: { readonly every?: string; readonly maxEvents?: number };
  reduce(stats: TStats, event: TEvent): TStats;
}

export interface ApplicationAggregateStatusTarget<TStats extends object> {
  readonly resource: Pick<AnyResourceDefinition, 'apiVersion' | 'kind' | 'plural' | 'scope'>;
  readonly name: string;
  readonly namespace?: string;
  status(stats: TStats): object;
}

export interface ApplicationAggregateBinding<TStats extends object, TEvent extends object> {
  readonly name: string;
  readonly deployment: Enhanced<ApplicationDeploymentSpecProjection, ApplicationDeploymentStatusProjection>;
  readonly options: ApplicationAggregateOptions<TStats, TEvent>;
}

export type KubernetesApplicationCompositionFunction = <TSpec extends KroCompatibleType, TStatus extends KroCompatibleType>(
  definition: TypeKroListenerCompositionDefinition<TSpec, TStatus>,
  compositionFn: (spec: TSpec, app: KubernetesApplicationScope) => MagicAssignableShape<TStatus>,
  options?: SerializationOptions
) => TypeKroListenerComposition<TSpec, TStatus>;

export interface KubernetesApplicationBuilderOptions {
  readonly namespace?: string;
  readonly apiVersion?: string;
  readonly kind?: string;
  readonly spec?: KroCompatibleType;
  readonly status?: KroCompatibleType;
}

export interface KubernetesApplicationBuilder extends KubernetesApplicationScope {
  readonly name: string;
  readonly composition: TypeKroListenerComposition<KroCompatibleType, KroCompatibleType>;
  readonly operatorInstalls: readonly unknown[];
  readonly resources: readonly unknown[];
  resolveOperatorInstalls(options: { readonly manifests: readonly unknown[] }): Result<unknown>;
  factory(name: string): unknown;
}

export interface KubernetesApplicationFunction extends KubernetesApplicationCompositionFunction {
  (name: string, options?: KubernetesApplicationBuilderOptions): KubernetesApplicationBuilder;
}

const applicationGraphByComposition = new WeakMap<object, ApplicationGraph>();
let lastApplicationGraph: ApplicationGraph | undefined;

export function applicationGraphFor(composition: object): ApplicationGraph | undefined {
  const attached = Reflect.get(composition, applicationGraphMetadataProperty);
  return isApplicationGraph(attached) ? attached : applicationGraphByComposition.get(composition);
}

function attachApplicationGraph(composition: object, graph: ApplicationGraph): void {
  applicationGraphByComposition.set(composition, graph);
  Object.defineProperty(composition, applicationGraphMetadataProperty, { value: graph, enumerable: false, configurable: true });
}

function applicationCompositionWrapper<TSpec extends KroCompatibleType, TStatus extends KroCompatibleType>(
  definition: TypeKroListenerCompositionDefinition<TSpec, TStatus>,
  compositionFn: (spec: TSpec, app: KubernetesApplicationScope) => MagicAssignableShape<TStatus>,
  graphName: string
): (spec: TSpec) => MagicAssignableShape<TStatus> {
  const wrapped = (spec: TSpec) => {
    const context = createApplicationContext(definition);
    const result = withApplicationOperatorResourceCollection(context.state, () => compositionFn(spec, context.scope));
    const generatedJobStatusStores = emitApplicationGeneratedJobStatusReconcilers(context.state, { graphResourceId, kubernetesNameSegment, apiGroupForApiVersion });
    lastApplicationGraph = applicationGraphFromState(kubernetesNameSegment(graphName), context.state);
    return applicationStatusWithGeneratedJobProjection(result, generatedJobStatusStores);
  };
  Object.defineProperty(wrapped, 'toString', { value: () => compositionFn.toString() });
  return wrapped;
}

function applicationStatusWithGeneratedJobProjection<TStatus extends KroCompatibleType>(
  status: MagicAssignableShape<TStatus>,
  stores: readonly ApplicationGeneratedJobStatusProjectionStore[]
): MagicAssignableShape<TStatus> {
  if (stores.length === 0) {
    return status;
  }
  const jobs = stores.map(applicationGeneratedJobStatusCel);
  const mergedJobs = jobs.slice(1).reduce(
    (merged, next) => Cel.expr<Readonly<Record<string, unknown>>>('map.merge(', merged, ', ', next, ')'),
    jobs[0]
  );
  // TypeKro derives the nested status schema from this KRO-owned CEL projection.
  // The public TStatus may omit the reserved applik8s namespace, so the
  // framework augments it at the serialization boundary.
  // typecast: add the reserved framework status namespace at the TypeKro serialization boundary.
  return {
    ...status,
    applik8s: { jobs: mergedJobs },
  } as MagicAssignableShape<TStatus>;
}

function applicationGeneratedJobStatusCel(store: ApplicationGeneratedJobStatusProjectionStore): Readonly<Record<string, unknown>> {
  // TypeKro's `$` access forces a CEL reference for the shape-agnostic
  // ConfigMap externalRef instead of reading a local placeholder value.
  const data = Reflect.get(store, '$data');
  const metadata = Reflect.get(store, 'metadata');
  const resourceVersion = Reflect.get(metadata, 'resourceVersion');
  return Cel.expr<Readonly<Record<string, unknown>>>(
    resourceVersion,
    ' != "" && has(',
    data,
    ') && "applik8s-jobs.json" in ',
    data,
    ' ? json.unmarshal(',
    data,
    '["applik8s-jobs.json"]) : {}'
  );
}

export const kubernetesComposition: KubernetesApplicationCompositionFunction = (definition, compositionFn, options) => {
  lastApplicationGraph = undefined;
  const composition = typeKro.kubernetesComposition(
    definition,
    applicationCompositionWrapper(definition, compositionFn, definition.name),
    options
  );
  if (lastApplicationGraph) {
    attachApplicationGraph(composition, lastApplicationGraph);
  }
  return composition;
};

// typecast: this implementation intentionally presents the overloaded app(name, options) and app(definition, callback, options) public surface.
export const app = ((definitionOrName: TypeKroListenerCompositionDefinition<KroCompatibleType, KroCompatibleType> | string, compositionOrOptions?: ((spec: KroCompatibleType, app: KubernetesApplicationScope) => MagicAssignableShape<KroCompatibleType>) | KubernetesApplicationBuilderOptions, options?: SerializationOptions) => {
  if (typeof definitionOrName === 'string') {
    // typecast: the public app overload selects builder options when the first argument is the app name.
    return createKubernetesApplicationBuilder(definitionOrName, compositionOrOptions as KubernetesApplicationBuilderOptions | undefined);
  }
  // typecast: the public app overload selects the composition callback when the first argument is a TypeKro definition.
  return kubernetesComposition(definitionOrName, compositionOrOptions as (spec: KroCompatibleType, app: KubernetesApplicationScope) => MagicAssignableShape<KroCompatibleType>, options);
}) as KubernetesApplicationFunction;

export const sdk = Object.assign({}, baseSdk, { app, kubernetesComposition });

type ApplicationBuilderReplay = (scope: KubernetesApplicationScope) => void;

function createKubernetesApplicationBuilder(name: string, options: KubernetesApplicationBuilderOptions = {}): KubernetesApplicationBuilder {
  const definition = applicationBuilderDefinition(name, options);
  const preview = createApplicationContext(definition).scope;
  const replays: ApplicationBuilderReplay[] = [];
  const declaredResources: Record<string, AnyResourceDefinition> = {};
  const declaredModels: Record<string, ApplicationModelBinding<object, object>> = {};
  let materialized: TypeKroListenerComposition<KroCompatibleType, KroCompatibleType> | undefined;

  if (options.namespace) {
    const eventLog = { ...defaultApplicationEventLogProvider, namespace: options.namespace };
    preview.defaults({ eventLog });
    replays.push((scope) => {
      scope.defaults({ eventLog });
    });
  }

  const invalidate = () => {
    materialized = undefined;
  };
  const materialize = () => {
    if (!materialized) {
      materialized = kubernetesComposition(definition, (_spec, scope) => {
        for (const replay of replays) {
          replay(scope);
        }
        // typecast: builder-style apps synthesize the minimal TypeKro status object required by the generated composition definition.
        return { ready: true } as MagicAssignableShape<KroCompatibleType>;
      });
      const graph = applicationGraphFor(materialized);
      if (graph && options.namespace) {
        attachApplicationGraph(materialized, normalizeApplicationGraph({ ...graph, metadata: { ...graph.metadata, namespace: options.namespace } }));
      }
    }
    return materialized;
  };
  const withDefaultNamespace = <TOptions extends { readonly namespace?: string }>(value: TOptions | undefined): TOptions => {
    if (!options.namespace || value?.namespace) {
      // typecast: empty option objects are valid for every namespace-bearing app option shape used by this helper.
      return (value ?? {}) as TOptions;
    }
    // typecast: TOptions is constrained to optional namespace and is preserved while filling the builder default namespace.
    return { ...(value ?? {}), namespace: options.namespace } as TOptions;
  };
  const storage: ApplicationStorageRegistrar = {
    postgres(storeName, storeOptions = {}) {
      const normalizedOptions = withDefaultNamespace(storeOptions);
      const binding = preview.storage.postgres(storeName, normalizedOptions);
      replays.push((scope) => {
        scope.storage.postgres(storeName, normalizedOptions);
      });
      invalidate();
      return binding;
    },
  };
  // typecast: the implementation records one runtime branch for both app.http(name, configure) and app.http(name, options, configure) overloads.
  const http = ((serverName: string, optionsOrConfigure: ApplicationServerOptions | ((server: ApplicationServer) => void), maybeConfigure?: (server: ApplicationServer) => void) => {
    const explicitOptions = typeof optionsOrConfigure === 'function' ? {} : optionsOrConfigure;
    const serverOptions = applicationBuilderServerOptions(withDefaultNamespace<ApplicationServerOptions>(explicitOptions), declaredResources, declaredModels);
    const configure = typeof optionsOrConfigure === 'function' ? optionsOrConfigure : maybeConfigure;
    if (!configure) {
      throw new Error(`app.http(${JSON.stringify(serverName)}, ...) requires a route configuration callback.`);
    }
    const binding = preview.http(serverName, serverOptions, configure);
    replays.push((scope) => {
      scope.http(serverName, serverOptions, configure);
    });
    invalidate();
    return binding;
  }) as ApplicationServerRegistrar & Record<string, ApplicationServerBinding>;
  const builder = {
    name,
    get composition() {
      return materialize();
    },
    get operatorInstalls() {
      // typecast: TypeKro listener compositions expose richer install records; the builder public surface intentionally projects operatorName only.
      return materialize().operatorInstalls as readonly { readonly operatorName: string }[];
    },
    get resources() {
      // typecast: builder.resources is an inspection surface over generated Kubernetes/TypeKro resource objects with heterogeneous shapes.
      return materialize().resources as readonly unknown[];
    },
    resolveOperatorInstalls(resolveOptions: { readonly manifests: readonly unknown[] }) {
      // typecast: builder forwards opaque manifest input to the underlying TypeKro composition resolver while preserving the public Result shape.
      return materialize().resolveOperatorInstalls(resolveOptions as never) as Result<unknown>;
    },
    factory(factoryName: string) {
      // typecast: builder.factory forwards dynamic factory names to TypeKro and returns an intentionally opaque inspection/deployment factory.
      return materialize().factory(factoryName as never) as unknown;
    },
    api: http,
    http,
    server: http,
    storage,
    operator<TBinding>(operator: (operatorOptions: OperatorDeploymentOptions) => TBinding, operatorOptions: OperatorDeploymentOptions): TBinding {
      const normalizedOptions = withDefaultNamespace(operatorOptions);
      const binding = preview.operator(operator, normalizedOptions);
      replays.push((scope) => {
        scope.operator(operator, normalizedOptions);
      });
      invalidate();
      return binding;
    },
    resource<TSpec extends object, TStatus extends object = Record<string, never>>(resourceName: string, resourceOptions: ApplicationResourceOptions<TSpec, TStatus>): ResourceDefinition<TSpec, TStatus> {
      const resource = preview.resource(resourceName, resourceOptions);
      // typecast: declaredResources stores heterogeneous CRD definitions for later inferred app.http bindings.
      declaredResources[resourceName] = resource as unknown as AnyResourceDefinition;
      replays.push((scope) => {
        scope.resource(resourceName, resourceOptions);
      });
      invalidate();
      return resource;
    },
    crd<TSpec extends object, TStatus extends object = Record<string, never>>(entity: EntityDefinition<TSpec, TStatus>, crdOptions: ApplicationCrdOptions<TSpec, TStatus>): ResourceDefinition<TSpec, TStatus> {
      const resource = preview.crd(entity, crdOptions);
      // typecast: declaredResources stores heterogeneous entity-backed CRD definitions for later inferred app.http bindings.
      declaredResources[entity.name] = resource as unknown as AnyResourceDefinition;
      replays.push((scope) => {
        scope.crd(entity, crdOptions);
      });
      invalidate();
      return resource;
    },
    model<TSpec extends object, TStatus extends object = Record<string, never>>(entityOrName: EntityDefinition<TSpec, TStatus> | string, modelOptions?: ApplicationModelOptions<TSpec, TStatus> | ApplicationNamedModelOptions<TSpec, TStatus>): ApplicationModelBinding<TSpec, TStatus> {
      const previewModel = typeof entityOrName === 'string'
        // typecast: named golden-path models require ApplicationNamedModelOptions and are guarded by the string branch.
        ? preview.model(entityOrName, modelOptions as ApplicationNamedModelOptions<TSpec, TStatus>)
        // typecast: entity-backed models accept ApplicationModelOptions and are guarded by the non-string branch.
        : preview.model(entityOrName, modelOptions as ApplicationModelOptions<TSpec, TStatus> | undefined);
      const commandReplays: ((model: ApplicationModelBinding<TSpec, TStatus>) => void)[] = [];
      const model: ApplicationModelBinding<TSpec, TStatus> = {
        ...previewModel,
        on: {
          ...previewModel.on,
          command(command, commandOptions, handler) {
            const binding = previewModel.on.command(command, commandOptions, handler);
            commandReplays.push((replayedModel) => {
              replayedModel.on.command(command, commandOptions, handler);
            });
            invalidate();
            return binding;
          },
        },
      };
      // typecast: declaredModels stores heterogeneous model bindings for later inferred app.http bindings.
      declaredModels[model.name] = model as unknown as ApplicationModelBinding<object, object>;
      replays.push((scope) => {
        const replayedModel = typeof entityOrName === 'string'
          // typecast: replay preserves the named-model overload chosen above.
          ? scope.model(entityOrName, modelOptions as ApplicationNamedModelOptions<TSpec, TStatus>)
          // typecast: replay preserves the entity-model overload chosen above.
          : scope.model(entityOrName, modelOptions as ApplicationModelOptions<TSpec, TStatus> | undefined);
        for (const replayCommand of commandReplays) {
          replayCommand(replayedModel);
        }
      });
      invalidate();
      return model;
    },
    reconcile<TSpec extends object, TStatus extends object = Record<string, never>>(resource: ResourceDefinition<TSpec, TStatus>, handler: ApplicationReconcileHandler<TSpec, TStatus>, reconcileOptions: ApplicationReconcileOptions = {}): unknown {
      const normalizedOptions = withDefaultNamespace(reconcileOptions);
      const binding = preview.reconcile(resource, handler, normalizedOptions);
      replays.push((scope) => {
        scope.reconcile(resource, handler, normalizedOptions);
      });
      invalidate();
      return binding;
    },
    infra<TResource extends object>(resource: TResource): TResource {
      const binding = preview.infra(resource);
      replays.push((scope) => {
        scope.infra(resource);
      });
      invalidate();
      return binding;
    },
    config(configName: string, configOptions: ApplicationConfigOptions): ApplicationConfigBinding {
      const normalizedOptions = withDefaultNamespace(configOptions);
      const binding = preview.config(configName, normalizedOptions);
      replays.push((scope) => {
        scope.config(configName, normalizedOptions);
      });
      invalidate();
      return binding;
    },
    secret(secretName: string, secretOptions: ApplicationSecretOptions): ApplicationSecretBinding {
      const normalizedOptions = withDefaultNamespace(secretOptions);
      const binding = preview.secret(secretName, normalizedOptions);
      replays.push((scope) => {
        scope.secret(secretName, normalizedOptions);
      });
      invalidate();
      return binding;
    },
    expose(exposureName: string, exposureOptions: ApplicationExposureOptions): ApplicationExposureBinding {
      const normalizedOptions = withDefaultNamespace(exposureOptions);
      const binding = preview.expose(exposureName, normalizedOptions);
      replays.push((scope) => {
        scope.expose(exposureName, normalizedOptions);
      });
      invalidate();
      return binding;
    },
    job(jobName: string, jobOptions?: ApplicationJobOptions): ApplicationJobBinding {
      const normalizedOptions = withDefaultNamespace(jobOptions);
      const binding = preview.job(jobName, normalizedOptions);
      replays.push((scope) => {
        scope.job(jobName, normalizedOptions);
      });
      invalidate();
      return binding;
    },
    schedule(scheduleName: string, scheduleOptions?: ApplicationScheduleOptions): ApplicationJobBinding {
      const normalizedOptions = withDefaultNamespace(scheduleOptions);
      const binding = preview.schedule(scheduleName, normalizedOptions);
      replays.push((scope) => {
        scope.schedule(scheduleName, normalizedOptions);
      });
      invalidate();
      return binding;
    },
    defaults(defaults: ApplicationDefaults): ApplicationDefaultsBinding {
      const binding = preview.defaults(defaults);
      replays.push((scope) => {
        scope.defaults(defaults);
      });
      invalidate();
      return binding;
    },
    provide<TImplementation>(token: ApplicationProviderToken<TImplementation>, implementation: TImplementation): ApplicationProviderBinding<TImplementation> {
      const binding = preview.provide(token, implementation);
      replays.push((scope) => {
        scope.provide(token, implementation);
      });
      invalidate();
      return binding;
    },
    aggregate<TStats extends object, TEvent extends object>(aggregateName: string, aggregateOptions: ApplicationAggregateOptions<TStats, TEvent>): ApplicationAggregateBinding<TStats, TEvent> {
      const binding = preview.aggregate(aggregateName, aggregateOptions);
      replays.push((scope) => {
        scope.aggregate(aggregateName, aggregateOptions);
      });
      invalidate();
      return binding;
    },
    task<TInput extends object, TOutput extends object>(definition: TaskDefinition<TInput, TOutput>, taskOptions: ApplicationTaskOptions<TInput>, handler: ApplicationTaskHandler<TInput, TOutput>): ApplicationTaskBinding<TInput, TOutput> {
      const binding = preview.task(definition, taskOptions, handler);
      replays.push((scope) => {
        scope.task(definition, taskOptions, handler);
      });
      invalidate();
      return binding;
    },
    workflow<TInput extends object, TOutput extends object>(definition: WorkflowDefinition<TInput, TOutput>, workflowOptions: ApplicationWorkflowOptions, handler: ApplicationWorkflowHandler<TInput, TOutput>): ApplicationWorkflowBinding<TInput, TOutput> {
      const binding = preview.workflow(definition, workflowOptions, handler);
      replays.push((scope) => {
        scope.workflow(definition, workflowOptions, handler);
      });
      invalidate();
      return binding;
    },
  } satisfies KubernetesApplicationBuilder;
  Object.defineProperty(builder, applicationGraphMetadataProperty, { get: () => applicationGraphFor(materialize()), enumerable: false, configurable: false });
  return builder;
}

function applicationBuilderDefinition(name: string, options: KubernetesApplicationBuilderOptions): TypeKroListenerCompositionDefinition<KroCompatibleType, KroCompatibleType> {
  // typecast: TypeKro's generic definition type is broader than the app builder's schema defaults, but the emitted shape satisfies the runtime contract.
  return {
    name,
    apiVersion: options.apiVersion ?? `${kubernetesNameSegment(name)}.applik8s.dev/v1alpha1`,
    kind: options.kind ?? pascalCase(name),
    spec: options.spec ?? arkType({}),
    status: options.status ?? arkType({ ready: 'boolean' }),
  } as unknown as TypeKroListenerCompositionDefinition<KroCompatibleType, KroCompatibleType>;
}

function applicationBuilderServerOptions(options: ApplicationServerOptions, resources: Readonly<Record<string, AnyResourceDefinition>>, models: Readonly<Record<string, ApplicationModelBinding<object, object>>>): ApplicationServerOptions {
  return {
    ...options,
    ...(options.resources ? {} : { resources }),
    ...(options.models ? {} : { models }),
  };
}

function createApplicationContext<TSpec extends KroCompatibleType, TStatus extends KroCompatibleType>(definition: TypeKroListenerCompositionDefinition<TSpec, TStatus>): ApplicationContext {
  const servers: Record<string, ApplicationServerBinding> = {};
  const state: ApplicationScopeState = {
    resources: {}, indexes: {}, models: {}, emittedModelStores: new Set(), appResource: applicationCompositionResourceTarget(definition), generatedJobStatusTargets: [],
    defaults: {
      indexes: defaultApplicationProviders.IndexStore,
      models: defaultApplicationProviders.ModelStore,
      counters: defaultApplicationProviders.CounterStore,
      events: defaultApplicationProviders.EventSource,
      eventLogs: defaultApplicationEventLogProvider,
      secrets: defaultApplicationProviders.Secret,
      queues: defaultApplicationProviders.Queue,
      objects: defaultApplicationProviders.ObjectStorage,
      expose: defaultApplicationProviders.HttpExposure,
      credentials: defaultApplicationProviders.CredentialStore,
    },
    providers: {}, graphNodes: [], graphEdges: [], providerRequirements: [], providerBindings: [], workflowHandlers: new Map(), workflowHandlerGroups: new Map(),
  };
  for (const [providerInterface, implementation] of Object.entries(defaultApplicationProviders)) {
    recordApplicationProviderGraph(state, providerInterface, 'frameworkDefault', implementation);
  }
  const server = (name: string, optionsOrConfigure: ApplicationServerOptions | ((server: ApplicationServer) => void), maybeConfigure?: (server: ApplicationServer) => void) => {
    const options = typeof optionsOrConfigure === 'function' ? {} : optionsOrConfigure;
    const configure = typeof optionsOrConfigure === 'function' ? optionsOrConfigure : maybeConfigure;
    if (!configure) {
      throw new Error(`app.http(${JSON.stringify(name)}, ...) requires a route configuration callback.`);
    }
    const routes: ApplicationServerRoute[] = [];
    configure(createRouteRecorder(routes));
    const resolvedOptions = applicationServerOptionsWithScope(state, options, routes);
    recordApplicationServerGraph(state, name, resolvedOptions, routes);
    const workload = emitApplicationServerResources(name, resolvedOptions, routes);
    const binding = applicationServerBinding(name, resolvedOptions, routes, workload);
    servers[name] = binding;
    Object.defineProperty(server, name, { value: binding, enumerable: true, configurable: true });
    collectApplicationIndexes(state, resolvedOptions.indexes ?? {});
    return binding;
  };
  const defaults = (defaults: ApplicationDefaults): ApplicationDefaultsBinding => {
    if ('models' in defaults) {
      const modelStore = applicationModelStoreImplementation(defaults.models);
      if (!modelStore) {
        throw new Error('app.defaults({ models: ... }) currently supports only the typed Postgres ModelStore provider declaration. Use app.storage.postgres("name"), { kind: "postgres", ... }, or app.provide(ModelStore, { kind: "postgres", ... }) until additional ModelStore providers are implemented.');
      }
      state.defaults.models = defaults.models;
      recordApplicationProviderGraph(state, 'ModelStore', 'default', modelStore);
    }
    if ('counters' in defaults) {
      state.defaults.counters = defaults.counters;
      recordApplicationProviderGraph(state, 'CounterStore', 'default', defaults.counters);
    }
    if ('events' in defaults) {
      state.defaults.events = defaults.events;
      recordApplicationProviderGraph(state, 'EventSource', 'default', defaults.events);
    }
    if ('eventLog' in defaults) {
      state.defaults.eventLogs = defaults.eventLog;
      recordApplicationProviderGraph(state, 'EventLog', 'default', defaults.eventLog);
    }
    if ('secrets' in defaults) {
      state.defaults.secrets = defaults.secrets;
      recordApplicationProviderGraph(state, 'Secret', 'default', defaults.secrets);
    }
    if ('queues' in defaults) {
      state.defaults.queues = defaults.queues;
      recordApplicationProviderGraph(state, 'Queue', 'default', defaults.queues);
    }
    if ('objects' in defaults) {
      state.defaults.objects = defaults.objects;
      recordApplicationProviderGraph(state, 'ObjectStorage', 'default', defaults.objects);
    }
    if ('credentials' in defaults) {
      state.defaults.credentials = defaults.credentials;
      recordApplicationProviderGraph(state, 'CredentialStore', 'default', defaults.credentials);
    }
    if ('expose' in defaults) {
      const exposureProvider = applicationHttpExposureImplementation(defaults.expose);
      if (!exposureProvider) {
        throw new Error('app.defaults({ expose: ... }) currently supports only the Ingress HttpExposure provider slice. Use "ingress" or { kind: "ingress", ... } until Gateway/provider-specific exposure adapters are implemented.');
      }
      state.defaults.expose = defaults.expose;
      recordApplicationProviderGraph(state, 'HttpExposure', 'default', exposureProvider);
    }
    if ('certificates' in defaults) {
      const certificateProvider = applicationCertificateImplementation(defaults.certificates);
      if (!certificateProvider) {
        throw new Error('app.defaults({ certificates: ... }) requires a cert-manager provider with an explicit Issuer or ClusterIssuer reference.');
      }
      state.defaults.certificates = defaults.certificates;
      recordApplicationProviderGraph(state, 'Certificate', 'default', certificateProvider);
    }
    if ('dns' in defaults) {
      const dnsProvider = applicationDnsPublicationImplementation(defaults.dns);
      if (!dnsProvider) {
        throw new Error('app.defaults({ dns: ... }) requires an external-dns publication provider.');
      }
      state.defaults.dns = defaults.dns;
      recordApplicationProviderGraph(state, 'DnsPublication', 'default', dnsProvider);
    }
    if ('indexes' in defaults) {
      state.defaults.indexes = defaults.indexes;
      recordApplicationProviderGraph(state, 'IndexStore', 'default', defaults.indexes);
    }
    return { kind: 'applicationDefaults', defaults };
  };
  const provide = <TImplementation>(token: ApplicationProviderToken<TImplementation>, implementation: TImplementation): ApplicationProviderBinding<TImplementation> => {
    applyApplicationProvider(state, token, implementation);
    recordApplicationProviderGraph(state, applicationProviderTokenName(token), 'provided', implementation, token.contract);
    return { kind: 'applicationProvider', token, implementation };
  };
  const storage: ApplicationStorageRegistrar = {
    postgres(name, options = {}) {
      const provider = ModelStore.postgres(applicationStoragePostgresOptions(name, options));
      return defaults({ models: provider });
    },
  };
  const resource = <TSpec extends object, TStatus extends object = Record<string, never>>(name: string, options: ApplicationResourceOptions<TSpec, TStatus>): ResourceDefinition<TSpec, TStatus> => {
    const definitionResource = baseSdk.crd({
      ...options,
      apiVersion: options.apiVersion ?? applicationDefinitionApiVersion(definition),
      kind: options.kind ?? name,
    });
    collectApplicationResources(state, { [name]: definitionResource });
    recordApplicationCrdGraph(state, name, definitionResource);
    return definitionResource;
  };
  const crd = <TSpec extends object, TStatus extends object = Record<string, never>>(entity: EntityDefinition<TSpec, TStatus>, options: ApplicationCrdOptions<TSpec, TStatus>): ResourceDefinition<TSpec, TStatus> => {
    const definitionResource = baseSdk.crd({
      ...options,
      kind: options.kind ?? entity.name,
      spec: entity.spec,
      ...(entity.status ? { status: entity.status } : {}),
    });
    collectApplicationResources(state, { [entity.name]: definitionResource });
    recordApplicationCrdGraph(state, entity.name, definitionResource);
    return definitionResource;
  };
  const reconcile = <TSpec extends object, TStatus extends object = Record<string, never>>(resource: ResourceDefinition<TSpec, TStatus>, handler: ApplicationReconcileHandler<TSpec, TStatus>, options: ApplicationReconcileOptions = {}): unknown => {
    const { name, permissions, ...deploymentOptions } = options;
    const registration = resource.on.reconcile(handler);
    const operator = baseSdk.operator({
      name: name ?? `${kubernetesNameSegment(resource.kind)}-controller`,
      resources: { [resource.kind]: resource },
      handlers: [registration],
      ...(permissions && permissions.length > 0 ? { permissions } : {}),
      ...(Object.keys(deploymentOptions).length > 0 ? { deployment: deploymentOptions } : {}),
    });
    collectApplicationResources(state, applicationOperatorResources(operator));
    recordApplicationOperatorGraph(state, operator);
    return operator(deploymentOptions);
  };
  const scope: KubernetesApplicationScope = {
    // typecast: app.api is the application-context name for the same generated HTTP workload registrar as app.server.
    api: server as ApplicationServerRegistrar & Record<string, ApplicationServerBinding>,
    // typecast: app.http is the v0.3 golden-path name for the same generated HTTP workload registrar as app.server.
    http: server as ApplicationServerRegistrar & Record<string, ApplicationServerBinding>,
    // typecast: the callable server registrar also exposes named server bindings such as app.server.web after registration.
    server: server as ApplicationServerRegistrar & Record<string, ApplicationServerBinding>,
    storage,
    operator(operator, options) {
      collectApplicationResources(state, applicationOperatorResources(operator));
      recordApplicationOperatorGraph(state, operator);
      return operator(options);
    },
    resource,
    crd,
    model(entityOrName, options) {
      const { entity, modelOptions } = applicationModelInput(entityOrName, options);
      const modelStore = resolveApplicationModelStore(state, entity.name, modelOptions?.store);
      const runtimeModel = applicationRuntimeModelContract(entity, modelStore, modelOptions);
      emitApplicationModelStoreResources(state, runtimeModel, modelStore);
      recordApplicationModelGraph(state, entity, modelStore, modelOptions, runtimeModel);
      state.models[runtimeModel.name] = runtimeModel;
      return applicationModelBindingWithCommandGraph(state, entity, modelStore, modelOptions, runtimeModel);
    },
    reconcile,
    infra(resource) {
      recordApplicationTypeKroResourceGraph(state, resource);
      return resource;
    },
    config(name, options) {
      return emitApplicationConfig(state, name, options);
    },
    secret(name, options) {
      return emitApplicationSecret(state, name, options);
    },
    expose(name, options) {
      return emitApplicationExposure(state, name, options);
    },
    job(name, options) {
      return emitApplicationGeneratedJob(state, name, options ?? {}, undefined);
    },
    schedule(name, options) {
      return emitApplicationGeneratedJob(state, name, options ?? {}, options?.cron ?? '* * * * *');
    },
    defaults,
    provide,
    aggregate(name, options) {
      collectApplicationIndexes(state, { [options.source.name]: options.source });
      recordApplicationAggregateGraph(state, name, options);
      const workload = emitApplicationAggregateResources(name, options);
      return applicationAggregateBinding(name, options, workload);
    },
    task(definition, options, handler) {
      return registerApplicationTask(state, definition, options, handler);
    },
    workflow(definition, options, handler) {
      return registerApplicationWorkflow(state, definition, options, handler);
    },
  };
  return { scope, state };
}

function applicationModelBindingWithCommandGraph<TSpec extends object, TStatus extends object>(
  state: ApplicationScopeState,
  entity: EntityDefinition<TSpec, TStatus>,
  modelStore: ApplicationModelStoreProvider,
  modelOptions: ApplicationModelOptions<TSpec, TStatus> | undefined,
  runtimeModel: ApplicationRuntimeModelContract,
): ApplicationModelBinding<TSpec, TStatus> {
  let binding: ApplicationModelBinding<TSpec, TStatus>;
  binding = applicationModelBinding(
    entity,
    modelStore,
    modelOptions,
    runtimeModel,
    (command, commandOptions, handler) => recordApplicationModelCommandGraph(state, binding, command, commandOptions, handler),
  );
  return binding;
}

function applicationStoragePostgresOptions(name: string, options: ApplicationStoragePostgresOptions): ApplicationPostgresModelStoreOptions {
  const { migrations, ...rest } = options;
  const normalizedMigrations = applicationStoragePostgresMigrations(migrations);
  return {
    ...rest,
    name,
    ...(normalizedMigrations ? { migrations: normalizedMigrations } : {}),
  };
}

function applicationDefinitionApiVersion(definition: { readonly apiVersion?: string }): string {
  if (!definition.apiVersion) {
    throw new Error('app.resource(...) requires apiVersion when the enclosing app definition does not declare one.');
  }
  return definition.apiVersion;
}

function applicationStoragePostgresMigrations(migrations: ApplicationStoragePostgresOptions['migrations']): ApplicationPostgresModelStoreOptions['migrations'] | undefined {
  if (migrations === undefined) {
    return undefined;
  }
  if (migrations === 'generated-job' || migrations === 'generatedJob') {
    return ModelStore.migrations.generatedJob();
  }
  if (typeof migrations === 'string') {
    throw new Error(`app.storage.postgres(..., { migrations: ${JSON.stringify(migrations)} }) is not supported. Use "generated-job" or ModelStore.migrations.generatedJob(...) for the v0.3 generated migration job path.`);
  }
  return migrations;
}

function applicationModelInput<TSpec extends object, TStatus extends object>(entityOrName: EntityDefinition<TSpec, TStatus> | string, options: ApplicationModelOptions<TSpec, TStatus> | ApplicationNamedModelOptions<TSpec, TStatus> | undefined): { readonly entity: EntityDefinition<TSpec, TStatus>; readonly modelOptions: ApplicationModelOptions<TSpec, TStatus> | undefined } {
  if (typeof entityOrName !== 'string') {
    // typecast: non-string app.model input is the entity overload, so options are plain model options.
    return { entity: entityOrName, modelOptions: options as ApplicationModelOptions<TSpec, TStatus> | undefined };
  }
  if (!options || !('spec' in options)) {
    throw new Error(`app.model(${JSON.stringify(entityOrName)}, ...) requires a spec schema when using the golden-path named model form.`);
  }
  // typecast: string app.model input is validated above to include the named-model spec schema.
  const namedOptions = options as ApplicationNamedModelOptions<TSpec, TStatus>;
  const entity: EntityDefinition<TSpec, TStatus> = {
    kind: 'applik8sEntity',
    name: entityOrName,
    spec: namedOptions.spec,
    ...(namedOptions.status ? { status: namedOptions.status } : {}),
  };
  return { entity, modelOptions: applicationNamedModelOptions(namedOptions) };
}

function applicationNamedModelOptions<TSpec extends object, TStatus extends object>(options: ApplicationNamedModelOptions<TSpec, TStatus>): ApplicationModelOptions<TSpec, TStatus> {
  const { spec: _spec, status: _status, indexes, schema, ...rest } = options;
  const schemaIndexes = applicationNamedModelSchemaIndexes(indexes);
  if (schemaIndexes.length === 0) {
    return { ...rest, ...(schema ? { schema } : {}) };
  }
  return {
    ...rest,
    schema: {
      ...schema,
      indexes: [...(schema?.indexes ?? []), ...schemaIndexes],
    },
  };
}

function applicationNamedModelSchemaIndexes<TSpec extends object, TStatus extends object>(indexes: ApplicationNamedModelOptions<TSpec, TStatus>['indexes']): ApplicationModelSchemaIndexOptions<TSpec, TStatus>[] {
  if (!indexes) {
    return [];
  }
  return Object.entries(indexes).map(([name, declaration]) => {
    if (isNamedModelIndexFieldList<TSpec, TStatus>(declaration)) {
      const [partitionBy, ...orderBy] = declaration;
      if (!partitionBy) {
        throw new Error(`app.model(..., { indexes: { ${name}: [...] } }) requires at least one field.`);
      }
      return { name, partitionBy, ...(orderBy.length > 0 ? { orderBy } : {}) };
    }
    const fields = declaration.fields ?? [];
    const partitionBy = declaration.partitionBy ?? fields[0];
    if (!partitionBy) {
      throw new Error(`app.model(..., { indexes: { ${name}: ... } }) requires partitionBy or at least one field.`);
    }
    const orderBy = declaration.orderBy ?? fields.slice(1);
    return {
      name,
      partitionBy,
      ...(declaration.filter ? { filter: declaration.filter } : {}),
      ...(orderBy.length > 0 ? { orderBy } : {}),
      ...(declaration.unique !== undefined ? { unique: declaration.unique } : {}),
    };
  });
}

function isNamedModelIndexFieldList<TSpec extends object, TStatus extends object>(declaration: NonNullable<ApplicationNamedModelOptions<TSpec, TStatus>['indexes']>[string]): declaration is readonly string[] {
  return Array.isArray(declaration);
}

function withApplicationOperatorResourceCollection<T>(state: ApplicationScopeState, fn: () => T): T {
  const restore = setOperatorDeploymentInterceptor((definition, _deployment, next) => {
    // typecast: app-scoped server inference only needs erased resource metadata, not capability-specific handler clients.
    collectApplicationResources(state, definition.resources as unknown as Readonly<Record<string, AnyResourceDefinition>>);
    return next();
  });
  try {
    return fn();
  } finally {
    restore();
  }
}

function applicationServerOptionsWithScope(state: ApplicationScopeState, options: ApplicationServerOptions, routes: readonly ApplicationServerRoute[]): ApplicationServerOptions {
  const routeAnalyses = routes.map((route) => analyzeApplicationServerRouteSource(route.handlerSource));
  const inferredResources = inferredApplicationServerResources(state.resources, routeAnalyses);
  const cacheIndexes = options.cache ?? [];
  const inferredIndexes = {
    ...inferredApplicationServerIndexes(state.indexes, routeAnalyses),
    ...inferredApplicationServerIndexesFromCache(cacheIndexes, routeAnalyses, state.indexes, options.indexes ?? {}),
  };
  const inferredModels = inferredApplicationServerModels(state.models, routeAnalyses);
  const resources = { ...inferredResources, ...(options.resources ?? {}) };
  const indexes = { ...inferredIndexes, ...(options.indexes ?? {}) };
  const models = { ...inferredModels, ...applicationServerRuntimeModels(options.models ?? {}) };
  const indexBackend = options.indexBackend ?? defaultApplicationIndexBackend(state, options, indexes);
  const cache = options.cache ?? (indexBackend && isValkeyIndexDefault(defaultApplicationIndexProvider(state)) ? Object.values(indexes) : undefined);
  return {
    ...options,
    ...(Object.keys(resources).length > 0 ? { resources } : {}),
    ...(Object.keys(indexes).length > 0 ? { indexes } : {}),
    ...(Object.keys(models).length > 0 ? { models } : {}),
    ...(cache && cache.length > 0 ? { cache } : {}),
    ...(indexBackend ? { indexBackend } : {}),
  };
}

function applicationServerRuntimeModels(models: Readonly<Record<string, ApplicationServerModelBinding>>): Readonly<Record<string, ApplicationRuntimeModelContract>> {
  return Object.fromEntries(Object.entries(models).map(([name, model]) => [name, applicationServerRuntimeModel(model)]));
}

function applicationServerRuntimeModel(model: ApplicationServerModelBinding): ApplicationRuntimeModelContract {
  if ('provider' in model) {
    return model;
  }
  return model.runtime;
}

function inferredApplicationServerResources(resources: Readonly<Record<string, AnyResourceDefinition>>, analyses: readonly ApplicationServerRouteSourceAnalysis[]): Readonly<Record<string, AnyResourceDefinition>> {
  return Object.fromEntries(Object.entries(resources).filter(([name]) => analyses.some((analysis) => analysis.freeIdentifiers.includes(name) || analysis.memberCalls.some((call) => call.objectName === name))));
}

function inferredApplicationServerIndexes(indexes: Readonly<Record<string, ResourceIndex<object, object>>>, analyses: readonly ApplicationServerRouteSourceAnalysis[]): Readonly<Record<string, ResourceIndex<object, object>>> {
  return Object.fromEntries(Object.entries(indexes).filter(([name]) => analyses.some((analysis) => analysis.freeIdentifiers.includes(name) || routeAnalysisCallsMethod(analysis, name, 'query'))));
}

function inferredApplicationServerModels(models: Readonly<Record<string, ApplicationRuntimeModelContract>>, analyses: readonly ApplicationServerRouteSourceAnalysis[]): Readonly<Record<string, ApplicationRuntimeModelContract>> {
  return Object.fromEntries(Object.entries(models).filter(([name]) => analyses.some((analysis) => analysis.freeIdentifiers.includes(name) || ['create', 'get', 'query', 'patch', 'delete', 'index'].some((method) => routeAnalysisCallsMethod(analysis, name, method)))));
}

function inferredApplicationServerIndexesFromCache(
  cache: readonly ResourceIndex<object, object>[],
  analyses: readonly ApplicationServerRouteSourceAnalysis[],
  scopedIndexes: Readonly<Record<string, ResourceIndex<object, object>>>,
  explicitIndexes: Readonly<Record<string, ResourceIndex<object, object>>>
): Readonly<Record<string, ResourceIndex<object, object>>> {
  const existingNames = new Set([...Object.keys(scopedIndexes), ...Object.keys(explicitIndexes)]);
  const queryNames = unique(analyses.flatMap((analysis) => analysis.memberCalls.filter((call) => call.methodName === 'query').map((call) => call.objectName))).filter((name) => !existingNames.has(name));
  if (cache.length === 1 && queryNames.length === 1) {
    const [index] = cache;
    const [name] = queryNames;
    return index && name ? { [name]: index } : {};
  }
  const inferred: Record<string, ResourceIndex<object, object>> = {};
  for (const name of queryNames) {
    const match = cache.find((index) => index.name === name);
    if (match) {
      inferred[name] = match;
    }
  }
  return inferred;
}

function collectApplicationResources(state: ApplicationScopeState, resources: Readonly<Record<string, AnyResourceDefinition>>): void {
  for (const [name, resource] of Object.entries(resources)) {
    state.resources[name] = resource;
    recordApplicationCrdGraph(state, name, resource);
  }
}

function collectApplicationIndexes(state: ApplicationScopeState, indexes: Readonly<Record<string, ResourceIndex<object, object>>>): void {
  for (const [name, index] of Object.entries(indexes)) {
    state.indexes[name] = index;
    recordApplicationIndexGraph(state, name, index);
  }
}

function recordApplicationCrdGraph(state: ApplicationScopeState, name: string, resource: Pick<AnyResourceDefinition, 'apiVersion' | 'kind' | 'plural' | 'scope'>): void {
  addApplicationGraphNode(state, {
    id: applicationGraphNodeId('crd', name),
    kind: 'crd',
    name,
    stability: 'stable',
    materialization: 'kubernetes-crd',
    resource: applicationResourceContract(resource),
  });
}

function emitApplicationConfig(state: ApplicationScopeState, name: string, options: ApplicationConfigOptions): ApplicationConfigBinding {
  const resourceName = options.configMapName ?? `${kubernetesNameSegment(name)}-config`;
  const key = options.key ?? kubernetesNameSegment(name);
  const namespace = options.namespace;
  const nodeId = applicationGraphNodeId('config', name);
  const resource = { apiVersion: 'v1', kind: 'ConfigMap', name: resourceName, ...(namespace ? { namespace } : {}) };
  typeKroConfigMap({
    id: graphResourceId(resourceName, 'applicationConfig'),
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: resourceName, ...(namespace ? { namespace } : {}), labels: applicationConfigLabels(name, 'config') },
    data: { [key]: options.value ?? '' },
  });
  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'config',
    name,
    stability: 'stable',
    provider: 'ConfigMap',
    key,
    ...(options.env ? { env: options.env } : {}),
    ...(options.mountPath ? { mountPath: options.mountPath } : {}),
    generatedResources: [{ role: 'config', graphNode: { nodeId }, resource, artifact: { kind: 'kubernetesManifest', name: resourceName } }],
  });
  return { kind: 'applicationConfig', name, provider: 'ConfigMap', resourceName, ...(namespace ? { namespace } : {}), key, ...(options.env ? { env: options.env } : {}), ...(options.mountPath ? { mountPath: options.mountPath } : {}), diagnosticsPath: `config/${name}` };
}

function emitApplicationSecret(state: ApplicationScopeState, name: string, options: ApplicationSecretOptions): ApplicationSecretBinding {
  const resourceName = options.secretName ?? `${kubernetesNameSegment(name)}-secret`;
  const key = options.key ?? kubernetesNameSegment(name);
  const namespace = options.namespace;
  const redaction = options.redaction ?? 'required';
  const ownership = options.ownership ?? (options.secretName ? 'external' : 'generated');
  const nodeId = applicationGraphNodeId('secret', name);
  const resource = { apiVersion: 'v1', kind: 'Secret', name: resourceName, ...(namespace ? { namespace } : {}) };
  if (ownership === 'generated') {
    typeKroSecret({
      id: graphResourceId(resourceName, 'applicationSecret'),
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name: resourceName, ...(namespace ? { namespace } : {}), labels: applicationConfigLabels(name, 'secret') },
      type: 'Opaque',
    });
  }
  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'secret',
    name,
    stability: 'stable',
    provider: 'Secret',
    ownership,
    key,
    redaction,
    ...(options.env ? { env: options.env } : {}),
    ...(options.mountPath ? { mountPath: options.mountPath } : {}),
    generatedResources: ownership === 'generated'
      ? [{ role: 'secret', graphNode: { nodeId }, resource, artifact: { kind: 'kubernetesManifest', name: resourceName } }]
      : [],
  });
  return { kind: 'applicationSecret', name, provider: 'Secret', resourceName, ...(namespace ? { namespace } : {}), key, ownership, redaction, ...(options.env ? { env: options.env } : {}), ...(options.mountPath ? { mountPath: options.mountPath } : {}), diagnosticsPath: `secret/${name}` };
}

function emitApplicationExposure(state: ApplicationScopeState, name: string, options: ApplicationExposureOptions): ApplicationExposureBinding {
  const provider = applicationHttpExposureImplementation(state.providers.expose) ?? applicationHttpExposureImplementation(state.defaults.expose) ?? { kind: 'ingress' } satisfies ApplicationHttpExposureProvider;
  if (options.gateway) {
    throw new Error(`app.expose(${JSON.stringify(name)}, ...) Gateway API exposure is not enabled yet. Use Ingress-backed exposure with service and hostnames, or keep Gateway semantics explicit until v0.3 Gateway contracts are implemented.`);
  }
  if (!isIngressHttpExposureProvider(provider)) {
    throw new Error(`app.expose(${JSON.stringify(name)}, ...) requires the Ingress HttpExposure provider slice. Unsupported exposure providers fail closed until their generated adapters are implemented.`);
  }
  const exposedService = applicationExposureServiceName(options.service);
  const exposedNamespace = applicationExposureServiceNamespace(options.service) ?? options.namespace;
  if (!exposedService) {
    throw new Error(`app.expose(${JSON.stringify(name)}, ...) requires an explicit service name for the v0.3 Ingress exposure slice.`);
  }
  if (!options.hostnames || options.hostnames.length === 0) {
    throw new Error(`app.expose(${JSON.stringify(name)}, ...) requires at least one hostname so generated Ingress exposure does not broaden traffic accidentally.`);
  }
  const resourceName = `${kubernetesNameSegment(name)}-ingress`;
  const namespace = exposedNamespace;
  const hostnames = [...options.hostnames];
  const nodeId = applicationGraphNodeId('exposure', name);
  const resource = { apiVersion: 'networking.k8s.io/v1', kind: 'Ingress', name: resourceName, ...(namespace ? { namespace } : {}) };
  const tlsIntent = normalizeApplicationTlsIntent(name, options);
  const dnsIntent = options.dns ?? { mode: 'disabled' };
  const certificateProvider = tlsIntent.mode === 'managed'
    ? applicationCertificateImplementation(state.providers.certificates) ?? applicationCertificateImplementation(state.defaults.certificates)
    : undefined;
  const dnsProvider = dnsIntent.mode === 'managed'
    ? applicationDnsPublicationImplementation(state.providers.dns) ?? applicationDnsPublicationImplementation(state.defaults.dns)
    : undefined;
  if (tlsIntent.mode === 'managed' && !certificateProvider) {
    throw new Error(`app.expose(${JSON.stringify(name)}, ...) with tls: { mode: "managed" } requires a Certificate provider. Bind Certificate.certManager({ issuerRef: ... }) before declaring public exposure.`);
  }
  if (dnsIntent.mode === 'managed' && !dnsProvider) {
    throw new Error(`app.expose(${JSON.stringify(name)}, ...) with dns: { mode: "managed" } requires a DnsPublication provider. Bind DnsPublication.externalDns() before declaring public exposure.`);
  }
  if (!state.graphNodes.some((node) => node.id === applicationProviderNodeId('HttpExposure'))) {
    recordApplicationProviderGraph(state, 'HttpExposure', 'generated', provider);
  }
  if (certificateProvider && !state.graphNodes.some((node) => node.id === applicationProviderNodeId('Certificate'))) {
    recordApplicationProviderGraph(state, 'Certificate', 'provided', certificateProvider);
  }
  if (dnsProvider && !state.graphNodes.some((node) => node.id === applicationProviderNodeId('DnsPublication'))) {
    recordApplicationProviderGraph(state, 'DnsPublication', 'provided', dnsProvider);
  }
  const providerIngressClassName = typeof provider === 'object' ? provider.ingressClassName : undefined;
  const ingressClassName = options.ingressClassName ?? providerIngressClassName;
  const externalDnsAnnotations = dnsProvider
    ? applicationExternalDnsAnnotations(dnsProvider, hostnames, dnsIntent)
    : {};
  const annotations = {
    ...(ingressClassName ? { 'kubernetes.io/ingress.class': ingressClassName } : {}),
    ...externalDnsAnnotations,
  };
  typeKroIngress({
    id: graphResourceId(resourceName, 'applicationExposure'),
    apiVersion: 'networking.k8s.io/v1',
    kind: 'Ingress',
    metadata: { name: resourceName, ...(namespace ? { namespace } : {}), labels: applicationConfigLabels(name, 'exposure'), ...(Object.keys(annotations).length > 0 ? { annotations } : {}) },
    spec: {
      ...(ingressClassName ? { ingressClassName } : {}),
      rules: hostnames.map((host) => ({
        host,
        http: { paths: [{ path: options.path ?? '/', pathType: 'Prefix', backend: { service: { name: exposedService, port: { number: options.servicePort ?? 80 } } } }] },
      })),
      ...(tlsIntent.mode !== 'disabled' ? { tls: [{ hosts: hostnames, secretName: tlsIntent.secretName }] } : {}),
    },
  });
  const generatedResources: ApplicationGeneratedResourceContract[] = [
    { role: 'exposure', graphNode: { nodeId }, resource, artifact: { kind: 'kubernetesManifest', name: resourceName } },
  ];
  if (tlsIntent.mode === 'managed' && certificateProvider) {
    const certificateName = `${kubernetesNameSegment(name)}-certificate`;
    const certificateResource = { apiVersion: 'cert-manager.io/v1', kind: 'Certificate', name: certificateName, ...(namespace ? { namespace } : {}) };
    typeKroCertificate({
      id: graphResourceId(certificateName, 'applicationCertificate'),
      name: certificateName,
      ...(namespace ? { namespace } : {}),
      spec: {
        secretName: tlsIntent.secretName,
        dnsNames: hostnames,
        issuerRef: certificateProvider.issuerRef,
        ...(certificateProvider.duration ? { duration: certificateProvider.duration } : {}),
        ...(certificateProvider.renewBefore ? { renewBefore: certificateProvider.renewBefore } : {}),
      },
    });
    generatedResources.push({ role: 'exposure', graphNode: { nodeId }, resource: certificateResource, artifact: { kind: 'typeKroResource', name: certificateName }, dependsOn: [{ nodeId: applicationProviderNodeId('Certificate') }] });
  }
  const tls = applicationLegacyTlsMode(options.tls, tlsIntent);
  const publicUrl = `${tlsIntent.mode === 'disabled' ? 'http' : 'https'}://${hostnames[0]}`;
  const readiness: ApplicationExposureReadinessContract = {
    ingress: 'resourceApplied',
    loadBalancer: 'statusObserved',
    certificate: tlsIntent.mode === 'managed' ? 'readyCondition' : tlsIntent.mode === 'external' ? 'external' : 'notRequested',
    dns: dnsIntent.mode === 'managed' ? 'propagationUnverified' : 'notRequested',
    publicUrl: 'derived',
  };
  const graphTlsIntent = (() => {
    if (tlsIntent.mode !== 'managed') return tlsIntent;
    if (!certificateProvider) throw new Error(`app.expose(${JSON.stringify(name)}, ...) lost its managed Certificate provider during graph lowering.`);
    return { ...tlsIntent, issuerRef: certificateProvider.issuerRef };
  })();
  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'exposure',
    name,
    stability: 'stable',
    provider: { interface: 'HttpExposure', nodeId: applicationGraphNodeId('provider', 'HttpExposure') },
    service: exposedService,
    hostnames,
    tls,
    tlsIntent: graphTlsIntent,
    dnsIntent,
    publicUrl,
    readiness,
    ...(certificateProvider ? { certificate: { interface: 'Certificate', nodeId: applicationProviderNodeId('Certificate') } } : {}),
    ...(dnsProvider ? { dnsPublication: { interface: 'DnsPublication', nodeId: applicationProviderNodeId('DnsPublication') } } : {}),
    generatedResources,
  });
  addApplicationGraphEdge(state, { from: { nodeId: applicationProviderNodeId('HttpExposure') }, to: { nodeId }, relationship: 'provides' });
  if (certificateProvider) addApplicationGraphEdge(state, { from: { nodeId: applicationProviderNodeId('Certificate') }, to: { nodeId }, relationship: 'provides' });
  if (dnsProvider) addApplicationGraphEdge(state, { from: { nodeId: applicationProviderNodeId('DnsPublication') }, to: { nodeId }, relationship: 'provides' });
  return { kind: 'applicationExposure', name, provider: 'HttpExposure', resourceName, ...(namespace ? { namespace } : {}), hostnames, tls, tlsIntent, dnsIntent, publicUrl, readiness, statusPath: `exposure/${name}` };
}

function normalizeApplicationTlsIntent(name: string, options: ApplicationExposureOptions): NormalizedApplicationTlsIntent {
  if (options.tls && typeof options.tls === 'object') {
    if (options.tls.mode === 'managed') return { mode: 'managed', secretName: options.tls.secretName ?? options.tlsSecretName ?? `${kubernetesNameSegment(name)}-tls` };
    if (options.tls.mode === 'external') return options.tls;
    return { mode: 'disabled' };
  }
  if (options.tls === 'required' && !options.tlsSecretName) {
    throw new Error(`app.expose(${JSON.stringify(name)}, ...) with tls: "required" requires tlsSecretName so generated Ingress TLS Secret ownership stays explicit.`);
  }
  if (options.tlsSecretName) return { mode: 'external', secretName: options.tlsSecretName };
  return { mode: 'disabled' };
}

function applicationLegacyTlsMode(tls: ApplicationExposureOptions['tls'], intent: ApplicationTlsIntent): 'required' | 'optional' | 'disabled' {
  if (typeof tls === 'string') return tls;
  return intent.mode === 'disabled' ? 'disabled' : 'required';
}

function applicationExternalDnsAnnotations(provider: ApplicationDnsPublicationProvider, hostnames: readonly string[], intent: ApplicationDnsIntent): Readonly<Record<string, string>> {
  if (intent.mode !== 'managed') return {};
  const prefix = provider.annotationPrefix ?? 'external-dns.alpha.kubernetes.io';
  return {
    [`${prefix}/hostname`]: hostnames.join(','),
    ...(intent.ttlSeconds === undefined ? {} : { [`${prefix}/ttl`]: String(intent.ttlSeconds) }),
  };
}

function applicationExposureServiceName(service: string | ApplicationServerBinding | undefined): string | undefined {
  return typeof service === 'string' ? service : service?.serviceName;
}

function applicationExposureServiceNamespace(service: string | ApplicationServerBinding | undefined): string | undefined {
  return typeof service === 'string' ? undefined : service?.namespace;
}

function applicationConfigLabels(name: string, component: 'config' | 'secret' | 'exposure'): Readonly<Record<string, string>> {
  return {
    'app.kubernetes.io/name': kubernetesNameSegment(name),
    'app.kubernetes.io/component': component,
    'app.kubernetes.io/managed-by': 'applik8s',
  };
}

function recordApplicationOperatorGraph(state: ApplicationScopeState, operator: unknown): void {
  const definition = operator && typeof operator === 'function' ? Reflect.get(operator, 'definition') : undefined;
  const reflectedName = definition && typeof definition === 'object' ? Reflect.get(definition, 'name') : undefined;
  const name = typeof reflectedName === 'string' ? reflectedName : 'operator';
  const resources = applicationOperatorResources(operator);
  const watchContracts = applicationOperatorWatchScopeContracts(name, operator);
  const nodeId = applicationGraphNodeId('operator', name);
  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'operator',
    name,
    stability: 'experimental',
    resources: Object.values(resources).map((resource) => applicationResourceRef(resource)),
    watches: watchContracts.map((contract) => contract.scope),
    ...(watchContracts.length > 0 ? { watchContracts } : {}),
  });
  const explicitPermissions = definition && typeof definition === 'object' ? Reflect.get(definition, 'permissions') : undefined;
  if (Array.isArray(explicitPermissions) && explicitPermissions.length > 0) {
    const permissionNodeId = applicationGraphNodeId('permission', `${name}-permissions`);
    // typecast: sdk.operator has already validated the structural PermissionRule array stored on its definition.
    const rules = explicitPermissions as readonly PermissionRule[];
    addApplicationGraphNode(state, {
      id: permissionNodeId,
      kind: 'permission',
      name: `${name}-permissions`,
      stability: 'experimental',
      owner: { nodeId },
      mode: 'explicit',
      rules: rules.map((rule) => ({
        apiGroups: [...rule.apiGroups],
        resources: [...rule.resources],
        verbs: [...rule.verbs],
        ...(rule.resourceNames ? { resourceNames: [...rule.resourceNames] } : {}),
      })),
    });
    addApplicationGraphEdge(state, { from: { nodeId: permissionNodeId }, to: { nodeId }, relationship: 'writes' });
  }
  for (const [resourceName] of Object.entries(resources)) {
    addApplicationGraphEdge(state, { from: { nodeId }, to: { nodeId: applicationGraphNodeId('crd', resourceName) }, relationship: 'owns' });
  }
}

function applicationOperatorWatchScopeContracts(operatorName: string, operator: unknown): readonly ApplicationWatchScopeLoweringContract[] {
  return applicationOperatorHandlers(operator).filter((handler) => Boolean(handler.watch)).map((handler) => applicationWatchScopeLoweringContract(operatorName, handler));
}

function applicationWatchScopeLoweringContract(operatorName: string, handler: HandlerRegistration<object, object>): ApplicationWatchScopeLoweringContract {
  const resource = handler.resource;
  const watch = handler.watch;
  const subject = applicationResourceRef(resource);
  if (!watch) {
    return applicationFailClosedWatchScopeContract({ kind: 'mixed', scopes: [] }, subject, 'MissingWatchScope', `Operator ${operatorName} handler ${handler.id} did not declare a watch scope.`);
  }
  const diagnostics = applicationWatchScopeDiagnostics(operatorName, handler, watch, subject);
  const scope = applicationWatchScopeForHandler(handler, watch, diagnostics.length > 0);
  return {
    scope,
    lowering: applicationWatchScopeLowering(scope),
    runtime: { mode: scope.kind === 'finite' || scope.kind === 'exact' ? 'directWatch' : 'sharedInformer', resyncPolicy: scope.kind === 'exact' ? 'none' : 'bounded', cancellation: 'onScopeRemoved' },
    permissions: diagnostics.length > 0 ? [] : applicationWatchScopePermissions(handler),
    failurePolicy: 'failClosed',
    diagnostics,
  };
}

function applicationWatchScopeForHandler(handler: HandlerRegistration<object, object>, watch: ResourceWatchAddress, hasDiagnostics: boolean): ApplicationWatchScope {
  const resource = handler.resource;
  if (hasDiagnostics) {
    return { kind: 'mixed', scopes: [] };
  }
  if (watch.names && watch.names.length > 0) {
    return { kind: 'finite', refs: watch.names.map((name) => ({ apiVersion: resource.apiVersion, kind: resource.kind, name, ...(watch.namespace ? { namespace: watch.namespace } : {}) })) };
  }
  if (watch.name) {
    return { kind: 'exact', ref: { apiVersion: resource.apiVersion, kind: resource.kind, name: watch.name, ...(watch.namespace ? { namespace: watch.namespace } : {}) } };
  }
  if (watch.fieldSelector) {
    return { kind: 'fieldSelector', apiVersion: resource.apiVersion, resourceKind: resource.kind, ...(watch.namespace ? { namespace: watch.namespace } : {}), fieldSelector: watch.fieldSelector };
  }
  const labels = watch.labelSelector?.matchLabels;
  if (labels && Object.keys(labels).length > 0) {
    return { kind: 'labelSelector', apiVersion: resource.apiVersion, resourceKind: resource.kind, ...(watch.namespace ? { namespace: watch.namespace } : {}), labels };
  }
  return { kind: 'mixed', scopes: [] };
}

function applicationWatchScopeDiagnostics(operatorName: string, handler: HandlerRegistration<object, object>, watch: ResourceWatchAddress, subject: ReturnType<typeof applicationResourceRef>): readonly ApplicationDiagnosticContract[] {
  const diagnostics: ApplicationDiagnosticContract[] = [];
  if (watch.labelSelector?.matchExpressions && watch.labelSelector.matchExpressions.length > 0) {
    diagnostics.push(applicationWatchScopeDiagnostic(subject, 'UnsupportedLabelSelectorExpression', `Operator ${operatorName} handler ${handler.id} uses label selector expressions, which are not lowered into v0.3 watch scopes yet.`));
  }
  if (watch.labelSelector && !watch.labelSelector.matchLabels && !watch.labelSelector.matchExpressions) {
    diagnostics.push(applicationWatchScopeDiagnostic(subject, 'EmptyLabelSelector', `Operator ${operatorName} handler ${handler.id} uses an empty label selector.`));
  }
  if (watch.names && watch.names.length === 0) {
    diagnostics.push(applicationWatchScopeDiagnostic(subject, 'EmptyFiniteWatchScope', `Operator ${operatorName} handler ${handler.id} uses an empty finite watch scope.`));
  }
  if (watch.fieldSelector !== undefined && watch.fieldSelector.trim() === '') {
    diagnostics.push(applicationWatchScopeDiagnostic(subject, 'EmptyFieldSelector', `Operator ${operatorName} handler ${handler.id} uses an empty field selector.`));
  }
  return diagnostics;
}

function applicationFailClosedWatchScopeContract(scope: ApplicationWatchScope, subject: ReturnType<typeof applicationResourceRef>, reason: string, message: string): ApplicationWatchScopeLoweringContract {
  return { scope, lowering: applicationWatchScopeLowering(scope), permissions: [], failurePolicy: 'failClosed', diagnostics: [applicationWatchScopeDiagnostic(subject, reason, message)] };
}

function applicationWatchScopeDiagnostic(subject: ReturnType<typeof applicationResourceRef>, reason: string, message: string): ApplicationDiagnosticContract {
  return { event: 'applik8s-watch-scope-unlowerable', severity: 'error', subject, reason, message, likelyFix: 'Use exact names, finite instances, matchLabels, or a non-empty fieldSelector for v0.3 watch scopes.', retryable: false };
}

function applicationWatchScopePermissions(handler: HandlerRegistration<object, object>): readonly PermissionRule[] {
  if (handler.permissions && handler.permissions.length > 0) {
    return handler.permissions;
  }
  return [{ apiGroups: [apiGroupForApiVersion(handler.resource.apiVersion)], resources: [handler.resource.plural], verbs: ['get', 'list', 'watch'] }];
}

function applicationWatchScopeLowering(scope: ApplicationWatchScope): ApplicationWatchScopeLoweringContract['lowering'] {
  return scope.kind === 'labelSelector' ? 'labelSelector' : scope.kind === 'fieldSelector' ? 'fieldSelector' : scope.kind;
}

function recordApplicationProviderGraph(state: ApplicationScopeState, tokenName: string | undefined, bindingKind: string, implementation: unknown, typedContract?: ApplicationTypedProviderContract): void {
  const resolvedContract = typedContract ?? applicationTypedProviderContract(tokenName);
  const providerInterface = applicationProviderInterface(tokenName) ?? resolvedContract?.interface;
  if (!providerInterface) {
    return;
  }
  const nodeId = applicationProviderNodeId(providerInterface);
  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'provider',
    name: providerInterface,
    stability: 'stable',
    interface: providerInterface,
    implementation: applicationProviderImplementationName(implementation),
    ...(resolvedContract ? {
      contract: {
        ...resolvedContract,
        surface: !applicationProviderInterface(providerInterface) ? 'experimentalSurface' : 'stablePublicApi',
        support: 'implemented',
        implementation: { name: applicationProviderImplementationName(implementation) },
        diagnostics: [],
      },
    } : {}),
    config: { bindingKind, provider: applicationProviderImplementationName(implementation) },
  });
}

function recordApplicationTypeKroResourceGraph(state: ApplicationScopeState, resource: unknown): void {
  const ref = applicationTypeKroResourceRef(resource);
  if (!ref) {
    throw new Error('app.infra(...) requires a TypeKro/Kubernetes resource with apiVersion, kind, and metadata.name. Create infrastructure with an existing @applik8s/applik8s/factories helper before passing it to app.infra(...).');
  }
  addApplicationGraphNode(state, {
    id: applicationGraphNodeId('typeKroResource', ref.name ?? ref.kind),
    kind: 'typeKroResource',
    name: ref.name ?? ref.kind,
    stability: 'experimental',
    resource: ref,
  });
}

function applicationTypeKroResourceRef(resource: unknown): { readonly apiVersion: string; readonly kind: string; readonly name?: string; readonly namespace?: string } | undefined {
  if (!resource || typeof resource !== 'object') {
    return undefined;
  }
  const apiVersion = Reflect.get(resource, 'apiVersion');
  const kind = Reflect.get(resource, 'kind');
  const metadata = Reflect.get(resource, 'metadata');
  const name = metadata && typeof metadata === 'object' ? Reflect.get(metadata, 'name') : undefined;
  const namespace = metadata && typeof metadata === 'object' ? Reflect.get(metadata, 'namespace') : undefined;
  if (typeof apiVersion !== 'string' || typeof kind !== 'string' || typeof name !== 'string') {
    return undefined;
  }
  return { apiVersion, kind, name, ...(typeof namespace === 'string' ? { namespace } : {}) };
}

function recordApplicationServerGraph(state: ApplicationScopeState, name: string, options: ApplicationServerOptions, routes: readonly ApplicationServerRoute[]): void {
  const nodeId = applicationGraphNodeId('server', name);
  const resourceName = options.resourceName ?? name;
  const serviceName = options.serviceName ?? resourceName;
  const serviceAccountName = options.serviceAccountName ?? resourceName;
  const sourceConfigMapName = options.sourceConfigMapName ?? `${resourceName}-source`;
  const indexRefs = Object.keys(options.indexes ?? {}).map((indexName) => ({ nodeId: applicationGraphNodeId('index', indexName) }));
  const configRefs = applicationConfigBindings(options.config).map((binding) => ({ nodeId: applicationGraphNodeId('config', binding.name) }));
  const secretRefs = applicationSecretBindings(options.secrets).map((binding) => ({ nodeId: applicationGraphNodeId('secret', binding.name) }));
  for (const [resourceName, resource] of Object.entries(options.resources ?? {})) {
    recordApplicationCrdGraph(state, resourceName, resource);
  }
  const generatedResources: ApplicationGeneratedResourceContract[] = [
    { role: 'workload', graphNode: { nodeId }, resource: { apiVersion: 'apps/v1', kind: 'Deployment', name: resourceName, ...(options.namespace ? { namespace: options.namespace } : {}) }, artifact: { kind: 'kubernetesManifest', name: `${resourceName}.yaml` } },
    { role: 'service', graphNode: { nodeId }, resource: { apiVersion: 'v1', kind: 'Service', name: serviceName, ...(options.namespace ? { namespace: options.namespace } : {}) }, artifact: { kind: 'kubernetesManifest', name: `${serviceName}.yaml` } },
    { role: 'rbac', graphNode: { nodeId }, resource: { apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'Role', name: serviceAccountName, ...(options.namespace ? { namespace: options.namespace } : {}) }, artifact: { kind: 'rbacManifest', name: `${serviceAccountName}.yaml` } },
    { role: 'runtimeBundle', graphNode: { nodeId }, resource: { apiVersion: 'v1', kind: 'ConfigMap', name: sourceConfigMapName, ...(options.namespace ? { namespace: options.namespace } : {}) }, artifact: { kind: 'runtimeBundle', name: sourceConfigMapName } },
    { role: 'routeDiagnostics', graphNode: { nodeId }, resource: { apiVersion: 'v1', kind: 'ConfigMap', name: sourceConfigMapName, ...(options.namespace ? { namespace: options.namespace } : {}) }, artifact: { kind: 'routeDiagnostics', name: sourceConfigMapName } },
    ...applicationConfigBindings(options.config).map<ApplicationGeneratedResourceContract>((binding) => ({ role: 'config', graphNode: { nodeId }, resource: { apiVersion: 'v1', kind: 'ConfigMap', name: binding.resourceName, ...(binding.namespace ? { namespace: binding.namespace } : {}) }, dependsOn: [{ nodeId: applicationGraphNodeId('config', binding.name) }] })),
    ...applicationSecretBindings(options.secrets).map<ApplicationGeneratedResourceContract>((binding) => ({ role: 'secret', graphNode: { nodeId }, resource: { apiVersion: 'v1', kind: 'Secret', name: binding.resourceName, ...(binding.namespace ? { namespace: binding.namespace } : {}) }, dependsOn: [{ nodeId: applicationGraphNodeId('secret', binding.name) }] })),
  ];
  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'server',
    name,
    stability: 'stable',
    routes: routes.map((route) => ({ id: route.id, method: route.method, path: route.path, diagnostics: routeDiagnosticsContract(), ...(route.handlerSourceLocation ? { sourceLocation: route.handlerSourceLocation } : {}) })),
    resources: Object.values(options.resources ?? {}).map((resource) => applicationResourceRef(resource)),
    indexes: indexRefs,
    observability: applicationServerObservability(sourceConfigMapName),
    ...(generatedResources.length > 0 ? { generatedResources } : {}),
  });
  for (const resourceName of Object.keys(options.resources ?? {})) {
    addApplicationGraphEdge(state, { from: { nodeId }, to: { nodeId: applicationGraphNodeId('crd', resourceName) }, relationship: 'dependsOn' });
  }
  for (const [indexName, index] of Object.entries(options.indexes ?? {})) {
    recordApplicationIndexGraph(state, indexName, index);
    addApplicationGraphEdge(state, { from: { nodeId }, to: { nodeId: applicationGraphNodeId('index', indexName) }, relationship: 'reads' });
  }
  for (const ref of configRefs) {
    addApplicationGraphEdge(state, { from: { nodeId }, to: ref, relationship: 'reads' });
  }
  for (const ref of secretRefs) {
    addApplicationGraphEdge(state, { from: { nodeId }, to: ref, relationship: 'reads' });
  }
  recordApplicationCounterGraphs(state, name, options.resources ?? {}, routes);
  const permissions = inferApplicationServerPermissions({ routes, resources: options.resources ?? {}, indexes: options.indexes ?? {}, indexBackend: runtimeIndexBackendConfig(options.indexBackend, options.namespace, options.resourceName ?? name), cache: options.cache ?? [], explicit: options.permissions ?? [] });
  if (permissions.length > 0) {
    const permissionNodeId = applicationGraphNodeId('permission', `${name}-permissions`);
    addApplicationGraphNode(state, { id: permissionNodeId, kind: 'permission', name: `${name}-permissions`, stability: 'experimental', owner: { nodeId }, mode: options.permissions && options.permissions.length > 0 ? 'explicitAndInferred' : 'inferred', rules: permissions });
    addApplicationGraphEdge(state, { from: { nodeId: permissionNodeId }, to: { nodeId }, relationship: 'writes' });
  }
}

function applicationServerObservability(diagnosticsArtifactName: string): ApplicationObservabilityContract {
  return {
    health: { mode: 'http', readinessPath: '/-/healthz', livenessPath: '/-/healthz' },
    logs: { format: 'json', component: 'applik8s-server', failureEvents: ['applik8s-server-route-failure', 'applik8s-server-request-failure'] },
    metrics: { mode: 'declaredHooks', names: ['applik8s_server_requests_total', 'applik8s_server_route_failures_total'] },
    events: ['applik8s-server-route-failure', 'applik8s-server-request-failure'],
    sourceMaps: 'required',
    replayArtifacts: [{ kind: 'routeDiagnostics', name: diagnosticsArtifactName }],
    diagnosticsArtifact: { kind: 'routeDiagnostics', name: diagnosticsArtifactName },
  };
}

function routeDiagnosticsContract() {
  // typecast: preserve literal diagnostic field names for graph contract emission.
  return {
    routeFailureEvent: 'applik8s-server-route-failure',
    actionFailureEvent: 'applik8s-route-action-failure',
    failurePolicy: 'failClosed',
    partialEffects: 'unknownAfterActionStarted',
    sourceMaps: 'required',
    includes: ['routeId', 'method', 'path', 'module', 'sourceLocation', 'bundleInputs', 'action', 'diagnostic', 'stack'],
  } as const;
}

function recordApplicationCounterGraphs(state: ApplicationScopeState, serverName: string, resources: Readonly<Record<string, AnyResourceDefinition>>, routes: readonly ApplicationServerRoute[]): void {
  const analyses = routes.map((route) => analyzeApplicationServerRouteSource(route.handlerSource));
  const serverNodeId = applicationGraphNodeId('server', serverName);
  for (const [resourceName, resource] of Object.entries(resources)) {
    if (!analyses.some((analysis) => routeAnalysisCallsMethod(analysis, resourceName, 'increment'))) {
      continue;
    }
    const nodeId = applicationGraphNodeId('counter', `${serverName}-${resourceName}`);
    addApplicationGraphNode(state, {
      id: nodeId,
      kind: 'counter',
      name: `${serverName}.${resourceName}`,
      stability: 'stable',
      target: applicationResourceRef(resource),
      flush: { everyMs: 1000 },
    });
    addApplicationGraphEdge(state, { from: { nodeId: serverNodeId }, to: { nodeId }, relationship: 'emits' });
    addApplicationGraphEdge(state, { from: { nodeId }, to: { nodeId: applicationGraphNodeId('crd', resourceName) }, relationship: 'writes' });
  }
}

function recordApplicationIndexGraph(state: ApplicationScopeState, name: string, index: ResourceIndex<object, object>): void {
  const providerNodeId = applicationProviderNodeId('IndexStore');
  const nodeId = applicationGraphNodeId('index', name);
  recordApplicationCrdGraph(state, index.resource.kind, index.resource);
  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'index',
    name,
    stability: 'stable',
    source: applicationResourceRef(index.resource),
    provider: { interface: 'IndexStore', nodeId: providerNodeId },
    ...(index.options.partitionBy ? { partitionBy: applicationExpressionContract(index.options.partitionBy) } : {}),
    ...(index.options.filter ? { filter: applicationExpressionContract(index.options.filter) } : {}),
    ...(index.options.orderBy ? { orderBy: applicationExpressionContract(index.options.orderBy) } : {}),
  });
  addApplicationGraphEdge(state, { from: { nodeId: providerNodeId }, to: { nodeId }, relationship: 'provides' });
  addApplicationGraphEdge(state, { from: { nodeId }, to: { nodeId: applicationGraphNodeId('crd', index.resource.kind) }, relationship: 'reads' });
}

function recordApplicationAggregateGraph<TStats extends object, TEvent extends object>(state: ApplicationScopeState, name: string, options: ApplicationAggregateOptions<TStats, TEvent>): void {
  const sourceNodeId = applicationGraphNodeId('index', options.source.name);
  const nodeId = applicationGraphNodeId('aggregate', name);
  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'aggregate',
    name,
    stability: 'stable',
    source: { nodeId: sourceNodeId },
    target: { resource: applicationResourceRef(options.target.resource), statusPath: 'status' },
    flush: { everyMs: parseDurationMs(options.flush?.every ?? '2s'), ...(options.flush?.maxEvents ? { maxEvents: options.flush.maxEvents } : {}) },
  });
  addApplicationGraphEdge(state, { from: { nodeId }, to: { nodeId: sourceNodeId }, relationship: 'reads' });
}

function applicationResourceContract(resource: Pick<AnyResourceDefinition, 'apiVersion' | 'kind' | 'plural' | 'scope'>) {
  return { apiVersion: resource.apiVersion, kind: resource.kind, plural: resource.plural, scope: resource.scope };
}

function applicationResourceRef(resource: Pick<AnyResourceDefinition, 'apiVersion' | 'kind'>): { readonly apiVersion: string; readonly kind: string } {
  return { apiVersion: resource.apiVersion, kind: resource.kind };
}

function applicationExpressionContract(expression: unknown): { readonly kind: 'field' | 'label' | 'literal' | 'ordering' | 'predicate'; readonly source: string } {
  const reflectedKind = expression && typeof expression === 'object' ? Reflect.get(expression, 'expressionKind') : undefined;
  const kind = typeof reflectedKind === 'string' ? reflectedKind : 'literal';
  return { kind: applicationExpressionKind(kind), source: JSON.stringify(expression) };
}

function applicationExpressionKind(kind: string): 'field' | 'label' | 'literal' | 'ordering' | 'predicate' {
  return kind === 'field' || kind === 'label' || kind === 'ordering' || kind === 'predicate' ? kind : 'literal';
}

function applicationProviderNodeId(providerInterface: ApplicationProviderInterfaceKind): string {
  return applicationGraphNodeId('provider', providerInterface);
}

function applicationCompositionResourceTarget<TSpec extends KroCompatibleType, TStatus extends KroCompatibleType>(definition: TypeKroListenerCompositionDefinition<TSpec, TStatus>): ApplicationCompositionResourceTarget {
  const apiVersion = definition.apiVersion ?? (definition.group ? `${definition.group}/v1alpha1` : 'applik8s.dev/v1alpha1');
  return { apiVersion, kind: definition.kind, plural: pluralizeKubernetesKind(definition.kind) };
}

function pluralizeKubernetesKind(kind: string): string {
  const segment = kubernetesNameSegment(kind).replaceAll('-', '');
  if (segment.endsWith('y')) {
    return `${segment.slice(0, -1)}ies`;
  }
  if (segment.endsWith('s')) {
    return `${segment}es`;
  }
  return `${segment}s`;
}

function applicationGraphNodeId(kind: string, name: string): string {
  return `${kind}.${kubernetesNameSegment(name)}`;
}

function applicationOperatorResources(operator: unknown): Readonly<Record<string, AnyResourceDefinition>> {
  const definition = operator && typeof operator === 'function' ? Reflect.get(operator, 'definition') : undefined;
  const resources = definition && typeof definition === 'object' ? Reflect.get(definition, 'resources') : undefined;
  // typecast: app-scoped operator inference reads the SDK operator definition shape without depending on its generic callable type.
  return resources && typeof resources === 'object' ? resources as Readonly<Record<string, AnyResourceDefinition>> : {};
}

function applicationOperatorHandlers(operator: unknown): readonly HandlerRegistration<object, object>[] {
  const definition = operator && typeof operator === 'function' ? Reflect.get(operator, 'definition') : undefined;
  const handlers = definition && typeof definition === 'object' ? Reflect.get(definition, 'handlers') : undefined;
  if (!Array.isArray(handlers)) {
    return [];
  }
  // typecast: app graph extraction only reads handler metadata fields emitted by the SDK operator definition.
  return handlers as readonly HandlerRegistration<object, object>[];
}

function applicationServerBinding(name: string, options: ApplicationServerOptions, routes: readonly ApplicationServerRoute[], workload: ApplicationGeneratedWorkloadBinding): ApplicationServerBinding {
  const resourceName = options.resourceName ?? name;
  const serviceName = options.serviceName ?? resourceName;
  const namespace = options.namespace;
  return {
    name,
    resourceName,
    serviceName,
    ...(namespace ? { namespace } : {}),
    url: `http://${serviceName}.${namespace ?? 'default'}.svc.cluster.local/`,
    routes,
    deployment: workload.deployment,
    plan: applicationBindingPlan,
  };
}

function applicationBindingPlan<TStatus extends object>(target: OperationTarget<TStatus>, options?: PlanTargetOptions): Result<NormalizedOperationPlan<TStatus>> {
  const plan = options?.dryRun ? target.operationTargetArtifacts?.dryRunPlan : target.operationTargetArtifacts?.applyPlan;
  if (!plan) {
    return {
      ok: false,
      error: {
        code: 'LIFECYCLE_UNSAFE',
        message: options?.dryRun
          ? 'Generated application binding cannot plan operation target dry-run because no dryRunPlan artifact was emitted.'
          : 'Generated application binding cannot plan operation target apply because no applyPlan artifact was emitted.',
        severity: 'error',
        context: { operationKind: options?.dryRun ? 'apply' : 'apply' },
        recovery: { summary: options?.dryRun ? 'Regenerate the operation target with a dry-run artifact before calling plan(target, { dryRun: true }).' : 'Regenerate the operation target with an apply artifact before calling plan(target).' },
      },
    };
  }
  return { ok: true, value: { operations: plan.operations.map((operation) => applicationPlannedOperation(operation, options)) } };
}

function applicationPlannedOperation<TStatus extends object>(operation: NormalizedOperationPlan<TStatus>['operations'][number], options: PlanTargetOptions | undefined): NormalizedOperationPlan<TStatus>['operations'][number] {
  if (operation.kind !== 'apply') {
    return operation;
  }
  return {
    ...operation,
    ...(options?.fieldManager ? { fieldManager: options.fieldManager } : {}),
  };
}

function applicationAggregateBinding<TStats extends object, TEvent extends object>(
  name: string,
  options: ApplicationAggregateOptions<TStats, TEvent>,
  workload: ApplicationGeneratedWorkloadBinding
): ApplicationAggregateBinding<TStats, TEvent> {
  return {
    name,
    deployment: workload.deployment,
    options,
  };
}

function emitApplicationGeneratedJob(state: ApplicationScopeState, name: string, options: ApplicationJobOptions | ApplicationScheduleOptions, cron: string | undefined): ApplicationJobBinding {
  const resourceName = kubernetesNameSegment(name);
  const namespace = options.namespace;
  const nodeId = applicationGraphNodeId('job', resourceName);
  const statusPath = `status.applik8s.jobs.${resourceName}`;
  const diagnosticsConfigMapName = `${resourceName}-diagnostics`;
  const statusRuntimeConfigMapName = `${resourceName}-status-runtime`;
  const observability = applicationGeneratedJobObservability(diagnosticsConfigMapName);
  const labels = {
    'app.kubernetes.io/name': resourceName,
    'app.kubernetes.io/component': cron ? 'generated-scheduled-job' : 'generated-job',
    'app.kubernetes.io/managed-by': 'applik8s',
    'applik8s.dev/job': resourceName,
  };
  const missedRunPolicy = isApplicationScheduleOptions(options) ? options.missedRunPolicy : undefined;
  const annotations = missedRunPolicy ? { 'applik8s.dev/missed-run-policy': missedRunPolicy } : undefined;
  const container = applicationGeneratedJobContainer(resourceName, statusPath, options);
  const materialization = cron ? 'kubernetes-cronjob' : 'kubernetes-job';
  const resourceRef = { apiVersion: 'batch/v1', kind: cron ? 'CronJob' : 'Job', name: resourceName, ...(namespace ? { namespace } : {}) };
  const phaseStatusTarget = { resource: { nodeId }, statusPath };
  const permissions = [{ apiGroups: ['batch'], resources: [cron ? 'cronjobs' : 'jobs'], verbs: ['create', 'get', 'list', 'watch', 'patch'] }];
  const phaseStatusContract = applicationGeneratedJobPhaseStatusContract({
    statusResource: { nodeId },
    statusPath,
    statusShape: applicationGeneratedJobDurableStatus({ jobName: resourceName, idempotencyKey: 'metadata.generation' }),
  });
  const statusReconcilerName = applicationStatusReconcilerName(state.appResource, kubernetesNameSegment);
  const statusStoreConfigMapName = `${statusReconcilerName}-status`;
  const terminalFailureStatus = applicationGeneratedJobDurableStatus({
    jobName: resourceName,
    phase: 'Failed',
    idempotencyKey: 'metadata.generation',
    retryCount: applicationGeneratedJobRetry().maxAttempts ?? 0,
    terminalFailure: {
      reason: 'GeneratedJobFailed',
      message: `Generated job ${resourceName} failed. Inspect ${cron ? 'cronjob' : 'job'}/${resourceName} and its pod logs.`,
      failedStep: 'runJob',
      partialEffects: [{ operation: 'runJob', ref: resourceRef, status: 'visible' }],
    },
    conditions: [{ type: 'Failed', status: 'True', reason: 'GeneratedJobFailed', message: `Generated job ${resourceName} reached a terminal failure.`, observedGeneration: 0 }],
  });
  const durableStatusUpdater = applicationGeneratedJobStatusUpdater({
    jobName: resourceName,
    observes: [resourceRef],
    writes: phaseStatusTarget,
    statusShape: phaseStatusContract.statusShape,
    statusConfigMapName: statusStoreConfigMapName,
    ...(namespace ? { statusConfigMapNamespace: namespace } : {}),
  });
  const schedule = cron ? {
    cron,
    ...(isApplicationScheduleOptions(options) && options.timezone ? { timezone: options.timezone } : {}),
    ...(isApplicationScheduleOptions(options) && options.concurrencyPolicy ? { concurrencyPolicy: options.concurrencyPolicy } : {}),
    ...(missedRunPolicy ? { missedRunPolicy } : {}),
    ...(isApplicationScheduleOptions(options) && options.startingDeadlineSeconds !== undefined ? { startingDeadlineSeconds: options.startingDeadlineSeconds } : {}),
  } : undefined;

  if (cron) {
    typeKroCronJob({
      id: graphResourceId(resourceName, 'generatedCronJob'),
      apiVersion: 'batch/v1',
      kind: 'CronJob',
      metadata: { name: resourceName, ...(namespace ? { namespace } : {}), labels, ...(annotations ? { annotations } : {}) },
      spec: {
        schedule: cron,
        ...(isApplicationScheduleOptions(options) && options.timezone ? { timeZone: options.timezone } : {}),
        ...(isApplicationScheduleOptions(options) && options.concurrencyPolicy ? { concurrencyPolicy: kubernetesCronJobConcurrencyPolicy(options.concurrencyPolicy) } : {}),
        ...(isApplicationScheduleOptions(options) && options.startingDeadlineSeconds !== undefined ? { startingDeadlineSeconds: options.startingDeadlineSeconds } : {}),
        jobTemplate: { spec: applicationGeneratedJobSpec(labels, container) },
      },
    });
  } else {
    typeKroJob({
      id: graphResourceId(resourceName, 'generatedJob'),
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: { name: resourceName, ...(namespace ? { namespace } : {}), labels },
      spec: applicationGeneratedJobSpec(labels, container),
    });
  }

  typeKroConfigMap({
    id: graphResourceId(resourceName, 'generatedJobDiagnostics'),
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: diagnosticsConfigMapName, ...(namespace ? { namespace } : {}), labels },
    data: {
      job: resourceName,
      materialization,
      phaseStatusPath: statusPath,
      phaseStatusContract: JSON.stringify(phaseStatusContract, null, 2),
      statusOwnershipContract: JSON.stringify(durableStatusUpdater.statusOwnership, null, 2),
      durableStatusTemplate: JSON.stringify(phaseStatusContract.statusShape, null, 2),
      terminalFailureStatus: JSON.stringify(terminalFailureStatus, null, 2),
      retryPolicy: JSON.stringify(applicationGeneratedJobRetry(), null, 2),
      observabilityContract: JSON.stringify(observability, null, 2),
      failureDiagnostic: JSON.stringify({ event: 'applik8s-job-terminal-failure', severity: 'error', reason: 'GeneratedJobFailed', message: `Generated job ${resourceName} failed. Inspect ${cron ? 'cronjob' : 'job'}/${resourceName} and its pod logs.`, retryable: true }, null, 2),
    },
  });

  typeKroConfigMap({
    id: graphResourceId(resourceName, 'generatedJobStatusRuntime'),
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: statusRuntimeConfigMapName, ...(namespace ? { namespace } : {}), labels },
    data: generatedJobStatusRuntimeBundle([{ jobName: resourceName, jobKind: cron ? 'CronJob' : 'Job', statusPath, materialization }], state.appResource),
  });

  registerApplicationGeneratedJobStatusTarget(state, {
    resourceName,
    namespace,
    statusPath,
    jobKind: cron ? 'CronJob' : 'Job',
    materialization,
  });

  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'job',
    name: resourceName,
    stability: 'stable',
    task: {
      taskKind: options.taskKind ?? 'custom',
      ...(options.image ? { image: options.image } : {}),
      ...(options.command ? { command: options.command } : {}),
      ...(options.args ? { args: options.args } : {}),
    },
    ...(schedule ? { schedule } : {}),
    phase: applicationGeneratedJobPhase(),
    resources: [resourceRef],
    retry: applicationGeneratedJobRetry(),
    observability,
    runtime: applicationGeneratedJobRuntime({
      materialization,
      statusResource: { nodeId },
      statusPath,
      permissions,
      durableStatusUpdater,
      statusLifecycle: applicationGeneratedJobStatusLifecycle({ jobName: resourceName, materialization, statusConfigMapName: statusStoreConfigMapName, ...(namespace ? { statusConfigMapNamespace: namespace } : {}) }),
      metadataLinks: [{ graphNode: { nodeId }, artifact: { kind: 'jobDiagnostics', name: diagnosticsConfigMapName }, purpose: 'jobDiagnostics' }],
    }),
    generatedResources: [
      { role: 'workload', graphNode: { nodeId }, resource: resourceRef, artifact: { kind: 'kubernetesManifest', name: `${resourceName}.yaml` } },
      { role: 'runtimeBundle', graphNode: { nodeId }, resource: { apiVersion: 'v1', kind: 'ConfigMap', name: statusRuntimeConfigMapName, ...(namespace ? { namespace } : {}) }, artifact: { kind: 'runtimeModule', name: statusRuntimeConfigMapName } },
      { role: 'runtimeBundle', graphNode: { nodeId }, resource: { apiVersion: 'apps/v1', kind: 'Deployment', name: statusReconcilerName, ...(namespace ? { namespace } : {}) }, artifact: { kind: 'runtimeModule', name: statusReconcilerName } },
      { role: 'jobDiagnostics', graphNode: { nodeId }, resource: { apiVersion: 'v1', kind: 'ConfigMap', name: diagnosticsConfigMapName, ...(namespace ? { namespace } : {}) }, artifact: { kind: 'jobDiagnostics', name: diagnosticsConfigMapName } },
    ],
  });

  return { kind: 'applicationJob', name, resourceName, diagnosticsConfigMapName, statusPath, plan: applicationBindingPlan };
}

function registerApplicationGeneratedJobStatusTarget(state: ApplicationScopeState, target: ApplicationGeneratedJobStatusTarget): void {
  state.generatedJobStatusTargets.push(target);
}

function applicationGeneratedJobSpec(labels: Readonly<Record<string, string>>, container: ReturnType<typeof applicationGeneratedJobContainer>) {
  return {
    backoffLimit: 3,
    template: {
      metadata: { labels },
      spec: {
        restartPolicy: 'OnFailure',
        containers: [container],
      },
    },
  };
}

function applicationGeneratedJobContainer(resourceName: string, statusPath: string, options: ApplicationJobOptions) {
  return {
    name: 'job',
    image: options.image ?? 'busybox:1.36',
    command: [...(options.command ?? ['sh', '-c'])],
    args: [...(options.args ?? [`echo "applik8s generated job ${resourceName}"`])],
    env: [
      { name: 'APPLIK8S_JOB_NAME', value: resourceName },
      { name: 'APPLIK8S_JOB_STATUS_PATH', value: statusPath },
      ...Object.entries(options.env ?? {}).map(([name, value]) => ({ name, value })),
    ],
  };
}

function isApplicationScheduleOptions(options: ApplicationJobOptions | ApplicationScheduleOptions): options is ApplicationScheduleOptions {
  return 'cron' in options || 'timezone' in options || 'concurrencyPolicy' in options || 'missedRunPolicy' in options || 'startingDeadlineSeconds' in options;
}

function kubernetesCronJobConcurrencyPolicy(policy: 'allow' | 'forbid' | 'replace'): 'Allow' | 'Forbid' | 'Replace' {
  if (policy === 'forbid') {
    return 'Forbid';
  }
  if (policy === 'replace') {
    return 'Replace';
  }
  return 'Allow';
}

function emitApplicationModelStoreResources(state: ApplicationScopeState, model: ApplicationRuntimeModelContract, provider: ApplicationModelStoreProvider): void {
  if (provider.kind !== 'postgres' || provider.provision === false || provider.cluster) {
    return;
  }
  const modelName = model.name;
  const resourceName = kubernetesNameSegment(modelName);
  const clusterName = provider.name ?? `${resourceName}-db`;
  const namespace = provider.namespace;
  const database = provider.database ?? resourceName;
  const secretName = provider.connectionSecret?.name ?? `${clusterName}-app`;
  const secretKey = provider.connectionSecretKey ?? 'uri';
  const modelStoreKey = `${namespace ?? ''}:${clusterName}:${database}:${secretName}:${secretKey}`;
  if (state.emittedModelStores.has(modelStoreKey)) {
    if (provider.migrations?.strategy === 'generatedJob' || provider.migrations?.apply === 'generatedJob') {
      emitApplicationModelMigrationResources(state, model, provider, clusterName, secretName, secretKey, database, namespace, {
        'app.kubernetes.io/name': clusterName,
        'app.kubernetes.io/component': 'model-store',
        'app.kubernetes.io/managed-by': 'applik8s',
        'applik8s.dev/model': resourceName,
      });
    }
    return;
  }
  state.emittedModelStores.add(modelStoreKey);
  const labels = {
    'app.kubernetes.io/name': clusterName,
    'app.kubernetes.io/component': 'model-store',
    'app.kubernetes.io/managed-by': 'applik8s',
    'applik8s.dev/model': resourceName,
  };

  typeKroCnpgCluster({
    id: graphResourceId(resourceName, 'modelStoreCluster'),
    name: clusterName,
    ...(namespace ? { namespace } : {}),
    spec: {
      instances: 1,
      storage: { size: '1Gi' },
      bootstrap: { initdb: { database, owner: 'app' } },
    },
  });

  typeKroRole({
    id: graphResourceId(resourceName, 'modelStoreRole'),
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'Role',
    metadata: { name: `${kubernetesNameSegment(database)}-model-store`, ...(namespace ? { namespace } : {}), labels },
    rules: [
      { apiGroups: [''], resources: ['secrets'], verbs: ['get'], resourceNames: [secretName] },
      { apiGroups: ['postgresql.cnpg.io'], resources: ['clusters'], verbs: ['get', 'list', 'watch'] },
    ],
  });

  if (provider.migrations?.strategy === 'generatedJob' || provider.migrations?.apply === 'generatedJob') {
    emitApplicationModelMigrationResources(state, model, provider, clusterName, secretName, secretKey, database, namespace, labels);
  }
}

function emitApplicationModelMigrationResources(state: ApplicationScopeState, model: ApplicationRuntimeModelContract, provider: ApplicationModelStoreProvider, clusterName: string, secretName: string, secretKey: string, database: string, namespace: string | undefined, labels: Readonly<Record<string, string>>): void {
  const resourceName = kubernetesNameSegment(model.name);
  const jobName = provider.migrations?.jobName ?? `${resourceName}-migration`;
  const statusPath = `status.applik8s.jobs.${jobName}`;
  const migrationConfigMapName = `${jobName}-migration`;
  const statusRuntimeConfigMapName = `${jobName}-status-runtime`;
  const observability = applicationGeneratedJobObservability(`${jobName}-diagnostics`);
  const migrationPlan = applicationModelMigrationPlan(model);
  const migrationPreflightSql = applicationModelMigrationPreflightSql(model);
  const migrationSql = applicationModelMigrationSql(model);
  const migrationJobRef = { apiVersion: 'batch/v1', kind: 'Job', name: jobName, ...(namespace ? { namespace } : {}) };
  const clusterRef = { apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', name: clusterName, ...(namespace ? { namespace } : {}) };
  const phaseStatusContract = applicationGeneratedJobPhaseStatusContract({
    statusResource: clusterRef,
    statusPath,
    statusShape: applicationGeneratedJobDurableStatus({ jobName, idempotencyKey: 'metadata.generation', currentStep: 'provider-readiness' }),
  });
  const migrationStatusUpdater = applicationGeneratedJobStatusUpdater({
    jobName,
    observes: [migrationJobRef],
    writes: { resource: clusterRef, statusPath },
    statusShape: phaseStatusContract.statusShape,
    statusConfigMapName: `${kubernetesNameSegment(state.appResource.kind)}-status-reconciler-status`,
    ...(namespace ? { statusConfigMapNamespace: namespace } : {}),
  });
  const terminalFailureStatus = applicationGeneratedJobDurableStatus({
    jobName,
    phase: 'Failed',
    idempotencyKey: 'metadata.generation',
    currentStep: 'schema-drift',
    retryCount: applicationGeneratedJobRetry().maxAttempts ?? 0,
    terminalFailure: {
      reason: 'GeneratedMigrationFailed',
      message: `Generated migration for model ${model.name} failed. Inspect job/${jobName} logs and the migration SQL ConfigMap.`,
      failedStep: 'schema-drift',
      partialEffects: [
        { operation: 'runMigrationJob', ref: migrationJobRef, status: 'visible' },
        { operation: 'readMigrationSql', ref: { apiVersion: 'v1', kind: 'ConfigMap', name: migrationConfigMapName, ...(namespace ? { namespace } : {}) }, status: 'visible' },
      ],
    },
    conditions: [{ type: 'Failed', status: 'True', reason: 'GeneratedMigrationFailed', message: `Generated migration for model ${model.name} reached a terminal failure.`, observedGeneration: 0 }],
  });
  typeKroConfigMap({
    id: graphResourceId(jobName, 'modelMigrationSql'),
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: migrationConfigMapName, ...(namespace ? { namespace } : {}), labels },
    data: { 'preflight.sql': migrationPreflightSql, 'migration.sql': migrationSql },
  });

  typeKroJob({
    id: graphResourceId(jobName, 'modelMigrationJob'),
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: { name: jobName, ...(namespace ? { namespace } : {}), labels },
    spec: {
      backoffLimit: 3,
      template: {
        metadata: { labels },
        spec: {
          restartPolicy: 'OnFailure',
          containers: [{
            name: 'migration',
            image: 'postgres:16-alpine',
            command: ['sh', '-c', 'echo "applik8s-model-migration preflight $APPLIK8S_MODEL_STORE_MODEL"; for attempt in $(seq 1 60); do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /migrations/preflight.sql && break; echo "applik8s-model-migration preflight retry $attempt"; sleep 5; if [ "$attempt" = "60" ]; then exit 1; fi; done; echo "applik8s-model-migration applying $APPLIK8S_MODEL_STORE_MODEL"; for attempt in $(seq 1 60); do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /migrations/migration.sql && exit 0; echo "applik8s-model-migration retry $attempt"; sleep 5; done; exit 1'],
            env: [
              { name: 'DATABASE_URL', valueFrom: { secretKeyRef: { name: secretName, key: secretKey } } },
              { name: 'DATABASE_URL_SECRET_KEY', value: secretKey },
              { name: 'APPLIK8S_MODEL_STORE_CLUSTER', value: clusterName },
              { name: 'APPLIK8S_MODEL_STORE_DATABASE', value: database },
              { name: 'APPLIK8S_MODEL_STORE_MODEL', value: model.name },
              { name: 'APPLIK8S_MIGRATION_STATUS_PATH', value: statusPath },
            ],
            volumeMounts: [{ name: 'applik8s-model-migration', mountPath: '/migrations', readOnly: true }],
          }],
          volumes: [{ name: 'applik8s-model-migration', configMap: { name: migrationConfigMapName } }],
        },
      },
    },
  });

  typeKroConfigMap({
    id: graphResourceId(jobName, 'modelMigrationDiagnostics'),
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: `${jobName}-diagnostics`, ...(namespace ? { namespace } : {}), labels },
    data: {
      model: resourceName,
      database,
      cluster: clusterName,
      connectionSecret: secretName,
      connectionSecretKey: secretKey,
      phaseStatusResource: `postgresql.cnpg.io/v1/Cluster/${namespace ? `${namespace}/` : ''}${clusterName}`,
      phaseStatusPath: statusPath,
      phaseStatusContract: JSON.stringify(phaseStatusContract, null, 2),
      statusOwnershipContract: JSON.stringify(migrationStatusUpdater.statusOwnership, null, 2),
      durableStatusTemplate: JSON.stringify(phaseStatusContract.statusShape, null, 2),
      terminalFailureStatus: JSON.stringify(terminalFailureStatus, null, 2),
      observabilityContract: JSON.stringify(observability, null, 2),
      semantics: 'generatedIdempotentPostgresMigration',
      migrationConfigMap: migrationConfigMapName,
      migrationPreflightSql,
      migrationSql,
      compatibilityPolicy: JSON.stringify({ mode: 'explicitPlanRequired', destructiveChangePolicy: 'reject', driftPolicy: 'failClosed', dataBackfillPolicy: 'generatedJob', enforcement: { stage: 'preMigration', historyTable: 'applik8s_model_migrations', lock: 'providerNative', failurePolicy: 'failClosed' } }),
      driftPolicy: 'failClosed',
      migrationPlan: JSON.stringify(migrationPlan, null, 2),
      failureModes: JSON.stringify({ missingCredentials: 'blockBeforeSql', providerReadiness: 'preflightSelectOne', lockBehavior: 'providerNativeAdvisoryLock', missingHistoryTable: 'schemaDriftFailClosed', missingHistoryColumn: 'schemaDriftFailClosed', incompatibleHistoryColumn: 'schemaDriftFailClosed', badSql: 'terminalFailureWithJobLogs', incompatibleColumn: 'schemaDriftFailClosed', incompatibleIndex: 'schemaDriftFailClosed', unknownExistingObject: 'schemaDriftFailClosed', destructiveChange: 'rejectWithoutExplicitPlan' }, null, 2),
      driftDiagnostic: JSON.stringify({ event: 'applik8s-model-migration-drift-detected', severity: 'error', reason: 'SchemaDriftDetected', message: `Generated migration for model ${model.name} detected existing database schema drift or incompatible table/index shape. Provide an explicit migration plan or repair the database before retrying.`, retryable: false }, null, 2),
      failureDiagnostic: JSON.stringify({ event: 'applik8s-model-migration-failed', severity: 'error', reason: 'GeneratedMigrationFailed', message: `Generated migration for model ${model.name} failed. Inspect job/${jobName} logs and the migration SQL ConfigMap.`, retryable: true }, null, 2),
    },
  });

  typeKroConfigMap({
    id: graphResourceId(jobName, 'modelMigrationStatusRuntime'),
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: statusRuntimeConfigMapName, ...(namespace ? { namespace } : {}), labels },
    data: generatedJobStatusRuntimeBundle([{ jobName, jobKind: 'Job', statusPath, materialization: 'kubernetes-job' }], state.appResource),
  });

  registerApplicationGeneratedJobStatusTarget(state, {
    resourceName: jobName,
    namespace,
    statusPath,
    jobKind: 'Job',
    materialization: 'kubernetes-job',
  });
}

function emitApplicationServerResources(name: string, options: ApplicationServerOptions, routes: readonly ApplicationServerRoute[]): ApplicationGeneratedWorkloadBinding {
  const resourceName = options.resourceName ?? name;
  const serviceName = options.serviceName ?? resourceName;
  const serviceAccountName = options.serviceAccountName ?? resourceName;
  const sourceConfigMapName = options.sourceConfigMapName ?? `${resourceName}-source`;
  const sourceFileName = options.sourceFileName ?? 'server.mjs';
  const namespace = options.namespace;
  const runtimeIndexBackend = runtimeIndexBackendConfig(options.indexBackend, namespace, resourceName);
  const runtimeModels = applicationServerRuntimeModels(options.models ?? {});
  const captures = serializeApplicationServerCaptures(options.captures ?? {});
  const captureAliases = serializedApplicationServerCaptureAliases(captures);
  assertRuntimeBindingNames({ ...(options.resources ?? {}), ...(options.indexes ?? {}), ...(options.models ?? {}), ...captures, ...captureAliases });
  assertDistinctRuntimeBindingNames({ resources: options.resources ?? {}, indexes: options.indexes ?? {}, models: options.models ?? {}, captures, captureAliases });
  const serializedRoutes = serializeApplicationServerRoutes(
    routes,
    new Set([...Object.keys(options.resources ?? {}), ...Object.keys(options.indexes ?? {}), ...Object.keys(options.models ?? {}), ...Object.keys(captures), ...Object.keys(captureAliases)]),
    new Set([...Object.keys(options.resources ?? {}), ...Object.keys(options.indexes ?? {}), ...Object.keys(options.models ?? {})])
  );
  const rawSourceBundle = options.source
    ? { [sourceFileName]: options.source }
    : options.command
      ? undefined
      : generatedApplicationServerBundle(sourceFileName, serializedRoutes, options.resources ?? {}, options.indexes ?? {}, runtimeModels, captures, runtimeIndexBackend, options.cache ?? []);
  const sourceBundle = rawSourceBundle ? kroSafeJavaScriptSourceBundle(rawSourceBundle) : undefined;
  const mountedSourceBundle = sourceBundle ? mountedConfigMapSourceBundle(sourceBundle) : undefined;
  const serverPermissions = inferApplicationServerPermissions({
    routes,
    resources: options.resources ?? {},
    indexes: options.indexes ?? {},
    indexBackend: runtimeIndexBackend,
    cache: options.cache ?? [],
    explicit: options.permissions ?? [],
  });
  const env = {
    NODE_OPTIONS: '--enable-source-maps',
    APPLIK8S_SERVER_NAMESPACE: namespace ?? 'default',
    APPLIK8S_HTTP_MAX_BODY_BYTES: String(options.maxRequestBodyBytes ?? 1_048_576),
    APPLIK8S_HTTP_MUTATION_RATE_LIMIT_MAX: String(options.mutationRateLimit?.maxRequests ?? 120),
    APPLIK8S_HTTP_MUTATION_RATE_LIMIT_WINDOW_SECONDS: String(options.mutationRateLimit?.windowSeconds ?? 60),
    ...(runtimeIndexBackend ? {
      APPLIK8S_INDEX_BACKEND: runtimeIndexBackend.kind,
      APPLIK8S_INDEX_VALKEY_HOST: runtimeIndexBackend.host,
      APPLIK8S_INDEX_VALKEY_PORT: String(runtimeIndexBackend.port),
    } : {}),
    ...(options.env ?? {}),
  };
  const configBindings = applicationConfigBindings(options.config);
  const secretBindings = applicationSecretBindings(options.secrets);
  const labels = {
    'app.kubernetes.io/name': resourceName,
    'app.kubernetes.io/component': 'server',
    'app.kubernetes.io/managed-by': 'applik8s',
    ...(options.labels ?? {}),
  };
  const id = (suffix: string) => graphResourceId(resourceName, suffix);
  const appVolumeMounts = [
    ...(sourceBundle ? [{ name: 'applik8s-server-source', mountPath: '/app', readOnly: true }] : []),
    ...applicationConfigVolumeMounts(configBindings),
    ...applicationSecretVolumeMounts(secretBindings),
    ...(options.volumeMounts ?? []),
  ];
  const appVolumes = [
    ...(mountedSourceBundle ? [{ name: 'applik8s-server-source', configMap: { name: sourceConfigMapName, items: mountedSourceBundle.items } }] : []),
    ...applicationConfigVolumes(configBindings),
    ...applicationSecretVolumes(secretBindings),
    ...(options.volumes ?? []),
  ];

  typeKroServiceAccount({
    id: id('serviceAccount'),
    apiVersion: 'v1',
    kind: 'ServiceAccount',
    metadata: { name: serviceAccountName, ...(namespace ? { namespace } : {}), labels },
  });

  if (serverPermissions.length > 0) {
    typeKroRole({
      id: id('role'),
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'Role',
      metadata: { name: serviceAccountName, ...(namespace ? { namespace } : {}), labels },
      rules: serverPermissions.map((rule) => ({
        apiGroups: [...rule.apiGroups],
        resources: [...rule.resources],
        verbs: [...rule.verbs],
        ...(rule.resourceNames ? { resourceNames: [...rule.resourceNames] } : {}),
      })),
    });
    typeKroRoleBinding({
      id: id('roleBinding'),
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'RoleBinding',
      metadata: { name: serviceAccountName, ...(namespace ? { namespace } : {}), labels },
      subjects: [{ kind: 'ServiceAccount', name: serviceAccountName, ...(namespace ? { namespace } : {}) }],
      roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name: serviceAccountName },
    });
  }

  if (sourceBundle) {
    typeKroConfigMap({
      id: id('source'),
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: { name: sourceConfigMapName, ...(namespace ? { namespace } : {}), labels },
      data: mountedSourceBundle?.data ?? sourceBundle,
    });
  }

  emitIndexBackendResources(resourceName, namespace, labels, options.indexBackend);
  emitValkeyIndexerResources(resourceName, namespace, labels, runtimeIndexBackend, options.indexes ?? {}, options.cache ?? []);

  const deployment = typeKroDeployment({
    id: id('deployment'),
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name: resourceName, ...(namespace ? { namespace } : {}), labels },
    spec: {
      replicas: options.replicas ?? 1,
      selector: { matchLabels: labels },
      template: {
        metadata: { labels },
        spec: {
          serviceAccountName,
          containers: [{
            name: 'server',
            image: options.image ?? 'node:22-alpine',
            command: [...(options.command ?? ['node', `/app/${sourceFileName}`])],
            ...(options.args ? { args: [...options.args] } : {}),
            env: [
              ...Object.entries(env).map(([envName, value]) => ({ name: envName, value })),
              ...applicationConfigEnvironmentVariables(configBindings),
              ...applicationSecretEnvironmentVariables(secretBindings),
              ...modelStoreEnvironmentVariables(runtimeModels, namespace),
            ],
            ports: [{ name: 'http', containerPort: 8080 }],
            readinessProbe: { httpGet: { path: '/-/healthz', port: 'http' }, initialDelaySeconds: 2, periodSeconds: 10 },
            livenessProbe: { httpGet: { path: '/-/healthz', port: 'http' }, initialDelaySeconds: 10, periodSeconds: 20 },
            ...(appVolumeMounts.length > 0 ? { volumeMounts: appVolumeMounts } : {}),
          }],
          ...(appVolumes.length > 0 ? { volumes: appVolumes } : {}),
        },
      },
    },
  });

  typeKroService({
    id: id('service'),
    apiVersion: 'v1',
    kind: 'Service',
    metadata: { name: serviceName, ...(namespace ? { namespace } : {}), labels },
    spec: {
      selector: labels,
      ports: [{ name: 'http', port: options.service?.port ?? 80, targetPort: 8080 }],
    },
  });
  // typecast: TypeKro's Kubernetes deployment factory exposes the full Kubernetes Deployment shape; app.server only relies on this narrower readiness projection.
  return { deployment: deployment as unknown as Enhanced<ApplicationDeploymentSpecProjection, ApplicationDeploymentStatusProjection> };
}

function applicationConfigBindings(config: ApplicationServerOptions['config']): readonly ApplicationConfigBinding[] {
  if (!config) {
    return [];
  }
  return Array.isArray(config) ? config : Object.values(config);
}

function applicationSecretBindings(secrets: ApplicationServerOptions['secrets']): readonly ApplicationSecretBinding[] {
  if (!secrets) {
    return [];
  }
  return Array.isArray(secrets) ? secrets : Object.values(secrets);
}

function applicationConfigEnvironmentVariables(bindings: readonly ApplicationConfigBinding[]): readonly { readonly name: string; readonly valueFrom: { readonly configMapKeyRef: { readonly name: string; readonly key: string } } }[] {
  return bindings.filter((binding) => binding.env).map((binding) => ({
    name: binding.env ?? binding.name,
    valueFrom: { configMapKeyRef: { name: binding.resourceName, key: binding.key } },
  }));
}

function applicationSecretEnvironmentVariables(bindings: readonly ApplicationSecretBinding[]): readonly { readonly name: string; readonly valueFrom: { readonly secretKeyRef: { readonly name: string; readonly key: string } } }[] {
  return bindings.filter((binding) => binding.env).map((binding) => ({
    name: binding.env ?? binding.name,
    valueFrom: { secretKeyRef: { name: binding.resourceName, key: binding.key } },
  }));
}

function applicationConfigVolumeMounts(bindings: readonly ApplicationConfigBinding[]): readonly ApplicationServerVolumeMount[] {
  return bindings.filter((binding) => binding.mountPath).map((binding) => ({ name: applicationBindingVolumeName('config', binding.name), mountPath: binding.mountPath ?? `/var/run/applik8s/config/${kubernetesNameSegment(binding.name)}`, readOnly: true }));
}

function applicationSecretVolumeMounts(bindings: readonly ApplicationSecretBinding[]): readonly ApplicationServerVolumeMount[] {
  return bindings.filter((binding) => binding.mountPath).map((binding) => ({ name: applicationBindingVolumeName('secret', binding.name), mountPath: binding.mountPath ?? `/var/run/applik8s/secrets/${kubernetesNameSegment(binding.name)}`, readOnly: true }));
}

function applicationConfigVolumes(bindings: readonly ApplicationConfigBinding[]): readonly ApplicationServerVolume[] {
  return bindings.filter((binding) => binding.mountPath).map((binding) => ({ name: applicationBindingVolumeName('config', binding.name), configMap: { name: binding.resourceName } }));
}

function applicationSecretVolumes(bindings: readonly ApplicationSecretBinding[]): readonly ApplicationServerVolume[] {
  return bindings.filter((binding) => binding.mountPath).map((binding) => ({ name: applicationBindingVolumeName('secret', binding.name), secret: { secretName: binding.resourceName } }));
}

function applicationBindingVolumeName(kind: 'config' | 'secret', name: string): string {
  return `applik8s-${kind}-${kubernetesNameSegment(name)}`.slice(0, 63);
}

function emitApplicationAggregateResources<TStats extends object, TEvent extends object>(name: string, options: ApplicationAggregateOptions<TStats, TEvent>): ApplicationGeneratedWorkloadBinding {
  const source = options.source;
  const target = options.target;
  assertApplicationAggregateTarget(name, target);
  const namespace = target.namespace;
  const resourceName = `${kubernetesNameSegment(name)}-aggregate`;
  const serviceAccountName = resourceName;
  const sourceConfigMapName = `${resourceName}-source`;
  const labels = {
    'app.kubernetes.io/name': resourceName,
    'app.kubernetes.io/component': 'aggregate',
    'app.kubernetes.io/managed-by': 'applik8s',
  };
  const id = (suffix: string) => graphResourceId(resourceName, suffix);
  const sourceRuntimeResource = applicationRuntimeResource(source.resource);
  const targetRuntimeResource = applicationRuntimeResource(target.resource);
  const reduceSource = serializeApplicationAggregateFunction(`app.aggregate ${name} reduce`, options.reduce, new Set(['stats', 'event']));
  const statusSource = serializeApplicationAggregateFunction(`app.aggregate ${name} status`, target.status, new Set(['stats']));
  const sourceBundle = kroSafeJavaScriptSourceBundle({
    'aggregate.mjs': generatedApplicationAggregateSource({
      name,
      source: sourceRuntimeResource,
      sourceOptions: source.options,
      target: targetRuntimeResource,
      targetName: target.name,
      ...(target.namespace ? { targetNamespace: target.namespace } : {}),
      initial: options.initial,
      reduceSource,
      statusSource,
      flushEveryMs: parseDurationMs(options.flush?.every ?? '2s'),
      maxEvents: options.flush?.maxEvents ?? 500,
    }),
  });
  const permissions = mergeApplicationPermissionRules([
    { apiGroups: [apiGroupForApiVersion(source.resource.apiVersion)], resources: [source.resource.plural], verbs: ['get', 'list', 'watch'] },
    { apiGroups: [apiGroupForApiVersion(target.resource.apiVersion)], resources: [`${target.resource.plural}/status`], verbs: ['patch'] },
  ]);

  typeKroServiceAccount({
    id: id('serviceAccount'),
    apiVersion: 'v1',
    kind: 'ServiceAccount',
    metadata: { name: serviceAccountName, ...(namespace ? { namespace } : {}), labels },
  });
  typeKroRole({
    id: id('role'),
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'Role',
    metadata: { name: serviceAccountName, ...(namespace ? { namespace } : {}), labels },
    rules: permissions.map((rule) => ({ apiGroups: [...rule.apiGroups], resources: [...rule.resources], verbs: [...rule.verbs] })),
  });
  typeKroRoleBinding({
    id: id('roleBinding'),
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'RoleBinding',
    metadata: { name: serviceAccountName, ...(namespace ? { namespace } : {}), labels },
    subjects: [{ kind: 'ServiceAccount', name: serviceAccountName, ...(namespace ? { namespace } : {}) }],
    roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name: serviceAccountName },
  });
  typeKroConfigMap({
    id: id('source'),
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: sourceConfigMapName, ...(namespace ? { namespace } : {}), labels },
    data: sourceBundle,
  });
  const deployment = typeKroDeployment({
    id: id('deployment'),
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name: resourceName, ...(namespace ? { namespace } : {}), labels },
    spec: {
      replicas: 1,
      selector: { matchLabels: labels },
      template: {
        metadata: { labels },
        spec: {
          serviceAccountName,
          containers: [{
            name: 'aggregate',
            image: 'node:22-alpine',
            command: ['node', '/app/aggregate.mjs'],
            env: [{ name: 'APPLIK8S_AGGREGATE_NAMESPACE', value: namespace ?? 'default' }],
            volumeMounts: [{ name: 'applik8s-aggregate-source', mountPath: '/app', readOnly: true }],
          }],
          volumes: [{ name: 'applik8s-aggregate-source', configMap: { name: sourceConfigMapName } }],
        },
      },
    },
  });
  // typecast: TypeKro's Kubernetes deployment factory exposes the full Kubernetes Deployment shape; app.aggregate only relies on this narrower readiness projection.
  return { deployment: deployment as unknown as Enhanced<ApplicationDeploymentSpecProjection, ApplicationDeploymentStatusProjection> };
}

function assertApplicationAggregateTarget(name: string, target: ApplicationAggregateStatusTarget<object>): void {
  if (!target || typeof target !== 'object') {
    throw new Error(`app.aggregate ${JSON.stringify(name)} target must be an explicit status target.`);
  }
  if (!target.resource?.apiVersion || !target.resource.kind || !target.resource.plural) {
    throw new Error(`app.aggregate ${JSON.stringify(name)} target.resource must be a resource definition.`);
  }
  if (!target.name) {
    throw new Error(`app.aggregate ${JSON.stringify(name)} target.name is required.`);
  }
  if (typeof target.status !== 'function') {
    throw new Error(`app.aggregate ${JSON.stringify(name)} target.status(stats) mapper is required.`);
  }
}

function kubernetesNameSegment(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
}

function pascalCase(value: string): string {
  const parts = kubernetesNameSegment(value).split(/[-.]+/).filter(Boolean);
  const result = parts.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join('');
  return result || 'App';
}

function serializeApplicationAggregateFunction(label: string, value: (...args: never[]) => unknown, allowedIdentifiers: ReadonlySet<string>): string {
  const source = normalizeSerializableFunctionSource(value.toString().trim());
  if (!source || source.includes('[native code]')) {
    throw new Error(`${label} must be a serializable JavaScript function.`);
  }
  try {
    Function(`return (${source});`);
  } catch (_error) {
    throw new Error(`${label} must be a serializable JavaScript function expression.`);
  }
  const unsupported = unsupportedRouteFreeIdentifiers(analyzeApplicationServerRouteSource(source), allowedIdentifiers);
  if (unsupported.length > 0) {
    throw new Error(serializedCallbackClosureMessage({
      label,
      identifiers: unsupported,
      guidance: 'Keep plain constants inside the callback, or pass values through the source event, aggregate stats, or target resource state so the generated aggregate is self-contained.',
    }));
  }
  return source;
}

function parseDurationMs(duration: string): number {
  const match = duration.trim().match(/^(\d+(?:\.\d+)?)(ms|s|m)$/);
  if (!match) {
    throw new Error(`app.aggregate flush.every must be a duration like "500ms", "2s", or "1m".`);
  }
  const value = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === 'ms' ? 1 : unit === 's' ? 1000 : 60_000;
  return Math.max(1, Math.round(value * multiplier));
}

function applicationRuntimeResource(resource: Pick<AnyResourceDefinition, 'apiVersion' | 'kind' | 'plural' | 'scope'>): ApplicationServerRuntimeResource {
  return {
    apiVersion: resource.apiVersion,
    kind: resource.kind,
    plural: resource.plural,
    scope: resource.scope,
  };
}

function modelStoreEnvironmentVariables(models: Readonly<Record<string, ApplicationRuntimeModelContract>>, serverNamespace: string | undefined): readonly { readonly name: string; readonly valueFrom: { readonly secretKeyRef: { readonly name: string; readonly key: string } } }[] {
  const byEnvName = new Map<string, { readonly name: string; readonly valueFrom: { readonly secretKeyRef: { readonly name: string; readonly key: string } } }>();
  for (const model of Object.values(models)) {
    const secretNamespace = model.secretNamespace ?? 'default';
    const podNamespace = serverNamespace ?? 'default';
    if (secretNamespace !== podNamespace) {
      throw new Error(`app.server cannot bind model ${JSON.stringify(model.name)} because its ModelStore Secret ${model.secretName} is in namespace ${secretNamespace}, but the server is in namespace ${podNamespace}. Run the server in the same namespace or provide a same-namespace connectionSecret.`);
    }
    byEnvName.set(model.connectionEnvName, {
      name: model.connectionEnvName,
      valueFrom: { secretKeyRef: { name: model.secretName, key: model.secretKey } },
    });
  }
  return [...byEnvName.values()];
}

function assertRuntimeBindingNames(bindings: Readonly<Record<string, unknown>>): void {
  for (const name of Object.keys(bindings)) {
    if (!/^[$A-Z_a-z][$\w]*$/.test(name)) {
      throw new Error(`app.server runtime binding ${JSON.stringify(name)} must be a valid JavaScript identifier.`);
    }
  }
}

function assertDistinctRuntimeBindingNames(bindings: Readonly<Record<string, Readonly<Record<string, unknown>>>>): void {
  const seen = new Map<string, string>();
  for (const [kind, values] of Object.entries(bindings)) {
    for (const name of Object.keys(values)) {
      const previous = seen.get(name);
      if (previous) {
        throw new Error(`app.server runtime binding ${JSON.stringify(name)} is declared as both ${previous} and ${kind}. Use distinct resource, index, and capture names.`);
      }
      seen.set(name, kind);
    }
  }
}

function serializeApplicationServerCaptures(captures: Readonly<Record<string, ApplicationServerCaptureValue>>): SerializedApplicationServerCaptures {
  const captureNames = new Set(Object.keys(captures));
  const captureBindingNames = new Set(captureNames);
  for (const [name, value] of Object.entries(captures)) {
    if (typeof value === 'function') {
      const aliasName = applicationServerFunctionCaptureAliasName(name, value.name);
      if (aliasName) {
        captureBindingNames.add(aliasName);
      }
    }
  }
  const serialized: Record<string, SerializedApplicationServerCapture> = {};
  for (const [name, value] of Object.entries(captures)) {
    if (typeof value === 'function') {
      serialized[name] = serializeApplicationServerFunctionCapture(name, value, captureBindingNames);
      continue;
    }
    if (isJsonSerializableValue(value)) {
      serialized[name] = { kind: 'json', value };
      continue;
    }
      throw new Error(`app.server capture ${JSON.stringify(name)} must be JSON-serializable.`);
  }
  return serialized;
}

function serializeApplicationServerFunctionCapture(name: string, value: ApplicationServerCaptureFunction, captureNames: ReadonlySet<string>): SerializedApplicationServerFunctionCapture {
  const source = value.toString().trim();
  if (!source || source.includes('[native code]')) {
    throw new Error(`app.server capture ${JSON.stringify(name)} must be a serializable JavaScript function.`);
  }
  try {
    Function(`return (${source});`);
  } catch (_error) {
    throw new Error(`app.server capture ${JSON.stringify(name)} must be a serializable JavaScript function expression.`);
  }
  const unsupported = unsupportedRouteFreeIdentifiers(analyzeApplicationServerRouteSource(source), captureNames);
  if (unsupported.length > 0) {
    throw new Error(serializedCallbackClosureMessage({
      label: `app.server capture ${JSON.stringify(name)}`,
      identifiers: unsupported,
      guidance: 'Pass every referenced value through app.server captures or keep plain constants inside the capture function so the generated server binding is self-contained.',
    }));
  }
  const aliasName = applicationServerFunctionCaptureAliasName(name, value.name);
  return { kind: 'function', source, ...(aliasName ? { aliasName } : {}) };
}

function applicationServerFunctionCaptureAliasName(captureName: string, functionName: string): string | undefined {
  if (!functionName || functionName === captureName || !/^[$A-Z_a-z][$\w]*$/.test(functionName)) {
    return undefined;
  }
  return functionName;
}

function serializedApplicationServerCaptureAliases(captures: SerializedApplicationServerCaptures): Readonly<Record<string, unknown>> {
  const aliases: Record<string, unknown> = {};
  for (const capture of Object.values(captures)) {
    if (capture.kind === 'function' && capture.aliasName) {
      aliases[capture.aliasName] = capture;
    }
  }
  return aliases;
}

function isJsonSerializableValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJsonSerializableValue);
  }
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return false;
    }
    return Object.values(value).every(isJsonSerializableValue);
  }
  return false;
}

function serializeApplicationServerRoutes(
  routes: readonly ApplicationServerRoute[],
  bindingNames: ReadonlySet<string>,
  dynamicAccessDisallowedBindings: ReadonlySet<string>
): readonly SerializedApplicationServerRouteWithDependencies[] {
  return routes.map((route) => serializeApplicationServerRoute(route, bindingNames, dynamicAccessDisallowedBindings));
}

function serializeApplicationServerRoute(
  route: ApplicationServerRoute,
  bindingNames: ReadonlySet<string>,
  dynamicAccessDisallowedBindings: ReadonlySet<string>
): SerializedApplicationServerRouteWithDependencies {
  try {
    Function(`return (${route.handlerSource});`);
  } catch (error) {
    const location = route.handlerSourceLocation ? ` at ${route.handlerSourceLocation.file}:${route.handlerSourceLocation.line}:${route.handlerSourceLocation.column}` : '';
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`app.server route ${route.method} ${route.path} must be a serializable JavaScript function expression (${route.handlerSourceKind ?? 'unknown'}${location}): ${message}`);
  }
  const analysis = analyzeApplicationServerRouteSource(route.handlerSource);
  const dynamicAccesses = routeDynamicBindingAccesses(analysis, dynamicAccessDisallowedBindings);
  if (dynamicAccesses.length > 0) {
    throw new Error(`app.server route ${route.method} ${route.path} uses unsupported dynamic binding access: ${dynamicAccesses.join(', ')}. Use direct methods like Resource.create(...) or index.query(...) so permissions can be inferred.`);
  }
  const unsupported = unsupportedRouteFreeIdentifiers(analysis, bindingNames);
  const dependencies = applicationRouteSourceDependencies(route, unsupported, bindingNames);
  if (unsupported.length > 0 && !dependencies) {
    throw new Error(`app.server route ${route.method} ${route.path} cannot serialize closure identifier(s): ${unsupported.join(', ')}. Pass serializable values through app.server captures, pass resources/indexes through app.server bindings, or inline constants inside the handler.`);
  }
  return dependencies ? { ...route, handlerDependencySource: dependencies.source, handlerDependencyResolveDir: dependencies.resolveDir } : route;
}

function inferApplicationServerPermissions(request: ApplicationServerPermissionInferenceRequest): readonly ApplicationPermissionRule[] {
  const cachedIndexes = new Set(request.indexBackend ? request.cache : []);
  const inferred: ApplicationPermissionRule[] = [];
  for (const route of request.routes) {
    const analysis = analyzeApplicationServerRouteSource(route.handlerSource);
    for (const [name, resource] of Object.entries(request.resources)) {
      for (const operation of resourceOperationsInSource(analysis, name)) {
        inferred.push(resourceOperationPermission(resource, operation));
      }
    }
    for (const [name, index] of Object.entries(request.indexes)) {
      if (!cachedIndexes.has(index) && routeAnalysisCallsMethod(analysis, name, 'query')) {
        inferred.push(resourceOperationPermission(index.resource, 'query'));
      }
    }
  }
  return mergeApplicationPermissionRules([...request.explicit, ...inferred]);
}

type ApplicationServerResourceOperation = 'create' | 'get' | 'query' | 'patch' | 'delete' | 'increment';

const resourceOperationVerbs: Readonly<Record<ApplicationServerResourceOperation, readonly string[]>> = {
  create: ['create'],
  get: ['get'],
  query: ['get', 'list'],
  patch: ['patch'],
  delete: ['delete'],
  increment: ['create', 'get', 'patch'],
};

function resourceOperationsInSource(analysis: ApplicationServerRouteSourceAnalysis, bindingName: string): readonly ApplicationServerResourceOperation[] {
  // typecast: resourceOperationVerbs is keyed by every ApplicationServerResourceOperation, so Object.keys narrows back to that union here.
  return (Object.keys(resourceOperationVerbs) as ApplicationServerResourceOperation[]).filter((operation) => routeAnalysisCallsMethod(analysis, bindingName, operation));
}

function resourceOperationPermission(resource: Pick<AnyResourceDefinition, 'apiVersion' | 'plural'>, operation: ApplicationServerResourceOperation): ApplicationPermissionRule {
  return {
    apiGroups: [apiGroupForApiVersion(resource.apiVersion)],
    resources: [resource.plural],
    verbs: resourceOperationVerbs[operation],
  };
}

function mergeApplicationPermissionRules(permissions: readonly ApplicationPermissionRule[]): readonly ApplicationPermissionRule[] {
  const merged = new Map<string, { apiGroups: string[]; resources: string[]; verbs: string[]; resourceNames?: string[] }>();
  for (const permission of permissions) {
    const apiGroups = [...permission.apiGroups].sort();
    const resources = [...permission.resources].sort();
    const resourceNames = permission.resourceNames ? [...permission.resourceNames].sort() : undefined;
    const key = JSON.stringify({ apiGroups, resources, resourceNames });
    const existing = merged.get(key);
    if (existing) {
      existing.verbs = unique([...existing.verbs, ...permission.verbs]);
      continue;
    }
    merged.set(key, {
      apiGroups,
      resources,
      verbs: unique([...permission.verbs]),
      ...(resourceNames ? { resourceNames } : {}),
    });
  }
  return [...merged.values()];
}

function apiGroupForApiVersion(apiVersion: string): string {
  return apiVersion.includes('/') ? apiVersion.split('/')[0] ?? '' : '';
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function graphResourceId(name: string, suffix: string): string {
  const parts = `${name}-${suffix}`.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const [first = 'resource', ...rest] = parts;
  return `${first.slice(0, 1).toLowerCase()}${first.slice(1)}${rest.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join('')}`;
}

function runtimeIndexBackendConfig(backend: ApplicationIndexBackend | undefined, namespace: string | undefined, resourceName: string): ApplicationRuntimeIndexBackend | undefined {
  if (!backend) {
    return undefined;
  }
  if (backend.kind === 'valkey') {
    const name = backend.name ?? `${resourceName}-index`;
    const backendNamespace = backend.namespace ?? namespace ?? 'default';
    return {
      kind: 'valkey',
      host: backend.host ?? `${name}.${backendNamespace}.svc.cluster.local`,
      port: backend.port ?? 6379,
    };
  }
  return undefined;
}

function emitIndexBackendResources(resourceName: string, namespace: string | undefined, labels: Readonly<Record<string, string>>, backend: ApplicationIndexBackend | undefined): void {
  if (backend?.kind !== 'valkey' || backend.provision === false || backend.host) {
    return;
  }
  const name = backend.name ?? `${resourceName}-index`;
  if (backend.provisioner === 'hyperspike') {
    emitHyperspikeValkeyResource(resourceName, namespace, labels, backend, name);
    return;
  }
  emitStandaloneValkeyResources(resourceName, namespace, labels, backend, name);
}

function emitHyperspikeValkeyResource(resourceName: string, namespace: string | undefined, labels: Readonly<Record<string, string>>, backend: ApplicationValkeyIndexBackend, name: string): void {
  const spec = {
    shards: 1,
    replicas: 0,
    anonymousAuth: true,
    ...(backend.spec ?? {}),
  };
  typeKroValkey({
    name,
    namespace: backend.namespace ?? namespace,
    id: graphResourceId(resourceName, 'valkeyIndex'),
    // typecast: TypeKro's Valkey factory accepts its CRD spec shape; applik8s keeps the backend option structurally typed to avoid leaking the provider package into public API types.
    spec: spec as never,
  });
  typeKroConfigMap({
    id: graphResourceId(resourceName, 'valkeyIndexServiceReference'),
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: `${name}-applik8s-index`, ...(namespace ? { namespace } : {}), labels },
    data: {
      backend: 'valkey',
      host: `${name}.${backend.namespace ?? namespace ?? 'default'}.svc.cluster.local`,
      port: String(backend.port ?? 6379),
    },
  });
}

function emitStandaloneValkeyResources(resourceName: string, namespace: string | undefined, labels: Readonly<Record<string, string>>, backend: ApplicationValkeyIndexBackend, name: string): void {
  const backendNamespace = backend.namespace ?? namespace;
  const backendLabels = {
    'app.kubernetes.io/name': name,
    'app.kubernetes.io/component': 'index-backend',
    'app.kubernetes.io/part-of': resourceName,
    'app.kubernetes.io/managed-by': 'applik8s',
  };
  const id = (suffix: string) => graphResourceId(name, suffix);
  typeKroDeployment({
    id: id('deployment'),
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name, ...(backendNamespace ? { namespace: backendNamespace } : {}), labels: backendLabels },
    spec: {
      replicas: 1,
      selector: { matchLabels: backendLabels },
      template: {
        metadata: { labels: backendLabels },
        spec: {
          containers: [{
            name: 'valkey',
            image: backend.image ?? 'valkey/valkey:8.1-alpine',
            args: ['valkey-server', '--save', ''],
            ports: [{ name: 'valkey', containerPort: backend.port ?? 6379 }],
          }],
        },
      },
    },
  });
  typeKroService({
    id: id('service'),
    apiVersion: 'v1',
    kind: 'Service',
    metadata: { name, ...(backendNamespace ? { namespace: backendNamespace } : {}), labels: backendLabels },
    spec: {
      selector: backendLabels,
      ports: [{ name: 'valkey', port: backend.port ?? 6379, targetPort: backend.port ?? 6379 }],
    },
  });
  typeKroConfigMap({
    id: graphResourceId(resourceName, 'valkeyIndexServiceReference'),
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: `${name}-applik8s-index`, ...(backendNamespace ? { namespace: backendNamespace } : {}), labels },
    data: {
      backend: 'valkey',
      host: `${name}.${backend.namespace ?? namespace ?? 'default'}.svc.cluster.local`,
      port: String(backend.port ?? 6379),
    },
  });
}

function emitValkeyIndexerResources(
  resourceName: string,
  namespace: string | undefined,
  labels: Readonly<Record<string, string>>,
  backend: ApplicationRuntimeIndexBackend | undefined,
  indexes: Readonly<Record<string, ResourceIndex<object, object>>>,
  cache: readonly ResourceIndex<object, object>[]
): void {
  if (backend?.kind !== 'valkey') {
    return;
  }
  const cachedIndexes = runtimeIndexTable(indexes, backend, cache);
  if (Object.keys(cachedIndexes).length === 0) {
    return;
  }
  const indexerName = `${resourceName}-indexer`;
  const indexerLabels = { ...labels, 'app.kubernetes.io/component': 'indexer', 'app.kubernetes.io/name': indexerName };
  const sourceName = `${indexerName}-source`;
  const id = (suffix: string) => graphResourceId(indexerName, suffix);

  typeKroServiceAccount({
    id: id('serviceAccount'),
    apiVersion: 'v1',
    kind: 'ServiceAccount',
    metadata: { name: indexerName, ...(namespace ? { namespace } : {}), labels: indexerLabels },
  });
  typeKroRole({
    id: id('role'),
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'Role',
    metadata: { name: indexerName, ...(namespace ? { namespace } : {}), labels: indexerLabels },
    rules: indexerPermissionRules(cachedIndexes).map((rule) => ({
      apiGroups: [...rule.apiGroups],
      resources: [...rule.resources],
      verbs: [...rule.verbs],
      ...(rule.resourceNames ? { resourceNames: [...rule.resourceNames] } : {}),
    })),
  });
  typeKroRoleBinding({
    id: id('roleBinding'),
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'RoleBinding',
    metadata: { name: indexerName, ...(namespace ? { namespace } : {}), labels: indexerLabels },
    subjects: [{ kind: 'ServiceAccount', name: indexerName, ...(namespace ? { namespace } : {}) }],
    roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name: indexerName },
  });
  typeKroConfigMap({
    id: id('source'),
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: sourceName, ...(namespace ? { namespace } : {}), labels: indexerLabels },
    data: { 'indexer.mjs': generatedValkeyIndexerSource(cachedIndexes) },
  });
  typeKroDeployment({
    id: id('deployment'),
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name: indexerName, ...(namespace ? { namespace } : {}), labels: indexerLabels },
    spec: {
      replicas: 1,
      selector: { matchLabels: indexerLabels },
      template: {
        metadata: { labels: indexerLabels },
        spec: {
          serviceAccountName: indexerName,
          containers: [{
            name: 'indexer',
            image: 'node:22-alpine',
            command: ['node', '/app/indexer.mjs'],
            env: [
              { name: 'APPLIK8S_SERVER_NAMESPACE', value: namespace ?? 'default' },
              { name: 'APPLIK8S_INDEX_VALKEY_HOST', value: backend.host },
              { name: 'APPLIK8S_INDEX_VALKEY_PORT', value: String(backend.port) },
            ],
            volumeMounts: [{ name: 'applik8s-indexer-source', mountPath: '/app', readOnly: true }],
          }],
          volumes: [{ name: 'applik8s-indexer-source', configMap: { name: sourceName } }],
        },
      },
    },
  });
}

function indexerPermissionRules(indexes: Readonly<Record<string, ApplicationServerRuntimeIndex>>): readonly ApplicationPermissionRule[] {
  const rules = new Map<string, ApplicationPermissionRule>();
  for (const index of Object.values(indexes)) {
    const [group = ''] = index.resource.apiVersion.includes('/') ? index.resource.apiVersion.split('/') : [''];
    const key = `${group}/${index.resource.plural}`;
    rules.set(key, { apiGroups: [group], resources: [index.resource.plural], verbs: ['get', 'list', 'watch'] });
  }
  return [...rules.values()];
}

function createRouteRecorder(routes: ApplicationServerRoute[]): ApplicationServer {
  const record = (method: ApplicationServerRoute['method'], path: string, handler: ApplicationRouteHandler) => {
    const extracted = extractApplicationRouteHandlerSource(method);
    const fallbackSource = normalizeSerializableFunctionSource(handler.toString().trim());
    routes.push({
      id: routeId(method, path, routes.length),
      method,
      path,
      handlerSource: extracted?.source ?? fallbackSource,
      handlerSourceKind: extracted ? 'source' : 'functionToString',
      ...(extracted ? { handlerSourceLocation: extracted.location } : {}),
    });
  };
  return {
    get(path, handler) {
      record('GET', path, handler);
    },
    post(path, handler) {
      record('POST', path, handler);
    },
  };
}

function routeId(method: ApplicationServerRoute['method'], path: string, index: number): string {
  const safePath = path.split('/').filter(Boolean).join('-') || 'root';
  return `${method.toLowerCase()}-${safePath}-${index}`.replace(/[^a-z0-9-]+/g, '-');
}

const applicationModulePath = fileURLToPath(import.meta.url);

function generatedApplicationServerBundle(
  sourceFileName: string,
  routes: readonly SerializedApplicationServerRouteWithDependencies[],
  resources: Readonly<Record<string, AnyResourceDefinition>>,
  indexes: Readonly<Record<string, ResourceIndex<object, object>>>,
  models: Readonly<Record<string, ApplicationRuntimeModelContract>>,
  captures: SerializedApplicationServerCaptures,
  indexBackend: ApplicationRuntimeIndexBackend | undefined,
  cache: readonly ResourceIndex<object, object>[]
): Readonly<Record<string, string>> {
  const routeModules = generatedApplicationServerRouteModules(routes);
  return bundleGeneratedApplicationServerSourceBundle(sourceFileName, {
    [sourceFileName]: generatedApplicationServerHonoEntrypointSource(),
    'runtime.mjs': generatedApplicationServerRuntimeSource(resources, indexes, models, indexBackend, cache),
    ...generatedApplicationRuntimeModuleBundle(),
    'bindings.mjs': generatedApplicationServerBindingsSource(resources, indexes, models, captures),
    'routes.mjs': generatedApplicationServerRoutesSource(routeModules),
    'routes.manifest.json': `${JSON.stringify(routeModules.map(routeManifestEntry), null, 2)}\n`,
    ...Object.fromEntries(routeModules.map((module) => [module.fileName, generatedApplicationServerRouteModuleSource(module, resources, indexes, models, captures)])),
  });
}

function kroSafeJavaScriptSourceBundle(bundle: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(bundle).map(([fileName, source]) => [
    fileName,
    isJavaScriptSourceFile(fileName) ? lowerTemplateLiteralsForKro(fileName, source) : source,
  ]));
}

function mountedConfigMapSourceBundle(bundle: Readonly<Record<string, string>>): { readonly data: Readonly<Record<string, string>>; readonly items: { key: string; path: string }[] } {
  const usedKeys = new Set<string>();
  const data: Record<string, string> = {};
  const items: { key: string; path: string }[] = [];

  for (const [fileName, source] of Object.entries(bundle)) {
    assertSafeConfigMapVolumePath(fileName);
    const key = configMapSourceKey(fileName, usedKeys);
    usedKeys.add(key);
    data[key] = source;
    items.push({ key, path: fileName });
  }

  return { data, items };
}

function configMapSourceKey(fileName: string, usedKeys: ReadonlySet<string>): string {
  const baseKey = fileName.replaceAll('/', '__').replace(/[^A-Za-z0-9._-]/g, '_') || 'source';
  let key = baseKey;
  let attempt = 2;
  while (usedKeys.has(key)) {
    key = `${baseKey}-${attempt}`;
    attempt += 1;
  }
  return key;
}

function assertSafeConfigMapVolumePath(fileName: string): void {
  if (fileName.startsWith('/') || fileName.split('/').some((part) => part.length === 0 || part === '..')) {
    throw new Error(`Generated server source file ${JSON.stringify(fileName)} is not a safe ConfigMap volume path.`);
  }
}

function isJavaScriptSourceFile(fileName: string): boolean {
  return fileName.endsWith('.js') || fileName.endsWith('.mjs') || fileName.endsWith('.cjs');
}

function lowerTemplateLiteralsForKro(fileName: string, source: string): string {
  if (!source.includes('${')) {
    return source;
  }
  const diagnosticHeader = source.match(/^(?:\/\/ applik8s-route-[^\n]*\n)+/)?.[0] ?? '';
  const transformed = transformSync(source, {
    loader: 'js',
    format: 'esm',
    target: 'node22',
    legalComments: 'none',
    minifyWhitespace: true,
    supported: { 'template-literal': false },
  }).code;
  const withoutComments = stripJavaScriptLineComments(stripJavaScriptBlockComments(transformed));
  const output = diagnosticHeader && !withoutComments.startsWith(diagnosticHeader) ? `${diagnosticHeader}${withoutComments}` : withoutComments;
  if (output.includes('${')) {
    const index = output.indexOf('${');
    const context = output.slice(Math.max(0, index - 80), index + 120).replace(/\s+/g, ' ');
    throw new Error(`Generated JavaScript source ${fileName} still contains raw \`\${\` after template lowering near ${JSON.stringify(context)}; KRO cannot embed it safely.`);
  }
  return output;
}

function stripJavaScriptLineComments(source: string): string {
  let output = '';
  let index = 0;
  let mode: 'single' | 'double' | 'template' | 'regex' | undefined;
  let regexCharacterClass = false;
  while (index < source.length) {
    const character = source[index] ?? '';
    const next = source[index + 1] ?? '';
    if (!mode && character === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') {
        index += 1;
      }
      continue;
    }
    output += character;
    if (mode) {
      if (character === '\\') {
        index += 1;
        output += source[index] ?? '';
      } else if (mode === 'regex') {
        if (character === '[') {
          regexCharacterClass = true;
        } else if (character === ']') {
          regexCharacterClass = false;
        } else if (character === '/' && !regexCharacterClass) {
          mode = undefined;
        }
      } else if ((mode === 'single' && character === "'") || (mode === 'double' && character === '"') || (mode === 'template' && character === '`')) {
        mode = undefined;
      }
    } else if (character === "'") {
      mode = 'single';
    } else if (character === '"') {
      mode = 'double';
    } else if (character === '`') {
      mode = 'template';
    } else if (character === '/' && next !== '*' && canStartJavaScriptRegexLiteral(previousSignificantCharacter(output.slice(0, -1)))) {
      mode = 'regex';
      regexCharacterClass = false;
    }
    index += 1;
  }
  return output;
}

function stripJavaScriptBlockComments(source: string): string {
  let output = '';
  let index = 0;
  let mode: 'single' | 'double' | 'template' | 'regex' | undefined;
  let regexCharacterClass = false;
  while (index < source.length) {
    const character = source[index] ?? '';
    const next = source[index + 1] ?? '';
    if (!mode && character === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        index += 1;
      }
      index += 2;
      continue;
    }
    output += character;
    if (mode) {
      if (character === '\\') {
        index += 1;
        output += source[index] ?? '';
      } else if (mode === 'regex') {
        if (character === '[') {
          regexCharacterClass = true;
        } else if (character === ']') {
          regexCharacterClass = false;
        } else if (character === '/' && !regexCharacterClass) {
          mode = undefined;
        }
      } else if ((mode === 'single' && character === "'") || (mode === 'double' && character === '"') || (mode === 'template' && character === '`')) {
        mode = undefined;
      }
    } else if (character === "'") {
      mode = 'single';
    } else if (character === '"') {
      mode = 'double';
    } else if (character === '`') {
      mode = 'template';
    } else if (character === '/' && next !== '/' && canStartJavaScriptRegexLiteral(previousSignificantCharacter(output.slice(0, -1)))) {
      mode = 'regex';
      regexCharacterClass = false;
    }
    index += 1;
  }
  return output;
}

function previousSignificantCharacter(source: string): string | undefined {
  for (let index = source.length - 1; index >= 0; index -= 1) {
    const character = source[index];
    if (character && !/\s/.test(character)) {
      return character;
    }
  }
  return undefined;
}

function canStartJavaScriptRegexLiteral(previous: string | undefined): boolean {
  return !previous || '({[=,:;!&|?+-*~^<>'.includes(previous);
}

function generatedApplicationServerRouteModules(routes: readonly SerializedApplicationServerRouteWithDependencies[]): readonly GeneratedApplicationServerRouteModule[] {
  return routes.map((route) => ({
    route,
    fileName: `route-${route.id}.mjs`,
    exportName: `route_${route.id.replace(/[^A-Za-z0-9_$]/g, '_')}`,
  }));
}

function bundleGeneratedApplicationServerSourceBundle(sourceFileName: string, bundle: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  const tempDir = mkdtempSync(join(tmpdir(), 'applik8s-generated-server-'));
  try {
    for (const [fileName, source] of Object.entries(bundle)) {
      assertSafeConfigMapVolumePath(fileName);
      const target = join(tempDir, fileName);
      const targetDir = dirname(target);
      if (!existsSync(targetDir)) {
        mkdirpSync(targetDir);
      }
      writeFileSync(target, source, 'utf8');
    }
    return {
      ...Object.fromEntries(Object.entries(bundle).filter(([fileName]) => fileName !== sourceFileName)),
      ...bundleApplicationServerEntrypoint(sourceFileName, tempDir, bundle['routes.manifest.json']),
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function mkdirpSync(path: string): void {
  if (existsSync(path)) {
    return;
  }
  mkdirpSync(dirname(path));
  mkdirSync(path);
}

function bundleApplicationServerEntrypoint(sourceFileName: string, sourceDir: string, routesManifest: string | undefined): Readonly<Record<string, string>> {
  const result = buildSync({
    entryPoints: [join(sourceDir, sourceFileName)],
    outfile: join(sourceDir, 'dist', sourceFileName),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    nodePaths: generatedServerBundleNodePaths(),
    legalComments: 'none',
    minifySyntax: true,
    supported: { 'template-literal': false },
    sourcemap: true,
    sourcesContent: false,
    write: false,
  });
  const files = Object.fromEntries(result.outputFiles.map((file) => [file.path.split('/').pop() ?? file.path, file.text]));
  const bundledSource = files[sourceFileName] ?? result.outputFiles.find((file) => !file.path.endsWith('.map'))?.text;
  const sourceMap = files[`${sourceFileName}.map`] ?? result.outputFiles.find((file) => file.path.endsWith('.map'))?.text;
  if (!bundledSource || !sourceMap) {
    throw new Error(`Generated server bundling did not produce ${sourceFileName} and ${sourceFileName}.map.`);
  }
  return {
    [sourceFileName]: bundledSource,
    [`${sourceFileName}.map`]: normalizeGeneratedServerSourceMap(sourceMap, sourceDir),
    'routes.manifest.json': routesManifest ?? '[]\n',
    'runtime.bundle.json': `${JSON.stringify(generatedServerRuntimeBundleContract(sourceFileName), null, 2)}\n`,
  };
}

function generatedServerBundleNodePaths(): string[] {
  return [
    join(process.cwd(), 'node_modules'),
    join(dirname(applicationModulePath), '..', 'node_modules'),
    join(dirname(applicationModulePath), '..', '..', '..', 'node_modules'),
  ];
}

function normalizeGeneratedServerSourceMap(sourceMap: string, sourceDir: string): string {
  const parsed: { sources?: unknown } = JSON.parse(sourceMap);
  if (Array.isArray(parsed.sources)) {
    parsed.sources = parsed.sources.map((source) => normalizeGeneratedServerSourcePath(source, sourceDir));
  }
  return `${JSON.stringify(parsed)}\n`;
}

function normalizeGeneratedServerSourcePath(source: string, sourceDir: string): string {
  if (source.startsWith(sourceDir)) {
    return relative(sourceDir, source).replaceAll('\\', '/');
  }
  const marker = 'applik8s-generated-server-';
  const markerIndex = source.indexOf(marker);
  if (markerIndex !== -1) {
    const slashIndex = source.indexOf('/', markerIndex);
    if (slashIndex !== -1) {
      return source.slice(slashIndex + 1);
    }
  }
  return source.replaceAll('\\', '/');
}

function generatedApplicationServerHonoEntrypointSource(): string {
  return `
import { Hono } from 'hono';
import { createServer } from 'node:http';
import { Transform } from 'node:stream';
import { routes } from './routes.mjs';

const applik8sServerRuntime = 'hono';
const maxRequestBodyBytes = positiveInteger(process.env.APPLIK8S_HTTP_MAX_BODY_BYTES, 1048576);
const mutationRateLimitMax = positiveInteger(process.env.APPLIK8S_HTTP_MUTATION_RATE_LIMIT_MAX, 120);
const mutationRateLimitWindowMs = positiveInteger(process.env.APPLIK8S_HTTP_MUTATION_RATE_LIMIT_WINDOW_SECONDS, 60) * 1000;
const mutationWindows = new Map();

const app = new Hono();

app.use('*', async (context, next) => {
  const contentLength = Number(context.req.header('content-length') || '0');
  if (Number.isFinite(contentLength) && contentLength > maxRequestBodyBytes) {
    return context.text('Request body exceeds ' + maxRequestBodyBytes + ' bytes.', 413);
  }
  if (context.req.method !== 'GET' && context.req.method !== 'HEAD' && context.req.method !== 'OPTIONS') {
    const now = Date.now();
    const url = new URL(context.req.url);
    const client = context.req.header('x-applik8s-remote-address') || 'unknown';
    const key = client + ':' + context.req.method + ':' + url.pathname;
    const current = mutationWindows.get(key);
    const window = !current || current.resetAt <= now ? { count: 0, resetAt: now + mutationRateLimitWindowMs } : current;
    window.count += 1;
    mutationWindows.set(key, window);
    if (mutationWindows.size > 10000) {
      for (const [candidate, value] of mutationWindows) if (value.resetAt <= now) mutationWindows.delete(candidate);
    }
    if (window.count > mutationRateLimitMax) {
      return context.text('Too many mutation requests. Retry after the current rate-limit window.', 429, { 'retry-after': String(Math.max(1, Math.ceil((window.resetAt - now) / 1000))) });
    }
  }
  await next();
});

for (const route of routes) {
  app.on(route.method, route.path, async (context) => {
    try {
      const url = new URL(context.req.url);
      const params = context.req.param();
      const form = await honoFormData(context.req);
      const result = await route.handler({
        params,
        query: { ...Object.fromEntries(url.searchParams.entries()), ...params },
        form,
        formData: async () => form,
      });
      return honoResponse(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const statusCode = error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
      const stack = error instanceof Error && error.stack ? error.stack.split('\\n').slice(0, 12) : undefined;
      const diagnostic = error && typeof error === 'object' && 'diagnostic' in error ? error.diagnostic : undefined;
      console.error(JSON.stringify({ level: 'error', component: 'applik8s-server', event: 'applik8s-server-route-failure', runtime: applik8sServerRuntime, route: routeDiagnostics(route), message, statusCode, diagnostic, ...(stack ? { stack } : {}) }));
      console.error(JSON.stringify({ level: 'error', component: 'applik8s-server', event: route.observability.actions.failureEvent, runtime: applik8sServerRuntime, routeId: route.id, method: route.method, path: route.path, module: route.module, sourceLocation: route.sourceLocation, bundleInputs: route.bundleInputs, action: route.export, diagnostic, partialEffects: route.observability.actions.partialEffects, failurePolicy: route.observability.actions.failurePolicy, message, statusCode, ...(stack ? { stack } : {}) }));
      return context.text('Route ' + route.id + ' (' + route.method + ' ' + route.path + ') failed: ' + message, statusCode);
    }
  });
}

app.get('/-/healthz', (context) => context.json({ ok: true, component: 'applik8s-server' }));

app.notFound((context) => {
  const url = new URL(context.req.url);
  return context.text('No route for ' + context.req.method + ' ' + url.pathname, 404);
});

createServer(async (incoming, outgoing) => {
  try {
    const request = nodeRequestToFetchRequest(incoming);
    const response = await app.fetch(request);
    await writeFetchResponse(outgoing, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ level: 'error', component: 'applik8s-server', event: 'applik8s-server-request-failure', runtime: applik8sServerRuntime, message }));
    const statusCode = error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
    outgoing.writeHead(statusCode, { 'content-type': 'text/plain; charset=utf-8' });
    outgoing.end(message);
  }
}).listen(8080, '0.0.0.0');

function nodeRequestToFetchRequest(request) {
  const host = request.headers.host || '127.0.0.1';
  const url = 'http://' + host + (request.url || '/');
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
    } else if (value !== undefined) {
      headers.set(name, String(value));
    }
  }
  headers.set('x-applik8s-remote-address', request.socket.remoteAddress || 'unknown');
  const method = request.method || 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';
  return new Request(url, { method, headers, ...(hasBody ? { body: boundedRequestBody(request), duplex: 'half' } : {}) });
}

function boundedRequestBody(request) {
  let bytes = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += Buffer.byteLength(chunk);
      if (bytes > maxRequestBodyBytes) {
        const error = new Error('Request body exceeds ' + maxRequestBodyBytes + ' bytes.');
        error.statusCode = 413;
        callback(error);
        return;
      }
      callback(null, chunk);
    },
  });
  return request.pipe(limiter);
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function writeFetchResponse(outgoing, response) {
  outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  if (!response.body) {
    outgoing.end();
    return;
  }
  const reader = response.body.getReader();
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) {
      outgoing.end();
      return;
    }
    outgoing.write(Buffer.from(chunk.value));
  }
}

async function honoFormData(request) {
  let data;
  try {
    data = await request.raw.formData();
  } catch (_error) {
    data = new FormData();
  }
  return {
    string: (name) => {
      const value = data.get(name);
      return typeof value === 'string' ? value : '';
    },
    enum(name, values) {
      const value = data.get(name);
      if (typeof value !== 'string' || !values.includes(value)) {
        throw new Error('Invalid form field ' + name + ': expected one of ' + values.join(', '));
      }
      return value;
    },
  };
}

function honoResponse(result) {
  if (result instanceof Response) {
    return result;
  }
  if (result && typeof result === 'object' && 'redirect' in result) {
    return new Response(null, { status: 303, headers: { location: String(result.redirect) } });
  }
  if (result && typeof result === 'object' && typeof result.html === 'string') {
    return new Response(result.html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  return new Response(JSON.stringify(result ?? null), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

function routeDiagnostics(route) {
  return {
    id: route.id,
    method: route.method,
    path: route.path,
    module: route.module,
    sourceKind: route.sourceKind,
    sourceLocation: route.sourceLocation,
    bundleInputs: route.bundleInputs,
    diagnostics: route.diagnostics,
  };
}
`.trimStart();
}

function generatedApplicationServerRoutesSource(routeModules: readonly GeneratedApplicationServerRouteModule[]): string {
  const imports = routeModules.map((module) => `import { ${module.exportName} } from './${module.fileName}';`).join('\n');
  const routeEntries = routeModules.map((module) => `  { ${routeRuntimeMetadataProperties(module)}, handler: ${module.exportName} }`).join(',\n');
  return `
${imports}

export const routes = [
${routeEntries}
];
`.trimStart();
}

function routeManifestEntry(module: GeneratedApplicationServerRouteModule): object {
  return {
    id: module.route.id,
    method: module.route.method,
    path: module.route.path,
    module: module.fileName,
    export: module.exportName,
    sourceKind: module.route.handlerSourceKind ?? 'functionToString',
    sourceLocation: module.route.handlerSourceLocation ?? null,
    bundleInputs: routeBundleInputs(module),
    diagnostics: routeDiagnosticsContract(),
    observability: routeObservabilityEntry(),
  };
}

function routeRuntimeMetadataProperties(module: GeneratedApplicationServerRouteModule): string {
  return [
    `id: ${JSON.stringify(module.route.id)}`,
    `method: ${JSON.stringify(module.route.method)}`,
    `path: ${JSON.stringify(module.route.path)}`,
    `module: ${JSON.stringify(module.fileName)}`,
    `export: ${JSON.stringify(module.exportName)}`,
    `sourceKind: ${JSON.stringify(module.route.handlerSourceKind ?? 'functionToString')}`,
    `sourceLocation: ${JSON.stringify(module.route.handlerSourceLocation ?? null)}`,
    `bundleInputs: ${JSON.stringify(routeBundleInputs(module))}`,
    `diagnostics: ${JSON.stringify(routeDiagnosticsContract())}`,
    `observability: ${JSON.stringify(routeObservabilityEntry())}`,
  ].join(', ');
}

function routeObservabilityEntry(): object {
  return {
    logs: { format: 'json', component: 'applik8s-server', failureEvent: 'applik8s-server-route-failure' },
    actions: { failureEvent: 'applik8s-route-action-failure', partialEffects: 'unknownAfterActionStarted', failurePolicy: 'failClosed' },
    metrics: { hooks: ['applik8s_server_requests_total', 'applik8s_server_route_failures_total'] },
    sourceMaps: 'required',
  };
}

function routeBundleInputs(module: GeneratedApplicationServerRouteModule): readonly string[] {
  const source = module.route.handlerDependencySource;
  if (!source) {
    return [];
  }
  const bundled = bundledApplicationServerRouteModuleSource(module, '');
  return bundled.inputs.map((input) => input.split('/').pop() ?? input);
}

function generatedApplicationServerBindingsSource(
  resources: Readonly<Record<string, AnyResourceDefinition>>,
  indexes: Readonly<Record<string, ResourceIndex<object, object>>>,
  models: Readonly<Record<string, ApplicationRuntimeModelContract>>,
  captures: SerializedApplicationServerCaptures
): string {
  const resourceBindings = Object.keys(resources).map((name) => `const ${name} = resourceClients[${JSON.stringify(name)}];`).join('\n');
  const indexBindings = Object.keys(indexes).map((name) => `const ${name} = indexClients[${JSON.stringify(name)}];`).join('\n');
  const modelBindings = Object.keys(models).map((name) => `const ${name} = modelClients[${JSON.stringify(name)}];`).join('\n');
  const captureBindings = generatedApplicationServerCaptureBindings(captures);
  const exports = generatedApplicationServerBindingNames(resources, indexes, models, captures);
  return `
import { createRuntimeBindings } from './runtime.mjs';

const { resourceClients, indexClients, modelClients } = createRuntimeBindings();
${resourceBindings}
${indexBindings}
${modelBindings}
${captureBindings}

${exports.length > 0 ? `export { ${exports.join(', ')} };` : 'export {};'}
`.trimStart();
}

function generatedApplicationServerRouteModuleSource(
  module: GeneratedApplicationServerRouteModule,
  resources: Readonly<Record<string, AnyResourceDefinition>>,
  indexes: Readonly<Record<string, ResourceIndex<object, object>>>,
  models: Readonly<Record<string, ApplicationRuntimeModelContract>>,
  captures: SerializedApplicationServerCaptures
): string {
  const imports = generatedApplicationServerBindingNames(resources, indexes, models, captures);
  const sourceLocation = module.route.handlerSourceLocation ? `${module.route.handlerSourceLocation.file}:${module.route.handlerSourceLocation.line}:${module.route.handlerSourceLocation.column}` : 'unavailable';
  const bindingImport = imports.length > 0 ? `import { ${imports.join(', ')} } from './bindings.mjs';\n` : '';
  const bundledRoute = module.route.handlerDependencySource ? bundledApplicationServerRouteModuleSource(module, bindingImport) : undefined;
  const routeSource = bundledRoute
    ? bundledRoute.source
    : `
// applik8s-route-source-kind: ${module.route.handlerSourceKind ?? 'functionToString'}
// applik8s-route-source-location: ${sourceLocation}
${bindingImport}
export const ${module.exportName} = (${module.route.handlerSource});
`.trimStart();
  const header = `// applik8s-route-source-kind: ${module.route.handlerSourceKind ?? 'functionToString'}\n// applik8s-route-source-location: ${sourceLocation}\n${bundledRoute ? `// applik8s-route-bundle-inputs: ${bundledRoute.inputs.map((input) => input.split('/').pop() ?? input).join(', ')}\n` : ''}`;
  return routeSource.startsWith('// applik8s-route-source-kind:') ? routeSource : `${header}${routeSource}`;
}

function bundledApplicationServerRouteModuleSource(module: GeneratedApplicationServerRouteModule, bindingImport: string): ApplicationRouteModuleBundle {
  const result = buildSync({
    stdin: {
      contents: `
${module.route.handlerDependencySource ?? ''}

export const ${module.exportName} = (${module.route.handlerSource});
`.trimStart(),
      resolveDir: module.route.handlerDependencyResolveDir ?? process.cwd(),
      sourcefile: `${module.fileName}.ts`,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    legalComments: 'none',
    minifySyntax: true,
    supported: { 'template-literal': false },
    metafile: true,
    sourcemap: false,
    write: false,
  });
  const bundled = result.outputFiles[0]?.text;
  if (!bundled) {
    throw new Error(`Generated server route bundling did not produce ${module.fileName}.`);
  }
  return { source: `${bindingImport}${bundled}`, inputs: Object.keys(result.metafile?.inputs ?? {}) };
}

function generatedApplicationServerBindingNames(
  resources: Readonly<Record<string, AnyResourceDefinition>>,
  indexes: Readonly<Record<string, ResourceIndex<object, object>>>,
  models: Readonly<Record<string, ApplicationRuntimeModelContract>>,
  captures: SerializedApplicationServerCaptures
): readonly string[] {
  const names = new Set<string>([...Object.keys(resources), ...Object.keys(indexes), ...Object.keys(models), ...Object.keys(captures)]);
  for (const capture of Object.values(captures)) {
    if (capture.kind === 'function' && capture.aliasName) {
      names.add(capture.aliasName);
    }
  }
  return [...names];
}

function generatedApplicationServerCaptureBindings(captures: SerializedApplicationServerCaptures): string {
  const bindings = ['const captures = {};'];
  for (const [name, capture] of Object.entries(captures)) {
    const expression = capture.kind === 'json' ? JSON.stringify(capture.value) : `(${capture.source})`;
    bindings.push(`const ${name} = captures[${JSON.stringify(name)}] = ${expression};`);
    if (capture.kind === 'function' && capture.aliasName) {
      bindings.push(`const ${capture.aliasName} = ${name};`);
    }
  }
  return bindings.join('\n');
}
