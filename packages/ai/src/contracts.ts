// typecast-file-boundary: provider-neutral AI constructors validate JSON-like model and provider inputs before restoring their declared contract types.
import type {
  ApplicationExecutionPrincipal,
  ApplicationIdentityReference,
  ApplicationOperationId,
  ApplicationProviderQualificationContract,
  JsonObject,
  JsonValue,
  SourceLocation,
} from '@applik8s/core';

export const applicationAIProtocolRevision = 'applik8s.ai/v1alpha1' as const;
export const applicationAIAdapterRevision = 'applik8s.ai-tanstack/v1alpha1' as const;

export type ApplicationAICapabilityName =
  | 'chat'
  | 'tools'
  | 'streaming'
  | 'structured-output'
  | 'reasoning'
  | 'text-input'
  | 'text-output'
  | 'image-input'
  | 'image-output'
  | 'audio-input'
  | 'audio-output';

export interface ApplicationAICapability<TName extends ApplicationAICapabilityName = ApplicationAICapabilityName> {
  readonly apiVersion: 'applik8s.aiCapability/v1alpha1';
  readonly name: TName;
}

export interface ApplicationAIModelConstraints {
  readonly dataResidency?: readonly string[];
  readonly complianceTags?: readonly string[];
  readonly maximumInputCostPerMillion?: number;
  readonly maximumOutputCostPerMillion?: number;
  readonly minimumContextTokens?: number;
  readonly minimumOutputTokens?: number;
  readonly latencyClass?: 'interactive' | 'standard' | 'batch';
  readonly availabilityClass?: 'standard' | 'high';
  readonly allowedProviderClasses?: readonly string[];
}

export interface ApplicationAIModelDefinition<
  TName extends string = string,
  TCapabilities extends readonly ApplicationAICapability[] = readonly ApplicationAICapability[],
> {
  readonly apiVersion: 'applik8s.aiModel/v1alpha1';
  readonly name: TName;
  readonly capabilities: TCapabilities;
  readonly constraints: ApplicationAIModelConstraints;
  readonly inference?: {
    readonly qualification: ApplicationProviderQualificationContract;
  };
}

export interface ApplicationAIProviderSelection {
  readonly qualification: ApplicationProviderQualificationContract;
}

export interface ApplicationAICapabilityCatalog {
  readonly chat: ApplicationAICapability<'chat'>;
  readonly tools: ApplicationAICapability<'tools'>;
  readonly streaming: ApplicationAICapability<'streaming'>;
  readonly structuredOutput: ApplicationAICapability<'structured-output'>;
  readonly reasoning: ApplicationAICapability<'reasoning'>;
  readonly textInput: ApplicationAICapability<'text-input'>;
  readonly textOutput: ApplicationAICapability<'text-output'>;
  readonly imageInput: ApplicationAICapability<'image-input'>;
  readonly imageOutput: ApplicationAICapability<'image-output'>;
  readonly audioInput: ApplicationAICapability<'audio-input'>;
  readonly audioOutput: ApplicationAICapability<'audio-output'>;
}

export interface ApplicationAIProviderToken<TImplementation = ApplicationAIProvider>
  extends ApplicationAICapabilityCatalog {
  readonly name: 'AI';
  readonly description: string;
  readonly contract: {
    readonly apiVersion: 'applik8s.provider/v1alpha1';
    readonly interface: 'AI';
    readonly version: 'v1alpha1';
    readonly requirements: readonly string[];
    readonly guarantees: readonly string[];
  };
  readonly accepts: (value: unknown) => value is TImplementation;
  named<const TName extends string>(
    name: TName,
  ): ApplicationAIQualifiedProviderToken<TImplementation, TName>;
  model<
    const TName extends string,
    const TCapabilities extends readonly ApplicationAICapability[],
  >(
    name: TName,
    options: {
      readonly capabilities: TCapabilities;
      readonly constraints?: ApplicationAIModelConstraints;
      readonly inference?: ApplicationAIProviderSelection;
    },
  ): ApplicationAIModelDefinition<TName, TCapabilities>;
  deterministic(
    options?: Omit<ApplicationAIDeterministicProvider, 'kind' | 'production'>,
  ): ApplicationAIDeterministicProvider;
  envoy(
    options: Omit<ApplicationEnvoyAIGatewayProvider, 'kind' | 'production'>,
  ): ApplicationEnvoyAIGatewayProvider;
}

