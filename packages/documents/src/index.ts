import { module } from '@applik8s/applik8s';
import {
  applicationDocumentCommentRelations,
  applicationDocumentComments,
  applicationDocumentRelations,
  applicationDocumentRevisionRelations,
  applicationDocumentRevisions,
  applicationDocumentSchema,
  applicationDocuments,
} from './schema.js';

export * from './schema.js';
export * from './queries.js';

export const documents = module(
  'documents',
  { schema: applicationDocumentSchema },
  () => ({
    Document: applicationDocuments,
    DocumentRevision: applicationDocumentRevisions,
    DocumentComment: applicationDocumentComments,
    DocumentRelations: applicationDocumentRelations,
    DocumentRevisionRelations: applicationDocumentRevisionRelations,
    DocumentCommentRelations: applicationDocumentCommentRelations,
  }),
);
