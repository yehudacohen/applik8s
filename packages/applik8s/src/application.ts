/**
 * Stable application-authoring facade.
 *
 * Builder internals delegate models, providers, workflows, projections,
 * exposures, routing, and managed effects to focused modules. Keeping this
 * public entrypoint free of implementation responsibilities makes new
 * execution families additive instead of accretive.
 */
export * from './application-builder.js';
