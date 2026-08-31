// typecast-file-boundary: Saga steps preserve heterogeneous input/output associations only after stable step identity and terminal records are validated.
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import {
  canonicalJsonV1String,
  type JsonObject,
} from '@applik8s/core';
import type { SchemaInput } from '@applik8s/sdk';
import { normalizeSchema } from '@applik8s/sdk';
import { serializeApplicationCallback } from './application-callback.js';
import type {
  ApplicationGraphState,
} from './application-graph-state.js';
import {
  addApplicationGraphEdge,
  addApplicationGraphNode,
  addApplicationProviderRequirement,
} from './application-graph-state.js';
import { applicationProviderGraphNodeId, kubernetesNameSegment } from './application-identifiers.js';
import type { ApplicationWorkflowInvocationMetadata } from './workflow-runtime.js';

export const applicationSagaProtocol = 'applik8s.saga/v1alpha1' as const;

export interface ApplicationSagaContract<TInput extends object, TOutput extends object> {
  readonly input: SchemaInput<TInput>;
  readonly output: SchemaInput<TOutput>;
}

export interface ApplicationSagaOptions<TInput extends object> {
  readonly deadline?: string;
  readonly recoveryDeadline?: string;
  readonly idempotencyKey?: (input: TInput) => string;
}

export interface ApplicationSagaStepOptions<TResult> {
  readonly compensate: (result: TResult) => void | Promise<void>;
  readonly authority?: 'revalidate' | 'originalReceipt' | 'frameworkRecoveryGrant';
}

export interface ApplicationSagaCommitOptions<TResult> {
  readonly observe?: (result: TResult | undefined) => 'committed' | 'absent' | 'unknown' | Promise<'committed' | 'absent' | 'unknown'>;
  readonly authority?: 'revalidate' | 'originalReceipt' | 'frameworkRecoveryGrant';
}

export interface ApplicationSagaIrreversibleOptions {
  readonly reason: string;
  readonly authority?: 'revalidate' | 'originalReceipt' | 'frameworkRecoveryGrant';
}

export interface ApplicationSagaContext {
  readonly protocol: typeof applicationSagaProtocol;
  readonly invocationId: string;
  readonly signal: AbortSignal;
  step<TResult>(id: string, effect: () => TResult | Promise<TResult>, options: ApplicationSagaStepOptions<TResult>): Promise<TResult>;
  commit<TResult>(id: string, effect: () => TResult | Promise<TResult>, options?: ApplicationSagaCommitOptions<TResult>): Promise<TResult>;
  irreversible<TResult>(id: string, effect: () => TResult | Promise<TResult>, options: ApplicationSagaIrreversibleOptions): Promise<TResult>;
}

export type ApplicationSagaHandler<TInput extends object, TOutput extends object> = (
  input: TInput,
  saga: ApplicationSagaContext,
) => TOutput | Promise<TOutput>;

export interface ApplicationSagaDefinition<TInput extends object, TOutput extends object> {
  readonly protocol: typeof applicationSagaProtocol;
  readonly id: `${string}.v${number}`;
  readonly name: string;
  readonly version: string;
  readonly contract: ApplicationSagaContract<TInput, TOutput>;
  readonly options: ApplicationSagaOptions<TInput>;
  readonly handler: ApplicationSagaHandler<TInput, TOutput>;
}

export interface ApplicationSagaBinding<TInput extends object, TOutput extends object> {
  (input: TInput, metadata?: ApplicationWorkflowInvocationMetadata): Promise<TOutput>;
  readonly kind: 'applicationSaga';
  readonly definition: ApplicationSagaDefinition<TInput, TOutput>;
  run(input: TInput, metadata?: ApplicationWorkflowInvocationMetadata): Promise<TOutput>;
}

