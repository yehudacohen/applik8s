import type {
  ApplicationProviderGuaranteeManifest,
  ApplicationRuntimeAccessRequirement,
} from '@applik8s/core';
import { canonicalJsonV1String } from '@applik8s/core/canonical-json';
import { sha256Hex } from './serialization.js';

export interface ApplicationRuntimeAccessPlan {
  readonly apiVersion: 'applik8s.runtimeAccessPlan/v1alpha1';
  readonly application: string;
  readonly target: 'local' | 'aws-local' | 'aws' | 'kubernetes';
  readonly sourceGraphDigest: `sha256:${string}`;
  readonly digest: `sha256:${string}`;
  readonly executions: readonly ApplicationRuntimeAccessExecutionPlan[];
  readonly diagnostics: readonly ApplicationRuntimeAccessPlanDiagnostic[];
}

export interface ApplicationRuntimeAccessExecutionPlan {
  readonly executionIdentity: string;
  readonly nodeId: string;
  readonly requirementIds: readonly string[];
  readonly requirements: readonly ApplicationRuntimeAccessRequirement[];
  readonly policyDigest: `sha256:${string}`;
  readonly lowerings: readonly ApplicationRuntimeAccessRequirementLowering[];
  readonly local: { readonly grants: readonly ApplicationRuntimeAccessRequirement['target'][] };
  readonly kubernetes?: {
    readonly serviceAccountName: string;
    readonly bindings: readonly ApplicationRuntimeAccessKubernetesBinding[];
    readonly networkConnections: readonly string[];
    readonly credentialResources: readonly string[];
  };
  readonly aws?: {
    readonly roleName: string;
    readonly statements: readonly ApplicationRuntimeAccessAwsStatement[];
    readonly networkConnections: readonly string[];
  };
}

export interface ApplicationRuntimeAccessRequirementLowering {
  readonly requirementId: string;
  readonly operation: ApplicationRuntimeAccessRequirement['target']['operation'];
  readonly capabilityId: string;
  readonly origin: ApplicationRuntimeAccessRequirement['origin'];
  readonly fidelity: 'exact' | 'capability' | 'application-only' | 'external' | 'unsupported';
  readonly mechanisms: readonly ApplicationRuntimeAccessMechanism[];
  readonly provenanceIds: readonly string[];
  readonly providerGuarantee?: {
    readonly providerId: string;
    readonly disposition: 'guaranteed' | 'bounded' | 'unsupported' | 'external' | 'unresolved';
    readonly evidenceLevel: ApplicationProviderGuaranteeManifest['evidenceLevel'] | 'none';
  };
}

export type ApplicationRuntimeAccessMechanism =
  | 'local-binding'
  | 'kubernetes-rbac'
  | 'kubernetes-network'
  | 'kubernetes-secret-projection'
  | 'aws-iam'
  | 'aws-network'
  | 'external-contract'
  | 'application-authorization';

export interface ApplicationRuntimeAccessKubernetesBinding {
  readonly kind: 'Role' | 'ClusterRole';
  readonly namespace?: string;
  readonly rules: readonly ApplicationRuntimeAccessKubernetesRule[];
  readonly requirementIds: readonly string[];
}

export interface ApplicationRuntimeAccessAwsStatement {
  readonly effect: 'Allow';
  readonly actions: readonly string[];
  readonly resources: readonly string[];
  readonly conditions?: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
}

export interface ApplicationRuntimeAccessKubernetesRule {
  readonly apiGroups: readonly string[];
  readonly resources: readonly string[];
  readonly verbs: readonly string[];
  readonly resourceNames?: readonly string[];
}

export interface ApplicationRuntimeAccessPlanDiagnostic {
  readonly severity: 'error' | 'warning';
  readonly code:
    | 'RUNTIME_ACCESS_EXPLICIT_REDUNDANT'
    | 'RUNTIME_ACCESS_EXPLICIT_UNUSED'
    | 'RUNTIME_ACCESS_EXPLICIT_WIDENING'
    | 'RUNTIME_ACCESS_PROVIDER_GUARANTEE_UNSUPPORTED'
    | 'RUNTIME_ACCESS_TARGET_UNRESOLVED'
    | 'RUNTIME_ACCESS_WILDCARD_FORBIDDEN';
  readonly message: string;
  readonly requirementId: string;
}

export function applicationRuntimeAccessPlanDigest(
  plan: Omit<ApplicationRuntimeAccessPlan, 'digest'>,
): `sha256:${string}` {
  return `sha256:${sha256Hex(canonicalJsonV1String(plan))}`;
}

