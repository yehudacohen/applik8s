// typecast-file-boundary: checked-in release manifests are untrusted JSON until this gate validates their complete shape.
import { access, readFile } from 'node:fs/promises';

interface Gate {
  readonly id: string;
  readonly maturity: 'stable' | 'beta' | 'preview';
  readonly status: 'passing' | 'in-progress' | 'blocked' | 'missing';
  readonly command: string;
  readonly blocker?: string;
  readonly releaseBlocking?: boolean;
  readonly evidence: readonly string[];
}

interface Acceptance {
  readonly schemaVersion: 1;
  readonly release: '0.9.0';
  readonly status: 'implementation-in-progress' | 'release-candidate';
  readonly gates: readonly Gate[];
}

interface Scorecard {
  readonly schemaVersion: 1;
  readonly release: '0.9.0';
  readonly status: 'implementation-in-progress' | 'release-candidate';
  readonly manifesto: string;
  readonly acceptanceManifest: string;
  readonly foundationManifest: string;
  readonly pillars: readonly { readonly id: string; readonly rfp: string; readonly acceptance: readonly string[] }[];
  readonly acceptanceApplications: readonly { readonly id: string }[];
}

const requireRelease = process.argv.includes('--require-release');
const packageManifest = JSON.parse(await readFile('package.json', 'utf8')) as { readonly scripts?: Readonly<Record<string, string>> };
const scorecard = JSON.parse(await readFile('docs/v0.9-scorecard.json', 'utf8')) as Scorecard;
const acceptance = JSON.parse(await readFile('docs/v0.9-acceptance.json', 'utf8')) as Acceptance;
const publicContractInventory = JSON.parse(
  await readFile('docs/v0.9-public-contract.json', 'utf8'),
) as { readonly status?: 'candidate-review-ready' | 'frozen' };
const findings: string[] = [];

if (scorecard.schemaVersion !== 1 || scorecard.release !== '0.9.0') findings.push('V09_SCORECARD_IDENTITY_INVALID');
if (acceptance.schemaVersion !== 1 || acceptance.release !== '0.9.0') findings.push('V09_ACCEPTANCE_IDENTITY_INVALID');
if (scorecard.acceptanceManifest !== 'v0.9-acceptance.json') findings.push('V09_ACCEPTANCE_AUTHORITY_INVALID');
for (const path of [scorecard.manifesto, scorecard.acceptanceManifest, scorecard.foundationManifest, ...scorecard.pillars.map(({ rfp }) => rfp)]) {
  try { await access(`docs/${path}`); } catch { findings.push(`V09_SCORECARD_DOCUMENT_MISSING:${path}`); }
}

const gateIds = new Set<string>();
for (const gate of acceptance.gates) {
  if (!gate.id || gateIds.has(gate.id)) findings.push(`V09_ACCEPTANCE_GATE_DUPLICATED:${gate.id || '<empty>'}`);
  gateIds.add(gate.id);
  const script = /^bun run ([A-Za-z0-9:_-]+)$/u.exec(gate.command)?.[1];
  if (!script || !packageManifest.scripts?.[script]) findings.push(`V09_ACCEPTANCE_COMMAND_MISSING:${gate.id}:${gate.command}`);
  if (gate.evidence.length === 0) findings.push(`V09_ACCEPTANCE_EVIDENCE_MISSING:${gate.id}`);
  if ((gate.status === 'blocked' || gate.status === 'missing') && !gate.blocker?.match(/^[A-Z][A-Z0-9_]+$/u)) {
    findings.push(`V09_ACCEPTANCE_BLOCKER_MISSING:${gate.id}`);
  }
  if (requireRelease && gate.releaseBlocking !== false && gate.status !== 'passing') findings.push(`V09_RELEASE_GATE_NOT_PASSING:${gate.id}:${gate.status}`);
  if (requireRelease && gate.releaseBlocking !== false) {
    for (const evidence of gate.evidence) {
      try { await access(evidence); } catch { findings.push(`V09_RELEASE_EVIDENCE_UNAVAILABLE:${gate.id}:${evidence}`); }
    }
  }
}
for (const pillar of scorecard.pillars) {
  if (pillar.acceptance.length === 0) findings.push(`V09_SCORECARD_PILLAR_UNQUALIFIED:${pillar.id}`);
  for (const gate of pillar.acceptance) if (!gateIds.has(gate)) findings.push(`V09_SCORECARD_GATE_MISSING:${pillar.id}:${gate}`);
}
for (const required of ['guestbook', 'chirp', 'agentic-start']) {
  if (!scorecard.acceptanceApplications.some(({ id }) => id === required)) findings.push(`V09_ACCEPTANCE_APPLICATION_MISSING:${required}`);
}
for (const required of ['released-v071-upgrade', 'finite-jobs', 'kubernetes-cluster-capability', 'kubernetes-cluster-remote', 'external-capability-bindings', 'application-event-federation', 'ml-models', 'explainable-decisions', 'saga-deployed-provider', 'research-agent-managed', 'code-agent-local', 'builder-opencode', 'chirp-production-aws', 'chirp-production-kubernetes', 'agentic-start-browser']) {
  if (!gateIds.has(required)) findings.push(`V09_GLOBAL_RELEASE_GATE_MISSING:${required}`);
}
if (requireRelease && (scorecard.status !== 'release-candidate' || acceptance.status !== 'release-candidate')) {
  findings.push('V09_RELEASE_STATUS_NOT_CANDIDATE');
}
if (requireRelease && publicContractInventory.status !== 'frozen') {
  findings.push(`V09_PUBLIC_CONTRACT_NOT_FROZEN:${publicContractInventory.status ?? '<missing>'}`);
}
if (findings.length > 0) throw new Error(`v0.9 scorecard failed:\n${findings.map((finding) => `- ${finding}`).join('\n')}`);

console.log(JSON.stringify({
  release: scorecard.release,
  mode: requireRelease ? 'release' : 'contract',
  status: scorecard.status,
  gates: acceptance.gates.length,
  passing: acceptance.gates.filter(({ status }) => status === 'passing').length,
  blocked: acceptance.gates.filter(({ status }) => status === 'blocked' || status === 'missing').map(({ id }) => id),
}, null, 2));