export interface ApplicationSagaRegistrar {
  <TInput extends object, TOutput extends object>(
    id: `${string}.v${number}`,
    contract: ApplicationSagaContract<TInput, TOutput>,
    handler: ApplicationSagaHandler<TInput, TOutput>,
  ): ApplicationSagaBinding<TInput, TOutput>;
  <TInput extends object, TOutput extends object>(
    id: `${string}.v${number}`,
    contract: ApplicationSagaContract<TInput, TOutput>,
    options: ApplicationSagaOptions<TInput>,
    handler: ApplicationSagaHandler<TInput, TOutput>,
  ): ApplicationSagaBinding<TInput, TOutput>;
}

export interface ApplicationTransactionRegistrar {
  readonly saga: ApplicationSagaRegistrar;
}

export interface ApplicationSagaRuntime {
  run<TInput extends object, TOutput extends object>(
    definition: ApplicationSagaDefinition<TInput, TOutput>,
    input: TInput,
    metadata?: ApplicationWorkflowInvocationMetadata,
  ): Promise<TOutput>;
}

const sagaRuntimeResolvers: Array<() => ApplicationSagaRuntime | undefined> = [];
const applicationSagaExecutionScope = new AsyncLocalStorage<{
  readonly saga: string;
  readonly phase: 'handler' | 'effect' | 'compensation';
}>();

export class ApplicationSagaBoundaryError extends Error {
  constructor(
    readonly code: 'SAGA_EFFECT_OUTSIDE_BOUNDARY' | 'SAGA_NESTING_UNSUPPORTED',
    message: string,
  ) {
    super(message);
    this.name = 'ApplicationSagaBoundaryError';
  }
}

export function installApplicationSagaRuntimeResolver(
  resolver: () => ApplicationSagaRuntime | undefined,
): () => void {
  sagaRuntimeResolvers.push(resolver);
  return () => {
    const index = sagaRuntimeResolvers.lastIndexOf(resolver);
    if (index >= 0) sagaRuntimeResolvers.splice(index, 1);
  };
}

function applicationSagaRuntime(): ApplicationSagaRuntime {
  for (let index = sagaRuntimeResolvers.length - 1; index >= 0; index -= 1) {
    const runtime = sagaRuntimeResolvers[index]?.();
    if (runtime) return runtime;
  }
  throw new Error('Saga execution requires a qualified workflow-backed Saga runtime.');
}

export function createApplicationTransactionRegistrar(
  state: ApplicationGraphState,
): ApplicationTransactionRegistrar {
  return Object.freeze({
    saga: ((id: `${string}.v${number}`, contract: ApplicationSagaContract<object, object>, optionsOrHandler: ApplicationSagaOptions<object> | ApplicationSagaHandler<object, object>, maybeHandler?: ApplicationSagaHandler<object, object>) => {
      const options = typeof optionsOrHandler === 'function' ? {} : optionsOrHandler;
      const handler = typeof optionsOrHandler === 'function' ? optionsOrHandler : maybeHandler;
      if (!handler) throw new TypeError(`Saga ${id} requires an implementation callback.`);
      return registerApplicationSaga(state, id, contract, options, handler);
    }) as ApplicationSagaRegistrar,
  });
}

