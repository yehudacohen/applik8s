/**
 * Focused handler-safe query-batch runtime surface. Generated finite-Job
 * workers import this module instead of the application authoring umbrella.
 */
export {
  type ApplicationQueryBatch,
  type ApplicationQueryBatchConsistency,
  type ApplicationQueryBatchFrontierReference,
  type ApplicationQueryBatchHandler,
  type ApplicationQueryBatchOptions,
  type ApplicationQueryBatchPreparedScan,
  type ApplicationQueryBatchProgress,
  type ApplicationQueryBatchResult,
  type ApplicationQueryBatchRuntime,
  type ApplicationQueryBatchRuntimeResolver,
  type ApplicationQueryBatchWindow,
  type ApplicationQueryBatchWindowRead,
  applicationQueryBatchProtocol,
  applicationQueryBatchRuntime,
  executeApplicationQueryBatch,
  installApplicationQueryBatchRuntimeResolver,
} from './application-query-batching.js';
export type { ApplicationQuerySelectionContract } from './application-query-selection.js';
