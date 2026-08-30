// typecast-file-boundary: The checked-in foundation manifest is untrusted JSON
// until this release gate validates its complete machine shape.
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

interface ReleasedV08Baseline {
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
  readonly release: '0.9.0-alpha.1';
  readonly status: 'blocked-on-v0.8-release' | 'foundation-in-progress' | 'foundation-ready';
  readonly sourceCandidate: {
    readonly packageVersion: '0.8.0';
    readonly commit: string;
    readonly qualification: 'source-candidate-only';
  };
  readonly releasedV08Baseline: ReleasedV08Baseline;
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
const publicContractInventory = JSON.parse(
  await readFile(`docs/${manifest.publicContractInventory}`, 'utf8'),
) as {
  readonly schemaVersion?: number;
  readonly release?: string;
  readonly packages?: readonly unknown[];
  readonly diagnostics?: readonly unknown[];
  readonly contracts?: readonly { readonly id?: string }[];
};
const findings: string[] = [];

if (manifest.schemaVersion !== 1 || manifest.release !== '0.9.0-alpha.1') {
  findings.push('V09_FOUNDATION_IDENTITY_INVALID: the foundation manifest identity is invalid.');
}
if (!/^[a-f0-9]{40}$/u.test(manifest.sourceCandidate.commit)) {
  findings.push('V09_SOURCE_CANDIDATE_INVALID: source-candidate commit must be a complete Git hash.');
} else if (!(await gitObjectExists(manifest.sourceCandidate.commit))) {
  findings.push(`V09_SOURCE_CANDIDATE_MISSING: commit ${manifest.sourceCandidate.commit} is unavailable.`);
}
if (
  manifest.publicContractInventory !== 'v0.9-public-contract.json'
  || publicContractInventory.schemaVersion !== 1
  || publicContractInventory.release !== manifest.release
  || (publicContractInventory.packages?.length ?? 0) === 0
  || (publicContractInventory.diagnostics?.length ?? 0) === 0
) {
  findings.push('PUBLIC_CONTRACT_INVENTORY_INCOMPLETE: package, export, symbol, diagnostic, or release identity is missing.');
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
  'exact-v0.8-baseline',
  'effect-contract-schemas',
  'public-contract-inventory',
  'profile-resolver-plan-schema',
  'concrete-provider-configuration-foundation',
  'read-only-v0.8-migration-proposal',
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

validateBaseline(manifest.releasedV08Baseline, findings);
const exactBaseline = manifest.releasedV08Baseline.status === 'exact-release';
const migrationProposalReady = manifest.foundationGates.some(
  ({ id, implemented }) => id === 'read-only-v0.8-migration-proposal' && implemented,
);
const deploymentWritesReady = exactBaseline && migrationProposalReady;
const foundationReady = manifest.foundationGates
  .filter(({ blocking }) => blocking)
  .every(({ implemented }) => implemented);
if (manifest.deploymentStateWrites.allowed !== deploymentWritesReady) {
  findings.push('V09_DEPLOYMENT_WRITE_POLICY_INVALID: deployment-state writes require both the exact baseline and read-only migration proposal.');
}
if (!exactBaseline && manifest.deploymentStateWrites.blockedBy !== 'V09_BASELINE_RELEASE_UNAVAILABLE') {
  findings.push('V09_DEPLOYMENT_WRITE_POLICY_INVALID: unavailable baseline requires the stable blocking diagnostic.');
}
if (!exactBaseline && manifest.status !== 'blocked-on-v0.8-release') {
  findings.push('V09_FOUNDATION_STATUS_INVALID: an unavailable baseline must remain visibly blocked.');
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
      ? 'V09_MIGRATION_PROPOSAL_UNAVAILABLE: deployment-state work is blocked until the read-only v0.8 logical-to-physical migration proposal is qualified.'
      : 'V09_BASELINE_RELEASE_UNAVAILABLE: deployment-state work is blocked until an exact released v0.8 package, tag, schema, catalog, runtime, and evidence baseline is recorded.',
  );
}

if (findings.length > 0) {
  throw new Error(`v0.9 foundation check failed:\n${findings.map((finding) => `- ${finding}`).join('\n')}`);
}

console.log(JSON.stringify({
  release: manifest.release,
  status: manifest.status,
  releasedV08Baseline: manifest.releasedV08Baseline.status,
  deploymentStateWrites: manifest.deploymentStateWrites.allowed ? 'allowed' : 'blocked',
  contracts: manifest.contracts.length,
  gates: manifest.foundationGates.length,
  implementedGates: manifest.foundationGates.filter(({ implemented }) => implemented).length,
}, null, 2));

function validateBaseline(baseline: ReleasedV08Baseline, output: string[]): void {
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
  if (baseline.npmVersion !== '0.8.0' || baseline.gitTag !== 'v0.8.0') {
    output.push('V09_BASELINE_IDENTITY_INVALID: the initial migration baseline must be the exact v0.8.0 release.');
  }
  if (!baseline.commit || !/^[a-f0-9]{40}$/u.test(baseline.commit)) {
    output.push('V09_BASELINE_COMMIT_INVALID: exact release commit must be a complete Git hash.');
  }
  if (!baseline.providerCatalogDigest?.match(/^sha256:[a-f0-9]{64}$/u)) {
    output.push('V09_BASELINE_CATALOG_INVALID: provider catalog requires a full sha256 digest.');
  }
}

async function gitObjectExists(revision: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['cat-file', '-e', `${revision}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}