export function registerApplicationSaga<TInput extends object, TOutput extends object>(
  state: ApplicationGraphState,
  id: `${string}.v${number}`,
  contract: ApplicationSagaContract<TInput, TOutput>,
  options: ApplicationSagaOptions<TInput>,
  handler: ApplicationSagaHandler<TInput, TOutput>,
): ApplicationSagaBinding<TInput, TOutput> {
  const identity = sagaIdentity(id);
  const input = declaredSchema(contract.input, `${id}.input`);
  const output = declaredSchema(contract.output, `${id}.output`);
  const serialized = serializeApplicationCallback({
    registrar: 'application.transaction.saga',
    argumentIndex: 3,
    property: 'handler',
    label: `Saga ${id} handler`,
    callback: handler as (...args: never[]) => unknown,
    allowDeferredResolution: true,
  });
  const steps = sagaSteps(id, serialized.source);
  const nodeId = `saga.${kubernetesNameSegment(id)}`;
  const workflowEngine = applicationProviderGraphNodeId('WorkflowEngine');
  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'saga',
    name: id,
    stability: 'experimental',
    contract: { name: identity.name, version: identity.version, input, output },
    workflowEngine: { interface: 'WorkflowEngine', nodeId: workflowEngine },
    handlerSource: serialized.source,
    ...(serialized.dependencies ? { handlerDependencies: serialized.dependencies } : {}),
    ...(serialized.location ? { sourceLocation: serialized.location } : {}),
    steps,
    deadlineSeconds: durationSeconds(options.deadline ?? '15m', `${id} deadline`),
    recoveryDeadlineSeconds: durationSeconds(options.recoveryDeadline ?? '24h', `${id} recoveryDeadline`),
    cancellation: 'recoverThenCompensate',
    atomicity: 'compensatingNoIsolation',
    maturity: 'beta',
  });
  addApplicationProviderRequirement(state, {
    id: `${nodeId}.workflow-engine`,
    interface: 'WorkflowEngine',
    consumer: { nodeId },
    provider: { interface: 'WorkflowEngine', nodeId: workflowEngine },
    required: true,
    purpose: 'workflowEngine',
    diagnostics: {
      missing: `Saga ${id} requires a WorkflowEngine provider.`,
      ambiguous: `Saga ${id} has more than one unqualified WorkflowEngine provider.`,
    },
  });
  addApplicationGraphEdge(state, { from: { nodeId: workflowEngine }, to: { nodeId }, relationship: 'provides' });
  const definition: ApplicationSagaDefinition<TInput, TOutput> = Object.freeze({
    protocol: applicationSagaProtocol,
    id,
    ...identity,
    contract,
    options,
    handler,
  });
  const run = async (value: TInput, metadata?: ApplicationWorkflowInvocationMetadata): Promise<TOutput> => {
    const enclosing = applicationSagaExecutionScope.getStore();
    if (enclosing) {
      throw new ApplicationSagaBoundaryError(
        enclosing.phase === 'handler'
          ? 'SAGA_EFFECT_OUTSIDE_BOUNDARY'
          : 'SAGA_NESTING_UNSUPPORTED',
        enclosing.phase === 'handler'
          ? `Saga ${id} was invoked from Saga ${enclosing.saga} outside step(...), commit(...), or irreversible(...).`
          : `Saga ${id} cannot be nested inside ${enclosing.saga} ${enclosing.phase}; one execution cannot have competing compensation authorities.`,
      );
    }
    const validInput = validate(contract.input, value, `${id}.input`);
    const result = await applicationSagaRuntime().run(definition, validInput, metadata);
    return validate(contract.output, result, `${id}.output`);
  };
  return Object.assign(run, { kind: 'applicationSaga' as const, definition, run });
}

export type ApplicationSagaStepPhase = 'declared' | 'prepared' | 'invoked' | 'observed' | 'committed' | 'failed' | 'unknown' | 'compensated' | 'compensationFailed';
export type ApplicationSagaOutcome = 'running' | 'committed' | 'compensated' | 'compensationFailed' | 'outcomeUnknown';

export interface ApplicationSagaStepObservation {
  readonly id: string;
  readonly kind: 'step' | 'commit' | 'irreversible';
  readonly phase: ApplicationSagaStepPhase;
  readonly result?: unknown;
  readonly error?: string;
  readonly compensationAttempts: number;
}

export interface ApplicationSagaObservation {
  readonly invocationId: string;
  readonly saga: string;
  readonly outcome: ApplicationSagaOutcome;
  readonly steps: readonly ApplicationSagaStepObservation[];
  readonly output?: object;
}

export class ApplicationSagaOutcomeUnknownError<TResult = unknown> extends Error {
  readonly code = 'SAGA_OUTCOME_UNKNOWN' as const;
  constructor(
    message: string,
    readonly candidateResult?: TResult,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ApplicationSagaOutcomeUnknownError';
  }
}

