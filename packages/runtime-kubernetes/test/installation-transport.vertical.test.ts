import { describe, expect, it } from 'vitest';
import { kubernetesApplicationInstallationTransport } from '../src/index.js';

describe('Kubernetes application installation transport', () => {
  it('fails closed instead of adopting ambient kubeconfig', async () => {
    // typecast: This adversarial JavaScript-boundary call intentionally omits the newly required source to prove runtime fail-closed behavior.
    await expect(kubernetesApplicationInstallationTransport({
      apiVersion: 'applications.applik8s.dev/v1alpha1',
      kind: 'Application',
      plural: 'applications',
      context: 'explicit-context',
      deleteInstance: async () => undefined,
    } as never)).rejects.toThrow(
      'requires exactly one of kubeConfig, kubeConfigPath, or inCluster: true; ambient kubeconfig is never adopted',
    );
  });
});
