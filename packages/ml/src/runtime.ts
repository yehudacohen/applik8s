// typecast-file-boundary: model-owned runtime schemas validate all inputs and outputs before restoring their generic types.
import { currentApplicationProviderOperation } from '@applik8s/applik8s/provider-telemetry-runtime';
import type { JsonObject, RuntimeSchema } from '@applik8s/core';
import { toRuntimeSchema } from '@applik8s/sdk/schema-runtime';
import type {
  ApplicationMLBatchOptions,
  ApplicationMLBatchResult,
  ApplicationMLModelDefinition,
  ApplicationMLPrediction,
  ApplicationMLPredictionFailure,
  ApplicationMLPredictionReceipt,
  ApplicationMLProvider,
} from './index.js';
import {
  ApplicationMLBatchPartialFailureError,
  ApplicationMLPredictionError,
  ML,
} from './index.js';
import { applicationMLRuntimeEnvironmentName } from './runtime-contract.js';

type ApplicationMLResolver = (
  definition: ApplicationMLModelDefinition<object, object>,
) => ApplicationMLProvider<object, object> | Promise<ApplicationMLProvider<object, object>>;

let runtimeResolver: ApplicationMLResolver | undefined;

/** Runtime host seam. Application code normally relies on compiler hydration, not this function. */
export function installApplicationMLRuntimeResolver<
  TInput extends object,
  TOutput extends object,
>(resolver: (
  definition: ApplicationMLModelDefinition<TInput, TOutput>,
) => ApplicationMLProvider<TInput, TOutput> | Promise<ApplicationMLProvider<TInput, TOutput>>): () => void {
  const previous = runtimeResolver;
  runtimeResolver = resolver as unknown as ApplicationMLResolver;
  return () => { runtimeResolver = previous; };
}

export async function invokeApplicationMLPrediction<TInput extends object, TOutput extends object>(
  definition: ApplicationMLModelDefinition<TInput, TOutput>,
  input: TInput,
  options: { readonly timeoutMs?: number } = {},
): Promise<ApplicationMLPrediction<TOutput>> {
  const provider = await resolveProvider(definition);
  return invokeApplicationMLPredictionWithProvider(definition, provider, input, options);
}

async function invokeApplicationMLPredictionWithProvider<TInput extends object, TOutput extends object>(
  definition: ApplicationMLModelDefinition<TInput, TOutput>,
  provider: ApplicationMLProvider<TInput, TOutput>,
  input: TInput,
  options: { readonly timeoutMs?: number } = {},
): Promise<ApplicationMLPrediction<TOutput>> {
  const schemas = runtimeSchemas(definition);
  const validatedInput = validate(schemas.input, input, 'ML_INPUT_INVALID', `${definition.id} input`);
  const timeoutMs = positiveTimeout(options.timeoutMs ?? definition.requirements.timeoutMs ?? 30_000);
  const controller = new AbortController();
  const invocationId = `ml_${globalThis.crypto.randomUUID()}`;
  const startedAt = new Date().toISOString();
  const timer = setTimeout(() => controller.abort(new Error('ML prediction timed out.')), timeoutMs);
  try {
    const output = await provider.predict(validatedInput, {
      modelId: definition.id,
      invocationId,
      signal: controller.signal,
    });
    const validatedOutput = validate(schemas.output, output, 'ML_OUTPUT_INVALID', `${definition.id} output`);
    return Object.freeze({
      output: structuredClone(validatedOutput),
      receipt: receipt(definition, provider, invocationId, startedAt),
    });
  } catch (error) {
    if (error instanceof ApplicationMLPredictionError) throw error;
    if (controller.signal.aborted) {
      throw new ApplicationMLPredictionError({ code: 'ML_TIMEOUT', message: `ML model ${definition.id} exceeded its ${timeoutMs}ms deadline.`, retryable: true });
    }
    throw new ApplicationMLPredictionError({ code: 'ML_PROVIDER_FAILED', message: `ML model ${definition.id} provider execution failed.`, retryable: false });
  } finally {
    clearTimeout(timer);
  }
}

export async function invokeApplicationMLBatch<TInput extends object, TOutput extends object>(
  definition: ApplicationMLModelDefinition<TInput, TOutput>,
  inputs: readonly TInput[],
  options: ApplicationMLBatchOptions,
): Promise<ApplicationMLBatchResult<TOutput>> {
  const provider = await resolveProvider(definition);
  return invokeApplicationMLBatchWithProvider(definition, provider, inputs, options);
}

