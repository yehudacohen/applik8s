import type { ApplicationModelTransactionParticipant } from '@applik8s/applik8s';
import { isApplicationRelationalModel } from '@applik8s/applik8s/drizzle';
import { getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  applicationDocumentComments,
  applicationDocumentRevisions,
  applicationDocuments,
  documents,
} from '../src/index.js';

describe('maintained documents module', () => {
  it('owns a revisioned mutable document and immutable revision history', () => {
    const participant: ApplicationModelTransactionParticipant = applicationDocuments;
    expect(getTableName(applicationDocuments)).toBe('documents');
    expect(getTableName(applicationDocumentRevisions)).toBe('document_revisions');
    expect(getTableName(applicationDocumentComments)).toBe('document_comments');
    expect(applicationDocuments.revision.notNull).toBe(true);
    expect(applicationDocuments.version.notNull).toBe(true);
    expect(applicationDocuments.version.hasDefault).toBe(true);
    expect(applicationDocuments.principalScope.notNull).toBe(true);
    expect(applicationDocuments.principalScope.hasDefault).toBe(true);
    expect(applicationDocumentRevisions.documentId.notNull).toBe(true);
    expect(applicationDocumentComments.documentId.notNull).toBe(true);
    expect(applicationDocumentComments.principalScope.hasDefault).toBe(true);
    expect(isApplicationRelationalModel(applicationDocuments)).toBe(true);
    expect(isApplicationRelationalModel(applicationDocumentRevisions)).toBe(true);
    expect(isApplicationRelationalModel(applicationDocumentComments)).toBe(true);
    expect(typeof documents).toBe('function');
    expect(participant).toBe(applicationDocuments);
  });
});
