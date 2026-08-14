export type ApplicationOperationsCategory =
  | 'conversation' | 'message' | 'run' | 'runEvent' | 'memory'
  | 'approval' | 'outcome' | 'artifact' | 'evaluationDataset'
  | 'evaluationCase' | 'evaluationScorer' | 'evaluation' | 'evaluationResult'
  | 'usage' | 'entitlement' | 'installation' | 'provider' | 'workflow'
  | 'eventConsumer' | 'projection' | 'ai' | 'mcp' | 'authority'
  | 'identity' | 'objectStore' | 'database' | 'gateway' | 'audit'
  | 'goLive' | 'operational';

export interface ApplicationOperationsPublicRecord {
  readonly category: ApplicationOperationsCategory;
  readonly id: string;
  readonly label?: string;
  readonly state?: string;
  readonly authority?: 'canonical' | 'delivery' | 'provider' | 'inferred';
  readonly observedAt?: string;
}

export type ApplicationOperationsDomain =
  | 'installation' | 'provider' | 'workflow' | 'eventConsumer'
  | 'projection' | 'ai' | 'mcp' | 'authority' | 'identity'
  | 'objectStore' | 'database' | 'gateway';

export function applicationOperationsRedactedRecords(
  category: ApplicationOperationsCategory,
  rows: readonly unknown[],
): readonly ApplicationOperationsPublicRecord[] {
  return rows.map((value, index) => {
    const row = isRecord(value) ? value : {};
    const authority = publicAuthority(row.authority);
    const label = firstPublicString(row, ['name', 'subject', 'operationId', 'kind', 'type']);
    const recordedState = firstPublicString(row, ['status', 'state', 'phase', 'confidence']);
    const expiresAt = firstPublicString(row, ['expiresAt', 'expires_at']);
    const state = expiresAt && new Date(expiresAt).getTime() <= Date.now()
      ? 'unknown'
      : recordedState;
    const observedAt = firstPublicString(row, [
      'observedAt', 'occurredAt', 'updatedAt', 'createdAt', 'startedAt', 'completedAt',
    ]);
    return Object.freeze({
      category,
      id: firstPublicString(row, ['id', 'runId', 'grantRequestId']) ?? `${category}:${index}`,
      ...(label ? { label } : {}),
      ...(state ? { state } : {}),
      ...(authority ? { authority } : {}),
      ...(observedAt ? { observedAt } : {}),
    });
  });
}

export function applicationOperationsRedactedDomainRecords(
  category: ApplicationOperationsCategory,
  domain: ApplicationOperationsDomain,
  rows: readonly unknown[],
): readonly ApplicationOperationsPublicRecord[] {
  return applicationOperationsRedactedRecords(
    category,
    rows.filter((value) => isRecord(value) && value.domain === domain),
  );
}

/** Canonical observations replace graph-inferred Unknown rows for one subject. */
export function applicationOperationsMergeObservedAndInferredDomainRecords(
  category: ApplicationOperationsCategory,
  domain: ApplicationOperationsDomain,
  operational: readonly unknown[],
  inferred: readonly ApplicationOperationsPublicRecord[],
): readonly ApplicationOperationsPublicRecord[] {
  const observed = applicationOperationsRedactedDomainRecords(category, domain, operational);
  const observedLabels = new Set(
    observed.flatMap((record) => record.label ? [record.label.toLowerCase()] : []),
  );
  return [
    ...observed,
    ...inferred.filter((record) =>
      record.category === category
      && (!record.label || !observedLabels.has(record.label.toLowerCase()))
    ),
  ];
}

export function applicationOperationsOverviewSnapshot(
  operational: readonly unknown[],
  audit: readonly unknown[],
  inferred: readonly ApplicationOperationsPublicRecord[],
  auditSearch?: string,
) {
  const domain = (
    category: ApplicationOperationsCategory,
    name: ApplicationOperationsDomain,
  ) => applicationOperationsMergeObservedAndInferredDomainRecords(
    category,
    name,
    operational,
    inferred,
  );
  return {
    conversations: [], messages: [], runs: [], runEvents: [], memory: [],
    approvals: [], outcomes: [], artifacts: [], evaluationDatasets: [],
    evaluationCases: [], evaluationScorers: [], evaluations: [],
    evaluationResults: [], usage: [], entitlements: [],
    installations: domain('installation', 'installation'),
    providers: domain('provider', 'provider'),
    workflows: domain('workflow', 'workflow'),
    eventConsumers: domain('eventConsumer', 'eventConsumer'),
    projections: domain('projection', 'projection'),
    ai: domain('ai', 'ai'),
    mcp: domain('mcp', 'mcp'),
    authority: domain('authority', 'authority'),
    identity: domain('identity', 'identity'),
    objectStores: domain('objectStore', 'objectStore'),
    databases: domain('database', 'database'),
    gateways: domain('gateway', 'gateway'),
    audit: [...applicationOperationsRedactedAuditRecords(audit, auditSearch)],
    goLive: inferred.filter((record) => record.category === 'goLive'),
    operational: [...applicationOperationsRedactedRecords('operational', operational)],
  };
}

export function applicationOperationsRedactedAuditRecords(
  rows: readonly unknown[],
  search?: string,
): readonly ApplicationOperationsPublicRecord[] {
  const needle = search?.trim().toLowerCase();
  if (needle && needle.length > 200) {
    throw new Error('Operations audit search must not exceed 200 characters.');
  }
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const document = isRecord(value.document) ? value.document : {};
    const principal = isRecord(document.principal) ? document.principal : {};
    const searchable = [
      value.id, document.kind, document.operationId, document.targetDigest,
      principal.id, principal.subject,
    ].filter((candidate): candidate is string => typeof candidate === 'string');
    if (needle && !searchable.some((candidate) => candidate.toLowerCase().includes(needle))) {
      return [];
    }
    const id = firstPublicString(value, ['id']) ?? 'audit:unknown';
    const kind = firstPublicString(document, ['kind']) ?? 'audit.recorded';
    const observedAt = firstPublicString(value, ['occurredAt', 'occurred_at'])
      ?? firstPublicString(document, ['occurredAt']);
    const record: ApplicationOperationsPublicRecord = Object.freeze({
      category: 'audit',
      id,
      label: kind,
      state: 'recorded',
      authority: 'canonical',
      ...(observedAt ? { observedAt } : {}),
    });
    return [record];
  });
}

function firstPublicString(
  row: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function publicAuthority(
  value: unknown,
): ApplicationOperationsPublicRecord['authority'] | undefined {
  return value === 'canonical' || value === 'delivery' || value === 'provider' || value === 'inferred'
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