async function invokeApplicationMLBatchWithProvider<TInput extends object, TOutput extends object>(
  definition: ApplicationMLModelDefinition<TInput, TOutput>,
  provider: ApplicationMLProvider<TInput, TOutput>,
  inputs: readonly TInput[],
  options: ApplicationMLBatchOptions,
): Promise<ApplicationMLBatchResult<TOutput>> {
  if (!definition.capabilities.includes('batchPrediction')) {
    throw new ApplicationMLPredictionError({ code: 'ML_PROVIDER_FAILED', message: `ML model ${definition.id} does not declare batchPrediction.`, retryable: false });
  }
  const maximum = Math.min(provider.maximumBatchSize, definition.requirements.maximumBatchSize ?? provider.maximumBatchSize);
  if (inputs.length > maximum) {
    throw new ApplicationMLPredictionError({ code: 'ML_INPUT_INVALID', message: `ML model ${definition.id} accepts at most ${maximum} inputs per batch.`, retryable: false });
  }
  const items = await Promise.all(inputs.map(async (input, index) => {
    try {
      const prediction = await invokeApplicationMLPredictionWithProvider(
        definition,
        provider,
        input,
        options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs },
      );
      return Object.freeze({ index, status: 'succeeded' as const, ...prediction });
    } catch (error) {
      const failure = error instanceof ApplicationMLPredictionError
        ? error.failure
        : { code: 'ML_PROVIDER_FAILED' as const, message: `ML batch item ${index} failed.`, retryable: false };
      return Object.freeze({ index, status: 'failed' as const, failure });
    }
  }));
  const result = Object.freeze({ items: Object.freeze(items) });
  if (options.partialFailure === 'fail' && items.some((item) => item.status === 'failed')) {
    throw new ApplicationMLBatchPartialFailureError(result);
  }
  return result;
}

/** Compiler-hydrated online prediction operation for managed workers. */
export async function predictApplicationML(
  input: object,
  options: { readonly timeoutMs?: number } = {},
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ApplicationMLPrediction<object>> {
  const { definition, provider } = managedApplicationMLBinding(environment);
  return invokeApplicationMLPredictionWithProvider(definition, provider, input, options);
}

/** Compiler-hydrated indexed batch operation for managed workers. */
export async function batchApplicationML(
  inputs: readonly object[],
  options: ApplicationMLBatchOptions,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ApplicationMLBatchResult<object>> {
  const { definition, provider } = managedApplicationMLBinding(environment);
  return invokeApplicationMLBatchWithProvider(definition, provider, inputs, options);
}

function managedApplicationMLBinding(
  environment: Readonly<Record<string, string | undefined>>,
): {
  readonly definition: ApplicationMLModelDefinition<object, object>;
  readonly provider: ApplicationMLProvider<object, object>;
} {
  const operation = currentApplicationProviderOperation();
  if (!operation || operation.interface !== 'MLModel') {
    throw new ApplicationMLPredictionError({
      code: 'ML_MODEL_VERSION_UNAVAILABLE',
      message: 'Managed ML inference requires one compiler-hydrated MLModel provider identity.',
      retryable: false,
    });
  }
  const name = applicationMLRuntimeEnvironmentName(operation.nodeId);
  const encoded = environment[name];
  if (!encoded) {
    throw new ApplicationMLPredictionError({
      code: 'ML_MODEL_VERSION_UNAVAILABLE',
      message: `Managed ML provider ${operation.nodeId} has no runtime configuration.`,
      retryable: false,
    });
  }
  let value: unknown;
  try {
    value = JSON.parse(encoded);
  } catch {
    throw new ApplicationMLPredictionError({
      code: 'ML_MODEL_VERSION_UNAVAILABLE',
      message: `Managed ML provider ${operation.nodeId} has malformed runtime configuration.`,
      retryable: false,
    });
  }
  const record = objectRecord(value, 'ML runtime configuration');
  const definition = hydrateManagedMLDefinition(
    objectRecord(record.definition, 'ML runtime definition'),
  );
  const configured = objectRecord(record.provider, 'ML runtime provider');
  if (configured.kind !== 'deterministic') {
    throw new ApplicationMLPredictionError({
      code: 'ML_MODEL_VERSION_UNAVAILABLE',
      message: `Managed ML provider kind ${JSON.stringify(configured.kind)} is unsupported.`,
      retryable: false,
    });
  }
  const provider = ML.deterministic({
    artifact: configured.artifact as ApplicationMLProvider['artifact'],
    ...(configured.output === undefined ? {} : { output: objectRecord(configured.output, 'ML deterministic output') }),
    cases: array(configured.cases, 'ML deterministic cases').map((entry) => {
      const item = objectRecord(entry, 'ML deterministic case');
      return {
        input: objectRecord(item.input, 'ML deterministic case input'),
        output: objectRecord(item.output, 'ML deterministic case output'),
      };
    }),
    provider: string(configured.provider, 'ML provider name'),
    providerVersion: string(configured.providerVersion, 'ML provider version'),
    servingIdentity: string(configured.servingIdentity, 'ML serving identity'),
    maximumBatchSize: integer(configured.maximumBatchSize, 'ML maximum batch size'),
    latencyMs: integer(configured.latencyMs, 'ML latency'),
  });
  return { definition, provider };
}

function hydrateManagedMLDefinition(
  value: Readonly<Record<string, unknown>>,
): ApplicationMLModelDefinition<object, object> {
  const id = string(value.id, 'ML model ID') as `${string}.v${number}`;
  const input = objectRecord(value.input, 'ML input contract');
  const output = objectRecord(value.output, 'ML output contract');
  const definition = {
    ...value,
    id,
  } as unknown as ApplicationMLModelDefinition<object, object>;
  Object.defineProperty(definition, 'runtime', {
    enumerable: false,
    value: Object.freeze({
      input: toRuntimeSchema({
        kind: 'jsonSchema',
        ref: { kind: 'jsonSchema', exportName: `${id}.input` },
        schema: objectRecord(input.jsonSchema, 'ML input JSON Schema') as JsonObject,
      }),
      output: toRuntimeSchema({
        kind: 'jsonSchema',
        ref: { kind: 'jsonSchema', exportName: `${id}.output` },
        schema: objectRecord(output.jsonSchema, 'ML output JSON Schema') as JsonObject,
      }),
    }),
  });
  return Object.freeze(definition);
}

function objectRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApplicationMLPredictionError({ code: 'ML_MODEL_VERSION_UNAVAILABLE', message: `${label} must be an object.`, retryable: false });
  }
  return value as Readonly<Record<string, unknown>>;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new ApplicationMLPredictionError({ code: 'ML_MODEL_VERSION_UNAVAILABLE', message: `${label} must be an array.`, retryable: false });
  }
  return value;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApplicationMLPredictionError({ code: 'ML_MODEL_VERSION_UNAVAILABLE', message: `${label} must be a non-empty string.`, retryable: false });
  }
  return value;
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new ApplicationMLPredictionError({ code: 'ML_MODEL_VERSION_UNAVAILABLE', message: `${label} must be a non-negative integer.`, retryable: false });
  }
  return Number(value);
}

