import type { BundleArtifact, Diagnostic, HandlerId, LabelSelector, OperatorManifest, Result, WatchRegistration } from '@applik8s/core';
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
    validateWatchRegistration(watch, diagnostics);
    for (const handlerId of watch.handlers) {
      if (!exportedHandlerIds.has(handlerId)) {
        diagnostics.push(error(`Watch for ${watch.apiVersion}/${watch.kind} references unknown handler ${handlerId}.`));
      }
    }
  }

  const knownResources = new Set([
    ...manifest.spec.ownedCrds.map((crd) => `${crd.apiVersion}/${crd.kind}`),
    ...manifest.spec.watches.map((watch) => `${watch.apiVersion}/${watch.kind}`),
  ]);
  for (const handler of manifest.spec.handlerExports) {
    if (!knownResources.has(`${handler.resource.apiVersion}/${handler.resource.kind}`)) {
      diagnostics.push(error(`Handler ${handler.handlerId} targets ${handler.resource.apiVersion}/${handler.resource.kind}, which is not listed in ownedCrds or watches.`));
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

function validateWatchRegistration(watch: WatchRegistration, diagnostics: Diagnostic[]): void {
  const label = `${watch.apiVersion}/${watch.kind}`;
  if (watch.scope === 'Cluster' && watch.namespace) {
    diagnostics.push(error(`Watch for ${label} is cluster-scoped and must not declare namespace ${watch.namespace}.`));
  }
  if (watch.name && watch.names && watch.names.length > 0) {
    diagnostics.push(error(`Watch for ${label} must use either name or names, not both.`));
  }
  if (watch.names && watch.names.length === 0) {
    diagnostics.push(error(`Watch for ${label} names must not be empty.`));
  }
  const duplicateName = watch.names ? firstDuplicate(watch.names) : undefined;
  if (duplicateName) {
    diagnostics.push(error(`Watch for ${label} names contains duplicate ${duplicateName}.`));
  }
  if ((watch.name || (watch.names && watch.names.length > 0)) && (watch.labelSelector || watch.fieldSelector)) {
    diagnostics.push(error(`Watch for ${label} must not combine exact name/names scope with selector scope.`));
  }
  if (watch.labelSelector) {
    validateLabelSelector(watch.labelSelector, label, diagnostics);
  }
  if (watch.fieldSelector !== undefined) {
    validateFieldSelector(watch.fieldSelector, label, diagnostics);
  }
}

function validateLabelSelector(selector: LabelSelector, label: string, diagnostics: Diagnostic[]): void {
  if (!selector || typeof selector !== 'object' || Array.isArray(selector)) {
    diagnostics.push(error(`Watch for ${label} labelSelector must be an object.`));
    return;
  }
  const matchLabelsCount = selector.matchLabels && typeof selector.matchLabels === 'object' && !Array.isArray(selector.matchLabels) ? Object.keys(selector.matchLabels).length : 0;
  const matchExpressionsCount = Array.isArray(selector.matchExpressions) ? selector.matchExpressions.length : 0;
  if (matchLabelsCount === 0 && matchExpressionsCount === 0) {
    diagnostics.push(error(`Watch for ${label} labelSelector must not be empty.`));
  }
  if (selector.matchLabels !== undefined) {
    if (!selector.matchLabels || typeof selector.matchLabels !== 'object' || Array.isArray(selector.matchLabels)) {
      diagnostics.push(error(`Watch for ${label} labelSelector.matchLabels must be an object.`));
    } else {
      for (const [key, value] of Object.entries(selector.matchLabels)) {
        if (key.length === 0 || typeof value !== 'string') {
          diagnostics.push(error(`Watch for ${label} labelSelector.matchLabels must contain non-empty string keys and string values.`));
          break;
        }
      }
    }
  }
  if (selector.matchExpressions !== undefined) {
    if (!Array.isArray(selector.matchExpressions)) {
      diagnostics.push(error(`Watch for ${label} labelSelector.matchExpressions must be an array.`));
    } else {
      for (const expression of selector.matchExpressions) {
        if (!expression || typeof expression !== 'object' || Array.isArray(expression) || typeof expression.key !== 'string' || expression.key.length === 0) {
          diagnostics.push(error(`Watch for ${label} labelSelector.matchExpressions entries must declare a non-empty string key.`));
          break;
        }
        if (!['In', 'NotIn', 'Exists', 'DoesNotExist'].includes(expression.operator)) {
          diagnostics.push(error(`Watch for ${label} labelSelector.matchExpressions operator ${String(expression.operator)} is not supported.`));
          break;
        }
        const values = expression.values;
        if (expression.operator === 'In' || expression.operator === 'NotIn') {
          if (!Array.isArray(values) || values.length === 0 || values.some((value) => typeof value !== 'string')) {
            diagnostics.push(error(`Watch for ${label} labelSelector ${expression.operator} expressions require non-empty string values.`));
            break;
          }
        } else if (values !== undefined && (!Array.isArray(values) || values.length > 0)) {
          diagnostics.push(error(`Watch for ${label} labelSelector ${expression.operator} expressions must not declare values.`));
          break;
        }
      }
    }
  }
}

function validateFieldSelector(selector: string, label: string, diagnostics: Diagnostic[]): void {
  if (selector.trim().length === 0) {
    diagnostics.push(error(`Watch for ${label} fieldSelector must not be empty.`));
    return;
  }
  for (const requirement of selector.split(',')) {
    const trimmed = requirement.trim();
    const [field, expected] = trimmed.split(/==|=/, 2).map((part) => part.trim());
    if (!field || expected === undefined || expected.length === 0) {
      diagnostics.push(error(`Watch for ${label} fieldSelector requirement ${trimmed} must use field=value syntax.`));
      return;
    }
    if (field !== 'metadata.name' && field !== 'metadata.namespace') {
      diagnostics.push(error(`Watch for ${label} fieldSelector field ${field} is not supported; use metadata.name or metadata.namespace.`));
      return;
    }
  }
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
