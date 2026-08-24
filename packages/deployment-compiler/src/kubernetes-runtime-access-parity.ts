import type {
  ApplicationRuntimeAccessKubernetesRule,
  ApplicationRuntimeAccessPlan,
} from '@applik8s/deployment-contract';

export interface KubernetesRuntimeAccessParityFinding {
  readonly code:
    | 'RUNTIME_ACCESS_WORKLOAD_MISSING'
    | 'RUNTIME_ACCESS_SERVICE_ACCOUNT_MISMATCH'
    | 'RUNTIME_ACCESS_RBAC_MISSING'
    | 'RUNTIME_ACCESS_RBAC_WIDENED'
    | 'RUNTIME_ACCESS_CREDENTIAL_MISSING'
    | 'RUNTIME_ACCESS_CREDENTIAL_WIDENED';
  readonly workloadIdentity: string;
  readonly executionIdentities: readonly string[];
  readonly requirementIds: readonly string[];
  readonly message: string;
}

/**
 * Proves that materialized Kubernetes identity, RBAC, and kubelet Secret
 * projections are exactly the policy union recorded for each physical
 * workload. The emitted resources are evidence here, never a policy source.
 */
export function validateKubernetesRuntimeAccessParity(
  plan: ApplicationRuntimeAccessPlan,
  resources: readonly unknown[],
): readonly KubernetesRuntimeAccessParityFinding[] {
  if (plan.target !== 'kubernetes') return [];
  const manifests = resources
    .map(unwrapResource)
    .filter((value): value is Readonly<Record<string, unknown>> => Boolean(value));
  const findings: KubernetesRuntimeAccessParityFinding[] = [];
  for (const workload of plan.workloads) {
    const expected = workload.kubernetes;
    if (!expected) continue;
    const liveWorkload = manifests.find((manifest) =>
      manifest.apiVersion === expected.resource.apiVersion
      && manifest.kind === expected.resource.kind
      && metadataName(manifest) === expected.resource.name
      && metadataNamespace(manifest) === expected.resource.namespace);
    if (!liveWorkload) {
      findings.push(finding(workload, 'RUNTIME_ACCESS_WORKLOAD_MISSING',
        `Materialized workload ${workload.workloadIdentity} is absent.`));
      continue;
    }
    const podSpec = workloadPodSpec(liveWorkload);
    const actualServiceAccount = stringValue(podSpec?.serviceAccountName) ?? 'default';
    if (actualServiceAccount !== expected.serviceAccountName) {
      findings.push(finding(workload, 'RUNTIME_ACCESS_SERVICE_ACCOUNT_MISMATCH',
        `Workload ${workload.workloadIdentity} uses ServiceAccount ${actualServiceAccount}, but its enforcement envelope requires ${expected.serviceAccountName}.`));
    }

    const expectedRules = ruleAtoms(expected.bindings.flatMap(({ rules }) => rules));
    const actualRules = grantedRuleAtoms(
      manifests,
      expected.resource.namespace,
      expected.serviceAccountName,
    );
    const missingRules = difference(expectedRules, actualRules);
    const widenedRules = difference(actualRules, expectedRules);
    if (missingRules.length > 0) {
      findings.push(finding(workload, 'RUNTIME_ACCESS_RBAC_MISSING',
        `Workload ${workload.workloadIdentity} is missing Kubernetes grants: ${missingRules.join(', ')}.`));
    }
    if (widenedRules.length > 0) {
      findings.push(finding(workload, 'RUNTIME_ACCESS_RBAC_WIDENED',
        `Workload ${workload.workloadIdentity} receives undeclared Kubernetes grants: ${widenedRules.join(', ')}.`));
    }

    const expectedSecrets = [...new Set(expected.credentialProjections.flatMap((projection) => {
      const name = secretNameFromIdentity(projection.resourceId);
      if (!name) return [];
      return projection.keys.length > 0
        ? projection.keys.map((key) => `${name}:${key}`)
        : [`${name}:*`];
    }))].sort();
    const actualSecrets = projectedSecretKeys(podSpec);
    const missingSecrets = difference(expectedSecrets, actualSecrets);
    const widenedSecrets = difference(actualSecrets, expectedSecrets);
    if (missingSecrets.length > 0) {
      findings.push(finding(workload, 'RUNTIME_ACCESS_CREDENTIAL_MISSING',
        `Workload ${workload.workloadIdentity} is missing declared Secret projections: ${missingSecrets.join(', ')}.`));
    }
    if (widenedSecrets.length > 0) {
      findings.push(finding(workload, 'RUNTIME_ACCESS_CREDENTIAL_WIDENED',
        `Workload ${workload.workloadIdentity} receives undeclared Secret projections: ${widenedSecrets.join(', ')}.`));
    }
  }
  return findings;
}

function finding(
  workload: ApplicationRuntimeAccessPlan['workloads'][number],
  code: KubernetesRuntimeAccessParityFinding['code'],
  message: string,
): KubernetesRuntimeAccessParityFinding {
  return {
    code,
    workloadIdentity: workload.workloadIdentity,
    executionIdentities: workload.executionIdentities,
    requirementIds: workload.requirementIds,
    message: `${message} Executions: ${workload.executionIdentities.join(', ') || '<none>'}. Requirements: ${workload.requirementIds.join(', ') || '<none>'}.`,
  };
}

