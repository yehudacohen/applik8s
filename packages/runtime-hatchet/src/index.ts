// typecast-file-boundary: Hatchet SDK responses are checked at the provider adapter before conversion into provider-neutral workflow receipts.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { ApplicationHatchetWorkflowEngineProvider } from '@applik8s/applik8s';
import { ApplicationDurableError, type ApplicationWorkflowInvocationMetadata, ApplicationWorkflowObservationError, type ApplicationWorkflowResultOptions, type ApplicationWorkflowRun, type ApplicationWorkflowRuntime, type ApplicationWorkflowScheduleResult, type ApplicationWorkflowScheduleSpec } from '@applik8s/applik8s';
import { HatchetClient, type JsonObject, Priority } from '@hatchet-dev/typescript-sdk/v1/index.js';
import { applicationMetadata, hatchetRunOptions } from './workflow-runtime-hatchet-metadata.js';
import { abortableHatchetDelay, boundedHatchetOperation, defaultHatchetOperationTimeoutMs, hatchetProviderStatusCode, positiveHatchetDuration, sanitizedHatchetProviderError, throwIfHatchetAborted } from './workflow-runtime-hatchet-operation.js';
import { boundedCronExpression, boundedJsonObject, boundedScheduleString, canonicalJson } from './workflow-runtime-hatchet-values.js';

const durableErrorMarker = 'applik8s-durable-error:';
const defaultResultTimeoutMs = 24 * 60 * 60 * 1_000;
const maximumConsecutiveReadFailures = 5;

export function createHatchetWorkflowRuntime(provider: ApplicationHatchetWorkflowEngineProvider): ApplicationWorkflowRuntime {
  return createHatchetWorkflowRuntimeFromClientFactory(() => hatchetClient(provider));
}

/** Provider-adapter test seam; production callers select Hatchet through WorkflowEngine bindings. */
export function createHatchetWorkflowRuntimeFromClientFactory(client: () => HatchetClient): ApplicationWorkflowRuntime {
  const runtime = () => createHatchetWorkflowRuntimeFromClient(client());
  return {
    run<TInput extends object, TOutput extends object>(contract: string, input: TInput, metadata?: ApplicationWorkflowInvocationMetadata, result?: ApplicationWorkflowResultOptions) {
      return runtime().run<TInput, TOutput>(contract, input, metadata, result);
    },
    start<TInput extends object, TOutput extends object, TErrors extends Readonly<Record<string, object>> = Readonly<Record<never, never>>>(contract: string, input: TInput, metadata?: ApplicationWorkflowInvocationMetadata) {
      return runtime().start<TInput, TOutput, TErrors>(contract, input, metadata);
    },
    schedule<TInput extends object>(contract: string, input: TInput, at: Date, metadata?: ApplicationWorkflowInvocationMetadata) {
      return runtime().schedule(contract, input, at, metadata);
    },
    reconcileSchedule<TInput extends object>(contract: string, schedule: ApplicationWorkflowScheduleSpec<TInput>, metadata?: ApplicationWorkflowInvocationMetadata) {
      return runtime().reconcileSchedule(contract, schedule, metadata);
    },
    signal<TPayload extends object>(contract: string, runId: string, signal: string, payload: TPayload, metadata?: ApplicationWorkflowInvocationMetadata) {
      return runtime().signal(contract, runId, signal, payload, metadata);
    },
  };
}

function hatchetClient(provider: ApplicationHatchetWorkflowEngineProvider): HatchetClient {
  const tokenFile = process.env.APPLIK8S_WORKFLOW_TOKEN_FILE;
  const token = tokenFile ? readFileSync(tokenFile, 'utf8').trim() : process.env.HATCHET_CLIENT_TOKEN;
  const hostPort = provider.hostPort ?? process.env.HATCHET_CLIENT_HOST_PORT;
  const apiUrl = provider.apiUrl ?? process.env.HATCHET_CLIENT_API_URL;
  // typecast: Hatchet's JsonObject boundary accepts schema-validated application inputs; the literal TLS strategy retains its SDK discriminant.
  return HatchetClient.init({
    ...(token ? { token } : {}),
    ...(hostPort ? { host_port: hostPort } : {}),
    ...(apiUrl ? { api_url: apiUrl } : {}),
    ...(provider.tls !== true ? { tls_config: { tls_strategy: 'none' as const } } : {}), // typecast: retain Hatchet's literal TLS strategy discriminant.
  });
}

