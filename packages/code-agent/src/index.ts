import { defineApplicationProvider } from '@applik8s/applik8s';
import type {
  ApplicationAgentHarnessProvider,
  ApplicationCodeWorkspaceProvider,
  ApplicationProcessRunnerProvider,
  ApplicationSourceRepositoryProvider,
} from './contracts.js';
import { codeAgentProviderRuntime } from './runtime-contract.js';

export * from './contracts.js';
export * from './code-agent.js';
export * from './local.js';

export const AgentHarness = defineApplicationProvider<ApplicationAgentHarnessProvider>({
  interface: 'AgentHarness',
  version: 'v1alpha1',
  description: 'Fenced, reattachable execution of one provider-neutral agent-harness run.',
  requirements: [
    'run identity, workspace lease, fencing token, deadline, and grants are validated before admission',
    'retries reattach to one logical run rather than creating a second provider session',
    'provider events and terminal receipts are normalized and Secret-safe',
  ],
  guarantees: [
    'harness replacement does not own actor or workspace identity',
    'transport loss never implies successful completion',
  ],
  runtime: {
    operations: {
      run: {
        module: '@applik8s/code-agent/runtime',
        export: 'runApplicationAgentHarness',
        access: { kind: 'provider', operations: ['ai.invoke', 'network.connect'] },
      },
      cancel: {
        module: '@applik8s/code-agent/runtime',
        export: 'cancelApplicationAgentHarness',
        access: { kind: 'provider', operations: ['ai.invoke'] },
      },
    },
    bind(implementation) {
      const runtime = codeAgentProviderRuntime(implementation, 'harness');
      if (!runtime) throw new Error(`AgentHarness provider ${implementation.kind} has no portable runtime binding.`);
      return runtime;
    },
  },
  accepts: isHarness,
});

export const CodeWorkspace = defineApplicationProvider<ApplicationCodeWorkspaceProvider>({
  interface: 'CodeWorkspace',
  version: 'v1alpha1',
  description: 'Fenced, serializable workspace leases with explicit retention and cleanup.',
  requirements: ['one active writer per workspace lease', 'lease identity survives harness replacement'],
  guarantees: ['release never deletes outside the leased workspace', 'stale fencing tokens fail closed'],
  runtime: {
    operations: {
      lease: {
        module: '@applik8s/code-agent/runtime',
        export: 'leaseApplicationCodeWorkspace',
        access: { kind: 'provider', operations: ['filesystem.read', 'filesystem.write'] },
      },
      release: {
        module: '@applik8s/code-agent/runtime',
        export: 'releaseApplicationCodeWorkspace',
        access: { kind: 'provider', operations: ['filesystem.delete'] },
      },
    },
    bind(implementation) {
      const runtime = codeAgentProviderRuntime(implementation, 'workspace');
      if (!runtime) throw new Error(`CodeWorkspace provider ${implementation.kind} has no portable runtime binding.`);
      return runtime;
    },
  },
  accepts: isWorkspace,
});

export const SourceRepository = defineApplicationProvider<ApplicationSourceRepositoryProvider>({
  interface: 'SourceRepository',
  version: 'v1alpha1',
  description: 'Revision-aware source inspection and compare-and-swap changes within a workspace lease.',
  requirements: ['all writes carry base digests', 'paths remain inside the leased workspace'],
  guarantees: ['repository access does not imply shell or network authority'],
  runtime: {
    operations: {
      inspect: {
        module: '@applik8s/code-agent/runtime',
        export: 'inspectApplicationSourceRepository',
        access: { kind: 'provider', operations: ['repository.read', 'filesystem.read'] },
      },
      apply: {
        module: '@applik8s/code-agent/runtime',
        export: 'applyApplicationSourceRepositoryChanges',
        access: { kind: 'provider', operations: ['repository.write', 'filesystem.write'] },
      },
    },
    bind(implementation) {
      const runtime = codeAgentProviderRuntime(implementation, 'repository');
      if (!runtime) throw new Error(`SourceRepository provider ${implementation.kind} has no portable runtime binding.`);
      return runtime;
    },
  },
  accepts: isRepository,
});

export const ProcessRunner = defineApplicationProvider<ApplicationProcessRunnerProvider>({
  interface: 'ProcessRunner',
  version: 'v1alpha1',
  description: 'Allowlisted process execution within one fenced workspace lease.',
  requirements: ['executable, arguments, working directory, environment, deadline, and output are bounded'],
  guarantees: ['process authority does not imply repository, Secret, or network authority'],
  runtime: {
    operations: {
      run: {
        module: '@applik8s/code-agent/runtime',
        export: 'runApplicationCodeProcess',
        access: { kind: 'provider', operations: ['process.execute'] },
      },
    },
    bind(implementation) {
      const runtime = codeAgentProviderRuntime(implementation, 'process');
      if (!runtime) throw new Error(`ProcessRunner provider ${implementation.kind} has no portable runtime binding.`);
      return runtime;
    },
  },
  accepts: isProcessRunner,
});

function isHarness(value: unknown): value is ApplicationAgentHarnessProvider {
  return provider(value) && typeof Reflect.get(value, 'run') === 'function' && typeof Reflect.get(value, 'cancel') === 'function';
}

function isWorkspace(value: unknown): value is ApplicationCodeWorkspaceProvider {
  return provider(value) && typeof Reflect.get(value, 'lease') === 'function' && typeof Reflect.get(value, 'release') === 'function';
}

function isRepository(value: unknown): value is ApplicationSourceRepositoryProvider {
  return provider(value) && typeof Reflect.get(value, 'inspect') === 'function' && typeof Reflect.get(value, 'apply') === 'function';
}

function isProcessRunner(value: unknown): value is ApplicationProcessRunnerProvider {
  return provider(value) && typeof Reflect.get(value, 'run') === 'function';
}

function provider(value: unknown): value is object {
  return Boolean(
    value && typeof value === 'object'
    && typeof Reflect.get(value, 'provider') === 'string'
    && typeof Reflect.get(value, 'kind') === 'string'
    && (Reflect.get(value, 'mode') === 'deterministic' || Reflect.get(value, 'mode') === 'live'),
  );
}
