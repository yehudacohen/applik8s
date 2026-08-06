import { AI } from '@applik8s/ai';
import {
  applicationAgenticModuleSchema,
  configureAgenticProfiles,
} from '@applik8s/start-agentic';
import { application } from './app';
import { AccessRequest } from './features/access/schema';

export const {
  database,
  analytics,
  eventLog,
  objects,
  search,
  workflows,
  inference,
  identity,
} = configureAgenticProfiles(application, {
  application: "identity-start",
  namespace: "identity-start-system",
  schema: { ...applicationAgenticModuleSchema, AccessRequest },
  migrations: { path: '../drizzle' },
  starterInference: () =>
    AI.deterministic({
      fixture: {
        response:
          'A bounded access request was submitted for durable human review.',
        tool: {
          index: 0,
          input: {
            operation: 'catalog.repair',
            target: 'production/agent-fixture',
            evidence:
              'Agent fixture incident INC-AGENT-070 proves a bounded catalog repair is required.',
            intendedOutcome:
              'Restore catalog availability through one reviewed access grant.',
          },
        },
      },
    }),
});
