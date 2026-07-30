// typecast-file-boundary: the handler restores JSON values only after bounded
// decoding, signed invocation verification, and binding-owned schema checks.
import type {
  ApplicationAuthorizationReceipt,
  ApplicationOperationDescriptor,
  JsonValue,
} from '@applik8s/core';
import {
  type ApplicationInternalOperationInvocation,
  applicationInternalOperationInputDigest,
  decodeApplicationInternalOperationInvocation,
} from './internal-transport.js';

export interface ApplicationInternalOperationBinding {
  readonly operation: ApplicationOperationDescriptor;
  readonly audience: string;
  readonly validateInput: (value: JsonValue) => JsonValue;
  readonly validateOutput: (value: JsonValue) => JsonValue;
  readonly invoke: (
    input: JsonValue,
    context: {
      readonly invocation: ApplicationInternalOperationInvocation;
      readonly signal: AbortSignal;
    },
  ) => JsonValue | Promise<JsonValue>;
}

export interface ApplicationInternalOperationHandlerOptions {
  readonly secret: string;
  readonly bindings: readonly ApplicationInternalOperationBinding[];
  readonly revalidate: (input: {
    readonly operation: ApplicationOperationDescriptor;
    readonly invocation: ApplicationInternalOperationInvocation;
    readonly receipt: ApplicationAuthorizationReceipt;
  }) => boolean | Promise<boolean>;
  readonly path?: string;
  readonly maximumRequestBytes?: number;
  readonly maximumResponseBytes?: number;
  readonly maximumInvocationLifetimeMs?: number;
  readonly clock?: () => Date;
}

/**
 * Receiving side of the internal placement hop.
 *
 * It rejects public credentials, verifies the signed authority envelope,
 * revalidates current authorization, and invokes the existing placement-owned
 * binding. No MCP-specific domain handler exists here.
 */
export function createApplicationInternalOperationHandler(
  options: ApplicationInternalOperationHandlerOptions,
): (request: Request) => Promise<Response | undefined> {
  const path = normalizePath(
    options.path ?? '/__applik8s/internal/v1/operations',
  );
  const maximumRequestBytes = boundedBytes(
    options.maximumRequestBytes ?? 1024 * 1024,
    'maximumRequestBytes',
  );
  const maximumResponseBytes = boundedBytes(
    options.maximumResponseBytes ?? 10 * 1024 * 1024,
    'maximumResponseBytes',
  );
  const bindings = new Map(
    options.bindings.map((binding) => [binding.operation.id, binding]),
  );
  if (bindings.size !== options.bindings.length) {
    throw new Error(
      'Internal operation bindings must have unique operation identities.',
    );
  }
  return async (request) => {
    const url = new URL(request.url);
    if (url.pathname !== path) return undefined;
    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405, maximumResponseBytes, {
        allow: 'POST',
      });
    }
    if (
      request.headers.has('authorization')
      || request.headers.has('cookie')
    ) {
      return json(
        { error: 'credential_passthrough_forbidden' },
        400,
        maximumResponseBytes,
      );
    }
    try {
      const body = await boundedBody(request, maximumRequestBytes);
      const operationId = body.operationId;
      if (
        typeof operationId !== 'string'
        || !operationId.startsWith('applik8s://')
      ) {
        throw new ApplicationInternalOperationRequestError(
          'operation_invalid',
          'The internal operation identity is invalid.',
          400,
        );
      }
      const binding = bindings.get(
        operationId as ApplicationOperationDescriptor['id'],
      );
      if (!binding) {
        throw new ApplicationInternalOperationRequestError(
          'operation_unavailable',
          'The internal operation is unavailable at this placement.',
          404,
        );
      }
      const rawInput = jsonValue(body.input);
      const input = binding.validateInput(rawInput);
      const inputDigest = applicationInternalOperationInputDigest(input);
      const token = request.headers.get('x-applik8s-internal-invocation');
      if (!token) {
        throw new ApplicationInternalOperationRequestError(
          'invocation_required',
          'A signed internal invocation is required.',
          401,
        );
      }
      const invocation = decodeApplicationInternalOperationInvocation(
        options.secret,
        token,
        {
          operationId: binding.operation.id,
          operationVersion: binding.operation.version,
          inputDigest,
          audience: binding.audience,
          now: options.clock?.() ?? new Date(),
          ...(options.maximumInvocationLifetimeMs
            ? {
              maximumLifetimeMs:
                options.maximumInvocationLifetimeMs,
            }
            : {}),
          maximumTokenBytes: maximumRequestBytes,
        },
      );
      if (
        !(await options.revalidate({
          operation: binding.operation,
          invocation,
          receipt: invocation.authorizationReceipt,
        }))
      ) {
        throw new ApplicationInternalOperationRequestError(
          'authorization_stale',
          'The internal operation authorization is no longer current.',
          403,
        );
      }
      const output = binding.validateOutput(
        await binding.invoke(input, {
          invocation,
          signal: request.signal,
        }),
      );
      return json(
        { value: output, invocationId: invocation.id },
        200,
        maximumResponseBytes,
      );
    } catch (error) {
      if (error instanceof ApplicationInternalOperationRequestError) {
        return json(
          { error: error.code },
          error.status,
          maximumResponseBytes,
        );
      }
      return json(
        { error: 'invocation_invalid' },
        400,
        maximumResponseBytes,
      );
    }
  };
}

async function boundedBody(
  request: Request,
  maximumBytes: number,
): Promise<Readonly<Record<string, unknown>>> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > maximumBytes) {
    throw new ApplicationInternalOperationRequestError(
      'request_too_large',
      'The internal operation request exceeds its size bound.',
      413,
    );
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > maximumBytes) {
    throw new ApplicationInternalOperationRequestError(
      'request_too_large',
      'The internal operation request exceeds its size bound.',
      413,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ApplicationInternalOperationRequestError(
      'request_invalid',
      'The internal operation request is not JSON.',
      400,
    );
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApplicationInternalOperationRequestError(
      'request_invalid',
      'The internal operation request must be an object.',
      400,
    );
  }
  return value as Readonly<Record<string, unknown>>;
}

function jsonValue(value: unknown): JsonValue {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, jsonValue(entry)]),
    );
  }
  throw new ApplicationInternalOperationRequestError(
    'request_invalid',
    'The internal operation input is not JSON.',
    400,
  );
}

function json(
  value: JsonValue,
  status: number,
  maximumBytes: number,
  headers: Readonly<Record<string, string>> = {},
): Response {
  const body = JSON.stringify(value);
  if (new TextEncoder().encode(body).byteLength > maximumBytes) {
    return new Response(
      JSON.stringify({ error: 'response_too_large' }),
      {
        status: 502,
        headers: responseHeaders(),
      },
    );
  }
  return new Response(body, {
    status,
    headers: { ...responseHeaders(), ...headers },
  });
}

function responseHeaders(): Readonly<Record<string, string>> {
  return {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  };
}

function normalizePath(value: string): string {
  const normalized = `/${value.split('/').filter(Boolean).join('/')}`;
  if (normalized === '/') {
    throw new Error('Internal operation path must not be root.');
  }
  return normalized;
}

function boundedBytes(value: number, label: string): number {
  if (
    !Number.isSafeInteger(value)
    || value < 1_024
    || value > 100 * 1024 * 1024
  ) {
    throw new Error(
      `Internal operation ${label} must be between 1 KiB and 100 MiB.`,
    );
  }
  return value;
}

export class ApplicationInternalOperationRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApplicationInternalOperationRequestError';
  }
}
