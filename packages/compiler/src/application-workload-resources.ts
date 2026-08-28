/**
 * Framework-owned Kubernetes baselines for generated Node.js workloads.
 *
 * Generated workloads must not silently become BestEffort. Applications can
 * still replace these values through deployment policy and aspects, but the
 * zero-configuration path remains schedulable and resilient under pressure.
 */
export function generatedHttpWorkerResources(): Readonly<Record<string, unknown>> {
  return {
    requests: { cpu: '100m', memory: '128Mi' },
    limits: { cpu: '1', memory: '512Mi' },
  };
}

export function generatedAgentWorkerResources(): Readonly<Record<string, unknown>> {
  return {
    requests: { cpu: '100m', memory: '192Mi' },
    limits: { cpu: '1', memory: '768Mi' },
  };
}
