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
const requestAdmissionConsumers = new Set([
  'packages/applik8s/src/command-gateway.ts',
  'packages/applik8s/src/query-gateway.ts',
  'packages/applik8s/src/stream-subscription-gateway.ts',
  'packages/server/src/kubernetes-gateway.ts',
]);
const admissionObservationConsumers = new Set([
  'packages/compiler/src/application-http/index.ts',
  'packages/compiler/src/application-reactive/index.ts',
  'packages/compiler/src/application-workflows/source.ts',
]);
const expectedInventoryPaths = new Set([
  'packages/applik8s/src/command-gateway.ts',
  'packages/applik8s/src/query-gateway.ts',
  'packages/applik8s/src/stream-subscription-gateway.ts',
  'packages/applik8s/src/task-query-runtime.ts',
  'packages/applik8s/src/application-object-storage-gateway.ts',
  'packages/applik8s/src/search-runtime.ts',
  'packages/applik8s/src/search-runtime-postgres.ts',
  'packages/runtime-opensearch/src/index.ts',
  'packages/core/src/application-graph-serialization.ts',
  'packages/deployment-contract/src/serialization.ts',
  'packages/deployment-typekro/src/adapter.ts',
  'packages/compiler/src/manifest/index.ts',
  'packages/client/src/store.ts',
]);
const inventoryDispositions = new Set([
  'canonical-owner',
  'canonical-consumer',
  'registered-compatibility-adapter',
  'explicit-domain-adapter',
  'pending-migration',
  'rejected',
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

const sourceInventory = JSON.parse(
  await readFile(join(root, 'docs/v0.8-runtime-integrity-source-inventory.json'), 'utf8'),
) as {
  readonly sources?: readonly {
    readonly id?: string;
    readonly path?: string;
    readonly canonicalOwner?: string;
    readonly canonicalSourceMarker?: string;
    readonly disposition?: string;
    readonly formatRegistryEntry?: string;
    readonly evidence?: string | null;
    readonly remaining?: string | null;
  }[];
};
const inventorySources = sourceInventory.sources ?? [];
const formatRegistry = JSON.parse(
  await readFile(join(root, 'docs/v0.8-format-registry.json'), 'utf8'),
) as { readonly entries?: readonly { readonly id?: string }[] };
const formatRegistryIds = new Set((formatRegistry.entries ?? []).map((entry) => entry.id));
const inventoryIds = new Set<string>();
const inventoryPaths = new Set<string>();
for (const source of inventorySources) {
  if (!source.id || inventoryIds.has(source.id)) {
    findings.push(`Runtime Integrity source inventory contains a duplicate or missing identity ${source.id ?? '<missing>'}.`);
  } else {
    inventoryIds.add(source.id);
  }
  if (!source.path || inventoryPaths.has(source.path)) {
    findings.push(`Runtime Integrity source inventory contains a duplicate or missing path ${source.path ?? '<missing>'}.`);
  } else {
    inventoryPaths.add(source.path);
    try {
      await readFile(join(root, source.path));
    } catch {
      findings.push(`Runtime Integrity source inventory path does not exist: ${source.path}.`);
    }
  }
  if (!inventoryDispositions.has(source.disposition ?? '')) {
    findings.push(`Runtime Integrity source ${source.id ?? '<missing>'} has unknown disposition ${source.disposition ?? '<missing>'}.`);
  }
  if (!source.canonicalOwner?.trim()) {
    findings.push(`Runtime Integrity source ${source.id ?? '<missing>'} lacks a canonical owner.`);
  }
  if (source.disposition === 'canonical-consumer') {
    const consumerSource = await readFile(join(root, source.path ?? ''), 'utf8');
    const canonicalSourceMarker = source.canonicalSourceMarker ?? 'canonicalJsonV1String';
    if (!consumerSource.includes(canonicalSourceMarker)) {
      findings.push(`Runtime Integrity canonical consumer ${source.id ?? '<missing>'} does not use ${canonicalSourceMarker}.`);
    }
    if (/\bfunction\s+(?:canonicalJson|runtimeIdentityStableJson|stableJson|stableJsonStringify)\s*\(/u.test(consumerSource)) {
      findings.push(`Runtime Integrity canonical consumer ${source.id ?? '<missing>'} retains a private canonical JSON implementation.`);
    }
  }
  if (!source.evidence?.trim()) {
    findings.push(`Runtime Integrity source ${source.id ?? '<missing>'} lacks an evidence path.`);
  } else {
    try {
      await readFile(join(root, source.evidence));
    } catch {
      findings.push(`Runtime Integrity source ${source.id ?? '<missing>'} evidence path does not exist: ${source.evidence}.`);
    }
  }
  if (source.disposition === 'registered-compatibility-adapter'
    && (!source.formatRegistryEntry || !formatRegistryIds.has(source.formatRegistryEntry))) {
    findings.push(`Runtime Integrity compatibility source ${source.id ?? '<missing>'} is not backed by a format-registry entry.`);
  }
  if ((source.disposition === 'pending-migration'
      || source.disposition === 'registered-compatibility-adapter'
      || source.disposition === 'explicit-domain-adapter')
    && !source.remaining?.trim()) {
    findings.push(`Runtime Integrity source ${source.id ?? '<missing>'} has unfinished disposition ${source.disposition} without explicit remaining work.`);
  }
}
for (const path of expectedInventoryPaths) {
  if (!inventoryPaths.has(path)) {
    findings.push(`Runtime Integrity source inventory is missing known released-source path ${path}.`);
  }
}

for (const path of requestAdmissionConsumers) {
  const source = await readFile(join(root, path), 'utf8');
  if (!source.includes('createApplicationRequestAdmissionContextV1(')) {
    findings.push(`${path} bypasses the canonical request-ingress admission constructor.`);
  }
  if (source.includes('createApplicationAdmissionContextV1(')) {
    findings.push(`${path} retains a private request-ingress admission construction path.`);
  }
}

for (const path of admissionObservationConsumers) {
  const source = await readFile(join(root, path), 'utf8');
  if (!source.includes('createApplicationAdmissionObservationV1')) {
    findings.push(`${path} bypasses the canonical admission observation shape.`);
  }
  if (!source.includes('applicationAdmissionRejectionCodeV1')) {
    findings.push(`${path} retains an unbounded admission rejection classifier.`);
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

const actorAuthorityRuntime = await readFile(
  join(root, 'packages/applik8s/src/application-actor-authority-runtime.ts'),
  'utf8',
);
if (
  !actorAuthorityRuntime.includes('readonly admission?: ApplicationAdmissionInvocationContextV1')
  || !actorAuthorityRuntime.includes('createApplicationAdmissionContextV1')
  || !actorAuthorityRuntime.includes('validateApplicationAdmissionContextV1')
) {
  findings.push('Actor turn authority does not use the canonical Release-A admission adapter.');
}
const celldWorker = await readFile(
  join(root, 'packages/runtime-celld/src/worker.ts'),
  'utf8',
);
if (
  !celldWorker.includes("from '@applik8s/applik8s/actor-authority-runtime'")
  || !celldWorker.includes('normalizeApplicationActorTurnAuthority(')
) {
  findings.push('celld actor alarms do not validate canonical persisted authority through the focused runtime boundary.');
}
const actorRuntime = await readFile(
  join(root, 'packages/applik8s/src/application-actors.ts'),
  'utf8',
);
const actorAdmission = await readFile(
  join(root, 'packages/core/src/application-admission.ts'),
  'utf8',
);
const generatedGateway = await readFile(
  join(root, 'packages/compiler/src/application-fetch-gateway/index.ts'),
  'utf8',
);
for (const [source, requirement] of [
  [actorAdmission, "const executionKinds = '|actor|agent|task|workflow|processor|reconcile|'"],
  [actorRuntime, 'managedActorInvocationIdempotencyKey'],
  [actorRuntime, "phase: 'enqueue'"],
  [actorAuthorityRuntime, 'applik8s.actor.authority.legacy_read'],
  [actorAuthorityRuntime, 'cancellation fence revision'],
  [generatedGateway, 'actorWorkloadEnvelopes'],
  [generatedGateway, "executionKind: 'actor'"],
  [generatedGateway, 'boundedActorDeadline'],
] as const) {
  if (!source.includes(requirement)) {
    findings.push(`Actor AC-1 source gate is missing ${requirement}.`);
  }
}
if (/cancel:\s*\(key:\s*string\)/u.test(actorRuntime)) {
  findings.push('Actor public alarms expose provider-direct cancellation instead of bound operation-authorized cancellation.');
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
