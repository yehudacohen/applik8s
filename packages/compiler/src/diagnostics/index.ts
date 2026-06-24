import type { Diagnostic } from '@applik8s/core';

export interface DiagnosticAdvice {
  readonly reason: string;
  readonly category: 'schema' | 'rbac' | 'capability' | 'handler' | 'runtimeConfig' | 'kubernetes' | 'artifact' | 'replay';
  readonly whatHappened: string;
  readonly likelyCause: string;
  readonly howToFix: string;
  readonly effects: 'none' | 'partial' | 'unknown';
  readonly retry: 'automatic' | 'afterObjectChange' | 'notUntilFixed' | 'notApplicable';
}

const diagnosticTaxonomy: readonly DiagnosticAdvice[] = [
  {
    reason: 'SCHEMA_UNSUPPORTED',
    category: 'schema',
    whatHappened: 'The SDK or compiler saw schema semantics it cannot validate or safely emit as Kubernetes structural OpenAPI.',
    likelyCause: 'The schema uses unsupported JSON Schema or ArkType constructs such as composition, tuple arrays, defaults, unsafe unions, or unconstrained objects.',
    howToFix: 'Rewrite the schema into the supported structural subset and rerun local schema tests before compiling CRDs.',
    effects: 'none',
    retry: 'notUntilFixed',
  },
  {
    reason: 'BUNDLE_INVALID',
    category: 'artifact',
    whatHappened: 'Compilation or artifact validation failed before a deployable operator bundle was produced.',
    likelyCause: 'The entrypoint, portability policy, runtime config, schema, manifest, or generated artifact set is invalid.',
    howToFix: 'Read the first compiler diagnostic, remove unsupported options instead of relying on ignored defaults, and re-run the focused compiler test.',
    effects: 'none',
    retry: 'notUntilFixed',
  },
  {
    reason: 'UndeclaredPermission',
    category: 'rbac',
    whatHappened: 'The host rejected an operation plan because the manifest did not declare the Kubernetes permission it needs.',
    likelyCause: 'The handler started writing, patching, deleting, finalizing, recording events, or updating status without matching operator permissions.',
    howToFix: 'Add the missing explicit permission to the operator definition or remove the operation. Generated RBAC should then include the rule.',
    effects: 'none',
    retry: 'notUntilFixed',
  },
  {
    reason: 'ApplyFailed',
    category: 'kubernetes',
    whatHappened: 'A server-side apply operation reached Kubernetes and failed.',
    likelyCause: 'Common causes are SSA ownership conflicts, invalid object metadata, invalid namespace/scope, schema rejection, or live RBAC denial.',
    howToFix: 'Inspect operation index, target, field manager, Kubernetes API cause, and prior completed-operation counters before deciding whether cleanup is needed.',
    effects: 'partial',
    retry: 'automatic',
  },
  {
    reason: 'StatusPatchFailed',
    category: 'kubernetes',
    whatHappened: 'The runtime tried to patch status and Kubernetes rejected it.',
    likelyCause: 'The CRD lacks a status subresource, the status schema rejected the value, or another field manager owns the status field.',
    howToFix: 'Ensure the CRD has status enabled, keep status structural, and resolve field-manager ownership conflicts.',
    effects: 'partial',
    retry: 'automatic',
  },
  {
    reason: 'CAPABILITY_DENIED',
    category: 'capability',
    whatHappened: 'A declared external capability request was denied before or during host execution.',
    likelyCause: 'The request used unsupported auth/protocol semantics, missed a required idempotency key, referenced a missing Secret, or violated host policy.',
    howToFix: 'Use the supported HTTP capability shape, provide idempotency keys for mutations, and verify SecretRef RBAC and namespace.',
    effects: 'unknown',
    retry: 'automatic',
  },
  {
    reason: 'HandlerRuntimeFailed',
    category: 'handler',
    whatHappened: 'The handler threw, rejected, trapped, or otherwise failed inside the WASM/component runtime.',
    likelyCause: 'Application code threw an exception or the generated dispatcher/runtime boundary could not complete invocation.',
    howToFix: 'Use source-mapped stack frames and replay artifacts to find the application frame, then make the handler bounded and idempotent.',
    effects: 'none',
    retry: 'automatic',
  },
  {
    reason: 'HandlerTimedOut',
    category: 'handler',
    whatHappened: 'Handler execution exceeded the configured wall-clock timeout.',
    likelyCause: 'The handler performed unbounded work, waited on a slow dependency, or needs a larger explicit timeout.',
    howToFix: 'Move durable work into Kubernetes-visible state, keep reconciliation bounded, and only raise handlerTimeoutSeconds when retries are safe.',
    effects: 'unknown',
    retry: 'automatic',
  },
  {
    reason: 'RetryExhausted',
    category: 'runtimeConfig',
    whatHappened: 'The runtime exhausted configured retries for the same failing reconcile.',
    likelyCause: 'The underlying failure persisted across retry attempts.',
    howToFix: 'Fix the root cause, then update the object or desired state so Kubernetes triggers a fresh reconcile.',
    effects: 'unknown',
    retry: 'afterObjectChange',
  },
  {
    reason: 'ReplayArtifactInvalid',
    category: 'replay',
    whatHappened: 'A replay artifact could not be inspected or executed locally.',
    likelyCause: 'The artifact is metadata-only, has an unsupported version, lacks the generated bundle, or debug artifact digests do not match.',
    howToFix: 'Use a full-payload artifact for execution and pass --bundle-dir pointing at the matching dist/applik8s directory.',
    effects: 'none',
    retry: 'notApplicable',
  },
];

export function hasErrorDiagnostics(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}

export function diagnosticAdviceForReason(reason: string): DiagnosticAdvice | undefined {
  return diagnosticTaxonomy.find((entry) => entry.reason === reason);
}

export function diagnosticAdviceForDiagnostic(diagnostic: Diagnostic): DiagnosticAdvice | undefined {
  return diagnosticAdviceForReason(diagnostic.code);
}

export function diagnosticTaxonomyEntries(): readonly DiagnosticAdvice[] {
  return diagnosticTaxonomy;
}
