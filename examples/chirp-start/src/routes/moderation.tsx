import { createFileRoute } from '@tanstack/react-router';
import type { ApplicationSignal, ApplicationSignalIssuance } from '@applik8s/applik8s';
import { useEffect, useState } from 'react';
import { AutomationControl, AutomationControlCurrent, AutomationPostReview, ModerationPolicyCurrent, ModerationCase, ModerationCaseQueue, ReportOpenQueue, Post } from '../application';
import { ChirpShell, PageIntro } from '../components/chirp-shell';
import { QueryState } from '../components/post-list';

const reports = ReportOpenQueue({ limit: 50 });
const cases = ModerationCaseQueue({ limit: 50 });
const automationControl = AutomationControlCurrent();
const policy = ModerationPolicyCurrent();
export const Route = createFileRoute('/moderation')({ loader: () => Promise.all([reports.snapshot(), cases.snapshot(), automationControl.snapshot(), policy.snapshot()]), component: Moderation });
function Moderation() {
  const reportQueue = reports.useQuery();
  const caseQueue = cases.useQuery();
  const automation = automationControl.useQuery();
  const moderationPolicy = policy.useQuery();
  const updateAutomationControl = AutomationControl.update.useMutation();
  const open = ModerationCase.create.useMutation();
  const resolve = ModerationCase.update.useMutation();
  const moderate = Post.update.useMutation();
  const [stopReason, setStopReason] = useState('Administrator emergency stop');
  const reviews = useAutomationPostReviews();
  const currentControl = automation.data;
  const setAutomationEnabled = async (enabled: boolean) => {
    const patch = { enabled: enabled ? 'true' : 'false', reason: enabled ? '' : stopReason };
    await updateAutomationControl({ identity: 'global', patch });
  };
  return <ChirpShell title="Moderation">
    <PageIntro eyebrow="Administrator evidence" title="Moderation queue">Reports and cases are durable relational records. The Kubernetes moderation policy is low-cardinality operational desired state.</PageIntro>
    <section className="panelForm" aria-labelledby="moderation-policy-heading"><p className="eyebrow">Kubernetes authority</p><h2 id="moderation-policy-heading">Moderation policy</h2><QueryState phase={moderationPolicy.phase} error={moderationPolicy.error} empty={(moderationPolicy.data?.length ?? 0) === 0} />{moderationPolicy.data?.map((current) => <p key={current.name}><b>{current.phase}</b> · maximum risk {current.maxRisk} · {current.blockedTerms.length} blocked terms. {current.message}</p>)}</section>
    <section className="panelForm" aria-labelledby="automation-safety-heading"><p className="eyebrow">Global safety boundary</p><h2 id="automation-safety-heading">Automated publication</h2><QueryState phase={automation.phase} error={automation.error} empty={false} /><p>{currentControl?.enabled === false ? `Stopped: ${currentControl.reason}` : 'Enabled. Every run still passes quotas, moderation, and ordinary Post.create authorization.'}</p><label>Stop reason<input value={stopReason} onChange={(event) => setStopReason(event.target.value)} /></label><div className="buttonRow">{currentControl?.enabled === false ? <button className="primary" disabled={updateAutomationControl.pending} onClick={() => setAutomationEnabled(true)}>Resume automation</button> : <button disabled={updateAutomationControl.pending || !stopReason.trim()} onClick={() => setAutomationEnabled(false)}>Stop all automation</button>}</div></section>
    <h2 className="sectionTitle">Automation reviews</h2>
    {reviews.error ? <p role="alert">{reviews.error.message}</p> : null}
    {reviews.items.length === 0 ? <p>No automated posts are awaiting a decision.</p> : null}
    <section className="cardList">{reviews.items.map((review) => <article key={review.id} data-signal-id={review.signal.issuance.id} data-run-id={review.input.runId}><div><p className="eyebrow">Risk {review.input.risk}</p><b>{review.input.body}</b><p>Automation {review.input.automationId} · post {review.input.postId}</p><small>Decision expires {review.expiresAt}</small></div><div className="buttonRow"><button className="primary" disabled={reviews.pending === review.id} onClick={() => reviews.resolve(review, 'approve', { comment: 'Approved in Chirp moderation.' })}>Approve</button><button disabled={reviews.pending === review.id} onClick={() => reviews.resolve(review, 'reject', { reason: 'Rejected in Chirp moderation.' })}>Reject</button></div></article>)}</section>
    <h2 className="sectionTitle">Open reports</h2><QueryState phase={reportQueue.phase} error={reportQueue.error} empty={(reportQueue.data?.length ?? 0) === 0} />
    <section className="cardList">{(reportQueue.data ?? []).map((report) => <article key={report.id}><div><b>{report.reason}</b><p>{report.detail}</p><small>reported by {report.reporterId}</small></div><button disabled={open.pending} onClick={() => open({ id: `case:${report.id}`, reportId: report.id, targetType: report.postId ? 'post' : 'account', targetId: report.postId ?? report.accountId ?? '' })}>Open case</button></article>)}</section>
    <h2 className="sectionTitle">Active cases</h2><QueryState phase={caseQueue.phase} error={caseQueue.error} empty={(caseQueue.data?.length ?? 0) === 0} />
    <section className="cardList">{(caseQueue.data ?? []).map((moderationCase) => <article key={moderationCase.id}><div><b>{moderationCase.targetType} · {moderationCase.targetId}</b><p>Case {moderationCase.id}</p></div><div className="buttonRow">{moderationCase.targetType === 'post' ? <button disabled={moderate.pending} onClick={() => moderate({ identity: moderationCase.targetId, patch: { moderationState: 'removed', moderationReason: `Resolved by ${moderationCase.id}` } })}>Remove post</button> : null}<button disabled={resolve.pending} onClick={() => resolve({ identity: moderationCase.id, patch: { state: 'resolved', resolution: 'Reviewed and actioned in Chirp moderation.' } })}>Resolve</button></div></article>)}</section>
  </ChirpShell>;
}

