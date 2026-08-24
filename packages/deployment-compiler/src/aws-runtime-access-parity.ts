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
  | 'RUNTIME_ACCESS_NETWORK_WIDENED'
  | 'RUNTIME_ACCESS_NETWORK_WRONG_PORT'
  | 'RUNTIME_ACCESS_NETWORK_WRONG_PROTOCOL'
  | 'RUNTIME_ACCESS_NETWORK_MISBOUND';

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
    validateQualifiedSecurityGroups(workload, resource, resourcesById, finding);
  }
  return findings.sort((left, right) => left.workloadIdentity.localeCompare(right.workloadIdentity) || left.code.localeCompare(right.code));
}

function validateQualifiedSecurityGroups(
  workload: ApplicationRuntimeAccessPlan['workloads'][number],
  workloadResource: ApplicationAwsPlanResource,
  resourcesById: ReadonlyMap<string, ApplicationAwsPlanResource>,
  finding: (code: AwsRuntimeAccessParityCode, message: string) => void,
): void {
  if (!workload.aws || !isAwsRuntimeAccessSecurityGroupQualified(workload.aws, resourcesById)) return;
  const groupId = stringValue(workloadResource.configuration.runtimeAccessSecurityGroupResourceId);
  const group = groupId ? resourcesById.get(groupId) : undefined;
  if (!group || group.service !== 'ec2' || group.resourceType !== 'security-group') {
    finding('RUNTIME_ACCESS_NETWORK_MISSING', `AWS workload ${workload.workloadIdentity} has no exact per-workload security group.`);
    return;
  }
  if (
    group.configuration.runtimeAccessKind !== 'workload'
    || stringValue(group.configuration.workloadIdentity) !== workload.workloadIdentity
    || stringValue(group.configuration.workloadResourceId) !== workload.aws.resourceId
    || stringValue(group.configuration.policyDigest) !== workload.policyDigest
    || group.configuration.egressMode !== 'explicit'
  ) {
    finding('RUNTIME_ACCESS_NETWORK_MISBOUND', `AWS workload ${workload.workloadIdentity} security group is not bound to its exact workload identity and policy digest.`);
  }
  const expectedRules: ExactNetworkRule[] = [
    ...workload.aws.privatePeers.flatMap((peer) => peer.endpoint.target === 'aws' || peer.endpoint.target === 'aws-local'
      ? [{ kind: 'securityGroup' as const, protocol: peer.protocol.toLowerCase(), port: peer.port, targetResourceId: peer.endpoint.resourceId }]
      : []),
    ...workload.aws.bootstrapEgress.flatMap((entry) => entry.endpoint.target === 'aws' || entry.endpoint.target === 'aws-local'
      ? [{ kind: 'cidr' as const, protocol: entry.protocol.toLowerCase(), port: entry.port, cidr: entry.endpoint.cidr }]
      : []),
  ];
  const actualRules = arrayRecords(group.configuration.egressRules);
  for (const expected of expectedRules) {
    const sameDestination = actualRules.filter((actual) => expected.kind === 'securityGroup'
      ? actual.kind === 'securityGroup' && actual.targetResourceId === expected.targetResourceId
      : actual.kind === 'cidr' && actual.cidr === expected.cidr);
    if (sameDestination.length === 0) {
      finding('RUNTIME_ACCESS_NETWORK_MISSING', `AWS workload ${workload.workloadIdentity} security group omits ${expected.kind === 'securityGroup' ? expected.targetResourceId : expected.cidr}.`);
      continue;
    }
    if (expected.kind === 'securityGroup') {
      const targetGroupId = stringValue(resourcesById.get(expected.targetResourceId)?.configuration.runtimeAccessSecurityGroupResourceId);
      if (!targetGroupId || !sameDestination.some((actual) => actual.targetSecurityGroupResourceId === targetGroupId)) {
        finding('RUNTIME_ACCESS_NETWORK_MISBOUND', `AWS workload ${workload.workloadIdentity} egress to ${expected.targetResourceId} is bound to the wrong target security group.`);
        continue;
      }
    }
    if (!sameDestination.some((actual) => actual.protocol === expected.protocol)) {
      finding('RUNTIME_ACCESS_NETWORK_WRONG_PROTOCOL', `AWS workload ${workload.workloadIdentity} security group uses the wrong protocol for ${expected.kind === 'securityGroup' ? expected.targetResourceId : expected.cidr}.`);
      continue;
    }
    if (!sameDestination.some((actual) => actual.protocol === expected.protocol && actual.port === expected.port)) {
      finding('RUNTIME_ACCESS_NETWORK_WRONG_PORT', `AWS workload ${workload.workloadIdentity} security group uses the wrong port for ${expected.kind === 'securityGroup' ? expected.targetResourceId : expected.cidr}.`);
    }
  }
  const expectedAtoms = new Set(expectedRules.map(networkRuleAtom));
  const actualAtoms = new Set(actualRules.map((rule) => networkRuleAtom({
    kind: rule.kind === 'securityGroup' ? 'securityGroup' : 'cidr',
    protocol: rule.protocol,
    port: rule.port,
    ...(rule.kind === 'securityGroup' ? { targetResourceId: rule.targetResourceId } : { cidr: rule.cidr }),
  })));
  if ([...actualAtoms].some((atom) => !expectedAtoms.has(atom))) {
    finding('RUNTIME_ACCESS_NETWORK_WIDENED', `AWS workload ${workload.workloadIdentity} security group contains egress outside its exact runtime-access envelope.`);
  }

  for (const peer of workload.aws.privatePeers) {
    if (peer.endpoint.target !== 'aws' && peer.endpoint.target !== 'aws-local') continue;
    const target = resourcesById.get(peer.endpoint.resourceId);
    const targetGroupId = target ? stringValue(target.configuration.runtimeAccessSecurityGroupResourceId) : undefined;
    const targetGroup = targetGroupId ? resourcesById.get(targetGroupId) : undefined;
    if (!targetGroup || targetGroup.configuration.runtimeAccessKind !== 'target' || targetGroup.configuration.targetResourceId !== peer.endpoint.resourceId) {
      finding('RUNTIME_ACCESS_NETWORK_MISBOUND', `AWS private target ${peer.endpoint.resourceId} is not bound to one exact target security group.`);
      continue;
    }
    const ingress = arrayRecords(targetGroup.configuration.ingressRules).filter((rule) =>
      rule.sourceSecurityGroupResourceId === group.id && rule.sourceWorkloadIdentity === workload.workloadIdentity);
    if (ingress.length === 0) {
      finding('RUNTIME_ACCESS_NETWORK_MISSING', `AWS private target ${peer.endpoint.resourceId} omits ingress from ${workload.workloadIdentity}.`);
    } else if (!ingress.some((rule) => rule.protocol === peer.protocol.toLowerCase())) {
      finding('RUNTIME_ACCESS_NETWORK_WRONG_PROTOCOL', `AWS private target ${peer.endpoint.resourceId} uses the wrong ingress protocol for ${workload.workloadIdentity}.`);
    } else if (!ingress.some((rule) => rule.protocol === peer.protocol.toLowerCase() && rule.port === peer.port)) {
      finding('RUNTIME_ACCESS_NETWORK_WRONG_PORT', `AWS private target ${peer.endpoint.resourceId} uses the wrong ingress port for ${workload.workloadIdentity}.`);
    }
  }
}