/** Provider-adapter test seam; application code selects Hatchet through WorkflowEngine bindings. */
export function createHatchetWorkflowRuntimeFromClient(client: HatchetClient): ApplicationWorkflowRuntime {
  return {
    async run<TInput extends object, TOutput extends object>(contract: string, input: TInput, metadata?: ApplicationWorkflowInvocationMetadata, result?: ApplicationWorkflowResultOptions) {
      // typecast: schema-validated application input satisfies Hatchet's JSON object transport boundary.
      const reference = await boundedHatchetOperation(
        () => client.runNoWait<JsonObject, JsonObject>(contract, input as JsonObject, hatchetRunOptions(metadata)),
        contract,
        'start',
        { timeoutMs: defaultHatchetOperationTimeoutMs },
      );
      const id = await boundedHatchetOperation(() => Promise.resolve(reference.runId), contract, 'resolve run id', { timeoutMs: defaultHatchetOperationTimeoutMs });
      return waitForHatchetResult<TOutput>(client, id, result);
    },
    async start<TInput extends object, TOutput extends object>(contract: string, input: TInput, metadata?: ApplicationWorkflowInvocationMetadata) {
      // typecast: schema-validated application input satisfies Hatchet's JSON object transport boundary.
      const reference = await boundedHatchetOperation(
        () => client.runNoWait<JsonObject, JsonObject>(contract, input as JsonObject, hatchetRunOptions(metadata)),
        contract,
        'start',
        { timeoutMs: defaultHatchetOperationTimeoutMs },
      );
      const id = await boundedHatchetOperation(() => Promise.resolve(reference.runId), contract, 'resolve run id', { timeoutMs: defaultHatchetOperationTimeoutMs });
      return {
        id,
        result: (options) => waitForHatchetResult<TOutput>(client, id, options),
        cancel: async (options) => {
          await boundedHatchetOperation(() => client.runs.cancel({ ids: [id] }), id, 'cancel', {
            ...options,
            timeoutMs: options?.timeoutMs ?? defaultHatchetOperationTimeoutMs,
          });
        },
      } satisfies ApplicationWorkflowRun<TOutput>;
    },
    async schedule(contract, input, at, metadata) {
      const declaration = client.workflow({ name: contract });
      const scheduled = await boundedHatchetOperation(
        () => declaration.schedule(at, input, hatchetRunOptions(metadata)),
        contract,
        'schedule',
        { timeoutMs: defaultHatchetOperationTimeoutMs },
      );
      const id = Reflect.get(scheduled, 'metadata')?.id ?? Reflect.get(scheduled, 'id');
      return { id: typeof id === 'string' ? id : `${contract}:${at.toISOString()}` };
    },
    async reconcileSchedule(contract, schedule, metadata) {
      return reconcileHatchetWorkflowSchedule(client, contract, schedule, metadata);
    },
    async signal(contract, runId, signal, payload, metadata) {
      await boundedHatchetOperation(
        () => client.events.push(`${contract}.${signal}`, payload, {
          scope: runId,
          additionalMetadata: applicationMetadata(metadata),
        }),
        runId,
        'signal',
        { timeoutMs: defaultHatchetOperationTimeoutMs },
      );
    },
  };
}

interface HatchetCronRecord {
  readonly metadata: { readonly id: string };
  readonly name?: string;
  readonly cron: string;
  readonly enabled: boolean;
  readonly additionalMetadata?: Readonly<Record<string, unknown>>;
}

interface HatchetCronBoundary {
  readonly cron: {
    list(query: { readonly workflow?: string; readonly cronName?: string; readonly limit?: number; readonly offset?: number }): Promise<{ readonly rows?: readonly HatchetCronRecord[] }>;
    create(workflow: string, input: { readonly name: string; readonly expression: string; readonly input: object; readonly additionalMetadata?: Readonly<Record<string, string>>; readonly priority?: number }): Promise<HatchetCronRecord>;
    delete(cron: string | HatchetCronRecord): Promise<void>;
  };
}

const maximumSchedulesPerIdentity = 16;
const scheduleFingerprintKey = 'applik8s.schedule.fingerprint';
const scheduleRevisionKey = 'applik8s.schedule.revision';

/** Exported as a provider-contract test seam; applications use the WorkflowEngine abstraction. */
export async function reconcileHatchetWorkflowSchedule<TInput extends object>(
  client: HatchetCronBoundary,
  contract: string,
  schedule: ApplicationWorkflowScheduleSpec<TInput>,
  metadata?: ApplicationWorkflowInvocationMetadata,
): Promise<ApplicationWorkflowScheduleResult> {
  const id = boundedScheduleString(schedule.id, 'id', 200);
  const revision = boundedScheduleString(schedule.revision, 'revision', 500);
  if (typeof schedule.enabled !== 'boolean') throw new Error('applik8s-workflow-schedule-enabled-invalid');
  const expression = schedule.enabled ? boundedCronExpression(schedule.expression) : schedule.expression;
  const encodedInput = boundedJsonObject(schedule.input, 'input', 64 * 1_024);
  const fingerprint = createHash('sha256').update(canonicalJson({ contract, expression, input: encodedInput, revision })).digest('hex');
  const listed = await boundedHatchetOperation(
    () => client.cron.list({ workflow: contract, cronName: id, limit: maximumSchedulesPerIdentity + 1, offset: 0 }),
    id,
    'list recurring schedule',
    { timeoutMs: defaultHatchetOperationTimeoutMs },
  );
  const rows = (listed.rows ?? []).filter((row) => row.name === id);
  if (rows.length > maximumSchedulesPerIdentity) throw new Error(`applik8s-workflow-schedule-duplicates-exceeded: ${id}`);
  const matching = rows.length === 1
    && rows[0]?.enabled === true
    && rows[0]?.cron === expression
    && rows[0]?.additionalMetadata?.[scheduleFingerprintKey] === fingerprint;
  if (schedule.enabled && matching) {
    const row = rows[0] as HatchetCronRecord;
    return { id, revision, state: 'unchanged', providerId: row.metadata.id };
  }
  await Promise.all(rows.map((row) => boundedHatchetOperation(() => client.cron.delete(row), id, 'remove recurring schedule', { timeoutMs: defaultHatchetOperationTimeoutMs })));
  if (!schedule.enabled) return { id, revision, state: rows.length > 0 ? 'removed' : 'unchanged' };
  const created = await boundedHatchetOperation(() => client.cron.create(contract, {
    name: id,
    expression,
    input: encodedInput,
    additionalMetadata: {
      ...applicationMetadata(metadata),
      [scheduleRevisionKey]: revision,
      [scheduleFingerprintKey]: fingerprint,
    },
    ...(metadata?.priority ? { priority: metadata.priority === 'high' ? Priority.HIGH : metadata.priority === 'low' ? Priority.LOW : Priority.MEDIUM } : {}),
  }), id, 'create recurring schedule', { timeoutMs: defaultHatchetOperationTimeoutMs });
  return { id, revision, state: 'created', providerId: created.metadata.id };
}

