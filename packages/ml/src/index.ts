// typecast-file-boundary: runtime schema validation establishes generic input/output contracts before values cross the predictive-provider boundary.
import {
  bindApplicationProviderDependencies,
  bindApplicationProviderOperation,
  defineApplicationProvider,
  type ApplicationQualifiedProviderToken,
} from '@applik8s/applik8s';
import {
  canonicalJsonV1String,
  type ApplicationMessageContractSchema,
  type ApplicationProviderRuntimeContract,
  type JsonObject,
  type JsonValue,
} from '@applik8s/core';
import { normalizeSchema, type SchemaInput } from '@applik8s/sdk';
import type { Type } from 'arktype';
import {
  invokeApplicationMLBatch,
  invokeApplicationMLPrediction,
} from './runtime.js';
import {
  applicationMLProviderNodeId,
  applicationMLRuntimeEnvironmentName,
} from './runtime-contract.js';

export const applicationMLProtocolRevision = 'applik8s.ml/v1alpha1' as const;

export const predict = 'predict' as const;
export const batchPrediction = 'batchPrediction' as const;
export type ApplicationMLCapability = typeof predict | typeof batchPrediction;

export type ApplicationMLSchema<T extends object> = Type<T> | SchemaInput<T>;

export interface ApplicationMLArtifact {
  readonly apiVersion: 'applik8s.mlArtifact/v1alpha1';
  readonly digest: `sha256:${string}`;
  readonly format: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly modelVersion: string;
  readonly source?: string;
  readonly signature?: {
    readonly identity: string;
    readonly digest: `sha256:${string}`;
  };
}

export interface ApplicationMLRequirements {
  readonly deterministic?: boolean;
  readonly locality?: 'local' | 'cluster' | 'remote';
  readonly dataResidency?: readonly string[];
  readonly maximumBatchSize?: number;
  readonly timeoutMs?: number;
}

export interface ApplicationMLModelDefinition<TInput extends object, TOutput extends object> {
  readonly apiVersion: 'applik8s.mlModel/v1alpha1';
  readonly id: `${string}.v${number}`;
  readonly name: string;
  readonly version: `v${number}`;
  readonly input: ApplicationMessageContractSchema;
  readonly output: ApplicationMessageContractSchema;
  readonly capabilities: readonly ApplicationMLCapability[];
  readonly requirements: ApplicationMLRequirements;
  readonly maturity: 'beta';
  /** Runtime-only schemas are non-enumerable on the public binding. */
  readonly runtime?: {
    readonly input: ApplicationMLSchema<TInput>;
    readonly output: ApplicationMLSchema<TOutput>;
  };
}

export interface ApplicationMLPredictionContext {
  readonly modelId: string;
  readonly invocationId: string;
  readonly signal: AbortSignal;
}

export interface ApplicationMLPredictionReceipt {
  readonly apiVersion: 'applik8s.mlPredictionReceipt/v1alpha1';
  readonly invocationId: string;
  readonly logicalModel: string;
  readonly modelVersion: string;
  readonly artifactDigest: `sha256:${string}`;
  readonly provider: string;
  readonly providerVersion: string;
  readonly servingIdentity: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly redaction: 'features-and-output-omitted';
}

export interface ApplicationMLPrediction<TOutput extends object> {
  readonly output: TOutput;
  readonly receipt: ApplicationMLPredictionReceipt;
}

export type ApplicationMLPredictionFailureCode =
  | 'ML_INPUT_INVALID'
  | 'ML_OUTPUT_INVALID'
  | 'ML_PROVIDER_FAILED'
  | 'ML_TIMEOUT'
  | 'ML_MODEL_VERSION_UNAVAILABLE'
  | 'ML_ARTIFACT_INTEGRITY_FAILED'
  | 'ML_DATA_RESIDENCY_UNSATISFIED';

export interface ApplicationMLPredictionFailure {
  readonly code: ApplicationMLPredictionFailureCode;
  readonly message: string;
  readonly retryable: boolean;
}

