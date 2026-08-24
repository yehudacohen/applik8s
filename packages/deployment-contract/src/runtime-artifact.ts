import { sha256Hex } from './serialization.js';

export type ApplicationRuntimeArtifactRole =
  | 'processor'
  | 'lakehouse'
  | 'workflow'
  | 'reactive'
  | 'agent'
  | 'http'
  | 'mcp'
  | 'operator';

/**
 * Framework-owned credential authorities available to generated runtimes.
 *
 * This is intentionally a closed semantic vocabulary rather than a bag of
 * environment-variable names. Target adapters decide how each credential is
 * materialized while the compiler records the exact variable name consumed by
 * the generated artifact.
 */
export type ApplicationFrameworkCredentialKind =
  | 'agent-query-context'
  | 'context'
  | 'cursor'
  | 'http-context'
  | 'internal-operation'
  | 'local-resource'
  | 'task-operation-context'
  | 'task-query-context';

export interface ApplicationFrameworkCredentialDependency {
  readonly kind: ApplicationFrameworkCredentialKind;
  readonly environmentName: string;
}

export interface ApplicationRuntimeArtifact {
  readonly nodeId: string;
  readonly name: string;
  readonly role: ApplicationRuntimeArtifactRole;
  readonly source: string;
  readonly digest: `sha256:${string}`;
  /**
   * Executable semantic nodes deliberately co-located in this artifact.
   * Target compilers persist the resulting union on the physical workload;
   * an omitted list is resolved from the canonical graph for legacy bundles.
   */
  readonly executionNodeIds?: readonly string[];
  readonly manifest?: string;
  readonly container?: ApplicationRuntimeContainerArtifact;
  /**
   * Exact generated runtime services this artifact is allowed to call.
   *
   * The compiler records semantic receiver identities here; target compilers
   * hydrate their stable endpoint environment variables without exposing the
   * rest of the application's service-discovery namespace.
   */
  readonly runtimeEndpoints?: readonly ApplicationRuntimeEndpointDependency[];
  /** Exact framework credentials consumed by this generated executable. */
  readonly frameworkCredentials?: readonly ApplicationFrameworkCredentialDependency[];
}

export interface ApplicationRuntimeEndpointDependency {
  readonly nodeId: string;
  readonly environmentName: string;
}

export interface ApplicationRuntimeContainerArtifact {
  readonly image: string;
  readonly imageName: string;
  readonly tag: string;
  readonly baseImage: string;
  readonly contextPath: string;
  readonly dockerfilePath: string;
  readonly entrypoint: string;
  readonly command: readonly string[];
  readonly sourceDigest: `sha256:${string}`;
}

export function applicationRuntimeArtifactId(artifact: Pick<ApplicationRuntimeArtifact, 'role' | 'nodeId'>): string {
  return `${artifact.role}:${artifact.nodeId}`;
}

export function applicationRuntimeEndpointEnvironmentName(nodeId: string): string {
  if (!nodeId.trim()) throw new Error('Runtime endpoint nodeId must be non-empty.');
  return `APPLIK8S_RUNTIME_ENDPOINT_${sha256Hex(nodeId).slice(0, 20).toUpperCase()}`;
}

export function applicationFrameworkCredentialEnvironmentIsValid(
  dependency: ApplicationFrameworkCredentialDependency,
): boolean {
  const canonical = APPLICATION_FRAMEWORK_CREDENTIAL_ENVIRONMENTS[dependency.kind];
  if (dependency.kind !== 'cursor') return dependency.environmentName === canonical;
  if (!/^(?:APPLIK8S_[A-Z0-9_]*CURSOR[A-Z0-9_]*|[A-Z][A-Z0-9_]*_CURSOR_SECRET)$/u.test(dependency.environmentName)) return false;
  return !Object.entries(APPLICATION_FRAMEWORK_CREDENTIAL_ENVIRONMENTS)
    .some(([kind, environmentName]) => kind !== 'cursor' && environmentName === dependency.environmentName);
}

