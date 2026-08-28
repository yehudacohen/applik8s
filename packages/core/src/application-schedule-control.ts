/** Canonical identity of the framework-owned schedule-management boundary. */
export interface ApplicationScheduleControlIdentity {
  readonly capabilityId: string;
  readonly nodeId: string;
  readonly serviceName: string;
  readonly port: 8080;
  readonly podSelector: Readonly<Record<string, string>>;
}

/**
 * Keeps semantic access, generated Services, and target network policy bound
 * to one identity without exposing deployment details to application code.
 */
export function applicationScheduleControlIdentity(
  application: string,
): ApplicationScheduleControlIdentity {
  const name = kubernetesName(`${application}-schedule-control`);
  return Object.freeze({
    capabilityId: `framework.schedule-control.${application}`,
    nodeId: `schedule-control.${application}`,
    serviceName: name,
    port: 8080,
    podSelector: Object.freeze({
      'app.kubernetes.io/name': name,
      'app.kubernetes.io/component': 'schedule-control',
      'applik8s.dev/graph': application,
    }),
  });
}

function kubernetesName(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'app';
}
