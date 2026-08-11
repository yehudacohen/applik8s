/**
 * @internal Longitudinal release-fixture seam.
 *
 * v0.7 intentionally exposes no custom model-command authoring surface. The
 * v0.4 pressure test still compiles its historical graph through this isolated
 * entrypoint so old release evidence remains executable without restoring the
 * removed API to the package root.
 */
export { applicationModelCommandRegistrar } from './application-models.js';
