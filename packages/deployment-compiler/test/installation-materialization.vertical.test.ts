// typecast-file-boundary: Fixtures intentionally inspect symbolic and concrete
// JSON values on both sides of the installation materialization boundary.
import { describe, expect, it } from 'vitest';
import { materializeInstallationValue } from '../src/installation-materialization.js';

describe('installation-bound deployment validation', () => {
  it('concretizes exact and interpolated schema references without mutating the authored graph', () => {
    const authored = {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: {
        name: '${schema.spec.name}-gateway',
        namespace: '${schema.spec.name}',
      },
      spec: {
        template: {
          spec: {
            containers: [{
              name: 'gateway',
              image: 'registry.example/${schema.spec.version}/gateway',
            }],
          },
        },
      },
    } as const;

    expect(materializeInstallationValue(authored, {
      name: 'chirp-dedicated',
      version: 'sha-1234',
    })).toEqual({
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: {
        name: 'chirp-dedicated-gateway',
        namespace: 'chirp-dedicated',
      },
      spec: {
        template: {
          spec: {
            containers: [{
              name: 'gateway',
              image: 'registry.example/sha-1234/gateway',
            }],
          },
        },
      },
    });
    expect(authored.metadata.namespace).toBe('${schema.spec.name}');
  });

  it('fails closed when a structured value is interpolated into text', () => {
    expect(() => materializeInstallationValue(
      { value: 'prefix-${schema.spec.provider}' },
      { provider: { kind: 'postgres' } },
    )).toThrow(/cannot interpolate installation path schema\.spec\.provider as text/u);
  });

  it('evaluates the canonical installation equality conditional without executing source text', () => {
    expect(materializeInstallationValue(
      '${(schema.spec.exposure.mode) == "ingress" ? (false) : (true)}',
      { exposure: { mode: 'ingress' } },
    )).toBe(false);
    expect(materializeInstallationValue(
      '${(schema.spec.profile) == "dedicated" ? ("managed") : ("external")}',
      { profile: 'starter' },
    )).toBe('external');
  });

  it('preserves schema expressions outside the supported concrete grammar for their owning adapter', () => {
    expect(materializeInstallationValue(
      '${schema.spec.replicas > 1 ? true : false}',
      { replicas: 2 },
    )).toBe('${schema.spec.replicas > 1 ? true : false}');
  });
});
