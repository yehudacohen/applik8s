/**
 * Browser-safe TanStack AI transport surface.
 *
 * Keep this entrypoint separate from server tool adaptation so Vite never has
 * to tree-shake operation executors, durable stores, or Node cryptography out
 * of a browser graph.
 */
export {
  createApplicationTanStackConnection,
  type ApplicationTanStackConnectionOptions,
} from './connection.js';
