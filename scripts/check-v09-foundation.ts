// typecast-file-boundary: The checked-in foundation manifest is untrusted JSON
// until this release gate validates its complete machine shape.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

interface ReleasedBaseline {
  readonly status: 'unavailable' | 'exact-release';
  readonly npmVersion: string | null;
  readonly gitTag: string | null;
  readonly commit: string | null;
  readonly applicationGraphSchema: string | null;
  readonly applicationPlanSchema: string | null;
  readonly providerCatalogDigest: string | null;
  readonly runtimeProtocolVersions: readonly string[];
  readonly evidenceManifest: string | null;
}

interface FoundationGate {
  readonly id: string;
  readonly implemented: boolean;
  readonly blocking: boolean;
  readonly diagnostic: string;
}

interface FoundationManifest {
  readonly schemaVersion: 1;
  readonly release: '0.9.0';
  readonly status: 'foundation-in-progress' | 'foundation-ready';
  readonly sourceCandidate: {
    readonly packageVersion: '0.9.0';
    readonly commit: string | null;
    readonly qualification: 'working-tree-unqualified' | 'exact-commit-qualified';
  };
  readonly releasedBaseline: ReleasedBaseline;
  readonly deploymentStateWrites: {
    readonly allowed: boolean;
    readonly blockedBy?: string;
  };
  readonly publicContractInventory: 'v0.9-public-contract.json';
  readonly contracts: readonly {
    readonly id: string;
    readonly package: string;
    readonly entrypoint: string;
    readonly symbol: string;
    readonly schemaVersion: string;
    readonly maturity: string;
    readonly owner: string;
    readonly evidence: readonly string[];
  }[];
  readonly foundationGates: readonly FoundationGate[];
}

const execFileAsync = promisify(execFile);
const requireDeploymentWrites = process.argv.includes('--require-deployment-writes');
const manifest = JSON.parse(await readFile('docs/v0.9-foundation.json', 'utf8')) as FoundationManifest;
const baselineFixture = JSON.parse(
  await readFile('docs/v071-deployment-migration-baseline.json', 'utf8'),
) as {
  readonly release: string;
  readonly gitTag: string;
  readonly commit: string;
  readonly providerCatalog: {
    readonly digest: string;
    readonly files: readonly { readonly path: string; readonly sha256: string }[];
  };
  readonly stateContracts: readonly { readonly path: string; readonly sha256: string }[];
  readonly evidenceManifest: { readonly path: string; readonly sha256: string };
};
const publicContractInventory = JSON.parse(
  await readFile(`docs/${manifest.publicContractInventory}`, 'utf8'),
) as {
  readonly schemaVersion?: number;
  readonly release?: string;
  readonly status?: string;
  readonly packages?: readonly {
    readonly name?: string;
    readonly contract?: {
      readonly owner?: string;
      readonly maturity?: string;
      readonly compatibility?: readonly string[];
      readonly stability?: string;
      readonly documentation?: string;
      readonly evidence?: readonly string[];
    };
    readonly replacement?: { readonly status?: string };
    readonly entrypoints?: readonly {
      readonly kind?: 'module' | 'side-effect';
      readonly contract?: { readonly inherits?: string; readonly override?: string };
      readonly symbols?: readonly string[];
      readonly symbolContract?: { readonly inherits?: string };
    }[];
  }[];
  readonly diagnostics?: readonly {
    readonly code?: string;
    readonly owner?: string;
    readonly maturity?: string;
    readonly compatibility?: readonly string[];
    readonly stability?: string;
    readonly documentation?: string;
    readonly evidence?: readonly string[];
  }[];
  readonly cli?: {
    readonly commands?: readonly unknown[];
    readonly options?: readonly unknown[];
  };
  readonly environmentVariables?: readonly unknown[];
  readonly contracts?: readonly { readonly id?: string }[];
};
const findings: string[] = [];

