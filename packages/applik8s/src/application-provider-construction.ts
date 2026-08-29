// typecast-file-boundary: Public provider-runtime generics are serialized only after qualified-token, Secret-reference, callback-closure, and database-binding validation.
import type {
  ApplicationProviderPrivateRuntimeContract,
  ApplicationResourceRef,
} from '@applik8s/core';
import { serializeApplicationCallback } from './application-callback.js';
import { applicationProviderGraphNodeId } from './application-identifiers.js';
import type { ApplicationPostgresSql } from './postgres-runtime-contract.js';
import {
  type ApplicationProviderBinding,
  type ApplicationQualifiedProviderToken,
  type ApplicationTransactionalDatabaseProvider,
  applicationProviderPrivateRuntimeImplementation,
  applicationProviderQualificationFor,
  applicationProviderTokenName,
} from './application-providers.js';

export type ApplicationProviderPrivatePostgresSql = Omit<ApplicationPostgresSql, 'end'>;

export interface ApplicationProviderPrivatePostgresRuntime {
  readonly sql: ApplicationProviderPrivatePostgresSql;
  readonly database: string;
}

export interface ApplicationProviderPrivateRuntime<
  TCredentials extends Readonly<Record<string, unknown>>,
  TPostgres extends Readonly<Record<string, unknown>>,
> {
  readonly credentials: { readonly [K in keyof TCredentials]: string };
  readonly postgres: {
    readonly [K in keyof TPostgres]: ApplicationProviderPrivatePostgresRuntime;
  };
}

export interface ApplicationProviderPrivateCredentialReference {
  readonly secret: ApplicationResourceRef & {
    readonly apiVersion: 'v1';
    readonly kind: 'Secret';
    readonly name: string;
  };
  readonly key: string;
}

export interface DefineApplicationProviderRuntimeOptions<
  TImplementation,
  TCredentials extends Readonly<Record<string, ApplicationProviderPrivateCredentialReference>>,
  TPostgres extends Readonly<
    Record<string, ApplicationProviderBinding<ApplicationTransactionalDatabaseProvider>>
  >,
> {
  readonly implementation: string;
  readonly credentials?: TCredentials;
  readonly postgres?: TPostgres;
  readonly validate: (candidate: unknown) => candidate is TImplementation;
  readonly construct: (
    runtime: ApplicationProviderPrivateRuntime<TCredentials, TPostgres>,
  ) => TImplementation | Promise<TImplementation>;
}

/**
 * Declares a provider implementation constructed only in its selected managed
 * workload. Secret values and SQL clients never enter graph data, application
 * inputs, callback metadata, or the public provider handle.
 */
export function defineApplicationProviderRuntime<
  TImplementation,
  const TCredentials extends Readonly<
    Record<string, ApplicationProviderPrivateCredentialReference>
  > = Record<string, never>,
  const TPostgres extends Readonly<
    Record<string, ApplicationProviderBinding<ApplicationTransactionalDatabaseProvider>>
  > = Record<string, never>,
>(
  token: ApplicationQualifiedProviderToken<TImplementation>,
  options: DefineApplicationProviderRuntimeOptions<TImplementation, TCredentials, TPostgres>,
): TImplementation {
  if (token.kind !== 'applicationQualifiedProvider') {
    throw new Error(
      'defineApplicationProviderRuntime(...) requires Capability.named("qualifier").',
    );
  }
  if (!/^[a-z][a-z0-9]*(?:[-/][a-z0-9]+)*$/u.test(options.implementation)) {
    throw new Error(
      'defineApplicationProviderRuntime(...) implementation must be a stable lowercase adapter identity.',
    );
  }
  const providerGuard = token.base.accepts;
  if (!providerGuard) {
    throw new Error(
      `Provider ${token.qualification.key} requires an accepts guard for fail-closed runtime construction.`,
    );
  }
  if (options.validate !== providerGuard) {
    throw new Error(
      `Provider ${token.qualification.key} private runtime validator must be the exact accepts guard used by defineApplicationProvider(...).`,
    );
  }
  const credentials = Object.entries(options.credentials ?? {}).map(
    ([alias, reference]) => {
      assertAlias(alias, 'credential');
      if (
        reference.secret.apiVersion !== 'v1'
        || reference.secret.kind !== 'Secret'
        || !required(reference.secret.name)
        || !required(reference.key)
      ) {
        throw new Error(
          `Provider ${token.qualification.key} credential ${alias} must reference one exact v1 Secret key.`,
        );
      }
      return Object.freeze({
        alias,
        secret: Object.freeze({ ...reference.secret }),
        key: reference.key,
      });
    },
  );
  const postgres = Object.entries(options.postgres ?? {}).map(([alias, binding]) => {
    assertAlias(alias, 'PostgreSQL');
    if (
      binding?.kind !== 'applicationProvider'
      || applicationProviderTokenName(binding.token) !== 'TransactionalDatabase'
    ) {
      throw new Error(
        `Provider ${token.qualification.key} PostgreSQL dependency ${alias} must be an injected TransactionalDatabase binding.`,
      );
    }
    return Object.freeze({
      alias,
      databaseProviderNodeId: applicationProviderGraphNodeId(
        'TransactionalDatabase',
        applicationProviderQualificationFor(binding),
      ),
    });
  });
  const construct = serializeApplicationCallback({
    registrar: 'defineApplicationProviderRuntime',
    argumentIndex: 1,
    property: 'construct',
    label: `Provider ${token.qualification.key} private runtime constructor`,
    callback: options.construct as (...args: never[]) => unknown,
  });
  const validate = serializeApplicationCallback({
    registrar: 'defineApplicationProviderRuntime',
    argumentIndex: 1,
    property: 'validate',
    label: `Provider ${token.qualification.key} runtime validator`,
    callback: options.validate as (...args: never[]) => unknown,
  });
  if (construct.unresolved?.length || validate.unresolved?.length) {
    throw new Error(
      `Provider ${token.qualification.key} private runtime callbacks must close over resolvable module dependencies.`,
    );
  }
  const contract: ApplicationProviderPrivateRuntimeContract = Object.freeze({
    apiVersion: 'applik8s.providerRuntime/v1alpha1',
    implementation: options.implementation,
    construct: Object.freeze(construct),
    validate: Object.freeze(validate),
    credentials: Object.freeze(credentials),
    postgres: Object.freeze(postgres),
    isolation: Object.freeze({
      secretDelivery: 'readOnlyVolume',
      construction: 'selectedWorkloadOnly',
      publicContractExposure: 'none',
    }),
  });
  return applicationProviderPrivateRuntimeImplementation(token, contract);
}

function assertAlias(alias: string, kind: string): void {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(alias)) {
    throw new Error(
      `Provider-private ${kind} alias ${JSON.stringify(alias)} must be a stable JavaScript identifier.`,
    );
  }
}

function required(value: string): boolean {
  return value.trim().length > 0;
}