export class ApplicationMLPredictionError extends Error {
  constructor(readonly failure: ApplicationMLPredictionFailure) {
    super(failure.message);
    this.name = 'ApplicationMLPredictionError';
  }
}

export type ApplicationMLBatchItem<TOutput extends object> =
  | { readonly index: number; readonly status: 'succeeded'; readonly output: TOutput; readonly receipt: ApplicationMLPredictionReceipt }
  | { readonly index: number; readonly status: 'failed'; readonly failure: ApplicationMLPredictionFailure };

export interface ApplicationMLBatchResult<TOutput extends object> {
  readonly items: readonly ApplicationMLBatchItem<TOutput>[];
}

export interface ApplicationMLBatchOptions {
  readonly partialFailure: 'collect' | 'fail';
  readonly timeoutMs?: number;
}

export class ApplicationMLBatchPartialFailureError<TOutput extends object> extends Error {
  readonly code = 'ML_BATCH_PARTIAL_FAILURE';
  constructor(readonly result: ApplicationMLBatchResult<TOutput>) {
    super('One or more indexed ML batch predictions failed.');
    this.name = 'ApplicationMLBatchPartialFailureError';
  }
}

export interface ApplicationMLProvider<TInput extends object = object, TOutput extends object = object> {
  readonly kind: string;
  readonly provider: string;
  readonly providerVersion: string;
  readonly servingIdentity: string;
  readonly artifact: ApplicationMLArtifact;
  readonly capabilities: readonly ApplicationMLCapability[];
  readonly deterministic: boolean;
  readonly locality: 'local' | 'cluster' | 'remote';
  readonly maximumBatchSize: number;
  predict(input: TInput, context: ApplicationMLPredictionContext): Promise<TOutput>;
}

export type ApplicationMLModel<TInput extends object, TOutput extends object> =
  ApplicationQualifiedProviderToken<ApplicationMLProvider<TInput, TOutput>>
  & ((input: TInput, options?: { readonly timeoutMs?: number }) => Promise<ApplicationMLPrediction<TOutput>>)
  & {
    readonly definition: ApplicationMLModelDefinition<TInput, TOutput>;
    batch(inputs: readonly TInput[], options: ApplicationMLBatchOptions): Promise<ApplicationMLBatchResult<TOutput>>;
  };

export interface ApplicationMLDeterministicOptions<TInput extends object, TOutput extends object> {
  readonly artifact: ApplicationMLArtifact;
  readonly output?: TOutput;
  readonly cases?: readonly { readonly input: TInput; readonly output: TOutput }[];
  readonly provider?: string;
  readonly providerVersion?: string;
  readonly servingIdentity?: string;
  readonly maximumBatchSize?: number;
  readonly latencyMs?: number;
}

const modelMetadataSymbol = Symbol.for('applik8s.ml.model');
const modelProviderRuntimeSymbol = Symbol.for('applik8s.ml.providerRuntime');

interface ApplicationMLPortableProviderConfiguration {
  readonly kind: 'deterministic';
  readonly artifact: ApplicationMLArtifact;
  readonly output?: object;
  readonly cases: readonly { readonly input: object; readonly output: object }[];
  readonly provider: string;
  readonly providerVersion: string;
  readonly servingIdentity: string;
  readonly maximumBatchSize: number;
  readonly latencyMs: number;
}