export interface ApplicationAIQualifiedProviderToken<
  TImplementation = ApplicationAIProvider,
  TName extends string = string,
> extends ApplicationAIProviderToken<TImplementation> {
  readonly kind: 'applicationQualifiedProvider';
  readonly base: ApplicationAIProviderToken<TImplementation>;
  readonly qualification: ApplicationProviderQualificationContract & {
    readonly name: TName;
  };
}

export interface ApplicationAIDeterministicProvider {
  readonly kind: 'ai-deterministic';
  readonly production: false;
  readonly fixture?: JsonObject;
  readonly latencyMs?: number;
}

export interface ApplicationAIBackendCredentialReference {
  readonly apiVersion: 'v1';
  readonly kind: 'Secret';
  readonly name: string;
  readonly namespace?: string;
  readonly key: string;
}

export interface ApplicationAIBackendDefinition {
  readonly apiVersion: 'applik8s.aiBackend/v1alpha1';
  readonly name: string;
  readonly providerClass: 'openai' | 'anthropic' | 'bedrock' | 'openai-compatible';
  readonly model: string;
  readonly endpoint?: string;
  readonly region?: string;
  readonly credentials?: ApplicationAIBackendCredentialReference;
  readonly capabilities?: readonly ApplicationAICapabilityName[];
  readonly dataResidency?: readonly string[];
  readonly complianceTags?: readonly string[];
  readonly inputCostPerMillion?: number;
  readonly outputCostPerMillion?: number;
  readonly weight?: number;
}

export interface ApplicationAIModelRoute {
  readonly backends: readonly ApplicationAIBackendDefinition[];
  readonly fallback: 'ordered' | 'disabled';
}

export interface ApplicationEnvoyAIGatewayProvider {
  readonly kind: 'envoy-ai-gateway';
  readonly production: true;
  readonly name?: string;
  readonly namespace?: string;
  readonly provision?: boolean;
  readonly versions: {
    readonly envoyGateway: string;
    readonly aiGateway: string;
    readonly gatewayApi: string;
  };
  readonly models: Readonly<Record<string, ApplicationAIModelRoute>>;
  readonly requestPolicy?: {
    readonly timeoutMs?: number;
    readonly maximumBodyBytes?: number;
    readonly maximumConcurrency?: number;
    readonly retries?: number;
  };
  readonly telemetry?: {
    readonly tracing?: boolean;
    readonly usage?: boolean;
    readonly cost?: boolean;
    readonly redactBodies?: boolean;
  };
  readonly exposure?: {
    readonly serviceName?: string;
    readonly tlsSecretName?: string;
    readonly hostnames?: readonly string[];
  };
}

export type ApplicationAIProvider =
  | ApplicationAIDeterministicProvider
  | ApplicationEnvoyAIGatewayProvider;

export const AIBackend = Object.freeze({
  openAI(
    name: string,
    options: Omit<ApplicationAIBackendDefinition, 'apiVersion' | 'name' | 'providerClass'>,
  ): ApplicationAIBackendDefinition {
    return backend(name, 'openai', options);
  },
  anthropic(
    name: string,
    options: Omit<ApplicationAIBackendDefinition, 'apiVersion' | 'name' | 'providerClass'>,
  ): ApplicationAIBackendDefinition {
    return backend(name, 'anthropic', options);
  },
  bedrock(
    name: string,
    options: Omit<ApplicationAIBackendDefinition, 'apiVersion' | 'name' | 'providerClass'>,
  ): ApplicationAIBackendDefinition {
    return backend(name, 'bedrock', options);
  },
  openAICompatible(
    name: string,
    options: Omit<ApplicationAIBackendDefinition, 'apiVersion' | 'name' | 'providerClass'>,
  ): ApplicationAIBackendDefinition {
    return backend(name, 'openai-compatible', options);
  },
});