export class ApplicationSagaExecutionError extends Error {
  readonly code: 'SAGA_COMPENSATED' | 'SAGA_COMPENSATION_FAILED' | 'SAGA_OUTCOME_UNKNOWN';
  constructor(readonly observation: ApplicationSagaObservation, options?: ErrorOptions) {
    const code = observation.outcome === 'compensated'
      ? 'SAGA_COMPENSATED'
      : observation.outcome === 'compensationFailed'
        ? 'SAGA_COMPENSATION_FAILED'
        : 'SAGA_OUTCOME_UNKNOWN';
    super(`Saga ${observation.saga} finished with ${observation.outcome}.`, options);
    this.name = 'ApplicationSagaExecutionError';
    this.code = code;
  }
}

export interface DeterministicApplicationSagaRuntime extends ApplicationSagaRuntime {
  inspect(invocationId: string): ApplicationSagaObservation | undefined;
}

interface MutableSagaStep extends ApplicationSagaStepObservation {
  phase: ApplicationSagaStepPhase;
  result?: unknown;
  error?: string;
  compensationAttempts: number;
}

interface MutableSagaRun {
  readonly invocationId: string;
  readonly saga: string;
  outcome: ApplicationSagaOutcome;
  readonly steps: Map<string, MutableSagaStep>;
  output?: object;
}

