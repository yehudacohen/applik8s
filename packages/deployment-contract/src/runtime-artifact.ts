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

export interface ApplicationRuntimeArtifact {
  readonly nodeId: string;
  readonly name: string;
  readonly role: ApplicationRuntimeArtifactRole;
  readonly source: string;
  readonly digest: `sha256:${string}`;
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

export function validateApplicationRuntimeArtifact(artifact: ApplicationRuntimeArtifact): readonly string[] {
  const errors: string[] = [];
  if (!artifact.name.trim() || !artifact.nodeId.trim()) errors.push('name and nodeId must be non-empty');
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
  return errors;
}
