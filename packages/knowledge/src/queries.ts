import type {
  ApplicationDatabaseBinding,
  ApplicationModelViewContext,
} from '@applik8s/applik8s';
import { type } from 'arktype';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { applicationKnowledgeSources } from './schema.js';

export const applicationKnowledgeItemSchema = type({
  id: 'string', title: 'string', kind: 'string', content: 'string',
  'sourceUrl?': 'string', 'objectKey?': 'string', 'mediaType?': 'string',
  'size?': 'number', 'sha256?': 'string', 'processingStage?': 'string',
  'indexedAt?': 'string', 'chunkCount?': 'number', 'failureReason?': 'string',
  state: "'processing' | 'ready' | 'failed' | 'disabled'",
  createdAt: 'string', updatedAt: 'string',
});

export const applicationAgentKnowledgeContextSchema = type({
  id: 'string', title: 'string', content: 'string', 'sourceUrl?': 'string',
}).array();

export interface ApplicationKnowledgeQueryOptions<TSchema extends Readonly<Record<string, unknown>>> {
  readonly database: ApplicationDatabaseBinding<TSchema>;
  readonly scope: (context: ApplicationModelViewContext) => string;
}

export interface ApplicationKnowledgeContextSource {
  readonly id: string;
  readonly title: string;
  readonly content: string;
}

/** Builds relevance-ordered agent context under a hard UTF-8 byte ceiling. */
export function assembleApplicationKnowledgeContext(
  sources: readonly ApplicationKnowledgeContextSource[],
  options: {
    readonly maximumBytes?: number;
    readonly maximumSourceBytes?: number;
  } = {},
): string {
  const maximumBytes = boundedContextBytes(
    options.maximumBytes ?? 48_000,
    'maximumBytes',
  );
  const maximumSourceBytes = Math.min(
    maximumBytes,
    boundedContextBytes(
      options.maximumSourceBytes ?? 12_000,
      'maximumSourceBytes',
    ),
  );
  const sections: string[] = [];
  let used = 0;
  for (const source of sources) {
    const separator = sections.length === 0 ? '' : '\n\n';
    const header = `## ${source.title.trim() || source.id}\n`;
    const fixedBytes = utf8Bytes(separator) + utf8Bytes(header);
    const remaining = maximumBytes - used - fixedBytes;
    if (remaining <= 0) break;
    const content = truncateUtf8(
      source.content.trim(),
      Math.min(maximumSourceBytes, remaining),
    );
    if (!content) continue;
    const section = `${separator}${header}${content}`;
    sections.push(section);
    used += utf8Bytes(section);
  }
  return sections.join('');
}

function boundedContextBytes(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000) {
    throw new Error(`Knowledge context ${field} must be an integer from 1 to 1000000 bytes.`);
  }
  return value;
}

function truncateUtf8(value: string, maximumBytes: number): string {
  if (utf8Bytes(value) <= maximumBytes) return value;
  const suffix = '…';
  const available = Math.max(0, maximumBytes - utf8Bytes(suffix));
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const boundary = safeUtf16Boundary(value, middle);
    if (utf8Bytes(value.slice(0, boundary)) <= available) low = middle;
    else high = middle - 1;
  }
  const truncated = value.slice(0, safeUtf16Boundary(value, low)).trimEnd();
  return truncated ? `${truncated}${suffix}` : '';
}

function safeUtf16Boundary(value: string, index: number): number {
  if (
    index > 0
    && index < value.length
    && value.charCodeAt(index - 1) >= 0xd800
    && value.charCodeAt(index - 1) <= 0xdbff
  ) return index - 1;
  return index;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export async function listApplicationKnowledgeSources<TSchema extends Readonly<Record<string, unknown>>>(
  _input: object,
  context: ApplicationModelViewContext,
  options: ApplicationKnowledgeQueryOptions<TSchema>,
) {
  const rows = await context.database(options.database).select({
    id: applicationKnowledgeSources.id, title: applicationKnowledgeSources.title,
    kind: applicationKnowledgeSources.kind, content: applicationKnowledgeSources.content,
    sourceUrl: applicationKnowledgeSources.sourceUrl, objectKey: applicationKnowledgeSources.objectKey,
    mediaType: applicationKnowledgeSources.mediaType, size: applicationKnowledgeSources.size,
    sha256: applicationKnowledgeSources.sha256, processingStage: applicationKnowledgeSources.processingStage,
    indexedAt: applicationKnowledgeSources.indexedAt, chunkCount: applicationKnowledgeSources.chunkCount,
    failureReason: applicationKnowledgeSources.failureReason, state: applicationKnowledgeSources.state,
    createdAt: applicationKnowledgeSources.createdAt, updatedAt: applicationKnowledgeSources.updatedAt,
  }).from(applicationKnowledgeSources)
    .where(eq(applicationKnowledgeSources.principalScope, options.scope(context)))
    .orderBy(desc(applicationKnowledgeSources.updatedAt)).limit(100);
  return rows.map(source => ({
    id: source.id, title: source.title, kind: source.kind, content: source.content,
    ...(source.sourceUrl ? { sourceUrl: source.sourceUrl } : {}),
    ...(source.objectKey ? { objectKey: source.objectKey } : {}),
    ...(source.mediaType ? { mediaType: source.mediaType } : {}),
    ...(source.size === null ? {} : { size: source.size }),
    ...(source.sha256 ? { sha256: source.sha256 } : {}),
    ...(source.processingStage ? { processingStage: source.processingStage } : {}),
    ...(source.indexedAt ? { indexedAt: source.indexedAt } : {}),
    ...(source.chunkCount === null ? {} : { chunkCount: source.chunkCount }),
    ...(source.failureReason ? { failureReason: source.failureReason } : {}),
    state: source.state, createdAt: source.createdAt, updatedAt: source.updatedAt,
  }));
}

export async function loadApplicationAgentKnowledge<TSchema extends Readonly<Record<string, unknown>>>(
  input: { readonly sourceIds?: readonly string[] },
  context: ApplicationModelViewContext,
  options: ApplicationKnowledgeQueryOptions<TSchema>,
) {
  const conditions = [
    eq(applicationKnowledgeSources.principalScope, options.scope(context)),
    eq(applicationKnowledgeSources.state, 'ready'),
    ...(input.sourceIds && input.sourceIds.length > 0
      ? [inArray(applicationKnowledgeSources.id, [...input.sourceIds])]
      : []),
  ];
  const rows = await context.database(options.database).select({
    id: applicationKnowledgeSources.id, title: applicationKnowledgeSources.title,
    content: applicationKnowledgeSources.content, sourceUrl: applicationKnowledgeSources.sourceUrl,
  }).from(applicationKnowledgeSources).where(and(...conditions))
    .orderBy(desc(applicationKnowledgeSources.updatedAt)).limit(20);
  return rows.map(source => ({
    id: source.id, title: source.title, content: source.content.slice(0, 8_000),
    ...(source.sourceUrl ? { sourceUrl: source.sourceUrl } : {}),
  }));
}