type ExactNetworkRule =
  | { readonly kind: 'securityGroup'; readonly protocol: string; readonly port: number; readonly targetResourceId: string }
  | { readonly kind: 'cidr'; readonly protocol: string; readonly port: number; readonly cidr: string };

export function isAwsRuntimeAccessSecurityGroupQualified(
  aws: NonNullable<ApplicationRuntimeAccessPlan['workloads'][number]['aws']>,
  resourcesById: ReadonlyMap<string, ApplicationAwsPlanResource>,
  target?: 'aws' | 'aws-local',
): boolean {
  if (aws.privatePeers.length === 0 || aws.externalEgress.length > 0) return false;
  if (aws.privatePeers.some((peer) => {
    if (peer.endpoint.target !== 'aws' && peer.endpoint.target !== 'aws-local') return true;
    if (target && peer.endpoint.target !== target) return true;
    const targetResource = resourcesById.get(peer.endpoint.resourceId);
    return !targetResource || !(
      (targetResource.service === 'rds' && targetResource.resourceType === 'postgresql-instance')
      || (targetResource.service === 'elasticache' && targetResource.resourceType === 'valkey-replication-group')
    );
  })) return false;
  if (aws.bootstrapEgress.some((entry) => {
    if (entry.endpoint.target !== 'aws' && entry.endpoint.target !== 'aws-local') return true;
    return Boolean(target && entry.endpoint.target !== target) || entry.purpose !== 'dns';
  })) return false;
  // ECS resolves declared Secret projections before the application container
  // starts. Other AWS API actions still require a first-class VPC endpoint or
  // service-prefix destination before Security Group egress can be exact.
  return aws.statements.every((statement) => statement.actions.every((action) => action === 'secretsmanager:GetSecretValue'));
}

function networkRuleAtom(rule: Readonly<Record<string, unknown>>): string {
  return canonicalJsonV1String({
    kind: rule.kind,
    protocol: rule.protocol,
    port: rule.port,
    ...(rule.kind === 'securityGroup' ? { targetResourceId: rule.targetResourceId } : { cidr: rule.cidr }),
  });
}

function arrayRecords(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  return Array.isArray(value) ? value.filter(record) : [];
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
