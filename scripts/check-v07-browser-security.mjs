import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const contract = JSON.parse(
  await readFile(resolve(root, 'docs/v07-browser-security.json'), 'utf8'),
);
const failures = [];

if (contract.apiVersion !== 'applik8s.browserSecurity/v1alpha1') {
  failures.push('browser security uses an unsupported API version');
}
if (contract.release !== 'v0.7') {
  failures.push('browser security does not target v0.7');
}
if (!Array.isArray(contract.requirements) || contract.requirements.length < 8) {
  failures.push('browser security does not cover the required threat matrix');
}

const ids = new Set();
for (const requirement of contract.requirements ?? []) {
  if (typeof requirement.id !== 'string' || !requirement.id.trim()) {
    failures.push('a browser-security requirement has no stable id');
    continue;
  }
  if (ids.has(requirement.id)) {
    failures.push(`duplicate browser-security requirement ${requirement.id}`);
  }
  ids.add(requirement.id);
  if (!Array.isArray(requirement.evidence) || requirement.evidence.length === 0) {
    failures.push(`${requirement.id} has no evidence`);
    continue;
  }
  for (const evidence of requirement.evidence) {
    try {
      const source = await readFile(resolve(root, evidence.path), 'utf8');
      if (!source.includes(evidence.marker)) {
        failures.push(
          `${requirement.id} evidence ${evidence.path} lacks ${JSON.stringify(evidence.marker)}`,
        );
      }
    } catch (error) {
      failures.push(
        `${requirement.id} evidence ${evidence.path} is unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

const browserSources = [
  'packages/client/src/index.ts',
  'packages/client/src/operations.ts',
  'packages/client/src/signals.ts',
  'packages/react/src/index.ts',
  'packages/react/src/identity.ts',
  'packages/ai-tanstack/src/client.ts',
  'packages/start-agentic/src/react.ts',
];
const forbiddenBrowserImports = [
  /^node:/mu,
  /@kubernetes\/client-node/mu,
  /(?:^|['"])typekro(?:\/|['"])/mu,
  /(?:^|['"])alchemy(?:\/|['"])/mu,
  /@applik8s\/(?:compiler|deployment-|runtime-|identity-ory|billing-stripe)/mu,
];
for (const path of browserSources) {
  const source = await readFile(resolve(root, path), 'utf8');
  for (const forbidden of forbiddenBrowserImports) {
    if (forbidden.test(source)) {
      failures.push(`${path} crosses browser/server import zone ${forbidden}`);
    }
  }
}

if (failures.length > 0) {
  throw new Error(
    `v0.7 browser-security matrix failed:\n${
      failures.map((failure) => `- ${failure}`).join('\n')
    }`,
  );
}

console.log(
  `v0.7 browser-security matrix passed for ${contract.requirements.length} threat boundaries and ${browserSources.length} browser entrypoints.`,
);