export interface ApplicationAIAgentOptions {
  readonly identity: {
    readonly kind: 'applicationServiceIdentity';
    readonly name: string;
    readonly identity: ApplicationIdentityReference;
  };
  readonly model: ApplicationAIModelDefinition;
  readonly instructions: string | ((context: JsonObject) => string);
  readonly tools: readonly unknown[];
  readonly responseSchemaDigest?: string;
  readonly budgets?: {
    readonly maximumInputTokens?: number;
    readonly maximumOutputTokens?: number;
    readonly maximumCostMicrounits?: number;
    readonly timeoutMs?: number;
  };
  readonly executionPolicy?: {
    readonly callerDelegation?: 'forbidden' | 'declared';
    readonly uncertainCompletion?: 'escalate' | 'retry-if-replay-safe';
  };
}

export interface ApplicationAIAgentRequest {
  readonly threadId: string;
  readonly messages: unknown[];
  readonly resume?: unknown;
}

export interface ApplicationAIAgentRuntimeContext<TTanStack = unknown> {
  readonly runId: string;
  readonly invocationId: string;
  readonly principal: ApplicationExecutionPrincipal;
  readonly signal: AbortSignal;
  readonly tanstack: TTanStack;
}

export type ApplicationAIAgentHandler<
  TRequest extends ApplicationAIAgentRequest = ApplicationAIAgentRequest,
  TResult = unknown,
  TTanStack = unknown,
> = (
  request: TRequest,
  context: ApplicationAIAgentRuntimeContext<TTanStack>,
) => TResult | Promise<TResult>;

export interface ApplicationAIAgentDefinition<
  TName extends string = string,
  TRequest extends ApplicationAIAgentRequest = ApplicationAIAgentRequest,
  TResult = unknown,
> {
  readonly apiVersion: 'applik8s.aiAgent/v1alpha1';
  readonly name: TName;
  readonly options: ApplicationAIAgentOptions;
  readonly handler: ApplicationAIAgentHandler<TRequest, TResult>;
  readonly sourceLocation?: SourceLocation;
}

export interface ApplicationAICompatibilityTuple {
  readonly apiVersion: 'applik8s.aiCompatibility/v1alpha1';
  readonly tanstackAI: string;
  readonly tanstackAIClient: string;
  readonly tanstackAIReact: string;
  readonly tanstackAIPersistence: string | 'unreleased';
  readonly agUi: string;
  readonly applik8sAdapter: typeof applicationAIAdapterRevision;
  readonly envoyGateway: string;
  readonly envoyAIGateway: string;
  readonly providerAdapters: Readonly<Record<string, string>>;
}

