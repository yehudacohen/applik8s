import type { ApplicationOperationContract } from '@applik8s/client';
import type { ApplicationCommandRoutingContext } from './application-models.js';

export interface ApplicationStagedEffectReference {
  readonly kind: 'applicationStagedEffect';
  readonly effect: 'event' | 'command';
  readonly contract: string;
  readonly sequence: number;
}

export interface ApplicationManagedEffects {
  readonly commandId: string;
  readonly routingContext: ApplicationCommandRoutingContext;
  emit(
    contract: { readonly id: string },
    payload: object,
  ): ApplicationStagedEffectReference;
  invoke(
    operation: ApplicationOperationContract,
    input: object,
    route: (messageId: string) => {
      readonly targetKey: import('./application-models.js').ApplicationCommandKey;
      readonly idempotencyKey?: string;
    },
  ): ApplicationStagedEffectReference;
}

type ApplicationManagedEffectsResolver =
  () => ApplicationManagedEffects | undefined;

const resolverSymbol = Symbol.for(
  '@applik8s/application-managed-effects-resolver',
);

export function installApplicationManagedEffectsResolver(
  resolver: ApplicationManagedEffectsResolver,
): () => void {
  const previous = Reflect.get(globalThis, resolverSymbol);
  Reflect.set(globalThis, resolverSymbol, resolver);
  return () => {
    if (Reflect.get(globalThis, resolverSymbol) !== resolver) return;
    if (previous === undefined) Reflect.deleteProperty(globalThis, resolverSymbol);
    else Reflect.set(globalThis, resolverSymbol, previous);
  };
}

export function currentApplicationManagedEffects():
  | ApplicationManagedEffects
  | undefined {
  const resolver = Reflect.get(globalThis, resolverSymbol);
  return typeof resolver === 'function'
    // typecast: the private global symbol is written only by the installer above; the function check restores its resolver signature.
    ? (resolver as ApplicationManagedEffectsResolver)()
    : undefined;
}

export function emitApplicationManagedEvent(
  contract: { readonly id: string },
  payload: object,
): ApplicationStagedEffectReference {
  const effects = currentApplicationManagedEffects();
  if (!effects) {
    throw new Error(
      `Event ${contract.id} can be emitted only inside an Applik8s managed transaction.`,
    );
  }
  return effects.emit(contract, payload);
}

/**
 * A staged command deliberately looks promise-like to existing operation
 * callers, but cannot be observed before the surrounding transaction commits.
 */
export function stagedApplicationCommandResult<TOutput>(
  reference: ApplicationStagedEffectReference,
): Promise<TOutput> {
  // typecast: application operations are promise-shaped publicly; this thenable trap prevents observing an uncommitted staged result.
  return Object.freeze({
    ...reference,
    // biome-ignore lint/suspicious/noThenProperty: staged operations intentionally fail if application code attempts pre-commit observation through await/then.
    then(): never {
      throw new Error(
        `Staged ${reference.effect} ${reference.contract} cannot be awaited before commit.`,
      );
    },
  }) as unknown as Promise<TOutput>;
}
