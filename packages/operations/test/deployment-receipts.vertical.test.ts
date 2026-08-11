import { describe, expect, it } from 'vitest';
import {
  createApplicationDeploymentEvidenceReceipt,
  validateApplicationDeploymentEvidenceReceipt,
} from '../src/index.js';

const sha = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}`;

describe('application deployment evidence receipts', () => {
  it('binds redacted evidence to the exact graph, artifact set, cluster, and installation', () => {
    const receipt = createApplicationDeploymentEvidenceReceipt({
      id: 'deploy:run-1',
      action: 'deploy',
      state: 'ready',
      sourceGraphDigest: sha('a'),
      deploymentGraphDigest: sha('b'),
      artifactSetDigest: sha('c'),
      installation: {
        application: 'chirp',
        namespace: 'chirp-control',
        name: 'chirp',
        profile: 'dedicated',
      },
      cluster: {
        provider: 'kubernetes',
        identity: 'orbstack',
        digest: sha('d'),
      },
      observedAt: '2026-08-10T12:00:00.000Z',
      expiresAt: '2026-08-10T16:00:00.000Z',
      evidence: {
        resourceCount: 42,
        appliedArtifactCount: 3,
        declarationCount: 41,
        instanceState: 'ready',
        endpointObserved: true,
      },
    });
    expect(validateApplicationDeploymentEvidenceReceipt(receipt, {
      application: 'chirp',
      sourceGraphDigest: sha('a'),
      deploymentGraphDigest: sha('b'),
      clusterDigest: sha('d'),
      installationName: 'chirp',
      installationNamespace: 'chirp-control',
      now: new Date('2026-08-10T12:01:00.000Z'),
    })).toEqual(receipt);
    expect(receipt.integrity.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('rejects tampering, stale evidence, context drift, and sensitive fields', () => {
    const receipt = createApplicationDeploymentEvidenceReceipt({
      id: 'status:run-1',
      action: 'status',
      state: 'unknown',
      sourceGraphDigest: sha('a'),
      deploymentGraphDigest: sha('b'),
      artifactSetDigest: sha('c'),
      installation: {
        application: 'chirp',
        namespace: 'chirp-control',
        name: 'chirp',
        profile: 'dedicated',
      },
      cluster: {
        provider: 'kubernetes',
        identity: 'orbstack',
        digest: sha('d'),
      },
      observedAt: '2026-08-10T12:00:00.000Z',
      expiresAt: '2026-08-10T13:00:00.000Z',
      evidence: {
        instanceState: 'unknown',
        definitionState: 'ready',
        resourceCount: 42,
        pendingChangeCount: 1,
        declarationCount: 41,
      },
    });
    expect(() => validateApplicationDeploymentEvidenceReceipt({
      ...receipt,
      state: 'ready',
    }, { now: new Date('2026-08-10T12:01:00.000Z') })).toThrow('integrity');
    expect(() => validateApplicationDeploymentEvidenceReceipt(receipt, {
      clusterDigest: sha('e'),
      now: new Date('2026-08-10T12:01:00.000Z'),
    })).toThrow('cluster');
    expect(() => validateApplicationDeploymentEvidenceReceipt(receipt, {
      now: new Date('2026-08-10T13:01:00.000Z'),
    })).toThrow('stale');
    expect(() => createApplicationDeploymentEvidenceReceipt({
      ...receipt,
      evidence: { accessToken: 'must-not-cross' },
    })).toThrow('does not permit');
    expect(() => createApplicationDeploymentEvidenceReceipt({
      ...receipt,
      evidence: { instanceState: { nested: 'not-public-contract' } },
    })).toThrow('bounded scalar');
  });
});
