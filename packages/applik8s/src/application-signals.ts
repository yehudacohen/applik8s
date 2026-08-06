// typecast-file-boundary: validated signal action schemas cross a dynamic action-name registry while preserving their declaration-time contract generics.
import type {
  ApplicationIdentityReference,
  JsonObject,
  JsonValue,
} from '@applik8s/core';
import { applicationOperationId } from '@applik8s/core';
import {
  createApplicationRuntimeOperation,
  type ApplicationOperationLike,
  type AuthorizableOperation,
} from '@applik8s/client';
import type { SchemaInput } from '@applik8s/sdk';
import { type } from 'arktype';
import type {
  ApplicationAnalyticalProjectionBinding,
  ApplicationAnalyticalProjectionOptions,
  ApplicationAnalyticalProjectionTransform,
  ApplicationOnlineProjectionBinding,
  ApplicationOnlineProjectionDraft,
  ApplicationOnlineProjectionOptions,
  ApplicationOnlineProjectionTransform,
  ApplicationProjectionOutput,
  ApplicationSubscriptionBinding,
  ApplicationSubscriptionOptions,
  ApplicationStreamBinding,
  ApplicationStreamOptions,
} from './application-reactive.js';
import type { ApplicationDatabaseBinding } from './application.js';
import type { ApplicationQueryPrincipal } from './application-queries.js';

export interface ApplicationSignalContract<
  TInput extends object,
  TActions extends Readonly<Record<string, object>>,
> {
  readonly input: SchemaInput<TInput>;
  readonly actions: {
    readonly [TAction in keyof TActions]: SchemaInput<TActions[TAction]>;
  };
}

export interface ApplicationSignalDefinition<
  TInput extends object = object,
  TActions extends Readonly<Record<string, object>> = Readonly<
    Record<string, object>
  >,
> {
  readonly kind: 'applicationSignalDefinition';
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly input: SchemaInput<TInput>;
  readonly actions: {
    readonly [TAction in keyof TActions]: SchemaInput<TActions[TAction]>;
  };
}

/**
 * A non-callable, typed authority facet for a signal operation.
 *
 * Signal actions remain callable only on an exact hydrated Signal instance.
 * Contract-level facets exist so roles and service identities can authorize
 * signal visibility/actions without string operation IDs.
 */
export interface ApplicationSignalAuthorityOperation<
  TInput extends object,
  TOutput,
> extends ApplicationOperationLike, AuthorizableOperation<TInput, TOutput> {}

export type ApplicationSignalReadAuthority<
  TDefinition extends ApplicationSignalDefinition,
> = ApplicationSignalAuthorityOperation<
  { readonly signalId: string },
  ApplicationSignalIssuance<TDefinition>
>;

export type ApplicationSignalActionAuthority<
  TDefinition extends ApplicationSignalDefinition,
  TAction extends ApplicationSignalActionName<TDefinition>,
> = ApplicationSignalAuthorityOperation<
  {
    readonly signalId: string;
    readonly input: ApplicationSignalActionInput<TDefinition, TAction>;
  },
  ApplicationSignalActionResult<TDefinition, TAction>
>;

export type ApplicationSignalAuthorityActions<
  TDefinition extends ApplicationSignalDefinition,
> = {
  readonly [TAction in ApplicationSignalActionName<TDefinition>]:
    ApplicationSignalActionAuthority<TDefinition, TAction>;
};

export interface ApplicationSignalIdentity {
  readonly id: string;
}

export interface ApplicationSignalReference<
  TDefinition extends ApplicationSignalDefinition = ApplicationSignalDefinition,
> {
  readonly $type: 'applik8s.signal/v1';
  readonly contract: {
    readonly id: TDefinition['id'];
    readonly name: TDefinition['name'];
    readonly version: TDefinition['version'];
  };
  readonly issuance: ApplicationSignalIdentity;
  readonly expiresAt: string;
}

export interface ApplicationSignalActor {
  readonly id: string;
  readonly roles?: readonly string[];
  readonly attributes?: JsonObject;
}

export interface ApplicationSignalAuthorizationReceiptReference {
  readonly id: string;
}

export type ApplicationSignalActionName<
  TDefinition extends ApplicationSignalDefinition,
