// typecast-file-boundary: Digest fixtures deliberately restore branded sha256
// identities only after constructing their complete canonical form.
import { digestApplicationDeploymentValue } from '@applik8s/deployment-contract';
import { describe, expect, it } from 'vitest';
import {
  type ApplicationCelldRuntimeRelease,
  applicationCelldRuntimeManifest,
  applicationCelldRuntimeRelease,
} from '../src/index.js';

describe('Celld runtime artifact identity', () => {
  it('binds the runtime manifest and image to one immutable OCI index digest', () => {
    const manifest = applicationCelldRuntimeManifest(`sha256:${'a'.repeat(64)}`);
    expect(manifest.celldVersion).toBe(applicationCelldRuntimeRelease.version);
    expect(applicationCelldRuntimeRelease.image).toBe(
      'ghcr.io/denoland/celld@sha256:f73157548ed8e54a4b50e9cecfcb0fb8e209fb4d35cf78b7c45815ce78a7929f',
    );
    expect(applicationCelldRuntimeRelease.version).toBe('v0.4.0');
    const { manifestDigest, ...identity } = manifest;
    expect(manifestDigest).toBe(digestApplicationDeploymentValue(identity));
  });

  it('rejects release metadata that can misreport the running image', () => {
    const mismatched = {
      image: 'ghcr.io/denoland/celld:latest' as ApplicationCelldRuntimeRelease['image'],
      version: 'v0.4.0',
    } satisfies ApplicationCelldRuntimeRelease;
    expect(() => applicationCelldRuntimeManifest(`sha256:${'a'.repeat(64)}`, mismatched))
      .toThrow(/immutable sha256 OCI index digest/u);
  });
});
