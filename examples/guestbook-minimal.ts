import { sdk } from '@applik8s/applik8s';
import { label, metadata, type } from '@applik8s/applik8s/dsl';

const namespace = 'guestbook-minimal';
const application = sdk.app('guestbook-minimal', {
  namespace,
  apiVersion: 'guestbook.applik8s.dev/v1alpha1',
  kind: 'GuestBookMinimalStack',
});

export const GuestBook = application.resource('GuestBook', {
  spec: type({ title: 'string' }),
  status: type({ phase: "('Pending' | 'Ready')?" }),
});

export const GuestBookEntry = application.resource('GuestBookEntry', {
  spec: type({
    guestbook: 'string',
    author: 'string',
    message: 'string',
  }),
  status: type({
    phase: "('Pending' | 'Published' | 'Rejected')?",
    reason: 'string?',
  }),
});

export const publishedEntries = GuestBookEntry.index('publishedEntries', {
  partitionBy: label('guestbook.applik8s.dev/book'),
  filter: { status: { phase: 'Published' } },
  orderBy: metadata.creationTimestamp.desc(),
  cache: { backend: 'valkey' },
  bounds: { maxItems: 100, pageSize: 20 },
});

const guestBookController = sdk.operator({
  name: 'guestbook-entry-publisher',
  resources: { GuestBook, GuestBookEntry },
  handlers: [GuestBookEntry.on.reconcile(async (entry) => {
    const author = entry.spec.author.trim();
    const message = entry.spec.message.trim();
    if (!author || author.length > 80 || !message || message.length > 500) {
      entry.status.phase = 'Rejected';
      entry.status.reason = 'invalid-length';
      return;
    }
    if (/https?:\/\//i.test(message)) {
      entry.status.phase = 'Rejected';
      entry.status.reason = 'links-disabled';
      return;
    }
    entry.status.phase = 'Published';
  })],
});
application.operator(guestBookController, { namespace });

const web = application.http(
  'web',
  {
    resources: { GuestBook, GuestBookEntry },
    indexes: { publishedEntries },
    captures: { namespace },
    maxRequestBodyBytes: 4_096,
    mutationRateLimit: { maxRequests: 8, windowSeconds: 60 },
  },
  (server) => {
    server.get('/', async () => {
      const page = await publishedEntries.query('main', { namespace, limit: 20 });
      const escapeMarkup = (value: unknown) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
      const entries = page.items.map((entry) =>
        `<li><strong>${escapeMarkup(entry.spec.author)}</strong>: ${escapeMarkup(entry.spec.message)}</li>`
      ).join('');
      return {
        html: `<!doctype html><html lang="en"><meta charset="utf-8"><title>GuestBook</title>
          <body><main><h1>GuestBook</h1><form method="post" action="/entries">
          <input name="author" maxlength="80" required><textarea name="message" maxlength="500" required></textarea>
          <button>Sign</button></form><ol>${entries}</ol></main></body></html>`,
      };
    });

    server.post('/entries', async (request) => {
      const form = await request.formData();
      const author = form.string('author').trim();
      const message = form.string('message').trim();
      if (!author || author.length > 80 || !message || message.length > 500) {
        return new Response('Invalid author or message length.', { status: 400 });
      }
      const fingerprint = `${author}\n${message}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 35);
      const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      await GuestBookEntry.create({
        name: `entry-${fingerprint}-${suffix}`.slice(0, 63),
        namespace,
        labels: { 'guestbook.applik8s.dev/book': 'main' },
        spec: { guestbook: 'main', author, message },
      });
      return { redirect: '/' };
    });
  },
);

export const guestBookMinimalExposure = application.expose('web', {
  service: web,
  hostnames: ['guestbook.localhost'],
  tls: 'disabled',
});

export const guestBookMinimalStack = application.composition;