async function resolveProvider<TInput extends object, TOutput extends object>(
  definition: ApplicationMLModelDefinition<TInput, TOutput>,
): Promise<ApplicationMLProvider<TInput, TOutput>> {
  if (!runtimeResolver) {
    throw new ApplicationMLPredictionError({
      code: 'ML_MODEL_VERSION_UNAVAILABLE',
      message: `ML model ${definition.id} has no hydrated runtime provider. Bind it with application.provide(...) inside a managed application runtime.`,
      retryable: false,
    });
  }
  const provider = await runtimeResolver(
    definition as unknown as ApplicationMLModelDefinition<object, object>,
  ) as ApplicationMLProvider<TInput, TOutput>;
  if (!provider.capabilities.includes('predict')) {
    throw new ApplicationMLPredictionError({ code: 'ML_MODEL_VERSION_UNAVAILABLE', message: `ML provider ${provider.provider} cannot serve online predictions.`, retryable: false });
  }
  if (definition.requirements.deterministic === true && !provider.deterministic) {
    throw new ApplicationMLPredictionError({ code: 'ML_MODEL_VERSION_UNAVAILABLE', message: `ML provider ${provider.provider} does not satisfy deterministic execution.`, retryable: false });
  }
  if (definition.requirements.locality && provider.locality !== definition.requirements.locality) {
    throw new ApplicationMLPredictionError({ code: 'ML_DATA_RESIDENCY_UNSATISFIED', message: `ML provider ${provider.provider} does not satisfy ${definition.requirements.locality} locality.`, retryable: false });
  }
  return provider;
}

function runtimeSchemas<TInput extends object, TOutput extends object>(definition: ApplicationMLModelDefinition<TInput, TOutput>): {
  readonly input: RuntimeSchema<TInput>;
  readonly output: RuntimeSchema<TOutput>;
} {
  const schemas = Reflect.get(definition, 'runtime');
  if (!schemas || typeof schemas !== 'object') {
    throw new Error(`ML model ${definition.id} lost its runtime schemas.`);
  }
  return schemas as { readonly input: RuntimeSchema<TInput>; readonly output: RuntimeSchema<TOutput> };
}

function validate<T extends object>(schema: RuntimeSchema<T>, value: unknown, code: 'ML_INPUT_INVALID' | 'ML_OUTPUT_INVALID', label: string): T {
  const result = schema.validate(value as never);
  if (!result.ok) throw new ApplicationMLPredictionError({ code, message: `${label} failed schema validation: ${result.error.message}`, retryable: false });
  return result.value;
}

function receipt<TInput extends object, TOutput extends object>(
  definition: ApplicationMLModelDefinition<TInput, TOutput>,
  provider: ApplicationMLProvider<TInput, TOutput>,
  invocationId: string,
  startedAt: string,
): ApplicationMLPredictionReceipt {
  return Object.freeze({
    apiVersion: 'applik8s.mlPredictionReceipt/v1alpha1',
    invocationId,
    logicalModel: definition.id,
    modelVersion: provider.artifact.modelVersion,
    artifactDigest: provider.artifact.digest,
    provider: provider.provider,
    providerVersion: provider.providerVersion,
    servingIdentity: provider.servingIdentity,
    startedAt,
    completedAt: new Date().toISOString(),
    redaction: 'features-and-output-omitted',
  });
}

function positiveTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 3_600_000) {
    throw new ApplicationMLPredictionError({ code: 'ML_INPUT_INVALID', message: 'ML timeoutMs must be an integer from 1 through 3600000.', retryable: false });
  }
  return value;
}
