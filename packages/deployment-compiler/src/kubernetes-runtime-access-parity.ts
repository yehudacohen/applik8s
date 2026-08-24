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
    | 'RUNTIME_ACCESS_CREDENTIAL_WIDENED'
    | 'RUNTIME_ACCESS_NETWORK_MISSING'
    | 'RUNTIME_ACCESS_NETWORK_WIDENED'
    | 'RUNTIME_ACCESS_NETWORK_WRONG_PORT'
    | 'RUNTIME_ACCESS_NETWORK_WRONG_PROTOCOL'
    | 'RUNTIME_ACCESS_NETWORK_MISBOUND';
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

    if (expected.privatePeers.length > 0 && expected.externalEgress.length === 0) {
      findings.push(...networkPolicyFindings(workload, expected, manifests));
    }
  }
  return findings;
}

function networkPolicyFindings(
  workload: ApplicationRuntimeAccessPlan['workloads'][number],
  expected: NonNullable<ApplicationRuntimeAccessPlan['workloads'][number]['kubernetes']>,
  manifests: readonly Readonly<Record<string, unknown>>[],
): readonly KubernetesRuntimeAccessParityFinding[] {
  const policy = manifests.find((manifest) =>
    manifest.apiVersion === 'networking.k8s.io/v1'
    && manifest.kind === 'NetworkPolicy'
    && stringValue(recordValue(recordValue(manifest.metadata)?.annotations)?.['applik8s.io/runtime-access-workload']) === workload.workloadIdentity);
  if (!policy) {
    return [finding(workload, 'RUNTIME_ACCESS_NETWORK_MISSING', `Workload ${workload.workloadIdentity} has no generated private-egress NetworkPolicy.`)];
  }
  const metadata = recordValue(policy.metadata);
  const spec = recordValue(policy.spec);
  const selector = stringRecord(recordValue(recordValue(spec?.podSelector)?.matchLabels));
  if (
    metadataNamespace(policy) !== expected.resource.namespace
    || stableJson(selector ?? {}) !== stableJson(expected.podSelector)
    || stringValue(recordValue(metadata?.annotations)?.['applik8s.io/runtime-access-policy-digest']) !== workload.policyDigest
  ) {
    return [finding(workload, 'RUNTIME_ACCESS_NETWORK_MISBOUND', `Workload ${workload.workloadIdentity} NetworkPolicy is bound to the wrong namespace, pods, or policy identity.`)];
  }
  const policyTypes = stringArray(spec?.policyTypes);
  if (policyTypes.length !== 1 || policyTypes[0] !== 'Egress') {
    return [finding(workload, 'RUNTIME_ACCESS_NETWORK_WIDENED', `Workload ${workload.workloadIdentity} NetworkPolicy changes the expected egress-only boundary.`)];
  }
  const expectedAtoms = [
    ...expected.privatePeers.flatMap((peer) => peer.endpoint.target === 'kubernetes'
      ? [networkAtom(peer.endpoint.namespace, peer.endpoint.podSelector, peer.protocol, peer.port)]
      : []),
    ...expected.bootstrapEgress.flatMap((bootstrap) => bootstrap.endpoint.target === 'kubernetes'
      ? [networkAtom(bootstrap.endpoint.namespace, bootstrap.endpoint.podSelector, bootstrap.protocol, bootstrap.port)]
      : []),
  ].sort();
  const parsed = networkPolicyAtoms(spec?.egress);
  if (parsed.wildcard) {
    return [finding(workload, 'RUNTIME_ACCESS_NETWORK_WIDENED', `Workload ${workload.workloadIdentity} NetworkPolicy contains an unbounded destination or port.`)];
  }
  const missing = difference(expectedAtoms, parsed.atoms);
  const widened = difference(parsed.atoms, expectedAtoms);
  if (missing.length === 0 && widened.length === 0) return [];
  const expectedEndpoints = new Map(expectedAtoms.map((atom) => [networkEndpoint(atom), atom]));
  for (const actual of parsed.atoms) {
    const expectedAtom = expectedEndpoints.get(networkEndpoint(actual));
    if (!expectedAtom || expectedAtom === actual) continue;
    const expectedParts = expectedAtom.split('|');
    const actualParts = actual.split('|');
    if (expectedParts[2] !== actualParts[2]) {
      return [finding(workload, 'RUNTIME_ACCESS_NETWORK_WRONG_PROTOCOL', `Workload ${workload.workloadIdentity} NetworkPolicy uses ${actualParts[2]} where ${expectedParts[2]} is required.`)];
    }
    if (expectedParts[3] !== actualParts[3]) {
      return [finding(workload, 'RUNTIME_ACCESS_NETWORK_WRONG_PORT', `Workload ${workload.workloadIdentity} NetworkPolicy uses port ${actualParts[3]} where ${expectedParts[3]} is required.`)];
    }
  }
  return [finding(workload, widened.length > 0 ? 'RUNTIME_ACCESS_NETWORK_WIDENED' : 'RUNTIME_ACCESS_NETWORK_MISSING',
    `Workload ${workload.workloadIdentity} NetworkPolicy differs from its declared peers (missing: ${missing.join(', ') || '<none>'}; extra: ${widened.join(', ') || '<none>'}).`)];
}

function networkPolicyAtoms(value: unknown): { readonly atoms: readonly string[]; readonly wildcard: boolean } {
  const atoms: string[] = [];
  let wildcard = false;
  for (const rawRule of arrayValue(value)) {
    const rule = recordValue(rawRule);
    const destinations = arrayValue(rule?.to);
    const ports = arrayValue(rule?.ports);
    if (destinations.length !== 1 || ports.length === 0) {
      wildcard = true;
      continue;
    }
    const destination = recordValue(destinations[0]);
    const namespace = stringValue(recordValue(recordValue(destination?.namespaceSelector)?.matchLabels)?.['kubernetes.io/metadata.name']);
    const selector = stringRecord(recordValue(recordValue(destination?.podSelector)?.matchLabels));
    if (!namespace || !selector || Object.keys(selector).length === 0 || destination?.ipBlock !== undefined) {
      wildcard = true;
      continue;
    }
    for (const rawPort of ports) {
      const port = recordValue(rawPort);
      const protocol = port?.protocol === 'TCP' || port?.protocol === 'UDP' ? port.protocol : undefined;
      const number = typeof port?.port === 'number' && Number.isInteger(port.port) ? port.port : undefined;
      if (!protocol || number === undefined) wildcard = true;
      else atoms.push(networkAtom(namespace, selector, protocol, number));
    }
  }
  return { atoms: [...new Set(atoms)].sort(), wildcard };
}

function networkAtom(namespace: string, selector: Readonly<Record<string, string>>, protocol: 'TCP' | 'UDP', port: number): string {
  return `${namespace}|${stableJson(selector)}|${protocol}|${port}`;
}

function networkEndpoint(atom: string): string {
  return atom.split('|').slice(0, 2).join('|');
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

function stringRecord(value: unknown): Readonly<Record<string, string>> | undefined {
  const record = recordValue(value);
  if (!record || Object.values(record).some((entry) => typeof entry !== 'string')) return undefined;
  return record as Readonly<Record<string, string>>;
}

function recordValue(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}

function defined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(',')}}`;
}