if (manifest.schemaVersion !== 1 || manifest.release !== '0.9.0') {
  findings.push('V09_FOUNDATION_IDENTITY_INVALID: the foundation manifest identity is invalid.');
}
if (manifest.sourceCandidate.packageVersion !== '0.9.0') {
  findings.push('V09_SOURCE_CANDIDATE_INVALID: source-candidate packages must identify v0.9.0.');
}
if (manifest.sourceCandidate.commit !== null && !/^[a-f0-9]{40}$/u.test(manifest.sourceCandidate.commit)) {
  findings.push('V09_SOURCE_CANDIDATE_INVALID: qualified source-candidate commit must be a complete Git hash.');
} else if (manifest.sourceCandidate.commit && !(await gitObjectExists(manifest.sourceCandidate.commit))) {
  findings.push(`V09_SOURCE_CANDIDATE_MISSING: commit ${manifest.sourceCandidate.commit} is unavailable.`);
}
if ((manifest.sourceCandidate.commit === null) !== (manifest.sourceCandidate.qualification === 'working-tree-unqualified')) {
  findings.push('V09_SOURCE_CANDIDATE_INVALID: only exact-commit candidates may carry an immutable commit.');
}
if (
  manifest.publicContractInventory !== 'v0.9-public-contract.json'
  || publicContractInventory.schemaVersion !== 1
  || publicContractInventory.release !== manifest.release
  || !['candidate-review-ready', 'frozen'].includes(publicContractInventory.status ?? '')
  || (publicContractInventory.packages?.length ?? 0) === 0
  || (publicContractInventory.diagnostics?.length ?? 0) === 0
  || (publicContractInventory.cli?.commands?.length ?? 0) === 0
  || (publicContractInventory.cli?.options?.length ?? 0) === 0
  || (publicContractInventory.environmentVariables?.length ?? 0) === 0
) {
  findings.push('PUBLIC_CONTRACT_INVENTORY_INCOMPLETE: package, export, symbol, diagnostic, or release identity is missing.');
}
for (const entry of publicContractInventory.packages ?? []) {
  const contract = entry.contract;
  if (
    !entry.name
    || !contract?.owner
    || !contract.maturity
    || !contract.stability
    || !contract.documentation
    || (contract.compatibility?.length ?? 0) === 0
    || (contract.evidence?.length ?? 0) === 0
    || entry.replacement?.status !== 'canonical'
  ) {
    findings.push(`PUBLIC_CONTRACT_PACKAGE_UNDISPOSITIONED: ${entry.name ?? '<unknown>'}.`);
  }
  for (const entrypoint of entry.entrypoints ?? []) {
    if (
      (!entrypoint.contract?.inherits && !entrypoint.contract?.override)
      || !entrypoint.symbolContract?.inherits
      || (!entrypoint.kind || (entrypoint.kind === 'module' && (entrypoint.symbols?.length ?? 0) === 0))
    ) {
      findings.push(`PUBLIC_CONTRACT_ENTRYPOINT_UNDISPOSITIONED: ${entry.name ?? '<unknown>'}.`);
    }
  }
}
for (const diagnostic of publicContractInventory.diagnostics ?? []) {
  if (
    !diagnostic.code
    || !diagnostic.owner
    || !diagnostic.maturity
    || !diagnostic.stability
    || !diagnostic.documentation
    || (diagnostic.compatibility?.length ?? 0) === 0
    || (diagnostic.evidence?.length ?? 0) === 0
  ) {
    findings.push(`PUBLIC_CONTRACT_DIAGNOSTIC_UNDISPOSITIONED: ${diagnostic.code ?? '<unknown>'}.`);
  }
}

const gateIds = new Set<string>();
for (const gate of manifest.foundationGates) {
  if (!gate.id || gateIds.has(gate.id)) findings.push(`V09_FOUNDATION_GATE_INVALID: gate ${gate.id || '<empty>'} is duplicated.`);
  gateIds.add(gate.id);
  if (!gate.diagnostic || !/^[A-Z][A-Z0-9_]+$/u.test(gate.diagnostic)) {
    findings.push(`V09_FOUNDATION_GATE_INVALID: gate ${gate.id} lacks a stable diagnostic code.`);
  }
}
for (const required of [
  'exact-v0.7.1-baseline',
  'effect-contract-schemas',
  'public-contract-inventory',
  'profile-resolver-plan-schema',
  'concrete-provider-configuration-foundation',
  'read-only-v0.7.1-migration-proposal',
  'v0.7.1-migration-execution',
  'minimal-journey-runner',
  'documentation-skeleton',
  'clean-context-alpha-1',
]) {
  if (!gateIds.has(required)) findings.push(`V09_FOUNDATION_GATE_MISSING: ${required}.`);
}