> = keyof TDefinition['actions'] & string;

export type ApplicationSignalActionInput<
  TDefinition extends ApplicationSignalDefinition,
  TAction extends ApplicationSignalActionName<TDefinition>,
> = TDefinition extends ApplicationSignalDefinition<
  object,
  infer TActions
>
  ? TActions[TAction]
  : never;

export type ApplicationSignalResolvedOutcome<
  TDefinition extends ApplicationSignalDefinition,
> = {
  readonly [TAction in ApplicationSignalActionName<TDefinition>]: {
    readonly status: 'resolved';
    readonly action: TAction;
    readonly input: ApplicationSignalActionInput<TDefinition, TAction>;
    readonly actor: ApplicationSignalActor;
    readonly receipt: ApplicationSignalAuthorizationReceiptReference;
    readonly decidedAt: string;
    readonly signal: ApplicationSignalReference<TDefinition>;
  };
}[ApplicationSignalActionName<TDefinition>];

export type ApplicationSignalOutcome<
  TDefinition extends ApplicationSignalDefinition,
> =
  | ApplicationSignalResolvedOutcome<TDefinition>
  | {
      readonly status: 'expired';
      readonly signal: ApplicationSignalReference<TDefinition>;
      readonly expiredAt: string;
    };

export type ApplicationSignalOutcomeMatcher<
  TDefinition extends ApplicationSignalDefinition,
  TResult,
> = {
  readonly [TAction in ApplicationSignalActionName<TDefinition>]: (
    outcome: Extract<
      ApplicationSignalResolvedOutcome<TDefinition>,
      { readonly action: TAction }
    >,
  ) => TResult | Promise<TResult>;
} & {
  readonly expired: (
    outcome: Extract<ApplicationSignalOutcome<TDefinition>, { status: 'expired' }>,
  ) => TResult | Promise<TResult>;
};

export interface ApplicationMatchedSignalOutcome<
  TDefinition extends ApplicationSignalDefinition,
> {
  readonly value: ApplicationSignalOutcome<TDefinition>;
  match<TResult>(
    matcher: ApplicationSignalOutcomeMatcher<TDefinition, TResult>,
  ): Promise<TResult>;
}

export type ApplicationSignalActionResult<
  TDefinition extends ApplicationSignalDefinition,
  TAction extends ApplicationSignalActionName<TDefinition>,
> =
  | {
      readonly status: 'resolved';
      readonly outcome: Extract<
        ApplicationSignalResolvedOutcome<TDefinition>,
        { readonly action: TAction }
      >;
      readonly receipt: ApplicationSignalAuthorizationReceiptReference;
    }
  | {
      readonly status: 'alreadyResolved';
      /**
       * Losing callers receive only the terminal class and timestamp. They do
       * not learn the winning action, payload, actor, or receipt unless a
       * separately authorized audit operation exposes them.
       */
      readonly outcome: {
        readonly status: 'resolved' | 'expired';
        readonly decidedAt: string;
      };
    };

export interface ApplicationSignalActionOptions {
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
}

export type ApplicationSignalActions<
  TDefinition extends ApplicationSignalDefinition,
> = {
  readonly [TAction in ApplicationSignalActionName<TDefinition>]: (
    input: ApplicationSignalActionInput<TDefinition, TAction>,
    options?: ApplicationSignalActionOptions,
  ) => Promise<ApplicationSignalActionResult<TDefinition, TAction>>;
};

export type ApplicationSignal<
  TDefinition extends ApplicationSignalDefinition,
> = ApplicationSignalReference<TDefinition> &
  ApplicationSignalActions<TDefinition>;

export interface ApplicationSignalIssuance<
  TDefinition extends ApplicationSignalDefinition,
  TSignal = ApplicationSignal<TDefinition>,
