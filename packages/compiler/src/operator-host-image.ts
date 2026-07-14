import { type ImageRef, imageRefString } from '@applik8s/typetainer';

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
  tag: 'v0.5.0',
});

export const DEFAULT_OPERATOR_HOST_IMAGE_REFERENCE = imageRefString(DEFAULT_OPERATOR_HOST_IMAGE);
