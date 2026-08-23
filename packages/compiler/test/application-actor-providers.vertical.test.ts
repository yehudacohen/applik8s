import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deriveApplicationGraphFoundation } from '@applik8s/core';
import { afterEach, describe, expect, it } from 'vitest';
import { applicationProviderConsumerWorkloads } from '../src/application-deployment-graph.js';
import { generatedApplicationFetchGatewayModules } from '../src/application-fetch-gateway/index.js';
import { discoverApplicationGraphWithExports } from '../src/pipeline/index.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })),
  );
});

describe('actor callable providers', () => {
  it('preserves a clean external module operation through a local helper and generated host', async () => {
    const directory = await mkdtemp(
      join(process.cwd(), '.tmp-applik8s-actor-provider-'),
    );
    directories.push(directory);
    const providerPackage = join(
      directory,
      'node_modules',
      '@fixture',
      'acquisition',
    );
    await mkdir(providerPackage, { recursive: true });
    await writeFile(
      join(providerPackage, 'package.json'),
      JSON.stringify({
        name: '@fixture/acquisition',
        version: '1.0.0',
        type: 'module',
        exports: {
          '.': './index.js',
          './runtime': './runtime.js',
        },
      }),
    );
    await writeFile(join(providerPackage, 'runtime.js'), `
export async function acquireItem(input) {
  return { value: 'runtime:' + input.id };
}
`);
    await writeFile(join(providerPackage, 'index.js'), `
import { defineApplicationProvider, module } from '@applik8s/applik8s';
export const AcquisitionProvider = defineApplicationProvider({
  interface: 'AcquisitionProvider',
  version: 'v1alpha1',
  runtime: {
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
  accepts: candidate => candidate?.kind === 'acquisition'
    && typeof candidate.acquire === 'function',
}).named('primary');
export const acquisition = module('acquisition', application => {
  const provider = application.inject(AcquisitionProvider);
  return { acquire: provider.acquire };
});
`);
    const entrypoint = join(directory, 'application.ts');
    await writeFile(entrypoint, `
import { actor, app, ApplicationHost } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { AcquisitionProvider, acquisition } from '@fixture/acquisition';

const application = app('actor-provider', {
  namespace: 'actor-provider',
  spec: type({ profile: "'starter' | 'dedicated'" }),
  status: type({ ready: 'boolean' }),
});
application.provide(
  ApplicationHost,
  ApplicationHost.managed({ replicas: 1, port: 3_000 }),
);
const implementation = source => ({
  kind: 'acquisition',
  async acquire(input) { return { value: source + ':' + input.id }; },
});
application.profile(application.installation.spec, 'profile')
  .provide(AcquisitionProvider)
  .starter(() => implementation('starter'))
  .dedicated(() => implementation('dedicated'))
  .exhaustive();
const { acquire } = application.include(acquisition);
const directProvider = application.inject(AcquisitionProvider);
async function acquireThroughHelper(id) {
  return acquire({ id });
}
const Workspace = application.actor('workspace.v1', {
  key: type('string'),
  state: type({ value: 'string' }),
  protocol: {
    refresh: actor.command({
      input: type({ id: 'string' }),
      output: type({ value: 'string' }),
    }),
    directRefresh: actor.command({
      input: type({ id: 'string' }),
      output: type({ value: 'string' }),
    }),
  },
});
Workspace.on.initialize(() => ({ value: '' }));
Workspace.on.refresh(async (turn, input) => {
  const acquired = await acquireThroughHelper(input.id);
  await turn.setState({ value: acquired.value });
  return { value: acquired.value };
});
Workspace.on.directRefresh(async (turn, input) => {
  const acquired = await directProvider.acquire({ id: input.id });
  await turn.setState({ value: acquired.value });
  return { value: acquired.value };
});
export const actorProviderStack = application.composition;
`);

    const discovered = await discoverApplicationGraphWithExports(
      entrypoint,
      'actorProviderStack',
    );
    expect(
      discovered.ok,
      discovered.ok ? undefined : discovered.error.message,
    ).toBe(true);
    if (!discovered.ok) return;
    const actorNode = discovered.value.graph.nodes.find(
      (node) => node.kind === 'actor',
    );
    expect(actorNode).toMatchObject({
      kind: 'actor',
      providerBindings: expect.arrayContaining([expect.objectContaining({
        identifier: expect.stringContaining('acquire'),
        provider: {
          interface: 'AcquisitionProvider',
          nodeId: 'provider.acquisition-provider.v1alpha1.primary',
          qualification: expect.objectContaining({ name: 'primary' }),
        },
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
      })]),
    });
    expect(discovered.value.graph.edges).toContainEqual({
      from: { nodeId: 'provider.acquisition-provider.v1alpha1.primary' },
      to: { nodeId: 'actor.workspace.v1' },
      relationship: 'provides',
    });
    expect(actorNode?.providerBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          identifier: 'directRefresh:directProvider.acquire',
          operation: expect.objectContaining({ member: 'acquire' }),
        }),
        expect.objectContaining({
          identifier: 'refresh:acquire',
          operation: expect.objectContaining({ member: 'acquire' }),
        }),
      ]),
    );
    const foundation = deriveApplicationGraphFoundation(
      discovered.value.graph,
      { workspaceRoot: directory },
    );
    expect(foundation.runtimeAccess).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          consumer: expect.objectContaining({ nodeId: 'actor.workspace.v1' }),
          target: {
            capabilityId: 'provider.acquisition-provider.v1alpha1.primary',
            operation: 'connection.use',
            scope: {
              kind: 'resource',
              resourceId: 'provider.acquisition-provider.v1alpha1.primary',
            },
          },
        }),
        expect.objectContaining({
          consumer: expect.objectContaining({ nodeId: 'actor.workspace.v1' }),
          target: {
            capabilityId: 'provider.acquisition-provider.v1alpha1.primary',
            operation: 'network.connect',
            scope: {
              kind: 'resource',
              resourceId: 'provider.acquisition-provider.v1alpha1.primary',
            },
          },
        }),
      ]),
    );

    const modules = generatedApplicationFetchGatewayModules(
      discovered.value.graph,
    );
    expect(modules).toBeDefined();
    const gatewaySource = modules?.files['gateway.generated.ts'] ?? '';
    const generatedFiles = Object.values(modules?.files ?? {}).join('\n');
    expect(generatedFiles).toContain('@fixture/acquisition/runtime');
    expect(generatedFiles).toContain('acquireItem');
    expect(generatedFiles).toContain('acquireThroughHelper');
    expect(generatedFiles).not.toContain(
      '@applik8s/applik8s/internal/provider-runtime',
    );
    expect(generatedFiles).not.toContain('application.inject');
    expect(generatedFiles).not.toContain('application.profile');
    expect(generatedFiles).not.toContain('application.provide');
    expect(gatewaySource).toMatch(
      /createCallback_actor_refresh_[a-f0-9]+\(\{ "acquire": providerOperation_[a-f0-9]+ \}\)/,
    );
    expect(gatewaySource).toMatch(
      /createCallback_actor_directRefresh_[a-f0-9]+\(\{ "directProvider": \{ "acquire": providerOperation_[a-f0-9]+ \} \}\)/,
    );

    const callbackModule = Object.entries(modules?.files ?? {}).find(
      ([name]) => name.startsWith('actor-refresh-'),
    )?.[1];
    expect(callbackModule).toBeDefined();
    if (!callbackModule) return;
    // typecast: dynamically evaluates the generated callback factory contract.
    const createCallback = Function(
      `${callbackModule.replace('export function createCallback', 'function createCallback')}\nreturn createCallback;`,
    )() as (bindings: Readonly<Record<string, unknown>>) => (
      turn: { readonly setState: (state: unknown) => Promise<void> },
      input: { readonly id: string },
    ) => Promise<unknown>;
    const states: unknown[] = [];
    const callback = createCallback({
      acquire: async ({ id }: { readonly id: string }) => ({
        value: `runtime:${id}`,
      }),
    });
    await expect(callback({
      async setState(state: unknown) {
        states.push(state);
      },
    }, { id: 'item-1' })).resolves.toEqual({ value: 'runtime:item-1' });
    expect(states).toEqual([{ value: 'runtime:item-1' }]);

    const directCallbackModule = Object.entries(modules?.files ?? {}).find(
      ([name]) => name.startsWith('actor-directRefresh-'),
    )?.[1];
    expect(directCallbackModule).toBeDefined();
    if (!directCallbackModule) return;
    expect(directCallbackModule).not.toContain('import ');
    // typecast: dynamically evaluates the generated nested provider binding.
    const createDirectCallback = Function(
      `${directCallbackModule.replace('export function createCallback', 'function createCallback')}\nreturn createCallback;`,
    )() as (bindings: Readonly<Record<string, unknown>>) => (
      turn: { readonly setState: (state: unknown) => Promise<void> },
      input: { readonly id: string },
    ) => Promise<unknown>;
    const directStates: unknown[] = [];
    const directCallback = createDirectCallback({
      directProvider: {
        acquire: async ({ id }: { readonly id: string }) => ({
          value: `direct-runtime:${id}`,
        }),
      },
    });
    await expect(directCallback({
      async setState(state: unknown) {
        directStates.push(state);
      },
    }, { id: 'item-2' })).resolves.toEqual({
      value: 'direct-runtime:item-2',
    });
    expect(directStates).toEqual([{ value: 'direct-runtime:item-2' }]);

    expect([
      ...applicationProviderConsumerWorkloads(
        discovered.value.graph,
        new Set(['provider.acquisition-provider.v1alpha1.primary']),
      ),
    ]).toEqual(['actor-provider-web']);

    const missingRuntimeGraph = {
      ...discovered.value.graph,
      nodes: discovered.value.graph.nodes.map((node) =>
        node.kind === 'actor'
          ? {
              ...node,
              providerBindings: (node.providerBindings ?? []).map((binding) => ({
                ...binding,
                ...(binding.operation
                  ? { operation: { member: binding.operation.member } }
                  : {}),
              })),
            }
          : node),
    };
    expect(() => generatedApplicationFetchGatewayModules(missingRuntimeGraph))
      .toThrow(/no public static runtime operation/);

    const privateRuntimeGraph = {
      ...discovered.value.graph,
      nodes: discovered.value.graph.nodes.map((node) =>
        node.kind === 'actor'
          ? {
              ...node,
              providerBindings: (node.providerBindings ?? []).map((binding) => ({
                ...binding,
                ...(binding.operation
                  ? {
                      operation: {
                        ...binding.operation,
                        runtime: {
                          module: '../private-runtime.js',
                          export: 'acquireItem',
                          // typecast: retain the literal access discriminant in the adversarial graph fixture.
                          access: 'none' as const,
                        },
                      },
                    }
                  : {}),
              })),
            }
          : node),
    };
    expect(() => generatedApplicationFetchGatewayModules(privateRuntimeGraph))
      .toThrow(/invalid public runtime export/);
  }, 120_000);
});
