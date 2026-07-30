import { access, readFile } from 'node:fs/promises';
import { applicationAgenticStartDefinition } from '@applik8s/start-agentic';

type ScorecardState =
  | 'complete'
  | 'partial'
  | 'pending'
  | 'blocked'
  | 'deferred';

interface ScorecardItem {
  readonly id: string;
  readonly owner: string;
  readonly state: ScorecardState;
  readonly evidence: readonly string[];
}

interface V07Scorecard {
  readonly apiVersion: 'applik8s.releaseScorecard/v1alpha1';
  readonly release: 'v0.7';
  readonly releaseAuthorized: boolean;
  readonly baseline: {
    readonly repository: string;
    readonly revision: string;
    readonly inventory: string;
  };
  readonly compatibility: Readonly<Record<string, string>>;
  readonly items: readonly ScorecardItem[];
}

const requireRelease = process.argv.includes('--require-release');
const scorecard = parseScorecard(
  JSON.parse(await readFile('docs/v0.7-scorecard.json', 'utf8')),
);
const findings: string[] = [];
const itemIds = new Set<string>();

if (scorecard.releaseAuthorized) {
  findings.push(
    'releaseAuthorized must remain false until the maintainer explicitly authorizes v0.7.0.',
  );
}
if (scorecard.baseline.revision !== '602ec975f7c29c9e2faa7b767ec218745590c7cf') {
  findings.push('The pinned Stimp baseline revision changed without a reviewed inventory update.');
}
if (
  scorecard.compatibility.typekro
    !== applicationAgenticStartDefinition.compatibility.typekro
) {
  findings.push('The scorecard and Agentic Start disagree about the TypeKro compatibility version.');
}
if (
  scorecard.compatibility.tanstackCli
    !== applicationAgenticStartDefinition.compatibility.tanstackCli
) {
  findings.push('The scorecard and Agentic Start disagree about the official TanStack CLI pin.');
}
if (
  applicationAgenticStartDefinition.generator.files.length
    > applicationAgenticStartDefinition.generator.maximumApplicationFiles
) {
  findings.push('The Agentic Start exceeds its declared generated-file budget.');
}

for (const item of scorecard.items) {
  if (itemIds.has(item.id)) {
    findings.push(`Duplicate scorecard item ${item.id}.`);
  }
  itemIds.add(item.id);
  if (!item.owner.trim()) {
    findings.push(`Scorecard item ${item.id} has no owner.`);
  }
  if (item.state === 'complete' && item.evidence.length === 0) {
    findings.push(`Complete scorecard item ${item.id} has no evidence.`);
  }
  for (const path of item.evidence) {
    try {
      await access(path);
    } catch {
      findings.push(`Scorecard item ${item.id} references missing evidence ${path}.`);
    }
  }
  if (
    requireRelease
    && item.state !== 'complete'
    && item.state !== 'deferred'
  ) {
    findings.push(
      `Release gate rejects ${item.id}: state is ${item.state}.`,
    );
  }
}

const requiredItems = [
  'baseline-disposition',
  'operation-authority',
  'provider-native-models',
  'ai-tanstack-contract',
  'identity-oauth-contract',
  'mcp-contract',
  'search-contract',
  'maintained-modules-and-operations-ui',
  'agentic-start-generator',
  'starter-profile',
  'dedicated-profile',
  'external-profile',
  'vasco-acceptance',
  'agentic-identity-acceptance',
  'stimp-behavioral-parity',
  'packed-agentic-start-consumer',
  'typekro-provider-qualification',
  'integrated-orbstack-lifecycle',
  'browser-security-matrix',
  'v07-performance-history',
] as const;
for (const id of requiredItems) {
  if (!itemIds.has(id)) findings.push(`Required scorecard item ${id} is missing.`);
}

if (findings.length > 0) {
  throw new Error(
    `v0.7 scorecard failed:\n${findings.map((finding) => `- ${finding}`).join('\n')}`,
  );
}

const states = Object.fromEntries(
  ['complete', 'partial', 'pending', 'blocked', 'deferred'].map((state) => [
    state,
    scorecard.items.filter((item) => item.state === state).length,
  ]),
);
console.log(
  JSON.stringify(
    {
      release: scorecard.release,
      mode: requireRelease ? 'release' : 'contract',
      states,
      generatedFiles:
        applicationAgenticStartDefinition.generator.files.length,
      maximumGeneratedFiles:
        applicationAgenticStartDefinition.generator.maximumApplicationFiles,
    },
    null,
    2,
  ),
);

function parseScorecard(value: unknown): V07Scorecard {
  if (!value || typeof value !== 'object') {
    throw new Error('v0.7 scorecard must be an object.');
  }
  const record = value as Record<string, unknown>;
  if (
    record.apiVersion !== 'applik8s.releaseScorecard/v1alpha1'
    || record.release !== 'v0.7'
    || typeof record.releaseAuthorized !== 'boolean'
    || !record.baseline
    || typeof record.baseline !== 'object'
    || !record.compatibility
    || typeof record.compatibility !== 'object'
    || !Array.isArray(record.items)
  ) {
    throw new Error('v0.7 scorecard has an unsupported top-level contract.');
  }
  const baseline = record.baseline as Record<string, unknown>;
  if (
    typeof baseline.repository !== 'string'
    || typeof baseline.revision !== 'string'
    || typeof baseline.inventory !== 'string'
  ) {
    throw new Error('v0.7 scorecard baseline is invalid.');
  }
  const items = record.items.map((item, index): ScorecardItem => {
    if (!item || typeof item !== 'object') {
      throw new Error(`v0.7 scorecard item ${index} must be an object.`);
    }
    const candidate = item as Record<string, unknown>;
    if (
      typeof candidate.id !== 'string'
      || typeof candidate.owner !== 'string'
      || !scorecardState(candidate.state)
      || !Array.isArray(candidate.evidence)
      || !candidate.evidence.every((path) => typeof path === 'string')
    ) {
      throw new Error(`v0.7 scorecard item ${index} is invalid.`);
    }
    return {
      id: candidate.id,
      owner: candidate.owner,
      state: candidate.state,
      evidence: candidate.evidence,
    };
  });
  return {
    apiVersion: record.apiVersion,
    release: record.release,
    releaseAuthorized: record.releaseAuthorized,
    baseline: {
      repository: baseline.repository,
      revision: baseline.revision,
      inventory: baseline.inventory,
    },
    compatibility: Object.fromEntries(
      Object.entries(record.compatibility as Record<string, unknown>).map(
        ([key, version]) => {
          if (typeof version !== 'string') {
            throw new Error(`v0.7 compatibility ${key} must be a string.`);
          }
          return [key, version];
        },
      ),
    ),
    items,
  };
}

function scorecardState(value: unknown): value is ScorecardState {
  return (
    value === 'complete'
    || value === 'partial'
    || value === 'pending'
    || value === 'blocked'
    || value === 'deferred'
  );
}