const contractIds = new Set<string>();
for (const contract of manifest.contracts) {
  if (!contract.id || contractIds.has(contract.id)) findings.push(`PUBLIC_CONTRACT_DUPLICATED: ${contract.id || '<empty>'}.`);
  contractIds.add(contract.id);
  if (!contract.package.startsWith('@applik8s/') || !contract.symbol || !contract.owner || contract.evidence.length === 0) {
    findings.push(`PUBLIC_CONTRACT_INCOMPLETE: ${contract.id}.`);
  }
}
for (const required of [
  'effect-contract',
  'effect-receipt',
  'implementation-identity',
  'implementation-plan',
  'assembly-profile-definition',
  'implementation-plan-set',
  'capability-implementation',
  'configuration-binding',
  'journey-definition',
  'journey-result',
  'deployment-migration-proposal',
]) {
  if (!contractIds.has(required)) findings.push(`PUBLIC_CONTRACT_MISSING: ${required}.`);
  if (!publicContractInventory.contracts?.some(({ id }) => id === required)) {
    findings.push(`PUBLIC_CONTRACT_INVENTORY_INCOMPLETE: generated inventory lacks ${required}.`);
  }
}

validateBaseline(manifest.releasedBaseline, findings);
await validateBaselineFixture(manifest.releasedBaseline, baselineFixture, findings);
const exactBaseline = manifest.releasedBaseline.status === 'exact-release';
const migrationProposalReady = manifest.foundationGates.some(
  ({ id, implemented }) => id === 'read-only-v0.7.1-migration-proposal' && implemented,
);
const migrationExecutionReady = manifest.foundationGates.some(
  ({ id, implemented }) => id === 'v0.7.1-migration-execution' && implemented,
);
const deploymentWritesReady = exactBaseline && migrationProposalReady && migrationExecutionReady;
const foundationReady = manifest.foundationGates
  .filter(({ blocking }) => blocking)
  .every(({ implemented }) => implemented);
if (manifest.deploymentStateWrites.allowed !== deploymentWritesReady) {
  findings.push('V09_DEPLOYMENT_WRITE_POLICY_INVALID: deployment-state writes require the exact baseline, read-only proposal, and migration-execution evidence.');
}
if (!exactBaseline && manifest.deploymentStateWrites.blockedBy !== 'V09_BASELINE_RELEASE_UNAVAILABLE') {
  findings.push('V09_DEPLOYMENT_WRITE_POLICY_INVALID: unavailable baseline requires the stable blocking diagnostic.');
}
if (exactBaseline && !deploymentWritesReady && manifest.deploymentStateWrites.blockedBy !== 'V09_MIGRATION_EXECUTION_UNQUALIFIED') {
  findings.push('V09_DEPLOYMENT_WRITE_POLICY_INVALID: an exact baseline without execution evidence must retain the migration-execution blocker.');
}
if (exactBaseline && !foundationReady && manifest.status !== 'foundation-in-progress') {
  findings.push('V09_FOUNDATION_STATUS_INVALID: a partially implemented exact-release foundation must remain in progress.');
}
if (foundationReady && manifest.status !== 'foundation-ready') {
  findings.push('V09_FOUNDATION_STATUS_INVALID: all blocking gates are implemented but status is not foundation-ready.');
}
if (requireDeploymentWrites && !deploymentWritesReady) {
  findings.push(
    exactBaseline
      ? 'V09_MIGRATION_EXECUTION_UNQUALIFIED: deployment-state writes remain blocked until the exact v0.7.1 fixture proves fenced handoff, interruption recovery, and deletion.'
      : 'V09_BASELINE_RELEASE_UNAVAILABLE: deployment-state work is blocked until the exact released v0.7.1 package, tag, schema, catalog, runtime, and evidence baseline is recorded.',
  );
}

if (findings.length > 0) {
  throw new Error(`v0.9 foundation check failed:\n${findings.map((finding) => `- ${finding}`).join('\n')}`);
}

