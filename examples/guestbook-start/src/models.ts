import { entity } from '@applik8s/applik8s/dsl';
import { type } from 'arktype';
import { app } from './app';

const PublishedGuestBookEntry = type({
  id: 'string',
  author: 'string',
  message: 'string',
  publishedAt: 'string',
});

export type PublishedGuestBookEntry = typeof PublishedGuestBookEntry.infer;

export const GuestBookEntity = entity('GuestBook', {
  spec: type({ title: 'string', 'description?': 'string' }),
  status: type({
    "phase?": "'Pending' | 'Ready' | 'Degraded'",
    'publishedCount?': 'number',
    'contentRevision?': 'string',
    'lastPublishedAt?': 'string',
    'message?': 'string',
  }),
});

export const GuestBookEntryEntity = entity('GuestBookEntry', {
  spec: type({
    guestbook: 'string',
    author: 'string',
    message: 'string',
  }),
  status: type({
    "phase?": "'Pending' | 'Published' | 'Rejected'",
    'publishedAt?': 'string',
    'rejectedAt?': 'string',
    'reason?': 'string',
    'fingerprint?': 'string',
  }),
});

export const GuestBook = app.crd(GuestBookEntity, {
  apiVersion: 'guestbook.applik8s.dev/v1alpha1',
});

export const GuestBookEntry = app.crd(GuestBookEntryEntity, {
  apiVersion: 'guestbook.applik8s.dev/v1alpha1',
  create: {
    authorize: ({ context, input }) =>
      context.role !== 'reader' && context.guestbook === input.guestbook,
    place: ({ context, input }) => ({
      namespace: String(context.namespace),
      generateName: `${input.guestbook}-entry-`,
      labels: { 'guestbook.applik8s.dev/book': input.guestbook },
    }),
  },
});

export const PublishedEntries = GuestBookEntry.view(
  {
    input: type({ guestbook: 'string', 'limit?': 'number' }),
    output: PublishedGuestBookEntry.array(),
    authorize: ({ principal, context, input }) =>
      principal.id.length > 0 && context.guestbook === input.guestbook,
    select: {
      namespace: (_input, { context }) => String(context.namespace),
      labelSelector: input => `guestbook.applik8s.dev/book=${input.guestbook}`,
      where: entry => entry.status?.phase === 'Published',
      orderBy: (left, right) =>
        String(right.metadata.creationTimestamp ?? '').localeCompare(String(left.metadata.creationTimestamp ?? '')),
      limit: input => input.limit ?? 20,
      bounds: { pageSize: 250, maxPages: 20, maxItems: 5_000 },
    },
    budgets: { maxRows: 50 },
  },
  function published(entry) {
    return {
      id: entry.metadata.name,
      author: entry.spec.author,
      message: entry.spec.message,
      publishedAt: entry.status?.publishedAt ?? entry.metadata.creationTimestamp ?? '',
    };
  },
);

GuestBookEntry.on.reconcile(async function publishGuestBookEntry(entry) {
  const normalized = entry.spec.message.trim().replace(/\s+/g, ' ');
  if (/https?:\/\//i.test(normalized)) {
    if (entry.status.phase === 'Rejected' && entry.status.reason === 'Links are disabled for this GuestBook.') return;
    entry.status.phase = 'Rejected';
    entry.status.rejectedAt = new Date().toISOString();
    entry.status.reason = 'Links are disabled for this GuestBook.';
    return;
  }
  const fingerprint = `${entry.spec.guestbook}:${entry.spec.author}:${normalized}`;
  if (entry.status.phase === 'Published' && entry.status.fingerprint === fingerprint && entry.status.publishedAt) return;
  entry.status.phase = 'Published';
  entry.status.publishedAt = new Date().toISOString();
  entry.status.fingerprint = fingerprint;
});
