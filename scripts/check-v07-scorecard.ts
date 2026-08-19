// typecast-file-boundary: The scorecard gate validates repository JSON documents before typed policy evaluation.
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
    readonly id: 'agentic-product-baseline';
    readonly version: 1;
    readonly inventory: string;
  };
  readonly compatibility: Readonly<Record<string, string>>;
  readonly items: readonly ScorecardItem[];
}

interface AcceptanceManifestCapability {
  readonly id: string;
  readonly scorecardItem: string;
  readonly rfpCapability: string;
  readonly acceptanceApplication: 'Chirp';
  readonly evidenceScripts: readonly string[];
  readonly sourceAssertions: readonly {
    readonly path: string;
    readonly includes: string;
  }[];
}

interface V07AcceptanceManifest {
  readonly apiVersion: 'applik8s.acceptanceManifest/v1alpha1';
  readonly release: 'v0.7';
  readonly capabilities: readonly AcceptanceManifestCapability[];
}

const requireRelease = process.argv.includes('--require-release');
const scorecard = parseScorecard(
  JSON.parse(await readFile('docs/v0.7-scorecard.json', 'utf8')),
);
const narrativeScorecard = await readFile('docs/v0.7-scorecard.md', 'utf8');
const functionNativeRfp = await readFile(
  'docs/rfp-v07-function-native-execution.md',
  'utf8',
);
const acceptanceManifest = parseAcceptanceManifest(
  JSON.parse(await readFile('docs/v07-acceptance-manifest.json', 'utf8')),
);
const packageManifest = JSON.parse(await readFile('package.json', 'utf8')) as {
  readonly scripts?: Readonly<Record<string, string>>;
};
const findings: string[] = [];
const itemIds = new Set<string>();
const acceptedPlanningDocuments = [
  'docs/charter-v07-agentic-platform.md',
  'docs/rfp-v07-agentic-start-distribution.md',
  'docs/rfp-v07-ai-runtime.md',
  'docs/rfp-v07-function-native-execution.md',
  'docs/rfp-v07-identity-and-oauth.md',
  'docs/rfp-v07-mcp.md',
  'docs/rfp-v07-operation-authority.md',
  'docs/rfp-v07-profiles-and-starts.md',
  'docs/rfp-v07-search-projections.md',
] as const;

for (const path of acceptedPlanningDocuments) {
  const contents = await readFile(path, 'utf8');
  if (!/^\*\*Status:\*\* Accepted/mu.test(contents)) {
    findings.push(`${path} is release-normative but is not marked Accepted.`);
  }
  if (/^## Open questions/mu.test(contents)) {
    findings.push(`${path} retains unresolved open questions.`);
  }
}

