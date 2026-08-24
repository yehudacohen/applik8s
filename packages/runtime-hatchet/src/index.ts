// typecast-file-boundary: schema-validated application workflow values are converted to Hatchet's JSON transport types only at this provider adapter.
import { readFileSync } from 'node:fs';
import type { ApplicationHatchetWorkflowEngineProvider } from '@applik8s/applik8s';
import type {
  ApplicationWorkflowInvocationMetadata,
  ApplicationWorkflowResultOptions,
  ApplicationWorkflowRuntime,
  ApplicationWorkflowScheduleSpec,
} from '@applik8s/applik8s/workflow-runtime';
import { HatchetClient, type JsonObject } from '@hatchet-dev/typescript-sdk/v1/index.js';
import { applicationMetadata, hatchetRunOptions } from './workflow-runtime-hatchet-metadata.js';
import { observeHatchetWorkflowRun, waitForHatchetResult } from './workflow-runtime-hatchet-observation.js';
import { boundedHatchetOperation, defaultHatchetOperationTimeoutMs } from './workflow-runtime-hatchet-operation.js';
import { reconcileHatchetWorkflowSchedule } from './workflow-runtime-hatchet-schedule.js';

export type {
  HatchetApplicationScheduleClient,
  HatchetApplicationScheduleDeliveryInput,
  HatchetApplicationScheduleRuntime,
  HatchetApplicationScheduleRuntimeOptions,
} from './application-schedule.js';
export {
  createHatchetApplicationScheduleRuntime,
  createHatchetApplicationScheduleRuntimeFromClient,
  HatchetScheduleTimezoneCompatibilityError,
} from './application-schedule.js';
export {
  durableErrorFromMessage,
  observeHatchetWorkflowRun,
  waitForHatchetResult,
} from './workflow-runtime-hatchet-observation.js';
export { reconcileHatchetWorkflowSchedule } from './workflow-runtime-hatchet-schedule.js';

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
      const admittedAt = new Date().toISOString();
      return {
        id,
        result: (options) => waitForHatchetResult<TOutput>(client, id, options),
        observe: (options?: ApplicationWorkflowResultOptions) =>
          observeHatchetWorkflowRun<TOutput>(client, id, admittedAt, options),
        cancel: async (options) => {
          await boundedHatchetOperation(() => client.runs.cancel({ ids: [id] }), id, 'cancel', {
            ...options,
            timeoutMs: options?.timeoutMs ?? defaultHatchetOperationTimeoutMs,
          });
        },
        __cancelReference: async (runId: string, options?: Omit<ApplicationWorkflowResultOptions, 'pollIntervalMs'>) => {
          await boundedHatchetOperation(
            () => client.runs.cancel({ ids: [runId] }),
            runId,
            'cancel superseded run',
            {
              ...options,
              timeoutMs: options?.timeoutMs ?? defaultHatchetOperationTimeoutMs,
            },
          );
        },
      };
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