> {
  readonly id: string;
  readonly input: TDefinition extends ApplicationSignalDefinition<
    infer TInput,
    Readonly<Record<string, object>>
  >
    ? TInput
    : never;
  readonly signal: TSignal;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export type ApplicationSignalProjectionSource<
  TDefinition extends ApplicationSignalDefinition,
> = ApplicationSignalIssuance<
  TDefinition,
  ApplicationSignalReference<TDefinition>
>;

export type ApplicationSignalSubjectSelector =
  | ApplicationIdentityReference
  | {
      readonly identity: ApplicationIdentityReference;
    }
  | {
      readonly role: string;
      readonly scope?: Readonly<Record<string, JsonValue>>;
    }
  | {
      readonly relationship: string;
      readonly from: ApplicationIdentityReference;
      readonly target: Readonly<Record<string, JsonValue>>;
    };

export type ApplicationSignalEmitOptions<
  TDefinition extends ApplicationSignalDefinition,
> = {
  readonly input: TDefinition extends ApplicationSignalDefinition<
    infer TInput,
    Readonly<Record<string, object>>
  >
    ? TInput
    : never;
  readonly expiresIn: string;
  readonly target: Readonly<Record<string, JsonValue>>;
} & (
  | {
      readonly authorize: readonly ApplicationSignalSubjectSelector[];
      readonly grantAccessTo?: never;
    }
  | {
      readonly authorize?: never;
      readonly grantAccessTo:
        | ApplicationIdentityReference
        | readonly ApplicationIdentityReference[];
    }
);

export interface ApplicationSignalDecision<
  TDefinition extends ApplicationSignalDefinition,
> extends ApplicationSignalReference<TDefinition> {
  (): Promise<ApplicationMatchedSignalOutcome<TDefinition>>;
  readonly issueReceipt: ApplicationSignalAuthorizationReceiptReference;
}

export interface ApplicationSignalBindingBase<
  TDefinition extends ApplicationSignalDefinition,
> extends Omit<
    ApplicationStreamBinding<ApplicationSignalIssuance<TDefinition>>,
    'project'
  > {
  readonly signalKind: 'applicationSignal';
  readonly signal: TDefinition;
  project<TRow extends object>(
    options: Omit<
      ApplicationAnalyticalProjectionOptions<
        ApplicationSignalProjectionSource<TDefinition>,
        TRow
      >,
      'source'
    >,
  ): ApplicationAnalyticalProjectionBinding<
    ApplicationSignalProjectionSource<TDefinition>,
    TRow
  >;
  project<TRow extends object>(
    name: string,
    options: Omit<
      ApplicationAnalyticalProjectionOptions<
        ApplicationSignalProjectionSource<TDefinition>,
        TRow
      >,
      'source'
    >,
  ): ApplicationAnalyticalProjectionBinding<
    ApplicationSignalProjectionSource<TDefinition>,
    TRow
  >;
  project<
    TRow extends object,
    TValue extends object,
    TSnapshot extends object = object,
  >(
    name: string,
    options: Omit<
      ApplicationOnlineProjectionOptions<
        ApplicationSignalProjectionSource<TDefinition>,
        TRow,
        TValue,
        TSnapshot
      >,
      'source'
    >,
  ): ApplicationOnlineProjectionBinding<
    ApplicationSignalProjectionSource<TDefinition>,
    TRow,
    TValue
  >;
  project<
    TRow extends object,
    TValue extends object,
    TSnapshot extends object = object,
  >(
    options: Omit<
      ApplicationOnlineProjectionOptions<
        ApplicationSignalProjectionSource<TDefinition>,
        TRow,
        TValue,
        TSnapshot
      >,
      'source'
    >,
  ): ApplicationOnlineProjectionBinding<
    ApplicationSignalProjectionSource<TDefinition>,
    TRow,
    TValue
  >;
  project<TValue extends object>(
    output: ApplicationProjectionOutput<TValue>,
    transform: ApplicationAnalyticalProjectionTransform<
      ApplicationSignalProjectionSource<TDefinition>,
      TValue
    >,
  ): ApplicationAnalyticalProjectionBinding<
    ApplicationSignalProjectionSource<TDefinition>,
    TValue
  >;
  project<TValue extends object>(
    output: ApplicationProjectionOutput<TValue>,
    transform: ApplicationOnlineProjectionTransform<
      ApplicationSignalProjectionSource<TDefinition>,
      TValue
    >,
  ): ApplicationOnlineProjectionDraft<
    ApplicationSignalProjectionSource<TDefinition>,
    TValue
  >;
  subscribe<
    TSubscriberPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
  >(
    name: string,
    options: Omit<ApplicationSubscriptionOptions<TSubscriberPrincipal>, 'source'>,
  ): ApplicationSubscriptionBinding<TSubscriberPrincipal>;
  /**
   * Consumes the authorized issuance stream through the environment-specific
   * facade. The same authored binding declares public subscriptions with the
   * inherited subscribe(name, options) overload during graph construction.
   */
  subscribe(
    options?: ApplicationSignalClientSubscriptionOptions,
  ): ApplicationSignalClientSubscription<TDefinition>;
}

export type ApplicationSignalBinding<
  TDefinition extends ApplicationSignalDefinition,
> = ApplicationSignalBindingBase<TDefinition>
  & {
    /** Authorizes exact issuance visibility; actual reads occur through subscriptions. */
    readonly read: ApplicationSignalReadAuthority<TDefinition>;
  }
  & ApplicationSignalAuthorityActions<TDefinition>;

export interface ApplicationSignalClientSubscriptionOptions {
  readonly after?: string;
  readonly signal?: AbortSignal;
}

export interface ApplicationSignalClientSubscription<
  TDefinition extends ApplicationSignalDefinition,
> extends AsyncIterable<
    ApplicationSignalIssuance<TDefinition, ApplicationSignal<TDefinition>>
  > {
  replay(options?: {
    readonly after?: string;
    readonly limit?: number;
    readonly signal?: AbortSignal;
  }): Promise<{
    readonly items: readonly ApplicationSignalIssuance<
      TDefinition,
      ApplicationSignal<TDefinition>
    >[];
    readonly cursor: string;
    readonly exhausted: boolean;
  }>;
}

export interface ApplicationWorkflowSignalRuntime {
  emit<TDefinition extends ApplicationSignalDefinition>(
    definition: TDefinition,
    options: ApplicationSignalEmitOptions<TDefinition>,
  ): Promise<ApplicationSignalDecision<TDefinition>>;
}

const workflowSignalRuntimeResolvers: Array<
  () => ApplicationWorkflowSignalRuntime | undefined
> = [];

export function installApplicationWorkflowSignalRuntimeResolver(
  resolver: () => ApplicationWorkflowSignalRuntime | undefined,
): () => void {
  workflowSignalRuntimeResolvers.push(resolver);
  return () => {
    const index = workflowSignalRuntimeResolvers.lastIndexOf(resolver);
    if (index >= 0) workflowSignalRuntimeResolvers.splice(index, 1);
  };
}

export async function emitApplicationWorkflowSignal<
  TDefinition extends ApplicationSignalDefinition,
>(
  definition: TDefinition,
  options: ApplicationSignalEmitOptions<TDefinition>,
): Promise<ApplicationSignalDecision<TDefinition>> {
  for (let index = workflowSignalRuntimeResolvers.length - 1; index >= 0; index -= 1) {
    const runtime = workflowSignalRuntimeResolvers[index]?.();
    if (runtime) return await runtime.emit(definition, options);
  }
  throw new Error(
    'workflow.emitSignal(...) is available only inside durable workflow execution.',
  );
}

export function defineApplicationSignal<
  TInput extends object,
  TActions extends Readonly<Record<string, object>>,
>(
  id: string,
  contract: ApplicationSignalContract<TInput, TActions>,
): ApplicationSignalDefinition<TInput, TActions> {
  const identity = signalContractIdentity(id);
  const actions = Object.keys(contract.actions);
  if (actions.length === 0) {
    throw new Error(`Signal ${id} must declare at least one terminal action.`);
  }
  for (const action of actions) {
    if (!/^[a-z][a-z0-9-]*$/.test(action)) {
      throw new Error(
        `Signal ${id} action ${JSON.stringify(action)} must use lower-case kebab-case.`,
      );
    }
    if (applicationSignalReservedMembers.has(action)) {
      throw new Error(
        `Signal ${id} action ${JSON.stringify(action)} conflicts with the contract member of the same name.`,
      );
    }
  }
  return Object.freeze({
    kind: 'applicationSignalDefinition',
    id,
    ...identity,
    input: contract.input,
    actions: Object.freeze({ ...contract.actions }),
  });
}

const applicationSignalReservedMembers = new Set([
  'project',
  'read',
  'signal',
  'signalKind',
  'subscribe',
]);

export function applicationSignalAuthorityFacets<
  TDefinition extends ApplicationSignalDefinition,
>(
  definition: TDefinition,
): {
  readonly read: ApplicationSignalReadAuthority<TDefinition>;
} & ApplicationSignalAuthorityActions<TDefinition> {
  const read = applicationSignalAuthorityOperation<
    { readonly signalId: string },
    ApplicationSignalIssuance<TDefinition>
  >(definition, 'issuance.read');
  const actions = Object.fromEntries(
    Object.keys(definition.actions).map((action) => [
      action,
      applicationSignalAuthorityOperation(definition, action),
    ]),
  ) as ApplicationSignalAuthorityActions<TDefinition>;
  return Object.freeze({ read, ...actions });
}

function applicationSignalAuthorityOperation<TInput extends object, TOutput>(
  definition: ApplicationSignalDefinition,
  operation: string,
): ApplicationSignalAuthorityOperation<TInput, TOutput> {
  const handle = createApplicationRuntimeOperation<TInput, TOutput>({
    apiVersion: 'applik8s.operation/v1alpha1',
    kind: 'applicationOperation',
    id: applicationOperationId({
      domain: 'signals',
      owner: definition.id,
      operation,
    }),
    model: definition.id,
    name: operation,
    operation: 'custom',
    transport: 'runtime',
    version: definition.version,
    authority: {
      classification: 'runtime-grantable',
      permissionIds: [],
      grantable: true,
      delegable: false,
      scope: { kind: 'all' },
      transports: ['direct', 'http', 'event'],
    },
  });
  return handle as ApplicationSignalAuthorityOperation<TInput, TOutput>;
}

export function applicationSignalStreamOptions<
  TDefinition extends ApplicationSignalDefinition,
>(
  definition: TDefinition,
  database: ApplicationDatabaseBinding,
): {
  readonly payload: SchemaInput<ApplicationSignalIssuance<TDefinition>>;
  readonly options: ApplicationStreamOptions<ApplicationSignalIssuance<TDefinition>>;
} {
  const payload = type({
    id: 'string',
    input: definition.input,
    signal: {
      $type: "'applik8s.signal/v1'",
      contract: {
        id: 'string',
        name: 'string',
        version: 'string',
      },
      issuance: { id: 'string' },
      expiresAt: 'string',
    },
    issuedAt: 'string',
    expiresAt: 'string',
  } as never) as unknown as SchemaInput<ApplicationSignalIssuance<TDefinition>>;
  return {
    payload,
    options: {
      database,
      retention: { maxAgeSeconds: 30 * 24 * 60 * 60 },
      partitionBy: (issuance) => issuance.id,
      authorize: denyBroadApplicationSignalStreamVisibility,
      authority: 'postgres-outbox',
      replay: 'supported',
      __applicationSignal: {
        id: definition.id,
        name: definition.name,
        version: definition.version,
        actions: Object.fromEntries(
          Object.entries(definition.actions),
        ),
      },
    } as ApplicationStreamOptions<ApplicationSignalIssuance<TDefinition>>,
  };
}

function denyBroadApplicationSignalStreamVisibility(): never {
  throw new Error(
    'Signal visibility is exact-instance authority and cannot be evaluated as a broad stream predicate.',
  );
}

function signalContractIdentity(id: string): {
  readonly name: string;
  readonly version: string;
} {
  const separator = id.lastIndexOf('.');
  if (separator <= 0 || separator === id.length - 1) {
    throw new Error(
      `Signal identity ${JSON.stringify(id)} must end in an explicit .vN version.`,
    );
  }
  const name = id.slice(0, separator);
  const version = id.slice(separator + 1);
  if (!/^[a-z][a-z0-9.-]*$/.test(name)) {
    throw new Error(
      `Signal identity ${JSON.stringify(id)} must use lower-case dot-separated names.`,
    );
  }
  if (!/^v[1-9][0-9]*$/.test(version)) {
    throw new Error(
      `Signal identity ${JSON.stringify(id)} must end in v1, v2, and so on.`,
    );
  }
  return { name, version };
}
