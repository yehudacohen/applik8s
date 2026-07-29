/** Focused generated query-gateway runtime with no command or stream transport. */
export { applicationAdmittedContextDigest, createApplicationRelationalContext } from './relational-runtime.js';
export { applicationRequestContextValues } from './command-principal.js';
export { createApplicationQueryGateway, createApplicationQueryGatewayHttpHandler, createApplicationSubscriptionLimiter } from './query-gateway.js';
export { proxyApplicationQueryMultiplex } from './application-query-multiplex-proxy.js';
export type { ApplicationQueryMultiplexProxyOptions, ApplicationQueryMultiplexProxyTarget } from './application-query-multiplex-proxy.js';
