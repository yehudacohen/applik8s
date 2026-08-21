import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = process.cwd();
const maintainedRoots = ['packages', 'crates'];
const findings: string[] = [];
const allowedCryptoOwners = new Set([
  'packages/runtime/src/signed-envelope.ts',
]);
const canonicalOwners = new Set([
  'packages/core/src/canonical-json.ts',
]);

for (const maintainedRoot of maintainedRoots) {
  for (const file of await sourceFiles(join(root, maintainedRoot))) {
    const path = relative(root, file);
    const source = await readFile(file, 'utf8');
    const externalProtocolCrypto = /runtime-integrity:\s*external-protocol-crypto/u.test(source);
    if (!allowedCryptoOwners.has(path) && !externalProtocolCrypto && /\b(?:createHmac|timingSafeEqual)\b/u.test(source)) {
      findings.push(`${path} contains a private cryptographic-envelope primitive.`);
    }
    if (!canonicalOwners.has(path) && /\bfunction\s+(?:canonicalJson|stableStringify)\s*\(/u.test(source)) {
      findings.push(`${path} contains a private canonical JSON implementation.`);
    }
  }
}

for (const required of [
  'packages/core/src/canonical-json.ts',
  'packages/core/src/application-admission.ts',
  'packages/runtime/src/signed-envelope.ts',
  'packages/core/test/runtime-integrity.vertical.test.ts',
  'packages/runtime/test/signed-envelope.vertical.test.ts',
]) {
  try {
    await readFile(join(root, required));
  } catch {
    findings.push(`Missing canonical Runtime Integrity source or evidence: ${required}.`);
  }
}

if (findings.length > 0) {
  throw new Error(`v0.8 Runtime Integrity gate failed:\n${findings.map((finding) => `- ${finding}`).join('\n')}`);
}

console.log(JSON.stringify({
  release: '0.8.0',
  gate: 'runtime-integrity',
  status: 'passed',
}, null, 2));

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === 'dist' || entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (/\.(?:rs|ts)$/u.test(entry.name) && !/\.(?:test|spec)\./u.test(entry.name)) files.push(path);
  }
  return files;
}
