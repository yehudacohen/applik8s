// typecast-file-boundary: Unknown live Kubernetes status is structurally narrowed before typed TypeKro readiness evaluation.
import type { ReadinessEvaluator, ResourceStatus } from "typekro";
import { registerPortableReadinessEvaluator } from "typekro/advanced";

interface Condition {
  readonly type?: unknown;
  readonly status?: unknown;
  readonly reason?: unknown;
  readonly message?: unknown;
  readonly observedGeneration?: unknown;
}

interface ConditionedResource {
  readonly metadata?: {
    readonly generation?: unknown;
    readonly resourceVersion?: unknown;
    readonly uid?: unknown;
  };
  readonly status?: {
    readonly observedGeneration?: unknown;
    readonly conditions?: readonly Condition[];
  };
}

const observedResourceEvaluator = registerPortableReadinessEvaluator(
  "applik8s.readiness.resource-observed",
  "1",
  (resource: ConditionedResource): ResourceStatus => {
    const observed =
      stringValue(resource.metadata?.uid) ??
      stringValue(resource.metadata?.resourceVersion);
    return {
      ready: observed !== undefined,
      reason: observed ? "ResourceObserved" : "ResourceNotObserved",
      message: observed
        ? "The Kubernetes API has observed the resource."
        : "The Kubernetes API has not returned an observed resource identity.",
    };
  },
);

const observedReadyConditionEvaluator = registerPortableReadinessEvaluator(
  "applik8s.readiness.observed-ready-condition",
  "1",
  (resource: ConditionedResource): ResourceStatus => {
    const status = resource.status;
    const conditions = Array.isArray(status?.conditions)
      ? status.conditions
      : [];
    const ready = conditions.find((condition) => condition.type === "Ready");
    const generation = numericValue(resource.metadata?.generation);
    const observedGeneration =
      numericValue(status?.observedGeneration) ??
      numericValue(ready?.observedGeneration);
    const generationCurrent =
      generation === undefined ||
      (observedGeneration !== undefined && observedGeneration >= generation);
    return {
      ready: generationCurrent && ready?.status === "True",
      reason:
        stringValue(ready?.reason) ??
        (generationCurrent ? "ReadyConditionMissing" : "ObservedGenerationStale"),
      message:
        stringValue(ready?.message) ??
        (generationCurrent
          ? "The controller has not reported Ready=True."
          : `Observed generation ${observedGeneration ?? "none"} is behind desired generation ${generation}.`),
    };
  },
);

const jobCompletionEvaluator = registerPortableReadinessEvaluator(
  "applik8s.readiness.job-completion",
  "1",
  (resource: ConditionedResource): ResourceStatus => {
    const conditions = Array.isArray(resource.status?.conditions)
      ? resource.status.conditions
      : [];
    const complete = conditions.find(
      (condition) =>
        condition.type === "Complete" && condition.status === "True",
    );
    if (complete) {
      return {
        ready: true,
        reason: stringValue(complete.reason) ?? "Complete",
        message: stringValue(complete.message) ?? "Job completed successfully.",
      };
    }
    const failed = conditions.find(
      (condition) => condition.type === "Failed" && condition.status === "True",
    );
    return {
      ready: false,
      reason: stringValue(failed?.reason) ?? "JobRunning",
      message:
        stringValue(failed?.message) ??
        "Job has not reported successful completion.",
      ...(failed ? { terminal: true } : {}),
    };
  },
);

/**
 * Readiness strategies for compiler-owned resources that do not originate
 * from a TypeKro factory call. Authored resources retain their factory
 * strategies; this registry only restores explicit, portable contracts for
 * generated GVKs.
 */
export function generatedResourceReadinessEvaluator(
  apiVersion: string,
  kind: string,
): ReadinessEvaluator<unknown> | undefined {
  const gvk = `${apiVersion}/${kind}`;
  if (
    gvk === "jetstream.nats.io/v1beta2/Consumer" ||
    gvk === "jetstream.nats.io/v1beta2/Stream"
  ) {
    return observedReadyConditionEvaluator as ReadinessEvaluator<unknown>;
  }
  if (gvk === "cilium.io/v2/CiliumNetworkPolicy") {
    // TypeKro's authored Cilium factory intentionally uses wall-clock age as
    // a fallback. Compiler-generated policies instead need a portable strategy
    // because their artifact records are executed by Alchemy independently of
    // the authoring process. API observation is sufficient here: dataplane
    // enforcement is qualified separately by the runtime-access live gate.
    return observedResourceEvaluator as ReadinessEvaluator<unknown>;
  }
  if (gvk === "batch/v1/Job") {
    return jobCompletionEvaluator as ReadinessEvaluator<unknown>;
  }
  return undefined;
}

/**
 * KRO treats a child without readyWhen as available after the API server has
 * observed it. Reconstructed raw CRs use the same default in direct mode;
 * application-level status expressions remain responsible for richer domain
 * readiness.
 */
export function observedResourceReadinessEvaluator(): ReadinessEvaluator<unknown> {
  return observedResourceEvaluator as ReadinessEvaluator<unknown>;
}

function numericValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
