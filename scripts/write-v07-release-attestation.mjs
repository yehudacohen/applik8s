import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const output = resolve(
  argumentValue('--out') ?? 'dist/applik8s-v0.7-live-evidence.json',
);
const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
const context = process.env.APPLIK8S_E2E_CONTEXT ?? 'orbstack';
const execution = process.env.APPLIK8S_EVIDENCE_EXECUTION
  ?? `maintainer-local:${commit}`;

await mkdir(dirname(output), { recursive: true });
await writeFile(
  output,
  `${JSON.stringify({
    schemaVersion: 1,
    releaseLine: 'v0.7',
    commit,
    execution,
    context,
    suite: 'check:v07:prerelease',
    generatedAt: new Date().toISOString(),
  }, null, 2)}\n`,
);
console.log(`Wrote exact-commit v0.7 release attestation to ${output}.`);

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}
