/**
 * Stable normalized application-graph facade.
 *
 * Contract definitions and validation are isolated from the package entrypoint
 * so graph consumers do not couple to the internal organization of validation,
 * compatibility, projection, gateway, and installation responsibilities.
 */
export * from './application-graph-contract.js';
