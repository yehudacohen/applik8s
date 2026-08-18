import { module } from '@applik8s/applik8s';
import { applicationKnowledgeSchema, applicationKnowledgeSources } from './schema.js';

export * from './schema.js';
export * from './queries.js';

export const knowledge = module(
  'knowledge',
  { schema: applicationKnowledgeSchema },
  () => ({ KnowledgeSource: applicationKnowledgeSources }),
);
