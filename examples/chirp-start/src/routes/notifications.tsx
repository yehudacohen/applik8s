import { ApplicationQueryHydrationBoundary } from '@applik8s/react';
import { createFileRoute } from '@tanstack/react-router';
import { Notification } from '../application';
import { ChirpShell, PageIntro } from '../components/chirp-shell';
import { QueryState } from '../components/post-list';
import { formatUtcTimestamp } from '../format';

const inbox = Notification.inbox({ limit: 50 });

export const Route = createFileRoute('/notifications')({ loader: () => inbox.snapshot(), component: NotificationsPage });

function NotificationsPage() {
  const snapshot = Route.useLoaderData();
  return <ApplicationQueryHydrationBoundary snapshots={[snapshot]}><Notifications /></ApplicationQueryHydrationBoundary>;
}

function Notifications() {
  const notifications = inbox.useQuery();
  const markRead = Notification.update.useMutation();
  return <ChirpShell title="Notifications">
    <PageIntro eyebrow="Durable inbox" title="What changed">Notifications are product state in PostgreSQL. Delivery events can be replayed without inventing a second authority.</PageIntro>
    <QueryState phase={notifications.phase} error={notifications.error} empty={(notifications.data?.length ?? 0) === 0} />
    <section className="cardList">{(notifications.data ?? []).map((notification) => <article className={notification.readAt ? '' : 'unread'} key={notification.id}><div><b>{notification.summary}</b><p>{notification.kind} · {formatUtcTimestamp(notification.createdAt)}</p></div>{notification.readAt ? <span>Read</span> : <button disabled={markRead.pending} onClick={() => markRead({ identity: notification.id, patch: { readAt: null } })}>Mark read</button>}</article>)}</section>
  </ChirpShell>;
}
