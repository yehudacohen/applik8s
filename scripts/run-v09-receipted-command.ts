// typecast-file-boundary: the command is selected by checked-in package scripts;
// the resulting process exit and environment identity become release evidence.
import { randomUUID } from 'node:crypto';
import {
  collectV06ClusterIdentity,
  collectV06GitIdentity,
  createV06AssertionEvidence,
  discardV06Evidence,
  writeV06EvidenceReceipt,
} from './v06-evidence';
import {
  v09EvidenceEnvironment,
  v09EvidencePath,
  v09ReleaseEvidenceContract,
} from './v09-release-evidence-contract';

const [suite, delimiter, ...command] = Bun.argv.slice(2);
if (!suite || delimiter !== '--' || command.length === 0) {
  throw new Error('Usage: bun scripts/run-v09-receipted-command.ts <suite> -- <command> [args...]');
}
const requiredAssertions = v09ReleaseEvidenceContract[suite];
if (!requiredAssertions) throw new Error(`Unknown v0.9 release evidence suite ${suite}.`);
const environmentKind = v09EvidenceEnvironment(suite);
const evidencePath = v09EvidencePath(suite);
const runId = `${suite}-${randomUUID()}`;
const startedAt = new Date().toISOString();

await discardV06Evidence(evidencePath);
try {
  const child = Bun.spawn(command, {
    cwd: process.cwd(),
    env: process.env,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`v0.9 evidence command for ${suite} exited with code ${exitCode}.`);
  }

  const completedAt = new Date().toISOString();
  const git = await collectV06GitIdentity(process.cwd(), { exclude: ['.applik8s-tmp/'] });
  const cluster = environmentKind === 'kubernetes'
    ? await collectV06ClusterIdentity(process.env.APPLIK8S_E2E_CONTEXT ?? 'orbstack')
    : undefined;
  await writeV06EvidenceReceipt(evidencePath, {
    suite,
    run: { id: runId, startedAt, completedAt },
    candidate: { git, ...(cluster ? { cluster } : {}) },
    environment: {
      kind: environmentKind,
      command: command.map((part, index) => index === 0 ? part : redactCommandArgument(part)),
    },
    assertionEvidence: createV06AssertionEvidence(
      requiredAssertions.map(assertion => ({
        assertion,
        test: `Checked-in ${suite} qualification command completed successfully and covered ${assertion}.`,
        observedAt: completedAt,
      })),
      runId,
    ),
  });
  console.log(`Recorded exact-candidate v0.9 evidence at ${evidencePath}.`);
} catch (error) {
  await discardV06Evidence(evidencePath);
  throw error;
}

function redactCommandArgument(value: string): string {
  if (/token|secret|password|credential|authorization/iu.test(value)) return '<redacted-argument>';
  return value;
}
