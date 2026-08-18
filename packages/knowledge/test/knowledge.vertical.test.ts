import { isApplicationRelationalModel } from '@applik8s/applik8s/drizzle';
import { getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  applicationKnowledgeSources,
  assembleApplicationKnowledgeContext,
  knowledge,
} from '../src/index.js';

describe('maintained knowledge module', () => {
  it('owns safe object provenance and durable ingestion state', () => {
    expect(getTableName(applicationKnowledgeSources)).toBe('knowledge_sources');
    expect(applicationKnowledgeSources.uploadReceipt.notNull).toBe(false);
    expect(applicationKnowledgeSources.processingStage.notNull).toBe(false);
    expect(applicationKnowledgeSources.principalScope.hasDefault).toBe(true);
    expect(isApplicationRelationalModel(applicationKnowledgeSources)).toBe(true);
    expect(typeof knowledge).toBe('function');
  });

  it('assembles relevance-ordered knowledge under a total UTF-8 byte budget', () => {
    const context = assembleApplicationKnowledgeContext([
      { id: 'one', title: 'First', content: '😀'.repeat(100) },
      { id: 'two', title: 'Second', content: 'second source'.repeat(20) },
    ], { maximumBytes: 180, maximumSourceBytes: 120 });

    expect(new TextEncoder().encode(context).byteLength).toBeLessThanOrEqual(180);
    expect(context).toContain('## First');
    expect(context).not.toContain('\ufffd');
  });
});
