import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { AccountDiscover, PostSearch, PostTrending } from '../application';
import { ChirpShell, PageIntro } from '../components/chirp-shell';
import { PostList, QueryState } from '../components/post-list';

const trending = PostTrending({ limit: 30 });
const people = AccountDiscover({ limit: 12 });

export const Route = createFileRoute('/explore')({
  loader: () => Promise.all([trending.snapshot(), people.snapshot()]),
  component: Explore,
});

function Explore() {
  const [query, setQuery] = useState('');
  const trendingPosts = trending.useQuery();
  const accounts = people.useQuery();
  const matching = PostSearch({ query, limit: 30 }).useQuery();
  const selected = query.trim() ? matching : trendingPosts;
  return <ChirpShell title="Explore" rail={<div className="discover"><h2>People</h2>{(accounts.data ?? []).map((account) => <a className="person" key={account.id} href={`/profile/${account.handle}`}><span className="avatar">{account.handle.at(0)?.toUpperCase()}</span><span><b>{account.displayName}</b><small>@{account.handle}{account.kind === 'automation' ? ' · automated' : ''}</small></span></a>)}</div>}>
    <PageIntro eyebrow="Discovery" title="Find people and conversations">Search remains a bounded model view. The browser uses the same typed protocol whether its authority is relational today or a future search projection.</PageIntro>
    <label className="searchBox"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value.slice(0, 100))} placeholder="Search public posts" aria-label="Search public posts" /></label>
    <QueryState phase={selected.phase} error={selected.error} empty={(selected.data?.length ?? 0) === 0} />
    <PostList posts={selected.data ?? []} />
  </ChirpShell>;
}
