import { canonicalJsonV1String } from '@applik8s/core/canonical-json';
import type {
  ApplicationAwsPlanEdge,
  ApplicationAwsPlanResource,
  ApplicationRuntimeAccessAwsStatement,
  ApplicationRuntimeAccessPlan,
} from '@applik8s/deployment-contract';

export type AwsRuntimeAccessParityCode =
  | 'RUNTIME_ACCESS_WORKLOAD_MISSING'
  | 'RUNTIME_ACCESS_ROLE_MISSING'
  | 'RUNTIME_ACCESS_ROLE_MISBOUND'
  | 'RUNTIME_ACCESS_IAM_MISSING'
  | 'RUNTIME_ACCESS_IAM_WIDENED'
  | 'RUNTIME_ACCESS_NETWORK_MISSING'
  | 'RUNTIME_ACCESS_NETWORK_WIDENED';

export interface AwsRuntimeAccessParityFinding {
  readonly code: AwsRuntimeAccessParityCode;
  readonly message: string;
  readonly workloadIdentity: string;
  readonly executionIdentities: readonly string[];
  readonly requirementIds: readonly string[];
}

/** Rejects IAM/task-role/network drift from the canonical envelope before effects. */
export function validateAwsRuntimeAccessParity(
  plan: ApplicationRuntimeAccessPlan,
  resources: readonly ApplicationAwsPlanResource[],
  edges: readonly ApplicationAwsPlanEdge[],
): readonly AwsRuntimeAccessParityFinding[] {
  const resourcesById = new Map(resources.map((resource) => [resource.id, resource]));
  const findings: AwsRuntimeAccessParityFinding[] = [];
  for (const workload of plan.workloads) {
    if (!workload.aws) continue;
    const finding = (code: AwsRuntimeAccessParityCode, message: string): void => {
      findings.push({ code, message, workloadIdentity: workload.workloadIdentity, executionIdentities: workload.executionIdentities, requirementIds: workload.requirementIds });
    };
    const resource = resourcesById.get(workload.aws.resourceId);
    if (!resource) {
      finding('RUNTIME_ACCESS_WORKLOAD_MISSING', `AWS workload ${workload.workloadIdentity} (${workload.aws.resourceId}) is absent.`);
      continue;
    }
    const roleId = stringValue(resource.configuration.runtimeRoleResourceId);
    const role = roleId ? resourcesById.get(roleId) : undefined;
    if (!role || role.service !== 'iam' || role.resourceType !== 'role') {
      finding('RUNTIME_ACCESS_ROLE_MISSING', `AWS workload ${workload.workloadIdentity} is not attached to one planned IAM role.`);
      continue;
    }
    const assumesRole = edges.filter((edge) => edge.relationship === 'assumesRole' && edge.to === resource.id);
    if (
      assumesRole.length !== 1
      || assumesRole[0]?.from !== role.id
      || role.physicalName !== workload.aws.roleName
      || stringValue(role.configuration.workloadIdentity) !== workload.workloadIdentity
      || canonicalJsonV1String(stringArray(role.configuration.executionIdentities)) !== canonicalJsonV1String(workload.executionIdentities)
      || canonicalJsonV1String(stringArray(role.configuration.requirementIds)) !== canonicalJsonV1String(workload.requirementIds)
    ) {
      finding('RUNTIME_ACCESS_ROLE_MISBOUND', `AWS workload ${workload.workloadIdentity} is attached to an IAM role whose persisted workload/execution/requirement identity does not match its enforcement envelope.`);
    }
    const expectedStatements = statementAtoms(workload.aws.statements);
    const actualStatements = statementAtoms(statementArray(role.configuration.statements));
    const missingStatements = [...expectedStatements].filter((atom) => !actualStatements.has(atom));
    const widenedStatements = [...actualStatements].filter((atom) => !expectedStatements.has(atom));
    if (missingStatements.length > 0) finding('RUNTIME_ACCESS_IAM_MISSING', `AWS workload ${workload.workloadIdentity} IAM role omits ${missingStatements.length} required action/resource/condition grant(s).`);
    if (widenedStatements.length > 0) finding('RUNTIME_ACCESS_IAM_WIDENED', `AWS workload ${workload.workloadIdentity} IAM role contains ${widenedStatements.length} grant(s) outside its enforcement envelope.`);
    const expectedNetwork = new Set(workload.aws.privatePeers.flatMap(({ endpoint }) =>
      endpoint.target === 'aws' || endpoint.target === 'aws-local' ? [endpoint.resourceId] : []));
    const actualNetwork = new Set(edges.filter((edge) => edge.relationship === 'networkAccess' && edge.output === 'runtime-egress' && edge.to === resource.id).map(({ from }) => from));
    const missingNetwork = [...expectedNetwork].filter((target) => !actualNetwork.has(target));
    const widenedNetwork = [...actualNetwork].filter((target) => !expectedNetwork.has(target));
    if (missingNetwork.length > 0) finding('RUNTIME_ACCESS_NETWORK_MISSING', `AWS workload ${workload.workloadIdentity} omits network access to ${missingNetwork.join(', ')}.`);
    if (widenedNetwork.length > 0) finding('RUNTIME_ACCESS_NETWORK_WIDENED', `AWS workload ${workload.workloadIdentity} has undeclared network access from ${widenedNetwork.join(', ')}.`);
  }
  return findings.sort((left, right) => left.workloadIdentity.localeCompare(right.workloadIdentity) || left.code.localeCompare(right.code));
}

function statementAtoms(statements: readonly ApplicationRuntimeAccessAwsStatement[]): ReadonlySet<string> {
  const atoms = new Set<string>();
  for (const statement of statements) for (const action of statement.actions) for (const resource of statement.resources) {
    atoms.add(canonicalJsonV1String({ action, resource, conditions: statement.conditions ?? {} }));
  }
  return atoms;
}

function statementArray(value: unknown): readonly ApplicationRuntimeAccessAwsStatement[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!record(entry) || entry.effect !== 'Allow' || !Array.isArray(entry.actions) || !Array.isArray(entry.resources)) return [];
    if (entry.actions.some((action) => typeof action !== 'string') || entry.resources.some((resource) => typeof resource !== 'string')) return [];
    const conditions = record(entry.conditions) ? entry.conditions as ApplicationRuntimeAccessAwsStatement['conditions'] : undefined;
    return [{ effect: 'Allow' as const, actions: entry.actions as string[], resources: entry.resources as string[], ...(conditions ? { conditions } : {}) }];
  });
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string').sort() : [];
}
function stringValue(value: unknown): string | undefined { return typeof value === 'string' && value ? value : undefined; }
function record(value: unknown): value is Readonly<Record<string, unknown>> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
