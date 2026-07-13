import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const output = resolve(argumentValue('--out') ?? 'dist/applik8s-v0.4-live-evidence.json');
const context = execFileSync('kubectl', ['config', 'current-context'], { encoding: 'utf8' }).trim();
if (!context) throw new Error('A current Kubernetes context is required for live attestation.');

execFileSync('bun', ['run', 'check:v04:prerelease:orbstack'], {
  stdio: 'inherit',
  env: { ...process.env, APPLIK8S_E2E_CONTEXT: context },
});

const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const evidence = {
  schemaVersion: 1,
  releaseLine: 'v0.4',
  commit,
  execution: `local-maintainer:${context}`,
  context,
  suite: 'check:v04:prerelease',
  generatedAt: new Date().toISOString(),
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
console.log(`Wrote exact-commit live evidence for ${commit} to ${output}.`);

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}
