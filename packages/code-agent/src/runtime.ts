import type {
  ApplicationAgentHarnessProvider,
  ApplicationAgentHarnessCancellationRequest,
  ApplicationAgentHarnessRequest,
  ApplicationCodeWorkspaceLeaseRequest,
  ApplicationCodeWorkspaceProvider,
  ApplicationCodeWorkspaceReleaseRequest,
  ApplicationProcessRunnerProvider,
  ApplicationSourceRepositoryChange,
  ApplicationSourceRepositoryProvider,
} from './contracts.js';
import {
  createLocalCodeWorkspaceProvider,
  createLocalProcessRunnerProvider,
  createLocalSourceRepositoryProvider,
  createDeterministicAgentHarnessProvider,
} from './local.js';
import { createHttpCodeAgentProviders } from './http.js';

export interface ApplicationCodeAgentRuntimeProviders {
  readonly harness: ApplicationAgentHarnessProvider;
  readonly workspace: ApplicationCodeWorkspaceProvider;
  readonly repository: ApplicationSourceRepositoryProvider;
  readonly process: ApplicationProcessRunnerProvider;
}

let installed: (() => ApplicationCodeAgentRuntimeProviders) | undefined;
let environmentProviders: ApplicationCodeAgentRuntimeProviders | undefined;

export function installApplicationCodeAgentRuntimeResolver(
  resolver: () => ApplicationCodeAgentRuntimeProviders,
): () => void {
  const previous = installed;
  installed = resolver;
  return () => { installed = previous; };
}

export function runApplicationAgentHarness(input: ApplicationAgentHarnessRequest) {
  return providers().harness.run(input);
}

export function cancelApplicationAgentHarness(input: ApplicationAgentHarnessCancellationRequest) {
  return providers().harness.cancel(input);
}

export function leaseApplicationCodeWorkspace(input: ApplicationCodeWorkspaceLeaseRequest) {
  return providers().workspace.lease(input);
}

export function releaseApplicationCodeWorkspace(input: ApplicationCodeWorkspaceReleaseRequest) {
  return providers().workspace.release(input);
}

export function inspectApplicationSourceRepository(input: Parameters<ApplicationSourceRepositoryProvider['inspect']>[0]) {
  return providers().repository.inspect(input);
}

export function applyApplicationSourceRepositoryChanges(input: {
  readonly lease: Parameters<ApplicationSourceRepositoryProvider['apply']>[0]['lease'];
  readonly changes: readonly ApplicationSourceRepositoryChange[];
}) {
  return providers().repository.apply(input);
}

export function runApplicationCodeProcess(input: Parameters<ApplicationProcessRunnerProvider['run']>[0]) {
  return providers().process.run(input);
}

function providers(): ApplicationCodeAgentRuntimeProviders {
  if (installed) return installed();
  if (environmentProviders) return environmentProviders;
  const harnessKind = process.env.APPLIK8S_AGENT_HARNESS_KIND ?? 'deterministic';
  if (harnessKind === 'http') {
    environmentProviders = createHttpCodeAgentProviders({
      endpoint: requiredEnvironment('APPLIK8S_CODE_AGENT_PROVIDER_ENDPOINT'),
      authorization: requiredEnvironment('APPLIK8S_CODE_AGENT_PROVIDER_AUTHORIZATION'),
    });
    return environmentProviders;
  }
  if (harnessKind !== 'deterministic') {
    throw new Error(
      `Code-agent harness ${JSON.stringify(harnessKind)} requires an installed runtime resolver; `
      + 'it cannot execute inside the general application worker implicitly.',
    );
  }
  const root = requiredEnvironment('APPLIK8S_CODE_WORKSPACE_ROOT');
  const allow = (process.env.APPLIK8S_CODE_PROCESS_ALLOW ?? 'bun,git')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  environmentProviders = {
    harness: createDeterministicAgentHarnessProvider(),
    workspace: createLocalCodeWorkspaceProvider({ root }),
    repository: createLocalSourceRepositoryProvider({ root }),
    process: createLocalProcessRunnerProvider({ root, allow }),
  };
  return environmentProviders;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`Code-agent runtime requires ${name}.`);
  return value;
}
