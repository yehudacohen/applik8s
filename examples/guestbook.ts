import { sdk } from '@applik8s/applik8s';
import { field, label, metadata, type } from '@applik8s/applik8s/dsl';

export interface GuestBookExampleOptions {
  readonly apiGroup?: string;
  readonly namespace?: string;
  readonly operatorName?: string;
  readonly stackName?: string;
  readonly stackKind?: string;
  readonly bookName?: string;
  readonly title?: string;
  readonly description?: string;
  readonly serverImage?: string;
}

export const guestBookSpecSchema = type({
  title: 'string',
  description: 'string?',
  serverImage: 'string?',
});

export type GuestBookSpec = typeof guestBookSpecSchema.infer;

export const guestBookStatusSchema = type({
  phase: "('Pending' | 'Rendered')?",
  url: 'string?',
  entryCount: 'number?',
  pageViewsTotal: 'number?',
  pageViewsLastMinute: 'number?',
  contentHash: 'string?',
  message: 'string?',
});

export type GuestBookStatus = typeof guestBookStatusSchema.infer;

export const guestBookEntrySpecSchema = type({
  guestbook: 'string',
  author: 'string',
  message: 'string',
});

export type GuestBookEntrySpec = typeof guestBookEntrySpecSchema.infer;

export const guestBookEntryStatusSchema = type({
  phase: "('Pending' | 'Published' | 'Rejected')?",
  publishedAt: 'string?',
  rejectedAt: 'string?',
  reason: 'string?',
  fingerprint: 'string?',
  message: 'string?',
});

export type GuestBookEntryStatus = typeof guestBookEntryStatusSchema.infer;

export const guestBookPageViewBucketSpecSchema = type({
  guestbook: 'string',
  windowStart: 'string',
  count: 'number',
});

export type GuestBookPageViewBucketSpec = typeof guestBookPageViewBucketSpecSchema.infer;

export const guestBookPageViewBucketStatusSchema = type({
  observedCount: 'number?',
  observedAt: 'string?',
});

export type GuestBookPageViewBucketStatus = typeof guestBookPageViewBucketStatusSchema.infer;

const defaultOptions: Required<GuestBookExampleOptions> = {
  apiGroup: process.env.APPLIK8S_GUESTBOOK_API_GROUP ?? 'guestbook.applik8s.dev',
  namespace: process.env.APPLIK8S_GUESTBOOK_NAMESPACE ?? 'guestbook',
  operatorName: process.env.APPLIK8S_GUESTBOOK_OPERATOR_NAME ?? 'guestbook-renderer',
  stackName: process.env.APPLIK8S_GUESTBOOK_STACK_NAME ?? 'guestbook-stack',
  stackKind: process.env.APPLIK8S_GUESTBOOK_STACK_KIND ?? 'GuestBookStack',
  bookName: process.env.APPLIK8S_GUESTBOOK_BOOK_NAME ?? 'main',
  title: process.env.APPLIK8S_GUESTBOOK_TITLE ?? 'applik8s GuestBook',
  description: process.env.APPLIK8S_GUESTBOOK_DESCRIPTION ?? 'Entries are moderated CRDs served through a cached typed index.',
  serverImage: process.env.APPLIK8S_GUESTBOOK_SERVER_IMAGE ?? 'node:22-alpine',
};

export const GuestBook = sdk.crd({
  apiVersion: `${defaultOptions.apiGroup}/v1alpha1`,
  kind: 'GuestBook',
  spec: guestBookSpecSchema,
  status: guestBookStatusSchema,
});

export const GuestBookEntry = sdk.crd({
  apiVersion: `${defaultOptions.apiGroup}/v1alpha1`,
  kind: 'GuestBookEntry',
  spec: guestBookEntrySpecSchema,
  status: guestBookEntryStatusSchema,
});

export const GuestBookPageViewBucket = sdk.crd({
  apiVersion: `${defaultOptions.apiGroup}/v1alpha1`,
  kind: 'GuestBookPageViewBucket',
  spec: guestBookPageViewBucketSpecSchema,
  status: guestBookPageViewBucketStatusSchema,
});

