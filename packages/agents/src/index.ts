import { module } from '@applik8s/applik8s';
import { applicationAgentProfiles, applicationAgentSchema } from './schema.js';

export * from './schema.js';
export * from './queries.js';

export const agents = module(
  'agents',
  { schema: applicationAgentSchema },
  () => ({ AgentProfile: applicationAgentProfiles }),
);
