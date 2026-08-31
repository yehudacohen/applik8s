/** Focused generated query-gateway runtime with no command or stream transport. */

export type { ApplicationQueryMultiplexProxyOptions, ApplicationQueryMultiplexProxyTarget } from './application-query-multiplex-proxy.js';
export { proxyApplicationQueryMultiplex } from './application-query-multiplex-proxy.js';
export { applicationRequestContextValues } from './command-principal.js';
export { createApplicationQueryGateway, createApplicationQueryGatewayHttpHandler, createApplicationSubscriptionLimiter } from './query-gateway.js';
export type { ApplicationGatewayIdentity, ApplicationQueryGateway, ApplicationQueryGatewayOptions, ApplicationQuerySignalCapability } from './query-gateway.js';
export { createApplicationQuerySelection, createDeterministicApplicationQuerySelectionRuntime, evaluateApplicationQuerySelection, installApplicationQuerySelectionRuntimeResolver, materializeApplicationQuerySelection } from './application-query-selection.js';
export type { ApplicationQuerySelection, ApplicationQuerySelectionContract, ApplicationQuerySelectionMaterializationRequest, ApplicationQuerySelectionRuntime } from './application-query-selection.js';
export {
  applicationAdmittedContextDigest,
  applicationDatabaseHandle,
  createApplicationRelationalContext,
  withApplicationDatabaseRuntimeResolver,
} from './relational-runtime.js';