export const publishedGuestBookEntries = GuestBookEntry.index('publishedByBookNewest', {
  partitionBy: label('guestbook.applik8s.dev/book'),
  filter: field('status.phase').eq('Published'),
  orderBy: metadata.creationTimestamp.desc(),
});

export const allGuestBookEntries = GuestBookEntry.index('allByBookNewest', {
  partitionBy: label('guestbook.applik8s.dev/book'),
  orderBy: metadata.creationTimestamp.desc(),
});

export const pageViewBuckets = GuestBookPageViewBucket.index('pageViewsByBookWindow', {
  partitionBy: label('guestbook.applik8s.dev/book'),
  orderBy: field('spec.windowStart').desc(),
});

export const guestBookRenderer = sdk.operator({
  name: defaultOptions.operatorName,
  deployment: { namespace: defaultOptions.namespace, replicas: 1 },
  resources: { GuestBook, GuestBookEntry, GuestBookPageViewBucket },
  permissions: [
    GuestBook.permissions.read(),
    GuestBook.permissions.patchStatus(),
    GuestBookEntry.permissions.read(),
    GuestBookEntry.permissions.apply(),
    GuestBookEntry.permissions.patchStatus(),
    GuestBookPageViewBucket.permissions.read(),
    GuestBookPageViewBucket.permissions.apply(),
    GuestBookPageViewBucket.permissions.patch(),
    GuestBookPageViewBucket.permissions.patchStatus(),
    sdk.permissions.k8s.ConfigMap.apply(),
    sdk.permissions.k8s.Service.apply(),
    sdk.permissions.k8s.Deployment.apply(),
    sdk.permissions.events.write(),
  ],
  handlers: [
    GuestBook.on.reconcile((book) => {
      const namespace = book.metadata.namespace ?? 'default';
      const serverUrl = `http://${book.metadata.name}-svc.${namespace}.svc.cluster.local/`;
      const renderedState = `${book.metadata.name}\n${namespace}\n${book.spec.title}\n${book.spec.description ?? ''}\n${serverUrl}`;
      let hash = 2166136261;
      for (const character of renderedState) {
        hash ^= character.charCodeAt(0);
        hash = (hash * 16777619) >>> 0;
      }
      const contentHash = (hash >>> 0).toString(16).padStart(8, '0');
      const labels = { 'app.kubernetes.io/name': book.metadata.name, 'app.kubernetes.io/component': 'guestbook', 'applik8s.dev/example': 'guestbook' };

      book.apply({
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: { name: `${book.metadata.name}-html`, namespace, labels },
        data: {
          'README.txt': `GuestBook HTML is served by ${serverUrl} from a generated app.server workload backed by the cached publishedGuestBookEntries index.`,
          contentHash,
        },
      });

      book.status.phase = 'Rendered';
      book.status.contentHash = contentHash;
      book.status.url = serverUrl;
      book.status.message = 'Generated server is serving GuestBookEntry CRDs through a cached typed index.';
      book.events.normal('GuestBookRendered', 'Generated GuestBook server is ready.');
    }),
    GuestBookEntry.on.reconcile(async (entry) => {
      const namespace = entry.metadata.namespace ?? 'default';
      const fingerprintFor = (input: string) => {
        let hash = 2166136261;
        for (const character of input) {
          hash ^= character.charCodeAt(0);
          hash = (hash * 16777619) >>> 0;
        }
        return (hash >>> 0).toString(16).padStart(8, '0');
      };
      const fingerprint = entry.metadata.labels?.['guestbook.applik8s.dev/fingerprint'] ?? fingerprintFor(`${entry.spec.guestbook}\n${entry.spec.author}\n${entry.spec.message}`);

      if (entry.spec.message.toLowerCase().includes('http://') || entry.spec.message.toLowerCase().includes('https://')) {
        entry.status.phase = 'Rejected';
        entry.status.rejectedAt = new Date().toISOString();
        entry.status.reason = 'links-disabled';
        entry.status.fingerprint = fingerprint;
        entry.status.message = 'Rejected because links are disabled for this GuestBook.';
        entry.events.normal('GuestBookEntryRejected', 'Rejected because links are disabled for this GuestBook.');
        return;
      }

      const duplicates = await entry.read.resource(GuestBookEntry).list({
        namespace,
        labels: {
          'guestbook.applik8s.dev/book': entry.spec.guestbook,
          'guestbook.applik8s.dev/fingerprint': fingerprint,
        },
      });
      if (duplicates.items.some((candidate) => candidate.metadata.name !== entry.metadata.name && candidate.status?.phase === 'Published')) {
        entry.status.phase = 'Rejected';
        entry.status.rejectedAt = new Date().toISOString();
        entry.status.reason = 'duplicate';
        entry.status.fingerprint = fingerprint;
        entry.status.message = 'Rejected as a duplicate published entry.';
        entry.events.normal('GuestBookEntryRejected', 'Rejected as a duplicate published entry.');
        return;
      }

      entry.status.phase = 'Published';
      entry.status.publishedAt = new Date().toISOString();
      entry.status.fingerprint = fingerprint;
      entry.status.message = `Published for ${entry.spec.guestbook}; aggregate workers update GuestBook status and indexes update request paths.`;
      entry.events.normal('GuestBookEntryPublished', `Published GuestBookEntry for ${entry.spec.guestbook}.`);
    }),
    GuestBookPageViewBucket.on.reconcile((bucket) => {
      bucket.status.observedCount = bucket.spec.count;
      bucket.status.observedAt = new Date().toISOString();
    }),
  ],
});

