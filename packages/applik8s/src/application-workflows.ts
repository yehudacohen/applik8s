/**
 * Stable workflow authoring facade.
 *
 * Registration, serialization, runtime resolution, signal persistence, and
 * gateway transport live behind separate modules. Keeping this entrypoint as
 * a facade prevents the public workflow surface from accumulating provider
 * and runtime responsibilities.
 */
export * from './application-workflow-registration.js';
