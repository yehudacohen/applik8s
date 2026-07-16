import type { JsonObject } from '@applik8s/core';
import type { Type } from 'arktype';

export interface ApplicationTrustedContext<TValue> {
  readonly kind: 'applicationTrustedContext';
  readonly name: string;
  readonly schema: Type<TValue>;
  readonly contract: {
    readonly source: 'identity-provider' | 'application-provider';
    readonly trust: 'server-admitted';
    readonly jsonSchema: JsonObject;
  };
  readonly __value?: TValue;
}

export interface ApplicationTrustedContextOptions<TValue> {
  readonly schema: Type<TValue>;
  readonly source?: 'identity-provider' | 'application-provider';
}

/**
 * Declares a typed value established by an identity or application provider.
 * It deliberately does not define users, tenants, organizations, membership,
 * or authorization policy.
 */
export function trustedContext<TValue>(name: string, options: ApplicationTrustedContextOptions<TValue>): ApplicationTrustedContext<TValue> {
  if (!/^[A-Za-z][A-Za-z0-9._-]*$/.test(name)) {
    throw new Error(`Trusted context name ${JSON.stringify(name)} must be a stable identifier.`);
  }
  // typecast: ArkType emits the JSON-compatible schema consumed by the common schema contract.
  const jsonSchema = options.schema.toJsonSchema() as JsonObject;
  return Object.freeze({
    kind: 'applicationTrustedContext',
    name,
    schema: options.schema,
    contract: {
      source: options.source ?? 'identity-provider',
      // typecast: Object.freeze otherwise widens this nested literal despite the declared trusted-context return contract.
      trust: 'server-admitted' as const,
      jsonSchema,
    },
  });
}

export interface ApplicationPostgresRlsPolicy<TValue = unknown> {
  readonly kind: 'postgresRls';
  readonly context: ApplicationTrustedContext<TValue>;
  readonly column: string;
  readonly default: 'required' | 'global';
  readonly setting: string;
}

export interface ApplicationPostgresRlsOptions<TValue> {
  readonly context: ApplicationTrustedContext<TValue>;
  readonly column: string;
  readonly default?: 'required' | 'global';
  readonly setting?: string;
}

export const postgres = Object.freeze({
  rls<TValue>(options: ApplicationPostgresRlsOptions<TValue>): ApplicationPostgresRlsPolicy<TValue> {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(options.column)) {
      throw new Error(`PostgreSQL RLS context column ${JSON.stringify(options.column)} must be a stable Drizzle property name.`);
    }
    const setting = options.setting ?? `applik8s.context.${options.context.name}`;
    if (!/^[a-zA-Z][a-zA-Z0-9_.-]*$/.test(setting)) {
      throw new Error(`PostgreSQL RLS setting ${JSON.stringify(setting)} is invalid.`);
    }
    return Object.freeze({ kind: 'postgresRls', context: options.context, column: options.column, default: options.default ?? 'required', setting });
  },
});

export function validateTrustedContextValue<TValue>(context: ApplicationTrustedContext<TValue>, value: unknown): TValue {
  const result = context.schema(value);
  if (result && typeof result === 'object' && 'summary' in result) {
    throw new Error(`Trusted context ${context.name} failed runtime validation: ${String(Reflect.get(result, 'summary'))}`);
  }
  // typecast: ArkType returns TValue after its error-result branch has been rejected above.
  return result as TValue;
}