export function validateApplicationRuntimeAccessPlan(
  value: ApplicationRuntimeAccessPlan | unknown,
  options: { readonly requireResolved?: boolean } = {},
): readonly string[] {
  const errors: string[] = [];
  if (!record(value)) return ['must be an object'];
  if (value.apiVersion !== 'applik8s.runtimeAccessPlan/v1alpha1') errors.push('apiVersion is unsupported');
  if (typeof value.application !== 'string' || !value.application.trim()) errors.push('application must be non-empty');
  if (value.target !== 'local' && value.target !== 'aws-local' && value.target !== 'aws' && value.target !== 'kubernetes') errors.push('target is unsupported');
  if (typeof value.sourceGraphDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value.sourceGraphDigest)) errors.push('sourceGraphDigest must be a lowercase sha256 identity');
  if (typeof value.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value.digest)) errors.push('digest must be a lowercase sha256 identity');
  if (!Array.isArray(value.executions)) errors.push('executions must be an array');
  if (!Array.isArray(value.diagnostics)) errors.push('diagnostics must be an array');
  if (errors.length > 0) return errors;
  const plan = value as unknown as ApplicationRuntimeAccessPlan;
  const executionIds = new Set<string>();
  const ownedRequirementIds = new Set<string>();
  for (const execution of plan.executions) {
    if (!record(execution)) {
      errors.push('execution entries must be objects');
      continue;
    }
    if (!execution.executionIdentity || executionIds.has(execution.executionIdentity)) errors.push(`execution identity ${execution.executionIdentity || '<empty>'} is empty or duplicated`);
    executionIds.add(execution.executionIdentity);
    if (typeof execution.nodeId !== 'string' || !execution.nodeId.trim()) errors.push(`execution ${execution.executionIdentity} has no nodeId`);
    if (!/^sha256:[a-f0-9]{64}$/u.test(execution.policyDigest)) errors.push(`execution ${execution.executionIdentity} has an invalid policyDigest`);
    if (!Array.isArray(execution.requirementIds) || !Array.isArray(execution.requirements) || !Array.isArray(execution.lowerings)) {
      errors.push(`execution ${execution.executionIdentity} has malformed requirement collections`);
      continue;
    }
    if (new Set(execution.requirementIds).size !== execution.requirementIds.length) errors.push(`execution ${execution.executionIdentity} repeats requirement IDs`);
    for (const requirementId of execution.requirementIds) {
      if (ownedRequirementIds.has(requirementId)) errors.push(`requirement ${requirementId} is owned by more than one execution`);
      ownedRequirementIds.add(requirementId);
    }
    const actualRequirementIds = execution.requirements.flatMap((requirement) => {
      if (!record(requirement) || typeof requirement.id !== 'string' || !requirement.id) {
        errors.push(`execution ${execution.executionIdentity} contains a malformed requirement`);
        return [];
      }
      return [requirement.id];
    }).sort();
    if (canonicalJsonV1String([...execution.requirementIds].sort()) !== canonicalJsonV1String(actualRequirementIds)) errors.push(`execution ${execution.executionIdentity} requirementIds do not match its requirements`);
    const loweringIds = execution.lowerings.flatMap((lowering) => {
      if (!record(lowering) || typeof lowering.requirementId !== 'string' || !lowering.requirementId) {
        errors.push(`execution ${execution.executionIdentity} contains a malformed lowering`);
        return [];
      }
      return [lowering.requirementId];
    }).sort();
    if (canonicalJsonV1String(loweringIds) !== canonicalJsonV1String(actualRequirementIds)) errors.push(`execution ${execution.executionIdentity} lowerings do not cover its requirements exactly once`);
    if (execution.requirements.some(containsWildcard)) errors.push(`execution ${execution.executionIdentity} contains a wildcard requirement`);
    if (execution.kubernetes && plan.target !== 'kubernetes') errors.push(`execution ${execution.executionIdentity} carries Kubernetes policy for ${plan.target}`);
    if (execution.aws && plan.target !== 'aws' && plan.target !== 'aws-local') errors.push(`execution ${execution.executionIdentity} carries AWS policy for ${plan.target}`);
    if (plan.target === 'kubernetes' && !execution.kubernetes) errors.push(`execution ${execution.executionIdentity} has no Kubernetes enforcement policy`);
    if ((plan.target === 'aws' || plan.target === 'aws-local') && !execution.aws) errors.push(`execution ${execution.executionIdentity} has no AWS enforcement policy`);
    const policy = {
      local: execution.local,
      ...(execution.kubernetes ? { kubernetes: execution.kubernetes } : {}),
      ...(execution.aws ? { aws: execution.aws } : {}),
    };
    const expectedPolicyDigest = `sha256:${sha256Hex(canonicalJsonV1String(policy))}`;
    if (execution.policyDigest !== expectedPolicyDigest) errors.push(`execution ${execution.executionIdentity} policyDigest does not match its enforcement policy`);
  }
  for (const diagnostic of plan.diagnostics) {
    if (!record(diagnostic) || (diagnostic.severity !== 'error' && diagnostic.severity !== 'warning')) {
      errors.push('runtime-access plan contains a malformed diagnostic');
    }
  }
  if (options.requireResolved && plan.diagnostics.some((diagnostic) => record(diagnostic) && diagnostic.severity === 'error')) errors.push('runtime-access plan contains unresolved error diagnostics');
  const { digest: _digest, ...content } = plan;
  try {
    if (plan.digest !== applicationRuntimeAccessPlanDigest(content)) errors.push('digest does not match canonical runtime-access content');
  } catch {
    errors.push('content cannot be represented as canonical runtime-access data');
  }
  return errors;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function containsWildcard(value: unknown): boolean {
  if (value === '*') return true;
  if (Array.isArray(value)) return value.some(containsWildcard);
  return Boolean(value && typeof value === 'object' && Object.values(value).some(containsWildcard));
}
