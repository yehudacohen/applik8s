import { isApplicationRelationalModel } from '@applik8s/applik8s/drizzle';
import { getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  applicationDataLifecycleRequests,
  dataLifecycle,
} from '../src/index.js';

describe('provider-neutral data lifecycle module', () => {
  it('owns generic request state without importing a product domain', () => {
    expect(getTableName(applicationDataLifecycleRequests)).toBe('data_lifecycle_requests');
    expect(isApplicationRelationalModel(applicationDataLifecycleRequests)).toBe(true);
    expect(applicationDataLifecycleRequests.scope.notNull).toBe(true);
    expect(applicationDataLifecycleRequests.progress.notNull).toBe(true);
    expect(applicationDataLifecycleRequests.progress.hasDefault).toBe(true);
    expect('deletedDocuments' in applicationDataLifecycleRequests).toBe(false);
    expect('archivedConversations' in applicationDataLifecycleRequests).toBe(false);
    expect('retainedArtifacts' in applicationDataLifecycleRequests).toBe(false);
    expect(typeof dataLifecycle).toBe('function');
  });
});
