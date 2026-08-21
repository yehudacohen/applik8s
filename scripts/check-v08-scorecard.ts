// typecast-file-boundary: Release manifests are untrusted JSON and are validated before policy checks.
import { access, readFile } from 'node:fs/promises';

interface AcceptanceGate {
  readonly id: string;
  readonly owner: string;
  readonly maturity: string;
  readonly command: string;
  readonly implemented: boolean;
  readonly cadence: readonly string[];
  readonly environments: readonly string[];
  readonly evidence: readonly string[];
}

interface AcceptanceManifest {
  readonly schemaVersion: 1;
  readonly release: '0.8.0';
  readonly status: string;
  readonly gates: readonly AcceptanceGate[];
}

interface ScorecardPillar {
  readonly id: string;
  readonly rfp: string;
  readonly acceptance: readonly string[];
}

interface Scorecard {
  readonly schemaVersion: 1;
  readonly release: '0.8.0';
  readonly status: string;
  readonly manifesto: string;
  readonly acceptanceManifest: string;
  readonly targetCompatibilityManifest: string;
  readonly awsProviderInventory: string;
  readonly pillars: readonly ScorecardPillar[];
  readonly acceptanceApplications: readonly { readonly id: string }[];
}

const requireRelease = process.argv.includes('--require-release');
const packageManifest = JSON.parse(await readFile('package.json', 'utf8')) as { readonly scripts?: Readonly<Record<string, string>> };
const scorecard = JSON.parse(await readFile('docs/v0.8-scorecard.json', 'utf8')) as Scorecard;
const acceptance = JSON.parse(await readFile('docs/v0.8-acceptance.json', 'utf8')) as AcceptanceManifest;
const findings: string[] = [];

if (scorecard.schemaVersion !== 1 || scorecard.release !== '0.8.0') findings.push('v0.8 scorecard identity is invalid.');
if (acceptance.schemaVersion !== 1 || acceptance.release !== '0.8.0') findings.push('v0.8 acceptance identity is invalid.');
if (scorecard.acceptanceManifest !== 'v0.8-acceptance.json') findings.push('Scorecard does not name the canonical v0.8 acceptance manifest.');

for (const path of [
  `docs/${scorecard.manifesto}`,
  `docs/${scorecard.acceptanceManifest}`,
  `docs/${scorecard.targetCompatibilityManifest}`,
  `docs/${scorecard.awsProviderInventory}`,
  ...scorecard.pillars.map(({ rfp }) => `docs/${rfp}`),
]) {
  try { await access(path); } catch { findings.push(`Scorecard references missing document ${path}.`); }
}

const gateIds = new Set<string>();
for (const gate of acceptance.gates) {
  if (!gate.id || gateIds.has(gate.id)) findings.push(`Acceptance gate ${gate.id || '<empty>'} is empty or duplicated.`);
  gateIds.add(gate.id);
  if (!gate.owner || !gate.maturity || gate.cadence.length === 0 || gate.environments.length === 0 || gate.evidence.length === 0) {
    findings.push(`Acceptance gate ${gate.id} lacks owner, maturity, cadence, environment, or evidence metadata.`);
  }
  const match = /^bun run ([A-Za-z0-9:_-]+)$/u.exec(gate.command);
  if (!match?.[1] || !packageManifest.scripts?.[match[1]]) findings.push(`Acceptance gate ${gate.id} references missing command ${gate.command}.`);
  if (requireRelease && !gate.implemented) findings.push(`Release gate ${gate.id} is not implemented.`);
}

for (const pillar of scorecard.pillars) {
  if (pillar.acceptance.length === 0) findings.push(`Scorecard pillar ${pillar.id} has no acceptance gate.`);
  for (const gate of pillar.acceptance) if (!gateIds.has(gate)) findings.push(`Scorecard pillar ${pillar.id} references missing gate ${gate}.`);
}

for (const required of ['agentic-start', 'chirp', 'guestbook']) {
  if (!scorecard.acceptanceApplications.some(({ id }) => id === required)) findings.push(`Scorecard lacks required acceptance application ${required}.`);
}

if (requireRelease) {
  if (scorecard.status !== 'release-candidate') findings.push(`Scorecard status must be release-candidate, not ${scorecard.status}.`);
  if (acceptance.status !== 'release-candidate') findings.push(`Acceptance status must be release-candidate, not ${acceptance.status}.`);
  for (const document of [
    `docs/${scorecard.manifesto}`,
    ...scorecard.pillars.map(({ rfp }) => `docs/${rfp}`),
  ]) {
    const source = await readFile(document, 'utf8');
    if (!/^\*\*Status:\*\* Accepted/mu.test(source)) findings.push(`${document} is release normative but is not Accepted.`);
  }
}

if (findings.length > 0) throw new Error(`v0.8 scorecard failed:\n${findings.map((finding) => `- ${finding}`).join('\n')}`);

console.log(JSON.stringify({
  release: scorecard.release,
  mode: requireRelease ? 'release' : 'contract',
  gates: acceptance.gates.length,
  implemented: acceptance.gates.filter(({ implemented }) => implemented).length,
  pillars: scorecard.pillars.length,
  acceptanceApplications: scorecard.acceptanceApplications.map(({ id }) => id),
}, null, 2));