function grantedRuleAtoms(
  manifests: readonly Readonly<Record<string, unknown>>[],
  workloadNamespace: string,
  serviceAccountName: string,
): readonly string[] {
  const roles = new Map<string, readonly ApplicationRuntimeAccessKubernetesRule[]>();
  for (const manifest of manifests) {
    if (manifest.kind !== 'Role' && manifest.kind !== 'ClusterRole') continue;
    const name = metadataName(manifest);
    if (!name) continue;
    const namespace = manifest.kind === 'Role' ? metadataNamespace(manifest) : '';
    roles.set(`${manifest.kind}:${namespace}:${name}`, kubernetesRules(manifest.rules));
  }
  const rules: ApplicationRuntimeAccessKubernetesRule[] = [];
  for (const manifest of manifests) {
    if (manifest.kind !== 'RoleBinding' && manifest.kind !== 'ClusterRoleBinding') continue;
    const bindingNamespace = metadataNamespace(manifest);
    const subjects = arrayValue(manifest.subjects).map(recordValue).filter(defined);
    const matches = subjects.some((subject) =>
      subject.kind === 'ServiceAccount'
      && subject.name === serviceAccountName
      && (stringValue(subject.namespace) ?? bindingNamespace) === workloadNamespace);
    if (!matches) continue;
    const roleRef = recordValue(manifest.roleRef);
    const kind = roleRef?.kind === 'Role' ? 'Role' : roleRef?.kind === 'ClusterRole' ? 'ClusterRole' : undefined;
    const name = stringValue(roleRef?.name);
    if (!kind || !name) continue;
    const namespace = kind === 'Role' ? bindingNamespace : '';
    rules.push(...(roles.get(`${kind}:${namespace}:${name}`) ?? []));
  }
  return ruleAtoms(rules);
}

function kubernetesRules(value: unknown): readonly ApplicationRuntimeAccessKubernetesRule[] {
  return arrayValue(value).flatMap((entry) => {
    const rule = recordValue(entry);
    if (!rule) return [];
    const apiGroups = stringArray(rule.apiGroups);
    const resources = stringArray(rule.resources);
    const verbs = stringArray(rule.verbs);
    const resourceNames = stringArray(rule.resourceNames);
    return [{
      apiGroups,
      resources,
      verbs,
      ...(resourceNames.length > 0 ? { resourceNames } : {}),
    }];
  });
}

function ruleAtoms(rules: readonly ApplicationRuntimeAccessKubernetesRule[]): readonly string[] {
  const values = new Set<string>();
  for (const rule of rules) {
    const resourceNames = rule.resourceNames?.length ? rule.resourceNames : ['*'];
    for (const apiGroup of rule.apiGroups) {
      for (const resource of rule.resources) {
        for (const verb of rule.verbs) {
          for (const resourceName of resourceNames) values.add(`${apiGroup}/${resource}:${verb}:${resourceName}`);
        }
      }
    }
  }
  return [...values].sort();
}

function projectedSecretKeys(podSpec: Readonly<Record<string, unknown>> | undefined): readonly string[] {
  if (!podSpec) return [];
  const names = new Set<string>();
  for (const container of [
    ...arrayValue(podSpec.containers),
    ...arrayValue(podSpec.initContainers),
  ].map(recordValue).filter(defined)) {
    for (const env of arrayValue(container.env).map(recordValue).filter(defined)) {
      const secretKeyRef = recordValue(recordValue(env.valueFrom)?.secretKeyRef);
      const name = stringValue(secretKeyRef?.name);
      const key = stringValue(secretKeyRef?.key);
      if (name && key) names.add(`${name}:${key}`);
    }
    for (const envFrom of arrayValue(container.envFrom).map(recordValue).filter(defined)) {
      const name = stringValue(recordValue(envFrom.secretRef)?.name);
      if (name) names.add(`${name}:*`);
    }
  }
  for (const volume of arrayValue(podSpec.volumes).map(recordValue).filter(defined)) {
    const direct = stringValue(recordValue(volume.secret)?.secretName);
    if (direct) names.add(`${direct}:*`);
    const projected = recordValue(volume.projected);
    for (const source of arrayValue(projected?.sources).map(recordValue).filter(defined)) {
      const name = stringValue(recordValue(source.secret)?.name);
      if (name) names.add(`${name}:*`);
    }
  }
  return [...names].sort();
}

function secretNameFromIdentity(identity: string): string | undefined {
  const match = /^(?:.+\/)Secret\/[^/]*\/([^/]+)$/u.exec(identity);
  return match?.[1];
}

function workloadPodSpec(workload: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> | undefined {
  const spec = recordValue(workload.spec);
  if (workload.kind === 'CronJob') {
    return recordValue(recordValue(recordValue(recordValue(spec?.jobTemplate)?.spec)?.template)?.spec);
  }
  return recordValue(recordValue(spec?.template)?.spec);
}

function unwrapResource(value: unknown): Readonly<Record<string, unknown>> | undefined {
  const record = recordValue(value);
  return recordValue(record?.template) ?? record;
}

function metadataName(value: Readonly<Record<string, unknown>>): string | undefined {
  return stringValue(recordValue(value.metadata)?.name);
}

function metadataNamespace(value: Readonly<Record<string, unknown>>): string {
  return stringValue(recordValue(value.metadata)?.namespace) ?? '';
}

function difference(left: readonly string[], right: readonly string[]): readonly string[] {
  const values = new Set(right);
  return left.filter((value) => !values.has(value));
}

function arrayValue(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): readonly string[] {
  return arrayValue(value).filter((entry): entry is string => typeof entry === 'string').sort();
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function recordValue(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}

function defined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