export function validateApplicationRuntimeArtifact(artifact: ApplicationRuntimeArtifact): readonly string[] {
  const errors: string[] = [];
  if (!artifact.name.trim() || !artifact.nodeId.trim()) errors.push('name and nodeId must be non-empty');
  if (artifact.executionNodeIds && (
    artifact.executionNodeIds.some((nodeId) => !nodeId.trim())
    || new Set(artifact.executionNodeIds).size !== artifact.executionNodeIds.length
  )) errors.push('executionNodeIds must contain unique non-empty semantic node identities');
  if (!/^sha256:[a-f0-9]{64}$/u.test(artifact.digest)) errors.push('digest must be a lowercase sha256 identity');
  if (artifact.container) {
    if (!/^sha256:[a-f0-9]{64}$/u.test(artifact.container.sourceDigest)) errors.push('container.sourceDigest must be a lowercase sha256 identity');
    if (!artifact.container.contextPath || !artifact.container.dockerfilePath || artifact.container.command.length === 0) errors.push('container build and command metadata must be complete');
  }
  const endpointNames = new Set<string>();
  for (const endpoint of artifact.runtimeEndpoints ?? []) {
    if (!endpoint.nodeId.trim()) errors.push('runtime endpoint nodeId must be non-empty');
    if (endpoint.environmentName !== applicationRuntimeEndpointEnvironmentName(endpoint.nodeId)) {
      errors.push(`runtime endpoint ${endpoint.nodeId} has a noncanonical environment name`);
    }
    if (endpointNames.has(endpoint.environmentName)) errors.push(`runtime endpoint environment ${endpoint.environmentName} is repeated`);
    endpointNames.add(endpoint.environmentName);
  }
  const credentialNames = new Set<string>();
  for (const credential of artifact.frameworkCredentials ?? []) {
    if (!APPLICATION_FRAMEWORK_CREDENTIAL_KINDS.has(credential.kind)) {
      errors.push(`framework credential kind ${String(credential.kind)} is unsupported`);
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(credential.environmentName)) {
      errors.push(`framework credential ${credential.kind} has an invalid environment name`);
    } else if (APPLICATION_FRAMEWORK_CREDENTIAL_KINDS.has(credential.kind)
      && !applicationFrameworkCredentialEnvironmentIsValid(credential)) {
      errors.push(`framework credential ${credential.kind} has a noncanonical environment name`);
    }
    if (credentialNames.has(credential.environmentName)) {
      errors.push(`framework credential environment ${credential.environmentName} is repeated`);
    }
    credentialNames.add(credential.environmentName);
  }
  return errors;
}

const APPLICATION_FRAMEWORK_CREDENTIAL_KINDS: ReadonlySet<string> = new Set([
  'agent-query-context',
  'context',
  'cursor',
  'http-context',
  'internal-operation',
  'local-resource',
  'task-operation-context',
  'task-query-context',
]);

const APPLICATION_FRAMEWORK_CREDENTIAL_ENVIRONMENTS: Readonly<Record<ApplicationFrameworkCredentialKind, string>> = {
  'agent-query-context': 'APPLIK8S_AGENT_QUERY_CONTEXT_SECRET',
  context: 'APPLIK8S_CONTEXT_SECRET',
  cursor: 'APPLIK8S_CURSOR_SECRET',
  'http-context': 'APPLIK8S_HTTP_CONTEXT_SECRET',
  'internal-operation': 'APPLIK8S_INTERNAL_OPERATION_SECRET',
  'local-resource': 'APPLIK8S_LOCAL_RESOURCE_TOKEN',
  'task-operation-context': 'APPLIK8S_TASK_OPERATION_CONTEXT_SECRET',
  'task-query-context': 'APPLIK8S_TASK_QUERY_CONTEXT_SECRET',
};
