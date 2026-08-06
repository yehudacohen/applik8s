import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const contract = JSON.parse(
  await readFile(resolve(root, 'docs/v07-identity-acceptance.json'), 'utf8'),
);
const packageManifest = JSON.parse(
  await readFile(resolve(root, 'package.json'), 'utf8'),
);
const failures = [];

if (contract.apiVersion !== 'applik8s.identityAcceptance/v1alpha1') {
  failures.push('identity acceptance uses an unsupported API version');
}
if (contract.release !== 'v0.7') {
  failures.push('identity acceptance does not target v0.7');
}
if (!Array.isArray(contract.requirements) || contract.requirements.length < 17) {
  failures.push('identity acceptance does not cover the complete required matrix');
}

const ids = new Set();
for (const requirement of contract.requirements ?? []) {
  if (typeof requirement.id !== 'string' || !requirement.id.trim()) {
    failures.push('an identity requirement has no stable id');
    continue;
  }
  if (ids.has(requirement.id)) {
    failures.push(`duplicate identity requirement ${requirement.id}`);
  }
  ids.add(requirement.id);
  if (requirement.state !== 'complete') {
    failures.push(
      `identity requirement ${requirement.id} is ${String(requirement.state)}`,
    );
  }
  if (!Array.isArray(requirement.evidence) || requirement.evidence.length === 0) {
    failures.push(`identity requirement ${requirement.id} has no evidence`);
    continue;
  }
  for (const evidence of requirement.evidence) {
    if (
      typeof evidence?.path !== 'string'
      || typeof evidence?.marker !== 'string'
      || !evidence.marker.trim()
    ) {
      failures.push(
        `identity requirement ${requirement.id} has malformed evidence`,
      );
      continue;
    }
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

const required = [
  'human-session-admission',
  'oauth-authorization-code-pkce',
  'machine-client-credentials',
  'typed-protected-operations',
  'static-identity-role-authority',
  'runtime-permission-composition',
  'scoped-grant-lifecycle',
  'agent-production-request',
  'durable-human-approval',
  'bounded-delegated-authority',
  'mcp-http-invocation-without-token-passthrough',
  'independent-outcome-observation',
  'searchable-audit-live-administration',
  'catalog-migration-with-pinned-work',
  'mcp-version-coexistence',
  'adversarial-authority-denials',
  'cross-execution-workload-isolation',
];
for (const id of required) {
  if (!ids.has(id)) failures.push(`missing identity requirement ${id}`);
}

const gate = packageManifest.scripts?.['check:v07:identity-acceptance'];
if (
  typeof gate !== 'string'
  || !gate.includes('check-v07-identity-acceptance.mjs')
) {
  failures.push('package scripts do not execute the identity acceptance gate');
}

if (failures.length > 0) {
  throw new Error(
    `v0.7 identity acceptance failed:\n${
      failures.map((failure) => `- ${failure}`).join('\n')
    }`,
  );
}

console.log(
  `v0.7 identity acceptance passed for ${contract.requirements.length} provider-neutral human, workload, authority, workflow, MCP, and adversarial contracts.`,
);