export async function waitForHatchetResult<TOutput extends object>(client: Pick<HatchetClient, 'runs'>, id: string, options: ApplicationWorkflowResultOptions = {}): Promise<TOutput> {
  const timeoutMs = positiveHatchetDuration(options.timeoutMs ?? defaultResultTimeoutMs, 'result timeoutMs');
  const pollIntervalMs = positiveHatchetDuration(options.pollIntervalMs ?? 250, 'result pollIntervalMs');
  const deadline = Date.now() + timeoutMs;
  let consecutiveReadFailures = 0;
  for (;;) {
    throwIfHatchetAborted(options.signal, id);
    if (Date.now() >= deadline) throw new ApplicationWorkflowObservationError('timeout', id, `Timed out waiting ${timeoutMs}ms for workflow ${id}.`);
    let details: Awaited<ReturnType<typeof client.runs.get>>;
    try {
      details = await boundedHatchetOperation(() => client.runs.get(id), id, 'observe', { ...(options.signal ? { signal: options.signal } : {}), timeoutMs: Math.max(1, deadline - Date.now()) });
      consecutiveReadFailures = 0;
    } catch (error) {
      if (error instanceof ApplicationWorkflowObservationError && (error.failure === 'aborted' || error.failure === 'timeout')) throw error;
      if (hatchetProviderStatusCode(error) === 404) {
        // Hatchet can acknowledge run creation before its read model exposes
        // the run. Treat that bounded visibility window as pending instead of
        // declaring the provider unavailable after five fast polls.
        consecutiveReadFailures = 0;
        await abortableHatchetDelay(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())), options.signal, id);
        continue;
      }
      consecutiveReadFailures += 1;
      if (consecutiveReadFailures >= maximumConsecutiveReadFailures) {
        throw new ApplicationWorkflowObservationError('providerUnavailable', id, `Unable to observe workflow ${id} after ${consecutiveReadFailures} consecutive provider errors.`, { cause: sanitizedHatchetProviderError(error) });
      }
      await abortableHatchetDelay(Math.min(pollIntervalMs * consecutiveReadFailures, Math.max(1, deadline - Date.now())), options.signal, id);
      continue;
    }
    if (details.run.status === 'COMPLETED') {
      // typecast: generated workers validate the declared workflow output before Hatchet persists it.
      return details.run.output as TOutput;
    }
    if (details.run.status === 'FAILED') {
      const durable = durableErrorFromMessage(details.run.errorMessage);
      if (durable) throw durable;
      throw new ApplicationWorkflowObservationError('failed', id, `Hatchet workflow ${id} failed: ${details.run.errorMessage ?? 'no error message'}`);
    }
    if (details.run.status === 'CANCELLED') throw new ApplicationWorkflowObservationError('cancelled', id, `Hatchet workflow ${id} was cancelled.`);
    await abortableHatchetDelay(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())), options.signal, id);
  }
}

export function durableErrorFromMessage(message: unknown): ApplicationDurableError | undefined {
  if (typeof message !== 'string') return undefined;
  const markerIndex = message.indexOf(durableErrorMarker);
  if (markerIndex < 0) return undefined;
  const encoded = message.slice(markerIndex + durableErrorMarker.length).split('\n', 1)[0]?.trim();
  if (!encoded) return undefined;
  try {
    const value: unknown = JSON.parse(encoded);
    if (!value || typeof value !== 'object') return undefined;
    const name = Reflect.get(value, 'name');
    const payload = Reflect.get(value, 'payload');
    if (typeof name !== 'string' || name.length === 0 || !payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
    // typecast: runtime guards above establish a non-array object payload at the JSON transport boundary.
    return new ApplicationDurableError(name, payload as object, `Durable application error ${name} from workflow execution.`);
  } catch {
    return undefined;
  }
}
