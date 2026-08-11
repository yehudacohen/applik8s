import { createHash } from 'node:crypto';
import type { JsonObject } from '@applik8s/core';

export type ApplicationDeploymentReceiptAction =
  | 'doctor'
  | 'plan'
  | 'deploy'
  | 'status'
  | 'recovery';

export interface ApplicationDeploymentEvidenceReceipt {
  readonly apiVersion: 'applik8s.deploymentEvidence/v1alpha1';
  readonly kind: 'ApplicationDeploymentEvidenceReceipt';
  readonly id: string;
  readonly action: ApplicationDeploymentReceiptAction;
  readonly state: 'ready' | 'action-required' | 'unknown';
  readonly sourceGraphDigest: string;
  readonly deploymentGraphDigest: string;
  readonly artifactSetDigest: string;
  readonly installation: {
    readonly application: string;
    readonly namespace: string;
    readonly name: string;
    readonly profile: string;
  };
  readonly cluster: {
    readonly provider: string;
    readonly identity: string;
    readonly digest: string;
  };
  readonly schemaRevision: 1;
  readonly observedAt: string;
  readonly expiresAt: string;
  readonly evidence: JsonObject;
  readonly integrity: {
    readonly algorithm: 'sha256';
    readonly digest: string;
  };
}

export type ApplicationDeploymentEvidenceReceiptInput = Omit<
  ApplicationDeploymentEvidenceReceipt,
  'apiVersion' | 'kind' | 'schemaRevision' | 'integrity'
>;

export function createApplicationDeploymentEvidenceReceipt(
  input: ApplicationDeploymentEvidenceReceiptInput,
): ApplicationDeploymentEvidenceReceipt {
  const unsigned: Omit<ApplicationDeploymentEvidenceReceipt, 'integrity'> = {
    apiVersion: 'applik8s.deploymentEvidence/v1alpha1',
    kind: 'ApplicationDeploymentEvidenceReceipt',
    ...input,
    schemaRevision: 1,
  };
  validateUnsignedReceipt(unsigned);
  const receipt: ApplicationDeploymentEvidenceReceipt = {
    ...unsigned,
    integrity: {
      algorithm: 'sha256',
      digest: digest(unsigned),
    },
  };
  return Object.freeze(receipt);
}

export function validateApplicationDeploymentEvidenceReceipt(
  value: ApplicationDeploymentEvidenceReceipt,
  expected?: {
    readonly application?: string;
    readonly sourceGraphDigest?: string;
    readonly deploymentGraphDigest?: string;
    readonly clusterDigest?: string;
    readonly installationName?: string;
    readonly installationNamespace?: string;
    readonly now?: Date;
  },
): ApplicationDeploymentEvidenceReceipt {
  if (
    value.apiVersion !== 'applik8s.deploymentEvidence/v1alpha1'
    || value.kind !== 'ApplicationDeploymentEvidenceReceipt'
    || value.schemaRevision !== 1
  ) {
    throw new Error('Unsupported application deployment evidence receipt schema.');
  }
  const { integrity, ...unsigned } = value;
  validateUnsignedReceipt(unsigned);
  if (integrity.algorithm !== 'sha256' || integrity.digest !== digest(unsigned)) {
    throw new Error(`Deployment evidence receipt ${value.id} failed its integrity check.`);
  }
  const mismatches = [
    expected?.application && expected.application !== value.installation.application
      ? 'application'
      : undefined,
    expected?.sourceGraphDigest && expected.sourceGraphDigest !== value.sourceGraphDigest
      ? 'source graph'
      : undefined,
    expected?.deploymentGraphDigest && expected.deploymentGraphDigest !== value.deploymentGraphDigest
      ? 'deployment graph'
      : undefined,
    expected?.clusterDigest && expected.clusterDigest !== value.cluster.digest
      ? 'cluster'
      : undefined,
    expected?.installationName && expected.installationName !== value.installation.name
      ? 'installation name'
      : undefined,
    expected?.installationNamespace && expected.installationNamespace !== value.installation.namespace
      ? 'installation namespace'
      : undefined,
  ].filter((entry): entry is string => Boolean(entry));
  if (mismatches.length > 0) {
    throw new Error(`Deployment evidence receipt ${value.id} does not match the authorized ${mismatches.join(', ')} context.`);
  }
  const now = expected?.now ?? new Date();
  if (Date.parse(value.expiresAt) <= now.getTime()) {
    throw new Error(`Deployment evidence receipt ${value.id} is stale.`);
  }
  return value;
}

