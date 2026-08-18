import { readFileSync } from 'node:fs';
import { type ImageRef, imageRefString } from '@applik8s/typetainer';

const compilerPackageManifest: unknown = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

if (
  typeof compilerPackageManifest !== 'object'
  || compilerPackageManifest === null
  || !('version' in compilerPackageManifest)
  || typeof compilerPackageManifest.version !== 'string'
  || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(compilerPackageManifest.version)
) {
  throw new Error('The @applik8s/compiler package manifest does not contain a valid release version.');
}

export const COMPILER_PACKAGE_VERSION = compilerPackageManifest.version;

/**
 * The released, multi-platform operator host used by generated runtime images.
 *
 * The release workflow publishes and verifies this immutable semver tag before
 * npm packages are published, avoiding a digest/bootstrap cycle for the same
 * release. Published verification records the resolved multi-platform digest.
 */
export const DEFAULT_OPERATOR_HOST_IMAGE: ImageRef = Object.freeze({
  registry: 'ghcr.io',
  repository: 'yehudacohen/applik8s-operator-host',
  tag: `v${COMPILER_PACKAGE_VERSION}`,
});

export const DEFAULT_OPERATOR_HOST_IMAGE_REFERENCE = imageRefString(DEFAULT_OPERATOR_HOST_IMAGE);
