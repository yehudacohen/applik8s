// typecast-file-boundary: the composition test installs focused provider runtimes after validating the public graph contracts.
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  app,
  applicationGraphFor,
} from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { AI } from '@applik8s/ai';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AgentHarness,
  CodeWorkspace,
  ProcessRunner,
  SourceRepository,
  codeAgent,
  createDeterministicAgentHarnessProvider,
  createLocalCodeWorkspaceProvider,
  createLocalProcessRunnerProvider,
  createLocalSourceRepositoryProvider,
} from '../src/index.js';
import { installApplicationCodeAgentRuntimeResolver } from '../src/runtime.js';

describe('provider-neutral codeAgent composition', () => {
  let root = '';
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('expands explicit capabilities and completes one fenced local workspace run', async () => {
    root = await mkdtemp(join(tmpdir(), 'applik8s-code-agent-'));
    const repositoryRoot = join(root, 'repository-one');
    await mkdir(repositoryRoot);
    const prior = 'export const value = "before";\n';
    const next = 'export const value = "after";\n';
    await writeFile(join(repositoryRoot, 'app.ts'), prior);
    const harnessImplementation = createDeterministicAgentHarnessProvider({
      changes: [{
        path: 'app.ts',
        baseDigest: `sha256:${createHash('sha256').update(prior).digest('hex')}`,
        nextText: next,
      }],
      summary: 'Updated the bounded fixture.',
    });
    const workspaceImplementation = createLocalCodeWorkspaceProvider({ root });
    const sourceImplementation = createLocalSourceRepositoryProvider({ root });
    const processImplementation = createLocalProcessRunnerProvider({
      root,
      allow: [process.execPath],
    });
    const application = app('code-agent-proof', {
      spec: type({ profile: "'starter' | 'external'" }),
      status: type({ ready: 'boolean' }),
    });
    const Harness = AgentHarness.named('coding');
    const Workspace = CodeWorkspace.named('primary');
    const Source = SourceRepository.named('primary');
    const Processes = ProcessRunner.named('bounded');
    application.profile(application.installation.spec, 'profile')
      .provide(Harness).starter(() => harnessImplementation).external(() => harnessImplementation).exhaustive();
    application.profile(application.installation.spec, 'profile')
      .provide(Workspace).starter(() => workspaceImplementation).external(() => workspaceImplementation).exhaustive();
    application.profile(application.installation.spec, 'profile')
      .provide(Source).starter(() => sourceImplementation).external(() => sourceImplementation).exhaustive();
    application.profile(application.installation.spec, 'profile')
      .provide(Processes).starter(() => processImplementation).external(() => processImplementation).exhaustive();
    const identity = application.serviceIdentity('product-builder');
    const CodingModel = AI.model('coding', { capabilities: [AI.tools, AI.textInput, AI.textOutput] });
    const ProductBuilder = application.include(codeAgent('product-builder.v1', {
      identity,
      model: CodingModel,
      harness: Harness,
      workspace: Workspace,
      source: Source,
      process: Processes,
      validation: [{ executable: process.execPath, arguments: ['-e', 'process.exit(0)'] }],
    }));

    expect(ProductBuilder.kind).toBe('applicationAgent');
    expect(ProductBuilder.specialization).toBe('code');
    expect(ProductBuilder.name).toBe('product-builder.v1');
    expect(ProductBuilder.capabilities).toEqual({
      harness: Harness.qualification.key,
      workspace: Workspace.qualification.key,
      source: Source.qualification.key,
      process: Processes.qualification.key,
    });
    const graph = applicationGraphFor(application.composition);
    expect(graph?.nodes.filter((node) => node.kind === 'provider').map((node) => node.interface)).toEqual(
      expect.arrayContaining(['AgentHarness', 'CodeWorkspace', 'SourceRepository', 'ProcessRunner']),
    );
    expect(graph?.nodes).toContainEqual(expect.objectContaining({
      kind: 'codeAgent',
      name: 'product-builder.v1',
      semantics: expect.objectContaining({
        placement: 'providerManaged',
        hostLifetime: 'providerManaged',
      }),
    }));
    expect(graph?.nodes.some((node) => node.kind === 'actor')).toBe(false);

    const uninstallProviders = installApplicationCodeAgentRuntimeResolver(() => ({
      harness: harnessImplementation,
      workspace: workspaceImplementation,
      repository: sourceImplementation,
      process: processImplementation,
    }));
    const previousProfile = process.env.APPLIK8S_PROFILE_VARIANT;
    process.env.APPLIK8S_PROFILE_VARIANT = 'starter';
    try {
      const result = await ProductBuilder({
        repositoryId: 'repository-one',
        instruction: 'Update the fixture and validate it.',
        idempotencyKey: 'request-one',
      });
      expect(result).toMatchObject({
        status: 'completed',
        summary: 'Updated the bounded fixture.',
        validation: [{ exitCode: 0 }],
      });
      expect(await readFile(join(repositoryRoot, 'app.ts'), 'utf8')).toBe(next);
      await expect(ProductBuilder({
        repositoryId: 'repository-one',
        instruction: 'Update the fixture and validate it.',
        idempotencyKey: 'request-one',
      })).resolves.toEqual(result);
    } finally {
      if (previousProfile === undefined) delete process.env.APPLIK8S_PROFILE_VARIANT;
      else process.env.APPLIK8S_PROFILE_VARIANT = previousProfile;
      uninstallProviders();
    }
  });

  it('fails closed on traversal, stale changes, and unauthorized process execution', async () => {
    root = await mkdtemp(join(tmpdir(), 'applik8s-code-agent-safety-'));
    const workspace = createLocalCodeWorkspaceProvider({ root });
    const source = createLocalSourceRepositoryProvider({ root });
    const runner = createLocalProcessRunnerProvider({ root, allow: ['bun'] });
    const lease = await workspace.lease({
      workspace: 'safe', runId: 'run-one', fencingToken: 'fence-one',
    });
    await expect(source.inspect({ lease, paths: ['../outside'] })).rejects.toThrow(/workspace-relative/u);
    await expect(source.apply({
      lease,
      changes: [{ path: 'app.ts', baseDigest: `sha256:${'0'.repeat(64)}`, nextText: 'unsafe' }],
    })).rejects.toThrow(/base digest/u);
    await expect(runner.run({ lease, executable: 'sh' })).rejects.toThrow(/not authorized/u);
    await expect(workspace.lease({
      workspace: 'safe', runId: 'run-two', fencingToken: 'fence-two',
    })).rejects.toThrow(/active fenced writer/u);
  });

  it('reattaches durable workspace leases and fences competing writers after provider restart', async () => {
    root = await mkdtemp(join(tmpdir(), 'applik8s-code-agent-restart-'));
    const first = createLocalCodeWorkspaceProvider({ root });
    const request = { workspace: 'durable', runId: 'run-one', fencingToken: 'fence-one' };
    const lease = await first.lease(request);

    const restarted = createLocalCodeWorkspaceProvider({ root });
    await expect(restarted.lease(request)).resolves.toEqual(lease);
    await expect(restarted.lease({
      workspace: 'durable', runId: 'run-two', fencingToken: 'fence-two',
    })).rejects.toThrow(/active fenced writer/u);
    await expect(restarted.release({ lease, disposition: 'retain' })).resolves.toEqual({ released: true });
    await expect(createLocalCodeWorkspaceProvider({ root }).lease({
      workspace: 'durable', runId: 'run-two', fencingToken: 'fence-two',
    })).resolves.toMatchObject({ workspace: 'durable', runId: 'run-two', generation: 1 });
  });

  it('replays repository mutations and validation receipts after an unknown actor outcome', async () => {
    root = await mkdtemp(join(tmpdir(), 'applik8s-code-agent-replay-'));
    const workspace = createLocalCodeWorkspaceProvider({ root });
    const source = createLocalSourceRepositoryProvider({ root });
    const runner = createLocalProcessRunnerProvider({ root, allow: [process.execPath] });
    const lease = await workspace.lease({ workspace: 'replay', runId: 'run-replay', fencingToken: 'fence-replay' });
    const nextText = 'export const replayed = true;\n';
    const change = {
      path: 'app.ts',
      baseDigest: `sha256:${createHash('sha256').update('').digest('hex')}` as const,
      nextText,
    };
    const firstSource = await source.apply({ lease, changes: [change] });
    await expect(source.apply({ lease, changes: [change] })).resolves.toEqual(firstSource);
    const command = {
      lease,
      idempotencyKey: 'validation-one',
      executable: process.execPath,
      arguments: ['-e', 'process.stdout.write("validated")'],
    };
    const firstProcess = await runner.run(command);
    await expect(runner.run(command)).resolves.toEqual(firstProcess);
    const restartedRunner = createLocalProcessRunnerProvider({ root, allow: [process.execPath] });
    await expect(restartedRunner.run(command)).resolves.toEqual(firstProcess);
    await expect(runner.run({ ...command, arguments: ['-e', 'process.stdout.write("different")'] }))
      .rejects.toThrow(/reused with different input/u);
  });
});
