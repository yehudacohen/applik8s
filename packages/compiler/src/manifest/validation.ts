import type { BundleArtifact, Diagnostic, HandlerId, OperatorManifest, Result } from '@applik8s/core';
import { computeBundleDigest } from './bundle-digest.js';

export function validateOperatorManifest(manifest: OperatorManifest): Result<readonly Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];

  if (manifest.apiVersion !== 'applik8s.operator/v1alpha1') {
    diagnostics.push(error('Manifest apiVersion must be applik8s.operator/v1alpha1.'));
  }
  if (manifest.kind !== 'OperatorBundle') {
    diagnostics.push(error('Manifest kind must be OperatorBundle.'));
  }

  requireSha256(manifest.spec.handlerArtifact.digest, 'handler artifact digest', diagnostics);
  requireSha256(manifest.spec.bundle.digest, 'bundle digest', diagnostics);
  requireSha256(manifest.spec.bundle.sourceDigest, 'bundle source digest', diagnostics);
  validateBundleArtifacts(manifest, diagnostics);
  if (manifest.spec.bundle.portability && manifest.spec.bundle.portability.bundleDigest !== manifest.spec.bundle.digest) {
    diagnostics.push(error('Manifest portability bundleDigest must match bundle.digest.'));
  }

  for (const [kind, digest] of Object.entries(manifest.spec.payloadSchemaDigests)) {
    requireSha256(digest, `payload schema digest ${kind}`, diagnostics);
  }

  const handlerIds = manifest.spec.handlerExports.map((handler) => handler.handlerId);
  const duplicateHandlerId = firstDuplicate(handlerIds);
  if (duplicateHandlerId) {
    diagnostics.push(error(`Manifest handler IDs must be unique; found duplicate ${duplicateHandlerId}.`));
  }

  const exportedHandlerIds = new Set<HandlerId>(handlerIds);
  for (const watch of manifest.spec.watches) {
    for (const handlerId of watch.handlers) {
      if (!exportedHandlerIds.has(handlerId)) {
        diagnostics.push(error(`Watch for ${watch.apiVersion}/${watch.kind} references unknown handler ${handlerId}.`));
      }
    }
  }

  const ownedResources = new Set(manifest.spec.ownedCrds.map((crd) => `${crd.apiVersion}/${crd.kind}`));
  for (const handler of manifest.spec.handlerExports) {
    if (!ownedResources.has(`${handler.resource.apiVersion}/${handler.resource.kind}`)) {
      diagnostics.push(error(`Handler ${handler.handlerId} targets ${handler.resource.apiVersion}/${handler.resource.kind}, which is not listed in ownedCrds.`));
    }
  }

  for (const crd of manifest.spec.ownedCrds) {
    if (!crd.versions.includes(crd.storageVersion)) {
      diagnostics.push(error(`Owned CRD ${crd.apiVersion}/${crd.kind} storageVersion ${crd.storageVersion} is not listed in versions.`));
    }
    if (crd.versions.length !== 1) {
      diagnostics.push(error(`Owned CRD ${crd.apiVersion}/${crd.kind} must declare exactly one version until CRD conversion and storage migration are supported.`));
    }
    if (crd.conversionStrategy !== 'none') {
      diagnostics.push(error(`Owned CRD ${crd.apiVersion}/${crd.kind} conversionStrategy must be none until conversion webhooks are supported.`));
    }
    if (crd.versioning.multiVersion !== 'singleVersion' || crd.versioning.conversionWebhook !== 'notConfigured' || crd.versioning.storageMigration !== 'notRequired') {
      diagnostics.push(error(`Owned CRD ${crd.apiVersion}/${crd.kind} versioning posture must remain singleVersion/notConfigured/notRequired until CRD migration support exists.`));
    }
  }

  const expectedBundleDigest = computeBundleDigest({
    compilerVersion: manifest.spec.bundle.compilerVersion,
    handlerAbi: manifest.spec.handlerAbi,
    operatorName: manifest.metadata.name,
    artifacts: manifest.spec.bundle.artifacts,
    handlerExports: manifest.spec.handlerExports,
    ownedCrds: manifest.spec.ownedCrds,
    payloadSchemaDigests: manifest.spec.payloadSchemaDigests,
  });
  if (expectedBundleDigest !== manifest.spec.bundle.digest) {
    diagnostics.push(error('Manifest bundle.digest must match the canonical artifact inventory digest.'));
  }

  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  if (errors.length > 0) {
    return {
      ok: false,
      error: {
        code: 'MANIFEST_INVALID',
        message: errors[0]?.message ?? 'Operator manifest is invalid.',
        severity: 'error',
        context: { operatorName: manifest.metadata.name },
        recovery: { summary: 'Regenerate the manifest after fixing handler, CRD, and artifact metadata.' },
      },
    };
  }

  return { ok: true, value: diagnostics };
}

function validateBundleArtifacts(manifest: OperatorManifest, diagnostics: Diagnostic[]): void {
  const artifacts = manifest.spec.bundle.artifacts;
  if (artifacts.length === 0) {
    diagnostics.push(error('Manifest bundle artifacts must include emitted artifact metadata.'));
    return;
  }

  for (const artifact of artifacts) {
    if (artifact.path.length === 0) {
      diagnostics.push(error('Manifest bundle artifact paths must be non-empty.'));
    }
    requireSha256(artifact.digest, `bundle artifact ${artifact.path} digest`, diagnostics);
  }

  const duplicatePath = firstDuplicate(artifacts.map((artifact) => artifact.path));
  if (duplicatePath) {
    diagnostics.push(error(`Manifest bundle artifacts must have unique paths; found duplicate ${duplicatePath}.`));
  }

  if (!hasMatchingArtifact(artifacts, { kind: 'wasm-component', path: manifest.spec.handlerArtifact.path, digest: manifest.spec.handlerArtifact.digest })) {
    diagnostics.push(error('Manifest bundle artifacts must include the handlerArtifact path and digest.'));
  }

  if (!artifacts.some((artifact) => artifact.kind === 'runtime-contract' && artifact.digest === manifest.spec.bundle.sourceDigest)) {
    diagnostics.push(error('Manifest bundle artifacts must include the runtime contract sourceDigest.'));
  }
}

function hasMatchingArtifact(artifacts: readonly BundleArtifact[], expected: BundleArtifact): boolean {
  return artifacts.some(
    (artifact) => artifact.kind === expected.kind && artifact.path === expected.path && artifact.digest === expected.digest
  );
}

function requireSha256(value: string, label: string, diagnostics: Diagnostic[]): void {
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) {
    diagnostics.push(error(`Manifest ${label} must be a sha256 digest.`));
  }
}

function firstDuplicate<T>(values: readonly T[]): T | undefined {
  const seen = new Set<T>();
  for (const value of values) {
    if (seen.has(value)) {
      return value;
    }
    seen.add(value);
  }
  return undefined;
}

function error(message: string): Diagnostic {
  return { severity: 'error', code: 'MANIFEST_INVALID', message };
}
