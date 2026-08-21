import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const maintainedRoots = ['packages', 'crates'];
const findings: string[] = [];
const allowedCryptoOwners = new Set([
  'packages/runtime/src/node-integrity.ts',
  'packages/runtime/src/signed-envelope.ts',
]);
const externalProtocolCryptoOwners = new Map([
  ['packages/billing-stripe/src/index.ts', 'stripe-signature-v1'],
]);
const canonicalOwners = new Set([
  'packages/core/src/canonical-json.ts',
]);
const admissionShapeOwners = new Set([
  'packages/core/src/application-admission.ts',
  'packages/core/src/application-operation-authority.ts',
]);
// Release-A formats remain explicit debt, never a wildcard exemption. Remove
// each identity in the same slice that migrates its writer to canonical v1.
const registeredLegacyAdmissionShapes = new Set([
  'packages/applik8s/src/task-query-runtime.ts#ApplicationTaskQueryToken',
]);
const expectedAdmissionAdapters = new Set([
  'authenticated-http-browser-sse',
  'verified-webhook-provider-callback',
  'broker-delivery',
  'workflow-task-delivery',
  'schedule-occurrence',
  'actor-call-alarm',
  'agent-ai-execution',
]);

for (const maintainedRoot of maintainedRoots) {
  for (const file of await sourceFiles(join(root, maintainedRoot))) {
    const path = relative(root, file);
    const source = await readFile(file, 'utf8');
    const externalProtocolCrypto = source.match(
      /runtime-integrity:\s*external-protocol-crypto=([a-z0-9-]+)/u,
    )?.[1];
    const expectedExternalProtocol = externalProtocolCryptoOwners.get(path);
    if (externalProtocolCrypto && externalProtocolCrypto !== expectedExternalProtocol) {
      findings.push(`${path} claims an unregistered external cryptographic protocol ${externalProtocolCrypto}.`);
    }
    const registeredExternalProtocol = expectedExternalProtocol !== undefined
      && externalProtocolCrypto === expectedExternalProtocol;
    if (!allowedCryptoOwners.has(path) && !registeredExternalProtocol && /\b(?:createHmac|timingSafeEqual)\b/u.test(source)) {
      findings.push(`${path} contains a private cryptographic-envelope primitive.`);
    }
    if (!canonicalOwners.has(path) && /\bfunction\s+(?:canonicalJson|stableStringify)\s*\(/u.test(source)) {
      findings.push(`${path} contains a private canonical JSON implementation.`);
    }
    if (!admissionShapeOwners.has(path)) {
      findings.push(...privateAdmissionShapes(path, source));
    }
  }
}

const admissionMatrix = JSON.parse(
  await readFile(join(root, 'docs/v0.8-admission-adapter-matrix.json'), 'utf8'),
) as {
  readonly adapters?: readonly {
    readonly id?: string;
    readonly state?: string;
    readonly owners?: readonly string[];
    readonly regression?: string | null;
  }[];
};
const adapters = admissionMatrix.adapters ?? [];
const adapterIds = new Set(adapters.map((adapter) => adapter.id));
for (const id of expectedAdmissionAdapters) {
  if (!adapterIds.has(id)) findings.push(`Admission adapter matrix is missing ${id}.`);
}
if (adapterIds.size !== adapters.length) {
  findings.push('Admission adapter matrix contains a duplicate identity.');
}
for (const adapter of adapters) {
  if (!adapter.id || !expectedAdmissionAdapters.has(adapter.id)) {
    findings.push(`Admission adapter matrix contains unknown adapter ${adapter.id ?? '<missing>'}.`);
  }
  if (!['not-started', 'in-progress', 'implemented'].includes(adapter.state ?? '')) {
    findings.push(`Admission adapter ${adapter.id ?? '<missing>'} has an invalid state.`);
  }
  if (adapter.state === 'implemented'
    && ((adapter.owners?.length ?? 0) === 0 || !adapter.regression?.trim())) {
    findings.push(`Implemented admission adapter ${adapter.id} lacks owners or executable regression evidence.`);
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

function privateAdmissionShapes(path: string, source: string): string[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const output: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
      const typeNode = ts.isInterfaceDeclaration(node)
        ? node
        : ts.isTypeLiteralNode(node.type)
          ? node.type
          : undefined;
      if (typeNode) {
        const names = new Set(typeNode.members.flatMap((member) => {
          if (!ts.isPropertySignature(member) || !member.name) return [];
          if (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) {
            return [member.name.text];
          }
          return [];
        }));
        const requiredNames = new Set(typeNode.members.flatMap((member) => {
          if (!ts.isPropertySignature(member) || member.questionToken || !member.name) return [];
          if (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) {
            return [member.name.text];
          }
          return [];
        }));
        const identity = `${path}#${node.name.text}`;
        if (names.has('principal')
          && names.has('trustedContext')
          && (names.has('authorityRevision') || names.has('authorizationVersion'))
          && requiredNames.has('principal')
          && requiredNames.has('trustedContext')
          && !registeredLegacyAdmissionShapes.has(identity)) {
          output.push(
            `${identity} defines a private principal/authority/trusted-context admission shape.`,
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return output;
}