export const ML = Object.freeze({
  predict,
  batchPrediction,
  model<TInput extends object, TOutput extends object>(
    id: `${string}.v${number}`,
    contract: {
      readonly input: ApplicationMLSchema<TInput>;
      readonly output: ApplicationMLSchema<TOutput>;
    },
    options: {
      readonly capabilities: readonly ApplicationMLCapability[];
      readonly requirements?: ApplicationMLRequirements;
    },
  ): ApplicationMLModel<TInput, TOutput> {
    return defineApplicationMLModel(id, contract, options);
  },
  artifact(options: Omit<ApplicationMLArtifact, 'apiVersion'>): ApplicationMLArtifact {
    assertArtifact(options);
    return Object.freeze({ apiVersion: 'applik8s.mlArtifact/v1alpha1', ...options });
  },
  deterministic<TInput extends object, TOutput extends object>(
    options: ApplicationMLDeterministicOptions<TInput, TOutput>,
  ): ApplicationMLProvider<TInput, TOutput> {
    assertArtifact(options.artifact);
    if (options.output === undefined && (!options.cases || options.cases.length === 0)) {
      throw new Error('ML.deterministic(...) requires output or at least one exact input case.');
    }
    const maximumBatchSize = positiveInteger(options.maximumBatchSize ?? 128, 'maximumBatchSize');
    const latencyMs = nonNegativeInteger(options.latencyMs ?? 0, 'latencyMs');
    const cases = new Map(
      (options.cases ?? []).map((entry) => [canonicalJsonV1String(entry.input as JsonValue), structuredClone(entry.output)]),
    );
    const provider: ApplicationMLProvider<TInput, TOutput> = {
      kind: 'ml-deterministic' as const,
      provider: options.provider ?? 'local-deterministic',
      providerVersion: options.providerVersion ?? 'v1',
      servingIdentity: options.servingIdentity ?? options.artifact.digest,
      artifact: structuredClone(options.artifact),
      capabilities: [predict, batchPrediction] as const,
      deterministic: true as const,
      locality: 'local' as const,
      maximumBatchSize,
      async predict(input: TInput, context: ApplicationMLPredictionContext): Promise<TOutput> {
        if (latencyMs > 0) await abortableDelay(latencyMs, context.signal);
        const matched = cases.get(canonicalJsonV1String(input as JsonValue));
        const output = matched ?? options.output;
        if (output === undefined) {
          throw new ApplicationMLPredictionError({
            code: 'ML_PROVIDER_FAILED',
            message: `Deterministic ML provider has no fixture for ${context.modelId}.`,
            retryable: false,
          });
        }
        return structuredClone(output);
      },
    };
    Object.defineProperty(provider, modelProviderRuntimeSymbol, {
      enumerable: false,
      value: Object.freeze({
        kind: 'deterministic' as const,
        artifact: structuredClone(options.artifact),
        ...(options.output === undefined ? {} : { output: structuredClone(options.output) }),
        cases: Object.freeze((options.cases ?? []).map((entry) => Object.freeze({
          input: structuredClone(entry.input),
          output: structuredClone(entry.output),
        }))),
        provider: options.provider ?? 'local-deterministic',
        providerVersion: options.providerVersion ?? 'v1',
        servingIdentity: options.servingIdentity ?? options.artifact.digest,
        maximumBatchSize,
        latencyMs,
      } satisfies ApplicationMLPortableProviderConfiguration),
    });
    return Object.freeze(provider);
  },
});

