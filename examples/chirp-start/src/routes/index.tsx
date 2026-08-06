import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Attachments, PostHomeTimeline, Media, Post } from '../application';
import { ChirpShell } from '../components/chirp-shell';
import { PostList, QueryState } from '../components/post-list';

const timeline = PostHomeTimeline({ limit: 50 });

export const Route = createFileRoute('/')({
  loader: () => timeline.snapshot(),
  component: Home,
});

function Home() {
  const posts = timeline.useQuery();
  const publish = Post.create.useMutation();
  const recordAttachment = Media.create.useMutation();
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'followers'>('public');
  const [replyingTo, setReplyingTo] = useState<{ readonly id: string; readonly authorHandle: string } | undefined>();
  const [quoting, setQuoting] = useState<{ readonly id: string; readonly authorHandle: string; readonly body: string } | undefined>();
  const [attachment, setAttachment] = useState<File | undefined>();
  const [altText, setAltText] = useState('');
  const [mediaPhase, setMediaPhase] = useState<'idle' | 'hashing' | 'uploading' | 'verifying' | 'recording'>('idle');
  const [mediaError, setMediaError] = useState<Error | undefined>();
  const busy = publish.pending || recordAttachment.pending || mediaPhase !== 'idle';
  return <ChirpShell title="Home" status={<span className={posts.stale ? 'stale' : 'live'}>{posts.stale ? 'reconnecting' : 'live'}</span>} rail={<HomeRail transport={publish.transport} durableResult={publish.durableResult} revision={posts.revision} />}>
    <form className="composer" onSubmit={async (event) => {
      event.preventDefault();
      const message = body.trim();
      if (!message) return;
      const submittedReply = replyingTo;
      const submittedQuote = quoting;
      const submittedAttachment = attachment;
      const submittedAltText = altText;
      setMediaError(undefined);
      const postId = crypto.randomUUID();
      try {
        const completed = submittedAttachment
          ? await uploadAttachment(submittedAttachment, setMediaPhase)
          : undefined;
        await publish({
          id: postId,
          body: message,
          visibility,
          ...(submittedReply ? { replyToPostId: submittedReply.id } : {}),
          ...(submittedQuote ? { quotePostId: submittedQuote.id } : {}),
        });
        if (completed) {
          setMediaPhase('recording');
          await recordAttachment({
            id: completed.objectId,
            postId,
            objectKey: completed.key,
            contentType: completed.contentType,
            byteLength: String(completed.size),
            sha256: completed.sha256,
            uploadReceipt: completed.receipt,
            altText: submittedAltText.trim() || 'Attached media',
          });
        }
        setBody((current) => current.trim() === message ? '' : current);
        setReplyingTo((current) => current === submittedReply ? undefined : current);
        setQuoting((current) => current === submittedQuote ? undefined : current);
        setAttachment((current) => current === submittedAttachment ? undefined : current);
        setAltText((current) => current === submittedAltText ? '' : current);
      } catch (error) {
        setMediaError(error instanceof Error ? error : new Error(String(error)));
      } finally {
        setMediaPhase('idle');
      }
    }}>
      <div className="avatar">D</div>
      <div className="composeBody">
        {replyingTo ? <div className="context">Replying to @{replyingTo.authorHandle} <button type="button" onClick={() => setReplyingTo(undefined)}>Cancel</button></div> : null}
        {quoting ? <div className="context">Quoting @{quoting.authorHandle}: “{quoting.body}” <button type="button" onClick={() => setQuoting(undefined)}>Cancel</button></div> : null}
        <textarea aria-label="Post text" value={body} maxLength={280} onChange={(event) => setBody(event.target.value)} placeholder="What is happening?" />
        <div className="mediaFields">
          <label className="filePicker">Attach media<input aria-label="Post attachment" type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4" onChange={(event) => setAttachment(event.target.files?.[0])} /></label>
          {attachment ? <label>Alternative text<input aria-label="Attachment alternative text" value={altText} maxLength={280} onChange={(event) => setAltText(event.target.value)} /></label> : null}
        </div>
        <div className="composeActions"><select aria-label="Post visibility" value={visibility} onChange={(event) => setVisibility(event.target.value as 'public' | 'followers')}><option value="public">Public</option><option value="followers">Followers</option></select><small>{attachment ? `${attachment.name} · ` : ''}{body.length}/280</small><button disabled={busy || body.trim().length === 0}>{busy ? mediaPhaseLabel(mediaPhase) : 'Post'}</button></div>
        {publish.error ? <p role="alert">{publish.error.message}</p> : null}
        {recordAttachment.error ? <p role="alert">{recordAttachment.error.message}</p> : null}
        {mediaError ? <p role="alert">{mediaError.message}</p> : null}
      </div>
    </form>
    <QueryState phase={posts.phase} error={posts.error} empty={(posts.data?.length ?? 0) === 0} />
    <PostList posts={posts.data ?? []} onReply={(post) => {
      setQuoting(undefined);
      setReplyingTo({ id: post.id, authorHandle: post.authorHandle });
      document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Post text"]')?.focus();
    }} onQuote={(post) => {
      setReplyingTo(undefined);
      setQuoting({ id: post.id, authorHandle: post.authorHandle, body: post.body });
      document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Post text"]')?.focus();
    }} />
  </ChirpShell>;
}

async function uploadAttachment(file: File, phase: (value: 'hashing' | 'uploading' | 'verifying') => void) {
  phase('hashing');
  const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const contentType = file.type.toLowerCase();
  const intent = await Attachments.createUpload({ contentType, size: file.size, sha256 });
  phase('uploading');
  const response = await fetch(intent.url, {
    method: intent.method,
    credentials: 'same-origin',
    headers: intent.headers,
    body: file,
  });
  if (!response.ok) throw new Error(`Attachment upload failed with HTTP ${response.status}.`);
  phase('verifying');
  return Attachments.completeUpload({ key: intent.object.key, contentType, size: file.size, sha256 });
}

function mediaPhaseLabel(phase: 'idle' | 'hashing' | 'uploading' | 'verifying' | 'recording'): string {
  return ({ idle: 'Publishing…', hashing: 'Checking…', uploading: 'Uploading…', verifying: 'Verifying…', recording: 'Attaching…' })[phase];
}

function HomeRail({ transport, durableResult, revision }: { readonly transport: string; readonly durableResult: string; readonly revision: string | number }) {
  return <><div className="discover"><h2>Why this feed matters</h2><p>Actions commit to PostgreSQL. Events are replayable. SSE carries invalidation, and the browser requeries the authoritative view.</p></div><div className="inspector"><p className="eyebrow">Live evidence</p><h2>Current request</h2><div className="status"><span>action transport</span><b>{transport}</b><span>durable result</span><b>{durableResult}</b><span>query revision</span><b>{revision}</b></div></div></>;
}
