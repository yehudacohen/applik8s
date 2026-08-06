// typecast-file-boundary: authenticated HTTP payloads and route segments are validated before being restored to their signal-contract and principal types.
import type {
  ApplicationSignal,
  ApplicationSignalActor,
  ApplicationSignalAuthorizationReceiptReference,
  ApplicationSignalDefinition,
  ApplicationSignalIssuance,
  ApplicationSignalReference,
} from './application-signals.js';
import {
  ApplicationSignalAuthorizationDeniedError,
  ApplicationSignalInputValidationError,
  hydrateApplicationSignal,
  type ApplicationSignalStore,
  type ApplicationSignalStoredInstance,
  type ApplicationSignalTerminalFinalizer,
} from './signal-runtime.js';
import type { ApplicationPostgresTransactionSql } from './postgres-runtime-contract.js';

export interface ApplicationSignalGatewayIdentity<TPrincipal = unknown> {
  readonly actor: ApplicationSignalActor;
  readonly principal: TPrincipal;
}

export interface ApplicationSignalGatewayOptions<TPrincipal = unknown> {
  readonly store: ApplicationSignalStore;
  readonly definitions: readonly ApplicationSignalDefinition[];
  readonly authenticate: (
    request: Request,
  ) =>
    | ApplicationSignalGatewayIdentity<TPrincipal>
    | Promise<ApplicationSignalGatewayIdentity<TPrincipal>>;
  readonly authorizeRead: (request: {
    readonly identity: ApplicationSignalGatewayIdentity<TPrincipal>;
    readonly signal: ApplicationSignalStoredInstance;
  }) =>
    | ApplicationSignalAuthorizationReceiptReference
    | false
    | Promise<ApplicationSignalAuthorizationReceiptReference | false>;
  readonly authorizeAction: (request: {
    readonly identity: ApplicationSignalGatewayIdentity<TPrincipal>;
    readonly signal: ApplicationSignalStoredInstance;
    readonly action: string;
    readonly input: object;
    readonly transaction?: ApplicationPostgresTransactionSql;
  }) =>
    | ApplicationSignalAuthorizationReceiptReference
    | false
    | Promise<ApplicationSignalAuthorizationReceiptReference | false>;
  readonly finalizeAction?: ApplicationSignalTerminalFinalizer;
  readonly basePath?: string;
  readonly maxRequestBytes?: number;
}

export interface ApplicationSignalClientOptions {
  readonly endpoint?: string;
  readonly fetch?: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
  readonly headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
}

/**
 * Exact-instance signal read/action gateway.
 *
 * The request body can contain only application action input and an optional
 * idempotency key. Authenticated actor identity and authorization receipts are
 * always derived by the server boundary.
 */
