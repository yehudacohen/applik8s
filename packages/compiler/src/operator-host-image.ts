import { imageRefString, type ImageRef } from '@applik8s/typetainer';

/**
 * The released, multi-platform operator host used by generated runtime images.
 *
 * Keep the human-readable release tag for provenance while pinning the OCI
 * index digest so compiler output cannot drift after publication.
 */
export const DEFAULT_OPERATOR_HOST_IMAGE: ImageRef = Object.freeze({
  registry: 'ghcr.io',
  repository: 'yehudacohen/applik8s-operator-host',
  tag: 'v0.4.1',
  digest: 'sha256:467f3e36eab0509c738025f9ea3e117320d9af3843eba9e5d3ac451c625b7869',
});

export const DEFAULT_OPERATOR_HOST_IMAGE_REFERENCE = imageRefString(DEFAULT_OPERATOR_HOST_IMAGE);