interface GuestBookEntryStats {
  readonly count: number;
}

interface GuestBookEntryAggregateEvent {
  readonly type: string;
  readonly object?: { readonly status?: GuestBookEntryStatus };
  readonly previous?: { readonly status?: GuestBookEntryStatus };
}

interface GuestBookPageViewStats {
  readonly total: number;
  readonly lastMinute: number;
}

interface GuestBookPageViewAggregateEvent {
  readonly type: string;
  readonly object?: { readonly spec?: GuestBookPageViewBucketSpec };
  readonly previous?: { readonly spec?: GuestBookPageViewBucketSpec };
}

export const guestBookStack = sdk.kubernetesComposition({
  name: defaultOptions.stackName,
  apiVersion: `${defaultOptions.apiGroup}/v1alpha1`,
  kind: defaultOptions.stackKind,
  spec: type({}),
  status: type({ ready: 'boolean' }),
}, (_spec, app) => {
  const install = guestBookRenderer({ namespace: defaultOptions.namespace, replicas: 1 });
  app.defaults({ indexes: 'valkey' });
  const guestBookMain = install.guestBook({
    name: defaultOptions.bookName,
    namespace: defaultOptions.namespace,
    spec: {
      title: defaultOptions.title,
      description: defaultOptions.description,
      serverImage: defaultOptions.serverImage,
    },
  });

  app.server('web', {
    namespace: defaultOptions.namespace,
    resourceName: `${defaultOptions.bookName}-server`,
    serviceName: `${defaultOptions.bookName}-svc`,
    serviceAccountName: `${defaultOptions.bookName}-web`,
    image: defaultOptions.serverImage,
    env: {
      GUESTBOOK_NAME: defaultOptions.bookName,
      GUESTBOOK_TITLE: defaultOptions.title,
      GUESTBOOK_DESCRIPTION: defaultOptions.description,
      GUESTBOOK_PAGE_SIZE: '5',
    },
    replicas: 1,
    service: { port: 80 },
    cache: [publishedGuestBookEntries],
    resources: { GuestBookPageViewBucket },
  }, (server) => {
    server.get('/', async (request) => {
      const bookName = process.env.GUESTBOOK_NAME ?? 'main';
      const namespace = process.env.APPLIK8S_SERVER_NAMESPACE ?? 'default';
      const pageSize = Number.parseInt(process.env.GUESTBOOK_PAGE_SIZE ?? '5', 10);
      const now = new Date();
      now.setSeconds(0, 0);
      const windowStart = now.toISOString();
      const bucketName = `${bookName}-views-${windowStart.slice(0, 16).replace(/[^0-9a-z]/gi, '').toLowerCase()}`;
      await GuestBookPageViewBucket.increment({
        name: bucketName,
        namespace,
        labels: { 'guestbook.applik8s.dev/book': bookName },
        spec: { guestbook: bookName, windowStart },
        field: 'spec.count',
      });
      const page = await publishedGuestBookEntries.query(bookName, {
        limit: Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 5,
        cursor: request.query.cursor,
        namespace,
      });
      const escapeMarkup = (input: string) => input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
      const timestampText = (timestamp: string | undefined) => {
        if (!timestamp) {
          return 'pending timestamp';
        }
        const parsed = Date.parse(timestamp);
        return Number.isFinite(parsed) ? `${new Date(parsed).toISOString().replace('T', ' ').replace('.000Z', ' UTC')}` : timestamp;
      };
      const entries = page.items.length === 0
        ? '<li class="empty">No entries yet. Create a GuestBookEntry CRD.</li>'
        : page.items.map((entry) => {
          const timestamp = entry.metadata.creationTimestamp;
          return `<li><div class="entry-header"><strong>${escapeMarkup(entry.spec.author)}</strong><time datetime="${escapeMarkup(timestamp ?? '')}">${escapeMarkup(timestampText(timestamp))}</time></div><p>${escapeMarkup(entry.spec.message)}</p></li>`;
        }).join('\n');
      const pager = `<nav class="pager" aria-label="GuestBook pages"><span>Page 1 of ${page.nextCursor ? 'many' : '1'}</span>${page.nextCursor ? `<a href="/?cursor=${encodeURIComponent(page.nextCursor)}">Older</a>` : '<span aria-disabled="true">Older</span>'}</nav>`;
      return { html: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeMarkup(process.env.GUESTBOOK_TITLE ?? 'applik8s GuestBook')}</title>
    <style>
      body { margin: 0; min-height: 100vh; background: #f7efe2; color: #251b12; font: 18px/1.55 ui-serif, Georgia, serif; }
      main { width: min(920px, calc(100% - 32px)); margin: 0 auto; padding: 56px 0; }
      header { border-bottom: 3px double #7d4d2c; margin-bottom: 32px; }
      h1 { margin: 0 0 8px; font-size: clamp(40px, 9vw, 96px); line-height: .9; letter-spacing: -.06em; }
      .meta { color: #76583e; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 14px; }
      form { display: grid; gap: 12px; margin: 0 0 28px; padding: 20px; background: #251b12; color: #fffaf2; border-radius: 20px; box-shadow: inset 0 0 0 1px rgba(255,250,242,.18); }
      label { display: grid; gap: 6px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; text-transform: uppercase; letter-spacing: .08em; }
      input, textarea { width: 100%; box-sizing: border-box; border: 0; border-radius: 12px; padding: 12px 14px; background: #fffaf2; color: #251b12; font: 16px/1.4 ui-serif, Georgia, serif; }
      textarea { min-height: 96px; resize: vertical; }
      button { width: fit-content; border: 0; border-radius: 999px; padding: 12px 18px; background: #d97837; color: #251b12; font: 700 15px/1 ui-sans-serif, system-ui, sans-serif; cursor: pointer; }
      .pager { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 18px 0 0; color: #76583e; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 14px; }
      .pager a, .pager span { border: 1px solid #c89b70; border-radius: 999px; padding: 6px 10px; text-decoration: none; color: inherit; background: #fffaf2; }
      .pager [aria-disabled="true"] { opacity: .45; }
      ol { display: grid; gap: 16px; list-style: none; padding: 0; margin: 0; }
      li { background: #fffaf2; border: 1px solid #c89b70; border-radius: 18px; padding: 20px 22px; box-shadow: 0 10px 0 rgba(125,77,44,.14); }
      li.empty { border-style: dashed; color: #76583e; }
      .entry-header { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: baseline; justify-content: space-between; }
      strong { display: block; color: #7d2f1e; font-size: 22px; }
      time { color: #76583e; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
      p { margin: 8px 0 0; }
    </style>
  </head>
  <body>
    <main>
      <header>
        <p class="meta">kubectl get guestbook ${escapeMarkup(bookName)} -n ${escapeMarkup(namespace)}</p>
        <h1>${escapeMarkup(process.env.GUESTBOOK_TITLE ?? 'applik8s GuestBook')}</h1>
        <p>${escapeMarkup(process.env.GUESTBOOK_DESCRIPTION ?? 'Entries are CRDs rendered through a typed index.')}</p>
      </header>
      <form method="post" action="/entries">
        <label>Your name<input name="author" maxlength="80" required /></label>
        <label>Message<textarea name="message" maxlength="500" required></textarea></label>
        <button type="submit">Create GuestBookEntry CRD</button>
      </form>
      <ol>
${entries}
      </ol>
      ${pager}
    </main>
  </body>
</html>` };
    });

    server.post('/entries', async (request) => {
      const form = await request.formData();
      const bookName = process.env.GUESTBOOK_NAME ?? 'main';
      const namespace = process.env.APPLIK8S_SERVER_NAMESPACE ?? 'default';
      const safeName = (value: string) => value.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63) || 'entry';
      const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.toLowerCase();
      const author = form.string('author').trim().slice(0, 80);
      const message = form.string('message').trim().replace(/\s+/g, ' ').slice(0, 500);
      const fingerprintFor = (input: string) => {
        let hash = 2166136261;
        for (const character of input) {
          hash ^= character.charCodeAt(0);
          hash = (hash * 16777619) >>> 0;
        }
        return (hash >>> 0).toString(16).padStart(8, '0');
      };
      const fingerprint = fingerprintFor(`${bookName}\n${author}\n${message}`);
      await GuestBookEntry.create({
        name: safeName(`${bookName}-${suffix}`),
        namespace,
        labels: { 'guestbook.applik8s.dev/book': bookName, 'guestbook.applik8s.dev/fingerprint': fingerprint },
        spec: {
          guestbook: bookName,
          author,
          message,
        },
      });
      return { redirect: '/' };
    });
  });

  app.aggregate<GuestBookEntryStats, GuestBookEntryAggregateEvent>('entryStats', {
    source: allGuestBookEntries,
    target: {
      resource: GuestBook,
      name: defaultOptions.bookName,
      namespace: defaultOptions.namespace,
      status: (stats) => ({ entryCount: stats.count }),
    },
    initial: { count: 0 },
    flush: { every: '2s', maxEvents: 500 },
    reduce(stats, event) {
      const wasPublished = event.previous?.status?.phase === 'Published';
      const isPublished = event.type !== 'deleted' && event.object?.status?.phase === 'Published';
      if (!wasPublished && isPublished) {
        return { count: stats.count + 1 };
      }
      if (wasPublished && !isPublished) {
        return { count: Math.max(0, stats.count - 1) };
      }
      return stats;
    },
  });

  app.aggregate<GuestBookPageViewStats, GuestBookPageViewAggregateEvent>('pageViewStats', {
    source: pageViewBuckets,
    target: {
      resource: GuestBook,
      name: defaultOptions.bookName,
      namespace: defaultOptions.namespace,
      status: (stats) => ({ pageViewsTotal: stats.total, pageViewsLastMinute: stats.lastMinute }),
    },
    initial: { total: 0, lastMinute: 0 },
    flush: { every: '5s', maxEvents: 500 },
    reduce(stats, event) {
      const previous = event.previous?.spec?.count ?? 0;
      const current = event.type === 'deleted' ? 0 : event.object?.spec?.count ?? 0;
      const delta = Math.max(0, current - previous);
      return { total: stats.total + delta, lastMinute: current };
    },
  });

  install.guestBookEntry({
    name: `${defaultOptions.bookName}-ada`,
    namespace: defaultOptions.namespace,
    labels: { 'guestbook.applik8s.dev/book': defaultOptions.bookName },
    spec: { guestbook: defaultOptions.bookName, author: 'Ada', message: 'Typed reads make CRDs feel like application data.' },
  });
  install.guestBookEntry({
    name: `${defaultOptions.bookName}-grace`,
    namespace: defaultOptions.namespace,
    labels: { 'guestbook.applik8s.dev/book': defaultOptions.bookName },
    spec: { guestbook: defaultOptions.bookName, author: 'Grace', message: 'The generated server rendered this page from a cached typed index.' },
  });
  const status = guestBookMain.status;
  if (!status) {
    throw new Error('GuestBook status projection is missing.');
  }
  return {
    ready: status.phase === 'Rendered',
  };
});
