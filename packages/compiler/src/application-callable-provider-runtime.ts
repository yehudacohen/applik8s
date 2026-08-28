import {
  type ApplicationProviderNode,
  resolveApplicationCallableProviderRuntimeEnvironment,
} from '@applik8s/core';

export interface ApplicationCallableProviderEnvironmentEntry {
  readonly [key: string]: unknown;
  readonly name: string;
  readonly value?: string;
  readonly valueFrom?: {
    readonly secretKeyRef: {
      readonly name: string;
      readonly key: string;
      readonly optional?: boolean;
    };
  };
}

/** Kubernetes environment projection over the provider-neutral core binding. */
export function applicationCallableProviderEnvironment(
  providers: readonly ApplicationProviderNode[],
  options: {
    readonly target: 'local' | 'aws-local' | 'aws' | 'kubernetes';
    readonly profile?: string;
    readonly namespace?: string;
  },
): readonly ApplicationCallableProviderEnvironmentEntry[] {
  return resolveApplicationCallableProviderRuntimeEnvironment(providers, options)
    .map(({ name, source }) => source.kind === 'value'
      ? { name, value: source.value }
      : {
          name,
          valueFrom: {
            secretKeyRef: {
              name: source.name,
              key: source.key,
              ...(source.optional ? { optional: true } : {}),
            },
          },
        });
}
