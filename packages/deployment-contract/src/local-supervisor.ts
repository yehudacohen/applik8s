import { sha256Hex } from './serialization.js';

export type LocalSupervisorTarget = 'local' | 'aws-local';

export interface LocalSupervisorPlan {
  readonly apiVersion: 'applik8s.localSupervisor/v1alpha1';
  readonly application: string;
  readonly target: LocalSupervisorTarget;
  readonly profile: string;
  readonly projectDigest: string;
  readonly resources: readonly LocalSupervisorResource[];
  readonly bindings: readonly LocalSupervisorBinding[];
  readonly diagnostics: readonly LocalSupervisorDiagnostic[];
}

export type LocalSupervisorResource =
  | LocalSupervisorProcess
  | LocalSupervisorContainer
  | LocalSupervisorExternalResource;

interface LocalSupervisorResourceBase {
  readonly id: string;
  readonly dependsOn: readonly string[];
  readonly lifecycle: { readonly ownership: 'application' | 'external'; readonly retention: 'ephemeral' | 'retained' | 'external' };
  readonly health: { readonly kind: 'http' | 'tcp' | 'process' | 'external'; readonly path?: string; readonly portBinding?: string; readonly timeoutMs: number };
  readonly provenance: { readonly graphNodeId: string; readonly source?: string };
}

export interface LocalSupervisorProcess extends LocalSupervisorResourceBase {
  readonly kind: 'process';
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly environment: readonly LocalSupervisorEnvironment[];
  readonly watch: readonly string[];
  readonly reloadGroup: string;
}

export interface LocalSupervisorContainer extends LocalSupervisorResourceBase {
  readonly kind: 'container';
  readonly image: string;
  readonly command?: readonly string[];
  readonly ports: readonly { readonly name: string; readonly containerPort: number; readonly protocol: 'tcp' | 'http' }[];
  readonly environment: readonly LocalSupervisorEnvironment[];
  readonly volumes: readonly {
    readonly name: string;
    readonly mountPath: string;
    readonly retained: boolean;
    /** Explicit host bind. Only trusted target adapters may emit this. */
    readonly hostPath?: string;
  }[];
  /** Bounded post-readiness commands that materialize declared target outputs. */
  readonly readyOutputs?: readonly {
    readonly binding: string;
    readonly command: readonly string[];
    readonly encoding: 'trimmed-stdout';
  }[];
}

export type LocalSupervisorEnvironment =
  | { readonly name: string; readonly binding: string }
  | { readonly name: string; readonly template: readonly LocalSupervisorEnvironmentSegment[] };

export type LocalSupervisorEnvironmentSegment =
  | { readonly kind: 'literal'; readonly value: string }
  | { readonly kind: 'binding'; readonly binding: string; readonly transform?: 'authority' | 'hostname' | 'port' };

export interface LocalSupervisorExternalResource extends LocalSupervisorResourceBase {
  readonly kind: 'external';
  readonly provider: string;
  readonly responsibility: string;
}

export interface LocalSupervisorBinding {
  readonly id: string;
  readonly owner: string;
  /** targetOutput is resolved by a target lifecycle adapter after its owner is healthy. */
  readonly kind: 'endpoint' | 'credential' | 'port' | 'volume' | 'targetOutput';
  readonly sensitivity: 'public' | 'sensitive';
  readonly value?: string | number;
  /** Controls endpoint presentation to consumers without changing health semantics. */
  readonly format?: 'url' | 'authority';
}

export interface LocalSupervisorDiagnostic {
  readonly severity: 'warning' | 'error';
  readonly code: 'LOCAL_TARGET_INCOMPATIBLE' | 'LOCAL_PROVIDER_UNRESOLVED' | 'LOCAL_LIFECYCLE_COLLISION';
  readonly message: string;
  readonly subjectId?: string;
}

export interface LocalSupervisorPlanValidation {
  readonly valid: boolean;
  readonly diagnostics: readonly LocalSupervisorDiagnostic[];
}

