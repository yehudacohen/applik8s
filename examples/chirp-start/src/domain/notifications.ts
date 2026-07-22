import { type } from '@applik8s/applik8s/dsl';
import { desc, eq } from 'drizzle-orm';
import { app } from '../app';
import { notifications } from '../schema/social';
import { Account } from './accounts';
import { ChirpCommandProcessor, Database } from '../providers/database';
import { NotificationChanged } from './events';

const NotificationBase = app.model(notifications, { name: 'Notification', database: Database, processor: ChirpCommandProcessor });

NotificationBase.create.beforeCommit({
  transaction: { models: [Account] },
  events: [NotificationChanged],
  history: true,
}, async (notification, input, context) => {
  const principal = context.principal;
  if (!principal || (principal.id !== input.actorId && principal.claims?.role !== 'notification-worker')) {
    throw new Error('A notification requires its authenticated actor or an Applik8s notification worker.');
  }
  const recipient = await context.models.Account?.get({ id: input.recipientId });
  if (recipient?.spec.state !== 'active') throw new Error('A notification requires an active recipient.');
  if (input.createdAt !== undefined || input.readAt !== undefined || input.revision !== undefined) throw new Error('Notification delivery timestamps, read state, and revisions are server-owned.');
  if (input.summary.length < 1 || input.summary.length > 240) throw new Error('A new notification requires a bounded summary.');
  notification.patch({ spec: { createdAt: context.now, readAt: null } });
  context.emit(NotificationChanged, { notificationId: notification.id, recipientId: input.recipientId, state: 'delivered', changedAt: context.now });
});

NotificationBase.update.beforeCommit({
  events: [NotificationChanged],
  history: true,
}, async (notification, input, context) => {
  if (!context.principal || context.principal.id !== notification.value.recipientId) throw new Error('Only the notification recipient can update it.');
  if ('id' in input.patch || 'recipientId' in input.patch || 'actorId' in input.patch || 'postId' in input.patch || 'kind' in input.patch || 'summary' in input.patch || 'createdAt' in input.patch || 'revision' in input.patch) {
    throw new Error('Notification identity and delivery fields are immutable.');
  }
  if (!('readAt' in input.patch)) throw new Error('A notification update must request a read-state transition.');
  notification.patch({ spec: { readAt: context.now } });
  context.emit(NotificationChanged, { notificationId: notification.id, recipientId: notification.value.recipientId, state: 'read', changedAt: context.now });
});

NotificationBase.delete.beforeCommit({ history: true }, async (notification, _input, context) => {
  if (!context.principal || context.principal.id !== notification.value.recipientId) throw new Error('Only the notification recipient can delete it.');
});

export const Notification = NotificationBase.view('inbox', {
  input: type({ 'limit?': 'number.integer >= 1' }),
  output: type({ id: 'string', 'actorId': 'string | null', 'postId': 'string | null', kind: 'string', summary: 'string', createdAt: 'string', 'readAt': 'string | null' }).array(),
  database: Database,
  authorize: ({ principal }) => principal.id.length > 0,
  run: async ({ context, input, principal }) => context.database(Database)
    .select({ id: NotificationBase.id, actorId: NotificationBase.actorId, postId: NotificationBase.postId, kind: NotificationBase.kind, summary: NotificationBase.summary, createdAt: NotificationBase.createdAt, readAt: NotificationBase.readAt })
    .from(NotificationBase)
    .where(eq(NotificationBase.recipientId, principal.id))
    .orderBy(desc(NotificationBase.createdAt))
    .limit(Math.min(input.limit ?? 50, 100)),
  budgets: { maxRows: 100, maxResultBytes: 256_000, timeoutMs: 2_000 },
});

/** Stable identifier used by generated transaction outboxes; public callers use Notification.create directly. */
export const CreateNotification = Notification.create;
