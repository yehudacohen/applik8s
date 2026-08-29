// typecast-file-boundary: cloned negative fixtures deliberately mutate validated portable contracts.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  app,
  applicationGraphFor,
  defineApplicationProvider,
  defineApplicationProviderRuntime,
  TransactionalDatabase,
  WorkflowEngine,
} from '@applik8s/applik8s';
import type { ApplicationGraph, ApplicationWorkflowWorkerNode } from '@applik8s/core';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { workflowContract } from '../src/application-workflows/contracts.js';
import {
  privateProviderConstructorModuleFile,
  privateProviderValidatorModuleFile,
} from '../src/application-workflows/provider-private-runtime.js';
import { workflowResources } from '../src/application-workflows/resources.js';
import { generatedWorkerSource, writeWorkflowPrivateProviderModules } from '../src/application-workflows/source.js';

interface Transformer {
  readonly kind: 'remote';
  transform(input: string): Promise<string>;
}

function isTransformer(candidate: unknown): candidate is Transformer {
  return Boolean(candidate && typeof candidate === 'object'
    && Reflect.get(candidate, 'kind') === 'remote'
    && typeof Reflect.get(candidate, 'transform') === 'function');
}

describe('provider-private workflow construction', () => {
  it('hydrates only the selected provider in the worker and never serializes credentials', () => {
    const graph = privateProviderGraph();
    const contract = contractFor(graph);
    expect(contract.privateProviderEffects?.providers[0]).toMatchObject({
      selectedBy: 'schema.spec.profile',
      branches: expect.arrayContaining([expect.objectContaining({
        variant: 'dedicated',
        postgres: [expect.objectContaining({ alias: 'catalog' })],
      })]),
    });
    const source = generatedWorkerSource(contract);
    expect(source).toContain("requiredEnv('APPLIK8S_PROFILE_VARIANT')");
    expect(source).toContain('/var/run/secrets/applik8s/provider-private/');
    expect(source).toContain('createPrivateProviderPostgres(');
    expect(source).not.toContain('runtime-secret-value');
    const deployment = workflowResources(contract, 'transformer-worker', 'example.test/worker:1', 'sha256:1', false)
      .find((resource) => resource.kind === 'Deployment') as unknown as {
        spec: { template: { spec: { containers: Array<{ env: unknown[]; volumeMounts?: unknown[] }>; volumes: unknown[] } } };
      };
    expect(deployment.spec.template.spec.containers[0]?.env).toContainEqual({
      name: 'APPLIK8S_PROFILE_VARIANT',
      value: '${schema.spec.profile}',
    });
    expect(deployment.spec.template.spec.containers[0]?.volumeMounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ mountPath: expect.stringContaining('/provider-private/'), readOnly: true }),
    ]));
    expect(deployment.spec.template.spec.volumes).toEqual(expect.arrayContaining([
      expect.objectContaining({ secret: expect.objectContaining({ optional: true, defaultMode: 0o400 }) }),
    ]));
  });

  it('fails closed for cross-namespace and incomplete profile branches', () => {
    const crossNamespace = structuredClone(privateProviderGraph());
    const runtime = privateProfile(crossNamespace).branches.find((branch) => branch.variant === 'dedicated')?.privateRuntime;
    if (!runtime) throw new Error('Expected private runtime.');
    runtime.credentials[0]!.secret.namespace = 'other-system';
    expect(() => contractFor(crossNamespace)).toThrow('credential accessToken is in namespace other-system');

    const incomplete = structuredClone(privateProviderGraph());
    const external = privateProfile(incomplete).branches.find((branch) => branch.variant === 'external');
    if (!external) throw new Error('Expected external branch.');
    delete external.privateRuntime;
    expect(() => contractFor(incomplete)).toThrow('must declare runtime construction for every selected profile branch');
  });

  it('emits executable closed constructor and validator modules', async () => {
    const contract = contractFor(privateProviderGraph());
    const provider = contract.privateProviderEffects?.providers[0];
    if (!provider) throw new Error('Expected provider.');
    const directory = await mkdtemp(join(tmpdir(), 'applik8s-private-provider-'));
    try {
      await writeWorkflowPrivateProviderModules(directory, contract);
      const constructorPath = join(directory, privateProviderConstructorModuleFile(provider.provider.id, 'dedicated'));
      const validatorPath = join(directory, privateProviderValidatorModuleFile(provider.provider.id, 'dedicated'));
      // static-import-exception: the compiler emits this module into a per-test temporary directory and the cache-busting URL proves the generated artifact itself is executable.
      const constructorModule = await import(`${pathToFileURL(constructorPath).href}?test=${Date.now()}`) as { createConstructor(): (runtime: unknown) => Promise<unknown> };
      // static-import-exception: the paired generated validator is likewise available only at the runtime-created artifact path.
      const validatorModule = await import(`${pathToFileURL(validatorPath).href}?test=${Date.now()}`) as { createValidator(): (candidate: unknown) => boolean };
      const implementation = await constructorModule.createConstructor()({
        credentials: { accessToken: 'runtime-secret-value' },
        postgres: { catalog: { database: 'catalog', sql: { unsafe: async () => [] } } },
      });
      expect(validatorModule.createValidator()(implementation)).toBe(true);
      expect(await (implementation as Transformer).transform('document')).toBe('20:document');
      expect(await readFile(constructorPath, 'utf8')).not.toContain('runtime-secret-value');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function privateProviderGraph(): ApplicationGraph {
  const application = app('private-provider-runtime', {
    namespace: 'documents-system',
    spec: type({ profile: "'starter' | 'dedicated' | 'external'" }),
    status: type({ ready: 'boolean' }),
  });
  application.provide(WorkflowEngine, WorkflowEngine.hatchet({
    provision: false,
    namespace: 'documents-system',
    hostPort: 'hatchet:7070',
    apiUrl: 'http://hatchet:8080',
    workerTokenSecret: { apiVersion: 'v1', kind: 'Secret', name: 'hatchet-worker', namespace: 'documents-system' },
  }));
  const Provider = defineApplicationProvider<Transformer>({
    interface: 'TransformerFixture', version: 'v1', accepts: isTransformer,
  }).named('primary');
  const Catalog = TransactionalDatabase.named('catalog');
  const profile = application.profile(application.installation.spec, 'profile');
  profile.provide(Catalog)
    .starter(() => TransactionalDatabase.postgres({ name: 'starter-catalog', namespace: 'documents-system' }))
    .dedicated(() => TransactionalDatabase.postgres({ name: 'dedicated-catalog', namespace: 'documents-system' }))
    .external(() => TransactionalDatabase.postgres({ name: 'external-catalog', namespace: 'documents-system' }))
    .exhaustive();
  const catalog = application.inject(Catalog);
  const providerSelection = profile.provide(Provider);
  const make = (variant: string) => defineApplicationProviderRuntime(Provider, {
    implementation: 'remote',
    validate: isTransformer,
    credentials: { accessToken: { secret: { apiVersion: 'v1', kind: 'Secret', name: `transformer-${variant}`, namespace: 'documents-system' }, key: 'token' } },
    postgres: { catalog },
    construct: async (runtime) => ({
      kind: 'remote' as const,
      transform: async (input: string) => {
        await runtime.postgres.catalog.sql.unsafe('select 1');
        return `${runtime.credentials.accessToken.length}:${input}`;
      },
    }),
  });
  providerSelection.starter(() => make('starter')).dedicated(() => make('dedicated')).external(() => make('external')).exhaustive();
  application.workflow('documents.transform.v1', {
    input: type({ value: 'string' }), output: type({ value: 'string' }),
  }, { retries: 1, worker: { group: 'transformer', replicas: 1, taskSlots: 2 } }, async (input) => ({ value: input.value }));
  const graph = applicationGraphFor(application.composition);
  if (!graph) throw new Error('Expected graph.');
  const mutable = structuredClone(graph);
  const provider = mutable.nodes.find((node) => node.kind === 'provider' && node.interface === 'TransformerFixture');
  const handler = mutable.nodes.find((node) => node.kind === 'taskHandler');
  if (provider?.kind !== 'provider' || handler?.kind !== 'taskHandler') throw new Error('Expected provider and handler.');
  (handler as unknown as { providerBindings: unknown }).providerBindings = [{
    identifier: 'transformer',
    provider: { interface: provider.interface, nodeId: provider.id },
    projection: 'binding',
    privateRuntime: true,
  }];
  (handler as unknown as { handlerSource: string }).handlerSource = 'async (input) => ({ value: await transformer.implementation.transform(input.value) })';
  return mutable;
}

function contractFor(graph: ApplicationGraph) {
  const worker = graph.nodes.find((node): node is ApplicationWorkflowWorkerNode => node.kind === 'workflowWorker');
  if (!worker) throw new Error('Expected worker.');
  return workflowContract(graph, worker);
}

function privateProfile(graph: ApplicationGraph): {
  branches: Array<{ variant: string; privateRuntime?: { credentials: Array<{ secret: { namespace?: string } }> } }>;
} {
  const provider = graph.nodes.find((node) => node.kind === 'provider' && node.interface === 'TransformerFixture');
  if (provider?.kind !== 'provider') throw new Error('Expected provider.');
  return provider.config?.profile as never;
}