export function validateLocalSupervisorPlan(plan: LocalSupervisorPlan): LocalSupervisorPlanValidation {
  const diagnostics: LocalSupervisorDiagnostic[] = [...plan.diagnostics];
  const resourceIds = new Set<string>();
  const bindingIds = new Set<string>();
  for (const resource of plan.resources) {
    if (resourceIds.has(resource.id)) {
      diagnostics.push({ severity: 'error', code: 'LOCAL_LIFECYCLE_COLLISION', message: `Local resource identity ${resource.id} is declared more than once.`, subjectId: resource.id });
    }
    resourceIds.add(resource.id);
  }
  for (const binding of plan.bindings) {
    if (bindingIds.has(binding.id)) {
      diagnostics.push({ severity: 'error', code: 'LOCAL_LIFECYCLE_COLLISION', message: `Local binding identity ${binding.id} is declared more than once.`, subjectId: binding.id });
    }
    bindingIds.add(binding.id);
    if (!resourceIds.has(binding.owner)) {
      diagnostics.push({ severity: 'error', code: 'LOCAL_PROVIDER_UNRESOLVED', message: `Local binding ${binding.id} references unknown owner ${binding.owner}.`, subjectId: binding.id });
    }
  }
  for (const resource of plan.resources) {
    for (const dependency of resource.dependsOn) {
      if (!resourceIds.has(dependency)) {
        diagnostics.push({ severity: 'error', code: 'LOCAL_PROVIDER_UNRESOLVED', message: `Local resource ${resource.id} depends on unknown resource ${dependency}.`, subjectId: resource.id });
      }
    }
    for (const environment of resource.kind === 'external' ? [] : resource.environment) {
      for (const binding of localEnvironmentBindings(environment)) {
        if (!binding.startsWith('literal:') && !bindingIds.has(binding)) {
          diagnostics.push({ severity: 'error', code: 'LOCAL_PROVIDER_UNRESOLVED', message: `Local resource ${resource.id} references unknown binding ${binding}.`, subjectId: resource.id });
        }
      }
    }
    if (resource.kind === 'container') for (const output of resource.readyOutputs ?? []) {
      const declaration = plan.bindings.find(({ id }) => id === output.binding);
      if (!declaration || declaration.owner !== resource.id || declaration.kind !== 'targetOutput') {
        diagnostics.push({ severity: 'error', code: 'LOCAL_PROVIDER_UNRESOLVED', message: `Local resource ${resource.id} materializes undeclared target output ${output.binding}.`, subjectId: resource.id });
      }
      if (output.command.length === 0) diagnostics.push({ severity: 'error', code: 'LOCAL_PROVIDER_UNRESOLVED', message: `Local target output ${output.binding} has an empty materialization command.`, subjectId: resource.id });
    }
    if (resource.kind === 'container') {
      for (const volume of resource.volumes) {
        if (volume.hostPath && !(plan.target === 'aws-local' && resource.id === 'target:ministack' && volume.hostPath === '/var/run/docker.sock' && volume.mountPath === '/var/run/docker.sock')) {
          diagnostics.push({ severity: 'error', code: 'LOCAL_TARGET_INCOMPATIBLE', message: `Local resource ${resource.id} requests unqualified host bind ${volume.hostPath}.`, subjectId: resource.id });
        }
      }
    }
  }
  return { valid: !diagnostics.some(({ severity }) => severity === 'error'), diagnostics };
}

export function normalizeLocalSupervisorPlan(plan: LocalSupervisorPlan): LocalSupervisorPlan {
  return {
    ...plan,
    resources: [...plan.resources].map(normalizeLocalSupervisorResource).sort((left, right) => left.id.localeCompare(right.id)),
    bindings: [...plan.bindings].sort((left, right) => left.id.localeCompare(right.id)),
    diagnostics: [...plan.diagnostics].sort((left, right) => left.code.localeCompare(right.code) || (left.subjectId ?? '').localeCompare(right.subjectId ?? '')),
  };
}

function normalizeLocalSupervisorResource(resource: LocalSupervisorResource): LocalSupervisorResource {
  const dependsOn = [...resource.dependsOn].sort();
  if (resource.kind === 'external') return { ...resource, dependsOn };
  const environment = [...resource.environment].sort((left, right) => left.name.localeCompare(right.name));
  if (resource.kind === 'process') return { ...resource, dependsOn, environment, watch: [...resource.watch].sort() };
  return {
    ...resource,
    dependsOn,
    environment,
    ports: [...resource.ports].sort((left, right) => left.name.localeCompare(right.name)),
    volumes: [...resource.volumes].sort((left, right) => left.name.localeCompare(right.name)),
    ...(resource.readyOutputs ? { readyOutputs: [...resource.readyOutputs].sort((left, right) => left.binding.localeCompare(right.binding)) } : {}),
  };
}

function localEnvironmentBindings(environment: LocalSupervisorEnvironment): readonly string[] {
  return 'binding' in environment
    ? [environment.binding]
    : environment.template.flatMap((segment) => segment.kind === 'binding' ? [segment.binding] : []);
}

export function serializeLocalSupervisorPlan(plan: LocalSupervisorPlan): string {
  return `${stableJson(normalizeLocalSupervisorPlan(plan))}\n`;
}

export function digestLocalSupervisorPlan(plan: LocalSupervisorPlan): `sha256:${string}` {
  return `sha256:${sha256Hex(serializeLocalSupervisorPlan(plan))}`;
}

function stableJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`;
}