function validateUnsignedReceipt(
  value: Omit<ApplicationDeploymentEvidenceReceipt, 'integrity'>,
): void {
  const identityFields: readonly (readonly [string, string])[] = [
    ['id', value.id],
    ['application', value.installation.application],
    ['namespace', value.installation.namespace],
    ['installation name', value.installation.name],
    ['profile', value.installation.profile],
    ['cluster provider', value.cluster.provider],
    ['cluster identity', value.cluster.identity],
  ];
  for (const [label, candidate] of identityFields) {
    if (!candidate.trim()) throw new Error(`Deployment evidence receipt ${label} must be non-empty.`);
  }
  const digestFields: readonly (readonly [string, string])[] = [
    ['source graph', value.sourceGraphDigest],
    ['deployment graph', value.deploymentGraphDigest],
    ['artifact set', value.artifactSetDigest],
    ['cluster', value.cluster.digest],
  ];
  for (const [label, candidate] of digestFields) {
    if (!/^sha256:[a-f0-9]{64}$/.test(candidate)) {
      throw new Error(`Deployment evidence receipt ${label} digest must be a full sha256 digest.`);
    }
  }
  const observedAt = Date.parse(value.observedAt);
  const expiresAt = Date.parse(value.expiresAt);
  if (
    Number.isNaN(observedAt)
    || Number.isNaN(expiresAt)
    || expiresAt <= observedAt
    || expiresAt - observedAt > 24 * 60 * 60 * 1_000
  ) {
    throw new Error('Deployment evidence receipt requires a valid bounded observation window no longer than 24h.');
  }
  assertActionEvidence(value.action, value.evidence);
}

const evidenceFieldsByAction = {
  doctor: new Set([
    'passedCount',
    'warningCount',
    'failureCount',
    'clusterReachable',
  ]),
  plan: new Set([
    'resourceCount',
    'pendingChangeCount',
    'declarationCount',
    'strategy',
  ]),
  deploy: new Set([
    'resourceCount',
    'appliedArtifactCount',
    'declarationCount',
    'instanceState',
    'endpointObserved',
  ]),
  status: new Set([
    'instanceState',
    'definitionState',
    'resourceCount',
    'pendingChangeCount',
    'declarationCount',
  ]),
  recovery: new Set([
    'operation',
    'resourceCount',
    'resumed',
    'completed',
  ]),
} satisfies Readonly<Record<ApplicationDeploymentReceiptAction, ReadonlySet<string>>>;

function assertActionEvidence(
  action: ApplicationDeploymentReceiptAction,
  evidence: JsonObject,
): void {
  const allowed = evidenceFieldsByAction[action];
  for (const [key, value] of Object.entries(evidence)) {
    if (!allowed.has(key)) {
      throw new Error(
        `Deployment evidence receipt action ${action} does not permit public evidence field ${key}.`,
      );
    }
    if (
      value !== null
      && typeof value !== 'string'
      && typeof value !== 'number'
      && typeof value !== 'boolean'
    ) {
      throw new Error(
        `Deployment evidence receipt field evidence.${key} must be a bounded scalar.`,
      );
    }
  }
  assertPublicJson(evidence, 'evidence');
}

function assertPublicJson(value: unknown, path: string): void {
  if (typeof value === 'string') {
    if (/password|secret|token|credential|private.?key|authorization/i.test(path)) {
      throw new Error(`Deployment evidence receipt cannot include sensitive field ${path}.`);
    }
    if (value.length > 2_048) throw new Error(`Deployment evidence receipt ${path} exceeds 2048 characters.`);
    return;
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return;
  if (Array.isArray(value)) {
    if (value.length > 100) throw new Error(`Deployment evidence receipt ${path} exceeds 100 entries.`);
    value.forEach((entry, index) => {
      assertPublicJson(entry, `${path}[${index}]`);
    });
    return;
  }
  if (!value || typeof value !== 'object') {
    throw new Error(`Deployment evidence receipt ${path} is not public JSON.`);
  }
  const entries = Object.entries(value);
  if (entries.length > 100) throw new Error(`Deployment evidence receipt ${path} exceeds 100 fields.`);
  for (const [key, entry] of entries) {
    if (/password|secret|token|credential|private.?key|authorization/i.test(key)) {
      throw new Error(`Deployment evidence receipt cannot include sensitive field ${path}.${key}.`);
    }
    assertPublicJson(entry, `${path}.${key}`);
  }
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

export function applicationDeploymentEvidenceDigest(value: unknown): string {
  return digest(value);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
