import { createFileRoute } from '@tanstack/react-router';
import { useApplicationQueryClient } from '@applik8s/react';
import { useState } from 'react';
import { GuestBookEntry } from '../application';

const publishedEntries = GuestBookEntry.published({ guestbook: 'main', limit: 20 });

export const Route = createFileRoute('/')({
  loader: () => publishedEntries.snapshot(),
  component: GuestBookPage,
});

function GuestBookPage() {
  const initial = Route.useLoaderData();
  const queryClient = useApplicationQueryClient();
  queryClient.hydrate([initial]);
  const entries = publishedEntries.useQuery();
  const createEntry = GuestBookEntry.create.useMutation();
  const [author, setAuthor] = useState('');
  const [message, setMessage] = useState('');
  return (
    <main>
      <header>
        <p className="eyebrow">Applik8s + TanStack Start</p>
        <h1>This UI reacts to the Kubernetes control plane.</h1>
        <p>The initial snapshot is server-capable; resumable invalidations requery authoritative state after the operator publishes an entry.</p>
      </header>
      <section className="layout">
        <form onSubmit={async (event) => {
          event.preventDefault();
          await createEntry({ guestbook: 'main', author, message });
          setMessage('');
        }}>
          <h2>Sign the GuestBook</h2>
          <label>Name<input value={author} onChange={(event) => setAuthor(event.target.value)} disabled={createEntry.pending} /></label>
          <label>Message<textarea value={message} onChange={(event) => setMessage(event.target.value)} disabled={createEntry.pending} /></label>
          <button disabled={createEntry.pending}>{createEntry.pending ? 'Submitting…' : 'Create entry'}</button>
          <output>
            transport={createEntry.transport} · durable={createEntry.durableResult} · observation={createEntry.observation.state}
          </output>
          {createEntry.error ? <p role="alert">{createEntry.error.message}</p> : null}
        </form>
        <section>
          <h2>Published entries</h2>
          <p>query phase: {entries.phase} · revision: {entries.revision}</p>
          <ol aria-live="polite">
            {(entries.data ?? []).map((entry) => (
              <li key={entry.id}>
                <strong>{entry.author}</strong>
                <time dateTime={entry.publishedAt}>{entry.publishedAt}</time>
                <p>{entry.message}</p>
              </li>
            ))}
          </ol>
        </section>
      </section>
    </main>
  );
}
