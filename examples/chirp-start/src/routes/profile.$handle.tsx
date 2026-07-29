import { ApplicationQueryHydrationBoundary } from '@applik8s/react';
import { createFileRoute } from '@tanstack/react-router';
import { Account, Block, Follow, Mute, Post } from '../application';
import { ChirpShell } from '../components/chirp-shell';
import { PostList, QueryState } from '../components/post-list';
import { currentAccount } from '../session';

export const Route = createFileRoute('/profile/$handle')({
  loader: ({ params }) => Promise.all([
    Account.byHandle({ handle: params.handle }).snapshot(),
    Post.byAuthorHandle({ handle: params.handle, limit: 50 }).snapshot(),
    Follow.viewerState({ handle: params.handle }).snapshot(),
    Block.viewerState({ handle: params.handle }).snapshot(),
    Mute.viewerState({ handle: params.handle }).snapshot(),
  ]),
  component: ProfilePage,
});

function ProfilePage() {
  const snapshots = Route.useLoaderData();
  const { handle } = Route.useParams();
  return <ApplicationQueryHydrationBoundary snapshots={snapshots}><Profile handle={handle} /></ApplicationQueryHydrationBoundary>;
}

function Profile({ handle }: { readonly handle: string }) {
  const account = Account.byHandle({ handle }).useQuery();
  const session = currentAccount.useQuery();
  const posts = Post.byAuthorHandle({ handle, limit: 50 }).useQuery();
  const relationship = Follow.viewerState({ handle }).useQuery();
  const blockRelationship = Block.viewerState({ handle }).useQuery();
  const muteRelationship = Mute.viewerState({ handle }).useQuery();
  const createFollow = Follow.create.useMutation();
  const updateFollow = Follow.update.useMutation();
  const createBlock = Block.create.useMutation();
  const updateBlock = Block.update.useMutation();
  const createMute = Mute.create.useMutation();
  const updateMute = Mute.update.useMutation();
  const profile = account.data;
  const currentFollow = relationship.data?.[0];
  const currentBlock = blockRelationship.data?.[0];
  const currentMute = muteRelationship.data?.[0];
  const following = currentFollow?.state === 'active';
  const blocked = currentBlock?.state === 'active';
  const muted = currentMute?.state === 'active';
  const followPending = createFollow.pending || updateFollow.pending;
  const safetyPending = createBlock.pending || updateBlock.pending || createMute.pending || updateMute.pending;
  return <ChirpShell title={profile ? `@${profile.handle}` : 'Profile'}>
    {profile ? <section className="profileHero"><div className="avatar large">{profile.handle.at(0)?.toUpperCase()}</div><div><p className="eyebrow">{profile.kind === 'automation' ? 'Disclosed automated account' : 'Community member'}</p><h1>{profile.displayName}</h1><p>@{profile.handle}</p><p>{profile.bio}</p></div>{profile.id !== session.data?.id ? <div className="buttonRow"><button
      className="primary"
      aria-pressed={following}
      disabled={followPending || relationship.phase === 'loading' || blocked}
      onClick={async () => {
        if (!currentFollow) {
          await createFollow({ id: crypto.randomUUID(), followeeId: profile.id });
          return;
        }
        await updateFollow({
          identity: currentFollow.id,
          patch: following
            ? { state: 'deleted' }
            : { state: 'active' },
        });
      }}
    >{followPending ? 'Saving…' : following ? 'Following' : 'Follow'}</button><button
      aria-pressed={muted}
      disabled={safetyPending || muteRelationship.phase === 'loading'}
      onClick={async () => {
        if (!currentMute) await createMute({ id: crypto.randomUUID(), mutedId: profile.id });
        else await updateMute({ identity: currentMute.id, patch: muted ? { state: 'removed' } : { state: 'active' } });
      }}
    >{muted ? 'Muted' : 'Mute'}</button><button
      aria-pressed={blocked}
      disabled={safetyPending || blockRelationship.phase === 'loading'}
      onClick={async () => {
        if (!currentBlock) await createBlock({ id: crypto.randomUUID(), blockedId: profile.id });
        else await updateBlock({ identity: currentBlock.id, patch: blocked ? { state: 'removed' } : { state: 'active' } });
      }}
    >{blocked ? 'Blocked' : 'Block'}</button></div> : null}</section> : <QueryState phase={account.phase} error={account.error} empty />}
    <QueryState phase={posts.phase} error={posts.error} empty={(posts.data?.length ?? 0) === 0} />
    <PostList posts={posts.data ?? []} />
  </ChirpShell>;
}
