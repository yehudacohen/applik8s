// typecast-file-boundary: Schedule management responses cross a bounded authenticated HTTP boundary before reaching typed handles.

import type { ApplicationAdmissionInvocationContextV1 } from '@applik8s/core';
import type {
  ApplicationScheduleConvergenceResult,
  ApplicationScheduleDefinitionContract,
  ApplicationScheduleHandle,
  ApplicationScheduleHandler,
  ApplicationScheduleRuntime,
} from './application-schedule.js';
import { hydrateApplicationScheduleHandle } from './application-schedule.js';
import type { ApplicationScheduleNode } from '@applik8s/core';

const protocol = 'applik8s.scheduleManagementRequest/v1alpha1';
const maximumResponseBytes = 1_048_576;

export interface RemoteApplicationScheduleRuntimeOptions {
  readonly endpoint: string;
  readonly authorization: string;
  readonly schedulerNodeId: string;
  readonly timeoutMs?: number;
  readonly fetch?: (
    input: string | URL,
    init?: RequestInit,
  ) => Promise<Response>;
}

export interface RemoteApplicationScheduleHandleOptions<TInput extends object> extends RemoteApplicationScheduleRuntimeOptions {
  readonly definition: ApplicationScheduleDefinitionContract<TInput>;
  readonly graphNode: ApplicationScheduleNode;
}

/** Rehydrates one captured function-native handle inside a generated managed process. */
export function createRemoteApplicationScheduleHandle<TInput extends object, TResult>(
  options: RemoteApplicationScheduleHandleOptions<TInput>,
): ApplicationScheduleHandle<TInput, TResult> {
  return hydrateApplicationScheduleHandle({
    definition: options.definition,
    graphNode: options.graphNode,
    schedulerNodeId: options.schedulerNodeId,
    runtime: createRemoteApplicationScheduleRuntime(options),
  });
}

/** Compiler/runtime seam used by managed workloads that call a captured schedule handle. */
export function createRemoteApplicationScheduleRuntime(
  options: RemoteApplicationScheduleRuntimeOptions,
): ApplicationScheduleRuntime {
  const endpoint = requiredHttpUrl(options.endpoint);
  const authorization = required(options.authorization, 'schedule management authorization');
  const schedulerNodeId = required(options.schedulerNodeId, 'schedule provider identity');
  const request = options.fetch ?? globalThis.fetch;
  if (typeof request !== 'function') {
    throw new Error('Remote schedule management requires a Fetch implementation.');
  }
  const invoke = async <T>(body: Readonly<Record<string, unknown>>): Promise<T> => {
    const response = await request(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${authorization}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ apiVersion: protocol, schedulerNodeId, ...body }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    });
    const text = await boundedResponseText(response);
    let decoded: unknown;
    try {
      decoded = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
      throw new Error(`Schedule management returned non-JSON HTTP ${response.status}.`);
    }
    if (!response.ok) {
      const code = objectString(decoded, 'error') ?? `http_${response.status}`;
      throw new Error(`Schedule management failed: ${code}.`);
    }
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded) || Reflect.get(decoded, 'ok') !== true) {
      throw new Error('Schedule management returned an invalid success envelope.');
    }
    return Reflect.get(decoded, 'result') as T;
  };
  const runtime: ApplicationScheduleRuntime = {
    async invoke<TInput extends object, TResult>(request: {
      readonly definition: ApplicationScheduleDefinitionContract<TInput>;
      readonly input: TInput;
      readonly handler: ApplicationScheduleHandler<TInput, TResult>;
      readonly callerAdmission: ApplicationAdmissionInvocationContextV1;
    }) {
      return invoke<TResult>({
        action: 'invoke',
        definitionId: request.definition.id,
        input: request.input,
        callerAdmission: request.callerAdmission,
      });
    },
    async reconcile(request) {
      return invoke<ApplicationScheduleConvergenceResult>({
        action: 'configure',
        definitionId: request.definition.id,
        instance: request.instance,
        ...(request.management ? { management: request.management } : {}),
      });
    },
    async remove(definitionId, instanceId, management) {
      return invoke<ApplicationScheduleConvergenceResult>({
        action: 'remove',
        definitionId,
        instanceId,
        ...(management ? { management } : {}),
      });
    },
  };
  return Object.freeze(runtime);
}

async function boundedResponseText(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximumResponseBytes) {
    throw new Error('Schedule management response exceeds the byte limit.');
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maximumResponseBytes) {
    throw new Error('Schedule management response exceeds the byte limit.');
  }
  return text;
}

function objectString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result = Reflect.get(value, key);
  return typeof result === 'string' && result.length > 0 ? result : undefined;
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function requiredHttpUrl(value: string): string {
  const url = new URL(required(value, 'schedule management endpoint'));
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Schedule management endpoint must use HTTP or HTTPS.');
  }
  return url.toString();
}
