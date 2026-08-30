import { digestApplicationDeploymentValue } from '@applik8s/deployment-contract';

export const applicationCelldWorkerVersion = '0.8.0';
export interface ApplicationCelldRuntimeRelease {
  /** Immutable, multi-platform Celld OCI image. */
  readonly image: `ghcr.io/denoland/celld@sha256:${string}`;
  /** Exact upstream Celld release reported by the running runtime manifest. */
  readonly version: `v${number}.${number}.${number}`;
}

export const applicationCelldRuntimeRelease: ApplicationCelldRuntimeRelease = Object.freeze({
  image: 'ghcr.io/denoland/celld@sha256:f73157548ed8e54a4b50e9cecfcb0fb8e209fb4d35cf78b7c45815ce78a7929f',
  version: 'v0.4.0',
});
export const applicationCelldVersion = applicationCelldRuntimeRelease.version;
export const applicationCelldProtocolRevision = 'applik8s.actorAuthority/v1alpha1';

export interface ApplicationCelldRuntimeManifest {
  readonly apiVersion: 'applik8s.celld-runtime-artifact/v1';
  readonly workerVersion: string;
  readonly celldVersion: string;
  readonly applicationGraphDigest: string;
  readonly protocolRevision: string;
}

/**
 * Canonical, non-secret identity served by the generated Worker itself.
 *
 * The OCI digest proves the running bytes. This manifest separately binds
 * those bytes to the application graph and actor protocol they were compiled
 * for, without a circular hash over a file containing its own digest.
 */
export function applicationCelldRuntimeManifest(
  applicationGraphDigest: string,
  release: ApplicationCelldRuntimeRelease = applicationCelldRuntimeRelease,
): ApplicationCelldRuntimeManifest & { readonly manifestDigest: string } {
  assertApplicationCelldRuntimeRelease(release);
  const manifest: ApplicationCelldRuntimeManifest = {
    apiVersion: 'applik8s.celld-runtime-artifact/v1',
    workerVersion: applicationCelldWorkerVersion,
    celldVersion: release.version,
    applicationGraphDigest,
    protocolRevision: applicationCelldProtocolRevision,
  };
  return {
    ...manifest,
    manifestDigest: digestApplicationDeploymentValue(manifest),
  };
}

export function assertApplicationCelldRuntimeRelease(
  release: ApplicationCelldRuntimeRelease,
): void {
  const digest = release.image.slice(release.image.lastIndexOf('@') + 1);
  if (!/^sha256:[a-f0-9]{64}$/u.test(digest)) {
    throw new Error(
      'A Celld runtime release must use an immutable sha256 OCI index digest.',
    );
  }
  if (!/^v[0-9]+\.[0-9]+\.[0-9]+$/u.test(release.version)) {
    throw new Error('A Celld runtime release must declare its exact upstream vMAJOR.MINOR.PATCH version.');
  }
}
