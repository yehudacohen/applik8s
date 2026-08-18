import { module } from '@applik8s/applik8s';
import { applicationIntegrationConnections, applicationIntegrationSchema } from './schema.js';

export * from './schema.js';
export * from './queries.js';

export const integrations = module(
  'integrations',
  { schema: applicationIntegrationSchema },
  () => ({ IntegrationConnection: applicationIntegrationConnections }),
);
