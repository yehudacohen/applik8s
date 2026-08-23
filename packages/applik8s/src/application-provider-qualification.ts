// typecast-file-boundary: Provider qualifications rehydrate immutable graph records after discriminant validation.
import type {
  ApplicationProviderImplementation,
  ApplicationProviderToken,
  ApplicationQualifiableProviderToken,
  ApplicationQualifiedProviderToken,
} from './application-providers.js';

/**
 * Adds the shared qualifier constructor to a provider token.
 *
 * This lives outside application-providers.ts so extension provider families
 * can use the exact same runtime identity without introducing an ESM cycle.
 */
export function applicationQualifiableProviderToken<
  TToken extends ApplicationQualifiableProviderToken<unknown>,
>(token: Omit<TToken, 'named'>): TToken {
  const compatibilityRevision = token.contract?.version ?? 'v1alpha1';
  const qualified = Object.defineProperty(token, 'named', {
    value: <const TName extends string>(
      name: TName,
    ): ApplicationQualifiedProviderToken<
      ApplicationProviderImplementation<TToken>,
      TName
    > => {
      if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(name)) {
        throw new Error(
          `Application provider qualifier ${JSON.stringify(name)} must be a stable lower-case identifier.`,
        );
      }
      // typecast: validated token/name literals form the exact compile-time qualifier key.
      const key = `${token.name}@${compatibilityRevision}:${name}` as const;
      const accepts = token.accepts;
      const result: ApplicationQualifiedProviderToken<
        ApplicationProviderImplementation<TToken>,
        TName
      > = {
        kind: 'applicationQualifiedProvider',
        name: token.name,
        ...(token.description ? { description: token.description } : {}),
        ...(token.contract ? { contract: token.contract } : {}),
        ...(token.callableRuntime
          ? { callableRuntime: token.callableRuntime }
          : {}),
        ...(accepts
          ? {
              accepts: (
                implementation: unknown,
              ): implementation is ApplicationProviderImplementation<TToken> =>
                accepts(implementation),
            }
          : {}),
        // typecast: the input is exactly the public token with only named() omitted.
        base: token as unknown as ApplicationProviderToken<
          ApplicationProviderImplementation<TToken>
        >,
        qualification: {
          apiVersion: 'applik8s.providerQualification/v1alpha1',
          capability: token.name,
          name,
          compatibilityRevision,
          key,
        },
      };
      for (const method of ['schedule', 'query'] as const) {
        const implementation = Reflect.get(token, method);
        if (typeof implementation !== 'function') continue;
        Object.defineProperty(result, method, {
          enumerable: true,
          configurable: false,
          writable: false,
          value: implementation,
        });
      }
      return Object.freeze(result);
    },
    enumerable: false,
    configurable: false,
    writable: false,
  });
  // typecast: defineProperty installs the one method omitted from the input token.
  return qualified as unknown as TToken;
}
