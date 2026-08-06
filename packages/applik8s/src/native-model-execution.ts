import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  ApplicationModelCommandParticipantClient,
  ApplicationModelObject,
  ApplicationModelQueryOptions,
  ApplicationModelQueryPage,
} from './application-models.js';

const applicationNativeModelClients =
  new AsyncLocalStorage<Readonly<Record<string, ApplicationModelCommandParticipantClient>>>();
const applicationNativeModelTransactionRuntime =
  new AsyncLocalStorage<ApplicationNativeModelTransactionRuntime>();

const applicationNativeModelMethodSymbol = Symbol.for(
  'applik8s.applicationNativeModelMethod',
);

export interface ApplicationNativeModelMethodDependency {
  readonly kind: 'applicationNativeModelMethod';
  readonly model: object;
  readonly modelName: string;
  readonly method: 'get' | 'find' | 'require' | 'edit';
  readonly access: 'read' | 'write';
}

export interface ApplicationNativeModelTransactionRequest<
  TValue extends object = object,
  TIdentity = unknown,
  TResult = unknown,
> {
  readonly model: string;
  readonly identity: TIdentity;
  readonly handler: (
    target: TValue & ApplicationNativeModelEditTarget<TValue, TIdentity>,
  ) => TResult | Promise<TResult>;
}

/**
 * Trigger-owned runtime lowering for an inferred Model.edit(...) boundary.
 * Implementations must enter the framework's durable command transaction;
 * this is deliberately not a public application authoring abstraction.
 */
export interface ApplicationNativeModelTransactionRuntime {
  edit<TValue extends object, TIdentity, TResult>(
    request: ApplicationNativeModelTransactionRequest<
      TValue,
      TIdentity,
      TResult
    >,
  ): Promise<TResult>;
}

/**
 * Framework-owned semantic metadata attached to promoted-model methods.
 *
 * The compiler follows ordinary helper calls and eventually reaches these
 * leaves. Keeping the model object here lets every registration family infer
 * the exact application binding without asking authors to repeat participant
 * arrays or model names.
 */
export function bindApplicationNativeModelMethod(
  method: (...args: never[]) => unknown,
  dependency: ApplicationNativeModelMethodDependency,
): void {
  Object.defineProperty(method, applicationNativeModelMethodSymbol, {
    value: Object.freeze(dependency),
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

export function applicationNativeModelMethodDependencyFor(
  value: unknown,
): ApplicationNativeModelMethodDependency | undefined {
  if (typeof value !== 'function') return undefined;
  const dependency = Reflect.get(value, applicationNativeModelMethodSymbol);
  if (
    !dependency
    || typeof dependency !== 'object'
    || Reflect.get(dependency, 'kind') !== 'applicationNativeModelMethod'
  ) {
    return undefined;
  }
  // typecast: the private symbol and stable discriminant prove the immutable compiler-owned metadata shape.
  return dependency as ApplicationNativeModelMethodDependency;
}

/** Installs the transaction-scoped clients behind direct promoted-model reads. */
export function withApplicationNativeModelClients<TResult>(
  clients: Readonly<Record<string, ApplicationModelCommandParticipantClient>>,
  operation: () => TResult,
): TResult {
  return applicationNativeModelClients.run(clients, operation);
}

/** Installs one trigger-scoped lowering behind direct Model.edit(...) calls. */
export function withApplicationNativeModelTransactionRuntime<TResult>(
  runtime: ApplicationNativeModelTransactionRuntime,
  operation: () => TResult,
): TResult {
  return applicationNativeModelTransactionRuntime.run(runtime, operation);
}

export async function getApplicationNativeModelObject(
  model: string,
  identity: unknown,
): Promise<ApplicationModelObject<object, object> | undefined> {
  return requiredClient(model).get({ id: String(identity) });
}

export async function findApplicationNativeModelObjects(
  model: string,
  options: ApplicationModelQueryOptions<object> & { readonly limit: number },
): Promise<ApplicationModelQueryPage<object, object>> {
  return requiredClient(model).query(options);
}

export interface ApplicationNativeModelEditTarget<
  TValue extends object,
  TIdentity,
> {
  readonly identity: TIdentity;
  readonly revision?: string;
  readonly value: TValue;
  update(patch: Partial<TValue>): Promise<void>;
  delete(): Promise<void>;
}

export async function requireApplicationNativeModelObject<
  TValue extends object,
  TIdentity,
>(
  model: string,
  identity: TIdentity,
): Promise<ApplicationModelObject<TValue, object>> {
  const value = await requiredClient(model).get({ id: String(identity) });
  if (!value) {
    throw new Error(
      `Application model ${model} has no object with identity ${JSON.stringify(identity)}.`,
    );
  }
  // typecast: the matching promoted-model client erases only this binding's value generic.
  return value as ApplicationModelObject<TValue, object>;
}

export async function editApplicationNativeModelObject<
  TValue extends object,
  TIdentity,
  TResult,
>(
  model: string,
  identity: TIdentity,
  handler: (
    target: TValue & ApplicationNativeModelEditTarget<TValue, TIdentity>,
  ) => TResult | Promise<TResult>,
): Promise<TResult> {
  const client = applicationNativeModelClients.getStore()?.[model];
  if (!client) {
    const runtime = applicationNativeModelTransactionRuntime.getStore();
    if (!runtime) {
      throw unavailableApplicationNativeModel(model);
    }
    return runtime.edit({ model, identity, handler });
  }
  const current = await requireApplicationNativeModelObject<TValue, TIdentity>(
    model,
    identity,
  );
  // typecast: the preceding model-bound require restored TValue before this enumerable copy.
  let value = { ...current.spec } as TValue;
  let revision = current.revision;
  let deleted = false;
  // typecast: the spread supplies TValue and defineProperties installs all edit capabilities before escape.
  const target = { ...value } as TValue &
    ApplicationNativeModelEditTarget<TValue, TIdentity>;
  Object.defineProperties(target, {
    identity: { value: identity, enumerable: false },
    revision: { get: () => revision, enumerable: false },
    value: { get: () => value, enumerable: false },
    update: {
      enumerable: false,
      value: async (patch: Partial<TValue>) => {
        if (deleted) {
          throw new Error(
            `Application model ${model} object ${JSON.stringify(identity)} was already deleted in this transaction.`,
          );
        }
        const updated = await client.patch(
          { id: String(identity) },
          { spec: patch },
        );
        // typecast: this model-bound participant returns TValue after its transaction write.
        value = { ...updated.spec } as TValue;
        revision = updated.revision;
        for (const [key, next] of Object.entries(value)) {
          Reflect.set(target, key, next);
        }
      },
    },
    delete: {
      enumerable: false,
      value: async () => {
        if (deleted) return;
        await client.delete({ id: String(identity) });
        deleted = true;
      },
    },
  });
  return handler(target);
}

function requiredClient(model: string): ApplicationModelCommandParticipantClient {
  const client = applicationNativeModelClients.getStore()?.[model];
  if (!client) {
    throw unavailableApplicationNativeModel(model);
  }
  return client;
}

function unavailableApplicationNativeModel(model: string): Error {
  return new Error(
    `Application model ${model} is not available in this managed transaction. `
    + 'Call the promoted model directly inside the authored handler so the compiler can infer it.',
  );
}