export function createDeterministicApplicationSagaRuntime(): DeterministicApplicationSagaRuntime {
  const runs = new Map<string, MutableSagaRun>();
  return {
    async run(definition, input, metadata) {
      const key = metadata?.idempotencyKey
        ?? definition.options.idempotencyKey?.(input)
        ?? createHash('sha256').update(canonicalJsonV1String({ saga: definition.id, input })).digest('hex');
      const invocationId = `${definition.id}:${key}`;
      const run: MutableSagaRun = runs.get(invocationId) ?? {
        invocationId,
        saga: definition.id,
        outcome: 'running' as const,
        steps: new Map(),
      };
      runs.set(invocationId, run);
      if (run.outcome === 'committed' && run.output !== undefined) {
        return cloneSagaValue(run.output) as Awaited<ReturnType<typeof definition.handler>>;
      }
      if (run.outcome === 'outcomeUnknown') run.outcome = 'running';
      if (run.outcome !== 'running') throw new ApplicationSagaExecutionError(observeSagaRun(run));
      const frontier: Array<{ readonly step: MutableSagaStep; readonly compensate: (result: unknown) => void | Promise<void> }> = [];
      const compensate = async (cause: unknown): Promise<never> => {
        let failed = false;
        for (const item of [...frontier].reverse()) {
          if (item.step.phase !== 'committed') continue;
          item.step.compensationAttempts += 1;
          try {
            await applicationSagaExecutionScope.run(
              { saga: definition.id, phase: 'compensation' },
              () => item.compensate(item.step.result),
            );
            item.step.phase = 'compensated';
          } catch (error) {
            failed = true;
            item.step.phase = 'compensationFailed';
            item.step.error = errorMessage(error);
          }
        }
        run.outcome = failed ? 'compensationFailed' : 'compensated';
        throw new ApplicationSagaExecutionError(observeSagaRun(run), { cause });
      };
      const controller = new AbortController();
      const deadline = setTimeout(
        () => controller.abort(new ApplicationSagaOutcomeUnknownError(
          `Saga ${definition.id} exceeded its ${definition.options.deadline ?? '15m'} execution deadline.`,
        )),
        durationSeconds(definition.options.deadline ?? '15m', `${definition.id} deadline`) * 1_000,
      );
      deadline.unref?.();
      const invoke = async <TResult>(
        id: string,
        kind: 'step' | 'commit' | 'irreversible',
        effect: () => TResult | Promise<TResult>,
        observer?: ApplicationSagaCommitOptions<TResult>['observe'],
      ): Promise<TResult> => {
        const existing = run.steps.get(id);
        if (existing?.phase === 'committed') return cloneSagaValue(existing.result) as TResult;
        if (existing?.phase === 'unknown') {
          if (!observer) {
            run.outcome = 'outcomeUnknown';
            throw new ApplicationSagaExecutionError(observeSagaRun(run));
          }
          const resolution = await observer(existing.result as TResult | undefined);
          if (resolution === 'committed' && existing.result !== undefined) {
            existing.phase = 'committed';
            delete existing.error;
            run.outcome = 'running';
            return cloneSagaValue(existing.result) as TResult;
          }
          if (resolution === 'absent') {
            existing.phase = 'failed';
            existing.error = 'Provider observation proved the effect absent.';
            run.outcome = 'running';
            throw new Error(existing.error);
          }
          run.outcome = 'outcomeUnknown';
          throw new ApplicationSagaExecutionError(observeSagaRun(run));
        }
        if (controller.signal.aborted) throw controller.signal.reason;
        const step = existing ?? { id, kind, phase: 'declared' as const, compensationAttempts: 0 };
        run.steps.set(id, step);
        step.phase = 'prepared';
        try {
          step.phase = 'invoked';
          const result = await applicationSagaExecutionScope.run(
            { saga: definition.id, phase: 'effect' },
            () => raceSagaEffect(effect, controller.signal),
          );
          step.result = cloneSagaValue(result);
          step.phase = 'observed';
          if (observer) {
            const resolution = await observer(result);
            if (resolution === 'unknown') {
              throw new ApplicationSagaOutcomeUnknownError(
                `Saga ${definition.id} ${kind} ${id} could not prove its provider outcome.`,
                result,
              );
            }
            if (resolution === 'absent') {
              throw new Error(`Saga ${definition.id} ${kind} ${id} was proven absent after invocation.`);
            }
          }
          step.phase = 'committed';
          return result;
        } catch (error) {
          if (error instanceof ApplicationSagaOutcomeUnknownError) {
            step.phase = 'unknown';
            step.error = error.message;
            if (error.candidateResult !== undefined) step.result = cloneSagaValue(error.candidateResult);
            run.outcome = 'outcomeUnknown';
            throw new ApplicationSagaExecutionError(observeSagaRun(run), { cause: error });
          }
          step.phase = 'failed';
          step.error = errorMessage(error);
          throw error;
        }
      };
      const context: ApplicationSagaContext = Object.freeze({
        protocol: applicationSagaProtocol,
        invocationId,
        signal: controller.signal,
        async step<TResult>(id: string, effect: () => TResult | Promise<TResult>, options: ApplicationSagaStepOptions<TResult>) {
          requireStepId(definition.id, id);
          const result = await invoke(id, 'step', effect);
          const step = run.steps.get(id) as MutableSagaStep;
          frontier.push({ step, compensate: options.compensate as (result: unknown) => void | Promise<void> });
          return result;
        },
        async commit<TResult>(id: string, effect: () => TResult | Promise<TResult>, options?: ApplicationSagaCommitOptions<TResult>) {
          requireStepId(definition.id, id);
          try {
            const result = await invoke(id, 'commit', effect, options?.observe);
            frontier.length = 0;
            return result;
          } catch (error) {
            if (run.outcome === 'outcomeUnknown') throw error;
            return compensate(error);
          }
        },
        async irreversible<TResult>(id: string, effect: () => TResult | Promise<TResult>, options: ApplicationSagaIrreversibleOptions) {
          requireStepId(definition.id, id);
          if (!options.reason.trim()) throw new TypeError(`Saga ${definition.id} irreversible step ${id} requires a reason.`);
          return invoke(id, 'irreversible', effect);
        },
      });
      try {
        const output = await applicationSagaExecutionScope.run(
          { saga: definition.id, phase: 'handler' },
          () => definition.handler(input, context),
        );
        run.output = cloneSagaValue(output);
        run.outcome = 'committed';
        return output;
      } catch (error) {
        if (error instanceof ApplicationSagaExecutionError) throw error;
        return compensate(error);
      } finally {
        clearTimeout(deadline);
      }
    },
    inspect(invocationId) {
      const run = runs.get(invocationId);
      return run ? observeSagaRun(run) : undefined;
    },
  };
}

