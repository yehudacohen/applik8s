import { module } from '@applik8s/applik8s';
import {
  applicationDataLifecycleRequests,
  applicationDataLifecycleSchema,
} from './schema.js';

export * from './schema.js';

export const dataLifecycle = module(
  'data-lifecycle',
  { schema: applicationDataLifecycleSchema },
  () => ({ DataLifecycleRequest: applicationDataLifecycleRequests }),
);