function defineApplicationMLModel<TInput extends object, TOutput extends object>(
  id: `${string}.v${number}`,
  contract: { readonly input: ApplicationMLSchema<TInput>; readonly output: ApplicationMLSchema<TOutput> },
  options: { readonly capabilities: readonly ApplicationMLCapability[]; readonly requirements?: ApplicationMLRequirements },
): ApplicationMLModel<TInput, TOutput> {
  const identity = parseModelId(id);
  const capabilities = normalizeCapabilities(options.capabilities);
  const requirements = normalizeRequirements(options.requirements ?? {});
  const input = normalizeMLSchema(contract.input, `${id}.input`);
  const output = normalizeMLSchema(contract.output, `${id}.output`);
  const definitionValue = {
    apiVersion: 'applik8s.mlModel/v1alpha1',
    id,
    ...identity,
    input: input.contract,
    output: output.contract,
    capabilities,
    requirements,
    maturity: 'beta',
  } as ApplicationMLModelDefinition<TInput, TOutput>;
  Object.defineProperty(definitionValue, 'runtime', {
    value: Object.freeze({ input: input.runtime, output: output.runtime }),
    enumerable: false,
  });
  const definition = Object.freeze(definitionValue);
  const base = defineApplicationProvider<ApplicationMLProvider<TInput, TOutput>>({
    interface: 'MLModel',
    version: 'v1alpha1',
    description: `Predictive provider for ${id}.`,
    requirements: ['content-addressed artifact', 'typed prediction receipts', ...capabilities],
    guarantees: ['input/output schema validation', 'redacted provenance evidence'],
    runtime: {
      operations: {
        predict: {
          module: '@applik8s/ml/runtime',
          export: 'predictApplicationML',
          access: 'none',
        },
        batch: {
          module: '@applik8s/ml/runtime',
          export: 'batchApplicationML',
          access: 'none',
        },
      },
      bind(implementation) {
        const provider = applicationMLPortableProviderConfiguration(implementation);
        if (!provider) {
          throw new Error(`ML provider ${implementation.kind} has no portable managed-worker runtime binding.`);
        }
        const runtime: ApplicationProviderRuntimeContract = {
          env: {
            [applicationMLRuntimeEnvironmentName(applicationMLProviderNodeId(id))]: JSON.stringify({
              definition,
              provider,
            }),
          },
        };
        return runtime;
      },
    },
    accepts(value): value is ApplicationMLProvider<TInput, TOutput> {
      return isApplicationMLProvider(value, capabilities, requirements);
    },
  });
  const token = base.named(id);
  const call = async (value: TInput, invocationOptions?: { readonly timeoutMs?: number }) =>
    invokeApplicationMLPrediction(definition, value, invocationOptions);
  const batch = async (values: readonly TInput[], batchOptions: ApplicationMLBatchOptions) =>
    invokeApplicationMLBatch(definition, values, batchOptions);
  bindApplicationProviderDependencies(call, [token]);
  bindApplicationProviderOperation(call, {
    member: 'predict',
    ...(token.callableRuntime?.operations.predict
      ? { runtime: token.callableRuntime.operations.predict }
      : {}),
  });
  bindApplicationProviderDependencies(batch, [token]);
  bindApplicationProviderOperation(batch, {
    member: 'batch',
    ...(token.callableRuntime?.operations.batch
      ? { runtime: token.callableRuntime.operations.batch }
      : {}),
  });
  Object.defineProperties(call, {
    kind: { value: token.kind, enumerable: true },
    name: { value: token.name, configurable: true },
    description: { value: token.description, enumerable: true },
    contract: { value: token.contract, enumerable: true },
    accepts: { value: token.accepts, enumerable: true },
    base: { value: token.base, enumerable: true },
    qualification: { value: token.qualification, enumerable: true },
    callableRuntime: { value: token.callableRuntime, enumerable: true },
    definition: { value: definition, enumerable: true },
    batch: { value: batch, enumerable: true },
    [modelMetadataSymbol]: { value: definition },
    __runtimeSchemas: { value: Object.freeze({ input: input.runtime, output: output.runtime }) },
  });
  return Object.freeze(call) as ApplicationMLModel<TInput, TOutput>;
}

function applicationMLPortableProviderConfiguration(
  provider: ApplicationMLProvider,
): ApplicationMLPortableProviderConfiguration | undefined {
  const value = Reflect.get(provider, modelProviderRuntimeSymbol);
  return value && typeof value === 'object'
    ? value as ApplicationMLPortableProviderConfiguration
    : undefined;
}

function normalizeMLSchema<T extends object>(schema: ApplicationMLSchema<T>, name: string) {
  const runtime = normalizeSchema(schema as SchemaInput<T>, name);
  const emitted = runtime.emitJsonSchema();
  if (!emitted.ok) throw new Error(`ML schema ${name} is not portable: ${emitted.error.message}`);
  return {
    runtime,
    contract: Object.freeze({ kind: 'declared', runtime: 'arktype', jsonSchema: emitted.value.schema }) as ApplicationMessageContractSchema,
  };
}

function parseModelId(id: string): { readonly name: string; readonly version: `v${number}` } {
  const match = /^(?<name>[a-z][a-z0-9.-]*)\.(?<version>v[1-9][0-9]*)$/.exec(id);
  if (!match?.groups) throw new Error(`ML model id ${JSON.stringify(id)} must end in a stable version such as risk-score.v1.`);
  return { name: match.groups.name!, version: match.groups.version as `v${number}` };
}

