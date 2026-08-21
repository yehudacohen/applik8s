import type { ApplicationAdmissionInvocationContextV1 } from '@applik8s/core';

/**
 * Runtime-owned lookup for the canonical admission of the currently executing
 * managed closure. Generated Node runtimes normally back this with
 * AsyncLocalStorage; browser and test adapters may install their own isolated
 * resolver. Keeping storage out of this portable package avoids introducing a
 * Node runtime dependency into callable application handles.
 */
const admissionResolvers: Array<
  () => ApplicationAdmissionInvocationContextV1 | undefined
> = [];

export function installApplicationInvocationAdmissionResolver(
  resolver: () => ApplicationAdmissionInvocationContextV1 | undefined,
): () => void {
  admissionResolvers.push(resolver);
  return () => {
    const index = admissionResolvers.lastIndexOf(resolver);
    if (index >= 0) admissionResolvers.splice(index, 1);
  };
}

export function currentApplicationInvocationAdmission():
  | ApplicationAdmissionInvocationContextV1
  | undefined {
  for (let index = admissionResolvers.length - 1; index >= 0; index -= 1) {
    const admission = admissionResolvers[index]?.();
    if (admission) return admission;
  }
  return undefined;
}

export function requireApplicationInvocationAdmission(): ApplicationAdmissionInvocationContextV1 {
  const admission = currentApplicationInvocationAdmission();
  if (!admission) {
    throw new Error(
      'This callable requires an active managed-execution admission. Invoke it from an admitted HTTP handler, operation, processor, workflow, schedule, actor, agent, or an explicit deterministic test scope.',
    );
  }
  return admission;
}