console.log(JSON.stringify({
  release: manifest.release,
  status: manifest.status,
  releasedBaseline: manifest.releasedBaseline.status,
  deploymentStateWrites: manifest.deploymentStateWrites.allowed ? 'allowed' : 'blocked',
  contracts: manifest.contracts.length,
  gates: manifest.foundationGates.length,
  implementedGates: manifest.foundationGates.filter(({ implemented }) => implemented).length,
}, null, 2));

function validateBaseline(baseline: ReleasedBaseline, output: string[]): void {
  const coordinates = [
    baseline.npmVersion,
    baseline.gitTag,
    baseline.commit,
    baseline.applicationGraphSchema,
    baseline.applicationPlanSchema,
    baseline.providerCatalogDigest,
    baseline.evidenceManifest,
  ];
  if (baseline.status === 'unavailable') {
    if (coordinates.some((coordinate) => coordinate !== null) || baseline.runtimeProtocolVersions.length > 0) {
      output.push('V09_BASELINE_PARTIAL: an unavailable baseline cannot contain release coordinates that look qualified.');
    }
    return;
  }
  if (coordinates.some((coordinate) => !coordinate?.trim()) || baseline.runtimeProtocolVersions.length === 0) {
    output.push('V09_BASELINE_INCOMPLETE: an exact release requires every package/artifact/plan/catalog/runtime/evidence coordinate.');
  }
  if (baseline.npmVersion !== '0.7.1' || baseline.gitTag !== 'v0.7.1') {
    output.push('V09_BASELINE_IDENTITY_INVALID: the migration baseline must be the exact v0.7.1 release.');
  }
  if (!baseline.commit || !/^[a-f0-9]{40}$/u.test(baseline.commit)) {
    output.push('V09_BASELINE_COMMIT_INVALID: exact release commit must be a complete Git hash.');
  }
  if (!baseline.providerCatalogDigest?.match(/^sha256:[a-f0-9]{64}$/u)) {
    output.push('V09_BASELINE_CATALOG_INVALID: provider catalog requires a full sha256 digest.');
  }
}

async function validateBaselineFixture(
  baseline: ReleasedBaseline,
  fixture: typeof baselineFixture,
  output: string[],
): Promise<void> {
  if (
    fixture.release !== baseline.npmVersion
    || fixture.gitTag !== baseline.gitTag
    || fixture.commit !== baseline.commit
    || fixture.providerCatalog.digest !== baseline.providerCatalogDigest
    || `${fixture.evidenceManifest.path}#sha256:${fixture.evidenceManifest.sha256}` !== baseline.evidenceManifest
  ) {
    output.push('V09_BASELINE_FIXTURE_MISMATCH: the executable baseline and foundation coordinates differ.');
    return;
  }
  const records: { readonly path: string; readonly record: string }[] = [];
  for (const expected of [...fixture.providerCatalog.files, ...fixture.stateContracts]) {
    const source = await gitFile(fixture.gitTag, expected.path);
    const actual = sha256(source);
    if (actual !== expected.sha256) {
      output.push(`V09_BASELINE_FIXTURE_HASH_INVALID: ${expected.path} expected ${expected.sha256}, observed ${actual}.`);
    }
    if (fixture.providerCatalog.files.some(({ path }) => path === expected.path)) {
      records.push({ path: expected.path, record: `${actual}  ${expected.path}\n` });
    }
  }
  const catalogDigest = `sha256:${sha256(records.sort((left, right) => left.path.localeCompare(right.path)).map(({ record }) => record).join(''))}`;
  if (catalogDigest !== fixture.providerCatalog.digest) {
    output.push(`V09_BASELINE_CATALOG_INVALID: expected ${fixture.providerCatalog.digest}, observed ${catalogDigest}.`);
  }
  const evidence = sha256(await gitFile(fixture.gitTag, fixture.evidenceManifest.path));
  if (evidence !== fixture.evidenceManifest.sha256) {
    output.push(`V09_BASELINE_EVIDENCE_INVALID: expected ${fixture.evidenceManifest.sha256}, observed ${evidence}.`);
  }
}

async function gitFile(revision: string, path: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['show', `${revision}:${path}`], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function gitObjectExists(revision: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['cat-file', '-e', `${revision}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}
