/**
 * WASM-safe operator authoring entrypoint.
 *
 * This surface deliberately excludes application infrastructure, TypeKro,
 * database, queue, and compiler modules so an operator closure cannot pull
 * Node-oriented dependencies into its component by importing the framework.
 */
export type * from '@applik8s/core';
export * from '@applik8s/sdk';
export type * from './dns.js';
export { decideExternalDnsPublication, decideExternalDnsPublicationDelete, dns, externalDnsCapabilities, externalDnsEndpointResource, externalDnsPublicationMetadata, externalDnsPublicationName, normalizeDnsPublicationIntent } from './dns.js';