if (requireRelease && !scorecard.releaseAuthorized) {
  findings.push(
    'releaseAuthorized must be true after the maintainer explicitly authorizes the v0.7 release candidate.',
  );
}
if (
  scorecard.baseline.id !== 'agentic-product-baseline'
  || scorecard.baseline.version !== 1
) {
  findings.push(
    'The Agentic product baseline identity changed without a reviewed inventory update.',
  );
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
  requireRelease
  && /^\| [^|\n]+ \| (?:Partial|Pending|Blocked)(?: at contract level)? \|/mu.test(
    narrativeScorecard,
  )
) {
  findings.push(
    'The human-readable v0.7 scorecard still claims a partial, pending, or blocked dimension.',
  );
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

const scorecardById = new Map(scorecard.items.map((item) => [item.id, item]));
for (const capability of acceptanceManifest.capabilities) {
  const item = scorecardById.get(capability.scorecardItem);
  if (!item) {
    findings.push(
      `Acceptance capability ${capability.id} references missing scorecard item ${capability.scorecardItem}.`,
    );
    continue;
  }
  const rfpRow = functionNativeConformanceRow(
    functionNativeRfp,
    capability.rfpCapability,
  );
  if (!rfpRow) {
    findings.push(
      `Acceptance capability ${capability.id} references missing function-native RFP row ${capability.rfpCapability}.`,
    );
  } else if ((item.state === 'complete') !== (rfpRow.chirp === 'Yes')) {
    findings.push(
      `Acceptance capability ${capability.id} disagrees: scorecard=${item.state}, RFP Chirp=${rfpRow.chirp}.`,
    );
  }
  for (const script of capability.evidenceScripts) {
    if (!packageManifest.scripts?.[script]) {
      findings.push(
        `Acceptance capability ${capability.id} references missing package script ${script}.`,
      );
    }
  }
  for (const assertion of capability.sourceAssertions) {
    try {
      const source = await readFile(assertion.path, 'utf8');
      if (!source.includes(assertion.includes)) {
        findings.push(
          `Acceptance capability ${capability.id} source ${assertion.path} is missing ${JSON.stringify(assertion.includes)}.`,
        );
      }
    } catch {
      findings.push(
        `Acceptance capability ${capability.id} references missing source ${assertion.path}.`,
      );
    }
  }
}
const chirpAcceptance = scorecardById.get('chirp-acceptance');
if (
  chirpAcceptance?.state === 'complete'
  && acceptanceManifest.capabilities.some(
    (capability) => scorecardById.get(capability.scorecardItem)?.state !== 'complete',
  )
) {
  findings.push(
    'Chirp acceptance cannot be complete while a manifest-owned Chirp capability remains incomplete.',
  );
}

const requiredItems = [
  'baseline-disposition',
  'operation-authority',
  'universal-causal-attribution',
  'generated-route-reproducibility',
  'provider-native-models',
  'function-native-model-transactions',
  'frozen-stream-batches',
  'typed-durable-signals',
  'resource-workflow-tracking',
  'ai-tanstack-contract',
  'identity-oauth-contract',
  'mcp-contract',
  'search-contract',
  'maintained-modules-and-operations-ui',
  'agentic-start-generator',
  'starter-profile',
  'dedicated-profile',
  'external-profile',
  'chirp-acceptance',
  'guestbook-acceptance',
  'agentic-identity-acceptance',
  'agentic-product-baseline',
  'packed-agentic-start-consumer',
  'typekro-provider-qualification',
  'integrated-orbstack-lifecycle',
  'browser-security-matrix',
  'v07-performance-history',
  'planning-authority-consistency',
  'function-native-one-shot-query',
  'public-admission-and-notification',
  'operator-launchpad-authority',
  'start-lineage-update-check',
  'product-data-lifecycle-and-ai-trust',
  'cross-browser-product-quality',
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
      legacyMaximumGeneratedFilesDiagnostic:
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
    baseline.id !== 'agentic-product-baseline'
    || baseline.version !== 1
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
      id: baseline.id,
      version: baseline.version,
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

function parseAcceptanceManifest(value: unknown): V07AcceptanceManifest {
  if (!value || typeof value !== 'object') {
    throw new Error('v0.7 acceptance manifest must be an object.');
  }
  const record = value as Record<string, unknown>;
  if (
    record.apiVersion !== 'applik8s.acceptanceManifest/v1alpha1'
    || record.release !== 'v0.7'
    || !Array.isArray(record.capabilities)
  ) {
    throw new Error('v0.7 acceptance manifest has an unsupported top-level contract.');
  }
  const capabilities = record.capabilities.map((value, index): AcceptanceManifestCapability => {
    if (!value || typeof value !== 'object') {
      throw new Error(`v0.7 acceptance capability ${index} must be an object.`);
    }
    const capability = value as Record<string, unknown>;
    const sourceAssertions = capability.sourceAssertions;
    if (
      typeof capability.id !== 'string'
      || typeof capability.scorecardItem !== 'string'
      || typeof capability.rfpCapability !== 'string'
      || capability.acceptanceApplication !== 'Chirp'
      || !Array.isArray(capability.evidenceScripts)
      || !capability.evidenceScripts.every((script) => typeof script === 'string')
      || !Array.isArray(sourceAssertions)
      || !sourceAssertions.every((assertion) =>
        assertion
        && typeof assertion === 'object'
        && typeof Reflect.get(assertion, 'path') === 'string'
        && typeof Reflect.get(assertion, 'includes') === 'string')
    ) {
      throw new Error(`v0.7 acceptance capability ${index} is invalid.`);
    }
    return {
      id: capability.id,
      scorecardItem: capability.scorecardItem,
      rfpCapability: capability.rfpCapability,
      acceptanceApplication: capability.acceptanceApplication,
      evidenceScripts: capability.evidenceScripts as string[],
      sourceAssertions: sourceAssertions as AcceptanceManifestCapability['sourceAssertions'],
    };
  });
  if (new Set(capabilities.map((capability) => capability.id)).size !== capabilities.length) {
    throw new Error('v0.7 acceptance manifest contains duplicate capability IDs.');
  }
  return {
    apiVersion: record.apiVersion,
    release: record.release,
    capabilities,
  };
}

function functionNativeConformanceRow(
  document: string,
  capability: string,
): { readonly chirp: string } | undefined {
  for (const line of document.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells[0] === capability) return { chirp: cells[4] ?? '' };
  }
  return undefined;
}