export interface ApplicationAIConversationRecord {
  readonly apiVersion: 'applik8s.aiConversation/v1alpha1';
  readonly id: string;
  readonly principalScope: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ApplicationAIMessageRecord {
  readonly apiVersion: 'applik8s.aiMessage/v1alpha1';
  readonly id: string;
  readonly conversationId: string;
  readonly revision: number;
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: JsonValue;
  readonly state: 'committed' | 'rejected';
  readonly invocationId?: string;
  readonly createdAt: string;
}

export interface ApplicationAIProtocolRunRecord {
  readonly apiVersion: 'applik8s.aiProtocolRun/v1alpha1';
  readonly id: string;
  readonly conversationId: string;
  readonly principalScope: string;
  readonly status: 'running' | 'interrupted' | 'completed' | 'failed' | 'cancelled';
  readonly agentRunId?: string;
  readonly invocationId?: string;
  readonly startedAt: string;
  readonly updatedAt: string;
}

export interface ApplicationAIRunEventRecord {
  readonly apiVersion: 'applik8s.aiRunEvent/v1alpha1';
  readonly runId: string;
  readonly sequence: number;
  readonly type: string;
  readonly payload: JsonObject;
  readonly visibility: 'browser' | 'audit-only';
  readonly createdAt: string;
}

export interface ApplicationAIUsageRecord {
  readonly apiVersion: 'applik8s.aiUsage/v1alpha1';
  readonly invocationId: string;
  readonly attemptId: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly reasoningTokens?: number;
  readonly costMicrounits?: number;
  readonly pricingRevision?: string;
  readonly confidence: 'provider-reported' | 'calculated' | 'unknown';
}

export interface ApplicationAIArtifactRecord {
  readonly apiVersion: 'applik8s.aiArtifact/v1alpha1';
  readonly id: string;
  readonly runId: string;
  readonly invocationId?: string;
  readonly kind: string;
  readonly mediaType: string;
  readonly object: {
    readonly store: string;
    readonly key: string;
    readonly sha256: string;
    readonly size: number;
  };
  readonly provenance: JsonObject;
}

export interface ApplicationAIEvaluationRecord {
  readonly apiVersion: 'applik8s.aiEvaluation/v1alpha1';
  readonly id: string;
  readonly runId: string;
  readonly datasetRevision: string;
  readonly scorerRevision: string;
  readonly score: number;
  readonly evidence: JsonObject;
  readonly createdAt: string;
}

export type ApplicationAIAttemptState =
  | 'reserved'
  | 'dispatching'
  | 'streaming'
  | 'provider-completed'
  | 'provider-failed'
  | 'completion-uncertain'
  | 'canonical-committed'
  | 'cancelled';

export type ApplicationAIAttemptRecoveryClass =
  | 'joinable'
  | 'replay-safe'
  | 'uncertain'
  | 'terminal';

export interface ApplicationAIResolvedRoute {
  readonly policyRevision: string;
  readonly logicalModel: string;
  readonly providerClass: string;
  readonly backend: string;
  readonly concreteModel: string;
  readonly concreteModelVersion?: string;
  readonly capabilities: readonly ApplicationAICapabilityName[];
  readonly route: string;
  readonly pricingRevision?: string;
  readonly fallbackChain: readonly string[];
}

export interface ApplicationAIInvocationRecord {
  readonly apiVersion: 'applik8s.aiInvocation/v1alpha1';
  readonly id: string;
  readonly conversationId: string;
  readonly protocolRunId: string;
  readonly agentRunId: string;
  readonly logicalModel: string;
  readonly requestHash: string;
  readonly admittedPrincipal: ApplicationExecutionPrincipal;
  readonly authorityRevision: string;
  readonly state: 'active' | 'completed' | 'failed' | 'uncertain' | 'cancelled';
  readonly currentAttemptId?: string;
  readonly canonicalMessageId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ApplicationAIAttemptRecord {
  readonly apiVersion: 'applik8s.aiAttempt/v1alpha1';
  readonly id: string;
  readonly invocationId: string;
  readonly ordinal: number;
  readonly state: ApplicationAIAttemptState;
  readonly recovery: ApplicationAIAttemptRecoveryClass;
  readonly requestHash: string;
  readonly redactedRequestMetadata: JsonObject;
  readonly route: ApplicationAIResolvedRoute;
  readonly providerRequestId?: string;
  readonly streamFrontier: number;
  readonly deliveryLogReference?: string;
  readonly usage?: ApplicationAIUsageRecord;
  readonly terminalReason?: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ApplicationAIToolProposalRecord {
  readonly apiVersion: 'applik8s.aiToolProposal/v1alpha1';
  readonly id: string;
  readonly invocationId: string;
  readonly attemptId: string;
  readonly providerToolCallId: string;
  readonly operationId: ApplicationOperationId;
  readonly operationVersion: string;
  readonly argumentsHash: string;
  readonly commandId: string;
  readonly grantReservationId?: string;
  readonly createdAt: string;
}

export interface ApplicationAIStreamDelta {
  readonly attemptId: string;
  readonly sequence: number;
  readonly event: JsonObject;
  readonly createdAt: string;
}

function capability<const TName extends ApplicationAICapabilityName>(
  name: TName,
): ApplicationAICapability<TName> {
  return Object.freeze({
    apiVersion: 'applik8s.aiCapability/v1alpha1',
    name,
  });
}

const capabilities = {
  chat: capability('chat'),
  tools: capability('tools'),
  streaming: capability('streaming'),
  structuredOutput: capability('structured-output'),
  reasoning: capability('reasoning'),
  textInput: capability('text-input'),
  textOutput: capability('text-output'),
  imageInput: capability('image-input'),
  imageOutput: capability('image-output'),
  audioInput: capability('audio-input'),
  audioOutput: capability('audio-output'),
} as const;

const aiTokenBase: Pick<
  ApplicationAIProviderToken,
  'name' | 'description' | 'contract' | 'accepts'
> = {
  name: 'AI',
  description:
    'Provider-neutral logical inference routing with durable attempts, usage, and constrained fallback.',
  contract: {
    apiVersion: 'applik8s.provider/v1alpha1',
    interface: 'AI',
    version: 'v1alpha1',
    requirements: ['durableAttemptStore', 'executionPrincipal'],
    guarantees: [
      'logicalModels',
      'physicalAttemptIdentity',
      'uncertainCompletion',
      'usageProvenance',
      'serverOnlyCredentials',
    ],
  },
  accepts: isApplicationAIProvider,
};

function named<const TName extends string>(
  name: TName,
): ApplicationAIQualifiedProviderToken<ApplicationAIProvider, TName> {
  const normalized = stableName(name, 'AI provider qualifier');
  const qualification = Object.freeze({
    apiVersion: 'applik8s.providerQualification/v1alpha1' as const,
    capability: 'AI',
    name,
    compatibilityRevision: 'v1alpha1',
    key: `AI@v1alpha1:${normalized}` as const,
  });
  const qualified = {
    ...AI,
    kind: 'applicationQualifiedProvider' as const,
    base: AI,
    qualification,
  };
  return Object.freeze(qualified);
}

const aiProviderToken: ApplicationAIProviderToken = {
  ...aiTokenBase,
  ...capabilities,
  named,
  model(name, options) {
    const normalized = stableName(name, 'logical AI model');
    if (options.capabilities.length === 0) {
      throw new Error(`Logical AI model ${normalized} requires at least one capability.`);
    }
    const names = options.capabilities.map((candidate) => candidate.name);
    if (new Set(names).size !== names.length) {
      throw new Error(`Logical AI model ${normalized} contains duplicate capabilities.`);
    }
    const constraints = validateConstraints(options.constraints ?? {});
    return Object.freeze({
      apiVersion: 'applik8s.aiModel/v1alpha1',
      name,
      capabilities: options.capabilities,
      constraints,
      ...(options.inference
        ? { inference: { qualification: options.inference.qualification } }
        : {}),
    });
  },
  deterministic(options = {}) {
    if (
      options.latencyMs !== undefined
      && (!Number.isSafeInteger(options.latencyMs) || options.latencyMs < 0)
    ) {
      throw new Error('AI.deterministic({ latencyMs }) must be a non-negative integer.');
    }
    return Object.freeze({
      kind: 'ai-deterministic',
      production: false,
      ...options,
    });
  },
  envoy(options) {
    validateEnvoyProvider(options);
    return Object.freeze({
      kind: 'envoy-ai-gateway',
      production: true,
      ...options,
    });
  },
};

export const AI: ApplicationAIProviderToken = Object.freeze(aiProviderToken);

export function defineApplicationAIAgent<
  const TName extends string,
  TRequest extends ApplicationAIAgentRequest,
  TResult,
>(
  name: TName,
  options: ApplicationAIAgentOptions,
  handler: ApplicationAIAgentHandler<TRequest, TResult>,
  sourceLocation?: SourceLocation,
): ApplicationAIAgentDefinition<TName, TRequest, TResult> {
  stableName(name, 'agent');
  if (typeof handler !== 'function') {
    throw new Error(`Agent ${name} requires a serializable execution closure.`);
  }
  if (typeof options.instructions !== 'string' && typeof options.instructions !== 'function') {
    throw new Error(`Agent ${name} instructions must be a string or server-side function.`);
  }
  if (options.tools.length === 0) {
    throw new Error(`Agent ${name} requires at least one declared tool.`);
  }
  return Object.freeze({
    apiVersion: 'applik8s.aiAgent/v1alpha1',
    name,
    options: Object.freeze({
      ...options,
      tools: Object.freeze([...options.tools]),
    }),
    handler,
    ...(sourceLocation ? { sourceLocation } : {}),
  });
}

export function isApplicationAIProvider(value: unknown): value is ApplicationAIProvider {
  if (!value || typeof value !== 'object') return false;
  const kind = Reflect.get(value, 'kind');
  if (kind === 'ai-deterministic') return Reflect.get(value, 'production') === false;
  if (kind !== 'envoy-ai-gateway' || Reflect.get(value, 'production') !== true) return false;
  const models = Reflect.get(value, 'models');
  return Boolean(models && typeof models === 'object' && !Array.isArray(models));
}

function backend(
  name: string,
  providerClass: ApplicationAIBackendDefinition['providerClass'],
  options: Omit<ApplicationAIBackendDefinition, 'apiVersion' | 'name' | 'providerClass'>,
): ApplicationAIBackendDefinition {
  stableName(name, 'AI backend');
  if (!options.model.trim()) throw new Error(`AI backend ${name} model must not be empty.`);
  if (options.endpoint) {
    const endpoint = new URL(options.endpoint);
    if (endpoint.protocol !== 'https:') {
      throw new Error(`AI backend ${name} endpoint must use HTTPS.`);
    }
  }
  return Object.freeze({
    apiVersion: 'applik8s.aiBackend/v1alpha1',
    name,
    providerClass,
    ...options,
  });
}

function validateConstraints(
  value: ApplicationAIModelConstraints,
): ApplicationAIModelConstraints {
  for (const [name, amount] of [
    ['maximumInputCostPerMillion', value.maximumInputCostPerMillion],
    ['maximumOutputCostPerMillion', value.maximumOutputCostPerMillion],
    ['minimumContextTokens', value.minimumContextTokens],
    ['minimumOutputTokens', value.minimumOutputTokens],
  ] as const) {
    if (amount !== undefined && (!Number.isFinite(amount) || amount < 0)) {
      throw new Error(`Logical AI model constraint ${name} must be non-negative.`);
    }
  }
  return Object.freeze(structuredClone(value));
}

function validateEnvoyProvider(
  options: Omit<ApplicationEnvoyAIGatewayProvider, 'kind' | 'production'>,
): void {
  for (const [name, version] of Object.entries(options.versions)) {
    if (!version.trim() || version === 'latest') {
      throw new Error(`AI.envoy versions.${name} must be an explicit pinned revision.`);
    }
  }
  const routes = Object.entries(options.models);
  if (routes.length === 0) throw new Error('AI.envoy({ models }) requires at least one logical route.');
  for (const [model, route] of routes) {
    stableName(model, 'AI logical route');
    if (route.backends.length === 0) {
      throw new Error(`AI.envoy logical route ${model} requires at least one backend.`);
    }
    const names = route.backends.map((candidate) => candidate.name);
    if (new Set(names).size !== names.length) {
      throw new Error(`AI.envoy logical route ${model} contains duplicate backend names.`);
    }
  }
}

function stableName(value: string, subject: string): string {
  const normalized = value.trim();
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(normalized)) {
    throw new Error(`${subject} ${JSON.stringify(value)} must be a stable lower-case identifier.`);
  }
  return normalized;
}