export function createApplicationSignalGateway<TPrincipal = unknown>(
  options: ApplicationSignalGatewayOptions<TPrincipal>,
): { handle(request: Request): Promise<Response | undefined> } {
  const basePath = normalizeSignalBasePath(options.basePath);
  const maxRequestBytes = options.maxRequestBytes ?? 1024 * 1024;
  const definitions = new Map(
    options.definitions.map((definition) => [definition.id, definition]),
  );
  if (definitions.size !== options.definitions.length) {
    throw new Error('Application signal gateway definitions must be unique.');
  }
  return {
    async handle(request) {
      const route = applicationSignalRoute(request, basePath);
      if (!route) return undefined;
      const definition = definitions.get(route.contractId);
      if (!definition) return signalJson({ error: 'not_found' }, 404);
      const instance = await options.store.read(route.signalId);
      if (!instance || instance.contract.id !== definition.id) {
        return signalJson({ error: 'not_found' }, 404);
      }
      let identity: ApplicationSignalGatewayIdentity<TPrincipal>;
      try {
        identity = await options.authenticate(request);
        assertSignalGatewayIdentity(identity);
      } catch {
        return signalJson({ error: 'unauthenticated' }, 401);
      }
      if (route.action === undefined) {
        if (request.method !== 'GET') {
          return signalJson(
            { error: 'method_not_allowed' },
            405,
            { allow: 'GET' },
          );
        }
        const receipt = await options.authorizeRead({ identity, signal: instance });
        if (!receipt) return signalJson({ error: 'forbidden' }, 403);
        return signalJson(signalIssuance(definition, instance), 200);
      }
      if (request.method !== 'POST') {
        return signalJson(
          { error: 'method_not_allowed' },
          405,
          { allow: 'POST' },
        );
      }
      if (!Object.hasOwn(definition.actions, route.action)) {
        return signalJson({ error: 'not_found' }, 404);
      }
      const body = await boundedSignalJson(request, maxRequestBytes);
      if (!body.ok) return body.response;
      const hydrated = hydrateApplicationSignal({
        store: options.store,
        definition,
        reference: signalReference(definition, instance),
        actor: identity.actor,
        authorizeAction: async ({ signal, action, input, transaction }) => {
          const receipt = await options.authorizeAction({
            identity,
            signal,
            action,
            input,
            ...(transaction ? { transaction } : {}),
          });
          if (!receipt) throw new ApplicationSignalAuthorizationDeniedError();
          return receipt;
        },
        ...(options.finalizeAction
          ? { finalizeAction: options.finalizeAction }
          : {}),
      });
      try {
        const invoke = Reflect.get(hydrated, route.action);
        if (typeof invoke !== 'function') {
          return signalJson({ error: 'not_found' }, 404);
        }
        const result = await Reflect.apply(invoke, hydrated, [
          body.value.input,
          {
            ...(body.value.idempotencyKey
              ? { idempotencyKey: body.value.idempotencyKey }
              : {}),
            signal: request.signal,
          },
        ]);
        return signalJson(result, 200);
      } catch (error) {
        if (error instanceof ApplicationSignalAuthorizationDeniedError) {
          return signalJson({ error: 'forbidden' }, 403);
        }
        if (signalValidationFailure(error)) {
          return signalJson({ error: 'invalid_input' }, 400);
        }
        throw error;
      }
    },
  };
}

/** Hydrates an inert signal reference into a browser-safe authenticated stub. */
export function hydrateApplicationSignalClient<
  TDefinition extends ApplicationSignalDefinition,
>(
  definition: TDefinition,
  reference: ApplicationSignalReference<TDefinition>,
  options: ApplicationSignalClientOptions = {},
): ApplicationSignal<TDefinition> {
  assertSignalReference(definition, reference);
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== 'function') {
    throw new Error('Application signal client requires fetch.');
  }
  const actions = Object.fromEntries(
    Object.keys(definition.actions).map((action) => [
      action,
      async (input: object, actionOptions?: {
        readonly idempotencyKey?: string;
        readonly signal?: AbortSignal;
      }) => {
        const headers = new Headers(
          typeof options.headers === 'function'
            ? await options.headers()
            : options.headers,
        );
        headers.set('content-type', 'application/json');
        const response = await fetchImplementation(
          applicationSignalUrl(
            options.endpoint,
            definition.id,
            reference.issuance.id,
            action,
          ),
          {
            method: 'POST',
            headers,
            credentials: 'same-origin',
            ...(actionOptions?.signal ? { signal: actionOptions.signal } : {}),
            body: JSON.stringify({
              input,
              ...(actionOptions?.idempotencyKey
                ? { idempotencyKey: actionOptions.idempotencyKey }
                : {}),
            }),
          },
        );
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(
            `Application signal ${definition.id}.${action} failed with HTTP ${response.status}.`,
          );
        }
        return payload;
      },
    ]),
  );
  return Object.freeze({ ...reference, ...actions }) as ApplicationSignal<TDefinition>;
}

export function hydrateApplicationSignalIssuanceClient<
  TDefinition extends ApplicationSignalDefinition,
>(
  definition: TDefinition,
  issuance: ApplicationSignalIssuance<
    TDefinition,
    ApplicationSignalReference<TDefinition>
  >,
  options: ApplicationSignalClientOptions = {},
): ApplicationSignalIssuance<TDefinition, ApplicationSignal<TDefinition>> {
  return Object.freeze({
    ...issuance,
    signal: hydrateApplicationSignalClient(
      definition,
      issuance.signal,
      options,
    ),
  });
}

function signalIssuance<TDefinition extends ApplicationSignalDefinition>(
  definition: TDefinition,
  instance: ApplicationSignalStoredInstance,
): ApplicationSignalIssuance<
  TDefinition,
  ApplicationSignalReference<TDefinition>
