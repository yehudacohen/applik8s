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
      `ghcr.io/denoland/celld@${applicationCelldRuntimeRelease.version}`,
    );
    const { manifestDigest, ...identity } = manifest;
    expect(manifestDigest).toBe(digestApplicationDeploymentValue(identity));
  });

  it('rejects release metadata that can misreport the running image', () => {
    const mismatched = {
      image: `ghcr.io/denoland/celld@sha256:${'b'.repeat(64)}`,
      version: `sha256:${'c'.repeat(64)}`,
    } as ApplicationCelldRuntimeRelease;
    expect(() => applicationCelldRuntimeManifest(`sha256:${'a'.repeat(64)}`, mismatched))
      .toThrow(/same immutable sha256 OCI index digest/u);
  });
});
