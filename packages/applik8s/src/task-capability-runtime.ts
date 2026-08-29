// typecast-file-boundary: Capability factories preserve their generic result after the branded factory and frozen binding-context boundary validates runtime construction.
import type { JsonValue } from '@applik8s/core';
import type { ApplicationTaskOperationPrincipal } from './task-operation-runtime.js';

const taskCapabilityFactoryKind: unique symbol = Symbol.for(
  'applik8s.applicationTaskCapabilityFactory/v1alpha1',
);

export interface ApplicationTaskCapabilityBindingContext {
  readonly task: {
    readonly contractId: string;
    readonly contractVersion: string;
    readonly handlerId: string;
    readonly workerId: string;
  };
  readonly invocation: {
    readonly invocationId: string;
    readonly idempotencyKey: string;
    readonly attempt: number;
    readonly correlationId?: string;
    readonly causationId?: string;
    readonly traceparent?: string;
    readonly trustedContext?: {
      readonly values: Readonly<Record<string, JsonValue>>;
      readonly digest: string;
      readonly changeScopes?: Readonly<Record<string, string>>;
    };
    readonly signal: AbortSignal;
    readonly deadline: string;
    readonly cancellationRevision: string;
  };
  readonly authority:
    | { readonly kind: 'none' }
    | {
        readonly kind: 'admitted-task';
        readonly principal: ApplicationTaskOperationPrincipal;
      };
}

export interface ApplicationTaskCapabilityFactory<TCapability> {
  readonly [taskCapabilityFactoryKind]: true;
  bind(context: ApplicationTaskCapabilityBindingContext): TCapability;
}

export function defineApplicationTaskCapabilityFactory<TCapability>(
  bind: (context: ApplicationTaskCapabilityBindingContext) => TCapability,
): ApplicationTaskCapabilityFactory<TCapability> {
  if (typeof bind !== 'function') {
    throw new TypeError('Application task capability factory requires a bind function.');
  }
  return Object.freeze({ [taskCapabilityFactoryKind]: true as const, bind });
}

export function bindApplicationTaskCapability<TCapability>(
  capability: TCapability | ApplicationTaskCapabilityFactory<TCapability>,
  context: ApplicationTaskCapabilityBindingContext,
): TCapability {
  return isApplicationTaskCapabilityFactory(capability)
    ? capability.bind(frozenBindingContext(context))
    : capability;
}

export function createApplicationTaskCapabilityBindings(
  capabilities: Readonly<Record<string, unknown>>,
  declaredCapabilities: readonly string[],
  context: ApplicationTaskCapabilityBindingContext,
  contractName: string,
): { use(name: string): unknown } {
  const declared = new Set(declaredCapabilities);
  const bound = new Map<string, unknown>();
  return Object.freeze({
    use(name: string): unknown {
      if (!declared.has(name)) {
        throw new Error(
          `Task ${contractName} attempted to use undeclared capability ${JSON.stringify(name)}`,
        );
      }
      if (bound.has(name)) return bound.get(name);
      const capability = capabilities[name];
      if (!capability) {
        throw new Error(`Task ${contractName} capability ${name} is not configured`);
      }
      const value = bindApplicationTaskCapability(capability, context);
      bound.set(name, value);
      return value;
    },
  });
}

export function isApplicationTaskCapabilityFactory<TCapability = unknown>(
  value: unknown,
): value is ApplicationTaskCapabilityFactory<TCapability> {
  return typeof value === 'object'
    && value !== null
    && Reflect.get(value, taskCapabilityFactoryKind) === true
    && typeof Reflect.get(value, 'bind') === 'function';
}

function frozenBindingContext(
  context: ApplicationTaskCapabilityBindingContext,
): ApplicationTaskCapabilityBindingContext {
  const trustedContext = context.invocation.trustedContext;
  return Object.freeze({
    task: Object.freeze({ ...context.task }),
    invocation: Object.freeze({
      ...context.invocation,
      ...(trustedContext
        ? {
            trustedContext: Object.freeze({
              ...trustedContext,
              values: Object.freeze({ ...trustedContext.values }),
              ...(trustedContext.changeScopes
                ? { changeScopes: Object.freeze({ ...trustedContext.changeScopes }) }
                : {}),
            }),
          }
        : {}),
    }),
    authority: Object.freeze({ ...context.authority }),
  });
}