function normalizeCapabilities(values: readonly ApplicationMLCapability[]): readonly ApplicationMLCapability[] {
  if (values.length === 0) throw new Error('ML.model(...) requires at least ML.predict.');
  const result = [...new Set(values)];
  if (!result.includes(predict)) throw new Error('ML.model(...) requires ML.predict.');
  if (result.some((value) => value !== predict && value !== batchPrediction)) throw new Error('ML.model(...) received an unknown capability.');
  return Object.freeze(result);
}

function normalizeRequirements(value: ApplicationMLRequirements): ApplicationMLRequirements {
  return Object.freeze({
    ...(value.deterministic !== undefined ? { deterministic: value.deterministic } : {}),
    ...(value.locality ? { locality: value.locality } : {}),
    ...(value.dataResidency ? { dataResidency: Object.freeze([...value.dataResidency]) } : {}),
    ...(value.maximumBatchSize !== undefined ? { maximumBatchSize: positiveInteger(value.maximumBatchSize, 'maximumBatchSize') } : {}),
    ...(value.timeoutMs !== undefined ? { timeoutMs: positiveInteger(value.timeoutMs, 'timeoutMs') } : {}),
  });
}

function isApplicationMLProvider(
  value: unknown,
  capabilities: readonly ApplicationMLCapability[],
  requirements: ApplicationMLRequirements,
): value is ApplicationMLProvider {
  if (!value || typeof value !== 'object') return false;
  const providedCapabilities = Reflect.get(value, 'capabilities');
  if (!Array.isArray(providedCapabilities) || capabilities.some((candidate) => !providedCapabilities.includes(candidate))) return false;
  if (requirements.deterministic === true && Reflect.get(value, 'deterministic') !== true) return false;
  if (requirements.locality && Reflect.get(value, 'locality') !== requirements.locality) return false;
  if (requirements.maximumBatchSize && Reflect.get(value, 'maximumBatchSize') < requirements.maximumBatchSize) return false;
  try {
    assertArtifact(Reflect.get(value, 'artifact'));
  } catch {
    return false;
  }
  return typeof Reflect.get(value, 'predict') === 'function';
}

function assertArtifact(value: unknown): asserts value is ApplicationMLArtifact | Omit<ApplicationMLArtifact, 'apiVersion'> {
  if (!value || typeof value !== 'object') throw new Error('ML artifact must be an object.');
  if (!/^sha256:[a-f0-9]{64}$/.test(String(Reflect.get(value, 'digest')))) throw new Error('ML artifact digest must be a complete sha256 digest.');
  if (!String(Reflect.get(value, 'format') ?? '').trim()) throw new Error('ML artifact format must not be empty.');
  if (!String(Reflect.get(value, 'mediaType') ?? '').trim()) throw new Error('ML artifact mediaType must not be empty.');
  positiveInteger(Number(Reflect.get(value, 'sizeBytes')), 'artifact.sizeBytes');
  if (!String(Reflect.get(value, 'modelVersion') ?? '').trim()) throw new Error('ML artifact modelVersion must not be empty.');
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`ML ${name} must be a positive integer.`);
  return value;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`ML ${name} must be a non-negative integer.`);
  return value;
}

async function abortableDelay(durationMs: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, durationMs);
    signal.addEventListener('abort', () => {
      clearTimeout(timeout);
      reject(signal.reason);
    }, { once: true });
  });
}

export function applicationMLModelDefinition(value: unknown): ApplicationMLModelDefinition<object, object> | undefined {
  if (typeof value !== 'function') return undefined;
  const definition = Reflect.get(value, modelMetadataSymbol);
  return definition && typeof definition === 'object' && Reflect.get(definition, 'apiVersion') === 'applik8s.mlModel/v1alpha1'
    ? definition as ApplicationMLModelDefinition<object, object>
    : undefined;
}