> {
  return {
    id: instance.id,
    input: instance.input as never,
    signal: signalReference(definition, instance),
    issuedAt: instance.issuedAt,
    expiresAt: instance.expiresAt,
  };
}

function signalReference<TDefinition extends ApplicationSignalDefinition>(
  definition: TDefinition,
  instance: ApplicationSignalStoredInstance,
): ApplicationSignalReference<TDefinition> {
  return Object.freeze({
    $type: 'applik8s.signal/v1',
    contract: {
      id: definition.id,
      name: definition.name,
      version: definition.version,
    },
    issuance: { id: instance.id },
    expiresAt: instance.expiresAt,
  });
}

function applicationSignalRoute(
  request: Request,
  basePath: string,
):
  | {
      readonly contractId: string;
      readonly signalId: string;
      readonly action?: string;
    }
  | undefined {
  const path = new URL(request.url).pathname;
  if (path !== basePath && !path.startsWith(`${basePath}/`)) return undefined;
  const parts = path.slice(basePath.length).split('/').filter(Boolean);
  if (parts.length === 2) {
    const [contractId, signalId] = parts;
    if (!contractId || !signalId) return undefined;
    return {
      contractId: decodeURIComponent(contractId),
      signalId: decodeURIComponent(signalId),
    };
  }
  if (parts.length === 4 && parts[2] === 'actions') {
    const [contractId, signalId, , action] = parts;
    if (!contractId || !signalId || !action) return undefined;
    return {
      contractId: decodeURIComponent(contractId),
      signalId: decodeURIComponent(signalId),
      action: decodeURIComponent(action),
    };
  }
  return undefined;
}

function applicationSignalUrl(
  endpoint: string | undefined,
  contractId: string,
  signalId: string,
  action: string,
): string {
  const path = `/__applik8s/v1/signals/${encodeURIComponent(contractId)}/${encodeURIComponent(signalId)}/actions/${encodeURIComponent(action)}`;
  return endpoint ? new URL(path, endpoint).toString() : path;
}

function normalizeSignalBasePath(value: string | undefined): string {
  const normalized = (value ?? '/__applik8s/v1/signals').replace(/\/+$/, '');
  if (!normalized.startsWith('/')) {
    throw new Error('Application signal gateway basePath must start with /.');
  }
  return normalized;
}

function assertSignalGatewayIdentity<TPrincipal>(
  identity: ApplicationSignalGatewayIdentity<TPrincipal>,
): void {
  if (!identity || typeof identity !== 'object' || !identity.actor?.id?.trim()) {
    throw new Error('Application signal gateway authentication returned no actor.');
  }
}

function assertSignalReference(
  definition: ApplicationSignalDefinition,
  reference: ApplicationSignalReference,
): void {
  if (
    reference.$type !== 'applik8s.signal/v1'
    || reference.contract.id !== definition.id
    || !reference.issuance.id
  ) {
    throw new Error(
      `Application signal reference does not belong to ${definition.id}.`,
    );
  }
}

async function boundedSignalJson(
  request: Request,
  maxBytes: number,
): Promise<
  | {
      readonly ok: true;
      readonly value: {
        readonly input: object;
        readonly idempotencyKey?: string;
      };
    }
  | { readonly ok: false; readonly response: Response }
> {
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    return { ok: false, response: signalJson({ error: 'payload_too_large' }, 413) };
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (
      !parsed
      || typeof parsed !== 'object'
      || Array.isArray(parsed)
      || !parsed.input
      || typeof parsed.input !== 'object'
      || Array.isArray(parsed.input)
      || (parsed.idempotencyKey !== undefined
        && typeof parsed.idempotencyKey !== 'string')
    ) {
      return { ok: false, response: signalJson({ error: 'invalid_request' }, 400) };
    }
    return {
      ok: true,
      value: {
        input: parsed.input,
        ...(parsed.idempotencyKey
          ? { idempotencyKey: parsed.idempotencyKey }
          : {}),
      },
    };
  } catch {
    return { ok: false, response: signalJson({ error: 'invalid_json' }, 400) };
  }
}

function signalJson(
  body: unknown,
  status: number,
  headers: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...Object.fromEntries(new Headers(headers)),
    },
  });
}

function signalValidationFailure(error: unknown): boolean {
  return error instanceof ApplicationSignalInputValidationError;
}
