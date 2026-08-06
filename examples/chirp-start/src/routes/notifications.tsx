import { createFileRoute } from '@tanstack/react-router';
import { Notification, NotificationInbox } from '../application';
import { ChirpShell, PageIntro } from '../components/chirp-shell';
import { QueryState } from '../components/post-list';
import { formatUtcTimestamp } from '../format';

const inbox = NotificationInbox({ limit: 50 });

export const Route = createFileRoute('/notifications')({ loader: () => inbox.snapshot(), component: Notifications });

function Notifications() {
  const notifications = inbox.useQuery();
  const markRead = Notification.update.useMutation();
  return <ChirpShell title="Notifications">
    <PageIntro eyebrow="Durable inbox" title="What changed">Notifications are product state in PostgreSQL. Delivery events can be replayed without inventing a second authority.</PageIntro>
    <QueryState phase={notifications.phase} error={notifications.error} empty={(notifications.data?.length ?? 0) === 0} />
    <section className="cardList">{(notifications.data ?? []).map((notification) => <article className={notification.readAt ? '' : 'unread'} key={notification.id}><div><b>{notification.summary}</b><p>{notification.kind} · {formatUtcTimestamp(notification.createdAt)}</p></div>{notification.readAt ? <span>Read</span> : <button disabled={markRead.pending} onClick={() => markRead({ identity: notification.id, patch: { readAt: null } })}>Mark read</button>}</article>)}</section>
  </ChirpShell>;
}