function observeSagaRun(run: MutableSagaRun): ApplicationSagaObservation {
  return Object.freeze({
    invocationId: run.invocationId,
    saga: run.saga,
    outcome: run.outcome,
    steps: Object.freeze([...run.steps.values()].map(step => Object.freeze({ ...step }))),
    ...(run.output !== undefined ? { output: cloneSagaValue(run.output) } : {}),
  });
}

async function raceSagaEffect<TResult>(
  effect: () => TResult | Promise<TResult>,
  signal: AbortSignal,
): Promise<TResult> {
  if (signal.aborted) throw signal.reason;
  return Promise.race([
    Promise.resolve().then(effect),
    new Promise<never>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  ]);
}

function cloneSagaValue<T>(value: T): T {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  try {
    return structuredClone(value);
  } catch (error) {
    throw new TypeError(
      'Saga effects and outputs must return structured-cloneable durable values.',
      { cause: error },
    );
  }
}

function sagaIdentity(id: string): { readonly name: string; readonly version: string } {
  const match = /^(.+)\.(v\d+)$/u.exec(id);
  if (!match?.[1] || !match[2]) throw new TypeError(`Saga id ${JSON.stringify(id)} must end in .v<number>.`);
  return { name: match[1], version: match[2] };
}

function sagaSteps(saga: string, source: string) {
  const matches = [...source.matchAll(/\.\s*(step|commit|irreversible)\s*\(\s*(['"])([^'"]+)\2/gu)];
  const dynamicCalls = source.match(/\.\s*(?:step|commit|irreversible)\s*\(/gu) ?? [];
  if (matches.length !== dynamicCalls.length) {
    throw new Error(`Saga ${saga} step, commit, and irreversible IDs must be statically discoverable string literals.`);
  }
  const ids = new Set<string>();
  return matches.map((match, order) => {
    const kind = match[1] as 'step' | 'commit' | 'irreversible';
    const id = match[3] as string;
    requireStepId(saga, id);
    if (ids.has(id)) throw new Error(`SAGA_STEP_ID_CONFLICT: Saga ${saga} reuses step id ${id}.`);
    ids.add(id);
    return {
      id,
      kind,
      order,
      compensation: kind === 'step' ? 'required' as const : 'forbidden' as const,
    };
  });
}

function declaredSchema<T extends object>(schema: SchemaInput<T>, label: string) {
  const emitted = normalizeSchema(schema, label).emitJsonSchema();
  if (!emitted.ok) throw new Error(`${label} cannot be serialized: ${emitted.error.message}`);
  return { kind: 'declared' as const, runtime: 'arktype' as const, jsonSchema: emitted.value.schema };
}

function validate<T extends object>(schema: SchemaInput<T>, value: T, label: string): T {
  const result = normalizeSchema(schema, label).validate(value as JsonObject);
  if (!result.ok) throw new TypeError(`${label} failed validation: ${result.error.message}`);
  return result.value;
}

function requireStepId(saga: string, id: string): void {
  if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/u.test(id)) {
    throw new TypeError(`Saga ${saga} step id ${JSON.stringify(id)} must be a stable lowercase identifier.`);
  }
}

function durationSeconds(value: string, label: string): number {
  const match = /^(\d+)(s|m|h|d)$/u.exec(value.trim());
  if (!match) throw new TypeError(`${label} must be a whole-second duration such as 30s, 15m, or 24h.`);
  const amount = Number(match[1]);
  const seconds = amount * ({ s: 1, m: 60, h: 3_600, d: 86_400 }[match[2] ?? ''] ?? 0);
  if (!Number.isSafeInteger(seconds) || seconds < 1) throw new TypeError(`${label} is outside the supported range.`);
  return seconds;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
