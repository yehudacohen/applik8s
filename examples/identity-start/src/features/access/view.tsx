import type {
  ApplicationSignal,
  ApplicationSignalIssuance,
} from '@applik8s/applik8s';
import { createApplicationTanStackConnection } from '@applik8s/ai-tanstack/client';
import { AgenticStartOnboarding } from '@applik8s/start-agentic/react';
import { useChat } from '@tanstack/ai-react';
import {
  type FormEvent,
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react';
import {
  AccessAdvisor,
  AccessRequest,
  AccessRequestQueue,
  AccessReview,
} from '../../application';

const pendingRequests = AccessRequestQueue({ limit: 50 });

export function IdentityAcceptanceHome() {
  const agent = useAccessAdvisor();
  const requests = pendingRequests.useQuery();
  const create = AccessRequest.create.useMutation();
  const reviews = useAccessReviews();
  const [target, setTarget] = useState('production/catalog');
  const [evidence, setEvidence] = useState(
    'Incident INC-2026-070 requires a bounded catalog repair.',
  );
  const [intendedOutcome, setIntendedOutcome] = useState(
    'Restore catalog availability without granting broader access.',
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await create({
      operation: 'catalog.repair',
      target,
      evidence,
      intendedOutcome,
    });
  }

  return (
    <main>
      <AgenticStartOnboarding
        application="identity-start"
        operationsHref="/operations"
      />
      <p className="eyebrow">Provider-neutral identity acceptance</p>
      <h1>Production access review</h1>
      <p>
        One typed operation is shared by humans, agents, MCP, workflows, and
        the audit UI. Actor identity always comes from framework admission.
      </p>
      <section aria-label="Agent access request">
        <h2>Ask the access advisor</h2>
        <p>
          The exported application agent is the browser connection target; no
          route name or string selector is repeated in the UI.
        </p>
        {agent.messages.map((message) => (
          <article key={message.id} data-role={message.role}>
            <strong>{message.role}</strong>
            {message.parts.map((part, index) =>
              part.type === 'text'
                ? <p key={index}>{part.content}</p>
                : null,
            )}
          </article>
        ))}
        {agent.error ? <p role="alert">{agent.error.message}</p> : null}
        <form onSubmit={agent.submit}>
          <label>
            Agent request
            <textarea
              value={agent.draft}
              onChange={(event) => agent.setDraft(event.currentTarget.value)}
              disabled={agent.isLoading}
            />
          </label>
          <button disabled={agent.isLoading || !agent.draft.trim()}>
            {agent.isLoading ? 'Advising…' : 'Ask advisor'}
          </button>
          {agent.isLoading
            ? <button type="button" onClick={agent.stop}>Stop</button>
            : null}
        </form>
      </section>
      <form onSubmit={submit}>
        <label>
          Target
          <input value={target} onChange={(event) => setTarget(event.target.value)} />
        </label>
        <label>
          Evidence
          <textarea
            value={evidence}
            onChange={(event) => setEvidence(event.target.value)}
          />
        </label>
        <label>
          Intended outcome
          <textarea
            value={intendedOutcome}
            onChange={(event) => setIntendedOutcome(event.target.value)}
          />
        </label>
        <button disabled={create.pending}>
          {create.pending ? 'Submitting…' : 'Request access'}
        </button>
        {create.error ? <p role="alert">{create.error.message}</p> : null}
      </form>

      <section aria-label="Pending durable reviews">
        <h2>Review signals</h2>
        {reviews.error ? <p role="alert">{reviews.error.message}</p> : null}
        {reviews.items.map((review) => (
          <article
            key={review.id}
            data-signal-id={review.signal.issuance.id}
            data-review-request-id={review.input.requestId}
          >
            <strong>{review.input.operation}</strong>
            <p>{review.input.target}</p>
            <p>{review.input.evidence}</p>
            <button
              disabled={reviews.pending === review.id}
              onClick={() => reviews.resolve(review, 'approve')}
            >
              Approve
            </button>
            <button
              disabled={reviews.pending === review.id}
              onClick={() => reviews.resolve(review, 'reject')}
            >
              Reject
            </button>
          </article>
        ))}
      </section>

      <section aria-label="Authoritative access requests">
        <h2>Request state</h2>
        {requests.error ? <p role="alert">{requests.error.message}</p> : null}
        {(requests.data ?? []).map((request) => (
          <article key={request.id} data-request-id={request.id}>
            <strong>{request.operation}</strong>
            <p>{request.target}</p>
            <p>{request.state}</p>
            {request.approvedBy ? <small>Decided by {request.approvedBy}</small> : null}
          </article>
        ))}
      </section>
    </main>
  );
}

function useAccessAdvisor() {
  const reactId = useId();
  const threadId = `access-${reactId.replaceAll(':', '')}`;
  const connection = useMemo(
    () => createApplicationTanStackConnection({ agent: AccessAdvisor }),
    [],
  );
  const chat = useChat({ connection, threadId });
  const [draft, setDraft] = useState(
    'Request a bounded production/catalog repair using incident INC-2026-070 as evidence.',
  );
  return {
    ...chat,
    draft,
    setDraft,
    async submit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      const message = draft.trim();
      if (!message) return;
      setDraft('');
      await chat.sendMessage(message);
    },
  };
}

type ReviewDefinition = typeof AccessReview.signal;
type ReviewIssuance = ApplicationSignalIssuance<
  ReviewDefinition,
  ApplicationSignal<ReviewDefinition>
>;

function useAccessReviews() {
  const [items, setItems] = useState<readonly ReviewIssuance[]>([]);
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<Error>();
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const initial = await AccessReview.subscribe({
          signal: controller.signal,
        }).replay({ limit: 100, signal: controller.signal });
        setItems(uniqueReviews(initial.items));
        const live = AccessReview.subscribe({
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
    pending,
    error,
    async resolve(review: ReviewIssuance, action: 'approve' | 'reject') {
      setPending(review.id);
      setError(undefined);
      try {
        const result = action === 'approve'
          ? await review.signal.approve(
              { comment: 'Approved through provider-admitted review.' },
              { idempotencyKey: `${review.id}:approve` },
            )
          : await review.signal.reject(
              { reason: 'Rejected through provider-admitted review.' },
              { idempotencyKey: `${review.id}:reject` },
            );
        if (
          result.status === 'resolved'
          || result.status === 'alreadyResolved'
        ) {
          setItems((current) =>
            current.filter((candidate) => candidate.id !== review.id),
          );
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
  reviews: readonly ReviewIssuance[],
): readonly ReviewIssuance[] {
  return [
    ...new Map(reviews.map((review) => [review.id, review])).values(),
  ].sort((left, right) => right.issuedAt.localeCompare(left.issuedAt));
}
