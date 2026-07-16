export {
  createApplik8sServerQueryOperation,
  currentApplik8sServerRequest,
  runWithApplik8sServerRequest,
} from '@applik8s/vite/server';
export type { Applik8sServerRequestRuntime } from '@applik8s/vite/server';

// Compatibility aliases for the initial v0.6 prototype.
export {
  createApplik8sServerQueryOperation as createApplik8sStartServerQueryOperation,
  currentApplik8sServerRequest as currentApplik8sStartRequest,
  runWithApplik8sServerRequest as runWithApplik8sStartRequest,
} from '@applik8s/vite/server';
