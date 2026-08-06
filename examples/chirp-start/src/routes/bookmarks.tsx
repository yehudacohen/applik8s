import { createFileRoute } from '@tanstack/react-router';
import { Bookmark, BookmarkMine } from '../application';
import { ChirpShell, PageIntro } from '../components/chirp-shell';
import { QueryState } from '../components/post-list';
import { formatUtcTimestamp } from '../format';

const saved = BookmarkMine({ limit: 50 });
export const Route = createFileRoute('/bookmarks')({ loader: () => saved.snapshot(), component: Bookmarks });
function Bookmarks() {
  const bookmarks = saved.useQuery();
  const remove = Bookmark.update.useMutation();
  return <ChirpShell title="Bookmarks"><PageIntro eyebrow="Private collection" title="Saved posts">Bookmarks remain private account relationships and are never published in public events.</PageIntro><QueryState phase={bookmarks.phase} error={bookmarks.error} empty={(bookmarks.data?.length ?? 0) === 0} /><section className="cardList">{(bookmarks.data ?? []).map((bookmark) => <article key={bookmark.id}><div><b>@{bookmark.authorHandle}</b><p>{bookmark.body}</p><small>{formatUtcTimestamp(bookmark.publishedAt)}</small></div><button disabled={remove.pending} onClick={() => remove({ identity: bookmark.id, patch: { state: 'removed' } })}>Remove</button></article>)}</section></ChirpShell>;
}