type AutomationReviewDefinition = typeof AutomationPostReview.signal;
type AutomationReview = ApplicationSignalIssuance<
  AutomationReviewDefinition,
  ApplicationSignal<AutomationReviewDefinition>
>;

function useAutomationPostReviews(): {
  readonly items: readonly AutomationReview[];
  readonly pending?: string;
  readonly error?: Error;
  resolve(
    review: AutomationReview,
    action: 'approve' | 'reject',
    input: { readonly comment: string } | { readonly reason: string },
  ): Promise<void>;
} {
  const [items, setItems] = useState<readonly AutomationReview[]>([]);
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<Error>();
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const initial = await AutomationPostReview.subscribe({
          signal: controller.signal,
        }).replay({ limit: 100, signal: controller.signal });
        setItems(uniqueReviews(initial.items));
        const live = AutomationPostReview.subscribe({
          after: initial.cursor,
          signal: controller.signal,
        });
        for await (const review of live) {
          setItems((current) => uniqueReviews([review, ...current]));
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause : new Error(String(cause)));
        }
      }
    })();
    return () => controller.abort();
  }, []);
  return {
    items,
    ...(pending ? { pending } : {}),
    ...(error ? { error } : {}),
    async resolve(review, action, input) {
      setPending(review.id);
      setError(undefined);
      try {
        const result = action === 'approve'
          ? await review.signal.approve(
              'comment' in input ? input : {},
              { idempotencyKey: `${review.id}:approve` },
            )
          : await review.signal.reject(
              'reason' in input ? input : { reason: 'Rejected.' },
              { idempotencyKey: `${review.id}:reject` },
            );
        if (result.status === 'resolved' || result.status === 'alreadyResolved') {
          setItems((current) => current.filter((item) => item.id !== review.id));
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause : new Error(String(cause)));
      } finally {
        setPending(undefined);
      }
    },
  };
}

function uniqueReviews(
  reviews: readonly AutomationReview[],
): readonly AutomationReview[] {
  return [...new Map(reviews.map((review) => [review.id, review])).values()]
    .sort((left, right) => right.issuedAt.localeCompare(left.issuedAt));
}
