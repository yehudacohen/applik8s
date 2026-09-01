// typecast-file-boundary: adversarial runtime-selection fixtures deliberately
// bypass the public provider-builder types to exercise fail-closed decoding.

import {
  app,
  applicationGraphFor,
  defineApplicationProvider,
  installApplicationTelemetryRuntimeResolver,
} from '@applik8s/applik8s';
import {
  ApplicationProviderRuntimeSelectionError,
  resolveApplicationProviderRuntimeImplementation,
} from '@applik8s/applik8s/internal/provider-runtime';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { applicationCallableProviderDependencies } from '../src/application-provider-dependencies';
import type {
  ApplicationTelemetryBoundary,
  ApplicationTelemetryRuntime,
} from '../src/application-telemetry-runtime.js';

describe('managed provider runtime selection', () => {
  it('retains an inert qualified provider token captured as a structured operation argument', () => {
    const DatasetProvider = defineApplicationProvider({
      interface: 'DatasetProvider',
      version: 'v1alpha1',
      accepts: (candidate): candidate is { readonly kind: 'dataset' } =>
        Boolean(candidate && typeof candidate === 'object' && Reflect.get(candidate, 'kind') === 'dataset'),
    }).named('history');

    expect(applicationCallableProviderDependencies({ DatasetProvider })).toEqual([
      expect.objectContaining({
        identifier: 'DatasetProvider',
        projection: 'token',
        placement: 'providerDependency',
        provider: expect.objectContaining({
          interface: 'DatasetProvider',
          nodeId: 'provider.dataset-provider.v1alpha1.history',
        }),
      }),
    ]);
  });

  it('records only actual provider calls and preserves synchronous, asynchronous, and failure semantics', async () => {
    const failure = new Error('private provider credential failure');
    interface FixtureProvider {
      readonly kind: 'fixture';
      sync(input: string): string;
      async(input: string): Promise<string>;
      fail(): never;
    }
    const FixtureProvider = defineApplicationProvider<FixtureProvider>({
      interface: 'FixtureProvider',
      version: 'v1alpha1',
      runtime: {
        operations: {
          sync: { module: '@fixture/provider/runtime', export: 'sync', access: 'none' },
          async: { module: '@fixture/provider/runtime', export: 'asyncValue', access: 'none' },
          fail: { module: '@fixture/provider/runtime', export: 'fail', access: 'none' },
        },
      },
      accepts: (candidate): candidate is FixtureProvider =>
        candidate !== null
        && typeof candidate === 'object'
        && Reflect.get(candidate, 'kind') === 'fixture',
    }).named('primary');
    const application = app('provider-telemetry', {
      spec: type({ profile: "'starter' | 'dedicated'" }),
      status: type({ ready: 'boolean' }),
    });
    const implementation: FixtureProvider = {
      kind: 'fixture',
      sync: (input) => `sync:${input}`,
      async: async (input) => `async:${input}`,
      fail: () => { throw failure; },
    };
    application.profile(application.installation.spec, 'profile')
      .provide(FixtureProvider)
      .starter(() => implementation)
      .dedicated(() => implementation)
      .exhaustive();

    const boundaries: ApplicationTelemetryBoundary[] = [];
    const runtime: ApplicationTelemetryRuntime = {
      async run(_boundary, execute) { return execute(); },
      runValue(boundary, execute) {
        boundaries.push(boundary);
        return execute();
      },
      log() {},
      count() {},
      record() {},
      capture() { return undefined; },
    };
    const dispose = installApplicationTelemetryRuntimeResolver(() => runtime);
    const provider = application.inject(FixtureProvider);
    const extracted = provider.sync;
    const previousVariant = process.env.APPLIK8S_PROFILE_VARIANT;
    process.env.APPLIK8S_PROFILE_VARIANT = 'starter';
    try {
      expect(extracted).toBe(provider.sync);
      expect(extracted('one')).toBe('sync:one');
      await expect(provider.async('two')).resolves.toBe('async:two');
      expect(() => provider.fail()).toThrow(failure);
      expect(boundaries).toEqual([
        expect.objectContaining({
          kind: 'provider',
          identity: 'FixtureProvider.sync',
          provider: 'provider.fixture-provider.v1alpha1.primary',
          definition: 'sync',
          relationship: 'synchronous',
        }),
        expect.objectContaining({ kind: 'provider', identity: 'FixtureProvider.async' }),
        expect.objectContaining({ kind: 'provider', identity: 'FixtureProvider.fail' }),
      ]);
    } finally {
      dispose();
      if (previousVariant === undefined) {
        delete process.env.APPLIK8S_PROFILE_VARIANT;
      } else {
        process.env.APPLIK8S_PROFILE_VARIANT = previousVariant;
      }
    }
  });

  it('returns direct provider implementations unchanged', () => {
    const implementation = { kind: 'direct', invoke: () => 'direct' };
    expect(
      resolveApplicationProviderRuntimeImplementation(implementation, {}),
    ).toBe(implementation);
    expect(
      resolveApplicationProviderRuntimeImplementation(
        {
          kind: 'applicationProvider',
          implementation,
        } as never,
        {},
      ),
    ).toBe(implementation);
  });

  it('selects the provisioned implementation for the managed profile variant', () => {
    const starter = { kind: 'starter', invoke: () => 'starter' };
    const dedicated = { kind: 'dedicated', invoke: () => 'dedicated' };
    const binding = {
      kind: 'applicationProvider',
      implementation: {
        kind: 'application-provider-selection',
        selector: '${schema.spec.profile}',
        cases: { starter, dedicated },
        default: starter,
      },
    } as never;
    expect(
      resolveApplicationProviderRuntimeImplementation(binding, {
        APPLIK8S_PROFILE_VARIANT: 'dedicated',
      }),
    ).toBe(dedicated);
  });

  it('fails closed when the runtime variant is absent or unknown', () => {
    const selection = {
      kind: 'application-provider-selection',
      selector: '${schema.spec.profile}',
      cases: { starter: { kind: 'starter' } },
      default: { kind: 'starter' },
    } as const;
    expect(() =>
      resolveApplicationProviderRuntimeImplementation(selection, {}),
    ).toThrow(ApplicationProviderRuntimeSelectionError);
    expect(() =>
      resolveApplicationProviderRuntimeImplementation(selection, {
        APPLIK8S_PROFILE_VARIANT: 'not-a-profile',
      }),
    ).toThrow(/no implementation for profile variant/);
  });

  it('returns stable callable provider operations with portable dependency metadata', async () => {
    interface AcquisitionProviderImplementation {
      readonly kind: 'acquisition';
      readonly source: string;
      readonly credentialSecret: {
        readonly apiVersion: 'v1';
        readonly kind: 'Secret';
        readonly name: string;
      };
      acquire(input: { readonly id: string }): Promise<string>;
    }
    const AcquisitionProvider = defineApplicationProvider<AcquisitionProviderImplementation>({
      interface: 'AcquisitionProvider',
      version: 'v1alpha1',
      runtime: {
        bind(implementation) {
          return {
            env: { ACQUISITION_SOURCE: implementation.source },
            secretEnv: {
              ACQUISITION_TOKEN: {
                secret: implementation.credentialSecret,
                key: 'token',
              },
            },
            readiness: {
              dependencies: [implementation.credentialSecret],
              condition: 'the selected acquisition credential is projected',
              timeoutSeconds: 30,
            },
          };
        },
        operations: {
          acquire: {
            module: '@fixture/acquisition/runtime',
            export: 'acquireItem',
            access: {
              kind: 'provider',
              operations: ['connection.use', 'network.connect'],
            },
          },
        },
      },
      accepts: (candidate): candidate is AcquisitionProviderImplementation =>
        candidate !== null
        && typeof candidate === 'object'
        && Reflect.get(candidate, 'kind') === 'acquisition'
        && typeof Reflect.get(candidate, 'acquire') === 'function',
    }).named('primary');
    const Installation = type({ profile: "'starter' | 'dedicated'" });
    const application = app('callable-provider', {
      spec: Installation,
      status: type({ ready: 'boolean' }),
    });
    const implementation = (source: string): AcquisitionProviderImplementation => ({
      kind: 'acquisition',
      source,
      credentialSecret: {
        apiVersion: 'v1',
        kind: 'Secret',
        name: `acquisition-${source}`,
      },
      async acquire(input) {
        return `${this.source}:${input.id}`;
      },
    });
    application
      .profile(application.installation.spec, 'profile')
      .provide(AcquisitionProvider)
      .starter(() => implementation('starter'))
      .dedicated(() => implementation('dedicated'))
      .exhaustive();

    const provider = application.inject(AcquisitionProvider);
    const acquire = provider.acquire;
    expect(acquire).toBe(provider.acquire);
    expect(JSON.parse(JSON.stringify(provider))).toMatchObject({
      kind: 'applicationProvider',
      qualification: { name: 'primary' },
    });
    const previousVariant = process.env.APPLIK8S_PROFILE_VARIANT;
    process.env.APPLIK8S_PROFILE_VARIANT = 'dedicated';
    try {
      await expect(acquire({ id: 'item-1' })).resolves.toBe('dedicated:item-1');
      expect(provider.source).toBe('dedicated');
    } finally {
      if (previousVariant === undefined) {
        delete process.env.APPLIK8S_PROFILE_VARIANT;
      } else {
        process.env.APPLIK8S_PROFILE_VARIANT = previousVariant;
      }
    }
    expect(applicationCallableProviderDependencies({ acquire })).toEqual([
      expect.objectContaining({
        identifier: 'acquire',
        provider: expect.objectContaining({
          interface: 'AcquisitionProvider',
          qualification: expect.objectContaining({ name: 'primary' }),
        }),
        operation: {
          member: 'acquire',
          runtime: {
            module: '@fixture/acquisition/runtime',
            export: 'acquireItem',
            access: {
              kind: 'provider',
              operations: ['connection.use', 'network.connect'],
            },
          },
        },
      }),
    ]);
    const graph = applicationGraphFor(application.composition);
    const providerNode = graph?.nodes.find(
      (node) =>
        node.kind === 'provider'
        && node.interface === 'AcquisitionProvider',
    );
    if (providerNode?.kind !== 'provider') {
      throw new Error('Expected the callable AcquisitionProvider graph node.');
    }
    expect(providerNode?.config?.callableRuntime).toEqual({
      kind: 'profileSelection',
      selector: 'schema.spec.profile',
      cases: {
        starter: expect.objectContaining({
          kind: 'runtime',
          runtime: expect.objectContaining({
            env: { ACQUISITION_SOURCE: 'starter' },
            secretEnv: {
              ACQUISITION_TOKEN: {
                secret: {
                  apiVersion: 'v1',
                  kind: 'Secret',
                  name: 'acquisition-starter',
                },
                key: 'token',
              },
            },
            readiness: expect.objectContaining({
              condition: 'the selected acquisition credential is projected',
            }),
          }),
        }),
        dedicated: expect.objectContaining({
          kind: 'runtime',
          runtime: expect.objectContaining({
            env: { ACQUISITION_SOURCE: 'dedicated' },
          }),
        }),
      },
      default: expect.objectContaining({ kind: 'runtime' }),
    });
  });

  it('rejects callable runtime entries that are not public static package exports', () => {
    const accepts = (_candidate: unknown): _candidate is { run(): void } => true;
    expect(() =>
      defineApplicationProvider({
        interface: 'UnsafeProvider',
        version: 'v1alpha1',
        runtime: {
          operations: {
            run: {
              module: '../private-runtime.js',
              export: 'run',
              access: 'none',
            },
          },
        },
        accepts,
      }),
    ).toThrow(/public bare-package export/);
    expect(() =>
      defineApplicationProvider({
        interface: 'UnsafeProvider',
        version: 'v1alpha1',
        runtime: {
          operations: {
            run: {
              module: '@fixture/provider/runtime',
              export: 'default-value',
              access: 'none',
            },
          },
        },
        accepts,
      }),
    ).toThrow(/named JavaScript export/);
  });

  it('requires every callable runtime operation to declare bounded access semantics', () => {
    expect(() =>
      defineApplicationProvider({
        interface: 'UnboundedProvider',
        version: 'v1alpha1',
        runtime: {
          operations: {
            // typecast: adversarial fixture crosses the erased public boundary.
            run: {
              module: '@fixture/provider/runtime',
              export: 'run',
            } as never,
          },
        },
        accepts: (_candidate): _candidate is { run(): void } => true,
      }),
    ).toThrow(/runtime access must be 'none' or a non-empty provider operation list/);
    expect(() =>
      defineApplicationProvider({
        interface: 'UnboundedProvider',
        version: 'v1alpha1',
        runtime: {
          operations: {
            run: {
              module: '@fixture/provider/runtime',
              export: 'run',
              access: {
                kind: 'provider',
                operations: ['provider.escape'],
              },
            } as never,
          },
        },
        accepts: (_candidate): _candidate is { run(): void } => true,
      }),
    ).toThrow(/not part of the versioned runtime-access vocabulary/);
  });
});
