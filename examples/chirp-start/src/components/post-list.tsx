import { useMemo, useState } from 'react';
import { Attachments, Bookmark, MediaForPosts, Reaction, Report, type TimelinePostValue } from '../application';
import { formatUtcTimestamp } from '../format';

export function PostList({ posts, onReply, onQuote }: { readonly posts: readonly TimelinePostValue[]; readonly onReply?: (post: TimelinePostValue) => void; readonly onQuote?: (post: TimelinePostValue) => void }) {
  const createReaction = Reaction.create.useMutation();
  const updateReaction = Reaction.update.useMutation();
  const createBookmark = Bookmark.create.useMutation();
  const updateBookmark = Bookmark.update.useMutation();
  const report = Report.create.useMutation();
  const postIds = useMemo(() => posts.map((post) => post.id), [posts]);
  const mediaQuery = useMemo(() => MediaForPosts({ postIds }), [postIds]);
  const media = mediaQuery.useQuery();
  const mediaByPost = useMemo(() => {
    const grouped = new Map<string, MediaValue[]>();
    for (const attachment of media.data ?? []) {
      const values = grouped.get(attachment.postId) ?? [];
      values.push(attachment);
      grouped.set(attachment.postId, values);
    }
    return grouped;
  }, [media.data]);
  const act = async (operation: 'like' | 'repost' | 'bookmark' | 'report', post: TimelinePostValue) => {
    if (operation === 'like' || operation === 'repost') {
      const active = operation === 'like' ? post.viewerLiked : post.viewerReposted;
      const identity = operation === 'like' ? post.viewerLikeId : post.viewerRepostId;
      if (identity) await updateReaction({ identity, patch: { state: active ? 'deleted' : 'active' } });
      else await createReaction({ id: crypto.randomUUID(), postId: post.id, kind: operation });
    }
    if (operation === 'bookmark') {
      if (post.viewerBookmarkId) await updateBookmark({
        identity: post.viewerBookmarkId,
        patch: post.viewerBookmarked ? { state: 'removed' } : { state: 'saved' },
      });
      else await createBookmark({ id: crypto.randomUUID(), postId: post.id });
    }
    if (operation === 'report') await report({
      id: crypto.randomUUID(),
      postId: post.id,
      reason: 'user-report',
      detail: `Submitted from Chirp for ${post.id}.`,
    });
  };
  return <section className="postList" aria-live="polite">
    {media.error ? <div className="mediaOutcome failed" role="alert">Attachments unavailable: {media.error.message}</div> : null}
    {posts.map((post) => <article key={post.id} data-post-id={post.id}>
      <div className="avatar">{post.authorHandle.at(0)?.toUpperCase()}</div>
      <div>{post.replyToPostId ? <small className="context">Replying in a conversation</small> : null}{post.quotePostId ? <small className="context">Quoting post {post.quotePostId}</small> : null}
        <div className="postMeta"><strong>@{post.authorHandle}</strong>{post.authorKind === 'automation' ? <span className="automationBadge">Automated</span> : null}<time dateTime={post.publishedAt}>{formatUtcTimestamp(post.publishedAt)}</time></div>
        <p>{post.body}</p>
				<PostMedia attachments={mediaByPost.get(post.id) ?? []} pending={media.phase !== 'ready'} />
        <div className="metrics">
          {onReply ? <button onClick={() => onReply(post)}>↩ Reply</button> : null}
          {onQuote ? <button onClick={() => onQuote(post)}>❝ Quote</button> : null}
          <button aria-pressed={post.viewerLiked ?? false} onClick={() => act('like', post)} disabled={createReaction.pending || updateReaction.pending}>{post.viewerLiked ? '♥' : '♡'} Like · {post.likeCount ?? 0}</button>
          <button aria-pressed={post.viewerReposted ?? false} onClick={() => act('repost', post)} disabled={createReaction.pending || updateReaction.pending}>↻ Repost · {post.repostCount ?? 0}</button>
          <button aria-pressed={post.viewerBookmarked ?? false} onClick={() => act('bookmark', post)} disabled={createBookmark.pending || updateBookmark.pending}>{post.viewerBookmarked ? '▣ Saved' : '⌑ Save'}</button>
          <button onClick={() => act('report', post)} disabled={report.pending}>⚑ Report</button>
        </div>
      </div>
    </article>)}
  </section>;
}

interface MediaValue {
	readonly id: string;
	readonly postId: string;
	readonly objectKey: string;
	readonly altText: string;
	readonly processingState: string;
	readonly processingReason: string | null;
}

function PostMedia({ attachments, pending }: { readonly attachments: readonly MediaValue[]; readonly pending: boolean }) {
	const [downloads, setDownloads] = useState<Readonly<Record<string, string>>>({});
	const [downloadError, setDownloadError] = useState<Error | undefined>();
	if (pending || attachments.length === 0) return null;
	return <div className="postMedia" aria-live="polite">{attachments.map((attachment) => {
		if (attachment.processingState === 'rejected') return <div key={attachment.id} className="mediaOutcome failed" role="status">Attachment rejected: {attachment.processingReason}</div>;
		if (attachment.processingState !== 'ready') return <div key={attachment.id} className="mediaOutcome pending" role="status">Attachment verification in progress…</div>;
		const download = downloads[attachment.id];
		return <div key={attachment.id} className="mediaOutcome ready">
			<span>{attachment.altText} · verified</span>
			{download
				? <a href={download} target="_blank" rel="noreferrer">Open attachment</a>
				: <button type="button" onClick={async () => {
					try {
						setDownloadError(undefined);
						const intent = await Attachments.createDownload({ key: attachment.objectKey });
						setDownloads((current) => ({ ...current, [attachment.id]: intent.url }));
					} catch (error) {
						setDownloadError(error instanceof Error ? error : new Error(String(error)));
					}
				}}>Prepare secure download</button>}
		</div>;
	})}{downloadError ? <div className="mediaOutcome failed" role="alert">{downloadError.message}</div> : null}</div>;
}

export function QueryState({ phase, error, empty }: { readonly phase: string; readonly error: Error | undefined; readonly empty: boolean }) {
  if (error) return <div className="empty" role="alert">{error.message}</div>;
  if (phase !== 'ready') return <div className="empty">Loading the authoritative view…</div>;
  if (empty) return <div className="empty">Nothing is here yet.</div>;
  return null;
}
